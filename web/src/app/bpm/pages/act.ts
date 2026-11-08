import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BpmApi } from '../../core/bpm-api.service';
import { EntryInput, RegisterLine } from '../../core/bpm-models';
import { CentsPipe, cents, shortDate } from '../../core/format';
import {
  BpmLineDetail,
  bpmLoader,
  BpmEntryFlow,
  BpmPageContext,
  BpmPageFocus,
  BpmPageFrame,
} from '../ui';
import { BpmActDue } from './act-due';

/** Cibles historiques conservées pour les liens déjà enregistrés. */
const PANEL_ANCHOR: Record<string, string> = {
  echeances: 'bp-pending-title',
  saisie: 'saisie-des-flux',
  'budget-type': 'budget-type',
  directives: 'bp-dir-title',
  objectif: 'bp-target-title',
  simulation: 'bp-sim-title',
};

/**
 * Fait défiler jusqu'à l'ancre demandée (fragment d'URL, ou cible calculée par la page) une fois la
 * section rendue : les sections chargent leurs lectures séparément, l'ancre peut apparaître après coup.
 * À appeler dans un contexte d'injection.
 */
export function scrollToAnchor(target: () => string | null = () => null) {
  const route = inject(ActivatedRoute);
  const fragment = toSignal(route.fragment, { initialValue: route.snapshot.fragment });
  effect(() => {
    const id = target() ?? fragment();
    if (!id || typeof document === 'undefined') return;
    let tries = 0;
    const go = () => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ block: 'start' });
      else if (++tries < 30) setTimeout(go, 100);
    };
    setTimeout(go, 0);
  });
}

/** Échéances du jour et en retard ; les anciens panneaux rejoignent leur espace spécialisé. */
@Component({
  selector: 'bpm-page-act',
  imports: [
    FormsModule,
    RouterLink,
    BpmPageFrame,
    BpmEntryFlow,
    BpmLineDetail,
    BpmActDue,
    CentsPipe,
  ],
  providers: [BpmPageContext],
  styleUrls: [
    '../ref-styles/bpm-pages.scss',
    '../ref-styles/bpm-vision.page.scss',
  ],
  template: `
    <bpm-page
      title="Échéances à traiter"
      lead="Vérifiez les montants et les dates réelles, puis marquez chaque échéance payée ou reçue."
      [context]="summary.data()?.context ?? due.data()?.context"
      [focus]="focus()"
      scope="Tous les budgets · échéances à traiter aujourd’hui"
      [result]="message() ? { message: message()!, tone: 'success' } : null"
      toolsLabel="Saisie et échéances"
    >
      <ng-container primary>
        @if (priority(); as line) {
          <button
            type="button"
            class="app-hero-action"
            (click)="openDetail(line)"
            [attr.aria-label]="
              (line.direction === 'income' ? 'Vérifier l’entrée · ' : 'Régler l’échéance · ') +
              line.label
            "
          >
            {{ line.direction === 'income' ? 'Vérifier l’entrée' : 'Régler l’échéance' }}
          </button>
        } @else {
          <a class="app-hero-action" routerLink="/tableau-de-bord/rapprochement">Vérifier mon compte</a>
        }
      </ng-container>
      <ng-container actions>
        <button
          type="button"
          class="btn btn-secondary"
          (click)="openCreate({ direction: 'income' })"
          [disabled]="!budgets().length"
        >
          ＋ Saisir une entrée
        </button>
        <button
          type="button"
          class="btn btn-secondary"
          (click)="openCreate({ direction: 'charge' })"
          [disabled]="!budgets().length"
        >
          ＋ Saisir une dépense
        </button>
        @if (message()) {
          <button type="button" class="btn btn-secondary" (click)="message.set(null)">
            Masquer la confirmation
          </button>
        }
      </ng-container>

      <div tools class="bpm-toolbar-shortcuts">
        @if (dueCount()) {
          <label
            >Échéance à traiter
            <select [ngModel]="priority()?.id" (ngModelChange)="priorityId.set($event)">
              @for (line of pending(); track line.id) {
                <option [value]="line.id">
                  {{ line.label }} · {{ line.plannedDate }} · {{ line.plannedCents | cents }}
                </option>
              }
            </select>
          </label>
          <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bp-pending-title"
            >Voir les {{ dueCount() }} échéances</a
          >
        }
        @if (due.data()?.unrealizedCount) {
          <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bp-pending-title"
            >Vérifier {{ due.data()!.unrealizedCount }} échéance(s) de périodes closes</a
          >
        }
      </div>

      <div class="bpm-vision" data-tone="budget">
        <bpm-act-due [loader]="due" (open)="openDetail($event)" />
        @if (due.data() && !due.error()) {
        <section class="bv-card" aria-label="Poursuivre le suivi du budget">
          <h2>{{ dueCount() ? 'Besoin d’ajuster le prévu ?' : 'Les échéances sont à jour' }}</h2>
          <p>{{ dueCount() ? 'Corrigez une opération depuis son détail. Les montants habituels se préparent dans le budget type.' : 'Vérifiez le réalisé avec votre compte, puis clôturez les périodes terminées.' }}</p>
          <div class="bpm-actions">
            @if (dueCount()) {
              <a class="btn btn-secondary" routerLink="/projet-de-vie/budget-type">Ajuster mon budget type</a>
            } @else {
              <a class="btn btn-primary" routerLink="/tableau-de-bord/rapprochement">Rapprocher avec mon compte</a>
              <a class="btn btn-secondary" routerLink="/projet-de-vie/cloture">Vérifier les périodes à clôturer</a>
            }
            <a class="btn btn-secondary" routerLink="/depenses/registre" [queryParams]="{ direction: 'all' }">Retrouver les opérations</a>
          </div>
        </section>
        }
      </div>
    </bpm-page>

    <bpm-entry-flow [budgets]="budgets()" [defaults]="defaults()" [clearOnClose]="['entryDirection']" (saved)="onSaved($event)" />
    @if (selectedId() && !ctx.q('entry')()) {
      <bpm-line-detail
        [lineId]="selectedId()!"
        (closed)="closeDetail()"
        (edit)="openEdit($event)"
      />
    }
  `,
})
export class BpmActPage {
  private bpm = inject(BpmApi);
  protected ctx = inject(BpmPageContext);

