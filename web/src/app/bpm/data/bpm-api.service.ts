import { CapPreview } from './bpm-caps.models';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../../core/api.service';
import {
  BpmBalance,
  BpmBudgetType,
  BpmCenterDetail,
  BpmCenters,
  BpmDirectives,
  BpmDue,
  BpmEvents,
  BpmHistory,
  BpmImpact,
  BpmIncomes,
  BpmProjection,
  BpmRegister,
  BpmSummary,
  EntryInput,
  EntryPreview,
  LifeGoal,
  LineDetail,
  Recurrence,
  RegisterQuery,
  SetupInput,
  SetupProfile,
  SetupResult,
  Vision,
} from './bpm-models';
import { BpmLifeManagement } from './bpm-life.models';
import { BpmBilanDetail, BpmBilans } from './bpm-bilans.models';
import { ClosingBrief, ClosingDecision, ClosingFinalized, ClosingJourney } from './bpm-closing.models';
import { BpmMeteo } from './bpm-meteo.models';
import { BpmFinancialOutlook, BpmProjectFlows } from './bpm-flow.models';
import { CapAlert, CapsReview, SpendingCaps } from './bpm-caps.models';
import { BpmDashboard, Closure, CostCenter, FigureEvaluation, LifeProject, Operation, PatrimoineRead } from '../../core/models';
import { BpmProjectDetail, BpmProjectInput, BpmProjectsOverview, BpmTaskInput, BpmTasksOverview, CycleCheck, ProjectAbandonPreview, ProjectOverrun, ReturnCadence, TaskBudgetRequest } from './bpm-projects.models';

type Query = Record<string, string | number | null | undefined>;

/** Client des lectures communes et des commandes BPM. Les montants saisis restent en euros ; l'API stocke des centimes. */
@Injectable({ providedIn: 'root' })
export class BpmApi {
  private http = inject(HttpClient);

  private async run<T>(p: Promise<T>): Promise<T> {
    try {
      return await p;
    } catch (err) {
      throw toApiError(err);
    }
  }
  private params(q: Query = {}) {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
    return p;
  }
  private get<T>(url: string, q?: Query) {
    return this.run(firstValueFrom(this.http.get<T>(url, { params: this.params(q) })));
  }
  private post<T>(url: string, body: unknown) {
    return this.run(firstValueFrom(this.http.post<T>(url, body)));
  }
  private put<T>(url: string, body: unknown) {
    return this.run(firstValueFrom(this.http.put<T>(url, body)));
  }

  // ---------- lectures ----------

  summary(period?: string) {
    return this.get<BpmSummary>('/api/bpm/summary', { period });
  }
  register(q: RegisterQuery = {}) {
    return this.get<BpmRegister>('/api/bpm/register', q as Query);
  }
  projectFlows(q: { source: 'cycle' | 'patrimoine' | 'all'; period?: string; projectId?: string } ) {
    return this.get<BpmProjectFlows>('/api/bpm/project-flows', q);
  }
  financialOutlook(horizon = 3) {
    return this.get<BpmFinancialOutlook>('/api/bpm/financial-outlook', { horizon });
  }
  line(id: string, period?: string) {
    return this.get<LineDetail>(`/api/bpm/lines/${encodeURIComponent(id)}`, { period });
  }
  centers(q: { period?: string; direction?: 'charge' | 'income'; all?: boolean } = {}) {
    return this.get<BpmCenters>('/api/bpm/centers', { period: q.period, direction: q.direction, all: q.all ? 'true' : undefined });
  }
  center(ref: string, period?: string) {
    return this.get<BpmCenterDetail>(`/api/bpm/centers/${encodeURIComponent(ref)}`, { period });
  }
  incomes(period?: string) {
    return this.get<BpmIncomes>('/api/bpm/incomes', { period });
  }
  balance(q: { period?: string; initial?: string; current?: string } = {}) {
    return this.get<BpmBalance>('/api/bpm/balance', q);
  }
  history(q: { before?: number | null; limit?: number } = {}) {
    return this.get<BpmHistory>('/api/bpm/history', q);
  }
  impact(period?: string) {
    return this.get<BpmImpact>('/api/bpm/impact', { period });
  }
  budgetType() {
    return this.get<BpmBudgetType>('/api/bpm/budget-type');
  }
  due() {
    return this.get<BpmDue>('/api/bpm/due');
  }
  events() {
    return this.get<BpmEvents>('/api/bpm/events');
  }
  directives() {
    return this.get<BpmDirectives>('/api/bpm/directives');
  }
  /** Gestion du projet de vie : cycle, charges par nature, projets financés, résultats des cycles, patrimoine. */
  lifeManagement(period?: string) {
    return this.get<BpmLifeManagement>('/api/bpm/life-management', { period });
  }
  /** Projection ou simulation (paramètres facultatifs : aucune écriture). */
  projection(q: { basis?: 'savings-goal'; horizon?: number; rate?: number; inflation?: number; contribution?: number; extra?: number } = {}) {
    return this.get<BpmProjection>('/api/bpm/projection', q);
  }
  goals() {
    return this.get<LifeGoal[]>('/api/bpm/goals');
  }
  recurrences(budgetId?: string) {
    return this.get<Recurrence[]>('/api/bpm/recurrences', { budgetId });
  }
  setupProfile() {
    return this.get<SetupProfile>('/api/bpm/setup');
  }
  costCenters() {
    return this.get<CostCenter[]>('/api/bpm/cost-centers');
  }

