// Contrats lus depuis l'API J1. Le site restitue ces projections ; il ne recalcule pas les règles métier.

export type TaskStatus = 'todo' | 'blocked' | 'doing' | 'done';
export type ProjectStatus = 'planned' | 'active' | 'done' | 'paused' | 'onHold' | 'toResume' | 'toFinish';
export type Priority = 'low' | 'medium' | 'high';

export const COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: 'À faire' },
  { id: 'blocked', label: 'À prioriser' },
  { id: 'doing', label: 'En cours' },
  { id: 'done', label: 'Terminée' },
];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'À faire',
  blocked: 'À prioriser',
  doing: 'En cours',
  done: 'Terminée',
};

export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Basse', medium: 'Moyenne', high: 'Élevée' };

interface ObjectMeta {
  id: string;
  kind: string;
  userId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  provenance: { command: string; requestKey: string | null; at: string };
}

export interface CoreProject extends ObjectMeta {
  title: string;
  description: string;
  priority: Priority;
  startDate: string | null;
  dueDate: string | null;
}

export interface Task extends ObjectMeta {
  title: string;
  description: string;
  projectId: string | null;
  status: TaskStatus;
  plannedHours: number | null;
  spentHours: number;
  startDate: string | null;
  dueDate: string | null;
}

export interface TimeAggregates {
  taskCount: number;
  estimatedTaskCount: number;
  missingEstimateCount: number;
  plannedHoursKnown: number;
  plannedIsPartial: boolean;
  spentHoursTotal: number;
  spentToPlannedPercent: number | null;
}

export interface ProjectView {
  projectId: string;
  status: ProjectStatus;
  statusLabel: string;
  column: TaskStatus;
  columnLabel: string;
  explanation: string;
  taskIds: string[];
  countsByStatus: Record<TaskStatus, number>;
  doneCount: number;
  completionPercent: number;
  time: TimeAggregates;
}

export interface Enrichment {
  kind: 'life' | 'standard';
  branches?: { budgetId: string; budgetName: string; coreProjectId: string; projectTitle: string | null }[];
  label: string;
  budgetId: string;
  budgetName: string;
  parentBudgetId: string | null;
  parentBudgetName?: string | null;
  patrimoineId?: string | null;
  bpmCompositionId?: string | null;
}

export interface ProjectPathways {
  canAddTask: boolean;
  isTaskDestination: boolean;
  tasksCanChangeProject: boolean;
  note: string | null;
}

export interface ProjectSummary {
  project: CoreProject;
  view: ProjectView;
  enrichment: Enrichment | null;
  pathways: ProjectPathways;
}

export interface TaskView {
  task: Task;
  projectTitle: string | null;
  qualification: { code: string; label: string; budgetIdDerived: string | null };
  pathways: { canChangeProject: boolean };
}

export interface ProjectDetail extends ProjectSummary {
  tasks: TaskView[];
  branches: { budgetId: string; budgetName: string; coreProjectId: string; projectTitle: string | null }[];
  financial: { status: string; note: string };
  replayed?: boolean;
}

export interface TaskMutationResult extends TaskView {
  written?: boolean;
  replayed?: boolean;
  affectedProjects?: ProjectSummary[];
}

export interface TestUser {
  id: string;
  label: string;
  userType: string;
  userTypeLabel: string;
  principalBudgetId: string | null;
  bpmCompositionId: string | null;
  cycleState: 'active' | 'to_configure' | null;
  /** Opérations et définitions récurrentes du user. */
  entryCount?: number;
}

export interface UserType {
  key: string;
  label: string;
}

/** Résultat de la composition initiale (niveau 3) déclenchée par la création d'un user. */
export interface UserBundleResult {
  userId: string;
  coreProjectId: string;
  budgetId: string;
  patrimoineId: string;
  bpmCompositionId: string;
  cycleLinkId: string;
  replayed: boolean;
}

export interface ApiErrorBody {
  code: string;
  action: string | null;
  message: string;
  details?: Record<string, unknown> & { current?: unknown; field?: string };
}