  /** Échéances en retard ou du jour (tous les Budgets du user) : contexte de la page et compteur. */
  protected due = bpmLoader(
    () => 0,
    () => this.bpm.due(),
  );
  /** La période en bref (même lecture que le tableau de bord). */
  protected summary = bpmLoader(
    () => 0,
    () => this.bpm.summary(),
  );
  protected budgets = computed(
    () => this.due.data()?.context.budgets ?? this.summary.data()?.context.budgets ?? [],
  );
  protected pending = computed(() =>
    (this.due.data()?.lines ?? [])
      .filter((l) => !l.settled && l.status !== 'unrealized')
      .sort(
        (a, b) =>
          a.plannedDate.localeCompare(b.plannedDate) || a.label.localeCompare(b.label, 'fr'),
      ),
  );
  protected dueCount = computed(() => this.pending().length);
  protected priorityId = signal<string | null>(null);
  protected priority = computed(
    () => this.pending().find((line) => line.id === this.priorityId()) ?? this.pending()[0] ?? null,
  );
  protected focus = computed<BpmPageFocus | null>(() => {
    if (!this.due.data()) return null;
    const line = this.priority();
    return line
      ? {
          title: `${this.dueCount()} échéance(s) à traiter · ${line.label}`,
          detail: `${line.label} · ${cents(line.plannedCents)} · prévue le ${shortDate(line.plannedDate)}`,
          tone: line.status === 'late' ? 'warning' : 'info',
        }
      : {
          title: 'Aucune échéance en retard ou du jour',
          detail: 'Vous pouvez saisir les derniers flux ou préparer les prochains.',
          tone: 'success',
        };
  });

  constructor() {
    const router = inject(Router);
    const route = inject(ActivatedRoute);
    const fragment = toSignal(route.fragment, { initialValue: route.snapshot.fragment });
    const destinations: Record<string, [string, string | undefined]> = {
      saisie: ['/depenses/registre', undefined],
      'budget-type': ['/projet-de-vie/budget-type', undefined],
      directives: ['/vision/reperes', 'bp-dir-title'],
      objectif: ['/vision/reperes', 'bp-target-title'],
      simulation: ['/vision/projection', 'bp-sim-title'],
    };
    effect(() => {
      const panel = this.ctx.q('panneau')() || Object.keys(PANEL_ANCHOR).find(key => PANEL_ANCHOR[key] === fragment()) || '';
      const destination = destinations[panel];
      if (destination) void router.navigate([destination[0]], {
        queryParams: {
          ...this.ctx.carry(),
          ...(panel === 'saisie' ? { entry: 'new', direction: 'all' } : {}),
          ...(panel === 'simulation' ? { effort: this.ctx.q('effort')() || null } : {}),
        },
        fragment: destination[1], replaceUrl: true,
      });
    });
    scrollToAnchor(() => PANEL_ANCHOR[this.ctx.q('panneau')()] ?? null);
  }

  // ---------- détail d'une échéance ----------

  protected selectedId = computed(
    () => this.ctx.q('occurrence')() || this.ctx.q('operation')() || null,
  );
  protected openDetail(l: RegisterLine) {
    this.ctx.setQuery({
      operation: l.operationId ?? (l.occurrenceKey ? null : l.id),
      occurrence: l.occurrenceKey ?? null,
    });
  }
  protected closeDetail() {
    this.ctx.setQuery({ operation: null, occurrence: null }, { replace: true });
  }

  // ---------- éditeur partagé ----------

  protected defaults = computed<Partial<EntryInput>>(() => ({ direction: this.ctx.q('entryDirection')() === 'income' ? 'income' : 'charge' }));
  protected message = signal<string | null>(null);

  /** Création (préremplie par la saisie des flux ou par l'adoption d'une simulation) : aucune écriture avant validation. */
  protected openCreate(d: Partial<EntryInput> = {}) {
    void this.ctx.setQuery({ entry: 'new', entryDirection: d.direction ?? 'charge' });
  }
  protected openEdit(l: RegisterLine) {
    void this.ctx.setQuery({ entry: l.id });
  }
  protected closeEditor() {
    void this.ctx.setQuery({ entry: null }, { replace: true });
  }
  protected onSaved(msg: string) {
    this.message.set(msg);
    this.closeEditor();
  }
}
