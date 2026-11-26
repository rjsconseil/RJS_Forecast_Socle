// Règles pures des réservations des projets de la vie : régime, sources, vues et chiffres d'un projet.
// Aucune écriture ici ; les commandes vivent dans funding.mjs, qui réexporte tout ce fichier.
import { fail } from '../../socle/errors.mjs';
import { today } from '../../socle/clock.mjs';
import { CADENCES, occurrenceDates } from './recurrence.mjs';

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
export const fmt = (cents) => euro.format(cents / 100).replace(/[\u00a0\u202f]/g, ' ');
export const frDate = (d) => (d ? d.split('-').reverse().join('/') : '');
export const sum = (list, f = (x) => x) => list.reduce((s, x) => s + (f(x) ?? 0), 0);
const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export const OVERRUN_REASONS = { ventilation: 'Part de budget d’une tâche', reglement: 'Règlement d’une dépense' };
export const OVERRUN_STATUS = {
  pending: 'En attente de la décision du budget de vie',
  approved: 'Autorisé · moyens réservés, sans dépense',
  refused: 'Refusé par le budget de vie',
  billed: 'Consolidé dans l’enveloppe, sans dépense',
  cancelled: 'Annulé · projet abandonné',
};
export const RETURN_CADENCES = ['once', ...CADENCES];
/** Engagé d'une récurrence sans date de fin : ses occurrences des 12 prochains mois [P]. */
const HORIZON_DAYS = 365;


/** Projet standard financé par le budget de vie : un montant lui est attribué (régime des charges de projet). */
export const inRegime = (b) => b?.role === 'standard' && Number.isInteger(b.allocationCents) && typeof b.allocationDate === 'string';
/**
 * Source de financement d'un projet de la vie [P] (docs/COMPTABILITE-PROJET-DE-VIE.md) :
 * - « cycle » (par défaut) : ses dépenses validées comptent dans le cycle budgétaire où elles sont réglées ;
 * - « patrimoine » : projet hors cycle (long, coûteux, hors budget du cycle) ; ses dépenses validées sont
 *   prélevées directement sur le patrimoine, à leur date réelle, sans entrer dans aucun cycle.
 */
export const FUNDING_SOURCES = ['cycle', 'patrimoine'];
export const fundingSourceOf = (b) => (b?.fundingSource === 'patrimoine' ? 'patrimoine' : 'cycle');
/** Source et date d'imputation figées sur le flux ; repli pour les données historiques. */
export const projectFundingSource = (o, b) => {
  const source = o?.fundingSource ?? o?.plannedFundingSource;
  return FUNDING_SOURCES.includes(source) ? source : fundingSourceOf(b);
};
export const projectAccountingDate = (o) => o.accountingDate ?? o.realizedDate;
export const countsInCycle = (b) => inRegime(b) && fundingSourceOf(b) === 'cycle';
export const drawsOnPatrimoine = (b) => inRegime(b) && fundingSourceOf(b) === 'patrimoine';
export const standardOfProject = (state, coreProjectId) => Object.values(state.budgets).find((b) => b.role === 'standard' && b.coreProjectId === coreProjectId) ?? null;
export const linkedProjectBudgets = (state, lifeBudgetId) => Object.values(state.budgets).filter((b) =>
  b.role === 'standard' && b.parentBudgetId === lifeBudgetId && b.userId === state.budgets[lifeBudgetId]?.userId);
export const sharesOf = (b) => b.taskSharesCents ?? {};
export const returnsOf = (b) => b.taskReturns ?? {};
export const overrunsOf = (state, budgetId) => Object.values(state.projectOverruns ?? {}).filter((x) => x.budgetId === budgetId);
export const requestsOf = (state, budgetId) => Object.values(state.taskBudgetRequests ?? {}).filter((x) => x.budgetId === budgetId);
export const openRequest = (x) => ['pending', 'awaiting-life'].includes(x.status);
export const REQUEST_STATUS = { pending: 'À valider par le projet', 'awaiting-life': 'Autorisation du budget du projet de vie attendue', approved: 'Montant accordé', refused: 'Demande refusée', cancelled: 'Demande annulée' };

