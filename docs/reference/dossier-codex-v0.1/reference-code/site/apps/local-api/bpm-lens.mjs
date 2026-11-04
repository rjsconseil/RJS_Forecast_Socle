import { periodFunding } from './bpm-funding.mjs';
/**
 * Les vues d'un projet Budget/Patrimoine par semaine, par mois et par année.
 * Pour chaque périodicité : la fenêtre qui contient aujourd'hui (la période du
 * cycle quand la vue est celle du cycle), son réalisé (règlements datés dans la
 * fenêtre), son prévu au montant planifié (toutes les échéances de la fenêtre),
 * ce qui reste à pointer, ses postes et ses sources ; puis la frise des fenêtres
 * passées et à venir, pour comparer le réel au prévisionnel. Lecture seule : la
 * clôture reste celle du cycle, la vue ne change que la façon de regarder.
 */
import { nextPeriod, periodStart, realizedFlows } from './budget-patrimoine.mjs';
import { incomeSources, occurrencesBetween, pendingFlows, spendingByCenter } from './bpm-flows.mjs';

export const BPM_LENSES = ['weekly', 'monthly', 'yearly'];

const DAY = 86_400_000;
const days = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY);

function previousPeriod(start, cadence) {
  const date = new Date(`${start}T12:00:00Z`);
  if (cadence === 'weekly') date.setUTCDate(date.getUTCDate() - 7);
  else if (cadence === 'monthly') date.setUTCMonth(date.getUTCMonth() - 1, 1);
  else date.setUTCFullYear(date.getUTCFullYear() - 1, 0, 1);
  return date.toISOString().slice(0, 10);
}

/** La fenêtre d'une vue : la période du cycle pour sa propre périodicité, sinon la semaine, le mois ou l'année civils. */
export function lensWindow(cadence, cycle, cyclePeriod, today) {
  if (cadence === cycle && cyclePeriod) return { start: cyclePeriod.start, end: cyclePeriod.end };
  const start = periodStart(today, cadence);
  return { start, end: nextPeriod(start, cadence) };
}

/** Le prévu d'une fenêtre au montant planifié : chaque échéance compte, pointée ou non. */
export function plannedFlows(budget, budgetProjectId, start, end) {
  let incomeCents = 0;
  let expenseCents = 0;
  for (const operation of budget.operations) {
    if (operation.budgetProjectId !== budgetProjectId || (operation.decision ?? 'approved') !== 'approved') continue;
    const total = occurrencesBetween(operation, start, end).length * operation.amountCents;
    if (operation.kind === 'income') incomeCents += total;
    else expenseCents += total;
  }
  return { incomeCents, expenseCents, netCents: incomeCents - expenseCents };
}

/**
 * Le relevé d'une fenêtre : chaque montant réellement reçu ou payé, avec son
 * opération, son poste et sa note. C'est le détail que le parcours de l'argent
 * dissèque, centime par centime ; les totaux restent ceux de `realizedFlows`.
 */
export function statementEntries(budget, budgetProjectId, start, end) {
  const operations = new Map(
    budget.operations.filter((operation) => operation.budgetProjectId === budgetProjectId).map((operation) => [operation.id, operation]),
  );
  return realizedFlows(budget, budgetProjectId, start, end)
    .entries.map((entry) => {
      const operation = operations.get(entry.operationId);
      return {
        operationId: entry.operationId,
        occurrenceDate: entry.occurrenceDate,
        actualDate: entry.actualDate,
        amountCents: entry.amountCents,
        kind: entry.kind === 'income' ? 'income' : 'expense',
        title: operation?.title ?? '',
        incomeType: operation?.incomeType ?? '',
        centerId: operation?.centerId ?? null,
        note: operation?.description ?? '',
        cadence: operation?.cadence ?? 'once',
      };
    })
    .sort((a, b) => a.actualDate.localeCompare(b.actualDate) || a.title.localeCompare(b.title, 'fr'));
}

/**
 * Le relevé complet d'une fenêtre quelconque (semaine, mois, année ou période
 * clôturée) : réalisé, prévu restant, postes, sources, chaque montant et la
 * clôture qui la couvre exactement. Calculé à la lecture, jamais stocké.
 */