// ---------------------------------------------------------------------------
// Calcul : chaque chiffre présenté est une métrique dont la formule est administrée.
// ---------------------------------------------------------------------------

export type MetricUnit = 'EUR' | '%';

export interface FigureSource {
  id: string;
  kind: string;
  label: string;
  amount: number | null;
  date: string | null;
  status?: string;
}

/** Entrée d'une explication : variable (données sources) ou métrique imbriquée. */
export interface FigureInput {
  name: string;
  type: 'variable' | 'metric' | 'unknown';
  label: string;
  unit?: MetricUnit;
  module?: string;
  description?: string | null;
  value: number | null;
  status: 'ok' | 'unavailable';
  note?: string | null;
  sources: FigureSource[];
  // métrique imbriquée
  formula?: string;
  explanation?: string;
  parameter?: MetricParameterRef;
  inputs?: FigureInput[];
}

export interface MetricParameterRef {
  key: string;
  revision: number | null;
  origin: string;
  updatedAt?: string | null;
  isDefault?: boolean;
}

export interface Period {
  key: string;
  start: string;
  end: string;
  label: string;
  status?: 'closed' | 'ended' | 'current' | 'future';
  closureId?: string | null;
}

/** Évaluation d'un chiffre : valeur ET chemin de calcul jusqu'aux objets sources. */
export interface FigureEvaluation {
  key: string;
  label: string;
  unit: MetricUnit;
  decimals: number;
  description: string | null;
  module: string;
  value: number | null;
  status: 'ok' | 'unavailable';
  unavailableReason: string | null;
  formula: string;
  parameter: MetricParameterRef;
  explanation: string;
  inputs: FigureInput[];
  period: Period | null;
  /** Période close : valeur enregistrée à la clôture (C01), jamais recalculée. */
  recorded?: boolean;
  recordedAt?: string;
  closureId?: string;
  note?: string;
}

/** Écart entre la valeur enregistrée à la clôture et un recalcul avec la formule courante (C01). */
export interface FigureComparison {
  key: string;
  label: string;
  recorded: number | null;
  recomputed: number | null;
  recordedFormula: string | null;
  currentFormula: string;
}

/** Aperçu de clôture (C02) : même contrat que la commande ; montant réellement capitalisé. */
export interface ClosingPreview {
  periodKey: string;
  periodLabel: string;
  capitalizationDate: string;
  resultCents: number;
  result: number;
  formula: string;
  parameter: MetricParameterRef;
  explanation: string;
  stockBefore: number | null;
  stockAfter: number | null;
  conditions: string[];
}

// ---------------------------------------------------------------------------
// Niveau 2 : Budget et Patrimoine (interfaces de test)
// ---------------------------------------------------------------------------

export type Direction = 'income' | 'charge';

export interface CostCenter {
  ref: string;
  key?: string;
  id?: string;
  label: string;
  direction: Direction;
  directionLabel: string;
  standard: boolean;
}

export interface Operation extends ObjectMeta {
  budgetId: string;
  budgetName: string | null;
  direction: Direction;
  directionLabel: string;
  label: string;
  amountCents: number;
  amount: number;
  date: string;
  status: 'planned' | 'realized';
  realizedAmountCents: number | null;
  realizedAmount: number | null;
  realizedDate: string | null;
  standardCostCenter: string | null;
  costCenterId: string | null;
  costCenterRef: string;
  costCenterLabel: string | null;
}

export interface BudgetObject extends ObjectMeta {
  role: 'life' | 'standard';
  name: string;
  coreProjectId: string;
  parentBudgetId: string | null;
  projectTitle: string | null;
  parentBudgetName: string | null;
  operationCount: number;
  realizedCount: number;
}

export interface Capitalization extends ObjectMeta {
  patrimoineId: string;
  amountCents: number;
  amount: number;
  date: string;
  label: string;
  source: { kind: string; id: string } | null;
}

