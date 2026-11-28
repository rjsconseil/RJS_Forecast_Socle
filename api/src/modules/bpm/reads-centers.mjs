// Lectures BPM — postes (centres de coût) et entrées, détail d'un poste.
import { fail } from '../../socle/errors.mjs';
import { oneOf } from '../../socle/validation.mjs';
import { CAP_LEVEL_PCT } from '../budget/api.mjs';
import { essentialRefsOf, natureOf } from './natures.mjs';
import { sum } from './format.mjs';

/** `h` : outils du module BPM ; `kit` : contexte commun des lectures (reads.mjs). */
export function createCenterReads(socle, h, kit) {
  const { budget, base, contextOf, statusOf, decorate, validatedProjectLines, capsRead, summary } = kit;

  // ---------- centres et entrées ----------

  function centersRead(b, direction, budgetIds) {
    const { start, end } = b.period;
    const realized = budget().budgetLines(b.state, budgetIds, { from: start, to: end, by: 'realized' });
    // Budget du projet de vie : les charges de projet validées font partie du dépensé, réparties sur leurs centres.
    if (budgetIds.length === 1 && budgetIds[0] === b.comp.budgetId) realized.push(...validatedProjectLines(b, { from: start, to: end, by: 'realized' }));
    const planned = budget().budgetLines(b.state, budgetIds, { from: start, to: end, by: 'planned' });
    const caps = b.state.budgets[b.comp.budgetId].capsCents ?? {};
    const centers = budget().costCentersOf(b.state, b.userId).filter((c) => c.direction === direction);
    const refOf = (l) => l.costCenterId ?? `std:${l.standardCostCenter}`;
    const known = new Set(centers.map((c) => c.ref));
    const extra = [...new Set([...realized, ...planned].filter((l) => l.direction === direction && !known.has(refOf(l))).map(refOf))].map((ref) => ({ ref, label: `${ref.replace('std:', '')} (retiré)`, direction }));
    const receivedCents = sum(realized.filter((l) => l.direction === 'income'), (l) => l.realizedCents);
    const spentCents = sum(realized.filter((l) => l.direction === 'charge'), (l) => l.realizedCents);
    // Base des parts : les entrées si elles sont positives et couvrent les dépenses ; sinon les dépenses.
    const baseKind = receivedCents > 0 && receivedCents >= spentCents ? 'received' : 'spent';
    const baseCents = direction === 'income' ? receivedCents : baseKind === 'received' ? receivedCents : spentCents;
    const rows = [...centers, ...extra].map((c) => {
      const paidCents = sum(realized.filter((l) => l.direction === direction && refOf(l) === c.ref), (l) => l.realizedCents);
      const remainingCents = sum(planned.filter((l) => l.direction === direction && refOf(l) === c.ref && !l.settled && statusOf(b.state, b.cycle, l) !== 'unrealized'), (l) => l.plannedCents);
      const capCents = direction === 'charge' ? caps[c.ref] ?? null : null;
      return {
        ref: c.ref,
        key: c.ref.replace(/^std:/, ''),
        label: c.label,
        standard: c.ref.startsWith('std:'),
        paidCents,
        remainingCents,
        capCents,
        marginCents: capCents === null ? null : capCents - paidCents - remainingCents,
        sharePct: baseCents > 0 ? Math.round((paidCents / baseCents) * 1000) / 10 : null,
      };
    });
    return { rows, receivedCents, spentCents, baseKind: direction === 'income' ? 'received' : baseKind, baseCents };
  }

  function centers(ctx, q = {}) {
    const b = base(ctx, { periodKey: q.period });
    if (!b.period) fail('FORBIDDEN_BY_RULE', 'Cycle à configurer : aucune période à lire.', { field: 'period' });
    const direction = oneOf('direction', q.direction, ['charge', 'income'], 'charge');
    const r = centersRead(b, direction, [b.comp.budgetId]);
    const rows = r.rows.filter((x) => x.paidCents || x.remainingCents || x.capCents !== null || q.all === 'true');
    const restCents = r.baseKind === 'received' && direction === 'charge' ? r.receivedCents - r.spentCents : null;
    return {
      context: contextOf(b),
      direction,
      basis: {
        kind: r.baseKind,
        label: r.baseCents > 0 ? (r.baseKind === 'received' ? 'Sur 100 € reçus' : 'Sur 100 € dépensés') : 'Aucune base : pas de part calculée',
        baseCents: r.baseCents,
        receivedCents: r.receivedCents,
        spentCents: r.spentCents,
        // Reste positif : segment « non dépensé » du parcours de chaque euro (jamais un secteur négatif).
        restCents: restCents !== null && restCents > 0 ? restCents : null,
        restSharePct: restCents !== null && restCents > 0 && r.baseCents > 0 ? Math.round((restCents / r.baseCents) * 1000) / 10 : null,
      },
      rows,
    };
  }


  function periodFlow(b, { direction, center } = {}) {
    const { start, end } = b.period;
    const keep = (l) => (!direction || l.direction === direction) && (!center || (l.costCenterId ?? `std:${l.standardCostCenter}`) === center);
    const paid = budget().budgetLines(b.state, [b.comp.budgetId], { from: start, to: end, by: 'realized' }).map((l) => decorate(b, l));
    paid.push(...validatedProjectLines(b, { from: start, to: end, by: 'realized' }).map((l) => ({ ...decorate(b, l), projectCharge: true })));
    const unsettled = budget().budgetLines(b.state, [b.comp.budgetId], { from: start, to: end, by: 'planned' }).filter((l) => !l.settled).map((l) => decorate(b, l));
    const settledLines = paid.filter(keep);
    const pendingLines = unsettled.filter((l) => keep(l) && l.status !== 'unrealized');
    const unrealizedLines = unsettled.filter((l) => keep(l) && l.status === 'unrealized');
    const lines = [...settledLines, ...pendingLines, ...unrealizedLines].sort((a, z) => (a.realizedDate ?? a.plannedDate).localeCompare(z.realizedDate ?? z.plannedDate) || a.label.localeCompare(z.label));
    const essentials = essentialRefsOf(socle, b.state);
    for (const l of lines) l.nature = natureOf(l, essentials);
    return {
      lines, settledLines, pendingLines, unrealizedLines,
      selection: 'Les règlements suivent leur date réelle dans la période ; les échéances encore attendues suivent leur date prévue. Les échéances non réalisées d’une période close sont présentées séparément.',
      totals: {
        followsFilters: true,
        paidCents: sum(settledLines, (l) => l.realizedCents),
        toPayCents: sum(pendingLines, (l) => l.plannedCents),
        unrealizedCents: sum(unrealizedLines, (l) => l.plannedCents),
        plannedCents: sum(lines, (l) => l.plannedCents),
        specialCents: 0,
        lineCount: lines.length,
        unfilteredCount: lines.length,
      },
    };
  }

  function centerDetail(ctx, ref, q = {}) {
    const b = base(ctx, { periodKey: q.period });
    const c = budget().costCentersOf(b.state, b.userId).find((x) => x.ref === ref || x.ref === `std:${ref}`);
    if (!c) fail('NOT_FOUND', 'Centre inconnu pour ce user.', { ref });
    const read = centers(ctx, { period: q.period, direction: c.direction, all: 'true' });
    const row = read.rows.find((x) => x.ref === c.ref);
    // Périmètre du budget de vie, avec ses charges de projet validées (mêmes lignes que le dépensé du poste).
    const flow = periodFlow(b, { center: c.ref });
    // Plafond du poste (jamais bloquant).
    const report = c.direction === 'charge' ? capsRead(b) : null;
    const life = b.state.budgets[b.comp.budgetId];
    return {
      context: read.context,
      center: { ...c, ...row },
      basis: read.basis,
      ...flow,
      cap: report?.centers.find((x) => x.ref === c.ref) ?? null,
      // Seuils des niveaux de consommation (Budget, seule source) : jauge et fenêtre du plafond.
      levels: CAP_LEVEL_PCT,
      lifeBudget: { budgetId: life.id, revision: life.revision },
    };
  }

  function incomes(ctx, q = {}) {
    const b = base(ctx, { periodKey: q.period });
    const read = centers(ctx, { period: q.period, direction: 'income' });
    const flow = periodFlow(b, { direction: 'income' });
    return {
      context: read.context,
      receivedCents: read.basis.receivedCents,
      expectedCents: sum(flow.pendingLines, (l) => l.plannedCents),
      sources: read.rows.map((r) => ({ ref: r.ref, label: r.label, receivedCents: r.paidCents, expectedCents: r.remainingCents, sharePct: r.sharePct })),
      ...flow,
    };
  }

  return { centers, centerDetail, incomes };
}
