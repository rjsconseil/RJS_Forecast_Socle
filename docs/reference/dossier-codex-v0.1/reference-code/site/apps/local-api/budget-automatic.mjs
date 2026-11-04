/** Un flux approuvé devient réel à son échéance, une seule fois. Les clôtures restent immuables. */
import { HttpError } from './api-http.mjs';
import { occurrencesBetween } from './bpm-flows.mjs';
import { assertClosedBudgetUnchanged } from './budget-patrimoine.mjs';
export function automaticBudgetFlows(budget, ledger, today, now = new Date().toISOString()) {
  const after = new Date(today + 'T12:00:00Z');
  after.setUTCDate(after.getUTCDate() + 1);
  let additions = 0;
  const operations = budget.operations.map((operation) => {
    if ((operation.decision ?? 'approved') !== 'approved') return operation;
    const closed = ledger.closures.filter(
      (x) =>
        (x.budgetProjectId ?? x.link?.budgetProjectId) === operation.budgetProjectId ||
        (x.sourceOperations ?? []).some((o) => o.id === operation.id),
    );
    const settled = new Set(operation.settlements.map((x) => x.occurrenceDate));
    const dates = occurrencesBetween(
      operation,
      operation.firstDate,
      after.toISOString().slice(0, 10),
    ).filter((date) => !settled.has(date) && !closed.some((x) => date >= x.start && date < x.end));
    if (!dates.length) return operation;
    if (operation.kind !== 'income' && !operation.centerId)
      throw new HttpError(
        400,
        `La dépense « ${operation.title} » doit avoir un poste avant son enregistrement automatique.`,
      );
    additions += dates.length;
    if (operation.settlements.length + dates.length > 2000)
      throw new HttpError(400, 'L’historique de la dépense dépasse la capacité des règlements.');
    return {
      ...operation,
      updatedAt: now,
      settlements: [
        ...operation.settlements,
        ...dates.map((date) => ({
          occurrenceDate: date,
          actualDate: date,
          amountCents: operation.amountCents,
        })),
      ].sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate)),
    };
  });
  const next = { ...budget, operations };
  assertClosedBudgetUnchanged(next, ledger);
  return { budget: next, additions };
}
