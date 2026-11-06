// Gestion du projet de vie (GET /api/bpm/life-management) : lecture de pilotage du projet unique du user.
// Montants en centimes (`…Cents`) ; null = inconnu ou non calculable.
import { BpmContextInfo, ChargeNature } from './bpm-models';
import { LifeFunding, ProjectOverrun } from './bpm-projects.models';

export type LifeHealth = 'ok' | 'watch' | 'alert' | 'unknown';
export type LifeVoletKey = 'cycle' | 'indispensable' | 'courante' | 'projets' | 'resultats' | 'patrimoine';

export interface LifeHealthInfo {
  health: LifeHealth;
  healthLabel: string;
  alert: string | null;
}

export interface LifeLine {
  id: string;
  label: string;
  direction: 'income' | 'charge';
  nature: ChargeNature | null;
  plannedDate: string;
  plannedCents: number;
  realizedDate: string | null;
  realizedCents: number | null;
  settled: boolean;
  status: 'settled' | 'due' | 'late' | 'pending' | 'unrealized';
  statusLabel: string;
  costCenterRef: string | null;
  costCenterLabel: string | null;
  cadenceLabel: string | null;
  /** Dépense prévue d'un projet de la vie (échéances à régler du projet de vie). */
  project?: { budgetId: string; coreProjectId: string; name: string; funded: boolean; taskTitle: string | null };
}

export interface LifeCycle extends LifeHealthInfo {
  key: 'cycle';
  label: string;
  /** Période lue : en cours, clôturée, ou terminée sans clôture ; null si le cycle est à configurer. */
  reading: 'current' | 'closed' | 'ended' | null;
  closedResultCents: number | null;
  status: 'active' | 'to_configure';
  anchorDay: number | null;
  startDate: string | null;
  period: { key: string; label: string; start: string; end: string; status: string } | null;
  days: { total: number; elapsed: number; left: number; elapsedPct: number | null } | null;
  closedCount: number;
  toCloseCount: number;
  flows: {
    receivedCents: number | null;
    toReceiveCents: number | null;
    paidCents: number | null;
    toPayCents: number | null;
    netCents: number | null;
    expectedCents: number | null;
    initialBudgetCents: number | null;
    gapToInitialCents: number | null;
    savingsRatePct: number | null;
    consumptionPct: number | null;
    projectsPaidCents: number | null;
    incomeCount: number;
    receivedCount: number;
    /** Prévu dans ce cycle, reçu ou payé dans un cycle antérieur (déjà dans son résultat). */
    advanceReceivedCents: number | null;
    advanceReceivedCount: number;
    advancePaidCents: number | null;
    /** Solde prévu si les avances avaient été réglées à leur date prévue. */
    balancedCents: number | null;
    /** Reçu − prévu sur les entrées déjà reçues du cycle. */
    incomeGapCents?: number;
    lateIncomeCents: number;
    lateIncomeCount: number;
    /** Lignes de la période restées sans règlement à sa clôture (hors résultat). */
    unrealizedIncomeCents?: number;
    unrealizedIncomeCount?: number;
    unrealizedChargeCents?: number;
    unrealizedChargeCount?: number;
    nextIncome: LifeLine | null;
    incomeLines: LifeLine[];
  } | null;
}

export interface LifeNatureRow {
  ref: string;
  label: string;
  paidCents: number;
  toPayCents: number;
  plannedCents: number;
  capCents: number | null;
  marginCents: number | null;
  over: boolean;
  lateCount: number;
  lineCount: number;
}

export interface LifeNature extends LifeHealthInfo {
  key: 'indispensable' | 'courante';
  label: string;
  centers: { ref: string; label: string }[];
  paidCents: number;
  toPayCents: number;
  plannedCents: number;
  consumedPct: number | null;
  /** Réglé − prévu sur les échéances du cycle déjà réglées. */
  realizationGapCents?: number;
  /** Réglé dans ce cycle pour des échéances prévues dans un autre cycle. */
  otherCyclePaidCents?: number;
  shareOfPaidPct: number | null;
  lateCents: number;
  lateCount: number;
  dueTodayCount: number;
  settledCount: number;
  lineCount: number;
  capCents: number | null;
  marginCents: number | null;
  /** Postes et catégories au-delà de leur plafond (une catégorie n'est pas recomptée si son poste l'est). */
  overCount: number;
  /** Catégories plafonnées de cette nature, avec la même mesure que la revue des plafonds. */
  categories?: LifeNatureCategory[];
  monthlyAverageCents: number;
  next: LifeLine | null;
  rows: LifeNatureRow[];
  lines: LifeLine[];
  /** Charges courantes : disponible du cycle pour profiter, après épargne visée et provisions. */
  availableCents?: number | null;
  availableReason?: string | null;
  weeklyCents?: number | null;
}