/** Projet abandonné : son enveloppe est ramenée à ce qu'il a réglé, il ne reçoit plus d'écriture tant qu'il n'est pas repris. */
export const isAbandoned = (b) => !!b?.abandonedAt;
export function abandonedRefusal(b) {
  fail('FORBIDDEN_BY_RULE', `Le projet « ${b.name} » est abandonné : reprenez-le avant d’y saisir une dépense ou de modifier son financement.`, { budgetId: b.id, reason: 'abandoned' });
}

export function requestView(state, x) {
  const b = state.budgets[x.budgetId];
  return { ...structuredClone(x), statusLabel: REQUEST_STATUS[x.status], taskTitle: state.tasks[x.taskId]?.title ?? '', budgetName: b?.name ?? '', coreProjectId: b?.coreProjectId ?? null, grantedCents: sharesOf(b ?? {})[x.taskId] ?? null };
}

/** Charge d'un projet validée comme réglée pour ses besoins, depuis l'attribution : comptée dans le budget de vie. */
export const isValidatedCharge = (o, b) => inRegime(b) && o.budgetId === b.id && o.direction === 'charge' && o.status === 'realized' && projectAccountingDate(o) >= b.allocationDate;
/**
 * Remboursement d'un projet financé [P] : entrée reçue sur le budget du projet depuis l'attribution (prestation annulée,
 * avoir…). Il se déduit des charges réglées du projet, de sa tâche et de ce que le projet coûte au budget de vie, à sa date réelle.
 */
export const isValidatedRefund = (o, b) => inRegime(b) && o.budgetId === b.id && o.direction === 'income' && o.status === 'realized' && projectAccountingDate(o) >= b.allocationDate;
/** Un gain peut être validé avant l'enveloppe. Le marqueur est posé à l'écriture, sans reprendre l'historique. */
export const isValidatedMove = (o, b) => isValidatedCharge(o, b) || isValidatedRefund(o, b) ||
  (b?.role === 'standard' && o.budgetId === b.id && o.status === 'realized' && o.direction === 'income' && o.independentIncome === true);
/** Dépenses moins entrées pour les agrégats de coût des projets. */
export const projectMoveCents = (o, b) => isValidatedMove(o, b) ? (o.direction === 'income' ? -o.realizedAmountCents : o.realizedAmountCents) : 0;

/**
 * Charges du projet qui forment son engagé : réglées validées, prévues ponctuelles, occurrences attendues.
 * Les règlements antérieurs à l'attribution restent dans l'historique du projet, hors budget attribué.
 */
export function chargeItems(state, b, now) {
  const from = inRegime(b) ? b.allocationDate : null;
  const horizon = addDays(now, HORIZON_DAYS);
  const items = [];
  const materialized = new Set();
  for (const o of Object.values(state.operations)) {
    if (o.budgetId !== b.id) continue;
    if (o.recurrenceId) materialized.add(`${o.recurrenceId}@${o.occurrenceDate}`);
    if (o.status === 'cancelled') continue;
    if (isValidatedRefund(o, b)) items.push({ taskId: o.taskId ?? null, cents: -o.realizedAmountCents, paid: true, refund: true });
    if (o.direction !== 'charge') continue;
    if (o.status === 'realized') {
      if (from && projectAccountingDate(o) < from) items.push({ taskId: o.taskId ?? null, cents: o.realizedAmountCents, paid: false, before: true });
      else items.push({ taskId: o.taskId ?? null, cents: o.realizedAmountCents, paid: true });
    } else items.push({ taskId: o.taskId ?? null, cents: o.amountCents, paid: false });
  }
  for (const r of Object.values(state.recurrences ?? {})) {
    if (r.budgetId !== b.id || r.direction !== 'charge' || r.cancelledAt) continue;
    const start = from && from > r.firstDate ? from : r.firstDate;
    for (const d of occurrenceDates(r, start, r.endDate ?? horizon)) {
      if (!materialized.has(`${r.id}@${d}`)) items.push({ taskId: r.taskId ?? null, cents: r.amountCents, paid: false, unbounded: !r.endDate });
    }
  }
  return items;
}

export function overrunView(state, x) {
  const b = state.budgets[x.budgetId];
  return {
    ...structuredClone(x),
    statusLabel: OVERRUN_STATUS[x.status],
    reasonLabel: OVERRUN_REASONS[x.reason],
    taskTitle: x.taskId ? state.tasks[x.taskId]?.title ?? null : null,
    budgetName: b?.name ?? null,
    coreProjectId: b?.coreProjectId ?? null,
  };
}

