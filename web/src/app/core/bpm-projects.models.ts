import { RegisterLine } from './bpm-models';
import { ProjectSummary, TaskView } from './models';

/**
 * Projets de la vie dans BPM (contrats de `api/src/modules/bpm/projects.mjs`). Les projets et les tâches sont ceux
 * du noyau ; BPM porte leur budget : montant attribué par le budget de vie, parts des tâches, dépassements, retours.
 * Montants en centimes entiers.
 */
export type ProjectBudgetState = 'unallocated' | 'ok' | 'at-risk' | 'deficit';
export type OverrunStatus = 'pending' | 'approved' | 'refused' | 'billed';
export type OverrunReason = 'ventilation' | 'reglement';
export type ReturnCadence = 'once' | 'weekly' | 'monthly' | 'yearly';

export interface TaskBudgetRequest {
  id: string;
  revision: number;
  budgetId: string;
  taskId: string;
  coreProjectId: string;
  taskTitle: string;
  budgetName: string;
  amountCents: number;
  grantedCents: number | null;
  note: string | null;
  status: 'pending' | 'awaiting-life' | 'approved' | 'refused' | 'cancelled';
  statusLabel: string;
  requestedAt: string;
  decidedAt: string | null;
  overrunId: string | null;
}

export interface BpmProjectInput {
  requestKey: string;
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  startDate?: string | null;
  dueDate?: string | null;
  amount?: number | null;
}

export interface BpmTaskInput {
  requestKey: string;
  title: string;
  description?: string;
  projectId?: string | null;
  status?: 'todo' | 'blocked' | 'doing' | 'done';
  plannedHours?: number | null;
  spentHours?: number;
  startDate?: string | null;
  dueDate?: string | null;
}

export interface TaskReturn {
  label: string;
  amountCents: number;
  cadence: ReturnCadence;
  cadenceLabel?: string;
  entryId: string | null;
  entryKind: 'operation' | 'recurrence' | null;
  triggeredAt: string | null;
}

export interface ProjectOverrun {
  id: string;
  revision: number;
  budgetId: string;
  taskId: string | null;
  reason: OverrunReason;
  reasonLabel: string;
  amountCents: number;
  note: string | null;
  status: OverrunStatus;
  statusLabel: string;
  requestedAt: string;
  decidedAt: string | null;
  billingDate: string | null;
  periodKey: string | null;
  billedAt: string | null;
  taskTitle: string | null;
  budgetName: string | null;
  coreProjectId: string | null;
}

export interface ProjectBudget {
  budgetId: string;
  name: string;
  coreProjectId: string;
  parentBudgetId: string;
  revision: number;
  regime: boolean;
  taskFundingRequired: boolean;
  allocationCents: number | null;
  allocationDate: string | null;
  initialAllocationCents: number | null;
  approvedOverrunCents: number;
  billedOverrunCents: number;
  pendingOverrun: ProjectOverrun | null;
  ceilingCents: number | null;
  sharesCents: number;
  availableCents: number | null;
  engagedCents: number;
  paidCents: number;
  remainingCents: number | null;
  toPayCents: number;
  uncommittedCents: number | null;
  periodPaidCents: number | null;
  pendingRequestsCents: number;
  paidBeforeAllocationCents: number;
  unsharedChargesCents: number;
  state: ProjectBudgetState;
  deficit: boolean;
  nextBillingDate: string | null;
  byTask: Record<string, { engagedCents: number; paidCents: number; unbounded: boolean }>;
  shares: Record<string, number>;
  returns: Record<string, TaskReturn>;
}

export interface ProjectsContext {
  user: { id: string; label: string; userType: string };
  lifeBudget: { budgetId: string; name: string; coreProjectId: string };
  period: { key: string; label: string; start: string; end: string } | null;
  cycleState: 'active' | 'to_configure';
  calculationDate: string;
  revision: number;
}

export interface BpmProjectCard extends ProjectSummary {
  role: 'life' | 'standard';
  budget: ProjectBudget | null;
}

export interface LifeSummary {
  budgetId: string;
  projectCount: number;
  fundedCount: number;
  allocatedCents: number;
  paidCents: number;
  approvedOverrunCents: number;
  sharesCents: number;
  availableCents: number;
  remainingCents: number;
  periodPaidCents: number | null;
  taskRequests: TaskBudgetRequest[];
  deficitCount: number;
  pendingRequests: ProjectOverrun[];
  billable: ProjectOverrun[];
  billableCents: number;
  nextBillingDate: string | null;
}

export interface BpmProjectsOverview {
  context: ProjectsContext;
  lifeProject: BpmProjectCard;
  life: LifeSummary;
  projects: BpmProjectCard[];
  candidates: { projectId: string; title: string; taskCount: number }[];
}

export interface TaskBudget {
  shareCents: number | null;
  engagedCents: number;
  paidCents: number;
  remainingCents: number | null;
  over: boolean;
  unbounded: boolean;
  return: TaskReturn | null;
  request: TaskBudgetRequest | null;
  timeConsumptionPercent: number | null;
  timeConsumedCents: number | null;
  timeRemainingCents: number | null;
}

export interface BpmTaskCard extends TaskView {
  projectRole: 'life' | 'standard' | null;
  budgetId: string | null;
  budget: TaskBudget | null;
  affectedProjects?: ProjectSummary[];
  effects?: { module: string; kind: string; message: string; ids: string[] }[];
}

export interface BpmTasksOverview {
  context: ProjectsContext;
  projects: { projectId: string; title: string; role: 'life' | 'standard'; budgetId: string }[];
  tasks: BpmTaskCard[];
  attachable: BpmTaskCard[];
}

export interface CycleCheck {
  code: string;
  level: 'ok' | 'info' | 'warning';
  taskId: string | null;
  message: string;
}

export interface ProjectChargeLine extends Omit<RegisterLine, 'status' | 'statusLabel' | 'centerKnown'> {
  validated: boolean;
  beforeAllocation: boolean;
}

export interface BpmProjectDetail {
  context: ProjectsContext;
  role: 'life' | 'standard';
  project: ProjectSummary;
  budget: ProjectBudget | null;
  tasks: BpmTaskCard[];
  attachable: BpmTaskCard[];
  overruns: ProjectOverrun[];
  checks: CycleCheck[];
  requests: TaskBudgetRequest[];
  charges: ProjectChargeLine[];
  life: (LifeSummary & { projects: { projectId: string; title: string; budget: ProjectBudget }[] }) | null;
  effects?: { module: string; kind: string; message: string; ids: string[] }[];
}

/** Détails d'un refus « autorisation de dépassement requise » (API). */
export interface OverrunRefusal {
  reason: OverrunReason;
  budgetId: string;
  taskId: string | null;
  overrunCents: number;
  ceilingCents: number;
}

export const BUDGET_STATE_LABEL: Record<ProjectBudgetState, string> = {
  unallocated: 'Sans budget attribué',
  ok: 'Dans son budget',
  'at-risk': 'Engagé au-delà du budget',
  deficit: 'En dépassement',
};
