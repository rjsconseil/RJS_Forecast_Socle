// Politique de période du middleware Budget. BPM fournit le contexte du cycle
// et conserve seulement les reçus de coordination Budget ↔ Patrimoine.
import { fail } from '../../socle/errors.mjs';
import { date, integer } from '../../socle/validation.mjs';
import { today } from './periods.mjs';

export function cycleFields(
  { anchorDay, startDate },
  startField = 'cycleStartDate',
) {
  const day = integer('anchorDay', anchorDay, {
    min: 1,
    max: 28,
    nullable: true,
  });
  const start = date(startField, startDate);
  return {
    frequency: 'monthly',
    anchorDay: day,
    startDate: day === null ? start : (start ?? today()),
    state: day === null ? 'to_configure' : 'active',
  };
}

export function assertCycleChange(
  current,
  next,
  closures,
  field = 'anchorDay',
) {
  if (
    closures.length &&
    (next.anchorDay !== current.anchorDay ||
      next.startDate !== current.startDate)
  ) {
    fail(
      'FORBIDDEN_BY_RULE',
      'Des périodes sont déjà closes : le jour d’ancrage et la date de début sont figés [P].',
      { field },
    );
  }
}

export function assertOpenDates({
  budget,
  principalBudgetId,
  closures,
  dates,
}) {
  const funded =
    budget?.parentBudgetId === principalBudgetId &&
    Number.isInteger(budget.allocationCents) &&
    typeof budget.allocationDate === 'string';
  if (!principalBudgetId || (principalBudgetId !== budget?.id && !funded))
    return;
  for (const c of closures) {
    const d = dates.find(
      (x) =>
        x >= c.periodStart &&
        x <= c.periodEnd &&
        (!funded || x >= budget.allocationDate),
    );
    if (d)
      fail(
        'PERIOD_CLOSED',
        `La période ${c.periodLabel} est close : ${principalBudgetId === budget.id ? 'opération refusée' : `dépense du projet « ${budget.name} » refusée`} (${d}). Datez-la dans la période en cours.`,
        { periodKey: c.periodKey, closureId: c.id, date: d },
      );
  }
}

export function assertClosable(period, firstOpen) {
  if (period.status === 'closed')
    fail('UNIQUENESS_VIOLATION', 'Cette période est déjà close.', {
      periodKey: period.key,
      closureId: period.closureId,
    });
  if (period.status !== 'ended')
    fail('FORBIDDEN_BY_RULE', 'Seule une période terminée peut être close.', {
      periodKey: period.key,
      end: period.end,
    });
  if (firstOpen.key !== period.key)
    fail(
      'FORBIDDEN_BY_RULE',
      `Les périodes se clôturent dans l'ordre : clôturer d'abord ${firstOpen.label} [P].`,
      { periodKey: firstOpen.key },
    );
}