  // ---------- aperçu (aucune mutation) ----------

  previewCaps(input: Partial<EntryInput> & { replaceId?: string; settle?: boolean; recurrenceId?: string; occurrenceDate?: string }) {
    return this.post<CapPreview>('/api/bpm/caps/preview', input);
  }

  previewEntry(input: Partial<EntryInput>) {
    return this.post<EntryPreview>('/api/bpm/operations/preview', input);
  }

  // ---------- commandes ----------

  /** Éditeur partagé : ponctuelle → opération ; cadence → définition récurrente. */
  createEntry(input: EntryInput & { requestKey: string }) {
    return this.post<{ replayed: boolean; operation?: Operation; recurrence?: Recurrence; capAlerts?: CapAlert[] }>('/api/bpm/operations', input);
  }
  updateOperation(id: string, body: Record<string, unknown> & { expectedRevision: number }) {
    return this.put<{ operation: Operation; capAlerts?: CapAlert[] }>(`/api/bpm/operations/${encodeURIComponent(id)}`, body);
  }
  /** `fund` : la part et le dépassement nécessaires au règlement sont accordés dans la même écriture. */
  realizeOperation(id: string, body: { expectedRevision: number; realizedAmount?: number; realizedDate?: string; accountingDate?: string; fundingSource?: 'cycle' | 'patrimoine'; fund?: boolean }) {
    return this.post<{ operation: Operation; capAlerts?: CapAlert[] }>(`/api/bpm/operations/${encodeURIComponent(id)}/realize`, body);
  }
  cancelRealization(id: string, expectedRevision: number) {
    return this.post<{ operation: Operation }>(`/api/bpm/operations/${encodeURIComponent(id)}/cancel-realization`, { expectedRevision });
  }
  /** Annule une saisie ponctuelle (doublon, erreur) : elle sort des sommes, refusé dans une période close. */
  cancelOperation(id: string, expectedRevision: number, reason?: string) {
    return this.post<{ operation: Operation }>(`/api/bpm/operations/${encodeURIComponent(id)}/cancel`, { expectedRevision, reason });
  }
  updateRecurrence(id: string, body: Record<string, unknown> & { expectedRevision: number }) {
    return this.put<{ recurrence: Recurrence; scope: { appliesTo: string; settledUntouched: number; settledUpdated?: string[]; settledRemoved?: string[] }; capAlerts?: CapAlert[] }>(`/api/bpm/recurrences/${encodeURIComponent(id)}`, body);
  }
  settleOccurrence(recurrenceId: string, body: { requestKey: string; occurrenceDate: string; realizedAmount?: number; realizedDate?: string; accountingDate?: string; fundingSource?: 'cycle' | 'patrimoine'; note?: string; fund?: boolean }) {
    return this.post<{ replayed: boolean; operation: Operation; capAlerts?: CapAlert[] }>(`/api/bpm/recurrences/${encodeURIComponent(recurrenceId)}/settle`, body);
  }
  /** Écarte une échéance qui n'aura pas lieu : elle sort des sommes, la définition continue. */
  skipOccurrence(recurrenceId: string, body: { requestKey: string; occurrenceDate: string; reason?: string }) {
    return this.post<{ replayed: boolean; operation: Operation }>(`/api/bpm/recurrences/${encodeURIComponent(recurrenceId)}/skip`, body);
  }
  /** Rétablit une échéance écartée : elle redevient attendue. */
  restoreOccurrence(recurrenceId: string, body: { occurrenceDate: string; expectedRevision: number }) {
    return this.post<{ operation: Operation }>(`/api/bpm/recurrences/${encodeURIComponent(recurrenceId)}/restore`, body);
  }
  /** Supprime une définition saisie par erreur, tant qu'aucune échéance n'est réglée. */
  /** `removeIn` : les règlements de la définition qui comptent dans la fenêtre sont annulés avec elle. */
  cancelRecurrence(id: string, expectedRevision: number, reason?: string, removeIn?: { from: string; to: string }) {
    return this.post<{ recurrence: Recurrence }>(`/api/bpm/recurrences/${encodeURIComponent(id)}/cancel`, { expectedRevision, reason, ...(removeIn ? { removeIn } : {}) });
  }
  addCostCenter(body: { requestKey: string; label: string; direction: 'income' | 'charge' }) {
    return this.post<{ replayed: boolean; costCenterId: string; costCenters: CostCenter[] }>('/api/bpm/cost-centers', body);
  }
  /** Plafonds des centres (euros) ; `merge` ne change que les centres fournis (null retire le plafond). */
  setCaps(body: { expectedRevision: number; caps: Record<string, number | null>; merge?: boolean }) {
    return this.put<unknown>('/api/bpm/caps', body);
  }

