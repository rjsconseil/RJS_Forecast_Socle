import { Injectable, inject } from '@angular/core';
import { BpmApi } from '../../core/bpm-api.service';
import { ProjectOverrun, TaskBudgetRequest } from '../../core/bpm-projects.models';
import { cents } from '../../core/format';
import { newRequestKey } from './page-context';

/**
 * Vocabulaire unique du financement des projets de la vie.
 * Pages sources (projet, projet de vie) et raccourcis (fiche d'échéance) l'emploient tel quel.
 */
export const FUNDING = {
  envelope: 'Enveloppe attribuée',
  envelopeWithOverrun: 'Enveloppe + dépassement',
  paidOnEnvelope: 'Réglé sur l’enveloppe',
  paidOutside: 'Réglé hors budget de vie',
  remaining: 'Reste à consommer',
  toPay: 'Encore à régler',
  share: 'Part accordée',
  shareRest: 'Reste sur la part',
  sharePaid: 'Réglé sur la part',
  noShare: 'À demander',
  /** Lecture agrégée côté projet de vie (plusieurs projets). */
  envelopes: 'Enveloppes attribuées',
  paidOnEnvelopes: 'Réglé sur les enveloppes',
  /** Enveloppe pas encore accordée en parts de tâches. */
  toShare: 'À répartir entre les tâches',
  /** Somme des parts accordées. */
  shared: 'Accordé aux tâches',
  engaged: 'Engagé',
  overrunApproved: 'Dépassement autorisé',
} as const;

/** Libellés des actions de financement : un même geste porte le même nom partout. */
export const FUNDING_ACTIONS = {
  grantShare: (amountCents: number, task: string) => `Accorder ${cents(amountCents)} à « ${task} »`,
  authorize: (amountCents: number) => `Autoriser ${cents(amountCents)} de dépassement`,
  approveRequest: 'Autoriser la demande',
  refuseRequest: 'Refuser la demande',
  releaseShare: 'Rendre à l’enveloppe',
  requestOnly: 'Demander sans décider maintenant',
  /** Suffixe quand l'action enchaîne l'écriture refusée (règlement, part…). */
  andSettle: ' et régler',
  andSave: ' et enregistrer',
} as const;

/** Messages de résultat, identiques quelle que soit la page d'où part la décision. */
export const FUNDING_RESULTS = {
  approved: 'Dépassement autorisé : il sera facturé au budget du projet de vie en fin de cycle.',
  refused: 'Dépassement refusé : la demande associée est refusée.',
  released: (amountCents: number, task: string, paidCents: number) =>
    `${cents(amountCents)} rendus à l’enveloppe : la part de « ${task} » est ramenée à ${cents(paidCents)}.`,
  awaitingLife: (task: string, amountCents: number, overrunCents: number | null) =>
    `La part demandée pour « ${task} » (${cents(amountCents)}) dépasse l’enveloppe : ${overrunCents === null ? 'un dépassement attend' : `${cents(overrunCents)} de dépassement attendent`} l’accord du projet de vie, dans « Décisions attendues ».`,
  granted: (task: string, shareCents: number, overrunCents: number) =>
    `Part de « ${task} » portée à ${cents(shareCents)}${overrunCents ? `, dont ${cents(overrunCents)} autorisés en dépassement` : ''}.`,
} as const;

export interface OverrunReason {
  taskId?: string | null;
  reason: 'ventilation' | 'reglement';
  overrunCents: number;
  note?: string;
}

/**
 * Gestes de financement d'un projet de la vie, du côté de l'interface : un geste, une commande du middleware Budget
 * (`budget/funding.mjs`), qui porte les règles et enchaîne lui-même ce qu'il faut (part et dépassement, règlement
 * financé). Ce service ne fait que nommer les gestes et rendre leurs messages, identiques sur toutes les pages.
 */
@Injectable({ providedIn: 'root' })
export class ProjectFunding {
  private readonly bpm = inject(BpmApi);

  /** Demande seulement : la décision reste à prendre côté projet de vie. */
  request(budgetId: string, o: OverrunReason) {
    return this.bpm.requestOverrun(budgetId, {
      requestKey: newRequestKey('overrun'),
      taskId: o.taskId ?? null,
      reason: o.reason,
      amount: o.overrunCents / 100,
      note: o.note,
    });
  }

  /** Décision du projet de vie ; le message rendu explique si une demande liée revient au projet. */
  async decide(o: Pick<ProjectOverrun, 'id' | 'revision'>, decision: 'approve' | 'refuse') {
    const r = await this.bpm.decideOverrun(o.id, decision, o.revision);
    return { ...r, message: r.notice ?? (decision === 'approve' ? FUNDING_RESULTS.approved : FUNDING_RESULTS.refused) };
  }

  /**
   * Décision du projet sur la demande de part d'une tâche. Si la part dépasse l'enveloppe, le middleware ouvre une
   * demande de dépassement : le message dit où la décider (« Décisions attendues » ou la carte du projet).
   */
  async decideTaskRequest(
    r: Pick<TaskBudgetRequest, 'id' | 'revision' | 'taskTitle' | 'amountCents'>,
    decision: 'approve' | 'refuse' | 'cancel',
    budgetRevision?: number,
  ) {
    const x = await this.bpm.decideTaskBudget(r.id, decision, r.revision, budgetRevision);
    const title = x.request.taskTitle ?? r.taskTitle;
    const message =
      x.request.status === 'approved'
        ? FUNDING_RESULTS.granted(title, x.request.grantedCents ?? r.amountCents, 0)
        : x.request.status === 'awaiting-life'
          ? FUNDING_RESULTS.awaitingLife(title, r.amountCents, x.detail.budget?.pendingOverrun?.amountCents ?? null)
          : x.request.status === 'refused'
            ? `Demande de « ${title} » refusée : sa part reste inchangée.`
            : `Demande de « ${title} » annulée.`;
    return { ...x, message };
  }

  /** Tâche terminée : la part non consommée revient à l'enveloppe (le middleware la calcule et la vérifie). */
  async releaseShare(g: { budgetId: string; taskId: string; revision: number }) {
    const detail = await this.bpm.releaseTaskShare(g.budgetId, g.taskId, g.revision);
    const r = detail.released;
    return { detail, message: FUNDING_RESULTS.released(r.releasedCents, r.taskTitle, r.shareCents ?? 0) };
  }
}
