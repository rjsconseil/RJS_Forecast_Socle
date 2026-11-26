// Budget Management — opérations ponctuelles : saisie (prévue ou réglée), règlement, modification, annulation, report.
import { fail } from '../../socle/errors.mjs';
import { today } from '../../socle/clock.mjs';
import { date, expectedRevisionOf, money, oneOf, text } from '../../socle/validation.mjs';
import { CADENCES } from './recurrence.mjs';
import { STD } from './lines.mjs';
import { DIRECTIONS, toEuros } from './views.mjs';
import { realizedDateOf } from './guards.mjs';

/** Commandes du middleware Budget ; `kit` : sa portée, ses vues et ses gardes (assemblés dans index.mjs). */
export function operationCommands(socle, kit) {
  const { om, lifeBudgetOf, costCenterFields, categoryFor, categoryPatch, operationView, taskFor, note, guard, postsProjectIncome, plannedFunding, projectAccounting, settlementDates, settlementGuard } = kit;
  return {

    /** Opération ponctuelle (prévue ou réalisée) ; utilisable dans une commande composée. */
    buildOperation(tx, input = {}) {
      const budgetId = input.budgetId ?? lifeBudgetOf(tx.draft, tx.userId)?.id;
      if (!budgetId) fail('REFERENCE_NOT_FOUND', 'Aucun Budget « Projet de vie » pour ce user.', { field: 'budgetId' });
      om.owned(tx.draft, 'budget', budgetId, tx.userId);
      const direction = oneOf('direction', input.direction, DIRECTIONS);
      const status = oneOf('status', input.status, ['planned', 'realized'], 'planned');
      const amountCents = money('amount', input.amount, { positive: true });
      const opDate = date('date', input.date, { required: true });
      const realizedAmountCents = status === 'realized' ? money('realizedAmount', input.realizedAmount ?? input.amount, { positive: true }) : null;
      const realizedDate = status === 'realized' ? realizedDateOf(input.realizedDate ?? input.date) : null;
      const budget = tx.draft.budgets[budgetId];
      const cat = categoryFor(tx.draft, tx.userId, input.categoryId, { direction, costCenterRef: input.costCenterRef });
      const fields = {
        recurrenceId: null,
        occurrenceDate: null,
        note: note(input.note),
        taskId: taskFor(tx.draft, tx.userId, budget, input.taskId),
        budgetId,
        direction,
        label: text('label', input.label, { required: true, max: 200 }),
        amountCents,
        date: opDate,
        status,
        realizedAmountCents,
        realizedDate,
        ...plannedFunding(tx.draft, budgetId, input),
        ...(status === 'realized' ? projectAccounting(tx.draft, budgetId, input, realizedDate) : {}),
        ...(status === 'realized' && postsProjectIncome(tx.draft, budgetId, direction) ? { independentIncome: true } : {}),
        ...costCenterFields(tx.draft, tx.userId, input.costCenterRef || cat?.costCenterRef, direction),
        categoryId: cat?.id ?? null,
        // Statut et jour de la saisie : une prévision ouvre un point à suivre du cycle, une saisie réglée n'en ouvre pas.
        entryStatus: status,
        enteredOn: today(),
      };
      guard(tx.draft, { ...fields, userId: tx.userId }, status === 'realized' && budget.role === 'standard' ? settlementDates(tx.draft, budgetId, fields) : [opDate, realizedDate].filter(Boolean), status === 'planned' ? [opDate] : []);
      if (status === 'realized') settlementGuard(tx, { userId: tx.userId, budgetId, direction, amountCents: realizedAmountCents, realizedDate, accountingDate: fields.accountingDate, fundingSource: fields.fundingSource, taskId: fields.taskId, operationId: null }, input.fund);
      return om.create(tx, 'operation', fields);
    },

    async createOperation(ctx, input = {}) {
      const r = await om.command('createOperation', ctx, input, (tx) => ({ operationId: this.buildOperation(tx, input).id }), { creation: true });
      return { replayed: r.replayed, operation: operationView(socle.state, socle.state.operations[r.operationId]) };
    },

    async updateOperation(ctx, id, input = {}) {
      await om.command('updateOperation', ctx, input, (tx) => {
        const o = om.owned(tx.draft, 'operation', id, tx.userId);
        om.checkRevision(o, expectedRevisionOf(input));
        if (o.status === 'cancelled') fail('FORBIDDEN_BY_RULE', 'Cette saisie est annulée : elle ne se modifie plus.', { operationId: id });
        const direction = 'direction' in input ? oneOf('direction', input.direction, DIRECTIONS) : o.direction;
        const patch = {
          direction,
          label: 'label' in input ? text('label', input.label, { required: true, max: 200 }) : o.label,
          amountCents: 'amount' in input ? money('amount', input.amount, { positive: true }) : o.amountCents,
          date: 'date' in input ? date('date', input.date, { required: true }) : o.date,
        };
        if ('costCenterRef' in input || direction !== o.direction) {
          Object.assign(patch, costCenterFields(tx.draft, tx.userId, input.costCenterRef ?? (o.costCenterId ?? STD + o.standardCostCenter), direction));
        }
        Object.assign(patch, categoryPatch(tx.draft, tx.userId, o, input, { direction, ...patch }));
        if ('note' in input) patch.note = note(input.note);
        if (o.status !== 'realized') Object.assign(patch, plannedFunding(tx.draft, o.budgetId, input));
        if ('taskId' in input) patch.taskId = taskFor(tx.draft, tx.userId, tx.draft.budgets[o.budgetId], input.taskId);
        // Une occurrence garde son identité : sa date prévue reste celle de la définition.
        if (o.recurrenceId && patch.date !== o.date) fail('FORBIDDEN_BY_RULE', "La date prévue d'une occurrence est fixée par sa définition récurrente.", { field: 'date' });
        const changesSense = o.status === 'realized' && patch.direction !== o.direction;
        if (changesSense) patch.independentIncome = postsProjectIncome(tx.draft, o.budgetId, patch.direction);
        const dates = o.independentIncome || patch.independentIncome
          ? settlementDates(tx.draft, o.budgetId, o) : [o.date, o.accountingDate ?? o.realizedDate, patch.date].filter(Boolean);
        guard(tx.draft, { ...o, independentIncome: o.independentIncome || patch.independentIncome }, dates, o.status === 'planned' && patch.date !== o.date ? [patch.date] : []);
        // Changer la tâche ou le sens d'une charge déjà réglée ne contourne pas le financement de la tâche.
        if (o.status === 'realized' && (patch.direction !== o.direction || patch.taskId !== undefined && patch.taskId !== o.taskId)) {
          settlementGuard(tx, { userId: o.userId, budgetId: o.budgetId, direction: patch.direction, amountCents: o.realizedAmountCents, realizedDate: o.realizedDate, accountingDate: o.accountingDate, fundingSource: o.fundingSource, taskId: patch.taskId !== undefined ? patch.taskId : o.taskId, operationId: o.id }, input.fund);
        }
        om.update(tx, o, patch);
        return { operationId: id };
      });
      return { operation: operationView(socle.state, socle.state.operations[id]) };
    },

    /** Réalisation manuelle [P] (C06 : la réalisation automatique reste ouverte). */
    async realizeOperation(ctx, id, input = {}) {
      await om.command('realizeOperation', ctx, input, (tx) => {
        const o = om.owned(tx.draft, 'operation', id, tx.userId);
        om.checkRevision(o, expectedRevisionOf(input));
        if (o.status === 'realized') fail('ALREADY_SETTLED', 'Cette opération est déjà réglée.', { operationId: id, realizedDate: o.realizedDate });
        if (o.status === 'cancelled') fail('FORBIDDEN_BY_RULE', 'Cette saisie est annulée : saisissez une nouvelle opération.', { operationId: id });
        const patch = {
          status: 'realized',
          realizedAmountCents: money('realizedAmount', input.realizedAmount ?? toEuros(o.amountCents), { positive: true }),
          realizedDate: realizedDateOf(input.realizedDate ?? o.date),
          // Moment du règlement : le point à suivre de cette prévision se clôt à cet instant.
          closedAt: tx.now, closedOn: today(),
        };
        Object.assign(patch, projectAccounting(tx.draft, o.budgetId, input, patch.realizedDate, o));
        if (postsProjectIncome(tx.draft, o.budgetId, o.direction)) patch.independentIncome = true;
        taskFor(tx.draft, tx.userId, tx.draft.budgets[o.budgetId], o.taskId);
        guard(tx.draft, { ...o, ...patch }, settlementDates(tx.draft, o.budgetId, patch));
        settlementGuard(tx, { userId: o.userId, budgetId: o.budgetId, direction: o.direction, amountCents: patch.realizedAmountCents, realizedDate: patch.realizedDate, accountingDate: patch.accountingDate, fundingSource: patch.fundingSource, taskId: o.taskId ?? null, operationId: o.id }, input.fund);
        om.update(tx, o, patch);
        return { operationId: id };
      });
      return { operation: operationView(socle.state, socle.state.operations[id]) };
    },

    /**
     * Annule un règlement (retour à « prévu ») tant que sa période de règlement n'est pas close.
     * L'opération garde son identité ; une occurrence redevient attendue avec la même clé.
     */
    async cancelRealization(ctx, id, input = {}) {
      await om.command('cancelRealization', ctx, input, (tx) => {
        const o = om.owned(tx.draft, 'operation', id, tx.userId);
        om.checkRevision(o, expectedRevisionOf(input));
        if (o.status !== 'realized') fail('FORBIDDEN_BY_RULE', "Cette opération n'est pas réglée.", { operationId: id });
        guard(tx.draft, o, settlementDates(tx.draft, o.budgetId, o));
        om.update(tx, o, { status: 'planned', realizedAmountCents: null, realizedDate: null, closedAt: null, closedOn: null, accountingDate: null, fundingSource: null, ...(o.independentIncome ? { independentIncome: false } : {}) });
        return { operationId: id };
      });
      return { operation: operationView(socle.state, socle.state.operations[id]) };
    },

    /**
     * Annule une saisie ponctuelle (doublon, erreur) : elle sort de toutes les sommes et de toutes les listes,
     * mais reste dans la base, avec son état d'avant. Refusé dans une période close (même garde que toute écriture),
     * et pour une occurrence récurrente, qui s'annule par son règlement (`cancelRealization`).
     */
    async cancelOperation(ctx, id, input = {}) {
      await om.command('cancelOperation', ctx, input, (tx) => {
        const o = om.owned(tx.draft, 'operation', id, tx.userId);
        om.checkRevision(o, expectedRevisionOf(input));
        if (o.status === 'cancelled') fail('FORBIDDEN_BY_RULE', 'Cette saisie est déjà annulée.', { operationId: id });
        if (o.recurrenceId) fail('FORBIDDEN_BY_RULE', "Une occurrence récurrente ne s'annule pas : annulez son règlement, ou modifiez sa définition.", { operationId: id, recurrenceId: o.recurrenceId });
        guard(tx.draft, o, (o.status === 'realized' && tx.draft.budgets[o.budgetId]?.role === 'standard' ? settlementDates(tx.draft, o.budgetId, o) : [o.date, o.realizedDate].filter(Boolean)));
        om.update(tx, o, { status: 'cancelled', cancelledFrom: o.status, cancelReason: 'reason' in input ? note(input.reason) : null, closedAt: tx.now, closedOn: today() });
        return { operationId: id };
      });
      return { operation: operationView(socle.state, socle.state.operations[id]) };
    },

    /** Saisie unique (éditeur partagé) : ponctuelle → opération ; cadence → définition récurrente, jamais ignorée. */
    async createEntry(ctx, input = {}) {
      const cadence = oneOf('cadence', input.cadence, ['once', ...CADENCES], 'once');
      return cadence === 'once' ? this.createOperation(ctx, input) : this.createRecurrence(ctx, input);
    },
  };
}
