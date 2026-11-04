import { BpmFlowPilotComponent } from './bpm-flow-pilot.component';
import { BpmFlowEditorComponent } from './bpm-flow-editor.component';
import { BpmPeriodNavComponent } from './bpm-period-nav.component';
import { BpmPeriodReading } from './bpm-period-reading';
import { ExpandedReadingDirective } from '../shared/expanded-reading.directive';
import { BpmFundingComponent } from './bpm-funding.component';
import { expensePeriodQuery } from './bpm-expense-links';
import { RangeFieldComponent } from '../shared/range-field.component';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { formatMoney, parseAmount, parseSignedAmount } from '../shared/amount';
import { AppHeroComponent, HeroChip } from '../shared/app-hero.component';
import { MetricTile, MetricTilesComponent } from '../shared/metric-tiles.component';
import { pageText, registerPageTexts } from '../shared/page-text';
import { siteSetting } from '../shared/site-settings';
import { UserSession } from '../utilisateurs/utilisateurs.contract';
import {
  BpmFlow,
  BpmPendingFlow,
  BpmProject,
  bpmTools,
  periodLabel,
  periodMark,
} from './bpm.model';
import {
  cycleOf,
  fromLens,
  lastDayOf,
  lensBars,
  lensDirectives,
  lensProfile,
  lensViewOf,
  lensWord,
  provisionInLens,
  toLens,
} from './bpm-lens.model';
import { PeriodLensService } from '../shared/period-lens';
import { BpmProjectSwitchComponent } from './bpm-project-switch.component';
import { BpmCapExplainComponent } from './bpm-cap-explain.component';
import { BpmStore } from './bpm.store';
import { BpmContextComponent } from './bpm-context.component';
import { BpmGateComponent } from './bpm-gate.component';
import { BpmWorkspaceNavComponent } from './bpm-workspace-nav.component';
import { BpmMonthTypeComponent } from './bpm-month-type.component';
import { BpmTermComponent } from './bpm-term.component';
import { BpmTourComponent } from './bpm-tour.component';
import { visionSettings } from './bpm-settings';
import {
  contributionOf,
  emptyVision,
  periodsPerYear,
  centerAllowances,
  eventProvisions,
  projectDirectives,
  visionInputOf,
  visionProjection,
} from './bpm-vision.model';

