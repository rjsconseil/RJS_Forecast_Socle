import { BpmFundingComponent } from './bpm-funding.component';
import { BpmProjectCostsComponent } from './bpm-project-costs.component';
import { expensePeriodQuery } from './bpm-expense-links';
import { RangeFieldComponent } from '../shared/range-field.component';
import { BpmTechnologyComponent } from './bpm-technology.component';
import { cycleOf, lensDirectives } from './bpm-lens.model';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  untracked,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { formatMoney } from '../shared/amount';
import { pageText, registerPageTexts } from '../shared/page-text';
import { siteSetting } from '../shared/site-settings';
import { UserSession } from '../utilisateurs/utilisateurs.contract';
import { BpmProject } from './bpm.model';
import { BpmStore } from './bpm.store';
import { dailyBudget, DailyPreferences, parseHorizons } from './bpm-daily.model';
import { visionSettings } from './bpm-settings';
import { visionInputOf, visionProjection } from './bpm-vision.model';

const P = 'content.pages.bpm.bpm-daily.component.';
export const BPM_DAILY_TEXTS: Record<string, string> = {
  budget: 'Mon budget au quotidien',
  explore: "Explorer un horizon",
  exploreHelp: "Déplacez le curseur pour voir la projection. Vos objectifs et vos réglages restent inchangés.",
  exploreLabel: "Horizon de projection",
  preview: "Projection à cet horizon",
  yearsUnit: "ans",
  yearUnit: "an",
  capSpent: 'du plafond de dépenses consommé',
  explain: 'Comprendre ces montants',
  goalGap: 'Marge après charges et épargne nécessaire aux objectifs :',
  period: 'Cycle suivi',
  net: 'Solde du budget à ce jour',
  netHelp:
    'Entrées reçues moins dépenses payées. Ce montant n’est pas le solde de votre compte bancaire.',
  charges: 'Charges encore à payer',
  income: 'Entrées encore attendues',
  expected: 'Solde prévu à la clôture',
  expectedHelp:
    'Si toutes les entrées et charges prévues se réalisent. Les dépenses non encore saisies ne sont pas incluses.',
  deficit: 'Déficit prévu à la clôture',
  waiting: 'Budget négatif à ce jour ; des entrées restent attendues',
  balanced: 'Pas de déficit prévu avec les flux renseignés',
  future: 'Cycle à venir — préparer les entrées et les charges',
  rhythm: 'Vitesse de consommation',
  spent: 'des entrées reçues et attendues déjà dépensées',
  time: 'de la période écoulée',
  fast: 'Dépenses plus rapides que le temps écoulé',
  steady: 'Rythme compatible avec le temps écoulé',
  over: 'Plafond de dépenses dépassé',
  unknown: 'Rythme non calculable : renseignez les entrées prévues',
  rhythmHelp:
    'Repère linéaire : un loyer payé en début de période peut avancer le rythme. Ce repère ne prédit pas les dates de trésorerie.',
  chargesDetail: 'Voir les charges et leurs dates',
  noCharges: 'Aucune charge restante renseignée.',
  forecastDate: 'Date prévue',
  pending: 'En attente',
  due: 'Échéance arrivée',
  pilot: 'Noter une dépense',
  money: 'Comprendre mes dépenses',
  wealth: 'Mon patrimoine',
  now: 'À ce jour',
  unknownWealth: 'Valeur à compléter',
  wealthHelp:
    'Actifs valorisés et clôtures passées. Le solde du budget en cours rejoindra le patrimoine à la clôture.',
  horizon: 'Dans',
  years: 'an(s)',
  real: 'en euros d’aujourd’hui',
  projectionHelp:
    'Projection selon les apports, objectifs, rendement et inflation retenus ; elle ne constitue pas une valeur garantie.',
  vision: 'Objectifs et hypothèses',
  customize: 'Personnaliser mon accueil',
  customizeHelp:
    'Préférences de lecture pour cet utilisateur et ce projet, conservées dans ce navigateur.',
  horizons: 'Horizons en années, séparés par des virgules',
  horizonMax: 'Horizon maximal configuré :',
  showCharges: 'Afficher la liste des charges',
  showProjections: 'Afficher les projections du patrimoine',
  save: 'Appliquer',
  reset: 'Revenir à la vue proposée',
  invalid: 'Saisissez des années entières distinctes entre 1 et l’horizon maximal.',
  saved: 'Vue personnalisée.',
  sessionOnly: 'Vue appliquée pour cette session ; ce navigateur ne permet pas de la mémoriser.',
};
registerPageTexts(
  Object.fromEntries(Object.entries(BPM_DAILY_TEXTS).map(([key, value]) => [P + key, value])),
);

