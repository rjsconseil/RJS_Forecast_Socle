import { Location } from '@angular/common';
import {
  Component,
  computed,
  Directive,
  effect,
  inject,
  input,
  Injectable,
  signal,
  untracked,
} from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RecetteContext } from '../../core/api.service';
import { BpmTrail, bpmAddress, emptyTrail, recordVisit, visitLabel } from './navigation-model';

/** Historique de parcours par utilisateur et onglet, borné aux adresses locales BPM. */
@Injectable({ providedIn: 'root' })
export class BpmNavigation {
  private router = inject(Router);
  private location = inject(Location);
  private user = inject(RecetteContext).userId;
  private owner = this.user();
  private trail = signal<BpmTrail>(this.restore());
  private pending: { restoredId?: string; replace?: boolean } = {};
  private busy = signal(false);
  readonly previous = computed(() => this.trail().visits[this.trail().cursor - 1] ?? null);
  readonly next = computed(() => this.trail().visits[this.trail().cursor + 1] ?? null);
  readonly current = computed(() => this.trail().visits[this.trail().cursor] ?? null);
  readonly notice = signal<string | null>(null);
  readonly pendingNavigation = this.busy.asReadonly();

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.busy.set(true);
        this.pending = {
          restoredId:
            event.restoredState?.['bpmVisitId'] ??
            (this.trail().visits[this.trail().cursor]?.url === event.url
              ? (this.location.getState() as { bpmVisitId?: string }).bpmVisitId
              : undefined),
          replace: this.router.currentNavigation()?.extras.replaceUrl,
        };
      } else if (event instanceof NavigationEnd) {
        // Sortir de BPM rompt le parcours : le bouton retour ne traverse pas d'autre zone.
        if (!bpmAddress(event.urlAfterRedirects)) this.trail.set(emptyTrail());
        else {
          const id = this.pending.restoredId ?? crypto.randomUUID();
          this.trail.update((trail) =>
            recordVisit(
              trail,
              { id, url: event.urlAfterRedirects, label: visitLabel(event.urlAfterRedirects) },
              this.pending,
            ),
          );
          this.location.replaceState(event.urlAfterRedirects, '', {
            ...(this.location.getState() as object),
            bpmVisitId: id,
          });
        }
        const notice = this.router.currentNavigation()?.extras.state?.['bpmNotice'];
        this.notice.set(typeof notice === 'string' ? notice : null);
        this.busy.set(false);
        this.persist();
      } else if ('reason' in event || event.constructor.name === 'NavigationError')
        this.busy.set(false);
    });
    effect(() => {
      const user = this.user();
      untracked(() => {
        if (user === this.owner) return;
        this.owner = user;
        this.trail.set(emptyTrail());
        this.persist();
      });
    });
  }

  back(fallback = '/tableau-de-bord') {
    if (this.busy()) return;
    if (this.previous()) this.location.back();
    else if (bpmAddress(fallback)) void this.router.navigateByUrl(fallback);
  }
  forward() {
    if (!this.busy() && this.next()) this.location.forward();
  }

  private key() {
    return `bpm-navigation:${this.owner ?? 'anonymous'}`;
  }
  private restore(): BpmTrail {
    try {
      const data = JSON.parse(sessionStorage.getItem(this.key()) ?? 'null') as BpmTrail | null;
      if (
        data &&
        Array.isArray(data.visits) &&
        data.visits.length <= 60 &&
        Number.isInteger(data.cursor) &&
        data.cursor >= 0 &&
        data.cursor < data.visits.length &&
        data.visits.every(
          (v) => typeof v.id === 'string' && bpmAddress(v.url) && typeof v.label === 'string',
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
  selector: 'bpm-navigation',
  template: `
    <nav class="bpm-journey-navigation" [attr.aria-label]="compact() ? 'Parcours du formulaire' : 'Avancer et revenir dans mon parcours'">
      <button
        type="button"
        (click)="navigation.back()"
        [disabled]="blocked() || navigation.pendingNavigation() || !navigation.previous()"
        [title]="navigation.previous()?.label ?? 'Début du parcours'"
      >
        <span aria-hidden="true">←</span
        ><span
          >Retour<span class="nav-destination">
            · {{ navigation.previous()?.label ?? 'Début du parcours' }}</span
          ></span
        >
      </button>
      <span class="nav-current" [hidden]="compact()" aria-live="polite">{{
        navigation.current()?.label ?? 'Mon parcours BPM'
      }}</span>
      <button
        type="button"
        (click)="navigation.forward()"
        [disabled]="blocked() || navigation.pendingNavigation() || !navigation.next()"
        [title]="navigation.next()?.label ?? 'Aucune étape suivante visitée'"
      >
        <span
          >Suivant<span class="nav-destination"> · {{ navigation.next()?.label ?? '' }}</span></span
        ><span aria-hidden="true">→</span>
      </button>
    </nav>
    @if (!compact() && navigation.notice(); as message) {
      <p class="bpm-navigation-notice" role="status">
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
  styleUrl: './navigation.scss',
})
export class BpmNavigationComponent {
  readonly compact = input(false);
  readonly blocked = input(false);
  protected navigation = inject(BpmNavigation);
}

/** Un lien de retour conserve un href utile pour une arrivée directe ou un nouvel onglet. */
@Directive({ selector: 'a[bpmBack]', host: { '(click)': 'follow($event)' } })
export class BpmBack {
  private navigation = inject(BpmNavigation);
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
