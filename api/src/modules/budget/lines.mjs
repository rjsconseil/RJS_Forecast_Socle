// Lignes de Budget : opérations et occurrences ramenées à une même forme datée, sommes de période et rapport
// des plafonds. Fonctions pures sur l'état, sans écriture ; Budget et ses lecteurs les partagent.
import { date } from '../../socle/validation.mjs';
import { occurrenceDates, occurrenceKey } from './recurrence.mjs';

export const STD = 'std:';
const toEuros = (cents) => (cents === null || cents === undefined ? null : cents / 100);

export const lineOfOperation = (o) => ({
  id: o.id,
  kind: 'operation',
  operationId: o.id,
  recurrenceId: o.recurrenceId ?? null,
  occurrenceDate: o.occurrenceDate ?? null,
  occurrenceKey: o.recurrenceId ? occurrenceKey(o.recurrenceId, o.occurrenceDate) : null,
  budgetId: o.budgetId,
  userId: o.userId,
  direction: o.direction,
  label: o.label,
  plannedDate: o.date,
  plannedCents: o.amountCents,
  realizedDate: o.realizedDate,
  accountingDate: o.accountingDate ?? o.realizedDate,
  fundingSource: o.fundingSource ?? o.plannedFundingSource ?? null,
  realizedCents: o.realizedAmountCents,
  settled: o.status === 'realized',
  standardCostCenter: o.standardCostCenter,
  costCenterId: o.costCenterId,
  categoryId: o.categoryId ?? null,
  note: o.note ?? null,
  taskId: o.taskId ?? null,
  revision: o.revision,
  // Échéance reportée d'un cycle clôturé : elle y garde sa marque et se revoit ici.
  ...(o.carriedFrom ? { carriedFrom: o.carriedFrom } : {}),
});

export const lineOfOccurrence = (r, date) => ({
  id: occurrenceKey(r.id, date),
  kind: 'occurrence',
  operationId: null,
  recurrenceId: r.id,
  occurrenceDate: date,
  occurrenceKey: occurrenceKey(r.id, date),
  budgetId: r.budgetId,
  userId: r.userId,
  direction: r.direction,
  label: r.label,
  plannedDate: date,
  plannedCents: r.amountCents,
  realizedDate: null,
  fundingSource: r.plannedFundingSource ?? null,
  realizedCents: null,
  settled: false,
  standardCostCenter: r.standardCostCenter,
  costCenterId: r.costCenterId,
  categoryId: r.categoryId ?? null,
  note: r.note ?? null,
  taskId: r.taskId ?? null,
  revision: null,
});

/**
 * Lignes financières de Budgets sur une fenêtre [from, to] (bornes incluses) — lecture commune à
 * toutes les sommes : `by: 'planned'` sélectionne par date prévue (opérations et occurrences
 * attendues non encore matérialisées), `by: 'realized'` par date réelle de règlement.
 * Une occurrence réglée est une opération : elle ne figure jamais deux fois.
 */
export function budgetLines(state, budgetIds, { from, to, by = 'planned' }) {
  const ids = new Set(budgetIds);
  const out = [];
  const materialized = new Set();
  for (const o of Object.values(state.operations)) {
    if (o.recurrenceId) materialized.add(occurrenceKey(o.recurrenceId, o.occurrenceDate));
    if (!ids.has(o.budgetId) || o.status === 'cancelled') continue;
    const d = by === 'planned' ? o.date : o.status === 'realized' ? o.realizedDate : null;
    if (d && d >= from && d <= to) out.push(lineOfOperation(o));
  }
  if (by === 'planned') {
    for (const r of Object.values(state.recurrences ?? {})) {
      if (!ids.has(r.budgetId) || r.cancelledAt) continue;
      for (const d of occurrenceDates(r, from, to)) if (!materialized.has(occurrenceKey(r.id, d))) out.push(lineOfOccurrence(r, d));
    }
  }
  const dateOf = (l) => (by === 'planned' ? l.plannedDate : l.realizedDate);
  return out.sort((a, b) => dateOf(a).localeCompare(dateOf(b)) || a.label.localeCompare(b.label));
}

/**
 * Plafonds de dépenses sur une période [P] : deux niveaux indépendants, jamais bloquants.
 * - centre de coût : plafond du Budget (`capsCents[ref]`) ;
 * - catégorie personnalisée (dans un centre) : plafond de la catégorie.
 * Engagé = charges réglées dans la période (date réelle) + charges prévues de la période non réglées.
 * Une ligne compte dans son centre ET dans sa catégorie : chaque niveau est lu pour lui-même.
 * @param realized lignes `by: 'realized'` de la période ; @param planned lignes `by: 'planned'` de la période.
 */
/**
 * Niveaux de consommation d'un plafond [P] (part du plafond engagée) : seule source des seuils, lus par les pages
 * pour colorer leurs jauges (moins de 50 % vert, 50 à 75 % bleu, 75 à 90 % jaune, 90 à 100 % orange, au-delà rouge).
 * Au-delà de 100 %, le plafond est dépassé : ce n'est pas un seuil, c'est la définition du dépassement.
 */