const P = 'content.pages.bpm.bpm-pilot.page.';
/** Textes livrés du pilotage ; ils se personnalisent dans Configuration → Contenus. */
export const BPM_PILOT_TEXTS: Record<string, string> = {
  standardScope: 'Zoom sur votre projet de vie',
  actionScope: 'Ajuster votre budget quotidien',
  actionScopeHelp: 'Votre budget type, les échéances et les objectifs d’épargne.',
  standardScopeHelp:
    'Les chiffres ci-dessous portent sur votre budget quotidien. Vos autres projets figurent dans la synthèse au-dessus.',
  incomeType: 'Type d’entrée financière',
  incomeTypeHint: 'Don, gain ponctuel, prime exceptionnelle…',
  expensesDetail: 'Dépenses',
  kicker: 'Ma vision budgétaire',
  zoneState: 'Graphiques & chiffres',
  zoneStateLead: 'Ce qui est réalisé, ce qui est prévu.',
  zoneAct: 'Ce qu’il faut faire',
  zoneActLead: 'Saisir, vérifier, ajuster.',
  statsTitle: 'Graphiques & chiffres',
  actionsTitle: 'Ce qu’il faut faire',
  periodNumbers: 'Les chiffres de la période',
  shortcutMonth: 'Mon budget type',
  shortcutTarget: 'Mes objectifs d’excédent',
  shortcutSim: 'Simuler une épargne',
  titlePeriod: 'Piloter',
  weekOf: 'la semaine du',
  yearOf: 'l’année',
  chipProject: 'Projet',
  rhythmTime: 'Période écoulée',
  rhythmCap: 'Plafond dépensé',
  rhythmTimeCompact: 'Écoulée',
  rhythmCapCompact: 'Dépensé',
  rhythmOk:
    'Jour {day} sur {total} : {spent} % du plafond dépensé pour {elapsed} % du temps. Dans le rythme ; {amount} libres jusqu’au {date}.',
  rhythmAhead:
    'Jour {day} sur {total} : déjà {spent} % du plafond dépensé pour {elapsed} % du temps. Ralentissez pour tenir jusqu’au {date}.',
  rhythmOver:
    'Le plafond est dépassé de {amount} : chaque nouvelle dépense réduira votre patrimoine à la clôture du {close}.',
  rhythmTimeOnly:
    'Jour {day} sur {total} : à la clôture du {close}, le solde réel rejoindra votre patrimoine.',
  eventInView: 'Déjà compté dans le prévu',
  title: 'Piloter la période, voir grandir le patrimoine',
  lead: 'Vos flux, votre solde et leur effet sur le patrimoine.',
  loading: 'Lecture de votre période…',
  shortcuts: 'Aller directement à',
  shortcutEntry: 'Saisir un flux',
  shortcutPending: 'Consulter les échéances',
  missingSnapshot: 'Le budget et le patrimoine doivent être reliés pour calculer cette période.',
  openJourney: 'Vérifier mon parcours',
  paused:
    'Clôture automatique suspendue. Les flux restent consultables ; réactivez la liaison dans le cycle pour reprendre les transferts.',
  unknownWealth:
    'Valorisez les actifs du patrimoine pour calculer des directives et une simulation fiables.',
  openWealth: 'Valoriser le patrimoine',
  drawTarget: 'Prélèvement visé sur le patrimoine',
  zeroTarget: 'Objectif : équilibrer la période sans puiser dans le patrimoine.',
  targetNet: 'Solde réel à comparer à la cible',
  effortValue: 'Effort supplémentaire (€)',
  numbersShortcut: 'Budget quotidien',
  actualShortcut: 'Réalisé & prévu',
  futureShortcut: 'Épargne & patrimoine',
  toolsLabel: 'Dans cette page',
  flowShortcut: 'Saisir',
  summaryShortcut: 'Synthèse',
  pendingShortcut: 'Échéances',
  historyShortcut: 'Clôtures',
  directivesShortcut: 'Repères',
  goalsShortcut: 'Objectifs',
  simUnavailable: 'La simulation sera disponible dès que le patrimoine de départ sera valorisé.',
  saving: 'Enregistrement…',
  pointingDate: 'Date réelle du règlement',
  pointingHelp: 'Chaque entrée ou charge est prise en compte automatiquement à sa date prévue.',

  empty: 'Créez d’abord un projet Budget/Patrimoine pour piloter sa période.',
  emptyAction: 'Créer un projet',
  readOnly: 'Lecture seule : ce projet appartient à un autre utilisateur.',
  chipPeriod: 'Période',
  chipLeft: 'Reste',
  chipStarts: 'Démarre dans',
  days: 'jours',
  chipTarget: 'Épargne visée',
  none: 'non fixée',
  kpis: 'La période en chiffres',
  kpiNet: 'Solde à ce jour',
  kpiNetHelp: 'Entrées reçues − charges payées dans la période.',
  kpiClosed: 'Solde clôturé',
  closedHelp: 'Résultat réel conservé pour cette période clôturée.',
  closedMargin: 'Marge sur le plafond',
  closedMarginHelp: 'Période terminée, comparée au plafond de vos objectifs actuels.',
  kpiProjected: 'Solde prévu à la clôture',
  kpiProjectedView: 'Solde prévu en fin de période',
  kpiProjectedViewHelp: 'Solde réalisé + entrées attendues − charges à venir sur la période.',
  kpiProjectedHelp: 'Solde réalisé + entrées attendues − charges à venir avant la clôture.',
  kpiRequired: 'Épargne nécessaire',
  kpiRequiredHelp: 'À mettre de côté par période pour financer vos objectifs.',
  kpiRequiredNone: 'Aucun objectif',
  kpiRequiredNoneHelp: 'Ajoutez un objectif pour calculer l’épargne nécessaire.',
  kpiRemaining: 'Reste à dépenser',
  kpiRemainingHelp: 'Disponible après les charges prévues et l’épargne nécessaire.',
  perWeek: 'par semaine en moyenne',
  directivesTitle: 'Vos repères',
  directiveOnTrack: 'Votre épargne prévue couvre vos objectifs.',
  directiveBehind: 'Votre épargne prévue ne suffit pas encore à financer tous vos objectifs.',
  directiveOnTrackOver:
    'Votre budget type couvre vos objectifs. Cette période dépasse toutefois le plafond conseillé.',
  directiveDrawing: 'Votre patrimoine suffit à vos objectifs : vous pouvez même y puiser jusqu’à',
  directiveSave: 'Épargner au moins',
  directiveCap: 'Ne pas dépasser',
  directiveCapUnit: 'de dépenses',
  directiveLeft: 'Il reste',
  directiveLeftUnit: 'libres',
  directiveLeftAfter: ', après les dépenses déjà prévues',
  directiveLeftSoit: 'soit',
  directiveOver: 'Le plafond est dépassé de',
  directiveShort: 'Il manque au budget prévu',
  directiveShortText:
    'pour l’épargne et les provisions de la première période ; complétez vos entrées dans « Mon budget type » avant le démarrage.',
  directiveOverText:
    'l’épargne demandée n’est plus couverte ; réduisez les dépenses prévues ou ajustez vos objectifs.',
  adoptRequired: 'Adopter l’épargne nécessaire comme épargne visée',
  directivesNone:
    'Ajoutez un objectif dans « Objectifs & avenir » pour calculer l’épargne à prévoir et le plafond de dépenses.',
  flowTitle: 'Ajouter une entrée ou une charge',
  flowIntro: 'Salaires, aides, courses, loyer… Choisissez le projet, le montant et la date.',
  income: 'Entrée',
  expense: 'Charge',
  flowLabel: 'Libellé de l’entrée ou de la charge',
  flowAmount: 'Montant (€)',
  forecastDateLabel: 'Date de dépense prévisionnelle',
  flowDate: 'Date',
  flowCadence: 'Récurrence',
  flowFormat: 'Type de flux',
  flowOnce: 'Ponctuel',
  flowRecurring: 'Récurrent',
  flowRepeat: 'Récurrence automatique',
  flowOnceHelp: 'Une seule fois, à la date choisie.',
  flowRecurringHelp:
    'Choisissez une fréquence et une première date. Les échéances suivantes sont automatiques.',
  flowCenter: 'Poste de l’entrée ou de la dépense',
  flowSettled: 'Déjà reçu ou payé',
  flowNote: 'Note, facultative',
  flowFirstReceipt: 'Premier jour de réception',
  flowIncomeDate: 'Date de prise en compte de l’entrée',
  flowFirstPayment: 'Premier jour de prélèvement ou de paiement',
  flowExpenseDate: 'Date de dépense prévisionnelle',
  flowTiming:
    'Une entrée ou dépense récurrente génère seule ses échéances à partir de ce jour. Un flux ponctuel ne compte qu’une fois, à sa date.',
  flowAdd: 'Enregistrer le flux',
  once: 'Une fois',
  weekly: 'Chaque semaine',
  monthly: 'Chaque mois',
  yearly: 'Chaque année',
  presetsIncome: 'Salaire|Don des parents|Aide (CAF)|Prime|Remboursement',
  presetsExpense: 'Courses|Loyer|Charges|Transports|Loisirs|Vacances|Cadeaux',
  flowInvalid:
    'Indiquez un libellé, un montant positif, une date, le poste d’une dépense ou le type d’une entrée ponctuelle.',
  flowSaved: 'Flux enregistré.',
  undo: 'Annuler',
  undone: 'Annulé : ce geste n’a laissé aucune trace dans le budget.',
  pendingTitle: 'Échéances à venir',
  pendingTitleView: 'Échéances à venir',
  pendingIntroView: 'Consultez les échéances prévues',
  compareTitle: 'Résultat réalisé et prévu',
  compareIntro:
    'Au-dessus de zéro : excédent. En dessous : déficit. Barre pleine : réalisé · Contour : prévu.',
  comparePlanned: 'Prévu',
  compareReal: 'Réalisé',
  compareGap: 'Écart',
  compareNote: 'Les périodes à venir ne montrent que le prévu.',
  compareCurve: 'Courbe : résultat réalisé',
  compareCurveFuture: 'Prolongement : résultat prévu',
  pendingIntro: 'Entrées et charges encore prévues d’ici la clôture.',
  pendingEmpty: 'Rien d’autre de prévu d’ici la clôture.',
  received: 'Reçu',
  paid: 'Payé',
  profileIntro:
    'Vos revenus et charges récurrents, ramenés à la période affichée. Les flux ponctuels sont exclus.',
  profileNatural: 'Solde du budget type',
  profileIncomes: 'Entrées régulières',
  profileExpenses: 'Charges régulières',
  profileNoIncome: 'Ajoutez vos revenus réguliers dans « Mon budget type ».',
  profileNoExpense: 'Aucune dépense récurrente pour l’instant.',
  fromWeekly: 'chaque semaine',
  fromYearly: 'chaque année',
  profileVerdict1: 'dégage',
  profileVerdict2: 'vos objectifs demandent',
  profileVerdict3: 'et les événements à venir',
  profileMargin: 'marge',
  centersTitle: 'Charges par poste',
  allowanceOk: 'Les charges payées et à venir respectent le plafond conseillé.',
  allowanceOver: 'Les dépenses prévues dépassent le plafond de',
  allowanceOverText: 'les plafonds par poste ci-dessous vous aident à ajuster les charges.',
  allowance: 'conseillé',
  plannedShort: 'à payer',
  centersEmpty: 'Aucune dépense réglée pour l’instant.',
  centerNone: 'Sans poste',
  limit: 'plafond',
  directiveProvision: 'Mettre de côté',
  directiveProvisionUnit: 'pour les événements à venir (Noël, vacances…).',
  incomesTitle: 'Entrées par source',
  incomesEmpty: 'Aucune entrée reçue ni attendue',
  expected: 'attendus',
  eventsTitle: 'Dépenses à anticiper',
  eventsIntro:
    'Dépenses ponctuelles ou annuelles des douze prochains mois : montants à mettre de côté avant leur échéance.',
  eventsEmpty: 'Aucun événement prévu dans les douze prochains mois.',
  eventsTotal: 'À mettre de côté :',
  periodsLeft: 'clôture(s) pour s’y préparer',
  incomingEvent: 'Entrée attendue',
  progressTitle: 'Vers votre épargne visée',
  progressNone: 'Fixez une épargne visée pour suivre votre progression pendant la période.',
  savingsActual: 'Mis de côté à ce jour',
  savingsGoal: 'Épargne visée',
  savingsMissing: 'Reste à constituer',
  savingsBeyond: 'Au-delà de l’objectif',
  plannedShare: 'des charges prévues',
  incomeShareLabel: 'des entrées prévues',
  closing: 'À la clôture du',
  closingJoin: 'le solde réel rejoindra votre patrimoine ; attendu',
  closingToday: 'réel à ce jour',
  targetTitle: 'Mon minimum à mettre de côté',
  targetManage: 'Modifier mes objectifs',
  targetNone:
    'Aucun minimum enregistré : fixez 0 € pour viser l’équilibre ou un montant positif pour constituer un excédent.',
  cumulativeTarget: 'Objectif cumulé',
  cumulativePeriods: 'périodes',
  targetIntro: 'Par période : 0 € pour rester à l’équilibre, un montant positif pour épargner.',
  targetLabel: 'Épargne visée (€)',
  targetMinimum: 'Minimum par période',
  targetCumulative: 'Objectif sur plusieurs périodes',
  targetClear: 'Ne pas fixer',
  save: 'Enregistrer',
  saved: 'Enregistré.',
  invalid: 'Saisissez un montant valide.',
  simTitle: 'Simuler une épargne supplémentaire',
  simIntro:
    'Ajustez l’épargne par période pour voir son effet sur votre patrimoine. La simulation n’enregistre rien.',
  simLabel: 'Épargne supplémentaire',
  simBase: 'Sans changement',
  simScenario: 'Avec cet ajustement',
  simWealth: 'Patrimoine à l’horizon',
  simReal: 'En euros d’aujourd’hui',
  simGoals: 'Objectifs financés',
  simApply: 'Adopter comme épargne visée',
  historyTitle: 'Soldes versés au patrimoine',
  groupsNav: 'Analyses de la période',
  groupDirectives: 'Ce qu’il faut faire',
  groupDirectivesLead: 'Les chiffres de la période et vos directives.',
  groupReal: 'Réalisé et prévu',
  groupRealLead: 'Résultat, charges et entrées.',
  groupFuture: 'Budget type et patrimoine',
  groupFutureLead: 'Épargne, objectifs et clôtures.',
  drillStatement: 'Relevé',
  drillStatementOf: 'Ouvrir le relevé de',
  drillCenter: 'Voir le détail de ce poste',
  drillIncomes: 'Voir le détail des entrées',
  historyIntro:
    'Chaque clôture verse le solde réel de la période au patrimoine : un excédent l’augmente, un déficit le diminue.',
  historyEmpty: 'Aucune clôture pour l’instant : la première aura lieu à la fin de la période.',
  historyAfter: 'Patrimoine après clôture',
  leversTitle: 'Ajuster votre budget',
  'tool-operations': 'Toutes les opérations du budget',
  'tool-centres': 'Revoir les postes de dépense',
  'tool-cycle': 'Clôture et cycle budgétaire',
  vision: 'Objectifs & avenir',
};
registerPageTexts(
  Object.fromEntries(Object.entries(BPM_PILOT_TEXTS).map(([key, value]) => [P + key, value])),
);

const long = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const short = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const at = (value: string) => new Date(`${value}T12:00:00Z`);
/** Le rythme affiché dans le bandeau de Piloter la période. */
interface PeriodRhythm {
  elapsed: number | null;
  spent: number | null;
  state: 'ok' | 'ahead' | 'over';
  lead: string;
  label: string;
}
const flowDraft = (today: string) => ({
  incomeType: '',
  kind: 'expense' as 'income' | 'expense',
  title: '',
  amount: '',
  date: today,
  cadence: 'once' as BpmFlow['cadence'],
  centerId: '',
  centerName: '',
  settled: true,
  note: '',
});

/**
 * Piloter la période : le cœur quotidien de Budget/Patrimoine Management. Les
 * objectifs deviennent des directives (épargner, ne pas dépasser), les flux se
 * se saisissent ici, et le patrimoine évolue clôture après clôture.
 */
