// Réservations de moyens des projets de la vie — middleware Budget (niveau 2).
// Enveloppes, parts et autorisations ne créent aucun flux financier. Seuls les mouvements des tâches
// validés sont imputés, sur leur date comptable et selon leur source cycle/patrimoine.
import { today } from '../../socle/clock.mjs';
import { objectsWith } from '../../socle/indexes.mjs';
import { sum, sharesOf, overrunsOf, requestsOf, openRequest, fundingFigures } from './funding-rules.mjs';
export * from './funding-rules.mjs';


/** Demande de dépassement en attente d'un projet, réduite à ce qu'il faut pour la décider depuis un autre écran. */
/**
 * Chiffres de financement d'une tâche, lus dans les chiffres de son projet : part, engagé, réglé, reste, charges
 * prévues non réglées et part inutilisée d'une tâche terminée (à rendre à l'enveloppe).
 */
export function taskFunding(state, fig, taskId) {
  const share = fig.shares[taskId] ?? null;
  const s = fig.byTask[taskId] ?? { engagedCents: 0, paidCents: 0, unbounded: false };
  const openCents = s.engagedCents - s.paidCents;
  const done = state.tasks[taskId]?.status === 'done';
  // Budget restant au temps [P] : part × (temps prévu − temps consommé) / temps prévu. Négatif quand le temps
  // est dépassé : le dépassement de temps donne le dépassement de budget de la tâche.
  const task = state.tasks[taskId];
  const planned = task?.plannedHours ?? null;
  const workRatio = planned > 0 ? (task?.spentHours ?? 0) / planned : null;
  const purchaseRatio = share > 0 ? s.paidCents / share : null;
  // Seul le temps compte pour le reste [P] : les achats réglés sont une information à part (cashRemainingCents),
  // ils ne modifient ni le pourcentage de temps restant ni le budget restant de la tâche.
  const consumedRatio = workRatio;
  const timeLeftRatio = consumedRatio === null ? null : 1 - consumedRatio;
  const remainingCents = timeLeftRatio === null || share === null ? null : Math.round(share * timeLeftRatio);
  // Selon le temps consommé [P] : le taux horaire du projet × les heures déjà passées sur la tâche.
  const cost = fig.taskCost ?? { mode: 'time-left', hourlyRateCents: null };
  const spentCostCents = cost.hourlyRateCents === null ? null : Math.round(cost.hourlyRateCents * (task?.spentHours ?? 0));
  return {
    /** Mode choisi par le projet, et le montant à montrer sous « Budget restant selon le temps ». */
    restMode: cost.mode,
    restCents: cost.mode === 'time-spent' ? spentCostCents : remainingCents,
    spentCostCents,
    timeRemainingPct: timeLeftRatio === null ? null : Math.round(timeLeftRatio * 1000) / 10,
    timeRemainingCents: remainingCents,
    timeConsumptionPercent: consumedRatio === null ? null : Math.round(consumedRatio * 1000) / 10,
    timeConsumedCents: remainingCents === null ? null : share - remainingCents,
    workConsumptionPercent: workRatio === null ? null : Math.round(workRatio * 1000) / 10,
    purchaseConsumptionPercent: purchaseRatio === null ? null : Math.round(purchaseRatio * 1000) / 10,
    purchaseEquivalentHours: planned > 0 && purchaseRatio !== null ? planned * purchaseRatio : null,
    cashRemainingCents: share === null ? null : share - s.paidCents,
    shareCents: share,
    engagedCents: s.engagedCents,
    paidCents: s.paidCents,
    openCents,
    remainingCents,
    // La tâche dépasse sa part quand son temps est dépassé ou quand ses achats réglés passent au-delà de la part.
    over: (remainingCents !== null && remainingCents < 0) || (share !== null && s.paidCents > share),
    unbounded: s.unbounded,
    paidBeforeCents: fig.beforeByTask?.[taskId] ?? 0,
    unusedCents: done && share !== null && openCents <= 0 && s.paidCents < share ? share - s.paidCents : 0,
  };
}

/**
 * Ce qu'abandonner un projet changerait, sans rien écrire : lu par l'aperçu de la fiche et par la commande, qui
 * appliquent la même règle [P].
 * - L'enveloppe est ramenée à ce que le projet a réglé (jamais sous les dépassements déjà facturés) ; le reste,
 *   avec les dépassements autorisés devenus inutiles, revient au budget de vie.
 * - Les dépassements autorisés mais pas encore facturés ne sont gardés qu'à hauteur des règlements au-delà de
 *   l'enveloppe ; les demandes de part et de dépassement en attente sont annulées.
 * - Chaque part de tâche est ramenée à ce que la tâche a réglé ; les retours pas encore déclenchés sont retirés.
 * - Les charges et entrées prévues non réglées sont annulées ; les récurrences s'arrêtent. Le réglé reste.
 */
