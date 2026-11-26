// Extensions du financement des projets — middleware Budget (niveau 2) : gardes des écritures, rattachement d'une
// tâche, retour au budget de vie à la complétion d'une tâche, validation d'un règlement.
import { fail } from '../../socle/errors.mjs';
import { today } from '../../socle/clock.mjs';
import { objectsWith } from '../../socle/indexes.mjs';
import { CADENCE_LABEL } from './recurrence.mjs';
import { fmt, inRegime, standardOfProject, sharesOf, returnsOf, requestsOf, openRequest, isAbandoned, abandonedRefusal, isValidatedCharge, fundingFigures } from './funding-rules.mjs';
import { pendingFor } from './funding.mjs';

/** Crée le revenu de retour d'une tâche dans le budget de vie (ponctuel ou récurrent), dans la transaction. */
export function triggerReturn(tx, socle, b, task, ret) {
  const { budget } = socle.modules;
  const centers = budget.costCentersOf(tx.draft, tx.userId).filter((c) => c.direction === 'income');
  const center = centers.find((c) => c.ref === 'std:autresRevenus') ?? centers[0];
  if (!center) return { module: 'budget', kind: 'projectReturn', message: `Retour de « ${task.title} » non créé : aucun centre de revenus pour ce user.`, ids: [] };
  const now = today();
  const input = {
    budgetId: b.parentBudgetId,
    direction: 'income',
    label: ret.label,
    amount: ret.amountCents / 100,
    costCenterRef: center.ref,
    note: `Retour du projet « ${b.name} » à la complétion de « ${task.title} ».`,
  };
  const entry = ret.cadence === 'once' ? budget.buildOperation(tx, { ...input, date: now, status: 'planned' }) : budget.buildRecurrence(tx, { ...input, cadence: ret.cadence, firstDate: now });
  socle.om.update(tx, b, { taskReturns: { ...returnsOf(b), [task.id]: { ...ret, entryId: entry.id, entryKind: entry.kind, triggeredAt: now } } });
  const when = ret.cadence === 'once' ? `prévu le ${now}` : `${CADENCE_LABEL[ret.cadence].toLowerCase()}, dès le ${now}`;
  return { module: 'budget', kind: 'projectReturn', message: `Retour au budget de vie enregistré : « ${ret.label} », ${fmt(ret.amountCents)} (${when}).`, ids: [entry.id] };
}

