import type { CapLevelThresholds, CenterCapRow, RegisterCaps } from './bpm-caps.models';
// Contrats de lecture BPM (API `/api/bpm/*`). Tous les montants `…Cents` sont des centimes entiers ;
// `null` est une valeur inconnue, jamais zéro. Chaque lecture porte son contexte commun.
import { Period } from '../../core/models';

export type Direction = 'income' | 'charge';
export type Cadence = 'once' | 'weekly' | 'monthly' | 'yearly';
export type LineStatus = 'settled' | 'due' | 'late' | 'pending' | 'unrealized';
/** État d'une charge spéciale de projet (budget attribué, dépassement) : présentée, jamais totalisée. */
export type RegisterLineStatus = LineStatus | 'project';
export type RegisterScope = 'principal' | 'consolidated' | 'life-with-projects';
export type GoalType = 'etudes' | 'retraite' | 'achat' | 'securite' | 'transmission' | 'autre';
export type CoverageStatus = 'funded' | 'partial' | 'unfunded' | 'outOfHorizon' | 'unknown';

export interface BpmBudgetRef {
  id: string;
  name: string;
  role: 'life' | 'standard';
  coreProjectId: string;
  fundingSource?: 'cycle' | 'patrimoine';
  capsCents: Record<string, number>;
  revision: number;
}

export interface BpmContextInfo {
  user: { id: string; label: string; userType: string };
  scope: RegisterScope | 'budget';
  scopeLabel: string;
  budgets: BpmBudgetRef[];
  period: (Period & { index?: number; endExclusive: string }) | null;
  /** Bornes de navigation : première période du cycle et période courante (seules lisibles). */
  periods?: { firstKey: string; currentKey: string } | null;
  cycleAnchorDay?: number | null;
  calculationDate: string;
  revision: number;
  unit: string;
}

export interface SummaryFigure {
  key: string;
  label: string;
  unit: 'EUR' | '%';
  value: number | null;
  valueCents: number | null;
  status: 'ok' | 'unavailable';
  unavailableReason: string | null;
  recorded: boolean;
  formula: string;
}

export interface BpmSummary {
  context: BpmContextInfo;
  figures: Record<string, SummaryFigure>;
  /** `unit` : EUR ou % ; pour les montants, aussi en centimes (`recordedCents`, `recomputedCents`). */
  comparison: { key: string; label: string; recorded: number | null; recomputed: number | null; currentFormula: string; unit?: string | null; recordedCents?: number | null; recomputedCents?: number | null }[];
  closed: boolean;
}

export interface RegisterLine {
  id: string;
  kind: 'operation' | 'occurrence' | 'projectAllocation' | 'projectOverrun';
  operationId: string | null;
  recurrenceId: string | null;
  occurrenceDate: string | null;
  occurrenceKey: string | null;
  budgetId: string;
  budgetName: string | null;
  budgetRole: 'life' | 'standard' | null;
  direction: Direction;
  label: string;
  plannedDate: string;
  plannedCents: number;
  realizedDate: string | null;
  accountingDate?: string | null;
  fundingSource?: 'cycle' | 'patrimoine' | null;
  realizedCents: number | null;
  differenceCents: number | null;
  settled: boolean;
  status: RegisterLineStatus;
  statusLabel: string;
  /** Charge spéciale d'un projet de la vie (budget attribué, dépassement) : hors totaux. */
  special?: boolean;
  /** Charge d'un projet de la vie validée comme réglée : comptée dans le budget de vie. */
  projectCharge?: boolean;
  projectPosting?: 'validated' | 'historical' | 'planned';
  /** Nature d'une charge (paramètre `bpm.chargesIndispensables`) ; null pour une entrée. */
  nature?: ChargeNature | null;
  project?: { budgetId: string; coreProjectId: string; name: string };
  costCenterRef: string;
  costCenterLabel: string | null;
  centerKnown: boolean;
  cadence: Cadence;
  cadenceLabel: string;
  firstDate: string | null;
  endDate: string | null;
  note: string | null;
  taskId: string | null;
  taskTitle: string | null;
  revision: number | null;
  /** Échéance non validée dans un cycle clôturé : sa marque d'origine (date prévue, cycle) ; elle se revoit ici. */
  carriedFrom?: { lineId: string; date: string; periodKey: string | null; toPeriodKey?: string };
}

export interface RegisterQuery {
  dateBasis?: 'planned' | 'realized';
  period?: string;
  from?: string;
  to?: string;
  q?: string;
  direction?: Direction | '';
  status?: LineStatus | '';
  center?: string;
  taskId?: string;
  budgetId?: string;
  scope?: RegisterScope;
  nature?: ChargeNature | '';
  groupBy?: 'center' | 'project' | 'nature' | 'date' | 'none';
}