export interface PatrimoineRead {
  patrimoine: ObjectMeta & {
    label: string;
    coreProjectId: string;
    principalBudgetId: string;
    openingStockCents: number | null;
    openingStock: number | null;
    openingDate: string | null;
    objectiveCents: number | null;
    objective: number | null;
  };
  capitalizations: Capitalization[];
  raw: { openingStock: number | null; capitalized: number };
}

// ---------------------------------------------------------------------------
// Niveau 3 : application BPM
// ---------------------------------------------------------------------------

export interface CycleLink extends ObjectMeta {
  bpmCompositionId: string;
  frequency: 'monthly';
  anchorDay: number | null;
  startDate: string | null;
  state: 'active' | 'to_configure';
  periods: Period[]; // une page, du plus récent au plus ancien (C10)
  periodsTotal: number;
  nextBefore: number | null;
  currentKey: string | null;
  firstOpenKey: string | null;
}

export interface Closure extends ObjectMeta {
  cycleLinkId: string;
  budgetId: string;
  patrimoineId: string;
  capitalizationId: string;
  periodKey: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  resultCents: number;
  result: number;
  budgetBalanceAfterCents: number;
  calculation: { metric: string; formula: string; parameter: MetricParameterRef; explanation: string; inputs: { name: string; label: string; value: number | null }[] };
  sourceOperationIds: string[];
}

export interface DashboardSection {
  id?: string;
  title: string;
  metrics: string[];
}

export interface LifeProject {
  budgetId: string;
  name: string;
  coreProjectId: string;
  project: CoreProject;
  view: ProjectView;
}

export interface BpmDashboard {
  user: { id: string; label: string; userType: string; userTypeLabel: string };
  composition: { id: string; budgetId: string; patrimoineId: string; coreProjectId: string };
  cycle: CycleLink | null;
  period: Period | null;
  closure: Closure | null;
  closing: { possible: boolean; reason: string | null; preview: ClosingPreview | null };
  sections: DashboardSection[];
  figures: Record<string, FigureEvaluation>;
  comparison: FigureComparison[];
  operations: Operation[];
  lifeProjects: LifeProject[];
  patrimoine: { id: string; revision: number; openingStock: number | null; openingDate: string | null; objective: number | null };
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export interface ModuleDescription {
  id: string;
  label: string;
  level: 0 | 1 | 2 | 3;
  levelLabel: string;
  dependsOn: string[];
  kinds: string[];
  parameters: number;
  variables: number;
  metrics: number;
}

export interface ParameterHistoryEntry {
  revision: number;
  value: unknown;
  at: string;
  note: string | null;
  previous: unknown;
}

export interface EffectiveParameter {
  key: string;
  label: string;
  description: string | null;
  module: string;
  group: string;
  type: 'formula' | 'number' | 'integer' | 'text' | 'list' | 'object' | 'boolean';
  scope: string;
  unit: string | null;
  value: unknown;
  defaultValue: unknown;
  origin: 'administration' | 'défaut du code';
  revision: number;
  updatedAt: string | null;
  history: ParameterHistoryEntry[];
}

export interface MetricDefinitionRow {
  key: string;
  label: string;
  unit: MetricUnit;
  decimals: number;
  group: string | null;
  module: string;
  description: string | null;
  formula: string;
  defaultFormula: string;
  references: string[];
  parameter: { key: string; revision: number; origin: string; updatedAt: string | null; history: ParameterHistoryEntry[] };
}

export interface FormulaReference {
  name: string;
  type: 'variable' | 'metric';
  label: string;
  unit: string;
  module: string;
  description: string | null;
}

export interface MetricCatalog {
  metrics: MetricDefinitionRow[];
  references: FormulaReference[];
  functions: string[];
}

export interface JournalEntry {
  at: string;
  command: string;
  userId: string | null;
  requestKey: string | null;
  created: string[];
  updated: string[];
  outcome: string;
}

export interface RecentError {
  at: string;
  command: string;
  userId: string | null;
  code: string;
  message: string;
}
