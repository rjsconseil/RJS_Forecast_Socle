import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AssemblyLinkChange, BpmAssembly, BpmCreation, BpmFlow, BpmWorkspace } from './bpm.model';
import { BpmVision } from './bpm-vision.model';
import type { BpmStatement } from './bpm-money.model';

/**
 * L'espace BPM vu par l'interface. Les écritures métier passent par l'API, qui
 * crée ensemble le projet du noyau, le PBM, le PPM et leur liaison, ou rien.
 */
@Injectable({ providedIn: 'root' })
export class BpmStore {
  private readonly http = inject(HttpClient);
  private readonly state = signal<BpmWorkspace | null>(null);
  readonly workspace = this.state.asReadonly();
  /** Le standard est l’unique cadre utilisateur ; les anciens assemblages restent des sources budgétaires. */
  readonly displayedProjects = computed(() => (this.workspace()?.projects ?? []).filter(p => p.defaultForEntity === true && p.managementScope !== 'professional'));
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.state.set(await firstValueFrom(this.http.get<BpmWorkspace>('/api/bpm/workspace')));
      this.error.set('');
    } catch (error) {
      this.error.set(
        messageOf(
          error,
          'Budget/Patrimoine Management est indisponible : les droits Budget et Patrimoine sont requis.',
        ),
      );
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Le relevé d'une fenêtre du projet (`start` inclus, `end` exclu), recomposé par
   * l'API depuis les règlements réels. Lecture seule ; null si la lecture échoue.
   */
  async statement(projectId: string, start: string, end: string): Promise<BpmStatement | null> {
    try {
      return await firstValueFrom(
        this.http.get<BpmStatement>(
          `/api/bpm/projects/${encodeURIComponent(projectId)}/statement`,
          {
            params: { start, end },
          },
        ),
      );
    } catch (error) {
      this.error.set(messageOf(error, 'Le relevé de cette période est indisponible.'));
      return null;
    }
  }

  async expenses(projectId: string, start: string, end: string, professional = false): Promise<import('./bpm-expenses.model').BpmExpenseRegister | null> {
    try {
      const result = await firstValueFrom(this.http.get<import('./bpm-expenses.model').BpmExpenseRegister>(`/api/bpm/projects/${encodeURIComponent(projectId)}/expenses`, { params: { start, end, ...(professional ? {professionnel:'1'} : {}) } }));
      this.error.set(''); return result;
    } catch (error) { this.error.set(messageOf(error, 'Les dépenses de cette période sont indisponibles.')); return null; }
  }

  async professionalWorkspace(entreprise:string):Promise<BpmWorkspace|null> {
    try {const w=await firstValueFrom(this.http.get<BpmWorkspace>('/api/bpm/workspace',{params:{professionnel:'1',...(entreprise?{entreprise}:{})}}));this.error.set('');return w;}
    catch(error){this.error.set(messageOf(error,'Les dépenses professionnelles sont indisponibles.'));return null;}
  }

  /** Crée le projet ; renvoie son identifiant BPM ou null, avec le motif du refus dans `error`. */
  async create(input: BpmCreation | BpmAssembly): Promise<string | null> {
    const current = this.state();
    if (!current || this.saving()) return null;
    this.saving.set(true);
    try {
      const next = await firstValueFrom(
        this.http.post<BpmWorkspace>('/api/bpm/projects', { ...input, revision: current.revision }),
      );
      const known = new Set(current.projects.map((project) => project.id));
      this.state.set(next);
      this.error.set('');
      return next.projects.find((project) => !known.has(project.id))?.id ?? null;
    } catch (error) {
      const conflict = (error as { error?: { workspace?: BpmWorkspace } }).error?.workspace;
      if (conflict) this.state.set(conflict);
      this.error.set(messageOf(error, 'La création a été refusée ; rien n’a été enregistré.'));
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * L'atelier d'assemblage : plusieurs assemblages enregistrés ensemble, ou aucun.
   * Renvoie les identifiants BPM créés, ou null avec le motif du refus dans `error`.
   */
  async assembleMany(assemblies: Omit<BpmAssembly, 'mode'>[]): Promise<string[] | null> {
    const body = await this.write('POST', '/api/bpm/assemblies', { assemblies });
    return body ? (body.created ?? []) : null;
  }
  /**
   * Relie les fiches d'un budget ou d'un patrimoine libres (références, postes,
   * personnes, prestataires, tâches, allocations, actifs) ; tout ou rien.
   */
  async relink(
    changes: (
      AssemblyLinkChange | { domain: 'core'; target: 'task'; id: string; projectId: string }
    )[],
  ): Promise<boolean> {
    return !!(await this.write('PATCH', '/api/bpm/assembly', { changes }));
  }
  /** Enregistre la vision d'un projet (objectifs, rendement, épargne visée). */
  async saveVision(projectId: string, vision: BpmVision): Promise<boolean> {
    return !!(await this.write('PUT', `/api/bpm/projects/${encodeURIComponent(projectId)}/vision`, {
      vision,
    }));
  }
  async patrimoineAction(project: import('./bpm.model').BpmProject, action: object): Promise<boolean> {
    return !!(await this.write('POST', `/api/bpm/projects/${encodeURIComponent(project.id)}/patrimoine-lifecycle`, {
      ...action, patrimoineRevision: project.snapshot?.patrimoineRevision, expectedTotalCents: project.snapshot?.standing.totalCents,
    }));
  }
  /** Ajoute une entrée ou une sortie au budget du projet ; renvoie les identifiants créés, ou null. */
  async detachProject(standardId:string,budgetId:string):Promise<boolean> {
    return !!(await this.write('DELETE',`/api/bpm/projects/${encodeURIComponent(standardId)}/budget-projects/${encodeURIComponent(budgetId)}`,{}));
  }
  async addFlow(projectId: string, flow: BpmFlow): Promise<string[] | null> {
    const body = await this.write(
      'POST',
      `/api/bpm/projects/${encodeURIComponent(projectId)}/flows`,
      flow,
    );
    return body ? (body.created ?? []) : null;
  }
  /** Crée plusieurs flux en une seule écriture (assistant du mois type) ; renvoie les identifiants créés, ou null. */
  async previewFlow(projectId:string,flow:BpmFlow,editing?:{id:string;updatedAt:string}):Promise<{before:import('./bpm-flow-pilot.model').FlowPilot;after:import('./bpm-flow-pilot.model').FlowPilot}|null> {
    try {return await firstValueFrom(this.http.request<{before:import('./bpm-flow-pilot.model').FlowPilot;after:import('./bpm-flow-pilot.model').FlowPilot}>(editing?'PATCH':'POST',`/api/bpm/projects/${encodeURIComponent(projectId)}/flows`,{body:{...flow,preview:true,...(editing?{mode:'definition',operationId:editing.id,updatedAt:editing.updatedAt}:{})}}));}
    catch(error){this.error.set(messageOf(error,'L’aperçu ne peut pas être calculé.'));return null;}
  }
  async updateFlow(projectId:string,operationId:string,updatedAt:string,flow:BpmFlow):Promise<boolean> {
    return !!(await this.write('PATCH', `/api/bpm/projects/${encodeURIComponent(projectId)}/flows`,{...flow,operationId,updatedAt,mode:'definition'}));
  }
  async addFlows(projectId: string, flows: BpmFlow[]): Promise<string[] | null> {
    const body = await this.write(
      'POST',
      `/api/bpm/projects/${encodeURIComponent(projectId)}/flows`,
      { flows },
    );
    return body ? (body.created ?? []) : null;
  }
  /** Retire une saisie faite depuis BPM (annuler) ; une opération créée dans Budget est refusée. */
  async removeFlow(projectId: string, operationId: string): Promise<boolean> {
    return !!(await this.write(
      'DELETE',
      `/api/bpm/projects/${encodeURIComponent(projectId)}/flows`,
      { operationId },
    ));
  }
  /**
   * Précise une opération déjà saisie : son poste (existant ou nommé, `null` pour
   * « sans poste ») et sa note. Montants, dates et règlements ne changent pas.
   */
  async precise(
    projectId: string,
    detail: { operationId: string; centerId?: string | null; centerName?: string; note?: string },
  ): Promise<boolean> {
    return !!(await this.write(
      'PATCH',
      `/api/bpm/projects/${encodeURIComponent(projectId)}/flows`,
      detail,
    ));
  }
  /** Pointe plusieurs échéances en une seule écriture (« Enregistrer les entrées reçues »). */
  async settleMany(
    projectId: string,
    items: { operationId: string; occurrenceDate: string }[],
  ): Promise<boolean> {
    return !!(await this.write(
      'POST',
      `/api/bpm/projects/${encodeURIComponent(projectId)}/settlements`,
      { items },
    ));
  }
  /** Pointe une échéance prévue : reçue ou payée. */
  async settle(
    projectId: string,
    settlement: {
      operationId: string;
      occurrenceDate: string;
      actualDate?: string;
      amountCents?: number;
    },
  ): Promise<boolean> {
    return !!(await this.write(
      'POST',
      `/api/bpm/projects/${encodeURIComponent(projectId)}/settlements`,
      settlement,
    ));
  }
  /** Retire des enregistrements (annuler) : les échéances redeviennent à recevoir ; une période clôturée est refusée. */
  async unsettle(
    projectId: string,
    items: { operationId: string; occurrenceDate: string }[],
  ): Promise<boolean> {
    return !!(await this.write(
      'DELETE',
      `/api/bpm/projects/${encodeURIComponent(projectId)}/settlements`,
      { items },
    ));
  }
  /** Verse un montant d'un actif du patrimoine vers un autre (épargne → assurance vie…). */
  async transfer(
    projectId: string,
    transfer: {
      fromAssetId: string;
      toAssetId: string;
      amountCents: number;
      date?: string;
      title?: string;
    },
  ): Promise<boolean> {
    return !!(await this.write(
      'POST',
      `/api/bpm/projects/${encodeURIComponent(projectId)}/transfers`,
      transfer,
    ));
  }
  /** Enregistre l'indice d'inflation tenu par le gestionnaire. */
  async saveInflation(inflation: { year: number; ratePct: number }[]): Promise<boolean> {
    return !!(await this.write('PUT', '/api/bpm/inflation', { inflation }));
  }
  /** Une écriture de l'API BPM : l'espace relu remplace l'état ; null quand elle est refusée. */
  private async write(
    method: 'PUT' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    body: object,
  ): Promise<(BpmWorkspace & { created?: string[] }) | null> {
    const current = this.state();
    if (!current || this.saving()) return null;
    this.saving.set(true);
    try {
      const { created, ...next } = await firstValueFrom(
        this.http.request<BpmWorkspace & { created?: string[] }>(method, url, {
          body: { ...body, revision: current.revision },
        }),
      );
      this.state.set(next);
      this.error.set('');
      return { ...next, created };
    } catch (error) {
      const conflict = (error as { error?: { workspace?: BpmWorkspace } }).error?.workspace;
      if (conflict) this.state.set(conflict);
      this.error.set(
        messageOf(error, 'L’enregistrement a été refusé ; relisez la page avant de réessayer.'),
      );
      return null;
    } finally {
      this.saving.set(false);
    }
  }
}

function messageOf(error: unknown, fallback: string): string {
  const body = (error as { error?: { message?: string; error?: string } }).error;
  return body?.message && body.error !== 'internal_error' ? body.message : fallback;
}
