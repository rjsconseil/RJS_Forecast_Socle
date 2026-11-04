import { entityTransferImpact, guardEntityTransfers } from './entity-business.mjs';
/** Domain ledger for realized budget flows. No Configuration storage or UI logic. */
import { createHash } from 'node:crypto';
/** Refus métier attendu, distinct d’une erreur de stockage ou de programmation. */
export class BudgetPatrimoineError extends Error {
  constructor(message, code = 'budget_patrimoine_conflict') {
    super(message);
    this.name = 'BudgetPatrimoineError';
    this.code = code;
  }
}
const day = (d) => d.toISOString().slice(0, 10);
const date = (s) => new Date(s + 'T12:00:00Z');
export function periodStart(value, cadence) {
  const d = date(value);
  if (!Number.isFinite(+d) || day(d) !== value)
    throw new BudgetPatrimoineError('Date de gestion invalide.');
  if (cadence === 'weekly') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  else if (cadence === 'monthly') d.setUTCDate(1);
  else if (cadence === 'yearly') {
    d.setUTCMonth(0, 1);
  } else throw new BudgetPatrimoineError('Périodicité inconnue.');
  return day(d);
}
export function nextPeriod(start, cadence) {
  const d = date(start);
  if (cadence === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else if (cadence === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1, 1);
  else if (cadence === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1, 0, 1);
  else throw new BudgetPatrimoineError('Périodicité inconnue.');
  return day(d);
}
export const emptyBudgetLedger = () => ({ version: 1, revision: 0, closures: [] });
export function realizedFlows(budget, projectId, start, end) {
  const entries = budget.operations
    .filter((op) => op.budgetProjectId === projectId)
    .flatMap((op) =>
      (op.settlements || [])
        .filter((s) => s.actualDate >= start && s.actualDate < end)
        .map((s) => ({
          operationId: op.id,
          occurrenceDate: s.occurrenceDate,
          actualDate: s.actualDate,
          amountCents: s.amountCents,
          kind: op.kind,
        })),
    );
  entries.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  for (const item of entries)
    if (!Number.isSafeInteger(item.amountCents) || item.amountCents < 0)
      throw new BudgetPatrimoineError('Montant réel invalide.');
  const income = entries.filter((e) => e.kind === 'income').reduce((n, e) => n + e.amountCents, 0);
  const expense = entries.filter((e) => e.kind !== 'income').reduce((n, e) => n + e.amountCents, 0);
  if (
    !Number.isSafeInteger(income) ||
    !Number.isSafeInteger(expense) ||
    !Number.isSafeInteger(income - expense)
  )
    throw new BudgetPatrimoineError('Le total dépasse la précision des centimes.');
  return {
    incomeCents: income,
    expenseCents: expense,
    netCents: income - expense,
    entries,
    digest: createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
  };
}
export function validateBudgetLinks(links, budget, patrimoine, ledger, today) {
  const ids = new Set();
  const projects = new Set();
  for (const link of links) {
    if (!link.id || ids.has(link.id))
      throw new BudgetPatrimoineError('Identifiant de liaison dupliqué.');
    ids.add(link.id);
    if (!['true', 'false'].includes(link.enabled))
      throw new BudgetPatrimoineError('Activation invalide.');
    if (periodStart(link.startDate, link.periodicity) !== link.startDate)
      throw new BudgetPatrimoineError(
        'Le début doit être le premier jour de la semaine (lundi), du mois ou de l’année.',
      );
    if (link.enabled === 'true') {
      if (projects.has(link.budgetProjectId))
        throw new BudgetPatrimoineError('Un PBM ne peut alimenter qu’un PPM.');
      projects.add(link.budgetProjectId);
      const pbm = budget.budgetProjects.find((p) => p.id === link.budgetProjectId),
        ppm = patrimoine.projects.find((p) => p.id === link.patrimoineProjectId);
      if (
        !pbm ||
        !ppm ||
        !pbm.coreProjectId ||
        !pbm.entityId ||
        !ppm.entityId ||
        pbm.entityId !== ppm.entityId
      )
        throw new BudgetPatrimoineError(
          'Le budget doit alimenter uniquement le patrimoine de son propriétaire direct. Le rattachement à une personne ou une famille ne permet pas de clôturer vers son patrimoine.',
        );
      if (link.startDate > nextPeriod(periodStart(today, link.periodicity), link.periodicity))
        throw new BudgetPatrimoineError(
          'Le démarrage doit concerner la période courante ou la suivante.',
        );
    }
  }
  // Une suppression BPM peut retirer la liaison active. Sa copie immuable reste dans chaque clôture.
  // Si une liaison existe encore, son identité historique ne peut pas être réécrite.
  for (const closed of ledger.closures) {
    const link = links.find((l) => l.id === closed.linkId);
    if (
      link &&
      ['budgetProjectId', 'patrimoineProjectId', 'periodicity', 'startDate'].some(
        (k) => link[k] !== closed.link[k],
      )
    )
      throw new BudgetPatrimoineError(
        'Une liaison déjà clôturée conserve ses projets, son début et sa périodicité. Désactivez-la pour arrêter les prochaines clôtures.',
      );
  }
  // Prevent using a new link ID to repeat an already posted PBM period.
  for (const link of links)
    if (
      link.enabled === 'true' &&
      ledger.closures.some(
        (c) =>
          c.budgetProjectId === link.budgetProjectId &&
          c.linkId !== link.id &&
          c.end > link.startDate,
      )
    )
      throw new BudgetPatrimoineError(
        'Ce PBM a déjà des périodes clôturées sur une autre liaison.',
      );
}
export function assertClosedBudgetUnchanged(budget, ledger) {
  guardEntityTransfers(budget, ledger);
  for (const closed of ledger.closures)
    if (
      realizedFlows(budget, closed.budgetProjectId, closed.start, closed.end).digest !==
      closed.sourceDigest
    )
      throw new BudgetPatrimoineError(
        'Cette modification toucherait une période Budget déjà clôturée. Conservez son historique et enregistrez une opération de régularisation dans la période ouverte.',
        'closed_period',
      );
}
export function closeBudgetPeriods(budget, links, ledger, today, patrimoineValue = () => null) {
  assertClosedBudgetUnchanged(budget, ledger);
  const closures = [...ledger.closures];
  const additions = [];
  const pending = [];
  for (const link of links.filter((l) => l.enabled === 'true')) {
    let start =
      closures
        .filter((c) => c.linkId === link.id)
        .map((c) => c.end)
        .sort()
        .at(-1) || link.startDate;
    for (let count = 0; start < today; count++) {
      if (count >= 10000) throw new BudgetPatrimoineError('Trop de périodes à reprendre.');
      const end = nextPeriod(start, link.periodicity);
      if (end > today) break;
      if (
        closures.some(
          (c) => c.budgetProjectId === link.budgetProjectId && c.start < end && c.end > start,
        )
      )
        throw new BudgetPatrimoineError('Périodes de clôture superposées.');
      pending.push({ link, start, end });
      start = end;
    }
  }
  pending.sort(
    (a, b) =>
      a.end.localeCompare(b.end) ||
      a.start.localeCompare(b.start) ||
      a.link.id.localeCompare(b.link.id),
  );
  for (const { link, start, end } of pending) {
    if (
      closures.some(
        (c) => c.budgetProjectId === link.budgetProjectId && c.start < end && c.end > start,
      )
    )
      throw new BudgetPatrimoineError('Périodes de clôture superposées.');
    const flow = realizedFlows(budget, link.budgetProjectId, start, end);
    const previous = closures
      .filter((c) => c.patrimoineProjectId === link.patrimoineProjectId && c.end <= end)
      .reduce((n, c) => n + c.netCents, 0);
    const base = patrimoineValue(link.patrimoineProjectId, end);
    const previousDay = date(end);
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    const entityFlow = entityTransferImpact(ledger, link.patrimoineProjectId, day(previousDay));
    const row = {
      id: `${link.id}:${start}`,
      linkId: link.id,
      link: { ...link },
      budgetProjectId: link.budgetProjectId,
      patrimoineProjectId: link.patrimoineProjectId,
      start,
      end,
      closedAt: new Date().toISOString(),
      incomeCents: flow.incomeCents,
      expenseCents: flow.expenseCents,
      netCents: flow.netCents,
      sourceDigest: flow.digest,
      entries: flow.entries,
      budgetAfterCents: 0,
      patrimoineFlowAfterCents: previous + flow.netCents,
      patrimoineAfterCents: base === null ? null : base + previous + flow.netCents + entityFlow,
    };
    if (
      !Number.isSafeInteger(row.patrimoineFlowAfterCents) ||
      (row.patrimoineAfterCents !== null && !Number.isSafeInteger(row.patrimoineAfterCents))
    )
      throw new BudgetPatrimoineError('Solde patrimoine hors précision.');
    closures.push(row);
    additions.push(row);
  }
  return {
    ledger: additions.length ? { ...ledger, revision: ledger.revision + 1, closures } : ledger,
    additions,
  };
}
/** Value known at closing, excluding the independent budget ledger to avoid double counting. */
export function knownPatrimoineValue(workspace, projectId, end) {
  const assets = workspace.assets.filter((a) => a.projectId === projectId);
  let total = 0;
  for (const asset of assets) {
    const val = asset.valuations
      .filter((v) => v.date < end)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!val) return null;
    total += val.valueCents - asset.liabilityCents;
    for (const op of workspace.operations)
      if (
        op.assetId === asset.id &&
        op.status === 'realized' &&
        op.firstDate > val.date &&
        op.firstDate < end
      )
        total += (op.kind === 'income' ? 1 : -1) * op.amountCents;
  }
  return total;
}
/** Total monetary value of a PPM today: known asset value plus every budget transfer already posted. */
export function patrimoineStanding(workspace, ledger, projectId, today) {
  const d = date(today);
  d.setUTCDate(d.getUTCDate() + 1);
  const assetsCents = knownPatrimoineValue(workspace, projectId, day(d));
  const budgetFlowCents = ledger.closures
    .filter((c) => c.patrimoineProjectId === projectId)
    .reduce((n, c) => n + c.netCents, 0);
  const entityTransferCents = entityTransferImpact(ledger, projectId, today);
  return {
    assetsCents,
    budgetFlowCents,
    entityTransferCents,
    totalCents: assetsCents === null ? null : assetsCents + budgetFlowCents + entityTransferCents,
  };
}
