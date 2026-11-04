import { HistoryFormat, HistoryPartition } from './bpm-dashboard-history.model';
import { BpmDashboardHistoryComponent, HistoryMeasure } from './bpm-dashboard-history.component';
import { BpmDashboardWealthComponent } from './bpm-dashboard-wealth.component';
import { BpmTourComponent } from './bpm-tour.component';
import { PeriodNavigationComponent } from '../shared/period-navigation.component';
import { BpmIncomeListComponent } from './bpm-income-list.component';
import { BpmPeriodExpensesComponent } from './bpm-period-expenses.component';
import { BpmProjectCostsComponent, bpmOwnerReference } from './bpm-project-costs.component';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { formatMoney } from '../shared/amount';
import { AppHeroComponent } from '../shared/app-hero.component';
import { MetricTile, MetricTilesComponent } from '../shared/metric-tiles.component';
import { pageText, registerPageTexts } from '../shared/page-text';
import { BpmContextComponent } from './bpm-context.component';
import { BpmGateComponent } from './bpm-gate.component';
import { lensWords } from './bpm-lens.model';
import { BpmMoneyContext } from './bpm-money-context';
import {
  BpmStatement,
  MoneyLine,
  cadenceOfWindow,
  expectedRest,
  moneyLines,
  moneySegments,
  perHundred,
  restState,
  shareBasis,
} from './bpm-money.model';
import { BpmPopoverComponent } from './bpm-popover.component';
import { BpmProjectSwitchComponent } from './bpm-project-switch.component';
import { BpmWorkspaceNavComponent } from './bpm-workspace-nav.component';
import { lastDayOf } from './bpm-lens.model';
import { periodLabel } from './bpm.model';

