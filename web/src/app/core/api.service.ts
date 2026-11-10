import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  ApiErrorBody,
  BpmDashboard,
  BudgetObject,
  Closure,
  CostCenter,
  EffectiveParameter,
  FigureEvaluation,
  JournalEntry,
  LifeProject,
  MetricCatalog,
  MetricDefinitionRow,
  ModuleDescription,
  Operation,
  PatrimoineRead,
  ProjectDetail,
  RecentError,
  UserBundleResult,
  UserType,
  ProjectSummary,
  TaskMutationResult,
  TaskStatus,
  TaskView,
  TestUser,
} from './models';

// Clé renouvelée après l'import des données de référence : l'ancien choix automatique (user sans données) est oublié.
const USER_KEY = 'rjs.activeUserId';

/** Contexte de recette : user de test actif (préférence locale, la vérité reste côté API). */
@Injectable({ providedIn: 'root' })
export class RecetteContext {
  readonly userId = signal<string | null>(readStored());
  /** Connecté = un user choisi ; sans user, le site ne propose que « Démarrer un projet ». */
  readonly connected = computed(() => this.userId() !== null);

  /** `remember: false` pour un choix par défaut : seul un choix fait par la personne est mémorisé. */
  select(id: string | null, { remember = true } = {}) {
    this.userId.set(id);
    if (!remember) return;
    try {
      if (id) localStorage.setItem(USER_KEY, id);
      else localStorage.removeItem(USER_KEY);
    } catch {
      /* stockage indisponible : le choix reste en mémoire */
    }
  }
}