/**
 * Chiffres de financement d'un projet standard (centimes) : attribué, dépassements, parts, engagé, réglé validé, reste.
 * Le réglé de la période du cycle est ajouté par l'application, qui porte le cycle.
 */
export function fundingFigures(state, b, now = today()) {
  const regime = inRegime(b);
  const fundingSource = fundingSourceOf(b);
  const overruns = overrunsOf(state, b.id);
  const approved = overruns.filter((x) => x.status === 'approved');
  const approvedCents = sum(approved, (x) => x.amountCents);
  const billedCents = sum(overruns.filter((x) => x.status === 'billed'), (x) => x.amountCents);
  const pending = overruns.find((x) => x.status === 'pending') ?? null;
  const shares = sharesOf(b);
  const sharesCents = sum(Object.values(shares));
  const items = chargeItems(state, b, now);
  const allocationCents = regime ? b.allocationCents : null;
  const ceilingCents = regime ? allocationCents + approvedCents : null;
  const byTask = {};
  /** Réglé avant l'attribution de l'enveloppe, par tâche : hors part, gardé dans l'historique. */
  const beforeByTask = {};
  for (const i of items) {
    if (i.taskId && i.before) beforeByTask[i.taskId] = (beforeByTask[i.taskId] ?? 0) + i.cents;
    if (!i.taskId || i.before) continue;
    const t = (byTask[i.taskId] ??= { engagedCents: 0, paidCents: 0, unbounded: false });
    t.engagedCents += i.cents;
    if (i.paid) t.paidCents += i.cents;
    if (i.unbounded) t.unbounded = true;
  }
  const current = items.filter((i) => !i.before);
  const paidCents = sum(current.filter((i) => i.paid), (i) => i.cents);
  const engagedCents = sum(current, (i) => i.cents);
  const deficit = regime && approvedCents > 0;
  const billing = approved.map((x) => x.billingDate).filter(Boolean).sort();
  return {
    fundingSource,
    fundingSourceLocked: regime && current.some(item => item.paid),
    budgetId: b.id,
    /** Paramètre différenciant : `standard` (projet de la vie financé) ou `life` (projet de vie, non standard). */
    kind: 'standard',
    nonStandard: false,
    name: b.name,
    coreProjectId: b.coreProjectId,
    parentBudgetId: b.parentBudgetId,
    revision: b.revision,
    regime,
    taskFundingRequired: !!b.taskFundingRequired,
    allocationCents,
    allocationDate: regime ? b.allocationDate : null,
    /** Montant attribué hors dépassements déjà facturés (ligne « Budget attribué » du budget de vie). */
    initialAllocationCents: regime ? allocationCents - billedCents : null,
    approvedOverrunCents: approvedCents,
    billedOverrunCents: billedCents,
    pendingOverrun: pending ? overrunView(state, pending) : null,
    ceilingCents,
    sharesCents,
    availableCents: regime ? ceilingCents - sharesCents : null,
    engagedCents,
    paidCents,
    remainingCents: regime ? ceilingCents - paidCents : null,
    toPayCents: engagedCents - paidCents,
    uncommittedCents: regime ? ceilingCents - engagedCents : null,
    pendingRequestsCents: sum(requestsOf(state, b.id).filter(openRequest), (x) => Math.max(0, x.amountCents - (shares[x.taskId] ?? 0))),
    paidBeforeAllocationCents: sum(items.filter((i) => i.before), (i) => i.cents),
    unsharedChargesCents: sum(current.filter((i) => !i.taskId), (i) => i.cents),
    state: !regime ? 'unallocated' : deficit ? 'deficit' : engagedCents > ceilingCents ? 'at-risk' : 'ok',
    deficit,
    nextBillingDate: billing[0] ?? null,
    byTask,
    beforeByTask,
    shares: { ...shares },
    returns: structuredClone(returnsOf(b)),
    abandoned: isAbandoned(b) ? { at: b.abandonedAt, reason: b.abandonReason ?? null, ...(b.abandonment ?? {}) } : null,
    life: null,
  };
}