@Component({
  selector: 'rjs-bpm-pilot-page',
  providers: [BpmPeriodReading],
  imports: [
    BpmFlowPilotComponent,
    BpmFlowEditorComponent,
    BpmPeriodNavComponent,
    ExpandedReadingDirective,
    BpmFundingComponent,

    RangeFieldComponent,
    BpmContextComponent,
    BpmCapExplainComponent,
    BpmProjectSwitchComponent,
    AppHeroComponent,
    BpmGateComponent,
    BpmMonthTypeComponent,
    BpmTermComponent,
    BpmTourComponent,
    BpmWorkspaceNavComponent,
    FormsModule,
    MetricTilesComponent,
    RouterLink,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./bpm-pages.scss', './bpm-vision.page.scss', './bpm-pilot-charts.scss'],
  template: `
    <div
      class="page bpm-reading bpm-vision"
      [class.bpm-analysis]="!actionsMode"
      data-tone="budget"
      rjsExpandedReading
    >
      <rjs-bpm-gate
        [suite]="
          actionsMode
            ? '/budget-patrimoine-management/piloter/agir'
            : '/budget-patrimoine-management/piloter'
        "
      />
      @if (store.workspace() && store.error()) {
        <p class="bpm-error" role="alert">{{ store.error() }}</p>
      }
      @if (!store.workspace()) {
      } @else if (!project()) {
        <rjs-app-hero
          toolsLabel="Actions"
          tone="aurora"
          headingId="bp-empty-title"
          [kicker]="t('kicker')"
          [title]="t('title')"
          [lead]="t('empty')"
          [actions]="[
            { label: t('emptyAction') + ' →', link: '/budget-patrimoine-management/creer' },
          ]"
        ></rjs-app-hero>
      } @else {
        @let p = project()!;
        @let s = p.snapshot;
        @let mine = manages(p);
        @let d = directives();
        @let r = rhythm();
        <rjs-app-hero
          toolsLabel="Actions"
          data-tour="rhythm"
          tone="indigo"
          headingId="bp-title"
          [kicker]="t('kicker')"
          [title]="t(actionsMode ? 'actionsTitle' : 'statsTitle')"
          [lead]="t(actionsMode ? 'zoneActLead' : 'zoneStateLead')"
          [chips]="chips()"
        >
          <rjs-bpm-workspace-nav heroGuide [project]="p" active="pilot" />
          <rjs-bpm-tour
            heroGuide
            [inline]="true"
            page="pilot"
            [steps]="
              actionsMode
                ? ['act', 'directives', 'pending', 'flow', 'month-type']
                : ['rhythm', 'state', 'compare', 'events', 'profile']
            "
          />
          @if (r.elapsed !== null) {
            <div
              class="bp-rhythm is-inline"
              role="img"
              [attr.aria-label]="r.label"
              [attr.data-state]="r.state"
            >
              <div class="bp-rhythm-indicator">
                <small class="bp-rhythm-caption" [title]="t('rhythmTime')"
                  ><span class="bp-rhythm-full">{{ t('rhythmTime') }}</span
                  ><span class="bp-rhythm-compact">{{ t('rhythmTimeCompact') }}</span></small
                >
                <div class="bp-rhythm-measure">
                  <span class="bp-rhythm-symbol" aria-hidden="true">◷</span>
                  <strong>{{ r.elapsed }} %</strong>
                </div>
              </div>
              @if (r.spent !== null) {
                <div class="bp-rhythm-indicator">
                  <small class="bp-rhythm-caption" [title]="t('rhythmCap')"
                    ><span class="bp-rhythm-full">{{ t('rhythmCap') }}</span
                    ><span class="bp-rhythm-compact">{{ t('rhythmCapCompact') }}</span></small
                  >
                  <div class="bp-rhythm-measure">
                    <span class="bp-rhythm-symbol" aria-hidden="true">€</span>
                    <strong>{{ r.spent }} %</strong>
                  </div>
                </div>
              }
            </div>
          }
          <rjs-bpm-project-switch
            heroMeta
            [embedded]="true"
            [projects]="projects()"
            [current]="p.id"
          />
          <rjs-bpm-context heroMetaWide [scopeOnly]="true" [compact]="true" [embedded]="true" />
          @if (mine) {
            <a
              heroActions
              class="app-hero-action"
              routerLink="/budget-patrimoine-management/piloter/agir"
              [queryParams]="{ projet: p.id }"
              fragment="saisie-des-flux"
              >＋ Saisir un flux</a
            >
          }
          @if (actionsMode) {
            <a
              heroActions
              class="bpm-link"
              routerLink="/budget-patrimoine-management/piloter"
              [queryParams]="expenseQuery()"
              >Voir les graphiques →</a
            >
          }
          <a
            heroActions
            class="bpm-link"
            routerLink="/budget-patrimoine-management/depenses"
            [queryParams]="expenseQuery()"
            >{{ t('expensesDetail') }} →</a
          >
          <rjs-bpm-period-nav
            heroFooter
            [window]="view()"
            [loading]="reading.loading()"
            [error]="reading.error()"
          />
          @if (!actionsMode) {
            <nav heroPageTools class="bp-groups-nav" [attr.aria-label]="t('groupsNav')">
              <a [routerLink]="[]" queryParamsHandling="preserve" fragment="fp-title">{{
                t('summaryShortcut')
              }}</a>
              <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bp-groupe-chiffres">{{
                t('numbersShortcut')
              }}</a>
              <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bp-groupe-reel">{{
                t('actualShortcut')
              }}</a>
              <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bp-groupe-avenir">{{
                t('futureShortcut')
              }}</a>
              <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bp-history-title">{{
                t('historyShortcut')
              }}</a>
            </nav>
          } @else {
            <nav heroPageTools [attr.aria-label]="t('toolsLabel')">
              <a [routerLink]="[]" queryParamsHandling="preserve" fragment="saisie-des-flux">{{
                t('flowShortcut')
              }}</a>
              <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bp-dir-title">{{
                t('directivesShortcut')
              }}</a>
              <a [routerLink]="[]" queryParamsHandling="preserve" fragment="budget-type">{{
                t('shortcutMonth')
              }}</a>
              <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bp-pending-title">{{
                t('pendingShortcut')
              }}</a>
              <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bp-target-title">{{
                t('goalsShortcut')
              }}</a>
              <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bp-sim-title">{{
                t('shortcutSim')
              }}</a>
            </nav>
          }
        </rjs-app-hero>

        <rjs-bpm-flow-pilot
          [data]="view()?.flowPilot ?? null"
          [projectId]="p.id"
          [compact]="actionsMode"
        />
        @if (actionsMode && mine) {
          <rjs-bpm-flow-editor [project]="p" />
        }
        <header class="bp-scope-heading" id="bp-groupe-chiffres">
          <span class="bp-scope-icon" aria-hidden="true">{{ actionsMode ? '↗' : '◎' }}</span>
          <div>
            <h2>{{ t(actionsMode ? 'actionScope' : 'standardScope') }}</h2>
            <p>{{ t(actionsMode ? 'actionScopeHelp' : 'standardScopeHelp') }}</p>
          </div>
        </header>
        @if (!actionsMode) {
          <section data-bpm-frame="metrics" aria-label="Repères du projet de vie">
            <rjs-metric-tiles variant="instrument" [label]="t('kpis')" [tiles]="tiles()" />
          </section>
        }

        @if (!actionsMode) {
          <!-- 01 · État des lieux : la période telle qu'elle est, avant de la piloter. -->
          <section
            data-ui-pattern="panel cockpit"
            data-cockpit-phase="state"
            id="etat-des-lieux"
            data-tour="state"
            [attr.aria-label]="t('zoneState')"
          >
            @if (!s) {
              <p class="bpm-missing">
                {{ t('missingSnapshot') }}
                <a
                  routerLink="/budget-patrimoine-management/parcours"
                  [queryParams]="{ projet: p.id }"
                  >{{ t('openJourney') }} →</a
                >
              </p>
            }
            @if (p.link?.enabled === 'false') {
              <p class="bpm-missing">
                {{ t('paused') }}
                <a
                  routerLink="/budget-patrimoine-management/cycle"
                  [queryParams]="{ liaison: p.linkId }"
                  >{{ t('tool-cycle') }} →</a
                >
              </p>
            }
            @if (s && !hasValuation()) {
              <p class="bpm-missing">
                {{ t('unknownWealth') }}
                <a
                  routerLink="/patrimoine-management/manager/assets"
                  [queryParams]="{ project: p.patrimoineProjectId }"
                  >{{ t('openWealth') }} →</a
                >
              </p>
            }
            <!-- L'état des lieux se lit en trois temps : ce qu'il faut faire, ce qui s'est passé, ce qui vient. -->

            <h3 class="bp-group" id="bp-groupe-reel">
              {{ t('groupReal') }}
              <small>{{ t('groupRealLead') }}</small>
            </h3>
            @if (view(); as v) {
              <section
                class="bv-card"
                data-tour="compare"
                data-bpm-frame="chart"
                aria-labelledby="bp-compare-title"
                data-ui-pattern="panel"
              >
                <h2 id="bp-compare-title">{{ t('compareTitle') }} {{ word('per') }}</h2>
                <div class="bpm-disclosure-body">
                  <p>{{ t('compareIntro') }}</p>
                  <div class="bp-compare-scroll" tabindex="0" [attr.aria-label]="t('compareTitle')">
                    <div class="bp-compare-stage" [style.--period-count]="bars().length">
                      <ol class="bp-compare-chart">
                        @for (bar of bars(); track bar.bucket.start) {
                          <li
                            [attr.data-state]="bar.bucket.state"
                            [attr.aria-current]="bar.bucket.state === 'current' ? 'date' : null"
                          >
                            <span class="bp-compare-period">{{ markOf(bar.bucket.start) }}</span
                            ><span class="bp-compare-bars" aria-hidden="true"
                              ><i class="bp-zero-label">0</i>
                              <span
                                class="is-planned"
                                [attr.data-sign]="bar.plannedSign"
                                [style.height.%]="bar.plannedPct / 2"
                              ></span>
                              @if (bar.bucket.state !== 'future') {
                                <span
                                  class="is-real"
                                  [attr.data-sign]="bar.realizedSign"
                                  [style.height.%]="bar.realizedPct / 2"
                                ></span>
                              }
                            </span>

                            <small
                              >{{ t('comparePlanned') }}
                              {{ signed(bar.bucket.plannedNetCents) }}</small
                            >
                            @if (bar.bucket.state !== 'future') {
                              <small
                                >{{ t('compareReal') }}
                                {{ signed(bar.bucket.realizedNetCents) }}</small
                              >
                            }
                            @if (bar.gapCents) {
                              <small
                                class="bp-compare-gap"
                                [attr.data-sign]="bar.gapCents < 0 ? 'negative' : 'positive'"
                                >{{ t('compareGap') }} {{ signed(bar.gapCents) }}</small
                              >
                            }
                            @if (bar.bucket.state !== 'future') {
                              <a
                                class="bp-drill"
                                routerLink="/budget-patrimoine-management/tableau-de-bord"
                                [queryParams]="{
                                  projet: p.id,
                                  du: bar.bucket.start,
                                  au: bar.bucket.end,
                                }"
                                [attr.aria-label]="
                                  t('drillStatementOf') + ' ' + markOf(bar.bucket.start)
                                "
                                >{{ t('drillStatement') }} →</a
                              >
                            }
                          </li>
                        }
                      </ol>
                      <svg
                        class="bp-history-overlay"
                        [attr.viewBox]="'0 0 ' + historyCurve().width + ' 200'"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <path class="bp-history-halo" [attr.d]="historyCurve().actual" />
                        <path class="bp-history-line" [attr.d]="historyCurve().actual" />
                        <path class="bp-history-halo" [attr.d]="historyCurve().forecast" />
                        <path
                          class="bp-history-line is-future"
                          [attr.d]="historyCurve().forecast"
                        />
                      </svg>
                    </div>
                  </div>
                  <p class="bp-compare-legend">
                    <span class="is-planned">{{ t('comparePlanned') }}</span>
                    <span class="is-real">{{ t('compareReal') }}</span>
                    <span class="is-curve">{{ t('compareCurve') }}</span>
                    <span class="is-curve is-future">{{ t('compareCurveFuture') }}</span>
                    <span>{{ t('compareNote') }}</span>
                  </p>
                </div>
              </section>
            }
            <section class="bv-card" aria-labelledby="bp-centers-title" data-ui-pattern="panel">
              <h2 id="bp-centers-title">{{ t('centersTitle') }} {{ word('this') }}</h2>
              <div class="bpm-disclosure-body">
                @let a = allowances();
                @if (a.rows.length) {
                  <p
                    class="bp-allowance-status"
                    [attr.data-state]="a.overCents > 0 ? 'over' : 'ok'"
                  >
                    {{
                      a.overCents > 0
                        ? t('allowanceOver') +
                          ' ' +
                          money(a.overCents) +
                          ' : ' +
                          t('allowanceOverText')
                        : t('allowanceOk')
                    }}
                  </p>
                  <ul class="bp-centers bp-expense-centers">
                    @for (center of a.rows; track center.id) {
                      <li>
                        <a
                          class="bp-drill-name"
                          [routerLink]="
                            center.id
                              ? '/budget-patrimoine-management/argent/postes/' + center.id
                              : '/budget-patrimoine-management/argent/a-preciser'
                          "
                          [queryParams]="{ projet: p.id }"
                          [attr.title]="t('drillCenter')"
                          >{{ center.name || t('centerNone') }} <span aria-hidden="true">→</span></a
                        >
                        <strong
                          ><a
                            routerLink="/budget-patrimoine-management/depenses"
                            [queryParams]="expenseSearch('', center.id)"
                            >{{ money(center.spentCents) }}</a
                          >
                          @if (center.plannedCents) {
                            <small
                              >+ {{ money(center.plannedCents) }} {{ t('plannedShort') }}</small
                            >
                          }
                          @if (center.allowanceCents !== null) {
                            <small class="bp-allowance"
                              >· {{ t('allowance') }} {{ money(center.allowanceCents) }}</small
                            >
                          } @else if (center.limitCents) {
                            <small> / {{ money(center.limitCents) }} {{ t('limit') }}</small>
                          }
                        </strong>
                        <span class="bp-share-note" data-flow="expense">
                          <b
                            >{{
                              share(center.expectedCents).toLocaleString('fr-FR', {
                                maximumFractionDigits: 1,
                              })
                            }}
                            %</b
                          >
                          {{ t('plannedShare') }}
                        </span>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="bv-empty">{{ t('centersEmpty') }}</p>
                }
              </div>
            </section>
            <div class="bv-split">
              <section class="bv-card" aria-labelledby="bp-incomes-title" data-ui-pattern="panel">
                <h2 id="bp-incomes-title">{{ t('incomesTitle') }} {{ word('this') }}</h2>
                <div class="bpm-disclosure-body">
                  @if (incomesView().length) {
                    <ul class="bp-centers bp-income-centers">
                      @for (source of incomesView(); track source.title) {
                        <li>
                          <a
                            class="bp-drill-name"
                            routerLink="/budget-patrimoine-management/argent/entrees"
                            [queryParams]="{ projet: p.id }"
                            [attr.title]="t('drillIncomes')"
                          >
                            {{ source.title }} <span aria-hidden="true">→</span></a
                          >
                          <strong
                            >{{ money(source.receivedCents) }}
                            @if (source.plannedCents) {
                              <small>+ {{ money(source.plannedCents) }} {{ t('expected') }}</small>
                            }
                          </strong>
                          <span class="bp-share-note" data-flow="income">
                            <b
                              >{{
                                incomeShare(
                                  source.receivedCents + source.plannedCents
                                ).toLocaleString('fr-FR', { maximumFractionDigits: 1 })
                              }}
                              %</b
                            >
                            {{ t('incomeShareLabel') }}
                          </span>
                        </li>
                      }
                    </ul>
                  } @else {
                    <p class="bv-empty">{{ t('incomesEmpty') }} {{ word('this') }}.</p>
                  }
                </div>
              </section>
              <section
                class="bv-card"
                data-tour="events"
                aria-labelledby="bp-events-title"
                data-ui-pattern="panel"
              >
                <h2 id="bp-events-title">
                  {{ t('eventsTitle') }} <rjs-bpm-term key="provision" />
                </h2>
                <p>{{ t('eventsIntro') }}</p>
                @if (provisions().items.length || provisions().incomes.length) {
                  <ul class="bp-pending">
                    @for (
                      event of provisions().items;
                      track event.operationId + event.occurrenceDate
                    ) {
                      <li data-sign="negative">
                        <span class="bp-pending-date">{{ shortDay(event.occurrenceDate) }}</span>
                        <a
                          routerLink="/budget-patrimoine-management/depenses"
                          [queryParams]="
                            expenseQuery(
                              event.operationId,
                              event.occurrenceDate,
                              event.occurrenceDate
                            )
                          "
                          ><strong>{{ event.title }}</strong></a
                        >
                        <span class="bp-pending-amount">−{{ money(event.amountCents) }}</span>
                        @let set = provisionOf(p, event);
                        <small class="bp-provision">
                          @if (set === null) {
                            {{ t('eventInView') }} {{ word('of') }}
                          } @else {
                            {{ money(set) }} {{ word('per') }} · {{ event.periodsLeft }}
                            {{ t('periodsLeft') }}
                          }
                        </small>
                      </li>
                    }
                    @for (
                      event of provisions().incomes;
                      track event.operationId + event.occurrenceDate
                    ) {
                      <li data-sign="positive">
                        <span class="bp-pending-date">{{ shortDay(event.occurrenceDate) }}</span>
                        <strong>{{ event.title }}</strong>
                        <span class="bp-pending-amount">+{{ money(event.amountCents) }}</span>
                        <small class="bp-provision">{{ t('incomingEvent') }}</small>
                      </li>
                    }
                  </ul>
                  <p class="bpm-help">
                    {{ t('eventsTotal') }}
                    <strong>{{ money(provisionTotal()) }}</strong> {{ word('per') }}.
                  </p>
                } @else {
                  <p class="bv-empty">{{ t('eventsEmpty') }}</p>
                }
              </section>
            </div>
            <h3 class="bp-group" id="bp-groupe-avenir">
              <span aria-hidden="true">C</span>{{ t('groupFuture') }}
              <small>{{ t('groupFutureLead') }}</small>
            </h3>
            @if (profileView(); as profile) {
              <section
                class="bv-card bp-profile"
                data-tour="profile"
                aria-labelledby="bp-profile-title"
                data-ui-pattern="panel"
              >
                <header class="bv-card-head">
                  <div>
                    <h2 id="bp-profile-title">
                      {{ word('type') }} <rjs-bpm-term key="epargneNaturelle" />
                    </h2>
                    <p>{{ t('profileIntro') }}</p>
                  </div>
                  <div
                    class="bp-profile-result"
                    [attr.data-sign]="profile.naturalSavingCents < 0 ? 'negative' : 'positive'"
                  >
                    <small>{{ t('profileNatural') }} {{ word('per') }}</small>
                    <strong>{{ signed(profile.naturalSavingCents) }}</strong>
                  </div>
                </header>
                <div class="bp-profile-grid">
                  <div>
                    <h3>{{ t('profileIncomes') }} · {{ money(profile.incomeCents) }}</h3>
                    <ul class="bp-profile-list">
                      @for (entry of profile.incomes; track entry.title) {
                        <li>
                          <span>{{ entry.title }}</span
                          ><strong data-sign="positive">+{{ money(entry.perPeriodCents) }}</strong>
                        </li>
                      } @empty {
                        <li class="bv-empty">{{ t('profileNoIncome') }}</li>
                      }
                    </ul>
                  </div>
                  <div>
                    <h3>{{ t('profileExpenses') }} · {{ money(profile.expenseCents) }}</h3>
                    <ul class="bp-profile-list">
                      @for (group of profile.expenses; track group.centerId) {
                        <li class="bp-profile-group">
                          <span>{{ group.name || t('centerNone') }}</span
                          ><strong>−{{ money(group.totalCents) }}</strong>
                          <small>
                            @for (item of group.items; track item.title; let last = $last) {
                              <a
                                routerLink="/budget-patrimoine-management/depenses"
                                [queryParams]="expenseSearch(item.title, group.centerId)"
                                >{{ item.title }} {{ money(item.perPeriodCents)
                                }}{{
                                  item.cadence === 'weekly'
                                    ? ' (' + t('fromWeekly') + ')'
                                    : item.cadence === 'yearly'
                                      ? ' (' + t('fromYearly') + ')'
                                      : ''
                                }}</a
                              >{{ last ? '' : ' · ' }}
                            }
                          </small>
                        </li>
                      } @empty {
                        <li class="bv-empty">{{ t('profileNoExpense') }}</li>
                      }
                    </ul>
                  </div>
                </div>
                @if (d.requiredCents !== null) {
                  <p
                    class="bp-profile-verdict"
                    [attr.data-state]="
                      profile.naturalSavingCents - d.provisionCents >= d.requiredCents
                        ? 'ok'
                        : 'behind'
                    "
                  >
                    {{ word('type') }} {{ t('profileVerdict1') }}
                    <strong>{{ signed(profile.naturalSavingCents) }}</strong> ;
                    {{ t('profileVerdict2') }}
                    <strong>{{ money(Math.max(d.requiredCents, 0)) }}</strong>
                    @if (d.provisionCents > 0) {
                      {{ t('profileVerdict3') }} <strong>{{ money(d.provisionCents) }}</strong>
                    }
                    : {{ t('profileMargin') }}
                    <strong>{{
                      signed(
                        profile.naturalSavingCents - Math.max(d.requiredCents, 0) - d.provisionCents
                      )
                    }}</strong
                    >.
                  </p>
                }
              </section>
            }
            @if (s) {
              <section
                class="bv-card bp-progress"
                aria-labelledby="bp-progress-title"
                data-ui-pattern="panel"
              >
                <h2 id="bp-progress-title">{{ t('progressTitle') }} {{ word('this') }}</h2>
                <div class="bpm-disclosure-body">
                  @let target = targetInLens();
                  @let viewNet = view()?.netCents ?? s.netCents;
                  @if (target !== null && target > 0) {
                    <dl class="bp-saving-comparison">
                      <div>
                        <dt>{{ t('savingsActual') }}</dt>
                        <dd [attr.data-sign]="viewNet < 0 ? 'negative' : 'positive'">
                          {{ money(viewNet) }}
                        </dd>
                      </div>
                      <div>
                        <dt>{{ t('savingsGoal') }}</dt>
                        <dd>{{ money(target) }}</dd>
                      </div>
                    </dl>
                    <div class="bp-saving-distance" [class.is-reached]="viewNet >= target">
                      <span class="bp-saving-seal" aria-hidden="true">{{
                        viewNet >= target ? '✓' : '◎'
                      }}</span>
                      <span
                        >{{ t(viewNet >= target ? 'savingsBeyond' : 'savingsMissing')
                        }}<strong>{{ money(Math.abs(target - viewNet)) }}</strong></span
                      >
                      <b>{{ ratio() }} %</b>
                    </div>
                  } @else if (target !== null) {
                    <p class="bp-gauge-legend">
                      {{ target < 0 ? t('drawTarget') + ' : ' + money(-target) : t('zeroTarget') }}
                    </p>
                    <p>
                      {{ t('targetNet') }} : <strong>{{ signed(viewNet) }}</strong>
                    </p>
                  } @else {
                    <p class="bv-empty">{{ t('progressNone') }}</p>
                  }
                  @let expected = s.netCents + s.plannedIncomeCents - s.plannedExpenseCents;
                  <p class="bpm-help">
                    {{ t('closing') }} {{ longDate(s.period.end) }}, {{ t('closingJoin') }}
                    <strong [attr.data-sign]="expected < 0 ? 'negative' : 'positive'">{{
                      signed(expected)
                    }}</strong>
                    ({{ t('closingToday') }} {{ signed(s.netCents) }}).
                  </p>
                </div>
              </section>
            }
            @if (p.snapshot; as snapshot) {
              <rjs-bpm-funding
                [project]="p"
                [funding]="view()?.funding ?? snapshot.funding"
                [register]="view()?.incomeRegister ?? snapshot.incomeRegister ?? null"
                [start]="view()?.start ?? snapshot.period.start"
                [end]="view()?.end ?? snapshot.period.end"
              />
            }
            <section class="bv-card" aria-labelledby="bp-history-title" data-ui-pattern="panel">
              <h2 id="bp-history-title">{{ t('historyTitle') }}</h2>
              <div class="bpm-disclosure-body">
                <p>{{ t('historyIntro') }}</p>
                @if (s?.history?.length) {
                  <ol class="bp-history">
                    @for (entry of s!.history.slice().reverse(); track entry.start) {
                      <li [attr.data-sign]="entry.netCents < 0 ? 'negative' : 'positive'">
                        <a
                          class="bp-drill-name"
                          routerLink="/budget-patrimoine-management/tableau-de-bord"
                          [queryParams]="{ projet: p.id, du: entry.start, au: entry.end }"
                          [attr.aria-label]="t('drillStatementOf') + ' ' + shortDate(entry.start)"
                          >{{ shortDate(entry.start) }} → {{ shortDate(entry.end) }}
                          <span aria-hidden="true">→</span></a
                        >
                        <strong>{{ signed(entry.netCents) }}</strong>
                        <small
                          >{{ t('historyAfter') }} ·
                          {{
                            entry.patrimoineAfterCents === null
                              ? '—'
                              : money(entry.patrimoineAfterCents)
                          }}</small
                        >
                      </li>
                    }
                  </ol>
                } @else {
                  <p class="bv-empty">{{ t('historyEmpty') }}</p>
                }
              </div>
            </section>
          </section>
        }
        @if (actionsMode) {
          <!-- 02 · Agir : consulter, saisir, régler l'épargne visée et simuler un effort. -->
          <section
            data-ui-pattern="panel cockpit"
            data-cockpit-phase="act"
            id="agir"
            data-tour="act"
            [attr.aria-label]="t('zoneAct')"
          >
            @if (message()) {
              <p class="bv-saved" role="status">
                {{ message() }}
                @if (undo()) {
                  <button
                    type="button"
                    class="bv-undo"
                    (click)="revert()"
                    [disabled]="store.saving()"
                  >
                    {{ t('undo') }}
                  </button>
                }
              </p>
            }
            @if (!mine) {
              <p class="bpm-missing">{{ t('readOnly') }}</p>
            }
            <section
              class="bv-card bp-directives"
              data-tour="directives"
              [attr.data-state]="
                d.onTrack === null
                  ? 'none'
                  : d.onTrack && (d.remainingCents ?? 0) >= 0
                    ? 'ok'
                    : 'behind'
              "
              aria-labelledby="bp-dir-title"
              data-ui-pattern="panel"
            >
              <h2 id="bp-dir-title">{{ t('directivesTitle') }} {{ word('of') }}</h2>
              @if (d.requiredCents === null) {
                <p>
                  {{ t('directivesNone') }}
                  <a
                    routerLink="/budget-patrimoine-management/vision"
                    [queryParams]="{ projet: p.id }"
                    >{{ t('vision') }} →</a
                  >
                </p>
              } @else {
                <p class="bp-dir-status">
                  {{
                    d.requiredCents < 0
                      ? t('directiveDrawing') +
                        ' ' +
                        money(-d.requiredCents) +
                        ' ' +
                        word('per') +
                        '.'
                      : d.onTrack
                        ? (d.remainingCents ?? 0) < 0
                          ? t('directiveOnTrackOver')
                          : t('directiveOnTrack')
                        : t('directiveBehind')
                  }}
                </p>
                <ol class="bp-dir-list">
                  @if (d.requiredCents >= 0) {
                    <li>
                      <span aria-hidden="true">①</span>{{ t('directiveSave') }}
                      <rjs-bpm-term key="epargneNecessaire" />
                      <strong>{{ money(d.requiredCents) }}</strong> {{ word('per') }}.
                    </li>
                  }
                  @if (d.spendingCapCents !== null) {
                    <li>
                      <span aria-hidden="true">②</span>{{ t('directiveCap') }}
                      <rjs-bpm-term key="plafond" />
                      <strong>{{ money(Math.max(d.spendingCapCents, 0)) }}</strong>
                      {{ t('directiveCapUnit') }} {{ word('this') }}.
                    </li>
                  }
                  @if (d.provisionCents > 0) {
                    <li>
                      <span aria-hidden="true">③</span>{{ t('directiveProvision') }}
                      <rjs-bpm-term key="provision" />
                      <strong>{{ money(d.provisionCents) }}</strong> {{ word('this') }}
                      {{ t('directiveProvisionUnit') }}
                    </li>
                  }
                  @if (d.remainingCents !== null) {
                    @if (d.remainingCents >= 0) {
                      <li>
                        <span aria-hidden="true">{{ d.provisionCents > 0 ? '④' : '③' }}</span
                        >{{ t('directiveLeft') }} <rjs-bpm-term key="resteLibre" />
                        <strong>{{ money(d.remainingCents) }}</strong> {{ t('directiveLeftUnit') }}
                        {{ word('this') }}{{ t('directiveLeftAfter') }}
                        @if (lens() !== 'weekly') {
                          , {{ t('directiveLeftSoit') }}
                          <strong>{{ money(d.perWeekCents ?? 0) }}</strong> {{ t('perWeek') }}
                        }
                        .
                      </li>
                    } @else {
                      <li class="is-over">
                        <span aria-hidden="true">{{ d.provisionCents > 0 ? '④' : '③' }}</span
                        >{{
                          s?.period?.started === false ? t('directiveShort') : t('directiveOver')
                        }}
                        <strong>{{ money(-d.remainingCents) }}</strong> :
                        {{
                          s?.period?.started === false
                            ? t('directiveShortText')
                            : t('directiveOverText')
                        }}
                      </li>
                    }
                  }
                </ol>
                <div class="bp-dir-explain">
                  <rjs-bpm-cap-explain [project]="p" [lens]="lens()" [onPilot]="true" />
                </div>
              }
            </section>

            @if (mine && s) {
              <rjs-bpm-month-type id="budget-type" [project]="p" [expanded]="true" />
            }
            <div class="bp-pending-section">
              <section
                class="bv-card"
                data-tour="pending"
                aria-labelledby="bp-pending-title"
                data-ui-pattern="panel"
              >
                <h2 id="bp-pending-title">{{ pendingTitle() }}</h2>
                <p>{{ pendingIntro() }}</p>
                <p class="bpm-help">{{ t('pointingHelp') }}</p>
                @if (pendingView().length) {
                  <ul class="bp-pending">
                    @for (entry of pendingView(); track entry.operationId + entry.occurrenceDate) {
                      <li [attr.data-sign]="entry.kind === 'income' ? 'positive' : 'negative'">
                        <span class="bp-pending-date">
                          @if (entry.kind === 'expense') {
                            {{ t('forecastDateLabel') }} ·
                          }
                          {{ shortDay(entry.occurrenceDate) }}</span
                        >
                        @if (entry.kind === 'expense') {
                          <a
                            routerLink="/budget-patrimoine-management/depenses"
                            [queryParams]="
                              expenseQuery(
                                entry.operationId,
                                entry.occurrenceDate,
                                entry.occurrenceDate
                              )
                            "
                            ><strong>{{ entry.title }}</strong></a
                          >
                        } @else {
                          <strong>{{ entry.title }}</strong>
                        }
                        <span class="bp-pending-amount"
                          >{{ entry.kind === 'income' ? '+' : '−'
                          }}{{ money(entry.amountCents) }}</span
                        >
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="bv-empty">{{ t('pendingEmpty') }}</p>
                }
              </section>
            </div>

            <div class="bv-split">
              <section class="bv-card" aria-labelledby="bp-target-title" data-ui-pattern="panel">
                <h2 id="bp-target-title">{{ t('targetTitle') }}</h2>
                <dl class="bp-target-facts">
                  <div>
                    <dt>{{ t('targetMinimum') }}</dt>
                    <dd>
                      @if (vision().savingsTargetCents !== null) {
                        <strong>{{ money(vision().savingsTargetCents!) }}</strong>
                        <span>{{ cycleWord() }}</span>
                      } @else {
                        <span class="bpm-help">{{ t('targetNone') }}</span>
                      }
                    </dd>
                  </div>
                  @if (vision().surplusGoal; as goal) {
                    <div>
                      <dt>{{ t('targetCumulative') }}</dt>
                      <dd>
                        <strong>{{ money(goal.targetCents) }}</strong>
                        <span>{{ goal.periods }} {{ t('cumulativePeriods') }}</span>
                      </dd>
                    </div>
                  }
                </dl>
                <p class="bpm-help">{{ t('targetIntro') }}</p>
                <a
                  class="btn btn-secondary"
                  routerLink="/budget-patrimoine-management/vision"
                  [queryParams]="{ projet: p.id }"
                  fragment="objectifs-budgetaires"
                  >{{ t('targetManage') }} →</a
                >
              </section>

              <section class="bv-card" aria-labelledby="bp-sim-title" data-ui-pattern="panel">
                <h2 id="bp-sim-title">{{ t('simTitle') }}</h2>
                <p>{{ t('simIntro') }}</p>
                @if (hasValuation()) {
                  <rjs-range-field
                    id="pilot-effort"
                    name="effort"
                    #effortControl="ngModel"
                    [label]="t('simLabel') + ' ' + word('per')"
                    unit="€"
                    [min]="-effortRange()"
                    [max]="effortRange()"
                    [step]="effortStep()"
                    [numberStep]="0.01"
                    [ngModel]="effort()"
                    (ngModelChange)="setEffort($event)"
                  />
                  <div class="bv-table-scroll">
                    <table class="bp-compare">
                      <thead>
                        <tr>
                          <th scope="col"></th>
                          <th scope="col">{{ t('simBase') }}</th>
                          <th scope="col">{{ t('simScenario') }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <th scope="row">{{ t('simWealth') }}</th>
                          <td>{{ money(base().final.nominalCents) }}</td>
                          <td [attr.data-sign]="delta() >= 0 ? 'positive' : 'negative'">
                            {{ money(scenario().final.nominalCents) }}
                          </td>
                        </tr>
                        <tr>
                          <th scope="row">{{ t('simReal') }}</th>
                          <td>{{ money(base().final.realCents) }}</td>
                          <td>{{ money(scenario().final.realCents) }}</td>
                        </tr>
                        <tr>
                          <th scope="row">{{ t('simGoals') }}</th>
                          <td>{{ funded(base()) }}</td>
                          <td>{{ funded(scenario()) }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  @if (mine && effort() !== 0) {
                    <button
                      type="button"
                      class="btn btn-secondary"
                      [disabled]="store.saving() || effortControl.invalid"
                      (click)="adopt(p)"
                    >
                      {{ t('simApply') }}
                    </button>
                  }
                } @else {
                  <p class="bv-empty">{{ t('simUnavailable') }}</p>
                }
              </section>
            </div>
            <section class="bv-card" aria-labelledby="bp-levers-title" data-ui-pattern="panel">
              <h2 id="bp-levers-title">{{ t('leversTitle') }}</h2>
              <div class="bp-levers">
                @for (lever of levers(p); track lever.id) {
                  <a class="btn btn-secondary" [routerLink]="lever.link" [queryParams]="lever.query"
                    >{{ t('tool-' + lever.id) }} →</a
                  >
                }
                <a
                  class="btn btn-secondary"
                  routerLink="/budget-patrimoine-management/vision"
                  [queryParams]="{ projet: p.id }"
                  >{{ t('vision') }} →</a
                >
              </div>
            </section>
          </section>
        }
      }
    </div>
  `,
})
export class BpmPilotPage {
  protected expenseSearch(q: string, poste: string | null) {
    return { ...this.expenseQuery(), q, poste };
  }
  protected expenseQuery(operation?: string, occurrence?: string, date?: string) {
    const p = this.project()!,
      view = this.view();
    return {
      ...expensePeriodQuery(p, { start: view?.start, end: view?.end, operation, occurrence, date }),
      budget: p.budgetProjectId,
    };
  }

  protected readonly actionsMode = inject(ActivatedRoute).snapshot.data['pilotView'] === 'actions';
  protected readonly reading = inject(BpmPeriodReading);
  protected readonly store = inject(BpmStore);
  private readonly session = inject(UserSession);
  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap);
  protected readonly money = formatMoney;
  protected readonly Math = Math;
  protected readonly cadences: BpmFlow['cadence'][] = ['once', 'weekly', 'monthly', 'yearly'];
  protected readonly recurringCadences: BpmFlow['cadence'][] = ['weekly', 'monthly', 'yearly'];
  protected readonly effort = signal(0);
  protected readonly formError = signal('');
  protected readonly flowError = signal('');
  protected readonly message = signal('');
  /** Le dernier geste réussi, que l'on peut annuler tant qu'aucun autre ne l'a remplacé. */
  protected readonly undo = signal<(() => Promise<boolean>) | null>(null);
  private lastRecurringCadence: BpmFlow['cadence'] = 'monthly';
  protected flow = flowDraft(new Date().toISOString().slice(0, 10));

  protected readonly projects = computed(() => {
    const me = this.session.profile()?.id ?? '';
    return [...this.store.displayedProjects()].sort(
      (a, b) =>
        Number(b.ownerUserId === me) - Number(a.ownerUserId === me) ||
        Number(b.defaultForEntity === true) - Number(a.defaultForEntity === true) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  });
  protected readonly project = computed(() => {
    const wanted = this.params()?.get('projet') ?? '';
    return this.reading.project(
      this.projects().find((entry) => entry.id === wanted) ?? this.projects()[0] ?? null,
    );
  });
  protected readonly vision = computed(() => this.project()?.vision ?? emptyVision());
  protected readonly hasValuation = computed(
    () => this.project()?.snapshot?.standing.totalCents != null,
  );
  private readonly periodLens = inject(PeriodLensService);
  /** La vue choisie en haut à droite : semaine, mois ou année (par défaut, le cycle du projet). */
  protected readonly lens = computed(() => this.periodLens.active());
  protected readonly cycleWord = computed(() =>
    lensWord('per', this.project() ? cycleOf(this.project()!) : 'monthly'),
  );
  /** La fenêtre de cette vue qui contient aujourd'hui. */
  protected readonly view = computed(() => {
    const p = this.project();
    return p ? lensViewOf(p, this.lens()) : null;
  });
  protected readonly closedPeriod = computed(() => {
    const view = this.view();
    const history = this.project()?.snapshot?.history ?? [];
    return (
      !!view &&
      !!history.length &&
      history[0]!.start <= view.start &&
      history[history.length - 1]!.end >= view.end
    );
  });
  /** Les directives dans la vue choisie. */
  protected readonly directives = computed(() => {
    const p = this.project();
    const w = this.store.workspace();
    return p && w && this.hasValuation()
      ? lensDirectives(p, w, visionSettings(), this.lens())
      : {
          requiredCents: null,
          provisionCents: 0,
          plannedCents: 0,
          onTrack: null,
          incomeCents: 0,
          spendingCapCents: null,
          spentCents: 0,
          remainingCents: null,
          perWeekCents: null,
        };
  });

  protected readonly provisions = computed(() => {
    const p = this.project();
    const s = p?.snapshot;
    return s
      ? eventProvisions(s.upcoming ?? [], s.period.end, p?.link?.periodicity ?? 'monthly')
      : { items: [], incomes: [], totalPerPeriodCents: 0 };
  });
  protected readonly allowances = computed(() => {
    const p = this.project();
    const s = p?.snapshot;
    const view = this.view();
    if (!p || !view || this.lens() === cycleOf(p))
      return centerAllowances(
        s?.centers ?? [],
        s?.pending ?? [],
        this.directives().spendingCapCents,
      );
    // Dans une autre vue : les postes de la fenêtre, leurs plafonds ramenés à la vue.
    const centers = view.centers.map((center) => ({
      ...center,
      limitCents: center.limitCents === null ? null : toLens(center.limitCents, p, this.lens()),
    }));
    const planned = view.centers
      .filter((center) => center.plannedCents)
      .map((center) => ({
        operationId: '',
        title: '',
        kind: 'expense' as const,
        centerId: center.id || null,
        occurrenceDate: view.start,
        amountCents: center.plannedCents,
      }));
    return centerAllowances(centers, planned, this.directives().spendingCapCents);
  });
  /** Le profil type dans la vue : une semaine, un mois ou une année ordinaires. */
  protected readonly profileView = computed(() => {
    const p = this.project();
    const profile = p?.snapshot?.profile;
    return p && profile ? lensProfile(profile, p, this.lens()) : null;
  });
  /** Les échéances à recevoir : celles de la fenêtre quand la vue est plus courte que le cycle. */
  protected readonly pendingView = computed(() => {
    const p = this.project();
    const view = this.view();
    const shorter = !!p && !!view && periodsPerYear(this.lens()) > periodsPerYear(cycleOf(p));
    return shorter ? view!.pending : (p?.snapshot?.pending ?? []);
  });
  protected readonly pendingIntro = computed(() => {
    const p = this.project();
    const shorter =
      !!p && !!this.view() && periodsPerYear(this.lens()) > periodsPerYear(cycleOf(p));
    return shorter ? `${this.t('pendingIntroView')} ${this.word('this')}.` : this.t('pendingIntro');
  });
  protected readonly pendingTitle = computed(() => {
    const p = this.project();
    const shorter =
      !!p && !!this.view() && periodsPerYear(this.lens()) > periodsPerYear(cycleOf(p));
    return shorter ? `${this.t('pendingTitleView')} ${this.word('this')}` : this.t('pendingTitle');
  });
  /** Les entrées de la fenêtre de la vue, par source. */
  protected readonly incomesView = computed(
    () => this.view()?.incomes ?? this.project()?.snapshot?.incomes ?? [],
  );
  /** L'épargne visée, exprimée dans la vue. */
  protected readonly targetInLens = computed(() => {
    const p = this.project();
    const target = this.vision().savingsTargetCents;
    return p && target !== null ? toLens(target, p, this.lens()) : target;
  });
  /** Ce qu'il faut mettre de côté dans la vue pour les événements qui ne sont pas déjà dans son prévu. */
  protected readonly provisionTotal = computed(() => {
    const p = this.project();
    if (!p) return 0;
    return this.provisions().items.reduce(
      (total, event) => total + (provisionInLens(event, p, this.lens()) ?? 0),
      0,
    );
  });
  /** Le réel face au prévu, fenêtre par fenêtre, dans la vue. */
  protected readonly bars = computed(() => {
    const view = this.view();
    return view ? lensBars(view) : [];
  });
  /** Même échelle que les colonnes ; le prolongement futur reste explicitement prévisionnel. */
  protected readonly historyCurve = computed(() => {
    const bars = this.bars();
    const point = (index: number, future: boolean) => {
      const bar = bars[index]!;
      const pct = future ? bar.plannedPct : bar.realizedPct;
      const sign = future ? bar.plannedSign : bar.realizedSign;
      return { x: 64 + index * 140, y: 100 - (sign === 'negative' ? -pct : pct) };
    };
    const path = (points: { x: number; y: number }[]) =>
      points
        .map((p, i) => {
          if (!i) return `M ${p.x} ${p.y}`;
          const previous = points[i - 1]!;
          const middle = (previous.x + p.x) / 2;
          return `C ${middle} ${previous.y}, ${middle} ${p.y}, ${p.x} ${p.y}`;
        })
        .join(' ');
    const actual = bars.flatMap((bar, i) =>
      bar.bucket.state === 'future' ? [] : [point(i, false)],
    );
    const forecast = bars.flatMap((bar, i) =>
      bar.bucket.state === 'future' ? [point(i, true)] : [],
    );
    if (forecast.length && actual.length) forecast.unshift(actual[actual.length - 1]!);
    return {
      width: Math.max(1, bars.length * 140 - 12),
      actual: path(actual),
      forecast: path(forecast),
    };
  });
  /** L'amplitude du curseur suit la vue : un effort de semaine n'est pas un effort d'année. */
  protected readonly effortRange = computed(() => {
    const cadence = this.lens();
    const monthly = siteSetting<number>('bpm.pilotage.effortMensuel') / 100;
    return Math.round((monthly * periodsPerYear('monthly')) / periodsPerYear(cadence));
  });
  protected readonly effortStep = computed(() => this.effortRange() / 50);
  private projectionWith(extraCents: number) {
    const p = this.project();
    const w = this.store.workspace();
    if (!p || !w)
      return visionProjection({
        today: '2000-01-01',
        startCents: 0,
        contributionPerPeriodCents: 0,
        periodsPerYear: 12,
        returnPct: 0,
        inflation: () => 0,
        horizonYears: 1,
        goals: [],
      });
    return visionProjection(visionInputOf(p, w, visionSettings(), extraCents));
  }
  protected readonly base = computed(() => this.projectionWith(0));
  protected readonly scenario = computed(() => {
    const p = this.project();
    // L'effort est saisi dans la vue ; la projection raisonne par période du cycle.
    return this.projectionWith(p ? fromLens(Math.round(this.effort() * 100), p, this.lens()) : 0);
  });
  protected readonly delta = computed(
    () => this.scenario().final.nominalCents - this.base().final.nominalCents,
  );
  protected readonly ratio = computed(() => {
    const target = this.targetInLens();
    const net = this.view()?.netCents ?? this.project()?.snapshot?.netCents ?? 0;
    if (!target || target <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((net / target) * 100)));
  });
  /** Le titre de la vue : la période pilotée, nommée selon le cycle du projet. */
  protected readonly periodTitle = computed(() => {
    const p = this.project();
    const s = p?.snapshot;
    if (!s) return this.t('title');
    const words = { week: this.t('weekOf'), year: this.t('yearOf') };
    const view = this.view();
    return `${periodLabel(view?.start ?? s.period.start, view ? this.lens() : p?.link?.periodicity, words)}`;
  });
  /** Le rythme de la période : le temps écoulé face à la part du plafond déjà dépensée. */
  protected readonly rhythm = computed<PeriodRhythm>(() => {
    const s = this.project()?.snapshot;
    const d = this.directives();
    const idle: PeriodRhythm = {
      elapsed: null,
      spent: null,
      state: 'ok',
      lead: this.t('lead'),
      label: '',
    };
    if (!s) return idle;
    // La fenêtre de la vue choisie, sinon la période du cycle.
    const w = this.view() ?? s.period;
    const day = 86_400_000;
    const total = Math.max(1, Math.round((Date.parse(w.end) - Date.parse(w.start)) / day));
    const elapsedDays = Math.min(total, Math.max(0, total - w.daysLeft));
    const elapsed = Math.round((elapsedDays / total) * 100);
    const cap = d.spendingCapCents;
    const spent = cap !== null && cap > 0 ? Math.round((d.spentCents / cap) * 100) : null;
    const margin = siteSetting<number>('bpm.pilotage.rythmeMarge');
    const over = d.remainingCents !== null && d.remainingCents < 0;
    const state: PeriodRhythm['state'] = over
      ? 'over'
      : spent !== null && spent > elapsed + margin
        ? 'ahead'
        : 'ok';
    const values: Record<string, string> = {
      day: String(Math.min(total, elapsedDays + 1)),
      total: String(total),
      elapsed: String(elapsed),
      spent: String(spent ?? 0),
      date: this.longDate(lastDayOf(w.end)),
      close: this.longDate(s.period.end),
      amount: formatMoney(over ? -(d.remainingCents ?? 0) : (d.remainingCents ?? 0)),
    };
    const key = over
      ? 'rhythmOver'
      : spent === null
        ? 'rhythmTimeOnly'
        : state === 'ahead'
          ? 'rhythmAhead'
          : 'rhythmOk';
    const lead = Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, value),
      this.t(key),
    );
    const label =
      `${this.t('rhythmTime')} ${elapsed} %` +
      (spent === null ? '' : ` · ${this.t('rhythmCap')} ${spent} %`);
    return { elapsed, spent, state, lead, label };
  });
  /** Les jours jusqu'au démarrage d'un cycle encore à venir. */
  protected daysUntil(start: string): number {
    const today = this.store.workspace()?.today ?? start;
    return Math.max(
      0,
      Math.round(
        (Date.parse(`${start}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000,
      ),
    );
  }
  protected readonly chips = computed<HeroChip[]>(() => {
    const s = this.project()?.snapshot;
    const w = this.view() ?? s?.period;
    const target = this.targetInLens();
    return [
      ...(w
        ? [
            // Avant le démarrage du cycle, le compte à rebours porte sur le démarrage, pas sur la clôture.
            w.started
              ? { label: this.t('chipLeft'), value: `${w.daysLeft} ${this.t('days')}` }
              : {
                  label: this.t('chipStarts'),
                  value: `${this.daysUntil(w.start)} ${this.t('days')}`,
                },
          ]
        : []),
      {
        label: this.t('chipTarget'),
        value: target === null ? this.t('none') : `${formatMoney(target)} ${this.word('per')}`,
      },
    ];
  });
  protected readonly tiles = computed<MetricTile[]>(() => {
    const s = this.project()?.snapshot;
    if (!s) return [];
    const d = this.directives();
    const view = this.view();
    const net = view?.netCents ?? s.netCents;
    const projected = view
      ? view.netCents + view.remainingIncomeCents - view.remainingExpenseCents
      : s.netCents + s.plannedIncomeCents - s.plannedExpenseCents;
    const tone = (cents: number) => (cents > 0 ? 'success' : cents < 0 ? 'danger' : null);
    return [
      {
        id: 'net',
        label: `${this.t('kpiNet')} ${this.word('of')}`,
        value: this.signed(net),
        tone: tone(net),
        note: this.t('kpiNetHelp'),
        details: [
          { label: '↑', value: formatMoney(view?.incomeCents ?? s.incomeCents), tone: 'success' },
          { label: '↓', value: formatMoney(view?.expenseCents ?? s.expenseCents), tone: 'danger' },
        ],
      },
      {
        id: 'projected',
        label: this.t(
          this.closedPeriod()
            ? 'kpiClosed'
            : view && this.lens() !== cycleOf(this.project()!)
              ? 'kpiProjectedView'
              : 'kpiProjected',
        ),
        value: this.signed(projected),
        tone: tone(projected),
        emphasis: true,
        note: this.t(
          this.closedPeriod()
            ? 'closedHelp'
            : view && this.lens() !== cycleOf(this.project()!)
              ? 'kpiProjectedViewHelp'
              : 'kpiProjectedHelp',
        ),
      },
      d.requiredCents === null
        ? {
            id: 'required',
            label: this.t('kpiRequired'),
            value: this.t('kpiRequiredNone'),
            note: this.t('kpiRequiredNoneHelp'),
          }
        : {
            id: 'required',
            label: this.t('kpiRequired'),
            value: `${formatMoney(Math.max(d.requiredCents, 0))} ${this.word('per')}`,
            tone: d.onTrack ? 'success' : 'warning',
            note: this.t('kpiRequiredHelp'),
          },
      d.remainingCents === null
        ? {
            id: 'remaining',
            label: this.t(this.closedPeriod() ? 'closedMargin' : 'kpiRemaining'),
            value: '—',
            note: this.t('kpiRemainingHelp'),
          }
        : {
            id: 'remaining',
            label: this.t(this.closedPeriod() ? 'closedMargin' : 'kpiRemaining'),
            value: this.signed(d.remainingCents),
            tone: d.remainingCents < 0 ? 'danger' : null,
            note: this.closedPeriod()
              ? this.t('closedMarginHelp')
              : this.lens() === 'weekly' || d.remainingCents < 0
                ? this.t('kpiRemainingHelp')
                : `${formatMoney(d.perWeekCents ?? 0)} ${this.t('perWeek')} · ${this.t('kpiRemainingHelp')}`,
          },
    ];
  });

  private readonly projectId = computed(() => this.project()?.id);
  constructor() {
    this.periodLens.adapt('monthly', inject(DestroyRef));
    effect(() => {
      const p = this.project();
      if (p) this.periodLens.follow(cycleOf(p));
    });
    // Un changement de projet ne doit jamais garder le brouillon du précédent.
    effect(() => {
      const id = this.projectId();
      untracked(() => {
        if (!id) return;
        this.flow = flowDraft(
          this.store.workspace()?.today ?? new Date().toISOString().slice(0, 10),
        );
        this.effort.set(0);
        this.formError.set('');
        this.flowError.set('');
        this.message.set('');
        this.undo.set(null);
      });
    });
    void this.store.load();
  }
  /** Un mot de la vue courante : « par semaine », « ce mois-ci », « Une année type »… */
  protected word(kind: 'per' | 'this' | 'of' | 'type'): string {
    return lensWord(kind, this.lens());
  }
  /** Un montant par période du cycle, exprimé dans la vue courante. */
  protected inLens(project: BpmProject, cents: number): number {
    return toLens(cents, project, this.lens());
  }
  /** Le repère court d'une fenêtre de la vue. */
  protected markOf(start: string): string {
    return periodMark(start, this.lens());
  }
  /** La provision d'un événement dans la vue, ou null s'il est déjà dans son prévu. */
  protected provisionOf(
    project: BpmProject,
    event: { occurrenceDate: string; amountCents: number; perPeriodCents: number },
  ) {
    return provisionInLens(event, project, this.lens());
  }
  protected setEffort(value: number | null): void {
    if (value !== null && Number.isFinite(value) && Math.abs(value) <= this.effortRange()) {
      this.effort.set(value);
    }
  }
  protected t(key: string): string {
    return pageText(P + key);
  }
  /** Les libellés proposés suivent le sens du flux choisi dans le formulaire. */
  protected presets(): string[] {
    return this.t(this.flow.kind === 'income' ? 'presetsIncome' : 'presetsExpense').split('|');
  }
  protected manages(project: BpmProject): boolean {
    return project.ownerUserId === '' || project.ownerUserId === (this.session.profile()?.id ?? '');
  }
  protected signed(cents: number): string {
    return (cents > 0 ? '+' : cents < 0 ? '−' : '') + formatMoney(Math.abs(cents));
  }
  protected longDate(value: string): string {
    return long.format(at(value));
  }
  protected shortDate(value: string): string {
    return short.format(at(value));
  }
  protected shortDay(value: string): string {
    return long.format(at(value));
  }
  protected incomeShare(cents: number): number {
    const total = this.incomesView().reduce(
      (sum, entry) => sum + entry.receivedCents + entry.plannedCents,
      0,
    );
    return total > 0 ? (cents / total) * 100 : 0;
  }
  protected share(cents: number): number {
    const total = this.allowances().rows.reduce((sum, entry) => sum + entry.expectedCents, 0);
    return total > 0 ? (cents / total) * 100 : 0;
  }
  protected funded(reading: ReturnType<typeof visionProjection>): string {
    const due = reading.goals.filter((entry) => entry.status !== 'au-dela');
    return `${due.filter((entry) => entry.status === 'finance').length} / ${due.length}`;
  }
  protected levers(project: BpmProject) {
    return [
      ...bpmTools(project, 'budget').filter(
        (tool) => tool.id === 'operations' || tool.id === 'centres',
      ),
      ...bpmTools(project, 'cycle').filter((tool) => tool.id === 'cycle'),
    ];
  }
  protected toggleFlowRecurrence(): void {
    if (this.flow.cadence === 'once') {
      this.flow.cadence = this.lastRecurringCadence;
    } else {
      this.lastRecurringCadence = this.flow.cadence;
      this.flow.cadence = 'once';
    }
    this.flowError.set('');
  }
  protected async addFlow(project: BpmProject): Promise<void> {
    this.flowError.set('');
    const cents = parseAmount(this.flow.amount);
    if (
      !this.flow.title.trim() ||
      !cents ||
      cents <= 0 ||
      !this.flow.date ||
      !this.flow.centerName.trim() ||
      (this.flow.kind === 'income' &&
        this.flow.cadence === 'once' &&
        !this.flow.incomeType.trim() &&
        !this.flow.centerName.trim())
    ) {
      this.flowError.set(this.t('flowInvalid'));
      return;
    }
    const ok = await this.store.addFlow(project.id, {
      kind: this.flow.kind,
      incomeType:
        this.flow.incomeType.trim() ||
        (this.flow.kind === 'income' ? this.flow.centerName.trim() : ''),
      title: this.flow.title.trim(),
      amountCents: cents,
      date: this.flow.date,
      cadence: this.flow.cadence,
      centerName: this.flow.centerName.trim(),
      settled: this.flow.date <= (this.store.workspace()?.today ?? ''),
      note: this.flow.note.trim(),
    });
    if (ok) {
      const keep = { kind: this.flow.kind, date: this.flow.date, centerId: this.flow.centerId };
      this.flow = { ...flowDraft(keep.date), kind: keep.kind, centerId: keep.centerId };
      this.message.set(this.t('flowSaved'));
      const [created] = ok;
      this.undo.set(created ? () => this.store.removeFlow(project.id, created) : null);
    }
  }
  /** Annule le dernier geste : la saisie du flux est retirée. */
  protected async revert(): Promise<void> {
    const action = this.undo();
    if (!action) return;
    if (await action()) {
      this.undo.set(null);
      this.message.set(this.t('undone'));
    }
  }
  /** Adopte l'effort simulé : l'apport actuel du cycle plus l'effort saisi dans la vue. */
  protected async adopt(project: BpmProject): Promise<void> {
    const next =
      contributionOf(project).cents +
      fromLens(Math.round(this.effort() * 100), project, this.lens());
    this.effort.set(0);
    if (
      await this.store.saveVision(project.id, {
        ...this.vision(),
        savingsTargetCents: Math.max(next, 0),
      })
    )
      this.message.set(this.t('saved'));
  }
}