  // ---------- plafonds de dépenses : un par poste (jamais bloquants) ----------

  spendingCaps(period?: string) {
    return this.get<SpendingCaps>('/api/bpm/spending-caps', { period });
  }
  /** Revue des plafonds de la période : postes et charges en cause (récurrence, antériorité). */
  capsReview(period?: string) {
    return this.get<CapsReview>('/api/bpm/caps-review', { period });
  }
  updateVision(body: Record<string, unknown> & { expectedRevision: number }) {
    return this.put<{ revision: number; vision: Vision }>('/api/bpm/vision', body);
  }
  createGoal(body: { requestKey: string; label: string; type: string; date: string; targetToday: number }) {
    return this.post<{ replayed: boolean; goal: LifeGoal }>('/api/bpm/goals', body);
  }
  updateGoal(id: string, body: { expectedRevision: number; label?: string; type?: string; date?: string; targetToday?: number }) {
    return this.put<{ goal: LifeGoal }>(`/api/bpm/goals/${encodeURIComponent(id)}`, body);
  }
  removeGoal(id: string, expectedRevision: number) {
    return this.post<{ removed: true }>(`/api/bpm/goals/${encodeURIComponent(id)}/remove`, { expectedRevision });
  }
  setup(input: SetupInput) {
    return this.post<SetupResult>('/api/bpm/setup', input);
  }
  closePeriod(body: { requestKey: string; periodKey: string; expectedResultCents: number }) {
    return this.post<{ replayed: boolean; closure: Closure }>('/api/bpm/closures', body);
  }
  /** Parcours de clôture : phase, points à suivre (ouverts, clos), complétude, aperçu, impacts, verrou. */
  closingJourney() {
    return this.get<ClosingJourney>('/api/bpm/closing');
  }
  /** Résumé de clôture pour le cadre des pages : mode clôture et états des points. */
  closingBrief() {
    return this.get<ClosingBrief>('/api/bpm/closing/brief');
  }
  /** Décision de clôture (report d'une échéance, compte vérifié), une fois le cycle terminé. */
  closingDecision(body: ClosingDecision) {
    return this.post<ClosingJourney>('/api/bpm/closing/decisions', body);
  }
  /** Clôture à 100 % : bilan figé, résultat capitalisé, reports inscrits, cycle suivant lancé. */
  finalizeClosing(body: { requestKey: string; periodKey: string; expectedResultCents: number }) {
    return this.post<ClosingFinalized>('/api/bpm/closing/finalize', body);
  }

