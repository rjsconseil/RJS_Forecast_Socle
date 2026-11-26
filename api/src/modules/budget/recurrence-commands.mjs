// Budget Management — définitions récurrentes : création, modification (échéances attendues seulement), règlement et
// écart d'une occurrence, report d'une ligne par la clôture d'un cycle.
import { fail } from '../../socle/errors.mjs';
import { today } from '../../socle/clock.mjs';
import { date, expectedRevisionOf, money, oneOf, text } from '../../socle/validation.mjs';
import { CADENCES, isOccurrence, parseOccurrenceKey } from './recurrence.mjs';
import { abandonedRefusal, isAbandoned } from './funding.mjs';
import { DIRECTIONS, toEuros } from './views.mjs';
import { realizedDateOf } from './guards.mjs';

/** Commandes du middleware Budget ; `kit` : sa portée, ses vues et ses gardes (assemblés dans index.mjs). */
export function recurrenceCommands(socle, kit) {
  const { om, lifeBudgetOf, costCenterFields, categoryFor, categoryPatch, operationView, taskFor, note, recurrenceView, guard, definitionGuard, postsProjectIncome, plannedFunding, projectAccounting, settlementDates, settlementGuard } = kit;
  return {
    buildRecurrence(tx, input) {
      const budgetId = input.budgetId ?? lifeBudgetOf(tx.draft, tx.userId)?.id;
      if (!budgetId) fail('REFERENCE_NOT_FOUND', 'Aucun Budget « Projet de vie » pour ce user.', { field: 'budgetId' });
      const budget = om.owned(tx.draft, 'budget', budgetId, tx.userId);
      if (isAbandoned(budget)) abandonedRefusal(budget);
      const direction = oneOf('direction', input.direction, DIRECTIONS);
      const firstDate = date('firstDate', input.firstDate ?? input.date, { required: true });
      const endDate = date('endDate', input.endDate);
      if (endDate && endDate < firstDate) fail('VALIDATION', 'La fin ne peut pas précéder la première date.', { field: 'endDate' });
      const cat = categoryFor(tx.draft, tx.userId, input.categoryId, { direction, costCenterRef: input.costCenterRef });
      definitionGuard(tx.draft, { userId: tx.userId, budgetId }, firstDate, endDate, true);
      return om.create(tx, 'recurrence', {
        budgetId,
        direction,
        label: text('label', input.label, { required: true, max: 200 }),
        amountCents: money('amount', input.amount, { positive: true }),
        cadence: oneOf('cadence', input.cadence, CADENCES),
        firstDate,
        endDate,
        note: note(input.note),
        taskId: taskFor(tx.draft, tx.userId, budget, input.taskId),
        ...plannedFunding(tx.draft, budgetId, input),
        ...costCenterFields(tx.draft, tx.userId, input.costCenterRef || cat?.costCenterRef, direction),
        categoryId: cat?.id ?? null,
        enteredOn: today(),
      });
    },

    async createRecurrence(ctx, input = {}) {
      const r = await om.command('createRecurrence', ctx, input, (tx) => ({ recurrenceId: this.buildRecurrence(tx, input).id }), { creation: true });
      return { replayed: r.replayed, recurrence: recurrenceView(socle.state, socle.state.recurrences[r.recurrenceId]) };
    },

    patchRecurrence(tx, id, input = {}, { budgetId } = {}) {
        const r = om.owned(tx.draft, 'recurrence', id, tx.userId);
        if (budgetId && r.budgetId !== budgetId) fail('INCOMPATIBLE_REFERENCE', 'Cette récurrence appartient à un autre budget.', { field: 'recurrenceId', budgetId });
        const settlements = om.list(tx.draft, 'operation', (o) => o.recurrenceId === id);
        const patch = {};
        if ('label' in input) patch.label = text('label', input.label, { required: true, max: 200 });
        if ('amount' in input) patch.amountCents = money('amount', input.amount, { positive: true });
        if ('note' in input) patch.note = note(input.note);
        Object.assign(patch, plannedFunding(tx.draft, r.budgetId, input));
        if ('cadence' in input || 'firstDate' in input) {
          if (settlements.length) fail('FORBIDDEN_BY_RULE', 'Des occurrences sont déjà réglées : la cadence et la première date sont figées. Terminez cette définition et créez-en une nouvelle.', { field: 'firstDate' });
          if ('cadence' in input) patch.cadence = oneOf('cadence', input.cadence, CADENCES);
          if ('firstDate' in input) patch.firstDate = date('firstDate', input.firstDate, { required: true });
        }
        if ('endDate' in input) patch.endDate = date('endDate', input.endDate);
        const firstDate = patch.firstDate ?? r.firstDate;
        const endDate = 'endDate' in patch ? patch.endDate : r.endDate;
        if (endDate && endDate < firstDate) fail('VALIDATION', 'La fin ne peut pas précéder la première date.', { field: 'endDate' });
        // Une fin posée garde tout ce qui a eu lieu : aucune échéance réglée après la dernière échéance prévue.
        // Les échéances encore attendues au-delà (prévisions modifiées, matérialisées) tombent avec la définition.
        const beyond = patch.endDate ? settlements.filter((o) => o.occurrenceDate && o.occurrenceDate > patch.endDate) : [];
        const settledBeyond = beyond.filter((o) => o.status === 'realized').map((o) => o.occurrenceDate).sort();
        if (settledBeyond.length)
          fail('VALIDATION', `Une échéance du ${settledBeyond.at(-1)} est déjà réglée : la dernière échéance ne peut pas la précéder.`, { field: 'endDate', lastSettled: settledBeyond.at(-1) });
        if ('costCenterRef' in input) Object.assign(patch, costCenterFields(tx.draft, tx.userId, input.costCenterRef, r.direction));
        Object.assign(patch, categoryPatch(tx.draft, tx.userId, r, input, { direction: r.direction, ...patch }));
        if ('taskId' in input) patch.taskId = taskFor(tx.draft, tx.userId, tx.draft.budgets[r.budgetId], input.taskId);
        // Occurrences touchées : celles de la définition avant et après la modification.
        definitionGuard(tx.draft, r, firstDate < r.firstDate ? firstDate : r.firstDate, endDate == null || r.endDate == null ? null : endDate > r.endDate ? endDate : r.endDate, true);
        om.update(tx, r, patch);
        for (const o of beyond) if (o.status === 'planned') om.update(tx, o, { status: 'cancelled', cancelledFrom: 'planned', cancelReason: 'Après la dernière échéance de la définition', closedAt: tx.now, closedOn: today() });
        return { recurrence: r, scope: { appliesTo: 'occurrences encore attendues', settledUntouched: settlements.length } };
    },

    /**
     * Modifie une définition. Portée : les occurrences encore attendues ; les règlements déjà
     * enregistrés gardent leurs dates et montants. La première date est figée dès qu'un règlement existe.
     */
    async updateRecurrence(ctx, id, input = {}) {
      let scope;
      await om.command('updateRecurrence', ctx, input, (tx) => {
        om.checkRevision(om.owned(tx.draft, 'recurrence', id, tx.userId), expectedRevisionOf(input));
        scope = this.patchRecurrence(tx, id, input).scope;
        return { recurrenceId: id };
      });
      return { recurrence: recurrenceView(socle.state, socle.state.recurrences[id]), scope };
    },

    /**
     * Règlement d'une occurrence attendue : crée l'opération réglée (date et montant prévus de la
     * définition, date et montant réels saisis). Un second règlement de la même occurrence est refusé.
     * Règle retenue [P] : une échéance d'une période close peut être réglée plus tard ; le règlement
     * compte dans le réalisé de sa date réelle, l'historique clos n'est pas modifié.
     */
    async settleOccurrence(ctx, recurrenceId, input = {}) {
      const r = await om.command(
        'settleOccurrence',
        ctx,
        input,
        (tx) => {
          const rec = om.owned(tx.draft, 'recurrence', recurrenceId, tx.userId);
          const occurrenceDate = date('occurrenceDate', input.occurrenceDate, { required: true });
          if (!isOccurrence(rec, occurrenceDate)) fail('VALIDATION', "Cette date n'est pas une occurrence de la définition.", { field: 'occurrenceDate' });
          const existing = om.list(tx.draft, 'operation', (o) => o.recurrenceId === rec.id && o.occurrenceDate === occurrenceDate)[0];
          if (existing?.status === 'realized') fail('ALREADY_SETTLED', 'Cette occurrence est déjà réglée.', { operationId: existing.id, realizedDate: existing.realizedDate });
          // Une occurrence matérialisée conserve sa tâche et son sens, même après annulation.
          // La garde contrôle les valeurs effectivement portées par l'opération qui sera réglée.
          const taskId = existing ? existing.taskId ?? null : rec.taskId ?? null;
          const direction = existing ? existing.direction : rec.direction;
          const realizedDate = realizedDateOf(input.realizedDate ?? occurrenceDate);
          const realizedAmountCents = money('realizedAmount', input.realizedAmount ?? toEuros(rec.amountCents), { positive: true });
          const accounting = projectAccounting(tx.draft, rec.budgetId, input, realizedDate, {
            ...existing, plannedFundingSource: rec.plannedFundingSource,
          });
          if (postsProjectIncome(tx.draft, rec.budgetId, direction)) accounting.independentIncome = true;
          taskFor(tx.draft, tx.userId, tx.draft.budgets[rec.budgetId], taskId);
          guard(tx.draft, { ...rec, ...accounting }, settlementDates(tx.draft, rec.budgetId, { realizedDate, ...accounting }));
          settlementGuard(tx, { userId: rec.userId, budgetId: rec.budgetId, direction, amountCents: realizedAmountCents, realizedDate, ...accounting, taskId, operationId: existing?.id ?? null, recurrenceId: rec.id, occurrenceDate }, input.fund);
          if (existing) {
            om.update(tx, existing, { status: 'realized', realizedAmountCents, realizedDate, closedAt: tx.now, closedOn: today(), ...accounting });
            return { operationId: existing.id };
          }
          const op = om.create(tx, 'operation', {
            budgetId: rec.budgetId,
            direction,
            label: rec.label,
            amountCents: rec.amountCents,
            date: occurrenceDate,
            status: 'realized',
            realizedAmountCents,
            realizedDate,
            closedAt: tx.now, closedOn: today(),
            ...accounting,
            recurrenceId: rec.id,
            occurrenceDate,
            note: note(input.note) ?? rec.note ?? null,
            taskId,
            standardCostCenter: rec.standardCostCenter,
            costCenterId: rec.costCenterId,
            categoryId: rec.categoryId ?? null,
          });
          return { operationId: op.id };
        },
        { creation: true },
      );
      return { replayed: r.replayed, operation: operationView(socle.state, socle.state.operations[r.operationId]) };
    },

    /**
     * Écarte une échéance attendue qui n'aura pas lieu (abonnement suspendu, loyer offert, doublon) : elle
     * sort de toutes les sommes et la définition continue. Comme un règlement tardif, c'est permis pour une
     * échéance d'une période close : le résultat clos ne compte que le réalisé, il ne change pas.
     * Une échéance réglée s'écarte après l'annulation de son règlement. `restoreOccurrence` la rétablit.
     */
    async skipOccurrence(ctx, recurrenceId, input = {}) {
      const r = await om.command(
        'skipOccurrence',
        ctx,
        input,
        (tx) => {
          const rec = om.owned(tx.draft, 'recurrence', recurrenceId, tx.userId);
          if (rec.cancelledAt) fail('FORBIDDEN_BY_RULE', 'Cette définition est supprimée.', { recurrenceId });
          const occurrenceDate = date('occurrenceDate', input.occurrenceDate, { required: true });
          if (!isOccurrence(rec, occurrenceDate)) fail('VALIDATION', "Cette date n'est pas une occurrence de la définition.", { field: 'occurrenceDate' });
          const existing = om.list(tx.draft, 'operation', (o) => o.recurrenceId === rec.id && o.occurrenceDate === occurrenceDate)[0];
          if (existing?.status === 'realized') fail('ALREADY_SETTLED', 'Cette échéance est réglée : annulez d’abord son règlement.', { operationId: existing.id });
          if (existing?.status === 'cancelled') fail('FORBIDDEN_BY_RULE', 'Cette échéance est déjà écartée.', { operationId: existing.id });
          const cancelReason = 'reason' in input ? note(input.reason) : null;
          if (existing) {
            om.update(tx, existing, { status: 'cancelled', cancelledFrom: existing.status, cancelReason, closedAt: tx.now, closedOn: today() });
            return { operationId: existing.id };
          }
          const op = om.create(tx, 'operation', {
            budgetId: rec.budgetId,
            direction: rec.direction,
            label: rec.label,
            amountCents: rec.amountCents,
            date: occurrenceDate,
            status: 'cancelled',
            cancelledFrom: 'planned',
            cancelReason,
            closedAt: tx.now, closedOn: today(),
            realizedAmountCents: null,
            realizedDate: null,
            recurrenceId: rec.id,
            occurrenceDate,
            note: rec.note ?? null,
            taskId: rec.taskId ?? null,
            standardCostCenter: rec.standardCostCenter,
            costCenterId: rec.costCenterId,
            categoryId: rec.categoryId ?? null,
          });
          return { operationId: op.id };
        },
        { creation: true },
      );
      return { replayed: r.replayed, operation: operationView(socle.state, socle.state.operations[r.operationId]) };
    },

    /** Rétablit une échéance écartée : elle redevient attendue, à sa date et à son montant prévus. */
    async restoreOccurrence(ctx, recurrenceId, input = {}) {
      let id;
      await om.command('restoreOccurrence', ctx, input, (tx) => {
        const rec = om.owned(tx.draft, 'recurrence', recurrenceId, tx.userId);
        if (rec.cancelledAt) fail('FORBIDDEN_BY_RULE', 'Cette définition est supprimée.', { recurrenceId });
        const occurrenceDate = date('occurrenceDate', input.occurrenceDate, { required: true });
        const skipped = om.list(tx.draft, 'operation', (o) => o.recurrenceId === rec.id && o.occurrenceDate === occurrenceDate)[0];
        if (skipped?.status !== 'cancelled') fail('FORBIDDEN_BY_RULE', "Cette échéance n'est pas écartée.", { occurrenceDate });
        om.checkRevision(skipped, expectedRevisionOf(input));
        om.update(tx, skipped, { status: 'planned', cancelledFrom: null, cancelReason: null, closedAt: null, closedOn: null });
        id = skipped.id;
        return { operationId: id };
      });
      return { operation: operationView(socle.state, socle.state.operations[id]) };
    },

    /**
     * Supprime une définition saisie par erreur, tant qu'aucune de ses échéances n'est réglée : toutes ses
     * échéances sortent des sommes et des listes ; elle reste dans la base, datée de sa suppression.
     * Une définition déjà réglée ne se supprime pas : on la termine (dernière échéance), l'historique reste juste.
     */
    async cancelRecurrence(ctx, id, input = {}) {
      await om.command('cancelRecurrence', ctx, input, (tx) => {
        const rec = om.owned(tx.draft, 'recurrence', id, tx.userId);
        om.checkRevision(rec, expectedRevisionOf(input));
        if (rec.cancelledAt) fail('FORBIDDEN_BY_RULE', 'Cette définition est déjà supprimée.', { recurrenceId: id });
        const materialized = om.list(tx.draft, 'operation', (o) => o.recurrenceId === id);
        const settled = materialized.filter((o) => o.status === 'realized');
        if (settled.length)
          fail('FORBIDDEN_BY_RULE', 'Des échéances sont déjà réglées : annulez leurs règlements, ou terminez la définition par une dernière échéance.', { recurrenceId: id, settled: settled.length });
        definitionGuard(tx.draft, rec, rec.firstDate, rec.endDate);
        for (const o of materialized) if (o.status === 'planned') om.update(tx, o, { status: 'cancelled', cancelledFrom: 'planned', cancelReason: 'Définition supprimée', closedAt: tx.now, closedOn: today() });
        om.update(tx, rec, { cancelledAt: today(), cancelReason: 'reason' in input ? note(input.reason) : null });
        return { recurrenceId: id };
      });
      return { recurrence: recurrenceView(socle.state, socle.state.recurrences[id]) };
    },

    /**
     * Report d'une échéance non réglée vers un cycle à venir (dans une écriture composée, ex. la clôture du cycle) :
     * - une saisie ponctuelle prévue change de date et garde son identité ;
     * - une occurrence (récurrente) est écartée de son cycle et une saisie ponctuelle prévue la remplace à `toDate`.
     * `carriedFrom` garde l'origine (ligne, date prévue, période, cycle cible) ; l'occurrence écartée garde `carriedTo`.
     * Les gardes de dates s'appliquent comme à toute saisie.
     */
    carryOverLine(tx, lineId, { toDate, periodKey, periodLabel, toPeriodKey = null, toPeriodLabel = null }) {
      const target = date('toDate', toDate, { required: true });
      const occurrence = parseOccurrenceKey(lineId);
      const existing = occurrence
        ? om.list(tx.draft, 'operation', (o) => o.recurrenceId === occurrence.recurrenceId && o.occurrenceDate === occurrence.date)[0] ?? null
        : om.owned(tx.draft, 'operation', lineId, tx.userId);
      const rec = occurrence ? om.owned(tx.draft, 'recurrence', occurrence.recurrenceId, tx.userId) : existing?.recurrenceId ? tx.draft.recurrences[existing.recurrenceId] : null;
      if (existing?.status === 'realized') fail('ALREADY_SETTLED', 'Cette échéance est réglée : elle ne se reporte plus.', { lineId });
      if (existing?.status === 'cancelled') fail('FORBIDDEN_BY_RULE', 'Cette échéance est écartée : elle ne se reporte plus.', { lineId });
      const source = existing ?? rec;
      const plannedDate = existing?.date ?? occurrence.date;
      const carriedFrom = { lineId, date: plannedDate, periodKey: periodKey ?? null, ...(toPeriodKey ? { toPeriodKey } : {}) };
      // Saisie ponctuelle : même opération, nouvelle date prévue.
      if (existing && !existing.recurrenceId) {
        guard(tx.draft, existing, [target], [target], { carried: true });
        om.update(tx, existing, { date: target, carriedFrom });
        return { operationId: existing.id, moved: true };
      }
      // Occurrence : écartée de son cycle, remplacée par une saisie ponctuelle prévue dans le cycle cible.
      const reason = `${toPeriodLabel ? `Reportée en ${toPeriodLabel}` : 'Reportée au cycle suivant'}${periodLabel ? ` (${periodLabel})` : ''}`;
      const carriedTo = { periodKey: toPeriodKey, date: target };
      if (existing) om.update(tx, existing, { status: 'cancelled', cancelledFrom: existing.status, cancelReason: reason, closedAt: tx.now, closedOn: today(), carriedTo });
      else {
        om.create(tx, 'operation', {
          budgetId: rec.budgetId, direction: rec.direction, label: rec.label, amountCents: rec.amountCents, date: occurrence.date,
          status: 'cancelled', cancelledFrom: 'planned', cancelReason: reason, closedAt: tx.now, closedOn: today(), carriedTo, realizedAmountCents: null, realizedDate: null,
          recurrenceId: rec.id, occurrenceDate: occurrence.date, note: rec.note ?? null, taskId: rec.taskId ?? null,
          standardCostCenter: rec.standardCostCenter, costCenterId: rec.costCenterId, categoryId: rec.categoryId ?? null,
        });
      }
      const fields = {
        recurrenceId: null, occurrenceDate: null, budgetId: source.budgetId, direction: source.direction, label: source.label,
        amountCents: source.amountCents, date: target, status: 'planned', entryStatus: 'planned', enteredOn: today(), realizedAmountCents: null, realizedDate: null,
        note: source.note ?? null, taskId: source.taskId ?? null, standardCostCenter: source.standardCostCenter, costCenterId: source.costCenterId,
        categoryId: source.categoryId ?? null, ...(source.plannedFundingSource !== undefined ? { plannedFundingSource: source.plannedFundingSource } : {}), carriedFrom,
      };
      guard(tx.draft, { ...fields, userId: tx.userId }, [target], [target], { carried: true });
      return { operationId: om.create(tx, 'operation', fields).id, moved: false };
    },
  };
}