/** Nature des charges du projet de vie [P] : indispensables, courantes (vie de tous les jours), projets de la vie. */
export type ChargeNature = 'indispensable' | 'courante' | 'projet';
export const CHARGE_NATURE_LABEL: Record<ChargeNature, string> = {
  indispensable: 'Charges indispensables',
  courante: 'Charges courantes',
  projet: 'Charges des projets de la vie',
};

export interface BpmRegister {
  dateBasis?: 'planned' | 'realized';
  context: BpmContextInfo;
  window: { from: string; to: string; kind: 'period' | 'custom' };
  selection: string;
  filters: Record<string, string | null>;
  totals: {
    followsFilters: true; paidCents: number; toPayCents: number; unrealizedCents: number; plannedCents: number; lineCount: number; unfilteredCount: number;
    /** Vue « Tout » : entrées et charges séparées, net signé (entrées − charges). */
    byDirection?: Record<Direction, { settledCents: number; openCents: number; plannedCents: number; lineCount: number }>;
    netSettledCents?: number;
    netPlannedCents?: number;
  };
  groups: { key: string; label: string; plannedCents: number; paidCents: number; toPayCents: number; specialCents?: number; lineIds: string[] }[];
  /** État des plafonds de la période (budget du projet de vie, période du cycle) ; null sinon. */
  caps?: RegisterCaps | null;
  lines: RegisterLine[];
  /** Paiements de la période imputés à un autre cycle, hors totaux. */
  paymentTrace?: RegisterLine[];
  announcementTrace?: RegisterLine[];
}

export interface Recurrence {
  id: string;
  budgetId: string;
  budgetName: string | null;
  direction: Direction;
  directionLabel: string;
  label: string;
  amountCents: number;
  amount: number;
  cadence: Exclude<Cadence, 'once'>;
  plannedFundingSource?: 'cycle' | 'patrimoine' | null;
  cadenceLabel: string;
  firstDate: string;
  endDate: string | null;
  note: string | null;
  taskId: string | null;
  costCenterRef: string;
  costCenterLabel: string | null;
  settlementIds: string[];
  revision: number;
  monthlyAverageCents?: number;
  /** Budget type : échéances déjà réglées qui comptent dans le cycle en cours (à corriger avec la ligne, sur demande). */
  settledInCycle?: SettledInCycle[];
}

export interface SettledInCycle { operationId: string; label: string; occurrenceDate: string; realizedDate: string; realizedCents: number; revision: number }

export interface LineDetail {
  context: BpmContextInfo;
  line: RegisterLine;
  definition: Recurrence | null;
  settlements: { operationId: string; occurrenceDate: string | null; plannedCents: number; realizedCents: number; realizedDate: string; outsidePeriod: boolean }[];
  /** Échéances écartées de la définition, rétablissables. */
  skipped?: { operationId: string; occurrenceDate: string; plannedCents: number; reason: string | null; revision: number }[];
  ids: { lineId: string; operationId: string | null; recurrenceId: string | null; budgetId: string; taskId: string | null };
  /** Projet de la vie qui porte l'échéance ; null pour le budget de vie. */
  project?: { budgetId: string; coreProjectId: string; name: string; funded: boolean; fundingSource?: 'cycle' | 'patrimoine'; taskFundingRequired?: boolean; allocationDate: string | null; taskTitle: string | null; inclusion?: 'included' | 'before-allocation' | 'unfunded' | 'pending' | 'income' } | null;
  timing?: { accountingPeriod?: LinePeriod | null; plannedPeriod: LinePeriod | null; realizedPeriod: LinePeriod | null };
  actions: { canSettle: boolean; canCancelSettlement: boolean; canEdit: boolean; settlementPolicy: string; editReason?: string | null; canCancelEntry?: boolean; canSkipOccurrence?: boolean; canDeleteDefinition?: boolean };
}

export interface LinePeriod {
  key: string;
  label: string;
  start: string;
  end: string;
  status: 'closed' | 'ended' | 'current' | 'future';
}

export interface CenterRow {
  ref: string;
  key: string;
  label: string;
  standard: boolean;
  paidCents: number;
  remainingCents: number;
  capCents: number | null;
  marginCents: number | null;
  sharePct: number | null;
}

export interface BpmCenters {
  context: BpmContextInfo;
  direction: Direction;
  basis: { kind: 'received' | 'spent'; label: string; baseCents: number; receivedCents: number; spentCents: number; restCents: number | null; restSharePct: number | null };
  rows: CenterRow[];
}

export interface BpmCenterDetail {
  context: BpmContextInfo;
  center: CenterRow & { direction: Direction; directionLabel: string };
  basis: BpmCenters['basis'];
  lines: RegisterLine[];
  /** Paiements par date réelle ; échéances ouvertes/non réalisées par date prévue. */
  settledLines: RegisterLine[];
  pendingLines: RegisterLine[];
  unrealizedLines: RegisterLine[];
  selection: string;
  totals: BpmRegister['totals'];
  /** Plafond du poste sur la période (charges seulement). */
  cap: CenterCapRow | null;
  /** Seuils des niveaux de consommation (Budget). */
  levels: CapLevelThresholds;
  lifeBudget: { budgetId: string; revision: number };
}