  // ---------- projets de la vie (projets et tâches du noyau, budgets portés par le middleware Budget) ----------

  projectsOverview() {
    return this.get<BpmProjectsOverview>('/api/bpm/projects');
  }
  createProject(input: BpmProjectInput) {
    return this.post<{ replayed: boolean; coreProjectId: string; budgetId: string; detail: BpmProjectDetail }>('/api/bpm/projects', input);
  }
  createTask(input: BpmTaskInput) {
    return this.post<import('../../core/models').TaskMutationResult>('/api/bpm/tasks', input);
  }
  requestTaskBudget(budgetId: string, taskId: string, input: { requestKey: string; amount: number; note?: string }) {
    return this.post<{ request: TaskBudgetRequest }>(`/api/bpm/project-budgets/${encodeURIComponent(budgetId)}/requests/${encodeURIComponent(taskId)}`, input);
  }
  decideTaskBudget(id: string, decision: 'approve' | 'refuse' | 'cancel', expectedRevision: number, expectedBudgetRevision?: number) {
    return this.post<{ request: TaskBudgetRequest; detail: BpmProjectDetail }>(`/api/bpm/task-budget-requests/${encodeURIComponent(id)}/decision`, { decision, expectedRevision, expectedBudgetRevision });
  }
  projectDetail(coreProjectId: string) {
    return this.get<BpmProjectDetail>(`/api/bpm/projects/${encodeURIComponent(coreProjectId)}`);
  }
  tasksOverview() {
    return this.get<BpmTasksOverview>('/api/bpm/tasks');
  }
  /** Budgéter un projet du noyau : il devient un projet standard du budget de vie. */
  adoptProject(body: { requestKey: string; coreProjectId: string; name?: string }) {
    return this.post<{ budgetId: string; coreProjectId: string; detail: BpmProjectDetail }>('/api/bpm/projects/adopt', body);
  }
  /** Montant en euros attribué par le budget de vie. */
  /** `fundingSource` : source de financement ; modifiable tant qu'aucune dépense n'est comptabilisée. */
  allocate(budgetId: string, amount: number, expectedRevision: number, fundingSource?: 'cycle' | 'patrimoine') {
    return this.put<BpmProjectDetail>(`/api/bpm/project-budgets/${encodeURIComponent(budgetId)}/allocation`, { amount, expectedRevision, ...(fundingSource ? { fundingSource } : {}) });
  }
  /** Part d'une tâche en euros ; `null` la retire. */
  /** `authorizeOverrun` : au-delà de l'enveloppe, le manque est autorisé en dépassement dans la même écriture. */
  setTaskShare(budgetId: string, taskId: string, amount: number | null, expectedRevision: number, opts: { authorizeOverrun?: boolean; note?: string } = {}) {
    return this.put<BpmProjectDetail & { overrunCents: number }>(`/api/bpm/project-budgets/${encodeURIComponent(budgetId)}/shares/${encodeURIComponent(taskId)}`, { amount, expectedRevision, ...opts });
  }
  /** Tâche terminée : sa part non consommée revient à l'enveloppe. */
  /** Abandonne un projet de la vie : enveloppe ramenée au réglé, prévu annulé, projet fermé aux écritures. */
  abandonProject(budgetId: string, body: { expectedRevision: number; reason?: string }) {
    return this.post<{ abandonment: ProjectAbandonPreview; detail: BpmProjectDetail }>(`/api/bpm/project-budgets/${encodeURIComponent(budgetId)}/abandon`, body);
  }
  /** Reprend un projet abandonné : il reçoit de nouveau des écritures. */
  resumeProject(budgetId: string, expectedRevision: number) {
    return this.post<{ detail: BpmProjectDetail }>(`/api/bpm/project-budgets/${encodeURIComponent(budgetId)}/resume`, { expectedRevision });
  }
  releaseTaskShare(budgetId: string, taskId: string, expectedRevision: number) {
    return this.post<BpmProjectDetail & { released: { releasedCents: number; shareCents: number | null; taskTitle: string } }>(
      `/api/bpm/project-budgets/${encodeURIComponent(budgetId)}/shares/${encodeURIComponent(taskId)}/release`,
      { expectedRevision },
    );
  }
  setTaskReturn(budgetId: string, taskId: string, body: { label?: string; amount: number | null; cadence?: ReturnCadence; expectedRevision: number }) {
    return this.put<BpmProjectDetail>(`/api/bpm/project-budgets/${encodeURIComponent(budgetId)}/returns/${encodeURIComponent(taskId)}`, body);
  }
  /** `approve` : la demande est autorisée dans la même écriture. */
  requestOverrun(budgetId: string, body: { requestKey: string; taskId?: string | null; reason: 'ventilation' | 'reglement'; amount: number; note?: string; approve?: boolean }) {
    return this.post<{ overrunId: string; overrun: ProjectOverrun; detail: BpmProjectDetail }>(`/api/bpm/project-budgets/${encodeURIComponent(budgetId)}/overruns`, body);
  }
  /** Décision du budget de vie sur une demande de dépassement. */
  decideOverrun(id: string, decision: 'approve' | 'refuse', expectedRevision: number) {
    return this.post<{ overrun: ProjectOverrun; notice?: string | null; detail: BpmProjectDetail }>(`/api/bpm/overruns/${encodeURIComponent(id)}/decision`, { decision, expectedRevision });
  }
  /** Fin de cycle : facture au budget de vie les dépassements autorisés dont la date est atteinte. */
  billOverruns(budgetId?: string) {
    return this.post<{ projects: { budgetId: string; name: string; coreProjectId: string; allocationCents: number; billedOverrunCents: number; checks: CycleCheck[] }[] }>('/api/bpm/overruns/bill', budgetId ? { budgetId } : {});
  }