function readStored(): string | null {
  try {
    return localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
}

export const userContextInterceptor: HttpInterceptorFn = (req, next) => {
  const userId = inject(RecetteContext).userId();
  return next(userId && req.url.startsWith('/api/') ? req.clone({ setHeaders: { 'x-user-id': userId } }) : req);
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
  get isConflict() {
    return this.body.code === 'STALE_VERSION';
  }
  get isNetwork() {
    return this.status === 0 || this.status === 503 || this.status === 504;
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof HttpErrorResponse) {
    const body = err.error?.error as ApiErrorBody | undefined;
    if (body?.code) return new ApiError(err.status, body);
    return new ApiError(err.status, {
      code: err.status === 0 ? 'NETWORK' : 'HTTP_' + err.status,
      action: null,
      message: err.status === 0 ? "L'API locale ne répond pas. Vérifier qu'elle est lancée." : `Erreur HTTP ${err.status}.`,
    });
  }
  return new ApiError(0, { code: 'UNKNOWN', action: null, message: String(err) });
}

/** Annuaire des users (sélecteur du shell) ; rafraîchi après la création d'un user. */
@Injectable({ providedIn: 'root' })
export class UserDirectory {
  private api = inject(Api);
  readonly users = signal<TestUser[]>([]);

  async refresh() {
    this.users.set(await this.api.users());
    return this.users();
  }
}

/** Clé de demande stable, à conserver pour toute nouvelle tentative de la même création. */
export const newRequestKey = () => `web-${crypto.randomUUID()}`;

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);

  private async run<T>(obs: Promise<T>): Promise<T> {
    try {
      return await obs;
    } catch (err) {
      throw toApiError(err);
    }
  }

  private get<T>(url: string) {
    return this.run(firstValueFrom(this.http.get<T>(url)));
  }
  private post<T>(url: string, body: unknown) {
    return this.run(firstValueFrom(this.http.post<T>(url, body)));
  }
  private put<T>(url: string, body: unknown) {
    return this.run(firstValueFrom(this.http.put<T>(url, body)));
  }
  private csvUrl(file: string, scope: string) {
    return `/api/om/csv/${encodeURIComponent(file)}?scope=${encodeURIComponent(scope)}`;
  }

  // ---------- transverse : utilisateurs ----------

  users() {
    return this.get<TestUser[]>('/api/users');
  }
  userTypes() {
    return this.get<UserType[]>('/api/users/types');
  }
  /** Crée le user et, dans la même écriture, sa composition BPM (triplet + cycle). */
  createUser(body: {
    requestKey: string;
    label: string;
    userType: string;
    openingStock?: number | null;
    openingDate?: string | null;
    objective?: number | null;
    anchorDay?: number | null;
    cycleStartDate?: string | null;
  }) {
    return this.post<UserBundleResult>('/api/users', body);
  }

  projects() {
    return this.get<ProjectSummary[]>('/api/projects');
  }
  project(id: string) {
    return this.get<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`);
  }
  createProject(body: object) {
    return this.post<ProjectDetail>('/api/projects', body);
  }
  updateProject(id: string, body: object) {
    return this.put<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`, body);
  }

  tasks() {
    return this.get<TaskView[]>('/api/tasks');
  }
  task(id: string) {
    return this.get<TaskView>(`/api/tasks/${encodeURIComponent(id)}`);
  }
  createTask(body: object) {
    return this.post<TaskMutationResult>('/api/tasks', body);
  }
  updateTask(id: string, body: object) {
    return this.put<TaskMutationResult>(`/api/tasks/${encodeURIComponent(id)}`, body);
  }
  changeTaskStatus(id: string, status: TaskStatus, expectedRevision: number) {
    return this.post<TaskMutationResult>(`/api/tasks/${encodeURIComponent(id)}/status`, { status, expectedRevision });
  }
  /** Rattachement d'une tâche à un projet : commande du noyau, quelle que soit l'interface qui l'appelle. */
  attachTask(id: string, projectId: string, expectedRevision: number) {
    return this.post<TaskMutationResult>(`/api/tasks/${encodeURIComponent(id)}/attach`, { projectId, expectedRevision });
  }
  detachTask(id: string, expectedRevision: number) {
    return this.post<TaskMutationResult>(`/api/tasks/${encodeURIComponent(id)}/detach`, { expectedRevision });
  }

  // ---------- niveau 3 : application BPM ----------

  dashboard(periodKey?: string) {
    return this.get<BpmDashboard>(`/api/bpm/dashboard${periodKey ? `?period=${encodeURIComponent(periodKey)}` : ''}`);
  }
  /** Chiffre et explication de son calcul (formule, révision, valeurs, objets sources). */
  figure(key: string, periodKey?: string) {
    return this.get<FigureEvaluation>(`/api/bpm/figures/${encodeURIComponent(key)}${periodKey ? `?period=${encodeURIComponent(periodKey)}` : ''}`);
  }
  configureCycle(body: { anchorDay: number | null; startDate?: string | null; expectedRevision: number }) {
    return this.put<BpmDashboard>('/api/bpm/cycle', body);
  }
  closures() {
    return this.get<Closure[]>('/api/bpm/closures');
  }
  /** `expectedResultCents` : montant affiché à la confirmation ; refusé (CLOSING_PREVIEW_STALE) s'il a changé. */
  closePeriod(body: { requestKey: string; periodKey: string; expectedResultCents: number }) {
    return this.post<{ replayed: boolean; closure: Closure }>('/api/bpm/closures', body);
  }
  lifeProjects() {
    return this.get<LifeProject[]>('/api/bpm/life-projects');
  }
  createLifeProject(body: { requestKey: string; name: string; project?: object; tasks: object[] }) {
    return this.post<{ replayed: boolean; budgetId: string; coreProjectId: string; taskIds: string[] }>('/api/bpm/life-projects', body);
  }
  bpmCostCenters() {
    return this.get<CostCenter[]>('/api/bpm/cost-centers');
  }
  addCostCenter(body: { requestKey: string; label: string; direction: 'income' | 'charge' }) {
    return this.post<{ replayed: boolean; costCenterId: string; costCenters: CostCenter[] }>('/api/bpm/cost-centers', body);
  }
  /** Saisie applicative : l'opération va toujours au Budget « Projet de vie ». */
  createBpmOperation(body: { requestKey: string; direction: 'income' | 'charge'; label: string; amount: number; date: string; status: 'planned' | 'realized'; costCenterRef: string; realizedAmount?: number; realizedDate?: string }) {
    return this.post<{ replayed: boolean; operation: Operation }>('/api/bpm/operations', body);
  }
  realizeBpmOperation(id: string, body: { expectedRevision: number; realizedAmount?: number; realizedDate?: string }) {
    return this.post<{ operation: Operation }>(`/api/bpm/operations/${encodeURIComponent(id)}/realize`, body);
  }
  updateBpmPatrimoine(body: { expectedRevision: number; openingStock?: number | null; openingDate?: string | null; objective?: number | null }) {
    return this.put<PatrimoineRead>('/api/bpm/patrimoine', body);
  }

  // ---------- niveau 2 : middlewares (interfaces de test) ----------

  budgets() {
    return this.get<BudgetObject[]>('/api/budget/budgets');
  }
  budget(id: string) {
    return this.get<{ budget: BudgetObject; operations: Operation[] }>(`/api/budget/budgets/${encodeURIComponent(id)}`);
  }
  budgetCostCenters() {
    return this.get<CostCenter[]>('/api/budget/cost-centers');
  }
  createBudgetOperation(body: { requestKey: string; budgetId: string; direction: 'income' | 'charge'; label: string; amount: number; date: string; status: 'planned' | 'realized'; costCenterRef: string; realizedAmount?: number; realizedDate?: string }) {
    return this.post<{ replayed: boolean; operation: Operation }>('/api/budget/operations', body);
  }
  updateBudgetOperation(id: string, body: object) {
    return this.put<{ operation: Operation }>(`/api/budget/operations/${encodeURIComponent(id)}`, body);
  }
  realizeBudgetOperation(id: string, body: { expectedRevision: number; realizedAmount?: number; realizedDate?: string }) {
    return this.post<{ operation: Operation }>(`/api/budget/operations/${encodeURIComponent(id)}/realize`, body);
  }
  patrimoine() {
    return this.get<PatrimoineRead>('/api/patrimoine');
  }
  updatePatrimoine(id: string, body: { expectedRevision: number; openingStock?: number | null; openingDate?: string | null; objective?: number | null }) {
    return this.put<PatrimoineRead>(`/api/patrimoine/${encodeURIComponent(id)}`, body);
  }

  // ---------- transverse : administration ----------

  adminModules() {
    return this.get<ModuleDescription[]>('/api/admin/modules');
  }
  /** Paramètres hors formules (les formules sont servies par le catalogue des métriques). */
  adminParameters() {
    return this.get<EffectiveParameter[]>('/api/admin/parameters');
  }
  adminParameter(key: string) {
    return this.get<EffectiveParameter>(`/api/admin/parameters/${encodeURIComponent(key)}`);
  }
  /** `expectedRevision` vaut 0 pour un paramètre jamais administré. */
  setParameter(key: string, body: { value: unknown; expectedRevision: number; note?: string }) {
    return this.put<{ written: boolean; parameter: EffectiveParameter }>(`/api/admin/parameters/${encodeURIComponent(key)}`, body);
  }
  resetParameter(key: string, expectedRevision: number) {
    return this.post<{ written: boolean; parameter: EffectiveParameter }>(`/api/admin/parameters/${encodeURIComponent(key)}/reset`, { expectedRevision });
  }
  metricCatalog() {
    return this.get<MetricCatalog>('/api/admin/metrics');
  }
  metric(key: string) {
    return this.get<MetricDefinitionRow>(`/api/admin/metrics/${encodeURIComponent(key)}`);
  }
  /** Évalue une formule proposée sur les données du user actif, sans l'enregistrer. */
  previewMetric(key: string, body: { formula: string; periodKey?: string }) {
    return this.post<{ current: FigureEvaluation; preview: FigureEvaluation }>(`/api/admin/metrics/${encodeURIComponent(key)}/preview`, body);
  }
  journal(limit = 100) {
    return this.get<JournalEntry[]>(`/api/admin/journal?limit=${limit}`);
  }
  recentErrors() {
    return this.get<RecentError[]>('/api/admin/errors');
  }

  // ---------- transverse : Object Management ----------

  omKinds() {
    return this.get<OmKind[]>('/api/om/kinds');
  }
  omChecks() {
    return this.get<OmCheck[]>('/api/om/checks');
  }
  omCsvFiles() {
    return this.get<string[]>('/api/om/csv');
  }
  omCsvHref(file: string, scope: string) {
    return this.csvUrl(file, scope);
  }

  omObjects(params: { q?: string; kind?: string; scope?: string }) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => !!v) as [string, string][]);
    return this.get<OmInventoryRow[]>(`/api/om/objects?${qs}`);
  }
  omObject(id: string) {
    return this.get<Record<string, unknown>>(`/api/om/objects/${encodeURIComponent(id)}`);
  }
  omDebug(scope: string) {
    return this.get<OmDebug>(`/api/om/debug?scope=${encodeURIComponent(scope)}`);
  }
}

