import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BpmApi } from '../../core/bpm-api.service';
import { EntryInput, RegisterLine } from '../../core/bpm-models';
import { CentsPipe, SignedCentsPipe, cents, shortDate } from '../../core/format';
import {
  BpmLineDetail,
  bpmLoader,
  BpmEntryFlow,
  BpmPageContext,
  BpmPageFocus,
  BpmPageFrame,
  BpmState,
} from '../ui';
import { BpmActBudgetType } from './act-budget-type';
import { BpmActDue } from './act-due';
import { BpmActDirectives, BpmActSurplus } from './act-guidance';
import { BpmActSimulation } from './act-simulation';
import { BpmActEntry } from './act-entry';

/** Anciens panneaux (`?panneau=`) : chacun mène désormais à sa section de la page. */
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

/**
 * Ce qu'il faut faire (/piloter/agir), sur la lecture « actions » du pilotage de la référence
 * (`bpm-pilot.page`, mode agir) : la période en bref, la saisie des flux, puis le cockpit 02 · Agir —
 * repères (directives), budget type, échéances, minimum d'épargne, simulation et leviers.
 * Les anciens liens `?panneau=` mènent à la section correspondante ; le détail d'une échéance suit la
 * convention d'URL du registre (`?operation=…&occurrence=…`).
 */