  // ---------- tableau de bord, chiffres, cycle et clôtures (contrats BPM, autrefois répartis dans Api) ----------

  dashboard(periodKey?: string) {
    return this.get<BpmDashboard>('/api/bpm/dashboard', { period: periodKey });
  }
  /** Chiffre et explication de son calcul (formule, révision, valeurs, objets sources). */
  figure(key: string, periodKey?: string) {
    return this.get<FigureEvaluation>(`/api/bpm/figures/${encodeURIComponent(key)}`, { period: periodKey });
  }
  configureCycle(body: { anchorDay: number | null; startDate?: string | null; expectedRevision: number }) {
    return this.put<BpmDashboard>('/api/bpm/cycle', body);
  }
  closures() {
    return this.get<Closure[]>('/api/bpm/closures');
  }
  /** Bilans des cycles : historique, du plus récent au plus ancien, et coût des projets par cycle. */
  bilans() {
    return this.get<BpmBilans>('/api/bpm/bilans');
  }
  bilan(periodKey: string) {
    return this.get<BpmBilanDetail>(`/api/bpm/bilans/${encodeURIComponent(periodKey)}`);
  }
  /** Météo BPM : l'état des deux sections, les prévisions et les tendances des cycles. */
  meteo() {
    return this.get<BpmMeteo>('/api/bpm/meteo');
  }
  lifeProjects() {
    return this.get<LifeProject[]>('/api/bpm/life-projects');
  }
  updatePatrimoine(body: { expectedRevision: number; openingStock?: number | null; openingDate?: string | null; objective?: number | null }) {
    return this.put<PatrimoineRead>('/api/bpm/patrimoine', body);
  }
}