export interface LifeNatureCategory {
  id: string | null;
  label: string;
  ref: string;
  capCents: number;
  engagedCents: number | null;
  marginCents: number;
  over: boolean;
  near: boolean;
}

export interface LifeProjectRow {
  budgetId: string;
  coreProjectId: string;
  name: string;
  status: string | null;
  statusLabel: string | null;
  regime: boolean;
  allocationCents: number | null;
  paidCents: number;
  remainingCents: number | null;
  periodPaidCents: number | null;
  state: 'unallocated' | 'ok' | 'at-risk' | 'deficit';
  pendingOverrun: boolean;
}

export interface LifeProjects extends LifeHealthInfo {
  key: 'projets';
  label: string;
  projectCount: number;
  fundedCount: number;
  unfundedCount: number;
  allocatedCents: number;
  paidCents: number;
  remainingCents: number;
  availableCents: number;
  approvedOverrunCents: number;
  periodPaidCents: number | null;
  pendingRequests: ProjectOverrun[];
  taskRequestCount: number;
  taskRequests?: { id: string; coreProjectId: string | null; budgetName: string; taskTitle: string; amountCents: number; grantedCents: number | null }[];
  billable: ProjectOverrun[];
  billableCents: number;
  nextBillingDate: string | null;
  deficitCount: number;
  projects: LifeProjectRow[];
  funding: LifeFunding | null;
}

export interface LifeClosureRow {
  closureId: string;
  periodKey: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  resultCents: number;
  closedAt: string;
  targetCents: number | null;
  meetsTarget: boolean | null;
}

export interface LifeClosingPreview {
  periodKey: string;
  periodLabel: string;
  capitalizationDate: string;
  resultCents: number;
  stockBefore: number | null;
  stockAfter: number | null;
  conditions: string[];
}

export interface LifeResults extends LifeHealthInfo {
  key: 'resultats';
  label: string;
  rows: LifeClosureRow[];
  count: number;
  positiveCount: number;
  negativeCount: number;
  zeroCount: number;
  metCount: number;
  totalCents: number;
  averageCents: number | null;
  best: LifeClosureRow | null;
  worst: LifeClosureRow | null;
  last: LifeClosureRow | null;
  savingsTargetCents: number | null;
  surplus: {
    targetCents: number;
    periods: number;
    startKey: string;
    endKey: string;
    perPeriodCents: number;
    cumulatedCents: number;
    closedPeriods: number;
    progressPct: number | null;
    targetToDateCents: number;
    gapCents: number;
    onTrack: boolean;
    remainingPeriods: number;
    remainingCents: number;
    requiredPerPeriodCents: number | null;
    reached: boolean;
  } | null;
  current: { periodKey: string; expectedCents: number | null; targetCents: number | null; meetsTarget: boolean | null } | null;
  toCloseCount: number;
  firstOpen: { key: string; label: string; start: string; end: string; status: string } | null;
  closing: { possible: boolean; reason: string | null; preview: LifeClosingPreview | null } | null;
  surplusUseNote: string;
}

export interface LifePatrimoine extends LifeHealthInfo {
  key: 'patrimoine';
  label: string;
  patrimoineId: string;
  stockCents: number | null;
  stockReason: string | null;
  effectCents: number | null;
  afterCents: number | null;
  expectedAfterCents: number | null;
  objectiveCents: number | null;
  progressPct: number | null;
  remainingCents: number | null;
  openingStockCents: number | null;
  openingDate: string | null;
  capitalizedCents: number;
  capitalizationCount: number;
  surplusUseNote: string;
}

export interface BpmLifeManagement {
  context: BpmContextInfo;
  lifeProject: { coreProjectId: string; title: string; description: string | null; budgetId: string; patrimoineId: string; compositionId: string };
  pilot: { volets: ({ key: LifeVoletKey; label: string } & LifeHealthInfo)[]; counts: Record<LifeHealth, number> };
  cycle: LifeCycle;
  natures: { indispensable: LifeNature; courante: LifeNature };
  projects: LifeProjects;
  results: LifeResults;
  patrimoine: LifePatrimoine;
  budgetType: { empty: boolean; averageIncomeCents: number; averageChargeCents: number; averageNetCents: number; byNature: { indispensable: number; courante: number } };
  directives: { savingsCents: number | null; provisionsCents: number | null; availableCents: number | null; weeklyCents: number | null };
  dueSoon: { from: string; to: string; lines: LifeLine[]; lateCount: number; projectCount?: number };
  essentials: { parameter: string; refs: string[]; labels: string[] };
}