const P = 'content.pages.bpm.bpm-money.page.';
/** Textes du parcours de l'argent ; ils se personnalisent dans Configuration → Contenus. */
export const BPM_MONEY_TEXTS: Record<string, string> = {
  standardTitle: 'Budget standard de la période',
  standardLead: 'Retrouvez vos entrées, vos charges et vos projets.',
  standardAmount: 'Budget du projet de vie',
  standardDetails: 'Comprendre le budget du projet de vie',
  recurringIncome: 'Entrées récurrentes',
  oneTimeIncome: 'Entrées ponctuelles',
  periodIncome: 'Entrées de la période',
  periodExpenses: 'Charges de la période',
  incomeLead: 'Salaires, aides, dons, primes et autres entrées, ventilés par type.',
  incomePlanned: 'Total des entrées listées',
  expensePlanned: 'Total des charges listées',
  standardReading:
    'Ce budget est la somme des entrées prévues du projet de vie. Les trois listes ci-dessous incluent aussi vos autres projets personnels.',
  analysisTitle: 'Zoom sur les postes du projet de vie',
  kicker: 'Ma vision budgétaire',
  toolsLabel: 'Dans cette page',
  summaryShortcut: 'Synthèse',
  expenseRegister: 'Dépenses de la période',
  graphSettings: 'Régler le graphique',
  projectsShortcut: 'Projets',
  title: 'Tableau de bord',
  entryFlows: 'Ajouter une entrée ou une charge',
  incomeShortcut: 'Entrées',
  expenseShortcut: 'Charges',
  wealthShortcut: 'Patrimoine',
  incomeCount: '{count} entrée(s) · tous vos projets personnels',
  expenseCount: '{count} charge(s) · tous vos projets personnels',
  projectsTitle: 'Projets {owner}',
  projectsCount: '{count} projet(s) · {charges} charge(s), toutes dates',
  projectPeriodImpact: 'Charges de cette période',
  projectsHelp:
    'Ouvrez un projet pour voir toutes ses charges. Le total ci-dessus concerne seulement la période affichée.',
  noProjects: 'Aucun autre projet rattaché à votre projet de vie.',
  calculationTitle: 'Comprendre le calcul du reste',
  calculationIncome: 'Entrées reçues',
  calculationExpense: 'Dépenses réalisées',
  calculationPendingIncome: 'Entrées encore attendues',
  calculationPendingExpense: 'Charges encore prévues',
  calculationHelp:
    'Reçu − dépensé = reste à ce jour. Ajoutez ce qui reste à recevoir et retirez les charges à venir pour obtenir le solde prévu à la clôture. Le réalisé suit la date réelle ; les listes suivent la date prévue.',
  pilotShortcut: 'Voir les graphiques',
  historyShortcut: '6 périodes',
  loading: 'Lecture du relevé…',
  empty: 'Aucun flux réalisé : ajoutez vos entrées et charges.',
  waiting: 'Début le {date} : préparez vos flux.',
  waitingAction: 'Préparer mon budget type',
  emptyTitle: 'Votre budget et votre patrimoine, enfin réunis',
  emptyIntro: 'Créez un projet pour suivre le parcours de chaque euro reçu.',
  emptyAction: 'Créer mon premier projet',
  leadOpen: 'Reçu, dépensé, disponible.',
  leadLoose: ' {count} dépense(s) restent à préciser.',
  leadClosed: 'Période clôturée : son solde a rejoint votre patrimoine.',
  chipReceived: 'Reçu',
  chipSpent: 'Dépensé',
  chipRest: 'Reste',
  previous: 'Période précédente',
  next: 'Période suivante',
  current: 'Revenir à la période en cours',
  currentCompact: 'Revenir',
  closedBadge: 'Clôturée',
  periodNav: 'Changer de période',
  zoneState: 'État des lieux',
  zoneStateLead:
    'Chaque euro reçu, suivi jusqu’à son poste de dépense ou jusqu’à votre patrimoine. Ouvrez une ligne pour la creuser.',
  zoneAct: 'Préciser',
  zoneActLead: 'Rendre compte du moindre centime : affecter, annoter, compléter ce qui manque.',
  tiles: 'Chiffres clés du relevé',
  overviewTitle: 'Votre argent, cette période',
  overviewHelp: 'Le réalisé aujourd’hui, la prévision à la clôture.',
  overviewAction: 'Ajouter une entrée ou une charge',
  tileIncome: 'Reçu',
  tileIncomeHelp: 'Reçu sur la période.',
  tileExpense: 'Dépensé',
  tileExpenseHelp: 'Payé sur la période.',
  tileIncomePending: 'À recevoir',
  tileExpensePending: 'À payer',
  tilePeriodExpected: 'Total de la période',
  tileExpectedRest: 'Solde prévu à la clôture',
  tileFinalRest: 'Solde clôturé',
  tileClosureDate: 'Clôture le',
  tileClosureControl: 'Prévision',
  tileBalanced: '✓ Sans déficit prévu',
  tileUnbalanced: 'Déficit prévu',
  tileAvailableControl: 'Reste après les charges à venir',
  tileCalculation: 'Voir le calcul',
  tileCharges: 'Voir les charges',
  tileRest: 'Reste',
  tileRestSaved: 'Le solde de clôture rejoindra votre patrimoine.',
  tileRestDrawn: 'Pris sur votre patrimoine à la clôture.',
  tileRestPending: 'Provisoire : les entrées attendues le compensent (attendu {expected}).',
  tileRestShort: 'À ce jour ; attendu {expected} à la fin de la période.',
  tileLoose: 'À préciser',
  tileLooseHelp: 'Dépenses sans poste : ouvrez-les pour dire où est allé l’argent.',
  tileLooseNone: 'Chaque dépense a son poste.',
  flowTitle: 'Le parcours de chaque euro',
  flowLegend:
    'La barre représente tout l’argent qui a circulé ; chaque couleur est un poste, la dernière part est ce qui reste.',
  perHundred: 'Sur 100 € reçus',
  perHundredSpent: 'Sur 100 € dépensés',
  perHundredSpentHelp:
    'Les dépenses dépassent encore les entrées reçues : les parts se lisent sur ce qui a été dépensé.',
  perHundredRest: 'restent',
  perHundredDrawn: 'pris sur le patrimoine',
  statementTitle: 'Le relevé, ligne par ligne',
  statementHelp: 'Ouvrez une ligne pour retrouver ses opérations.',
  lineIncome: 'Entrées reçues',
  lineLoose: 'Dépenses à préciser',
  lineRestSaved: 'Reste versé au patrimoine',
  lineRestDrawn: 'Pris sur le patrimoine',
  lineRestOpen: 'Reste à ce jour',
  lineCount: 'montant(s)',
  lineNotes: 'note(s)',
  linePlannedIn: 'attendus',
  linePlannedOut: 'encore prévus',
  lineShare: 'des entrées',
  lineShareSpent: 'des dépenses',
  lineOf: 'dont',
  lineLimit: 'plafond',
  lineOpen: 'Voir le détail',
  restClosed: 'Clôturée · patrimoine après la clôture : {amount}',
  restOpen: 'Fin de période le {date} · attendu {expected} si tout le prévu se réalise',
  restHow: 'Comment le reste rejoint le patrimoine',
  restHowText:
    'À la clôture, le service additionne les entrées reçues et retire les sorties payées : ce solde rejoint votre patrimoine (ou en est retiré s’il est négatif). Les entrées et dépenses approuvées comptent automatiquement à leur échéance.',
  actLoose: '{count} dépense(s) sans poste, soit {amount} : dites où est allé cet argent.',
  actLooseOpen: 'Préciser les dépenses',
  actLooseDone: 'Chaque dépense de la période a son poste.',
  actCheck:
    'Votre compte affiche un autre montant ? Comparez-le au reste calculé pour retrouver ce qui manque.',
  actCheckOpen: 'Vérifier avec mon compte',
  actIncome:
    'Une entrée manque (remboursement, vente, don) ? Ajoutez-la depuis le détail des entrées.',
  actIncomeOpen: 'Ouvrir les entrées',
  actDue:
    '{count} échéance(s) arrivée(s), soit {amount}, attendent d’être enregistrées : elles entreront dans ce relevé une fois confirmées.',
  actDueOpen: 'Consulter les échéances',
};
registerPageTexts(
  Object.fromEntries(Object.entries(BPM_MONEY_TEXTS).map(([key, value]) => [P + key, value])),
);

const long = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/**
 * Le parcours de l'argent, première couche : à plat, ce qui est entré, où c'est
 * allé poste par poste, ce qui reste à préciser et ce qui rejoint le patrimoine.
 * Chaque ligne ne montre que des rappels (sommes détaillées, notes) et s'ouvre sur
 * sa page dédiée, qui sert à creuser et préciser, puis ramène ici.
 */