@Component({
  selector: 'bpm-page-act',
  imports: [
    FormsModule,
    RouterLink,
    BpmPageFrame,
    BpmState,
    BpmEntryFlow,
    BpmLineDetail,
    BpmActDue,
    BpmActBudgetType,
    BpmActDirectives,
    BpmActSurplus,
    BpmActSimulation,
    BpmActEntry,
    CentsPipe,
    SignedCentsPipe,
  ],
  providers: [BpmPageContext],
  styleUrls: [
    '../ref-styles/bpm-pages.scss',
    '../ref-styles/bpm-vision.page.scss',
    '../ref-styles/bpm-pilot-charts.scss',
    '../ref-styles/bpm-flow-pilot.component.scss',
  ],
  template: `
    <bpm-page
      title="Ce qu’il faut faire"
      lead="Traitez les échéances, saisissez vos flux et ajustez votre budget."
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
          <button
            type="button"
            class="app-hero-action"
            (click)="openCreate({ direction: 'charge' })"
            [disabled]="!budgets().length"
          >
            ＋ Saisir une dépense
          </button>
        }
      </ng-container>
      <ng-container actions>
        <button
          type="button"
          class="btn btn-secondary"
          (click)="openCreate({ direction: 'charge' })"
          [disabled]="!budgets().length"
        >
          ＋ Dépense
        </button>
        <button
          type="button"
          class="btn btn-secondary"
          (click)="openCreate({ direction: 'income' })"
          [disabled]="!budgets().length"
        >
          ＋ Entrée
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
        @if (summary.data() && fig('bpm.soldeAttendu') !== null && fig('bpm.soldeAttendu')! > 0) {
          <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bp-sim-title"
            >Tester l’épargne possible</a
          >
        }
        @if (due.data()?.unrealizedCount) {
          <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bp-pending-title"
            >Vérifier {{ due.data()!.unrealizedCount }} échéance(s) de périodes closes</a
          >
        }
      </div>

      <div class="bpm-vision" data-tone="budget">
        <!-- La période en bref : le détail des graphes reste dans Graphiques et chiffres. -->
        <section class="fp-overview is-compact" aria-labelledby="fp-title">
          <div class="fp-summary" data-bpm-frame="metrics">
            <div class="fp-compact-heading">
              <h2 id="fp-title">Votre période</h2>
              <a routerLink="/piloter" [queryParams]="ctx.carry()">Voir l’analyse →</a>
            </div>
            <bpm-state
              [loading]="summary.loading() && !summary.data()"
              [error]="summary.error()"
              (retry)="summary.reload()"
            />
            @if (summary.data()) {
              <dl class="fp-compact-facts">
                <div>
                  <dt>Solde à ce jour</dt>
                  <dd [attr.data-sign]="sign(fig('bpm.resultatPeriode'))">
                    {{ fig('bpm.resultatPeriode') | signedCents }}
                  </dd>
                </div>
                <div>
                  <dt>Solde prévu en fin de période</dt>
                  <dd [attr.data-sign]="sign(fig('bpm.soldeAttendu'))">
                    {{ fig('bpm.soldeAttendu') | signedCents }}
                  </dd>
                </div>
                <div>
                  <dt>
                    {{
                      fig('bpm.patrimoineFinPeriode') === null
                        ? 'Patrimoine actuel'
                        : 'Patrimoine après la période'
                    }}
                  </dt>
                  <dd>
                    {{ fig('bpm.patrimoineFinPeriode') ?? fig('bpm.patrimoineConstitue') | cents }}
                  </dd>
                </div>
              </dl>
            }
          </div>
        </section>

        <bpm-act-entry
          [budgets]="budgets()"
          [owner]="owner()"
          [disabled]="!budgets().length"
          (create)="openCreate($event)"
        />

        <header class="bp-scope-heading" id="bp-groupe-chiffres">
          <span class="bp-scope-icon" aria-hidden="true">↗</span>
          <div>
            <h2>Ajuster votre budget quotidien</h2>
            <p>Votre budget type, les échéances et les objectifs d’épargne.</p>
          </div>
        </header>

        <!-- 02 · Agir : consulter, saisir, régler l'épargne visée et simuler un effort. -->
        <section
          data-ui-pattern="panel cockpit"
          data-cockpit-phase="act"
          id="agir"
          aria-label="Ce qu’il faut faire"
        >
          @if (due.error() && !due.data()) {
            <bpm-state [error]="due.error()" (retry)="due.reload()" />
          }

          <bpm-act-directives />
          <bpm-act-budget-type />
          <bpm-act-due [loader]="due" (open)="openDetail($event)" />

          <div class="bv-split">
            <bpm-act-surplus />
            <bpm-act-simulation (adoptRequest)="openCreate($event)" />
          </div>

          <section class="bv-card" aria-labelledby="bp-levers-title" data-ui-pattern="panel">
            <h2 id="bp-levers-title">Ajuster votre budget</h2>
            <div class="bp-levers">
              <a class="btn btn-secondary" routerLink="/depenses" [queryParams]="ctx.carry()"
                >Toutes les opérations du budget →</a
              >
              <a class="btn btn-secondary" routerLink="/app/reglages"
                >Clôture et cycle budgétaire →</a
              >
              <a class="btn btn-secondary" routerLink="/vision">Objectifs et avenir →</a>
            </div>
            <p class="bpm-help">
              Les chiffres de synthèse restent dans le
              <a routerLink="/tableau-de-bord">Tableau de bord</a> et les graphes dans
              <a routerLink="/piloter">Graphiques et chiffres</a>.
            </p>
          </section>
        </section>
      </div>
    </bpm-page>

    <bpm-entry-flow [budgets]="budgets()" [defaults]="defaults()" (saved)="onSaved($event)" />
    @if (selectedId() && !ctx.q('entry')()) {
      <bpm-line-detail
        [lineId]="selectedId()!"
        (closed)="closeDetail()"
        (edit)="openEdit($event)"
      />
    }
  `,
  styles: `
    /* Les sections assemblées gardent l'écart des cartes de la référence. */
    [data-cockpit-phase='act'] {
      display: grid;
      gap: var(--ecart-24);
      min-width: 0;
    }
    .bv-split > * {
      min-width: 0;
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
  protected owner = computed(
    () => (this.summary.data() ?? this.due.data())?.context.user.label ?? null,
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
    const panel = this.ctx.q('panneau');
    scrollToAnchor(() => PANEL_ANCHOR[panel()] ?? null);
  }

  protected fig(key: string) {
    return this.summary.data()?.figures[key]?.valueCents ?? null;
  }
  protected sign(v: number | null) {
    return v === null ? null : v < 0 ? 'negative' : 'positive';
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

  protected defaults = signal<Partial<EntryInput>>({});
  protected message = signal<string | null>(null);

  /** Création (préremplie par la saisie des flux ou par l'adoption d'une simulation) : aucune écriture avant validation. */
  protected openCreate(d: Partial<EntryInput> = {}) {
    this.defaults.set(d);
    void this.ctx.setQuery({ entry: 'new' });
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
