// Fiche projet : gestes de financement d'une tâche (part, part libérée, demande de montant, décision, retour au
// budget de vie). Chaque geste passe par l'écriture avec relecture de la page (`ProjectWriteFlow.run`).
import { WritableSignal } from '@angular/core';
import { newRequestKey } from '../../core/api.service';
import { parseAmount } from '../../core/format';
import { BpmApi } from '../data/bpm-api.service';
import { BpmTaskCard, ReturnCadence, TaskBudgetRequest } from '../data/bpm-projects.models';
import { BpmFormDraft } from '../ui/form-draft';
import { ProjectFunding } from '../ui/project-funding';
import { ProjectWriteFlow } from './project-write-flow';

export interface ProjectTaskFundingHost {
  run: ProjectWriteFlow['run'];
  notice: ProjectWriteFlow['notice'];
  bpm: BpmApi;
  funding: ProjectFunding;
  /** Révision du budget du projet lu. */
  budgetRevision(): number | undefined;
  /** Demande de montant enregistrée : la page referme son formulaire. */
  requestSent(): void;
  /** Retour enregistré : la page referme son éditeur. */
  returnSaved(): void;
}

export class ProjectTaskFunding {
  /** Clés de demande gardées tant qu’une demande n’est pas lue (rejeu sans doublon). */
  readonly requestKeys = new Map<string, string>();

  constructor(private host: ProjectTaskFundingHost) {}

  saveShare(budgetId: string, t: BpmTaskCard, raw: string, revision: number, onSaved?: () => void) {
    const amount = parseAmount(raw);
    if (amount === 'invalid' || (amount !== null && amount < 0)) {
      this.host.notice.set({
        text: 'Indiquez une part en euros (deux décimales au plus), ou laissez vide pour la retirer.',
        error: true,
      });
      return;
    }
    return this.host.run(
      (fund) =>
        this.host.bpm.setTaskShare(budgetId, t.task.id, amount, revision, { authorizeOverrun: fund }).then(result => { onSaved?.(); return result; }),
      amount === null
        ? `Part de « ${t.task.title} » retirée.`
        : `Part de « ${t.task.title} » enregistrée.`,
      `la part de « ${t.task.title} »`,
    );
  }

  /** Tâche terminée : la part non consommée revient à l'enveloppe (part ramenée au réglé, par le middleware). */
  releaseShare(budgetId: string, t: BpmTaskCard, revision: number) {
    return this.host.run(
      () => this.host.funding.releaseShare({ budgetId, taskId: t.task.id, revision }),
      (r) => r.message,
    );
  }

  async requestBudget(
    budgetId: string,
    t: BpmTaskCard,
    controls: HTMLFormControlsCollection,
    draft?: BpmFormDraft,
  ) {
    const get = (name: string) => (controls.namedItem(name) as HTMLInputElement).value;
    const amount = parseAmount(get('amount'));
    if (amount === null || amount === 'invalid' || amount <= 0) {
      this.host.notice.set({
        text: 'Indiquez le montant total souhaité en euros, avec deux décimales au plus.',
        error: true,
      });
      return;
    }
    const note = get('note');
    const signature = JSON.stringify([budgetId, t.task.id, amount, note]);
    const requestKey = this.requestKeys.get(signature) ?? newRequestKey();
    this.requestKeys.set(signature, requestKey);
    const ok = await this.host.run(async () => {
      await this.host.bpm.requestTaskBudget(budgetId, t.task.id, { requestKey, amount, note });
      this.requestKeys.delete(signature);
    }, `Demande de « ${t.task.title} » enregistrée. Validez-la dans sa carte.`);
    if (ok) { draft?.clear(); this.host.requestSent(); }
    return ok;
  }

  decideRequest(e: {
    request: TaskBudgetRequest;
    decision: 'approve' | 'refuse' | 'cancel';
  }) {
    const revision = this.host.budgetRevision();
    return this.host.run(
      () => this.host.funding.decideTaskRequest(e.request, e.decision, revision),
      (r) => r.message,
    );
  }

  async saveReturn(
    budgetId: string,
    t: BpmTaskCard,
    f: HTMLFormControlsCollection,
    revision: number,
    draft?: BpmFormDraft,
  ) {
    const get = (n: string) =>
      (f.namedItem(n) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
    const amount = parseAmount(get('amount'));
    if (amount === null || amount === 'invalid' || amount <= 0) {
      this.host.notice.set({ text: 'Indiquez le montant du retour en euros.', error: true });
      return;
    }
    const ok = await this.host.run(
      () =>
        this.host.bpm.setTaskReturn(budgetId, t.task.id, {
          label: get('label'),
          amount,
          cadence: get('cadence') as ReturnCadence,
          expectedRevision: revision,
        }),
      t.task.status === 'done'
        ? `Retour enregistré dans le budget du projet de vie : « ${t.task.title} » est déjà terminée.`
        : `Retour prévu : il sera enregistré dans le budget du projet de vie quand « ${t.task.title} » sera terminée.`,
    );
    if (ok) { draft?.clear(); this.host.returnSaved(); }
  }

  removeReturn(budgetId: string, t: BpmTaskCard, revision: number) {
    return this.host.run(
      () =>
        this.host.bpm.setTaskReturn(budgetId, t.task.id, { amount: null, expectedRevision: revision }),
      `Retour de « ${t.task.title} » retiré.`,
    );
  }
}