export function bpmStatement({ budget, budgetProjectId, start, end, closures, today }) {
  const realized = realizedFlows(budget, budgetProjectId, start, end);
  const pending = pendingFlows(budget, budgetProjectId, start, end);
  const closure = closures.find((entry) => entry.start === start && entry.end === end) ?? null;
  return {
    start,
    end,
    today,
    funding: periodFunding(budget,budgetProjectId,start,end),
    incomeCents: realized.incomeCents,
    expenseCents: realized.expenseCents,
    netCents: realized.netCents,
    remainingIncomeCents: pending.plannedIncomeCents,
    remainingExpenseCents: pending.plannedExpenseCents,
    pending: pending.pending,
    centers: spendingByCenter(budget, budgetProjectId, start, end).map((center) => ({
      ...center,
      plannedCents: pending.pending
        .filter((entry) => entry.kind === 'expense' && (entry.centerId ?? '') === center.id)
        .reduce((total, entry) => total + entry.amountCents, 0),
    })),
    incomes: incomeSources(budget, budgetProjectId, start, end),
    incomeCenters: (budget.centers ?? []).filter(center => center.budgetProjectId === budgetProjectId && center.kind === 'income').map(({id,name}) => ({id,name})),
    entries: statementEntries(budget, budgetProjectId, start, end),
    // Une fenêtre entièrement couverte par des clôtures ne se réécrit plus : seules les précisions restent possibles.
    // Les clôtures d'un cycle se suivent sans trou : la fenêtre est close si elle tient entre la première et la dernière.
    closed: closures.length > 0 && closures[0].start <= start && closures.at(-1).end >= end,
    closure: closure
      ? { netCents: closure.netCents, patrimoineAfterCents: closure.patrimoineAfterCents ?? null }
      : null,
  };
}

/** Le patrimoine connu à la fin d'une fenêtre : celui de la dernière clôture du cycle terminée avant elle. */
function patrimoineAt(closures, end) {
  const closed = closures.filter((entry) => entry.end <= end);
  return closed.length ? (closed.at(-1).patrimoineAfterCents ?? null) : null;
}

/**
 * Les trois vues du projet. `span` fenêtres de part et d'autre de la fenêtre en
 * cours composent la frise ; chaque fenêtre garde son réalisé et son prévu.
 */
export function bpmLenses({ budget, budgetProjectId, cycle, period, closures, today, span, readingDate = null }) {
  const lens = (cadence) => {
    const { start, end } = lensWindow(cadence, cycle, period, readingDate ?? today);
    const realized = realizedFlows(budget, budgetProjectId, start, end);
    const planned = plannedFlows(budget, budgetProjectId, start, end);
    const closed = readingDate && closures.length && closures[0].start <= start && closures.at(-1).end >= end;
    const pending = closed ? {pending: [], plannedIncomeCents: 0, plannedExpenseCents: 0} : pendingFlows(budget, budgetProjectId, start, end);
    const length = days(start, end);
    const buckets = [];
    let cursor = start;
    for (let index = 0; index < span; index++) cursor = previousPeriod(cursor, cadence);
    for (let index = 0; index < span * 2 + 1; index++) {
      const next = cadence === cycle && cursor === start ? end : nextPeriod(cursor, cadence);
      const done = realizedFlows(budget, budgetProjectId, cursor, next);
      const forecast = plannedFlows(budget, budgetProjectId, cursor, next);
      buckets.push({
        start: cursor,
        end: next,
        state: next <= today ? 'past' : cursor <= today ? 'current' : 'future',
        realizedIncomeCents: done.incomeCents,
        realizedExpenseCents: done.expenseCents,
        realizedNetCents: done.netCents,
        plannedIncomeCents: forecast.incomeCents,
        plannedExpenseCents: forecast.expenseCents,
        plannedNetCents: forecast.netCents,
        patrimoineAfterCents: next <= today ? patrimoineAt(closures, next) : null,
      });
      cursor = next;
    }
    // Avant les premières données, une frise vide n'apprend rien : elle commence à la première fenêtre utile.
    const empty = (bucket) =>
      bucket.state === 'past' && !bucket.realizedIncomeCents && !bucket.realizedExpenseCents && !bucket.plannedIncomeCents && !bucket.plannedExpenseCents;
    while (buckets.length > 1 && empty(buckets[0])) buckets.shift();
    return {
      cadence,
      start,
      end,
      length,
      elapsed: Math.min(Math.max(days(start, today), 0), length),
      daysLeft: Math.max(days(today, end), 0),
      started: start <= today,
      funding: periodFunding(budget,budgetProjectId,start,end),
      incomeCents: realized.incomeCents,
      expenseCents: realized.expenseCents,
      netCents: realized.netCents,
      plannedIncomeCents: planned.incomeCents,
      plannedExpenseCents: planned.expenseCents,
      remainingIncomeCents: pending.plannedIncomeCents,
      remainingExpenseCents: pending.plannedExpenseCents,
      // Les échéances une à une seulement pour la semaine et le mois : l'année en compte des centaines.
      pending: cadence === 'yearly' ? [] : pending.pending,
      centers: spendingByCenter(budget, budgetProjectId, start, end).map((center) => ({
        ...center,
        plannedCents: pending.pending
          .filter((entry) => entry.kind === 'expense' && (entry.centerId ?? '') === center.id)
          .reduce((total, entry) => total + entry.amountCents, 0),
      })),
      incomes: incomeSources(budget, budgetProjectId, start, end),
      incomeCenters: (budget.centers ?? []).filter(center => center.budgetProjectId === budgetProjectId && center.kind === 'income').map(({id,name}) => ({id,name})),
    entries: statementEntries(budget, budgetProjectId, start, end),
      buckets,
    };
  };
  return Object.fromEntries(BPM_LENSES.map((cadence) => [cadence, lens(cadence)]));
}
