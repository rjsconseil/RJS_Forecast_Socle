// Budget Management — gardes et imputations des écritures : gardes des niveaux supérieurs (périodes closes, cycle en
// clôture, définitions récurrentes), imputation des règlements d'un projet de la vie, garde de validation d'un règlement.
import { fail } from '../../socle/errors.mjs';
import { today } from '../../socle/clock.mjs';
import { date, oneOf } from '../../socle/validation.mjs';

/** Une réalisation ne peut pas être datée dans le futur (C03) : refus explicite, aucun changement de statut. */
export function realizedDateOf(value) {
  const d = date('realizedDate', value, { required: true });
  if (d > today()) fail('FUTURE_REALIZATION', `Date de réalisation dans le futur (${d}) : une opération ne peut être réglée qu'à une date passée ou aujourd'hui.`, { field: 'realizedDate', value: d, today: today() });
  return d;
}

export function createBudgetGuards(socle, funding) {
  /**
   * Garde des niveaux supérieurs (ex. période close) sur les dates d'une opération. `opens` : dates prévues que
   * l'écriture ouvre (prévision créée ou déplacée), pour les niveaux qui figent la liste des échéances d'un cycle.
   * `carried` : report décidé par la clôture d'un cycle (les niveaux supérieurs savent qu'il en fait partie).
   */
  function guard(state, op, dates, opens = [], { carried = false } = {}) {
    for (const ext of socle.registry.extensions('operationGuard')) {
      ext(state, { userId: op.userId, budgetId: op.budgetId, dates, independentIncome: op.independentIncome, opens, carried }, socle);
    }
  }

  /**
   * Garde des niveaux supérieurs sur une définition récurrente : `from` → `to` (null = sans fin) couvre les
   * occurrences que la création, la modification ou la suppression touche (ex. cycle qui attend sa clôture).
   * `opens` : la création ou la modification ouvre des échéances (la suppression n'en ouvre aucune).
   */
  function definitionGuard(state, { userId, budgetId }, from, to, opens = false) {
    for (const ext of socle.registry.extensions('recurrenceGuard')) ext(state, { userId, budgetId, from, to, opens }, socle);
  }

  const postsProjectIncome = (state, budgetId, direction) => state.budgets[budgetId]?.role === 'standard' && direction === 'income';
  const plannedFunding = (state, budgetId, input) => {
    if (state.budgets[budgetId]?.role !== 'standard' || !('fundingSource' in input)) return {};
    return { plannedFundingSource: input.fundingSource == null ? null : oneOf('fundingSource', input.fundingSource, ['cycle', 'patrimoine']) };
  };

  // Un règlement de tâche conserve son paiement et choisit séparément son imputation.
  function projectAccounting(state, budgetId, input, realizedDate, previous = {}) {
    const b = state.budgets[budgetId];
    if (b?.role !== 'standard') return {};
    const fundingSource = oneOf('fundingSource', input.fundingSource ?? previous.fundingSource ?? previous.plannedFundingSource ?? b.fundingSource ?? 'cycle', ['cycle', 'patrimoine']);
    const accountingDate = date('accountingDate', input.accountingDate ?? realizedDate, { required: true });
    if (accountingDate < realizedDate) fail('VALIDATION', 'La validation ne peut pas précéder le paiement ou la réception.', { field: 'accountingDate' });
    if (accountingDate > today()) fail('FUTURE_REALIZATION', 'La validation ne peut pas être imputée dans le futur.', { field: 'accountingDate' });
    return { fundingSource, accountingDate };
  }
  function settlementDates(state, budgetId, values) {
    return state.budgets[budgetId]?.role === 'standard' ? [values.accountingDate ?? values.realizedDate].filter(Boolean) : [values.realizedDate].filter(Boolean);
  }


  /**
   * Garde des niveaux supérieurs sur la validation d'un règlement (opération réglée, réalisation,
   * règlement d'une occurrence) : par exemple le dépassement du budget attribué à un projet.
   */
  function settlementGuard(tx, input, fund) {
    // Règlement financé : la part et le dépassement nécessaires sont accordés dans la même écriture.
    if (fund === true) funding.fundSettlement(tx, input);
    for (const ext of socle.registry.extensions('settlementGuard')) ext(tx.draft, { ...input, authorizeTaskOverrun: fund === true }, socle);
  }

  return { guard, definitionGuard, postsProjectIncome, plannedFunding, projectAccounting, settlementDates, settlementGuard };
}
