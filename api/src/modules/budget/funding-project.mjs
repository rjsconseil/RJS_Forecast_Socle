// Commandes de niveau projet du financement — middleware Budget (niveau 2) : dépassements demandés au budget de
// vie (demande, décision, facturation) et abandon ou reprise d'un projet. Les gardes communes viennent de
// `createFunding` (`funding-commands.mjs`).
import { fail } from '../../socle/errors.mjs';
import { today } from '../../socle/clock.mjs';
import { expectedRevisionOf, money, oneOf, text } from '../../socle/validation.mjs';
import { occurrenceDates } from './recurrence.mjs';
import { fmt, frDate, OVERRUN_REASONS, inRegime, returnsOf, isAbandoned, overrunView, fundingFigures } from './funding-rules.mjs';
import { abandonPlan, abandonPreview } from './funding.mjs';

/** @param helpers gardes et écritures partagées avec `createFunding` */
export function createProjectCommands(socle, { lifeBudgetOf, standardOf, taskOf, approval, grantRequest, newOverrun, noPendingOverrun }) {
  const { om } = socle;

  /**
   * Demande d'autorisation de dépassement adressée au budget de vie (une demande en attente par projet).
   * `approve: true` la demande et l'autorise d'une même écriture.
   */
  async function requestOverrun(ctx, budgetId, input = {}) {
    const r = await om.command(
      'requestProjectOverrun',
      ctx,
      input,
      (tx) => {
        const b = standardOf(tx.draft, tx.userId, budgetId);
        if (!inRegime(b)) fail('FORBIDDEN_BY_RULE', 'Ce projet n’a pas encore d’enveloppe : attribuez-la d’abord, un dépassement se demande ensuite.', { field: 'budgetId' });
        noPendingOverrun(tx.draft, b);
        const taskId = input.taskId ? taskOf(tx.draft, tx.userId, b, input.taskId).id : null;
        const x = newOverrun(tx, b, {
          taskId,
          reason: oneOf('reason', input.reason, Object.keys(OVERRUN_REASONS)),
          amountCents: money('amount', input.amount, { positive: true }),
          note: text('note', input.note, { max: 1000 }) || null,
          approve: input.approve === true,
        });
        return { overrunId: x.id, budgetId: b.id };
      },
      { creation: true },
    );
    return { ...r, overrun: overrunView(socle.stateOf(ctx), socle.stateOf(ctx).projectOverruns[r.overrunId]) };
  }

  /**
   * Décision du budget de vie. Autoriser : le projet passe en déficit (rouge), son plafond augmente du montant
   * autorisé et la charge de dépassement sera facturée au budget de vie à la fin de la période en cours du cycle.
   */
  async function decideOverrun(ctx, id, input = {}) {
    let notice = null;
    await om.command('decideProjectOverrun', ctx, input, (tx) => {
      const x = om.owned(tx.draft, 'projectOverrun', id, tx.userId);
      om.checkRevision(x, expectedRevisionOf(input));
      if (x.status !== 'pending') fail('FORBIDDEN_BY_RULE', 'Cette demande a déjà reçu une décision.', { status: x.status });
      const decision = oneOf('decision', input.decision, ['approve', 'refuse']);
      const now = today();
      om.update(tx, x, decision === 'refuse' ? { status: 'refused', decidedAt: now } : approval(tx.draft, tx.userId));
      const request = x.taskBudgetRequestId ? tx.draft.taskBudgetRequests[x.taskBudgetRequestId] : null;
      if (request?.status === 'awaiting-life') {
        const b = standardOf(tx.draft, tx.userId, x.budgetId);
        taskOf(tx.draft, tx.userId, b, request.taskId);
        if (decision === 'refuse') om.update(tx, request, { status: 'refused', decidedAt: now });
        else {
          const fig = fundingFigures(tx.draft, b);
          const after = fig.sharesCents + Math.max(0, request.amountCents - (fig.shares[request.taskId] ?? 0));
          if (after <= fig.ceilingCents) grantRequest(tx, b, request);
          // Si la ventilation a changé entre-temps, la demande reste visible et doit être réexaminée.
          else {
            om.update(tx, request, { status: 'pending', overrunId: null });
            const title = tx.draft.tasks[request.taskId]?.title ?? 'la tâche';
            notice = `Dépassement de ${fmt(x.amountCents)} autorisé : l’enveloppe passe à ${fmt(fig.ceilingCents)}. Mais les parts ont changé depuis la demande : accorder ${fmt(request.amountCents)} à « ${title} » demanderait encore ${fmt(after - fig.ceilingCents)}. La demande revient au projet pour être réexaminée.`;
          }
        }
      }
      return { overrunId: id };
    });
    const x = socle.stateOf(ctx).projectOverruns[id];
    return { overrun: overrunView(socle.stateOf(ctx), x), notice };
  }

  /**
   * Fin de cycle : les dépassements autorisés dont la date de facturation est atteinte sont facturés au budget de vie ;
   * le budget attribué de chaque projet concerné intègre ces montants, son déficit est soldé et ses contrôles de fin
   * de cycle (budget = somme des parts, charges des tâches planifiées et à jour) sont rendus.
   */
  async function billOverruns(ctx, input = {}) {
    const touched = new Set();
    await om.command('billProjectOverruns', ctx, input, (tx) => {
      if (!lifeBudgetOf(tx.draft, tx.userId)) fail('NOT_FOUND', 'Budget « Projet de vie » à préparer.');
      const now = today();
      const due = om.list(tx.draft, 'projectOverrun', (x) => x.userId === tx.userId && x.status === 'approved' && (!input.budgetId || x.budgetId === input.budgetId));
      const billable = due.filter((x) => !x.billingDate || x.billingDate <= now);
      if (!billable.length) {
        const next = due.map((x) => x.billingDate).filter(Boolean).sort()[0];
        fail('FORBIDDEN_BY_RULE', next ? `Les dépassements autorisés seront facturables à la fin du cycle, le ${frDate(next)} : rien à facturer avant.` : 'Aucun dépassement autorisé à facturer.', { nextBillingDate: next ?? null });
      }
      for (const x of billable) {
        const b = tx.draft.budgets[x.budgetId];
        om.update(tx, b, { allocationCents: b.allocationCents + x.amountCents });
        om.update(tx, x, { status: 'billed', billedAt: now });
        touched.add(b.id);
      }
      return { billed: billable.map((x) => x.id) };
    });
    return { budgetIds: [...touched] };
  }


  /**
   * Abandon d'un projet de la vie (voir `abandonPlan`) : une seule écriture. Le projet garde son historique (règlements,
   * dépassements facturés, tâches) et ne reçoit plus d'écriture tant qu'il n'est pas repris.
   */
  async function abandonProject(ctx, budgetId, input = {}) {
    let preview = null;
    await om.command('abandonProject', ctx, input, (tx) => {
      const b = standardOf(tx.draft, tx.userId, budgetId, { allowAbandoned: true });
      om.checkRevision(b, expectedRevisionOf(input));
      if (isAbandoned(b)) fail('FORBIDDEN_BY_RULE', `Le projet « ${b.name} » est déjà abandonné.`, { budgetId });
      const now = today();
      const plan = abandonPlan(tx.draft, b, now);
      const reason = text('reason', input.reason, { max: 1000 }) || null;
      const why = `Projet « ${b.name} » abandonné`;
      for (const id of plan.requestIds) om.update(tx, tx.draft.taskBudgetRequests[id], { status: 'cancelled', decidedAt: now });
      for (const id of plan.pendingOverrunIds) om.update(tx, tx.draft.projectOverruns[id], { status: 'refused', decidedAt: now });
      for (const id of plan.cancelledOverrunIds) om.update(tx, tx.draft.projectOverruns[id], { status: 'cancelled', cancelledAt: now });
      if (plan.trimmedOverrun) om.update(tx, tx.draft.projectOverruns[plan.trimmedOverrun.id], { amountCents: plan.trimmedOverrun.amountCents });
      for (const id of plan.plannedIds) om.update(tx, tx.draft.operations[id], { status: 'cancelled', cancelledFrom: 'planned', cancelReason: why });
      // Une récurrence jamais réglée est supprimée ; une récurrence réglée s'arrête à sa dernière échéance réglée,
      // et ses échéances antérieures restées attendues sont écartées.
      for (const id of plan.recurrenceIds) {
        const r = tx.draft.recurrences[id];
        const ops = om.list(tx.draft, 'operation', (o) => o.recurrenceId === id);
        const settled = ops.filter((o) => o.status === 'realized').map((o) => o.occurrenceDate).sort();
        if (!settled.length) {
          om.update(tx, r, { cancelledAt: now, cancelReason: why });
          continue;
        }
        const endDate = settled.at(-1);
        const known = new Set(ops.map((o) => o.occurrenceDate));
        for (const d of occurrenceDates(r, r.firstDate, endDate)) {
          if (known.has(d)) continue;
          om.create(tx, 'operation', {
            budgetId: r.budgetId, direction: r.direction, label: r.label, amountCents: r.amountCents, date: d, status: 'cancelled', cancelledFrom: 'planned', cancelReason: why,
            realizedAmountCents: null, realizedDate: null, recurrenceId: r.id, occurrenceDate: d, note: r.note ?? null, taskId: r.taskId ?? null,
            standardCostCenter: r.standardCostCenter, costCenterId: r.costCenterId, categoryId: r.categoryId ?? null,
          });
        }
        om.update(tx, r, { endDate });
      }
      const current = tx.draft.budgets[budgetId];
      const triggeredReturns = Object.fromEntries(Object.entries(returnsOf(current)).filter(([, ret]) => ret.entryId));
      preview = abandonPreview(plan);
      om.update(tx, current, {
        ...(plan.regime ? { allocationCents: plan.allocationAfterCents } : {}),
        taskSharesCents: plan.sharesAfter,
        taskReturns: triggeredReturns,
        abandonedAt: now,
        abandonReason: reason,
        abandonment: preview,
      });
      return { budgetId };
    });
    return { budgetId, abandonment: preview };
  }

  /** Reprise d'un projet abandonné : il reçoit de nouveau des écritures ; son enveloppe se réattribue au besoin. */
  async function resumeProject(ctx, budgetId, input = {}) {
    await om.command('resumeProject', ctx, input, (tx) => {
      const b = standardOf(tx.draft, tx.userId, budgetId, { allowAbandoned: true });
      om.checkRevision(b, expectedRevisionOf(input));
      if (!isAbandoned(b)) fail('FORBIDDEN_BY_RULE', `Le projet « ${b.name} » n’est pas abandonné.`, { budgetId });
      om.update(tx, b, { abandonedAt: null, abandonReason: null, abandonment: null });
      return { budgetId };
    });
    return { budgetId };
  }


  return { requestOverrun, decideOverrun, billOverruns, abandonProject, resumeProject };
}