/** Extensions consommées par le noyau (rattachement, état d'une tâche) et par Budget lui-même (validation d'un règlement). */
export const fundingExtensions = {
  /** Toute écriture datée sur le budget d'un projet abandonné est refusée : il se reprend d'abord. */
  operationGuard(state, { budgetId }) {
    const b = state.budgets[budgetId];
    if (isAbandoned(b)) abandonedRefusal(b);
  },

  /** Une tâche qui porte des données du budget de son projet ne change pas de projet tant qu'elles existent. */
  taskMoveGuard(state, { task, fromProjectId }) {
    const b = fromProjectId ? standardOfProject(state, fromProjectId) : null;
    if (!b) return;
    const links = [];
    if (task.id in sharesOf(b)) links.push('une part de budget');
    if (task.id in returnsOf(b)) links.push('un retour au budget de vie');
    if (requestsOf(state, b.id).some((x) => x.taskId === task.id && openRequest(x))) links.push('une demande de montant en attente (à annuler avant le rattachement)');
    const entries = objectsWith(state.operations, 'taskId', task.id).length + objectsWith(state.recurrences ?? {}, 'taskId', task.id).length;
    if (entries) links.push(entries > 1 ? `${entries} dépenses ou entrées` : 'une dépense ou entrée');
    if (links.length) {
      fail('FORBIDDEN_BY_RULE', `« ${task.title} » porte des données de l’enveloppe du projet « ${b.name} » (${links.join(', ')}) : retirez-les avant de changer la tâche de projet.`, {
        field: 'projectId',
        taskId: task.id,
        budgetId: b.id,
        links,
      });
    }
  },

  /** Une tâche terminée déclenche son retour au budget de vie, une seule fois. */
  onTaskStatusChange(tx, { task }, socle) {
    if (task.status !== 'done' || !task.projectId) return [];
    const b = standardOfProject(tx.draft, task.projectId);
    const ret = b ? returnsOf(b)[task.id] : null;
    if (!ret || ret.entryId) return [];
    return [triggerReturn(tx, socle, b, task, ret)];
  },

  /** Valider un règlement qui ferait dépasser le budget du projet exige l'autorisation du budget de vie. */
  settlementGuard(state, { budgetId, direction, amountCents, realizedDate, accountingDate, authorizeTaskOverrun = false, taskId, operationId, recurrenceId, occurrenceDate }) {
    const b = state.budgets[budgetId];
    const previous = operationId ? state.operations[operationId] : null;
    const previousPaid = previous && isValidatedCharge(previous, b) ? previous.realizedAmountCents : 0;
    // Une validation antérieure à la première attribution reste dans l'historique, hors enveloppe.
    if (inRegime(b) && (accountingDate ?? realizedDate) < b.allocationDate) return;
    if (direction === 'charge' && b?.taskFundingRequired) {
      if (!inRegime(b)) fail('FORBIDDEN_BY_RULE', `Attribuez d’abord une enveloppe au projet « ${b.name} » : ses dépenses se règlent sur les parts de ses tâches.`, { field: 'budgetId', budgetId });
      if (!taskId || state.tasks[taskId]?.projectId !== b.coreProjectId) fail('FORBIDDEN_BY_RULE', `Reliez cette dépense à une tâche du projet « ${b.name} » avant de la régler : chaque règlement consomme la part d’une tâche.`, { field: 'taskId', budgetId });
      const sfig = fundingFigures(state, b);
      const taskPaid = (sfig.byTask[taskId]?.paidCents ?? 0) - (previous?.taskId === taskId ? previousPaid : 0);
      const share = sharesOf(b)[taskId] ?? null;
      if (!(share > 0) || (taskPaid + amountCents > share && !authorizeTaskOverrun)) {
        const title = state.tasks[taskId]?.title ?? 'la tâche';
        const needed = taskPaid + amountCents;
        fail(
          'FORBIDDEN_BY_RULE',
          share === null
            ? `« ${title} » n’a pas encore de part de l’enveloppe : accordez-lui au moins ${fmt(needed)} pour régler cette dépense.`
            : `« ${title} » : part de ${fmt(share)}, déjà ${fmt(taskPaid)} réglés ; ce règlement de ${fmt(amountCents)} la dépasserait de ${fmt(needed - share)}. Portez sa part à ${fmt(needed)} pour le régler.`,
          { reason: 'task-share', field: 'taskId', budgetId, budgetRevision: b.revision, taskId, taskTitle: title, shareCents: share, paidCents: taskPaid, amountCents, neededCents: needed, availableCents: sfig.availableCents, grantOverrunCents: Math.max(0, needed - (share ?? 0) - sfig.availableCents), ...pendingFor(state, sfig, taskId, needed) },
        );
      }
    }
    if (direction !== 'charge' || !inRegime(b) || (accountingDate ?? realizedDate) < b.allocationDate) return;
    const fig = fundingFigures(state, b);
    const after = fig.paidCents - previousPaid + amountCents;
    if (after <= fig.ceilingCents) return;
    fail(
      'OVERRUN_AUTHORIZATION_REQUIRED',
      `Ce règlement porterait les dépenses réglées du projet « ${b.name} » à ${fmt(after)}, au-delà de son enveloppe (${fmt(fig.ceilingCents)}) : le projet de vie doit autoriser un dépassement de ${fmt(after - fig.ceilingCents)}.`,
      { reason: 'reglement', budgetId, taskId: taskId ?? null, overrunCents: after - fig.ceilingCents, paidCents: fig.paidCents, ceilingCents: fig.ceilingCents, amountCents, operationId: operationId ?? null, recurrenceId: recurrenceId ?? null, occurrenceDate: occurrenceDate ?? null },
    );
  },
};

