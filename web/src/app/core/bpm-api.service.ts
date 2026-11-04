import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { toApiError } from './api.service';
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
import { Operation } from './models';

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
  /** Projection ou simulation (paramètres facultatifs : aucune écriture). */
  projection(q: { horizon?: number; rate?: number; inflation?: number; contribution?: number; extra?: number } = {}) {
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
    return this.get<{ ref: string; label: string; direction: 'income' | 'charge'; directionLabel: string; standard: boolean }[]>('/api/bpm/cost-centers');
  }

  // ---------- aperçu (aucune mutation) ----------

  previewEntry(input: Partial<EntryInput>) {
    return this.post<EntryPreview>('/api/bpm/operations/preview', input);
  }

  // ---------- commandes ----------

  /** Éditeur partagé : ponctuelle → opération ; cadence → définition récurrente. */
  createEntry(input: EntryInput & { requestKey: string }) {
    return this.post<{ replayed: boolean; operation?: Operation; recurrence?: Recurrence }>('/api/bpm/operations', input);
  }
  updateOperation(id: string, body: Record<string, unknown> & { expectedRevision: number }) {
    return this.put<{ operation: Operation }>(`/api/bpm/operations/${encodeURIComponent(id)}`, body);
  }
  realizeOperation(id: string, body: { expectedRevision: number; realizedAmount?: number; realizedDate?: string }) {
    return this.post<{ operation: Operation }>(`/api/bpm/operations/${encodeURIComponent(id)}/realize`, body);
  }
  cancelRealization(id: string, expectedRevision: number) {
    return this.post<{ operation: Operation }>(`/api/bpm/operations/${encodeURIComponent(id)}/cancel-realization`, { expectedRevision });
  }
  updateRecurrence(id: string, body: Record<string, unknown> & { expectedRevision: number }) {
    return this.put<{ recurrence: Recurrence; scope: { appliesTo: string; settledUntouched: number } }>(`/api/bpm/recurrences/${encodeURIComponent(id)}`, body);
  }
  settleOccurrence(recurrenceId: string, body: { requestKey: string; occurrenceDate: string; realizedAmount?: number; realizedDate?: string; note?: string }) {
    return this.post<{ replayed: boolean; operation: Operation }>(`/api/bpm/recurrences/${encodeURIComponent(recurrenceId)}/settle`, body);
  }
  addCostCenter(body: { requestKey: string; label: string; direction: 'income' | 'charge' }) {
    return this.post<{ replayed: boolean; costCenterId: string }>('/api/bpm/cost-centers', body);
  }
  setCaps(body: { expectedRevision: number; caps: Record<string, number | null> }) {
    return this.put<unknown>('/api/bpm/caps', body);
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
    return this.post<unknown>('/api/bpm/closures', body);
  }
}