@Component({
  selector: 'rjs-bpm-daily',
  imports: [BpmFundingComponent,BpmProjectCostsComponent,RouterLink, FormsModule, RangeFieldComponent, BpmTechnologyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./bpm-expenses.page.scss', './bpm-daily.component.scss'],
  template: `
    @if (budget(); as b) {
      <section class="daily-budget" aria-labelledby="daily-budget-title">
        <header>
          <h2 id="daily-budget-title">{{ t('budget') }}</h2>
          <p>
            {{ t('period') }} · {{ date(project().snapshot!.period.start) }} →
            {{ dateEnd(project().snapshot!.period.end) }}
          </p>
        </header>
        <rjs-bpm-funding [project]="project()" [funding]="project().snapshot?.funding" [start]="project().snapshot!.period.start" [end]="project().snapshot!.period.end" />
        @if (directives(); as d) {
          @if (d.remainingCents !== null && d.remainingCents < 0) {
            <p class="daily-goal-gap">
              {{ t('goalGap') }} <strong>{{ money(d.remainingCents) }}</strong>
            </p>
          }
        }
        <div class="daily-rhythm">
          <h3>{{ t('rhythm') }}</h3>
          <strong>{{ t(b.rhythm) }}</strong>
          @if (project().snapshot!.period.started && b.consumed !== null) {
            <p>
              {{ b.consumed }} % {{ t(b.usesCap ? 'capSpent' : 'spent') }} · {{ b.elapsed }} %
              {{ t('time') }}
            </p>
            <div class="daily-pace-row"><span>{{ b.consumed }} %</span><progress [value]="b.consumed" max="100" [attr.aria-label]="t('rhythm')"></progress></div>
            <div class="daily-pace-row is-time"><span>{{ b.elapsed }} %</span><progress [value]="b.elapsed" max="100" [attr.aria-label]="t('time')"></progress></div>
          }
          <details>
            <summary>{{ t('explain') }}</summary>
            <p>{{ t('netHelp') }}</p>
            <p>{{ t('expectedHelp') }}</p>
            <p>{{ t('rhythmHelp') }}</p>
            <p>{{ money(b.spent) }} / {{ money(b.baseline) }} · {{ t('spent') }}</p>
          </details>
        </div>
        @if (preferences().charges) {
          <details class="daily-charges">
            <summary>{{ t('chargesDetail') }} · {{ b.pending.length }}</summary>
            <ul class="expense-project-list">
              @for (flow of b.pending; track flow.operationId + flow.occurrenceDate) {
                <li><a class="expense-row expense-charge-summary" data-status="pending" routerLink="/budget-patrimoine-management/depenses" [queryParams]="expenseQuery(flow.operationId,flow.occurrenceDate)">
                  <span class="expense-date"><small>{{t('forecastDate')}}</small>{{date(flow.occurrenceDate)}}</span>
                  <span class="expense-main"><strong>{{flow.title}}</strong><small>{{project().budgetTitle}}</small></span>
                  <strong class="expense-amount">{{money(flow.amountCents)}}</strong>
                  <span class="expense-state">{{t(flow.occurrenceDate <= today() ? 'due' : 'pending')}}</span>
                </a></li>
              } @empty { <li>{{t('noCharges')}}</li> }
            </ul>
          </details>
        }
        <rjs-bpm-project-costs [allowDetach]="true" [expenseList]="true" [project]="project()" [costs]="project().snapshot?.budgetProjects ?? []" [start]="project().snapshot!.period.start" [end]="project().snapshot!.period.end" />
        <nav>
          <a
            class="btn btn-primary"
            routerLink="/budget-patrimoine-management/piloter"
            [queryParams]="cycleQuery()"
            fragment="agir"
            >{{ t('pilot') }} →</a
          ><a
            class="btn btn-secondary"
            routerLink="/budget-patrimoine-management/depenses"
            [queryParams]="expenseQuery()"
            >{{ t('money') }} →</a
          >
        </nav>
      </section>
      <section class="daily-wealth" aria-labelledby="daily-wealth-title">
        <rjs-bpm-technology name="trajectoire" /><h2 id="daily-wealth-title">{{ t('wealth') }}</h2>
        <div class="daily-grid">
          <div class="daily-number">
            <span>{{ t('now') }}</span
            ><strong>{{ wealth() === null ? t('unknownWealth') : money(wealth()!) }}</strong
            ><small>{{ t('wealthHelp') }}</small>
          </div>
          @if (preferences().projections && wealth() !== null) {
            @for (point of projections(); track point.year) {
              <div class="daily-number">
                <span
                  >{{ t('horizon') }} {{ point.offset }} {{ t('years') }} · {{ point.year }}</span
                ><strong>{{ money(point.nominalCents) }}</strong
                ><small>{{ money(point.realCents) }} {{ t('real') }}</small>
              </div>
            }
          }
        </div>
        @if (preferences().projections && wealth() !== null) {
          <p class="daily-help">{{ t('projectionHelp') }}</p>
        }
        @if (exploration(); as point) {
          <details class="daily-explorer">
            <summary>{{ t('explore') }}</summary>
            <p class="daily-help">{{ t('exploreHelp') }}</p>
            <rjs-range-field id="daily-horizon" name="previewHorizon" [label]="t('exploreLabel')"
              [min]="1" [max]="max()" [unit]="t('yearsUnit')" [unitSingular]="t('yearUnit')" [ngModel]="exploreYears()"
              (ngModelChange)="explore($event)" />
            <output class="daily-preview">
              <span>{{ t('preview') }} · {{ point.year }}</span>
              <strong>{{ money(point.nominalCents) }}</strong>
              <small>{{ money(point.realCents) }} {{ t('real') }}</small>
            </output>
          </details>
        }
        <a routerLink="/budget-patrimoine-management/vision" [queryParams]="cycleQuery()"
          >{{ t('vision') }} →</a
        >
      </section>
      <details class="daily-customize" (toggle)="prepare($event)">
        <summary>{{ t('customize') }}</summary>
        <form (ngSubmit)="save()">
          <p>{{ t('customizeHelp') }}</p>
          <label
            ><input type="checkbox" name="charges" [(ngModel)]="draftCharges" />
            {{ t('showCharges') }}</label
          >
          <label
            ><input type="checkbox" name="projections" [(ngModel)]="draftProjections" />
            {{ t('showProjections') }}</label
          >
          <label
            >{{ t('horizons')
            }}<input
              name="horizons"
              [(ngModel)]="draftHorizons"
              [attr.aria-invalid]="error() || null"
              aria-describedby="daily-horizon-help"
          /></label>
          <p id="daily-horizon-help">{{ t('horizonMax') }} {{ max() }} {{ t('years') }}</p>
          @if (error()) {
            <p role="alert">{{ t('invalid') }}</p>
          }
          <div>
            <button class="btn btn-primary" type="submit">{{ t('save') }}</button>
            <button class="btn btn-secondary" type="button" (click)="reset()">
              {{ t('reset') }}
            </button>
          </div>
          <p role="status">{{ notice() }}</p>
        </form>
      </details>
    }
  `,
})
export class BpmDailyComponent {
  protected expenseQuery(operation?:string, occurrence?:string) { const p=this.project(); return {...expensePeriodQuery(p,{operation,occurrence,date:occurrence}),budget:p.budgetProjectId}; }

  readonly project = input.required<BpmProject>();
  private readonly store = inject(BpmStore);
  private readonly session = inject(UserSession);
  private readonly revision = signal(0);
  private readonly transient = new Map<string, DailyPreferences>();
  protected readonly today = computed(() => this.store.workspace()?.today ?? '');
  protected readonly max = computed(() => visionSettings().horizonYears);
  protected readonly directives = computed(() => {
    const workspace = this.store.workspace();
    return workspace && this.project().snapshot
      ? lensDirectives(this.project(), workspace, visionSettings(), cycleOf(this.project()))
      : null;
  });
  protected readonly budget = computed(() =>
    dailyBudget(
      this.project(),
      siteSetting<number>('bpm.pilotage.rythmeMarge'),
      this.directives()?.spendingCapCents ?? null,
    ),
  );
  protected readonly cycleQuery = computed(() => ({
    projet: this.project().id,
    vue: this.project().link?.periodicity ?? 'monthly',
  }));
  protected readonly wealth = computed(() => this.project().snapshot?.standing.totalCents ?? null);
  private readonly key = computed(
    () => `rjs-bpm-daily:${this.session.profile()?.id ?? 'local'}:${this.project().id}`,
  );
  private defaults(): DailyPreferences {
    const year = Number(this.today().slice(0, 4));
    const goals = (this.project().vision?.goals ?? [])
      .map((goal) => Number(goal.targetDate.slice(0, 4)) - year)
      .filter((n) => n > 0 && n <= this.max());
    return {
      horizons: [...new Set(goals.length ? goals : [this.max()])].sort((a, b) => a - b),
      charges: true,
      projections: true,
    };
  }
  protected readonly preferences = computed(() => {
    this.revision();
    const defaults = this.defaults();
    const local = this.transient.get(this.key());
    if (local) return local;
    try {
      const raw = JSON.parse(localStorage.getItem(this.key()) ?? 'null');
      const horizons = Array.isArray(raw?.horizons)
        ? parseHorizons(raw.horizons.join(','), this.max())
        : null;
      return {
        horizons: horizons ?? defaults.horizons,
        charges: typeof raw?.charges === 'boolean' ? raw.charges : true,
        projections: typeof raw?.projections === 'boolean' ? raw.projections : true,
      };
    } catch {
      return defaults;
    }
  });
  protected readonly projections = computed(() => {
    const workspace = this.store.workspace();
    if (!workspace || this.wealth() === null) return [];
    const input = visionInputOf(this.project(), workspace, visionSettings());
    const year = Number(workspace.today.slice(0, 4));
    return visionProjection(input)
      .years.filter((point) => this.preferences().horizons.includes(point.year - year))
      .map((point) => ({ ...point, offset: point.year - year }));
  });
  protected readonly exploreYears = signal(10);
  protected readonly exploration = computed(() => {
    const workspace = this.store.workspace();
    if (!workspace || this.wealth() === null) return null;
    const year = Number(workspace.today.slice(0, 4)) + this.exploreYears();
    return visionProjection(visionInputOf(this.project(), workspace, visionSettings())).years.find(p => p.year === year) ?? null;
  });
  protected explore(years: number | null): void {
    if (years !== null && Number.isInteger(years) && years >= 1 && years <= this.max()) this.exploreYears.set(years);
  }
  protected draftHorizons = '';
  protected draftCharges = true;
  protected draftProjections = true;
  constructor() {
    effect(() => {
      this.key();
      const max = this.max();
      untracked(() => { this.edit(); this.exploreYears.set(Math.min(10, max)); });
    });
  }
  protected readonly error = signal(false);
  protected readonly notice = signal('');
  protected prepare(event: Event) {
    if ((event.target as HTMLDetailsElement).open) this.edit();
  }
  private edit() {
    const p = this.preferences();
    this.draftHorizons = p.horizons.join(', ');
    this.draftCharges = p.charges;
    this.draftProjections = p.projections;
    this.error.set(false);
    this.notice.set('');
  }
  protected save() {
    const horizons = parseHorizons(this.draftHorizons, this.max());
    if (!horizons) {
      this.error.set(true);
      return;
    }
    const p = { horizons, charges: this.draftCharges, projections: this.draftProjections };
    this.transient.set(this.key(), p);
    try {
      localStorage.setItem(this.key(), JSON.stringify(p));
      this.notice.set(this.t('saved'));
    } catch {
      this.notice.set(this.t('sessionOnly'));
    }
    this.error.set(false);
    this.revision.update((n) => n + 1);
  }
  protected reset() {
    const p = this.defaults();
    this.draftHorizons = p.horizons.join(', ');
    this.draftCharges = p.charges;
    this.draftProjections = p.projections;
    this.save();
  }
  protected readonly money = formatMoney;
  protected t(key: string) {
    return pageText(P + key);
  }
  protected date(value: string) {
    return new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(value + 'T12:00:00Z'));
  }
  protected dateEnd(value: string) {
    return this.date(
      new Date(Date.parse(value + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10),
    );
  }
}