export interface BpmIncomes {
  context: BpmContextInfo;
  receivedCents: number;
  expectedCents: number;
  sources: { ref: string; label: string; receivedCents: number; expectedCents: number; sharePct: number | null }[];
  lines: RegisterLine[];
  settledLines: RegisterLine[];
  pendingLines: RegisterLine[];
  unrealizedLines: RegisterLine[];
  selection: string;
}

export interface Reconciliation {
  initialCents: number;
  currentCents: number;
  variationCents: number;
  netCents: number | null;
  gapCents: number | null;
  formula: string;
  suggestion: string;
  createsOperation: false;
}

export interface BpmBalance {
  context: BpmContextInfo;
  closed: boolean;
  receivedCents: number | null;
  paidCents: number | null;
  netCents: number | null;
  toReceiveCents: number | null;
  toPayCents: number | null;
  expectedCents: number | null;
  initialBudgetCents: number | null;
  closingDate: string | null;
  patrimoine: { stockCents: number | null; effectCents: number | null; afterCents: number | null; objectiveCents?: number | null };
  figures: Record<string, SummaryFigure>;
  reconciliation: Reconciliation | null;
}

export interface HistoryRow {
  periodKey: string;
  /** Index de période (mois depuis l'an 0), pour paginer sans reconstruire. */
  index?: number;
  label: string;
  start: string;
  end: string;
  status: 'closed' | 'ended' | 'current' | 'future';
  recorded: boolean;
  receivedCents: number | null;
  spentCents: number | null;
  netCents: number | null;
  expectedCents: number | null;
  patrimoineCents: number | null;
  patrimoineKind: string;
  capitalizedCents: number | null;
  closureId: string | null;
}

export interface BpmHistory {
  context: BpmContextInfo;
  rows: HistoryRow[];
  total: number;
  nextBefore: number | null;
}

export interface BpmImpact {
  context: BpmContextInfo;
  rows: { budgetId: string; name: string; role: 'life' | 'standard'; receivedCents: number; spentCents: number; netCents: number; toReceiveCents: number; toPayCents: number; expectedNetCents: number }[];
  consolidated: { status: 'not-defined'; reason: string };
}

export interface BpmBudgetType {
  context: BpmContextInfo;
  label: string;
  lines: Recurrence[];
  averageIncomeCents: number;
  averageChargeCents: number;
  averageNetCents: number;
  empty: boolean;
}

export interface BpmDue {
  context: BpmContextInfo;
  lines: RegisterLine[];
  /** Solde net des seules échéances des périodes ouvertes. */
  totalCents: number;
  /** Échéances restées sans règlement dans des périodes closes (hors solde net). */
  unrealizedCount?: number;
  unrealizedNetCents?: number;
}

export interface BpmEvents {
  context: BpmContextInfo;
  assumptions: string[];
  rows: { goalId: string; label: string; type: GoalType; date: string; targetTodayCents: number; futureCostCents: number; periodsAvailable: number; provisionPerPeriodCents: number | null; reason: string | null }[];
}

export interface DirectiveItem {
  key: 'savings' | 'provisions' | 'cap' | 'available' | 'weekly';
  label: string;
  valueCents: number | null;
  computable: boolean;
  reason: string | null;
  assumptions: string[];
}

export interface SurplusProgress {
  targetCents: number;
  periods: number;
  startKey: string;
  perPeriodCents: number;
  cumulatedCents: number;
  closedPeriods: number;
  progressPct: number | null;
}

export interface BpmDirectives {
  context: BpmContextInfo;
  items: DirectiveItem[];
  surplus: SurplusProgress | null;
}

export interface ProjectionRow {
  date?: string;
  year: number;
  n: number;
  nominalCents: number;
  realCents: number;
  priceIndex: number;
  reservedCents: number;
}

export interface GoalCoverage {
  goalId: string;
  label: string;
  type: GoalType;
  typeLabel: string;
  consumes?: boolean;
  date: string;
  year?: number;
  targetTodayCents: number;
  nominalTargetCents: number | null;
  coveredCents: number | null;
  coveragePct: number | null;
  status: CoverageStatus;
  revised?: boolean;
}

export interface ProjectionHypotheses {
  basis?: 'savings-goal';
  horizonYears: number;
  ratePct: number | null;
  inflationPct: number;
  inflationSource: string;
  contributionCents: number | null;
  contributionSource: string;
  cadence: Exclude<Cadence, 'once'>;
  perYear: number;
  startCents: number | null;
  startDate?: string;
  startPeriodKey?: string | null;
  stockReason: string | null;
  extraCents?: number;
}