export function abandonPlan(state, b, now = today()) {
  const fig = fundingFigures(state, b, now);
  const byDate = (x, y) => (x.decidedAt ?? x.requestedAt ?? '').localeCompare(y.decidedAt ?? y.requestedAt ?? '') || x.createdAt.localeCompare(y.createdAt);
  const overruns = overrunsOf(state, b.id);
  const approved = overruns.filter((x) => x.status === 'approved').sort(byDate);
  let allocationAfterCents = null;
  const keptOverruns = [];
  const cancelledOverrunIds = [];
  let trimmed = null;
  if (fig.regime) {
    allocationAfterCents = Math.min(b.allocationCents, Math.max(fig.paidCents, fig.billedOverrunCents));
    let need = Math.max(0, fig.paidCents - allocationAfterCents);
    for (const x of approved) {
      if (need <= 0) cancelledOverrunIds.push(x.id);
      else {
        if (x.amountCents > need) trimmed = { id: x.id, amountCents: need };
        keptOverruns.push(x.id);
        need -= x.amountCents;
      }
    }
  }
  const keptOverrunCents = sum(approved.filter((x) => keptOverruns.includes(x.id)), (x) => (trimmed?.id === x.id ? trimmed.amountCents : x.amountCents));
  const ceilingBefore = fig.regime ? fig.ceilingCents : 0;
  const ceilingAfter = fig.regime ? allocationAfterCents + keptOverrunCents : 0;
  const sharesAfter = Object.fromEntries(
    Object.keys(sharesOf(b))
      .map((taskId) => [taskId, fig.byTask[taskId]?.paidCents ?? 0])
      .filter(([, cents]) => cents > 0),
  );
  const plannedIds = objectsWith(state.operations, 'budgetId', b.id).filter((o) => o.status === 'planned').map((o) => o.id);
  const recurrenceIds = Object.values(state.recurrences ?? {}).filter((r) => r.budgetId === b.id && !r.cancelledAt && (!r.endDate || r.endDate >= now)).map((r) => r.id);
  const requestIds = requestsOf(state, b.id).filter(openRequest).map((x) => x.id);
  const pendingOverrunIds = overruns.filter((x) => x.status === 'pending').map((x) => x.id);
  return {
    regime: fig.regime,
    paidCents: fig.paidCents,
    allocationBeforeCents: fig.regime ? b.allocationCents : null,
    allocationAfterCents,
    /** Ce qui revient au budget de vie : enveloppe non consommée et dépassements autorisés devenus inutiles. */
    releasedCents: Math.max(0, ceilingBefore - ceilingAfter),
    sharesAfter,
    trimmedOverrun: trimmed,
    cancelledOverrunIds,
    pendingOverrunIds,
    requestIds,
    plannedIds,
    recurrenceIds,
    toPayCents: fig.toPayCents,
  };
}

/** Aperçu d'un abandon, tel que la fiche le présente avant confirmation. */
export const abandonPreview = (plan) => ({
  paidCents: plan.paidCents,
  allocationBeforeCents: plan.allocationBeforeCents,
  allocationAfterCents: plan.allocationAfterCents,
  releasedCents: plan.releasedCents,
  cancelledEntries: plan.plannedIds.length,
  stoppedRecurrences: plan.recurrenceIds.length,
  cancelledRequests: plan.requestIds.length,
  cancelledOverruns: plan.pendingOverrunIds.length + plan.cancelledOverrunIds.length,
  toPayCents: plan.toPayCents,
});

export function pendingOf(state, fig) {
  const x = fig.pendingOverrun;
  if (!x) return null;
  const request = x.taskBudgetRequestId ? state.taskBudgetRequests?.[x.taskBudgetRequestId] : null;
  return { id: x.id, revision: x.revision, amountCents: x.amountCents, reason: x.reason, taskId: x.taskId ?? null, taskTitle: x.taskTitle ?? null, requestCents: request?.amountCents ?? null };
}

/** Demande de dépassement en attente du projet, et si l'autoriser couvre la part nécessaire à la tâche. */
export function pendingFor(state, fig, taskId, neededCents) {
  const pending = pendingOf(state, fig);
  return { pendingOverrun: pending, pendingCovers: !!pending && pending.taskId === taskId && (pending.requestCents ?? 0) >= neededCents };
}