@Component({
  selector: 'rjs-bpm-money-page',
  imports: [
    BpmDashboardHistoryComponent,
    BpmDashboardWealthComponent,
    BpmTourComponent,
    PeriodNavigationComponent,
    BpmIncomeListComponent,
    BpmPeriodExpensesComponent,
    BpmProjectCostsComponent,
    BpmContextComponent,
    AppHeroComponent,
    BpmGateComponent,
    BpmPopoverComponent,
    BpmProjectSwitchComponent,
    BpmWorkspaceNavComponent,
    MetricTilesComponent,
    RouterLink,
  ],
  providers: [BpmMoneyContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./bpm-pages.scss', './bpm-money.scss'],
  template: `
    <div class="page bpm-reading bpm-app bpm-money" data-tone="budget">
      <rjs-bpm-gate suite="/budget-patrimoine-management/tableau-de-bord" />
      @if (!ctx.store.workspace()) {
      } @else if (!ctx.project()) {
        <rjs-app-hero
          toolsLabel="Actions"
          tone="aurora"
          headingId="bm-empty-title"
          [kicker]="t('kicker')"
          [title]="t('emptyTitle')"
          [lead]="t('emptyIntro')"
          [actions]="[
            { label: t('emptyAction') + ' →', link: '/budget-patrimoine-management/creer' },
          ]"
        ></rjs-app-hero>
      } @else {
        @let p = ctx.project()!;
        <rjs-app-hero
          toolsLabel="Actions"
          data-tour="hero"
          tone="lagoon"
          headingId="bm-title"
          [kicker]="t('kicker')"
          [title]="t('title')"
          [lead]="lead()"
        >
          <rjs-bpm-workspace-nav heroGuide [project]="p" active="dashboard" />
          <rjs-bpm-tour
            heroGuide
            [inline]="true"
            page="dashboard"
            [steps]="['hero', 'tiles', 'wealth', 'budget']" />
          @if (ctx.manages()) {
            <a
              heroActions
              class="app-hero-action"
              routerLink="/budget-patrimoine-management/piloter/agir"
              [queryParams]="{ projet: p.id }"
              fragment="saisie-des-flux"
              >＋ {{ t('entryFlows') }}</a
            >
          }
          <rjs-bpm-project-switch
            heroMeta
            [embedded]="true"
            [projects]="ctx.projects()"
            [current]="p.id" />
          <rjs-bpm-context heroMetaWide [scopeOnly]="true" [compact]="true" [embedded]="true" />
          @if (ctx.manages()) {
            <a
              heroActions
              class="bpm-link"
              routerLink="/budget-patrimoine-management/depenses"
              [queryParams]="ctx.query()"
              >{{ t('expenseRegister') }} →</a
            >
          }
          <nav heroPageTools [attr.aria-label]="t('toolsLabel')">
            <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bm-key-figures">{{
              t('summaryShortcut')
            }}</a>
            <a
              [routerLink]="[]"
              queryParamsHandling="preserve"
              fragment="bm-period-income"
              (click)="reveal('income')"
              >{{ t('incomeShortcut') }}</a
            >
            <a
              [routerLink]="[]"
              queryParamsHandling="preserve"
              fragment="bm-period-expenses"
              (click)="reveal('expense')"
              >{{ t('expenseShortcut') }}</a
            >
            <a
              [routerLink]="[]"
              queryParamsHandling="preserve"
              fragment="bm-projects"
              (click)="reveal('projects')"
              >{{ t('projectsShortcut') }}</a
            >
            <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bm-wealth">{{
              t('wealthShortcut')
            }}</a>
            <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bm-history">{{
              t('historyShortcut')
            }}</a>
            <a
              [routerLink]="[]"
              queryParamsHandling="preserve"
              fragment="bm-history-settings-title"
              >{{ t('graphSettings') }}</a
            >
          </nav>
          <div heroFooter>
            @if (ctx.window(); as w) {
              <rjs-period-navigation
                [start]="w.start"
                [end]="w.end"
                [label]="t('periodNav')"
                [previousLabel]="t('previous')"
                [nextLabel]="t('next')"
                [currentLabel]="t('current')"
                [compactCurrentLabel]="t('currentCompact')"
                [previousQuery]="ctx.shifted(-1)"
                [nextQuery]="ctx.shifted(1)"
                [currentQuery]="ctx.current()"
                [status]="ctx.statement()?.closed ? t('closedBadge') : ''"
              />
            }</div
        ></rjs-app-hero>
        @if (ctx.statement()) {
          <section
            id="bm-key-figures"
            data-tour="tiles"
            class="bm-key-figures"
            data-bpm-frame="metrics"
            [attr.aria-label]="t('tiles')"
            data-ui-pattern="panel"
          >
            <header class="bm-overview-heading">
              <div>
                <span class="bm-section-kicker">{{ label() }}</span>
                <h2>{{ t('overviewTitle') }}</h2>
                <p>{{ t('overviewHelp') }}</p>
              </div>
            </header>
            <rjs-metric-tiles
              variant="instrument"
              layout="last-wide"
              [label]="t('tiles')"
              [tiles]="tiles()"
              (fragmentSelected)="revealFragment($event)"
            />
            @if (summary(); as total) {
              <details
                id="bm-calculation"
                class="bm-calculation"
                [open]="calculationOpen()"
                (toggle)="calculationOpen.set($any($event.target).open)"
              >
                <summary>{{ t('calculationTitle') }}</summary>
                <div class="record-details">
                  <p>{{ t('calculationHelp') }}</p>
                  <dl class="record-facts">
                    <div>
                      <dt>↑ {{ t('calculationIncome') }}</dt>
                      <dd>{{ money(total.incomeCents) }}</dd>
                    </div>
                    <div>
                      <dt>↓ {{ t('calculationExpense') }}</dt>
                      <dd>{{ money(total.expenseCents) }}</dd>
                    </div>
                    <div>
                      <dt>↑ {{ t('calculationPendingIncome') }}</dt>
                      <dd>{{ money(total.remainingIncomeCents) }}</dd>
                    </div>
                    <div>
                      <dt>↓ {{ t('calculationPendingExpense') }}</dt>
                      <dd>{{ money(total.remainingExpenseCents) }}</dd>
                    </div>
                    <div>
                      <dt>= {{ t('tileRest') }}</dt>
                      <dd>{{ signed(total.netCents) }}</dd>
                    </div>
                    <div>
                      <dt>{{ t('tileExpectedRest') }}</dt>
                      <dd>{{ signed(expectedRest(total)) }}</dd>
                    </div>
                  </dl>
                  <a
                    class="bpm-link"
                    routerLink="/budget-patrimoine-management/piloter"
                    [queryParams]="{ projet: p.id, lecture: total.start }"
                    >{{ t('pilotShortcut') }} →</a
                  >
                </div>
              </details>
            }
            @if (ctx.statement()?.flowPilot; as flow) {
              <rjs-bpm-dashboard-wealth
                id="bm-wealth"
                data-tour="wealth"
                [data]="flow"
                [project]="p"
              />
            }
          </section>
        }

        @if (ctx.statement(); as s) {
          @let lines = rows();
          <section
            class="bm-budget-frame"
            data-tour="budget"
            aria-labelledby="bm-budget-title"
            data-ui-pattern="panel"
          >
            <header class="bm-budget-heading" data-ui-pattern="section-heading">
              <div>
                <span class="bm-section-kicker">{{ label() }}</span>
                <h2 id="bm-budget-title">{{ t('standardTitle') }}</h2>
                <p>{{ t('standardLead') }}</p>
              </div>
              <div class="bm-budget-total">
                <small>{{ t('standardAmount') }}</small
                ><strong
                  ><span aria-hidden="true">↑</span> {{ money(s.funding?.totalCents ?? 0) }}</strong
                >
              </div>
            </header>
            <div class="bm-budget-content">
              <details class="bm-standard-details">
                <summary>{{ t('standardDetails') }}</summary>
                <p class="bpm-help">{{ t('standardReading') }}</p>
                <dl class="bm-funding-split">
                  <div>
                    <dt>{{ t('recurringIncome') }}</dt>
                    <dd>{{ money(s.funding?.recurringCents ?? 0) }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('oneTimeIncome') }}</dt>
                    <dd>{{ money(s.funding?.oneTimeCents ?? 0) }}</dd>
                  </div>
                </dl>
              </details>
              <details
                id="bm-period-income"
                class="bm-period-section is-income"
                [open]="incomeOpen()"
                (toggle)="incomeOpen.set($any($event.target).open)"
              >
                <summary class="bm-period-heading" data-ui-pattern="section-heading">
                  <span class="bm-section-mark" aria-hidden="true">↑</span>
                  <div>
                    <h3>{{ t('periodIncome') }}</h3>
                    <p>
                      {{
                        fill('incomeCount', {
                          count: String(s.periodFlows?.income?.rows?.length ?? 0),
                        })
                      }}
                    </p>
                  </div>
                  <div class="bm-section-total">
                    <small>{{ t('incomePlanned') }}</small
                    ><strong>{{ money(periodTotal('income')) }}</strong>
                  </div>
                  <span class="bm-section-cue" aria-hidden="true">⌄</span>
                </summary>
                <rjs-bpm-income-list
                  [data]="s.periodFlows?.income ?? null"
                  [start]="s.start"
                  [end]="s.end"
                  [detailed]="false"
                  [groupByType]="true"
                  [collapsible]="true"
                  [nested]="true"
                />
              </details>
              <details
                id="bm-period-expenses"
                class="bm-period-section is-expense"
                [open]="expenseOpen()"
                (toggle)="expenseOpen.set($any($event.target).open)"
              >
                <summary class="bm-period-heading" data-ui-pattern="section-heading">
                  <span class="bm-section-mark" aria-hidden="true">↓</span>
                  <div>
                    <h3>{{ t('periodExpenses') }}</h3>
                    <p>
                      {{
                        fill('expenseCount', {
                          count: String(s.periodFlows?.expense?.rows?.length ?? 0),
                        })
                      }}
                    </p>
                  </div>
                  <div class="bm-section-total">
                    <small>{{ t('expensePlanned') }}</small
                    ><strong>{{ money(periodTotal('expense')) }}</strong>
                  </div>
                  <span class="bm-section-cue" aria-hidden="true">⌄</span>
                </summary>
                <rjs-bpm-period-expenses
                  [data]="s.periodFlows?.expense ?? null"
                  [projectId]="p.id"
                  [start]="s.start"
                  [end]="s.end"
                />
                <details class="bpm-disclosure bm-reading-analysis">
                  <summary>{{ t('analysisTitle') }}</summary>
                  <div class="bpm-disclosure-body">
                    @if (s.start > s.today) {
                      <p class="bm-empty">
                        {{ lead() }}
                        @if (ctx.manages()) {
                          <a
                            class="bm-action-link"
                            routerLink="/budget-patrimoine-management/piloter/agir"
                            [queryParams]="{ projet: p.id }"
                            fragment="mois-type"
                            >{{ t('waitingAction') }} →</a
                          >
                        }
                      </p>
                    } @else if (!s.entries.length) {
                      <p class="bm-empty">{{ t('empty') }}</p>
                    } @else {
                      <details
                        class="bpm-disclosure bm-flow"
                        aria-labelledby="bm-flow-title"
                        data-ui-pattern="panel"
                      >
                        <summary>
                          <h3 id="bm-flow-title">{{ t('flowTitle') }}</h3>
                        </summary>
                        <div class="bpm-disclosure-body">
                          <div class="bm-flow-bar" role="img" [attr.aria-label]="flowLabel()">
                            @for (segment of segments(); track segment.nature + segment.id) {
                              <span
                                [attr.data-nature]="segment.nature"
                                [attr.data-index]="$index % 8"
                                [style.width.%]="segment.pct"
                                [attr.title]="
                                  segmentName(segment.nature, segment.name) +
                                  ' · ' +
                                  money(segment.cents)
                                "
                              ></span>
                            }
                          </div>
                          <p class="bpm-help">{{ t('flowLegend') }}</p>
                          @if (hundred().parts.length) {
                            <p class="bm-hundred">
                              <strong
                                >{{
                                  t(hundred().basis === 'income' ? 'perHundred' : 'perHundredSpent')
                                }}
                                :</strong
                              >
                              @for (part of hundred().parts; track part.nature + part.id) {
                                <span [attr.data-nature]="part.nature"
                                  >{{ euros(part.euros) }}
                                  {{
                                    part.nature === 'reste'
                                      ? part.euros >= 0
                                        ? t('perHundredRest')
                                        : t('perHundredDrawn')
                                      : segmentName(part.nature, part.name)
                                  }}</span
                                >
                              }
                            </p>
                            @if (hundred().basis === 'expense') {
                              <p class="bpm-help">{{ t('perHundredSpentHelp') }}</p>
                            }
                          }
                        </div>
                      </details>
                    }

                    <section
                      class="bm-statement"
                      aria-labelledby="bm-statement-title"
                      data-ui-pattern="panel"
                    >
                      <header class="bm-statement-head">
                        <h3 id="bm-statement-title">{{ t('statementTitle') }}</h3>
                        <p class="bpm-help">{{ t('statementHelp') }}</p>
                      </header>
                      <ol class="bm-lines">
                        <li>
                          <a
                            class="bm-line"
                            data-nature="entrees"
                            routerLink="/budget-patrimoine-management/argent/entrees"
                            [queryParams]="ctx.query()"
                          >
                            <span class="bm-line-sign" aria-hidden="true">↑</span>
                            <span class="bm-line-main">
                              <strong>{{ t('lineIncome') }}</strong>
                              <small>{{ reminders(lines.income) }}</small>
                            </span>
                            <span class="bm-line-amount">{{ money(lines.income.cents) }}</span>
                            <span class="bm-line-open">{{ t('lineOpen') }} →</span>
                          </a>
                        </li>
                        @for (line of lines.outflows; track line.nature + line.id; let i = $index) {
                          <li>
                            <a
                              class="bm-line"
                              [attr.data-nature]="line.nature"
                              [attr.data-index]="i % 8"
                              [routerLink]="lineLink(line)"
                              [queryParams]="ctx.query()"
                            >
                              <span class="bm-line-sign" aria-hidden="true">↓</span>
                              <span class="bm-line-main">
                                <strong>{{ segmentName(line.nature, line.name) }}</strong>
                                <small>{{ reminders(line) }}</small>
                                @if (line.shareOfIncome !== null && line.cents > 0) {
                                  <span class="bm-line-share" aria-hidden="true"
                                    ><span
                                      [style.width.%]="Math.min(line.shareOfIncome, 100)"
                                    ></span
                                  ></span>
                                }
                              </span>
                              <span class="bm-line-amount">{{ money(line.cents) }}</span>
                              <span class="bm-line-open">{{ t('lineOpen') }} →</span>
                            </a>
                          </li>
                        }
                        <li>
                          <a
                            class="bm-line bm-line-total"
                            data-nature="reste"
                            [attr.data-sign]="lines.rest.cents < 0 ? 'negative' : 'positive'"
                            id="bm-remaining"
                            routerLink="/budget-patrimoine-management/argent/reste"
                            [queryParams]="ctx.query()"
                          >
                            <span class="bm-line-sign" aria-hidden="true">=</span>
                            <span class="bm-line-main">
                              <strong>{{ restLabel() }}</strong>
                              <small>{{ restReminder() }}</small>
                            </span>
                            <span class="bm-line-amount">{{ signed(lines.rest.cents) }}</span>
                            <span class="bm-line-open">{{ t('lineOpen') }} →</span>
                          </a>
                        </li>
                      </ol>
                      <div class="bm-statement-foot">
                        <rjs-bpm-popover icon="?" [label]="t('restHow')" [title]="t('restHow')">
                          <p>{{ t('restHowText') }}</p>
                        </rjs-bpm-popover>
                      </div>
                    </section>
                  </div>
                </details>
              </details>
              @if (ctx.window(); as w) {
                <details
                  id="bm-projects"
                  class="bm-period-section is-projects"
                  [open]="projectsOpen()"
                  (toggle)="projectsOpen.set($any($event.target).open)"
                >
                  <summary class="bm-period-heading" data-ui-pattern="section-heading">
                    <span class="bm-section-mark" aria-hidden="true">◇</span>
                    <div>
                      <h3>{{ projectsTitle() }}</h3>
                      <p>
                        {{
                          fill('projectsCount', {
                            count: String(otherProjects().length),
                            charges: String(projectChargeCount()),
                          })
                        }}
                      </p>
                    </div>
                    <div class="bm-section-total">
                      <small>{{ t('projectPeriodImpact') }}</small
                      ><strong>{{ money(projectPeriodTotal()) }}</strong>
                    </div>
                    <span class="bm-section-cue" aria-hidden="true">⌄</span>
                  </summary>
                  <p class="bm-projects-help">{{ t('projectsHelp') }}</p>
                  @if (otherProjects().length) {
                    <rjs-bpm-project-costs
                      [showHeading]="false"
                      [allowDetach]="true"
                      [project]="p"
                      [costs]="projectCosts()"
                      [start]="w.start"
                      [end]="w.end"
                      [showPeriod]="false"
                      [prominent]="true"
                    />
                  } @else {
                    <p class="bm-projects-help">{{ t('noProjects') }}</p>
                  }
                </details>
              }
            </div>
          </section>
          <rjs-bpm-dashboard-history
            id="bm-history"
            [statement]="s"
            [projectId]="p.id"
            [selectedMeasures]="historyMeasures()"
            (selectedMeasuresChange)="historyMeasures.set($event)"
            [chartFormat]="historyChartFormat()"
            (chartFormatChange)="historyChartFormat.set($event)"
            [chartPartition]="historyChartPartition()"
            (chartPartitionChange)="historyChartPartition.set($event)"
            [chartHeight]="historyChartHeight()"
            (chartHeightChange)="historyChartHeight.set($event)"
            [chartPeriods]="historyChartPeriods()"
            (chartPeriodsChange)="historyChartPeriods.set($event)"
            [barMeasures]="historyBarMeasures()"
            (barMeasuresChange)="historyBarMeasures.set($event)"
            [showBars]="historyBars()"
            (showBarsChange)="historyBars.set($event)"
          />
        } @else {
          <p class="bm-empty" role="status">{{ t('loading') }}</p>
        }
      }
    </div>
  `,
})
export class BpmMoneyPage {
  protected readonly historyMeasures = signal<HistoryMeasure[]>(['net']);
  protected readonly historyBars = signal(true);
  protected readonly historyChartFormat = signal<HistoryFormat | null>(null);
  protected readonly historyChartPartition = signal<HistoryPartition | null>(null);
  protected readonly historyChartHeight = signal<number | null>(null);
  protected readonly historyChartPeriods = signal<number | null>(null);
  protected readonly historyBarMeasures = signal<HistoryMeasure[]>(['income', 'expense']);
  protected readonly incomeOpen = signal(false);
  protected readonly expenseOpen = signal(false);
  protected readonly projectsOpen = signal(false);
  protected readonly calculationOpen = signal(false);
  private readonly fragment = toSignal(inject(ActivatedRoute).fragment);
  protected readonly expectedRest = expectedRest;
  protected readonly summary = computed<BpmStatement | null>(() => {
    const s = this.ctx.statement(),
      f = s?.flowPilot;
    if (!s || !f) return s;
    return {
      ...s,
      incomeCents: f.incomeCents,
      expenseCents: f.expenseCents,
      netCents: f.netCents,
      remainingIncomeCents: f.expectedIncomeCents - f.incomeCents,
      remainingExpenseCents: f.expectedExpenseCents - f.expenseCents,
      closed:
        s.closed &&
        !(
          s.periodFlows?.income.rows.some((r) => !r.closed) ||
          s.periodFlows?.expense.rows.some((r) => !r.closed)
        ),
    };
  });
  protected reveal(section: 'income' | 'expense' | 'projects' | 'calculation') {
    ({
      income: this.incomeOpen,
      expense: this.expenseOpen,
      projects: this.projectsOpen,
      calculation: this.calculationOpen,
    })[section].set(true);
  }
  protected revealFragment(fragment: string | null | undefined) {
    if (fragment === 'bm-period-income') this.reveal('income');
    if (fragment === 'bm-period-expenses') this.reveal('expense');
    if (fragment === 'bm-projects') this.reveal('projects');
    if (fragment === 'bm-calculation') this.reveal('calculation');
  }
  constructor() {
    effect(() => this.revealFragment(this.fragment()));
  }
  protected readonly otherProjects = computed(() => this.projectCosts().filter((b) => !b.standard));
  protected readonly projectsTitle = computed(() =>
    this.fill('projectsTitle', { owner: bpmOwnerReference(this.ctx.project()!) }),
  );
  protected readonly projectChargeCount = computed(() =>
    this.otherProjects().reduce((sum, b) => sum + b.charges.length, 0),
  );
  protected readonly projectPeriodTotal = computed(() =>
    this.otherProjects().reduce((sum, b) => sum + b.forecastExpenseCents, 0),
  );

  protected periodTotal(kind: 'income' | 'expense') {
    return (this.ctx.statement()?.periodFlows?.[kind].rows ?? []).reduce(
      (sum, row) => sum + row.amountCents,
      0,
    );
  }
  protected readonly projectCosts = computed(() => this.ctx.statement()?.budgetProjects ?? []);
  protected readonly ctx = inject(BpmMoneyContext);
  protected readonly Math = Math;
  protected readonly String = String;
  protected readonly money = formatMoney;
  protected readonly rows = computed(() => {
    const s = this.ctx.statement();
    return s ? moneyLines(s) : { income: null!, outflows: [], rest: null! };
  });
  protected readonly segments = computed(() => {
    const s = this.ctx.statement();
    return s ? moneySegments(s) : [];
  });
  protected readonly hundred = computed(() => {
    const s = this.ctx.statement();
    return s ? perHundred(s) : { basis: 'income' as const, parts: [] };
  });
  /** Les échéances arrivées et pas encore enregistrées : l'argent qu'il reste à faire entrer dans le relevé. */
  protected readonly due = computed(() => {
    const s = this.ctx.statement();
    return s ? s.pending.filter((item) => item.occurrenceDate <= s.today) : [];
  });
  protected readonly dueTotal = computed(() =>
    this.due().reduce((sum, item) => sum + item.amountCents, 0),
  );
  protected readonly looseLine = computed(
    () => this.rows().outflows.find((line) => line.nature === 'a-preciser' && line.count) ?? null,
  );
  /** L'intitulé de la fenêtre : « octobre 2026 », « semaine du 19 octobre », « année 2026 ». */
  protected readonly label = computed(() => {
    const w = this.ctx.window();
    if (!w) return '';
    // « Octobre 2026 », « Semaine du 19 octobre » : seule la première lettre prend la capitale.
    const text = periodLabel(w.start, cadenceOfWindow(w.start, w.end), lensWords());
    return text.charAt(0).toLocaleUpperCase('fr') + text.slice(1);
  });
  protected readonly lead = computed(() => {
    const s = this.summary();
    if (!s) return this.t('loading');
    if (s.closed) return this.t('leadClosed');
    if (s.start > s.today)
      return this.fill('waiting', { date: long.format(new Date(`${s.start}T12:00:00Z`)) });
    if (!s.entries.length) return this.t('empty');
    // La phrase du bandeau oriente ; les montants restent dans la lecture de la période, sans doublon.
    const loose = this.looseLine();
    return (
      this.t('leadOpen') + (loose ? this.fill('leadLoose', { count: String(loose.count) }) : '')
    );
  });
  protected readonly tiles = computed<MetricTile[]>(() => {
    const s = this.summary();
    if (!s) return [];
    const query = this.ctx.query() as Record<string, string>;
    const clean = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== null));
    return [
      {
        id: 'income',
        symbol: 'income',
        detailsPlacement: 'between',
        label: this.t('tileIncome'),
        value: formatMoney(s.incomeCents),
        tone: 'success',
        details: [
          {
            label: this.t('tileIncomePending'),
            value: formatMoney(s.remainingIncomeCents),
            tone: 'success',
          },
          {
            label: this.t('tilePeriodExpected'),
            value: formatMoney(s.incomeCents + s.remainingIncomeCents),
          },
        ],
        note: this.t('tileIncomeHelp'),
        link: '/budget-patrimoine-management/tableau-de-bord',
        fragment: 'bm-period-income',
        query: clean,
      },
      {
        id: 'expense',
        symbol: 'expense',
        detailsPlacement: 'between',
        label: this.t('tileExpense'),
        value: formatMoney(s.expenseCents),
        tone: 'danger',
        details: [
          {
            label: this.t('tileExpensePending'),
            value: formatMoney(s.remainingExpenseCents),
            tone: 'warning',
          },
          {
            label: this.t('tilePeriodExpected'),
            value: formatMoney(s.expenseCents + s.remainingExpenseCents),
          },
        ],
        note: this.t('tileExpenseHelp'),
        link: '/budget-patrimoine-management/depenses',
        query: clean,
      },
      {
        id: 'rest',
        symbol: 'balance',
        detailsPlacement: 'aside',
        checks: [
          {
            label: this.t('tileClosureControl'),
            value: this.t(expectedRest(s) >= 0 ? 'tileBalanced' : 'tileUnbalanced'),
            tone: expectedRest(s) >= 0 ? 'success' : 'danger',
          },
          {
            label: this.t('tileAvailableControl'),
            value: this.signed(s.netCents - s.remainingExpenseCents),
            tone: s.netCents - s.remainingExpenseCents >= 0 ? 'success' : 'warning',
          },
        ],
        actions: [
          {
            label: this.t('tileCalculation'),
            link: '/budget-patrimoine-management/tableau-de-bord',
            fragment: 'bm-calculation',
            query: clean,
          },
          {
            label: this.t('tileCharges'),
            link: '/budget-patrimoine-management/depenses',
            query: clean,
          },
        ],
        label: this.t('tileRest'),
        value: this.signed(s.netCents),
        tone: (() => {
          const state = restState(s);
          return state === 'drawn' || state === 'short'
            ? 'danger'
            : state === 'pending'
              ? 'warning'
              : s.netCents > 0
                ? 'success'
                : null;
        })(),
        emphasis: true,
        details: [
          {
            label: this.t(s.closed ? 'tileFinalRest' : 'tileExpectedRest'),
            value: this.signed(expectedRest(s)),
            tone: expectedRest(s) < 0 ? 'danger' : 'success',
          },
          {
            label: this.t('tileClosureDate'),
            value: long.format(new Date(`${lastDayOf(s.end)}T12:00:00Z`)),
          },
        ],
        note: this.fill(
          {
            saved: 'tileRestSaved',
            drawn: 'tileRestDrawn',
            pending: 'tileRestPending',
            short: 'tileRestShort',
          }[restState(s)],
          { expected: this.signed(expectedRest(s)) },
        ),
        link: '/budget-patrimoine-management/tableau-de-bord',
        fragment: 'bm-calculation',
        query: clean,
      },
    ];
  });
  /** Le nom du reste : définitif une fois clos, « à ce jour » tant que la période est ouverte. */
  protected readonly restLabel = computed(() => {
    const s = this.ctx.statement();
    if (!s) return '';
    // Tant que la période est ouverte, le reste n'est qu'un état du jour : il ne devient définitif qu'à la clôture.
    if (!s.closed) return this.t('lineRestOpen');
    return s.netCents < 0 ? this.t('lineRestDrawn') : this.t('lineRestSaved');
  });
  protected readonly flowLabel = computed(() =>
    this.segments()
      .map((segment) => `${this.segmentName(segment.nature, segment.name)} ${segment.pct} %`)
      .join(', '),
  );

  protected t(key: string): string {
    return pageText(P + key);
  }
  protected fill(key: string, values: Record<string, string>): string {
    return Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, value),
      this.t(key),
    );
  }
  protected segmentName(nature: string, name: string): string {
    return nature === 'a-preciser'
      ? this.t('lineLoose')
      : nature === 'reste'
        ? this.t('lineRestSaved')
        : nature === 'entrees'
          ? this.t('lineIncome')
          : name;
  }
  protected lineLink(line: MoneyLine): string {
    return line.nature === 'poste'
      ? `/budget-patrimoine-management/argent/postes/${line.id}`
      : `/budget-patrimoine-management/argent/${line.nature}`;
  }
  /** Les rappels d'une ligne : nombre de montants, sommes détaillées, notes, prévu. */
  protected reminders(line: MoneyLine): string {
    const parts: string[] = [];
    if (line.count) parts.push(`${line.count} ${this.t('lineCount')}`);
    if (line.top.length && line.nature !== 'reste')
      parts.push(
        `${this.t('lineOf')} ${line.top.map((sum) => `${sum.title} ${formatMoney(sum.cents)}`).join(', ')}`,
      );
    if (line.notes) parts.push(`${line.notes} ${this.t('lineNotes')}`);
    if (line.plannedCents > 0)
      parts.push(
        `+ ${formatMoney(line.plannedCents)} ${line.nature === 'entrees' ? this.t('linePlannedIn') : this.t('linePlannedOut')}`,
      );
    const s = this.ctx.statement();
    if (line.shareOfIncome !== null && line.nature === 'poste' && line.cents > 0 && s)
      parts.push(
        `${String(line.shareOfIncome).replace('.', ',')} % ${this.t(shareBasis(s) === 'income' ? 'lineShare' : 'lineShareSpent')}`,
      );
    if (line.limitCents !== null)
      parts.push(`${this.t('lineLimit')} ${formatMoney(line.limitCents)}`);
    return parts.join(' · ');
  }
  protected restReminder(): string {
    const w = this.ctx.window();
    const s = this.ctx.statement();
    if (!w || !s) return '';
    const end = long.format(new Date(`${lastDayOf(w.end)}T12:00:00Z`));
    if (s.closure?.patrimoineAfterCents != null)
      return this.fill('restClosed', { amount: formatMoney(s.closure.patrimoineAfterCents) });
    if (s.closed) return this.t('closedBadge');
    const expected = s.netCents + s.remainingIncomeCents - s.remainingExpenseCents;
    return this.fill('restOpen', { date: end, expected: this.signed(expected) });
  }
  protected euros(value: number): string {
    return `${value} €`;
  }
  protected signed(cents: number): string {
    return (cents > 0 ? '+' : cents < 0 ? '−' : '') + formatMoney(Math.abs(cents));
  }
}
