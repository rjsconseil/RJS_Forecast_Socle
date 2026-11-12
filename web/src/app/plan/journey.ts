import { NavigationSurfaceDirective } from '../navigation/navigation-ui';
import { Location } from '@angular/common';
import {
  Component,
  computed,
  Directive,
  effect,
  ElementRef,
  inject,
  input,
  Injectable,
  signal,
  untracked,
} from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RecetteContext } from '../core/api.service';
import { PageObjectLabels } from './plan-context';
import { locate } from './site-plan';
import {
  JourneyTrail,
  JourneyVisit,
  journeyAddress,
  emptyTrail,
  objectKey,
  recordVisit,
  removeVisits,
  sameStep,
  TRAIL_LIMIT,
  visitLabel,
} from './journey-model';

/** Ce que l'entrée courante du navigateur sait de ses voisines (étapes du parcours). */
interface EntryTags {
  prevId: string | null;
  nextId: string | null;
}
interface PendingMove {
  restoredId?: string;
  history: boolean;
  replace: boolean;
  /** Première navigation après le chargement de l'application (adresse tapée, favori, rechargement). */
  initial: boolean;
  notice: string | null;
  from: string | null;
  fromPath: string;
  fromTags: EntryTags;
  arrivalTags: EntryTags | null;
}
const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
const pathOf = (url: string) => url.split(/[?#]/)[0];

/**
 * Le parcours de l'utilisateur dans tous les modules du site, par profil et par onglet : un seul fil
 * « Retour / Suivant / Mon parcours » structure la navigation de chaque zone du plan.
 *
 * - « ← Retour » et « Suivant → » se déplacent d'une étape ; la liste « Mon parcours » permet de
 *   rejoindre directement n'importe quelle étape, y compris la dernière atteinte.
 * - Les boutons du navigateur suivent le même parcours : chaque entrée d'historique porte l'identité
 *   de son étape. Quand l'historique du navigateur ne correspond plus (étapes retirées, passage par
 *   une autre zone), le parcours rejoint l'étape visée par une navigation ordinaire.
 * - Un passage par le portail (hors zones) ne crée pas d'étape et ne fait rien perdre.
 */
@Injectable({ providedIn: 'root' })
export class Journey {
  private router = inject(Router);
  private location = inject(Location);
  private user = inject(RecetteContext).userId;
  private objectLabels = inject(PageObjectLabels);
  private owner = this.user();
  private trail = signal<JourneyTrail>(this.restore());
  private pending: PendingMove | null = null;
  /** L'entrée courante du navigateur est bien l'étape sous le curseur. */
  private anchored = false;
  private tags: EntryTags = { prevId: null, nextId: null };
  private busy = signal(false);
  readonly visits = computed(() => this.trail().visits);
  readonly cursor = computed(() => this.trail().cursor);
  readonly previous = computed(() => this.trail().visits[this.trail().cursor - 1] ?? null);
  readonly next = computed(() => this.trail().visits[this.trail().cursor + 1] ?? null);
  readonly current = computed(() => this.trail().visits[this.trail().cursor] ?? null);
  readonly last = computed(() => this.trail().visits.at(-1) ?? null);
  /** Nombre d'étapes déjà parcourues en avant de l'étape affichée. */
  readonly ahead = computed(() => Math.max(0, this.trail().visits.length - 1 - this.trail().cursor));
  readonly notice = signal<string | null>(null);
  readonly pendingNavigation = this.busy.asReadonly();

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.busy.set(true);
        const navigation = this.router.currentNavigation();
        const state = (navigation?.extras.state ?? {}) as Record<string, unknown>;
        const restored = (event.restoredState ?? null) as Record<string, unknown> | null;
        this.pending = {
          restoredId: text(restored?.['journeyVisitId']) ?? text(state['journeyVisitId']),
          history: !!restored,
          replace: !!navigation?.extras.replaceUrl,
          initial: !this.router.navigated,
          notice: text(state['journeyNotice']) ?? null,
          from: this.anchored ? (this.current()?.id ?? null) : null,
          fromPath: pathOf(this.router.url),
          fromTags: this.anchored ? { ...this.tags } : { prevId: null, nextId: null },
          arrivalTags: restored
            ? { prevId: text(restored['journeyPrevId']) ?? null, nextId: text(restored['journeyNextId']) ?? null }
            : null,
        };
      } else if (event instanceof NavigationEnd) {
        const move = this.pending;
        this.pending = null;
        const url = event.urlAfterRedirects;
        if (journeyAddress(url) && move) this.arrive(url, move);
        else {
          this.anchored = false;
          this.tags = { prevId: null, nextId: null };
        }
        if (move?.notice) this.notice.set(move.notice);
        else if (!move?.replace && move?.fromPath !== pathOf(url)) this.notice.set(null);
        this.busy.set(false);
        this.persist();
      } else if (event instanceof NavigationCancel || event instanceof NavigationError) {
        this.pending = null;
        this.busy.set(false);
      }
    });
    // Une fiche publie son nom après sa lecture : les étapes du parcours qui la visitent le reprennent.
    // Un nom déjà retenu par le parcours reste, même quand la page n'est plus là pour le publier.
    effect(() => {
      this.objectLabels.labelFor('');
      const visits = this.trail().visits;
      untracked(() => {
        const relabeled = visits.map((v) => {
          const object = this.objectName(v.url, visits) ?? undefined;
          return { ...v, object, label: visitLabel(v.url, object ?? null) };
        });
        if (relabeled.some((v, i) => v.label !== visits[i].label || v.object !== visits[i].object)) {
          this.trail.update((trail) => ({ ...trail, visits: relabeled }));
          this.persist();
        }
      });
    });
    effect(() => {
      const user = this.user();
      untracked(() => {
        if (user === this.owner) return;
        this.owner = user;
        this.anchored = false;
        this.trail.set(this.restore());
        this.persist();
      });
    });
  }

  back(fallback = '/tableau-de-bord') {
    if (this.busy()) return;
    const target = this.previous();
    if (target) this.reach(target, this.anchored && this.tags.prevId === target.id ? 'back' : null);
    else if (journeyAddress(fallback) && !sameStep(fallback, this.router.url)) void this.router.navigateByUrl(fallback);
  }
  forward() {
    const target = this.next();
    if (!this.busy() && target) this.reach(target, this.anchored && this.tags.nextId === target.id ? 'forward' : null);
  }
  /** Rejoindre directement une étape du parcours, en arrière comme en avant. */
  jump(index: number) {
    const cursor = this.cursor();
    if (this.busy() || index === cursor) return;
    if (index === cursor - 1) return this.back();
    if (index === cursor + 1) return this.forward();
    const target = this.visits()[index];
    if (target) this.reach(target, null);
  }
  /**
   * Un parcours guidé confirmé n'a plus d'étapes où revenir (son brouillon est consommé) : elles
   * quittent le parcours avant d'ouvrir la page d'arrivée. « Retour » ramène alors à ce qui précédait.
   */
  completeFlow(consumed: (url: string) => boolean) {
    this.trail.update((trail) => removeVisits(trail, consumed));
    this.anchored = false;
    this.persist();
  }

  private reach(target: JourneyVisit, browser: 'back' | 'forward' | null) {
    const current = this.current();
    if (current && sameStep(current.url, target.url)) {
      // Même adresse : le routeur ignorerait la navigation, seul le curseur se déplace.
      const index = this.visits().indexOf(target);
      this.trail.update((trail) => ({ ...trail, cursor: index }));
      this.persist();
      return;
    }
    if (browser === 'back') this.location.back();
    else if (browser === 'forward') this.location.forward();
    else void this.router.navigateByUrl(target.url, { state: { journeyVisitId: target.id } });
  }

  /** Le nom de l'objet visité : celui que publie la page, sinon celui qu'une étape du parcours a retenu. */
  private objectName(url: string, visits = this.trail().visits): string | null {
    const published = this.objectLabels.labelFor(url);
    if (published) return published;
    const key = objectKey(url);
    return (key && visits.find((v) => v.object && objectKey(v.url) === key)?.object) || null;
  }

  private arrive(url: string, move: PendingMove) {
    const object = this.objectName(url) ?? undefined;
    // Au chargement, le routeur « remplace » toujours l'entrée du navigateur. Ce n'est la même étape
    // que pour un rechargement ; une adresse tapée ou un favori est une étape de plus.
    const current = this.current();
    const replace = move.replace && !(move.initial && !(current && sameStep(current.url, url)));
    const trail = recordVisit(
      this.trail(),
      { id: move.restoredId ?? crypto.randomUUID(), url, label: visitLabel(url, object ?? null), object },
      { restoredId: move.restoredId, replace },
    );
    this.trail.set(trail);
    const arrived = trail.visits[trail.cursor];
    let tags: EntryTags;
    if (move.history) {
      tags = { ...(move.arrivalTags ?? { prevId: null, nextId: null }) };
      if (move.from && move.fromTags.prevId === arrived.id) tags.nextId = move.from;
      if (move.from && move.fromTags.nextId === arrived.id) tags.prevId = move.from;
    } else if (replace) tags = { ...move.fromTags };
    else tags = { prevId: move.from, nextId: null };
    if (tags.prevId === arrived.id) tags.prevId = null;
    if (tags.nextId === arrived.id) tags.nextId = null;
    this.tags = tags;
    this.anchored = true;
    this.location.replaceState(url, '', {
      ...(this.location.getState() as object),
      journeyVisitId: arrived.id,
      journeyPrevId: tags.prevId,
      journeyNextId: tags.nextId,
    });
  }

  private key() {
    return `rjs-journey:${this.owner ?? 'anonymous'}`;
  }
  private restore(): JourneyTrail {
    try {
      const data = JSON.parse(sessionStorage.getItem(this.key()) ?? 'null') as JourneyTrail | null;
      if (
        data &&
        Array.isArray(data.visits) &&
        data.visits.length <= TRAIL_LIMIT &&
        Number.isInteger(data.cursor) &&
        data.cursor >= 0 &&
        data.cursor < data.visits.length &&
        data.visits.every(
          (v) =>
            typeof v.id === 'string' &&
            journeyAddress(v.url) &&
            typeof v.label === 'string' &&
            (v.object === undefined || typeof v.object === 'string'),
        )
      )
        return data;
    } catch {
      /* Le parcours reste utilisable sans stockage navigateur. */
    }
    return emptyTrail();
  }
  private persist() {
    try {
      sessionStorage.setItem(this.key(), JSON.stringify(this.trail()));
    } catch {
      /* mémoire seule */
    }
  }
}