export const CAP_LEVEL_PCT = Object.freeze({ mid: 50, high: 75, near: 90 });
/** Seuil d'approche d'un plafond [P] : à partir de 90 % engagés (zone orange), le poste est « proche du plafond ». */
export const NEAR_CAP_USED_PCT = CAP_LEVEL_PCT.near;
export const isNearCap = (capCents, engagedCents) => capCents !== null && capCents > 0 && engagedCents <= capCents && (engagedCents / capCents) * 100 >= NEAR_CAP_USED_PCT;
/** Niveau d'un plafond : none (sans plafond), low, mid, high, near (100 % compris) ou over (dépassé). */
export function capLevelOf(capCents, engagedCents) {
  if (capCents === null || capCents === undefined || capCents <= 0) return 'none';
  if (engagedCents > capCents) return 'over';
  const used = (engagedCents / capCents) * 100;
  return used >= CAP_LEVEL_PCT.near ? 'near' : used >= CAP_LEVEL_PCT.high ? 'high' : used >= CAP_LEVEL_PCT.mid ? 'mid' : 'low';
}

export function capReport({ centers, caps = {}, categories = [], realized, planned, withLines = false }) {
  const refOf = (l) => l.costCenterId ?? STD + l.standardCostCenter;
  const charges = (ls) => ls.filter((l) => l.direction === 'charge');
  const measure = (match, capCents) => {
    const paid = charges(realized).filter(match);
    const toPay = charges(planned).filter((l) => !l.settled && match(l));
    const paidCents = paid.reduce((t, l) => t + l.realizedCents, 0);
    const toPayCents = toPay.reduce((t, l) => t + l.plannedCents, 0);
    const engagedCents = paidCents + toPayCents;
    const cap = capCents ?? null;
    return {
      // Composition exacte de l'engagé (sur demande) : la somme des lignes vaut `engagedCents`.
      ...(withLines
        ? {
            lines: [
              ...paid.map((l) => ({ line: l, engagedCents: l.realizedCents, engagedDate: l.realizedDate, engagedAs: 'paid' })),
              ...toPay.map((l) => ({ line: l, engagedCents: l.plannedCents, engagedDate: l.plannedDate, engagedAs: 'toPay' })),
            ],
          }
        : {}),
      paidCents,
      toPayCents,
      engagedCents,
      capCents: cap,
      marginCents: cap === null ? null : cap - engagedCents,
      usedPct: cap ? Math.round((engagedCents / cap) * 1000) / 10 : null,
      over: cap !== null && engagedCents > cap,
      near: isNearCap(cap, engagedCents),
      level: capLevelOf(cap, engagedCents),
      lineCount: charges(realized).filter(match).length + charges(planned).filter((l) => !l.settled && match(l)).length,
    };
  };
  const centerRows = centers
    .filter((c) => c.direction === 'charge')
    .map((c) => ({ ref: c.ref, label: c.label, standard: c.standard, ...measure((l) => refOf(l) === c.ref, caps[c.ref]) }));
  const categoryRows = categories.map((k) => ({
    id: k.id,
    label: k.label,
    costCenterRef: k.costCenterRef,
    costCenterLabel: centers.find((c) => c.ref === k.costCenterRef)?.label ?? k.costCenterRef,
    archived: !!k.archived,
    revision: k.revision,
    ...measure((l) => l.categoryId === k.id, k.capCents),
  }));
  const overCenters = centerRows.filter((r) => r.over);
  const overCategories = categoryRows.filter((r) => r.over);
  return {
    centers: centerRows,
    categories: categoryRows,
    overCount: overCenters.length + overCategories.length,
    alerts: [
      ...overCenters.map((r) => ({ level: 'center', ref: r.ref, id: null, label: r.label, capCents: r.capCents, engagedCents: r.engagedCents, overCents: -r.marginCents })),
      ...overCategories.map((r) => ({ level: 'category', ref: r.costCenterRef, id: r.id, label: r.label, capCents: r.capCents, engagedCents: r.engagedCents, overCents: -r.marginCents })),
    ],
  };
}

export const sourceOf = (l, realized) => ({
  id: l.id,
  kind: l.kind,
  label: l.label,
  amount: toEuros(realized ? l.realizedCents : l.plannedCents),
  date: realized ? l.realizedDate : l.plannedDate,
  status: l.settled ? 'realized' : 'planned',
});

/**
 * Somme du Budget du contexte sur la période : réalisé par date réelle, prévu par date prévue,
 * restant = prévu non réglé (C04). Toutes passent par `budgetLines`.
 */
export function periodSum(ctx, socle, { direction, realized, remaining = false, advance = false }) {
  if (!ctx.budgetId) return { value: null, sources: [], note: 'Aucun Budget dans le contexte' };
  if (!ctx.period) return { value: null, sources: [], note: 'Aucune période : cycle à configurer' };
  const { start, end } = ctx.period;
  // `advance` : prévu dans la période mais déjà réglé avant son début (compté dans le réalisé d'une période antérieure).
  const lines = budgetLines(ctx.state, [ctx.budgetId], { from: start, to: end, by: realized ? 'realized' : 'planned' }).filter(
    (l) => l.direction === direction && (!remaining || !l.settled) && (!advance || (l.settled && l.realizedDate < start)),
  );
  const cents = lines.reduce((s, l) => s + (realized || advance ? l.realizedCents : l.plannedCents), 0);
  return {
    value: cents / 100,
    sources: lines.map((l) => sourceOf(l, realized || advance)),
    note: lines.length ? null : advance ? 'Rien de réglé d’avance pour la période' : remaining ? 'Rien en attente sur la période' : `Aucune opération ${realized ? 'réalisée' : 'prévue'} sur la période`,
  };
}