export interface BpmProjection {
  context: BpmContextInfo;
  hypotheses: ProjectionHypotheses;
  status: 'estimate' | 'unknown' | 'missing-hypothesis';
  reason?: string;
  label?: string;
  realReturnPct?: number;
  annualContributionCents?: number;
  rows: ProjectionRow[];
  goals: GoalCoverage[];
  keyFigures?: { nominalAtHorizonCents: number; realAtHorizonCents: number; realReturnPct: number; erosionWithoutReturnCents: number };
  baseline?: { rows: ProjectionRow[]; keyFigures: BpmProjection['keyFigures'] };
  difference?: { year: number; nominalCents: number; realCents: number }[];
  comparison?: { label: string; reason?: string; contributionCents?: number; closures?: number; rows?: ProjectionRow[]; keyFigures?: BpmProjection['keyFigures'] };
}

export interface EntryPreview {
  context: BpmContextInfo;
  mutation: false;
  source?: 'cycle' | 'patrimoine';
  accountingDate?: string;
  before: { netCents: number | null; expectedCents: number | null; stockCents?: number | null; stockEstimateCents: number | null };
  after: { netCents: number | null; expectedCents: number | null; stockCents?: number | null; stockEstimateCents: number | null };
  note: string | null;
}

export interface Vision {
  horizonYears: number;
  annualReturnPct: number | null;
  inflationPct: number;
  inflationSource: string;
  contributionCents: number | null;
  contributionCadence: Exclude<Cadence, 'once'>;
  savingsTargetCents: number | null;
  surplus: { targetCents: number; periods: number; startKey: string } | null;
}

export interface LifeGoal {
  id: string;
  label: string;
  type: GoalType;
  typeLabel?: string;
  date: string;
  targetTodayCents: number;
  removed: boolean;
  revision: number;
}

/** Saisie de l'éditeur partagé (euros en nombre à la frontière ; l'API convertit en centimes). */
export interface EntryInput {
  /** Règlement financé atomiquement par le middleware Budget après décision explicite. */
  fund?: boolean;
  requestKey?: string;
  budgetId?: string;
  direction: Direction;
  label: string;
  amount: number;
  costCenterRef: string;
  cadence: Cadence;
  date?: string;
  firstDate?: string;
  endDate?: string | null;
  status?: 'planned' | 'realized';
  realizedDate?: string;
  accountingDate?: string;
  fundingSource?: 'cycle' | 'patrimoine';
  realizedAmount?: number;
  note?: string | null;
  taskId?: string | null;
}

export interface SetupProfile {
  user: { id: string; label: string; userType: string; userTypeLabel?: string };
  /** Des périodes closes figent l'ancrage et la date de début du cycle [P]. */
  cycleState?: { closedPeriods: number; frozen: boolean };
  principal: {
    budgetId: string;
    coreProjectId: string;
    project: { id: string; title: string; description: string };
    patrimoine: { id: string; openingStockCents: number | null; openingDate: string | null; objectiveCents: number | null; revision: number };
    cycle: { id: string; anchorDay: number | null; startDate: string | null; state: 'active' | 'to_configure'; revision: number };
    vision: Vision;
    revision: number;
  };
  budgetType: BpmBudgetType;
  suggestions: { direction: Direction; label: string; costCenterRef: string; amount: null; cadence: Cadence }[];
  goals: LifeGoal[];
  goalTypes: { key: GoalType; label: string; consumes: boolean }[];
  centers: { ref: string; label: string; direction: Direction; standard: boolean }[];
  note: string;
}

export interface SetupInput {
  requestKey: string;
  mode: 'principal' | 'branch';
  project?: { name?: string; description?: string };
  tasks?: { title: string; description?: string; plannedHours?: number | null }[];
  customCenters?: { tempRef: string; label: string; direction: Direction }[];
  entries?: (Partial<EntryInput> & { recurrenceId?: string })[];
  caps?: Record<string, number | null>;
  patrimoine?: { openingStock?: number | null; openingDate?: string | null; objective?: number | null };
  cycle?: { anchorDay: number | null; startDate?: string | null };
  vision?: Partial<{ horizonYears: number; annualReturnPct: number | null; inflationPct: number; inflationSource: string; contribution: number | null; contributionCadence: string; savingsTarget: number | null; surplus: { target: number; periods: number; startKey: string } | null }>;
  goals?: { goalId?: string; label: string; type: GoalType; date: string; targetToday: number }[];
}

export interface SetupResult {
  replayed: boolean;
  mode: 'principal' | 'branch';
  bpmCompositionId: string;
  created: string[];
  updated: string[];
  budgetId?: string;
  coreProjectId?: string;
  taskIds?: string[];
}