@Component({
  selector: 'rjs-journey',
  imports: [NavigationSurfaceDirective],
  host: {
    '(document:click)': 'closeOutside($event)',
    '(document:keydown.escape)': 'closeTrail()',
  },
  template: `
    <nav navigationSurface="tertiary" class="journey-navigation" [attr.aria-label]="compact() ? 'Parcours du formulaire' : 'Avancer et revenir dans mon parcours'">
      <button
        type="button"
        data-navigation-level="detail" class="nav-step nav-back"
        (click)="navigation.back()"
        [disabled]="blocked() || navigation.pendingNavigation() || !navigation.previous()"
        [title]="stepLabel(navigation.previous()) ?? 'Début du parcours'"
      >
        <span aria-hidden="true">←</span
        ><span
          >Retour<span class="nav-destination">
            · {{ stepLabel(navigation.previous()) ?? 'Début du parcours' }}</span
          ></span
        >
      </button>
      @if (!compact()) {
        <details class="nav-trail" #trail (toggle)="opened.set(trail.open)">
          <summary data-navigation-level="page"
            [attr.aria-label]="
              'Mon parcours : étape ' + position() + ' sur ' + navigation.visits().length + ' · ' + (navigation.current()?.label ?? 'Mon parcours')
            "
          >
            <span class="nav-current" aria-live="polite">{{ navigation.current()?.label ?? 'Mon parcours' }}</span>
            @if (navigation.visits().length > 1) {
              <span class="nav-position">{{ position() }} / {{ navigation.visits().length }}</span>
            }
            <span class="nav-caret" aria-hidden="true">▾</span>
          </summary>
          @if (opened()) {
            <div class="nav-trail-panel">
              <p class="nav-trail-title">Mon parcours <small>· toutes les étapes de cette séance</small></p>
              <ol class="nav-trail-list">
                @for (visit of navigation.visits(); track visit.id; let i = $index) {
                  <li [class.is-current]="i === navigation.cursor()" [class.is-ahead]="i > navigation.cursor()">
                    <button
                      type="button"
                      (click)="go(i)"
                      [disabled]="i === navigation.cursor() || navigation.pendingNavigation()"
                      [attr.aria-current]="i === navigation.cursor() ? 'step' : null"
                    >
                      <span class="nav-trail-index">{{ i + 1 }}</span>
                      <span class="nav-trail-zone" [attr.title]="zoneOf(visit.url)?.label">{{ zoneOf(visit.url)?.acronym }}</span>
                      <span class="nav-trail-label">{{ visit.label }}</span>
                      @if (i === navigation.cursor()) {
                        <span class="nav-trail-tag">Vous êtes ici</span>
                      } @else if (i === navigation.visits().length - 1) {
                        <span class="nav-trail-tag">Dernière étape</span>
                      }
                    </button>
                  </li>
                }
              </ol>
            </div>
          }
        </details>
      } @else {
        <span class="nav-current nav-current-compact" aria-hidden="true"></span>
      }
      <button
        type="button"
        data-navigation-level="detail" class="nav-step nav-forward"
        (click)="navigation.forward()"
        [disabled]="blocked() || navigation.pendingNavigation() || !navigation.next()"
        [title]="stepLabel(navigation.next()) ?? 'Aucune étape suivante visitée'"
      >
        <span
          >Suivant<span class="nav-destination"> · {{ stepLabel(navigation.next()) ?? '' }}</span></span
        ><span aria-hidden="true">→</span>
      </button>
      @if (!compact() && navigation.ahead() > 1) {
        <button
          type="button"
          data-navigation-level="detail" class="nav-step nav-last"
          (click)="go(navigation.visits().length - 1)"
          [disabled]="blocked() || navigation.pendingNavigation()"
          [title]="'Reprendre à la dernière étape : ' + navigation.last()?.label"
          [attr.aria-label]="'Reprendre à la dernière étape : ' + navigation.last()?.label"
        >
          <span>Dernière étape</span><span aria-hidden="true">⇥</span>
        </button>
      }
    </nav>
    @if (!compact() && navigation.notice(); as message) {
      <p class="journey-notice" role="status">
        {{ message
        }}<button
          type="button"
          (click)="navigation.notice.set(null)"
          aria-label="Masquer la confirmation"
        >
          ×
        </button>
      </p>
    }
  `,
  styleUrl: './journey.scss',
})
export class JourneyBar {
  readonly compact = input(false);
  readonly blocked = input(false);
  protected navigation = inject(Journey);
  protected opened = signal(false);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected position = computed(() => this.navigation.cursor() + 1);
  /** Le parcours traverse les modules : chaque étape porte le sigle de sa zone. */
  protected zoneOf = (url: string) => locate(url).zone;
  /** Une étape d'une autre zone est nommée avec sa zone : « Noyau transverse · Projets ». */
  protected stepLabel(visit: JourneyVisit | null) {
    if (!visit) return null;
    const zone = this.zoneOf(visit.url);
    const here = this.navigation.current();
    return zone && here && this.zoneOf(here.url)?.id !== zone.id ? `${zone.label} · ${visit.label}` : visit.label;
  }

  protected go(index: number) {
    this.closeTrail();
    this.navigation.jump(index);
  }
  protected closeTrail() {
    const details = this.host.nativeElement.querySelector<HTMLDetailsElement>('details.nav-trail');
    if (details?.open) details.open = false;
  }
  protected closeOutside(event: Event) {
    const details = this.host.nativeElement.querySelector<HTMLDetailsElement>('details.nav-trail');
    if (details?.open && !details.contains(event.target as Node)) details.open = false;
  }
}

/** Un lien de retour conserve un href utile pour une arrivée directe ou un nouvel onglet. */
@Directive({ selector: 'a[journeyBack]', host: { '(click)': 'follow($event)' } })
export class JourneyBack {
  private navigation = inject(Journey);
  protected follow(event: MouseEvent) {
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey ||
      !this.navigation.previous()
    )
      return;
    event.preventDefault();
    this.navigation.back();
  }
}