export interface OmInventoryRow {
  id: string;
  kind: string;
  kindLabel: string;
  label: string | null;
  level: 0 | 1 | 2 | 3;
  levelLabel: string;
  module: string;
  domain: string;
  userId: string;
  revision: number;
  source: string | null;
  control: 'passed' | 'warning' | 'failed';
}

export interface OmKind {
  kind: string;
  label: string;
  prefix: string;
  module: string;
  level: 0 | 1 | 2 | 3;
  domain: string;
  references: Record<string, { kind: string | string[]; required?: boolean }>;
}

export interface OmCheck {
  rule: string;
  category: 'integrity' | 'pathway' | 'not-implemented';
  module: string;
  description: string;
  expected: string;
  observed: string;
  result: 'passed' | 'failed' | 'warning' | 'not-run';
  execution: string;
  ids: string[];
}

export interface OmRelation {
  sourceId: string;
  sourceKind: string;
  relation: string;
  targetId: string;
  targetKind: string;
  userId: string;
  derived: boolean;
}

/** Export de débogage : objets par collection, vues des modules, relations, paramètres, contrôles. */
export interface OmDebug {
  schemaVersion: string;
  mode: string;
  snapshotId: string;
  storeRevision: number;
  storeUpdatedAt: string;
  generatedAt: string;
  scope: string;
  modules: ModuleDescription[];
  objects: Record<string, Record<string, unknown>[]>;
  /** Vues déclarées par les modules : tachesProjets, projets, budgets, operations, capitalisations, assemblages, clotures. */
  views: Record<string, Record<string, unknown>[]>;
  relations: OmRelation[];
  parameters: EffectiveParameter[];
  creationReceipts: { requestKey: string; command: string; userId: string; completedAt: string; createdObjects: { kind: string; id: string }[] }[];
  journal: JournalEntry[];
  checks: OmCheck[];
  review: { decision: string; reviewer: string | null };
}
