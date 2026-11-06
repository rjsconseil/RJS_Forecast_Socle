// Lectures communes de l'application BPM (contrats partagés par les pages, graphes et détails).
// Chaque montant est en centimes entiers (`…Cents`) ; chaque contrat porte son contexte (user,
// périmètre, période début incluse / fin exclue, date de calcul, révision du stockage).
// Les sommes passent par `budgetLines` (middleware Budget) ou par les métriques administrées :
// un même montant n'est jamais recalculé avec une autre formule. Aucune lecture n'écrit.
import { fail } from '../../socle/errors.mjs';
import { date, money, oneOf } from '../../socle/validation.mjs';
import { CADENCES, PER_YEAR, monthlyAverageCents, occurrenceDates, parseOccurrenceKey } from '../budget/recurrence.mjs';
import { addDays, today, periodContaining } from './periods.mjs';
import { GOAL_TYPES, project } from './projection.mjs';
import { fundedStandardsOf, specialProjectLines } from './projects.mjs';
import { essentialRefsOf, NATURES, NATURE_LABEL, natureOf } from './natures.mjs';

const RESULT = 'bpm.resultatPeriode';
const SUMMARY_KEYS = ['bpm.revenus', 'bpm.charges', RESULT, 'bpm.resteARecevoir', 'bpm.resteAPayer', 'bpm.soldeAttendu', 'bpm.resultatPrevu', 'bpm.tauxEpargne', 'bpm.patrimoineConstitue', 'bpm.patrimoineFinPeriode', 'bpm.progressionObjectif', 'bpm.resteObjectif'];
const STATUS_LABEL = { settled: 'Réglé', due: 'Du jour', late: 'En retard', pending: 'À venir', unrealized: 'Non réalisé' };
const NATURE_ORDER = ['entrees', ...NATURES];
/** Groupe et filtre des dépenses sans catégorie personnalisée. */
const NO_CATEGORY = '__none__';
export const DEFAULT_VISION = { horizonYears: 20, annualReturnPct: null, inflationPct: 2, inflationSource: 'Hypothèse par défaut modifiable', contributionCents: null, contributionCadence: 'monthly', savingsTargetCents: null, surplus: null };

const cents = (v) => (v === null || v === undefined ? null : Math.round(v * 100));
const sum = (lines, f) => lines.reduce((s, l) => s + (f(l) ?? 0), 0);
const sign = (direction) => (direction === 'income' ? 1 : -1);

/** Montant venant d'une adresse (texte « 12,50 » ou « 12.50 ») : converti à la frontière, puis validé en centimes. */
const queryMoney = (field, value, opts) => money(field, typeof value === 'string' && value.trim() !== '' ? Number(value.replace(',', '.').replace(/\s/g, '')) : value, opts);

export function percent(field, value, { min = -100, max = 100, nullable = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    fail('VALIDATION', `Le champ ${field} est obligatoire.`, { field });
  }
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) fail('VALIDATION', `Le champ ${field} doit être un pourcentage entre ${min} et ${max}.`, { field });
  return n;
}

/**
 * @param socle socle complet
 * @param h     helpers du module BPM : requireComposition, metricContext, cycleState, figuresFor, closuresOf
 */
export function createReads(socle, h) {
  const { om, metrics } = socle;
  const budget = () => socle.modules.budget;

  // ---------- contexte commun ----------

  function base(ctx, { periodKey } = {}) {
    const state = socle.state;
    const { userId, comp, cycle } = h.requireComposition(state, ctx);
    const mctx = h.metricContext(state, userId, { periodKey });
    const cs = h.cycleState(state, cycle);
    const budgets = om
      .list(state, 'budget', (b) => b.userId === userId)
      .sort((a, b) => (a.role === b.role ? a.createdAt.localeCompare(b.createdAt) : a.role === 'life' ? -1 : 1))
      .map((b) => ({ id: b.id, name: b.role === 'life' ? 'Budget du projet de vie' : b.name, role: b.role, coreProjectId: b.coreProjectId, capsCents: b.capsCents ?? {}, revision: b.revision }));
    return { state, userId, comp, cycle, cs, mctx, period: mctx.period, budgets };
  }

  function contextOf(b, scope = 'principal') {
    const user = b.state.users[b.userId];
    return {
      user: { id: user.id, label: user.label, userType: user.userType },
      scope,
      scopeLabel: scope === 'principal' ? 'Budget du projet de vie' : 'Tous les Budgets du user (chaque Budget une fois ; aucun flux père/enfant calculé)',
      budgets: b.budgets,
      period: b.period ? { ...b.period, endExclusive: addDays(b.period.end, 1) } : null,
      // Bornes de navigation : de la première période du cycle à la période courante (seules lisibles).
      periods: b.cs ? { firstKey: b.cs.first.key, currentKey: b.cs.current.key } : null,
      calculationDate: today(),
      revision: b.state.revision,
      unit: 'centimes (EUR)',
    };
  }

  const closedPeriodOf = (state, cycle, ymd) => h.closuresOf(state, cycle?.id).find((c) => ymd >= c.periodStart && ymd <= c.periodEnd) ?? null;

  function statusOf(state, cycle, line, now = today()) {
    if (line.settled) return 'settled';
    if (closedPeriodOf(state, cycle, line.plannedDate)) return 'unrealized';
    if (line.plannedDate < now) return 'late';
    if (line.plannedDate === now) return 'due';
    return 'pending';
  }

  const decorate = (b, line) => {
    const v = budget().lineView(b.state, line);
    const status = statusOf(b.state, b.cycle, line);
    return { ...v, status, statusLabel: STATUS_LABEL[status], centerKnown: !String(v.costCenterLabel ?? '').endsWith('(retiré)') && v.costCenterLabel !== null };
  };

  /** Fenêtre de lecture : période du cycle, ou vue libre semaine/mois/année (n'altère pas le cycle). */
  function windowOf(b, q) {
    if (q.from || q.to) {
      const from = date('from', q.from, { required: true });
      const to = date('to', q.to, { required: true });
      if (to < from) fail('VALIDATION', 'La fin de la fenêtre précède son début.', { field: 'to' });
      return { from, to, kind: 'custom' };
    }
    if (!b.period) fail('FORBIDDEN_BY_RULE', 'Cycle à configurer : aucune période à lire.', { field: 'period' });
    return { from: b.period.start, to: b.period.end, kind: 'period' };
  }

  /**
   * Charges des projets de la vie validées comme réglées (Budgets standards financés par le budget de vie, réglées
   * depuis l'attribution) : elles comptent dans les dépenses du budget de vie, jamais avant leur validation.
   */
  const validatedProjectLines = (b, { from, to, by }) =>
    fundedStandardsOf(b.state, b.comp.budgetId).flatMap((sb) =>
      budget()
        .budgetLines(b.state, [sb.id], { from, to, by })
        .filter((l) => l.kind === 'operation' && l.direction === 'charge' && l.settled && l.realizedDate >= sb.allocationDate),
    );

  /** Charge spéciale du budget de vie (budget attribué, dépassement facturé) : présentée, jamais totalisée. */
  const specialLine = (b, sp) => ({
    id: sp.id,
    kind: sp.kind,
    operationId: null,
    recurrenceId: null,
    occurrenceDate: null,
    occurrenceKey: null,
    budgetId: b.comp.budgetId,
    userId: b.userId,
    direction: 'charge',
    label: sp.label,
    plannedDate: sp.date,
    plannedCents: sp.cents,
    realizedDate: null,
    realizedCents: null,
    settled: false,
    standardCostCenter: null,
    costCenterId: null,
    costCenterRef: 'projects',
    costCenterLabel: 'Charges des projets de la vie',
    centerKnown: true,
    budgetName: 'Budget du projet de vie',
    budgetRole: 'life',
    cadence: 'once',
    cadenceLabel: 'Ponctuelle',
    firstDate: null,
    endDate: null,
    note: null,
    taskId: null,
    taskTitle: null,
    revision: null,
    differenceCents: null,
    status: 'project',
    statusLabel: sp.statusLabel,
    special: true,
    project: { budgetId: sp.budget.id, coreProjectId: sp.budget.coreProjectId, name: sp.budget.name },
  });

  const budgetIdsOf = (b, q) => {
    if (q.budgetId) {
      if (!b.budgets.some((x) => x.id === q.budgetId)) fail('NOT_FOUND', 'Budget inconnu pour ce user.', { field: 'budgetId' });
      return [q.budgetId];
    }
    return q.scope === 'consolidated' ? b.budgets.map((x) => x.id) : [b.comp.budgetId];
  };

  // ---------- synthèse ----------

  function summary(ctx, { periodKey } = {}) {
    const b = base(ctx, { periodKey });
    const { figures, comparison } = h.figuresFor(b.state, b.userId, SUMMARY_KEYS, { periodKey: b.period?.key });
    const out = {};
    for (const [k, f] of Object.entries(figures)) out[k] = { key: k, label: f.label, unit: f.unit, value: f.value, valueCents: f.unit === 'EUR' ? cents(f.value) : null, status: f.status, unavailableReason: f.unavailableReason ?? null, recorded: !!f.recorded, formula: f.formula };
    // L'unité des valeurs comparées (EUR ou %) est celle de l'indicateur ; les montants sont aussi rendus en centimes.
    const compared = comparison.map((c) => {
      const unit = figures[c.key]?.unit ?? null;
      return { ...c, unit, ...(unit === 'EUR' ? { recordedCents: cents(c.recorded), recomputedCents: cents(c.recomputed) } : {}) };
    });
    return { context: contextOf(b), figures: out, comparison: compared, closed: b.period?.status === 'closed' };
  }

  // ---------- registre ----------

  function register(ctx, q = {}) {
    const b = base(ctx, { periodKey: q.period });
    const win = windowOf(b, q);
    const all = budget().budgetLines(b.state, budgetIdsOf(b, q), { from: win.from, to: win.to, by: 'planned' }).map((l) => decorate(b, l));
    // Budget du projet de vie : ses charges de projet validées comptent ; ses charges spéciales sont présentées à part.
    if (!q.budgetId && q.scope !== 'consolidated') {
      for (const l of validatedProjectLines(b, { from: win.from, to: win.to, by: 'planned' })) all.push({ ...decorate(b, l), projectCharge: true });
      for (const sp of specialProjectLines(b.state, b.comp.budgetId, win)) all.push(specialLine(b, sp));
      all.sort((x, y) => x.plannedDate.localeCompare(y.plannedDate) || x.label.localeCompare(y.label));
    }
    // Nature d'une charge (indispensable, courante, projet) : paramètre `bpm.chargesIndispensables` [P].
    const essentials = essentialRefsOf(socle, b.state);
    for (const l of all) l.nature = natureOf(l, essentials);
    const nature = q.nature ? oneOf('nature', q.nature, NATURES) : null;
    const needle = q.q?.trim().toLowerCase();
    const lines = all.filter(
      (l) =>
        (!q.direction || l.direction === q.direction) &&
        (!nature || l.nature === nature) &&
        (!q.status || l.status === q.status) &&
        (!q.center || (q.center === '__none__' ? !l.centerKnown : l.costCenterRef === q.center)) &&
        (!q.category || (q.category === NO_CATEGORY ? !l.categoryId : l.categoryId === q.category)) &&
        (!q.taskId || l.taskId === q.taskId) &&
        (!needle || [l.label, l.note, l.costCenterLabel, l.categoryLabel].some((t) => (t ?? '').toLowerCase().includes(needle))),
    );
    const groupBy = oneOf('groupBy', q.groupBy, ['center', 'category', 'project', 'nature', 'date', 'none'], 'center');
    const keyOf = {
      center: (l) => [l.costCenterRef, l.costCenterLabel ?? 'Centre à préciser'],
      category: (l) => (l.categoryId ? [l.categoryId, l.categoryLabel ?? 'Catégorie retirée'] : [NO_CATEGORY, 'Sans catégorie']),
      project: (l) => [l.budgetId, l.budgetRole === 'life' ? 'Budget du projet de vie' : l.budgetName],
      nature: (l) => (l.nature ? [l.nature, NATURE_LABEL[l.nature]] : ['entrees', 'Entrées']),
      date: (l) => [l.plannedDate, l.plannedDate],
      none: () => ['all', 'Toutes les lignes'],
    }[groupBy];
    const groups = new Map();
    for (const l of lines) {
      const [k, label] = keyOf(l);
      if (!groups.has(k)) groups.set(k, { key: k, label, plannedCents: 0, paidCents: 0, toPayCents: 0, specialCents: 0, lineIds: [] });
      const g = groups.get(k);
      g.lineIds.push(l.id);
      // Charges spéciales des projets : présentées, jamais totalisées (comptées à la validation de leurs dépenses).
      if (l.special) {
        g.specialCents += l.plannedCents;
        continue;
      }
      g.plannedCents += l.plannedCents;
      g.paidCents += l.settled ? l.realizedCents : 0;
      g.toPayCents += ['late', 'due', 'pending'].includes(l.status) ? l.plannedCents : 0;
    }
    const open = (l) => ['late', 'due', 'pending'].includes(l.status);
    const counted = lines.filter((l) => !l.special);
    // Plafonds de la période (budget du projet de vie seulement) : état de chaque centre et de chaque catégorie.
    const principal = !q.budgetId && q.scope !== 'consolidated';
    const caps = principal && win.kind === 'period' ? capsBrief(capsRead(b)) : null;
    const ordered = [...groups.values()];
    return {
      context: contextOf(b, q.budgetId ? 'budget' : q.scope === 'consolidated' ? 'consolidated' : 'principal'),
      window: win,
      selection: 'Les lignes sont sélectionnées par leur date prévue ; le réalisé des synthèses suit la date réelle de règlement.',
      filters: { q: q.q ?? null, direction: q.direction ?? null, nature, status: q.status ?? null, center: q.center ?? null, category: q.category ?? null, taskId: q.taskId ?? null, budgetId: q.budgetId ?? null, groupBy },
      totals: {
        followsFilters: true,
        paidCents: sum(counted.filter((l) => l.settled), (l) => l.realizedCents),
        toPayCents: sum(counted.filter(open), (l) => l.plannedCents),
        unrealizedCents: sum(counted.filter((l) => l.status === 'unrealized'), (l) => l.plannedCents),
        plannedCents: sum(counted, (l) => l.plannedCents),
        specialCents: sum(lines.filter((l) => l.special), (l) => l.plannedCents),
        // Vue « Tout » : entrées et charges séparées, et net signé (reçu − payé ; prévu entrées − prévu charges).
        byDirection: Object.fromEntries(
          ['income', 'charge'].map((d) => {
            const ls = counted.filter((l) => l.direction === d);
            return [d, { settledCents: sum(ls.filter((l) => l.settled), (l) => l.realizedCents), openCents: sum(ls.filter(open), (l) => l.plannedCents), plannedCents: sum(ls, (l) => l.plannedCents), lineCount: ls.length }];
          }),
        ),
        netSettledCents: sum(counted.filter((l) => l.settled), (l) => (l.direction === 'income' ? l.realizedCents : -l.realizedCents)),
        netPlannedCents: sum(counted, (l) => (l.direction === 'income' ? l.plannedCents : -l.plannedCents)),
        lineCount: lines.length,
        unfilteredCount: all.length,
      },
      // Par nature : entrées, puis indispensables, courantes et projets ; par catégorie : « Sans catégorie » en dernier.
      groups:
        groupBy === 'nature'
          ? ordered.sort((x, y) => NATURE_ORDER.indexOf(x.key) - NATURE_ORDER.indexOf(y.key))
          : groupBy === 'category'
            ? ordered.sort((x, y) => (x.key === NO_CATEGORY) - (y.key === NO_CATEGORY))
            : ordered,
      caps,
      lines,
    };
  }

  /** Détail d'une ligne (opération ou occurrence attendue) : définition, règlements et identifiants. */
  function lineDetail(ctx, lineId, { periodKey } = {}) {
    const b = base(ctx, { periodKey });
    const state = b.state;
    const occ = parseOccurrenceKey(lineId);
    let line;
    let rec = null;
    if (occ) {
      rec = om.owned(state, 'recurrence', occ.recurrenceId, b.userId);
      const settled = om.list(state, 'operation', (o) => o.recurrenceId === rec.id && o.occurrenceDate === occ.date)[0];
      line = budget().budgetLines(state, [rec.budgetId], { from: occ.date, to: occ.date, by: 'planned' }).find((l) => l.occurrenceKey === lineId || l.operationId === settled?.id);
    } else {
      const o = om.owned(state, 'operation', lineId, b.userId);
      rec = o.recurrenceId ? state.recurrences[o.recurrenceId] : null;
      line = budget().budgetLines(state, [o.budgetId], { from: o.date, to: o.date, by: 'planned' }).find((l) => l.operationId === o.id);
    }
    if (!line) fail('NOT_FOUND', "Cette échéance n'existe pas (hors des dates de sa définition).", { lineId });
    const view = decorate(b, line);
    const settlements = rec
      ? om
          .list(state, 'operation', (o) => o.recurrenceId === rec.id && o.status === 'realized')
          .sort((x, y) => y.realizedDate.localeCompare(x.realizedDate))
          .map((o) => ({ operationId: o.id, occurrenceDate: o.occurrenceDate, plannedCents: o.amountCents, realizedCents: o.realizedAmountCents, realizedDate: o.realizedDate, outsidePeriod: !b.period || o.realizedDate < b.period.start || o.realizedDate > b.period.end }))
      : view.settled
        ? [{ operationId: view.operationId, occurrenceDate: null, plannedCents: view.plannedCents, realizedCents: view.realizedCents, realizedDate: view.realizedDate, outsidePeriod: !b.period || view.realizedDate < b.period.start || view.realizedDate > b.period.end }]
        : [];
    return {
      context: contextOf(b),
      line: view,
      definition: rec ? budget().recurrenceView(state, rec) : null,
      settlements,
      ids: { lineId, operationId: view.operationId, recurrenceId: view.recurrenceId, budgetId: view.budgetId, taskId: view.taskId },
      actions: {
        canSettle: !view.settled,
        canCancelSettlement: view.settled && !closedPeriodOf(state, b.cycle, view.realizedDate),
        canEdit: !closedPeriodOf(state, b.cycle, view.plannedDate) || view.kind === 'occurrence',
        settlementPolicy: 'Règlement manuel [P] ; une échéance d’une période close peut être réglée plus tard, à sa date réelle, sans modifier l’historique clos.',
      },
    };
  }

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
      const remainingCents = sum(planned.filter((l) => l.direction === direction && refOf(l) === c.ref && !l.settled), (l) => l.plannedCents);
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

  // ---------- plafonds de dépenses : centres de coût et catégories ----------

  /** Résumé d'un plafond pour les listes (registre) : plafond, engagé, marge, consommation, dépassement. */
  const capBrief = (r) => ({ capCents: r.capCents, engagedCents: r.engagedCents, marginCents: r.marginCents, usedPct: r.usedPct, over: r.over });
  const capsBrief = (report) => ({
    centers: Object.fromEntries(report.centers.map((c) => [c.ref, capBrief(c)])),
    categories: Object.fromEntries(report.categories.map((k) => [k.id, { ...capBrief(k), label: k.label, costCenterRef: k.costCenterRef, archived: k.archived }])),
    overCount: report.overCount,
  });

  /** Plafonds de la période lue : même périmètre que les centres (budget de vie + charges de projet validées). */
  function capsRead(b, { withLines = false } = {}) {
    const { start, end } = b.period;
    const realized = [...budget().budgetLines(b.state, [b.comp.budgetId], { from: start, to: end, by: 'realized' }), ...validatedProjectLines(b, { from: start, to: end, by: 'realized' })];
    const planned = budget().budgetLines(b.state, [b.comp.budgetId], { from: start, to: end, by: 'planned' });
    const life = b.state.budgets[b.comp.budgetId];
    return budget().capReport({
      centers: budget().costCentersOf(b.state, b.userId),
      caps: life.capsCents ?? {},
      categories: budget().categoriesOf(b.state, b.userId, { archived: true }),
      realized,
      planned,
      withLines,
    });
  }

  /** Mois entiers écoulés entre deux dates (AAAA-MM-JJ), jamais négatif. */
  const monthsBetween = (from, to) => {
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    return Math.max(0, (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0));
  };

  /**
   * Revue des plafonds de la période : chaque poste et chaque catégorie avec son plafond, et les charges qui,
   * ensemble, forment son engagé (même calcul que les alertes). Chaque charge porte sa récurrence et son
   * antériorité, pour décider de ce qu'on peut retirer — la décision reste à l'utilisateur.
   */
  function capsReview(ctx, q = {}) {
    const b = base(ctx, { periodKey: q.period });
    if (!b.period) fail('FORBIDDEN_BY_RULE', 'Cycle à configurer : aucune période à lire.', { field: 'period' });
    const report = capsRead(b, { withLines: true });
    const life = b.state.budgets[b.comp.budgetId];
    const { start, end } = b.period;
    const now = today();
    const projectIds = new Set(validatedProjectLines(b, { from: start, to: end, by: 'realized' }).map((l) => l.id));
    const charges = new Map();
    const chargeOf = (c) => {
      const l = c.line;
      if (!charges.has(l.id)) {
        const v = decorate(b, l);
        const rec = l.recurrenceId ? b.state.recurrences[l.recurrenceId] : null;
        const origin = rec?.firstDate ?? l.plannedDate;
        const project = projectIds.has(l.id) ? b.budgets.find((x) => x.id === l.budgetId) ?? null : null;
        charges.set(l.id, {
          ...v,
          projectCharge: !!project,
          project: project ? { budgetId: project.id, coreProjectId: project.coreProjectId, name: project.name } : null,
          engagedCents: c.engagedCents,
          engagedDate: c.engagedDate,
          engagedAs: c.engagedAs,
          origin,
          sinceMonths: monthsBetween(origin, now < origin ? origin : now),
          newThisPeriod: origin >= start && origin <= end,
          rank: rec ? occurrenceDates(rec, rec.firstDate, l.occurrenceDate ?? l.plannedDate).length : null,
          perYearCents: rec ? rec.amountCents * PER_YEAR[rec.cadence] : null,
          monthlyCents: rec ? monthlyAverageCents(rec.amountCents, rec.cadence) : null,
        });
      }
      return l.id;
    };
    const row = ({ lines, ...r }) => ({ ...r, chargeIds: lines.sort((x, y) => y.engagedCents - x.engagedCents).map(chargeOf) });
    const centers = report.centers.map(row);
    const categories = report.categories.filter((k) => !k.archived || k.lineCount).map(row);
    const overOf = (r) => (r.over ? -r.marginCents : 0);
    // À compenser sur les autres postes : le dépassement du poste plafonné ; sans plafond de poste, celui de ses catégories.
    const toCompensateCents = centers.reduce(
      (t, c) => t + (c.capCents !== null ? overOf(c) : categories.filter((k) => k.costCenterRef === c.ref).reduce((s, k) => s + overOf(k), 0)),
      0,
    );
    const capped = [...centers, ...categories].filter((r) => r.capCents !== null);
    const { figures } = h.figuresFor(b.state, b.userId, ['bpm.soldeAttendu', 'bpm.resultatPrevu'], { periodKey: b.period.key });
    return {
      context: contextOf(b),
      lifeBudget: { budgetId: life.id, revision: life.revision, capsCents: life.capsCents ?? {} },
      centers,
      categories,
      charges: Object.fromEntries(charges),
      totals: {
        cappedCount: capped.length,
        overCount: report.overCount,
        toCompensateCents,
        // Marge restante sous les plafonds respectés (postes seulement : une catégorie est comprise dans son poste).
        headroomCents: centers.filter((c) => c.capCents !== null && !c.over).reduce((t, c) => t + c.marginCents, 0),
        expectedCents: cents(figures['bpm.soldeAttendu'].value),
        initialCents: cents(figures['bpm.resultatPrevu'].value),
      },
    };
  }

  /** Lecture des plafonds de la période (deux niveaux indépendants, jamais bloquants). */
  function spendingCaps(ctx, q = {}) {
    const b = base(ctx, { periodKey: q.period });
    const life = b.state.budgets[b.comp.budgetId];
    const report = b.period ? capsRead(b) : { centers: [], categories: [], overCount: 0, alerts: [] };
    return {
      context: contextOf(b),
      lifeBudget: { budgetId: life.id, revision: life.revision, capsCents: life.capsCents ?? {} },
      ...report,
      // Catégories retirées : visibles seulement si des dépenses de la période y sont encore rangées.
      categories: report.categories.filter((k) => !k.archived || k.lineCount),
    };
  }

  /**
   * Alertes de plafond touchées par une dépense, dans la période de sa date (lecture après écriture).
   * Les périodes futures sont calculées directement ; aucune limite de pagination historique.
   */
  function capAlertsFor(ctx, { date: d, costCenterRef, categoryId, direction }) {
    if (direction !== 'charge' || !d) return [];
    const b = base(ctx);
    if (!b.cs) return [];
    const period = periodContaining(d, b.cycle.anchorDay);
    if (period.index < b.cs.first.index) return [];
    const report = capsRead({ ...b, period });
    return report.alerts.filter((a) => (a.level === 'center' && a.ref === costCenterRef) || (a.level === 'category' && a.id === categoryId));
  }

  /** Simulation en mémoire : mêmes lignes Budget et mêmes plafonds, aucune écriture ni ID créé. */
  function previewCaps(ctx, input = {}) {
    const b = base(ctx);
    if (!b.cs) fail('FORBIDDEN_BY_RULE', 'Configurez le cycle avant de consulter les plafonds.');
    const direction = oneOf('direction', input.direction, ['income', 'charge']);
    const cadence = oneOf('cadence', input.cadence, ['once', ...CADENCES], 'once');
    const recurring = cadence !== 'once';
    const kind = recurring ? 'recurrence' : 'operation';
    const original = input.replaceId ? om.owned(b.state, kind, input.replaceId, b.userId) : null;
    const recurrence = input.settle && input.recurrenceId ? om.owned(b.state, 'recurrence', input.recurrenceId, b.userId) : null;
    const budgetId = original?.budgetId ?? recurrence?.budgetId ?? input.budgetId ?? b.comp.budgetId;
    om.owned(b.state, 'budget', budgetId, b.userId);
    const category = input.categoryId ? om.owned(b.state, 'chargeCategory', input.categoryId, b.userId) : null;
    const ref = input.costCenterRef ?? category?.costCenterRef ?? 'std:divers';
    const amountCents = money('amount', input.amount, { positive: true });
    const d = date(recurring ? 'firstDate' : 'date', recurring ? input.firstDate : input.date, { required: true });
    const item = {
      ...recurrence, ...original, id: original?.id ?? '__preview__', userId: b.userId, budgetId,
      direction, label: input.label || 'Aperçu', amountCents,
      costCenterId: ref.startsWith('std:') ? null : ref,
      standardCostCenter: ref.startsWith('std:') ? ref.slice(4) : null,
      categoryId: category?.id ?? null,
    };
    if (recurring) Object.assign(item, { cadence, firstDate: d, endDate: date('endDate', input.endDate) });
    else Object.assign(item, {
      date: d, status: original?.status ?? input.status ?? 'planned',
      realizedDate: original?.realizedDate ?? (input.status === 'realized' ? date('realizedDate', input.realizedDate ?? d, { required: true }) : null),
      realizedAmountCents: original?.realizedAmountCents ?? (input.status === 'realized' ? money('realizedAmount', input.realizedAmount ?? input.amount, { positive: true }) : null),
    });
    if (input.settle) {
      item.status = 'realized';
      item.realizedDate = date('realizedDate', input.realizedDate ?? d, { required: true });
      item.realizedAmountCents = money('realizedAmount', input.realizedAmount ?? input.amount, { positive: true });
      if (recurrence) Object.assign(item, { recurrenceId: recurrence.id, occurrenceDate: date('occurrenceDate', input.occurrenceDate, { required: true }) });
    }
    // Une définition récurrente passée est évaluée sur la période actuelle ; une saisie future sur sa première période.
    const effectiveDate = recurring ? (d > b.cs.current.start ? d : b.cs.current.start) : item.realizedDate ?? d;
    const period = periodContaining(effectiveDate, b.cycle.anchorDay);
    const table = recurring ? 'recurrences' : 'operations';
    const state = { ...b.state, [table]: { ...b.state[table], [item.id]: item } };
    const before = capsRead({ ...b, period });
    let after = capsRead({ ...b, state, period });
    // Pour un projet, anticiper la charge avant sa validation dans le budget de vie.
    if (budgetId !== b.comp.budgetId) {
      const window = { from: period.start, to: period.end };
      const candidate = l => recurring ? l.recurrenceId === item.id : l.operationId === item.id;
      const keep = l => !candidate(l);
      const realized = [...budget().budgetLines(b.state, [b.comp.budgetId], { ...window, by: 'realized' }), ...validatedProjectLines(b, { ...window, by: 'realized' }).filter(keep), ...budget().budgetLines(state, [budgetId], { ...window, by: 'realized' }).filter(candidate)];
      const planned = [...budget().budgetLines(b.state, [b.comp.budgetId], { ...window, by: 'planned' }), ...budget().budgetLines(state, [budgetId], { ...window, by: 'planned' }).filter(candidate)];
      after = budget().capReport({ centers: budget().costCentersOf(state, b.userId), categories: budget().categoriesOf(state, b.userId, { archived: true }), caps: state.budgets[b.comp.budgetId].capsCents ?? {}, realized, planned });
    }
    const relevant = r => ({
      center: r.centers.find(c => c.ref === ref) ?? null,
      category: r.categories.find(c => c.id === category?.id) ?? null,
    });
    return { mutation: false, period, before: relevant(before), after: relevant(after),
      alerts: direction === 'charge' ? after.alerts.filter(a => a.level === 'center' ? a.ref === ref : a.id === category?.id) : [],
      note: budgetId !== b.comp.budgetId ? 'Impact estimé après validation de la charge du projet.' : null };
  }

  function centerDetail(ctx, ref, q = {}) {
    const b = base(ctx, { periodKey: q.period });
    const c = budget().costCentersOf(b.state, b.userId).find((x) => x.ref === ref || x.ref === `std:${ref}`);
    if (!c) fail('NOT_FOUND', 'Centre inconnu pour ce user.', { ref });
    const read = centers(ctx, { period: q.period, direction: c.direction, all: 'true' });
    const row = read.rows.find((x) => x.ref === c.ref);
    // Périmètre du budget de vie, avec ses charges de projet validées (mêmes lignes que le dépensé du poste).
    const reg = register(ctx, { period: q.period, center: c.ref, groupBy: 'date' });
    // Plafonds du poste : celui du centre et ceux de ses catégories, lus indépendamment (jamais bloquants).
    const report = c.direction === 'charge' ? capsRead(b) : null;
    const life = b.state.budgets[b.comp.budgetId];
    return {
      context: read.context,
      center: { ...c, ...row },
      basis: read.basis,
      lines: reg.lines,
      totals: reg.totals,
      cap: report?.centers.find((x) => x.ref === c.ref) ?? null,
      categories: report ? report.categories.filter((k) => k.costCenterRef === c.ref && (!k.archived || k.lineCount)) : [],
      lifeBudget: { budgetId: life.id, revision: life.revision },
    };
  }

  function incomes(ctx, q = {}) {
    const read = centers(ctx, { period: q.period, direction: 'income' });
    const reg = register(ctx, { period: q.period, direction: 'income', groupBy: 'center' });
    return {
      context: read.context,
      receivedCents: read.basis.receivedCents,
      expectedCents: sum(reg.lines.filter((l) => !l.settled && l.status !== 'unrealized'), (l) => l.plannedCents),
      sources: read.rows.map((r) => ({ ref: r.ref, label: r.label, receivedCents: r.paidCents, expectedCents: r.remainingCents, sharePct: r.sharePct })),
      lines: reg.lines,
    };
  }

  // ---------- solde et rapprochement ----------

  function balance(ctx, q = {}) {
    const s = summary(ctx, { periodKey: q.period });
    const b = base(ctx, { periodKey: q.period });
    const pat = b.state.patrimoines[b.comp.patrimoineId];
    const f = s.figures;
    const net = f[RESULT].valueCents;
    let reconciliation = null;
    if (q.initial !== undefined && q.current !== undefined && q.initial !== '' && q.current !== '') {
      const initialCents = queryMoney('initial', q.initial, { signed: true });
      const currentCents = queryMoney('current', q.current, { signed: true });
      const variationCents = currentCents - initialCents;
      const gapCents = net === null ? null : variationCents - net;
      reconciliation = {
        initialCents,
        currentCents,
        variationCents,
        netCents: net,
        gapCents,
        formula: 'écart = (solde actuel − solde initial) − net calculé',
        suggestion: gapCents === null ? 'Net inconnu : écart non calculable.' : gapCents === 0 ? 'Aucun écart.' : gapCents < 0 ? 'Écart négatif : une dépense est peut-être manquante. Relisez avant toute saisie.' : 'Écart positif : une entrée est peut-être manquante. Relisez avant toute saisie.',
        createsOperation: false,
      };
    }
    return {
      context: s.context,
      closed: s.closed,
      receivedCents: f['bpm.revenus'].valueCents,
      paidCents: f['bpm.charges'].valueCents,
      netCents: net,
      toReceiveCents: f['bpm.resteARecevoir'].valueCents,
      toPayCents: f['bpm.resteAPayer'].valueCents,
      expectedCents: f['bpm.soldeAttendu'].valueCents,
      initialBudgetCents: f['bpm.resultatPrevu'].valueCents,
      closingDate: s.context.period?.end ?? null,
      patrimoine: { stockCents: f['bpm.patrimoineConstitue'].valueCents, effectCents: net, afterCents: f['bpm.patrimoineFinPeriode'].valueCents, objectiveCents: pat?.objectiveCents ?? null },
      figures: f,
      reconciliation,
    };
  }

  // ---------- historique et impact ----------

  function history(ctx, { before, limit = 6 } = {}) {
    const b = base(ctx);
    if (!b.cs) return { context: contextOf(b), rows: [], total: 0, nextBefore: null };
    const page = b.cs.page({ before: before === undefined || before === null || before === '' ? undefined : Number(before), limit: Math.min(Math.max(Number(limit) || 6, 1), 120) });
    const rows = page.periods.map((p) => {
      const { figures } = h.figuresFor(b.state, b.userId, ['bpm.revenus', 'bpm.charges', RESULT, 'bpm.patrimoineFinPeriode', 'bpm.soldeAttendu'], { periodKey: p.key });
      const c = p.closureId ? b.state.closures[p.closureId] : null;
      return {
        periodKey: p.key,
        index: p.index,
        label: p.label,
        start: p.start,
        end: p.end,
        status: p.status,
        recorded: !!c,
        receivedCents: cents(figures['bpm.revenus'].value),
        spentCents: cents(figures['bpm.charges'].value),
        netCents: cents(figures[RESULT].value),
        expectedCents: c ? null : cents(figures['bpm.soldeAttendu'].value),
        patrimoineCents: cents(figures['bpm.patrimoineFinPeriode'].value),
        patrimoineKind: c ? 'après clôture (enregistré)' : 'estimation',
        capitalizedCents: c ? c.resultCents : null,
        closureId: c?.id ?? null,
      };
    });
    return { context: contextOf(b), rows, total: page.total, nextBefore: page.nextBefore };
  }

  function impact(ctx, { period } = {}) {
    const b = base(ctx, { periodKey: period });
    if (!b.period) fail('FORBIDDEN_BY_RULE', 'Cycle à configurer : aucune période à lire.', { field: 'period' });
    const { start, end } = b.period;
    const rows = b.budgets.map((x) => {
      const real = budget().budgetLines(b.state, [x.id], { from: start, to: end, by: 'realized' });
      const plan = budget().budgetLines(b.state, [x.id], { from: start, to: end, by: 'planned' }).filter((l) => !l.settled);
      const inc = sum(real.filter((l) => l.direction === 'income'), (l) => l.realizedCents);
      const chg = sum(real.filter((l) => l.direction === 'charge'), (l) => l.realizedCents);
      const toRec = sum(plan.filter((l) => l.direction === 'income'), (l) => l.plannedCents);
      const toPay = sum(plan.filter((l) => l.direction === 'charge'), (l) => l.plannedCents);
      return { budgetId: x.id, name: x.name, role: x.role, receivedCents: inc, spentCents: chg, netCents: inc - chg, toReceiveCents: toRec, toPayCents: toPay, expectedNetCents: inc - chg + toRec - toPay };
    });
    return {
      context: contextOf(b, 'consolidated'),
      rows,
      consolidated: { status: 'not-defined', reason: 'Financement père/enfants non défini (choix ouvert) : chaque Budget est présenté une fois, sans total consolidé.' },
    };
  }

  // ---------- budget type, échéances, événements, directives ----------

  function budgetType(ctx) {
    const b = base(ctx);
    const now = today();
    const recs = budget()
      .recurrences(ctx, { budgetId: b.comp.budgetId })
      .filter((r) => !r.endDate || r.endDate >= now);
    const avg = (dir) => sum(recs.filter((r) => r.direction === dir), (r) => monthlyAverageCents(r.amountCents, r.cadence));
    const income = avg('income');
    const charge = avg('charge');
    return {
      context: contextOf(b),
      label: 'Moyennes mensuelles des opérations récurrentes actives (une moyenne ne remplace pas les échéances réelles)',
      lines: recs.map((r) => ({ ...r, monthlyAverageCents: monthlyAverageCents(r.amountCents, r.cadence) })),
      averageIncomeCents: income,
      averageChargeCents: charge,
      averageNetCents: income - charge,
      empty: recs.length === 0,
    };
  }

  function due(ctx) {
    const b = base(ctx);
    const now = today();
    const from = b.cs ? b.cs.firstOpen.start : addDays(now, -366);
    const lines = budget()
      .budgetLines(b.state, b.budgets.map((x) => x.id), { from: from < addDays(now, -730) ? addDays(now, -730) : from, to: now, by: 'planned' })
      .filter((l) => !l.settled)
      .map((l) => decorate(b, l));
    return { context: contextOf(b, 'consolidated'), lines, totalCents: sum(lines, (l) => sign(l.direction) * l.plannedCents) };
  }

  const visionOf = (comp) => ({ ...DEFAULT_VISION, ...(comp.vision ?? {}) });
  const goalsOf = (state, userId) => om.list(state, 'lifeGoal', (g) => g.userId === userId && !g.removed).sort((a, c) => a.date.localeCompare(c.date));
  const monthsUntil = (from, to) => {
    const [fy, fm] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    return (ty - fy) * 12 + (tm - fm);
  };

  function events(ctx) {
    const b = base(ctx);
    const v = visionOf(b.comp);
    const now = today();
    return {
      context: contextOf(b),
      assumptions: [`Inflation ${v.inflationPct} % par an (${v.inflationSource})`, 'Provision = coût futur ÷ périodes mensuelles restantes'],
      rows: goalsOf(b.state, b.userId)
        .filter((g) => g.date > now)
        .map((g) => {
          const years = Number(g.date.slice(0, 4)) - Number(now.slice(0, 4));
          const futureCents = Math.round(g.targetTodayCents * (1 + v.inflationPct / 100) ** Math.max(0, years));
          const periods = monthsUntil(now, g.date);
          return { goalId: g.id, label: g.label, type: g.type, date: g.date, targetTodayCents: g.targetTodayCents, futureCostCents: futureCents, periodsAvailable: periods, provisionPerPeriodCents: periods > 0 ? Math.ceil(futureCents / periods) : null, reason: periods > 0 ? null : 'Échéance dans la période courante' };
        }),
    };
  }

  function surplusProgress(b, v) {
    if (!v.surplus) return null;
    const closures = h.closuresOf(b.state, b.cycle?.id).filter((c) => c.periodKey >= v.surplus.startKey);
    const cumulated = sum(closures, (c) => c.resultCents);
    return { ...v.surplus, perPeriodCents: Math.ceil(v.surplus.targetCents / v.surplus.periods), cumulatedCents: cumulated, closedPeriods: closures.length, progressPct: v.surplus.targetCents > 0 ? Math.round((cumulated / v.surplus.targetCents) * 1000) / 10 : null };
  }

  function directives(ctx) {
    const s = summary(ctx);
    const b = base(ctx);
    const v = visionOf(b.comp);
    const ev = events(ctx);
    const surplus = surplusProgress(b, v);
    const caps = Object.values(b.state.budgets[b.comp.budgetId].capsCents ?? {});
    const expected = s.figures['bpm.soldeAttendu'].valueCents;
    const savings = surplus ? surplus.perPeriodCents : v.savingsTargetCents;
    const provisions = ev.rows.length ? sum(ev.rows, (r) => r.provisionPerPeriodCents) : 0;
    const available = expected === null || savings === null ? null : expected - savings - provisions;
    const end = s.context.period?.end;
    const daysLeft = end ? Math.max(1, Math.round((Date.parse(end) - Date.parse(today())) / 86400000) + 1) : null;
    const weeks = daysLeft ? Math.max(1, Math.ceil(daysLeft / 7)) : null;
    const item = (key, label, value, reason, assumptions) => ({ key, label, valueCents: value, computable: value !== null, reason: value === null ? reason : null, assumptions });
    return {
      context: s.context,
      items: [
        item('savings', 'Épargne nécessaire par période', savings ?? null, 'Aucun objectif d’excédent ni épargne visée renseignés', surplus ? [`Objectif d’excédent ${surplus.targetCents / 100} € sur ${surplus.periods} périodes`] : ['Épargne visée saisie']),
        item('provisions', 'Provisions indicatives par période', provisions, null, ev.assumptions),
        item('cap', 'Plafond de dépenses (somme des plafonds)', caps.length ? caps.reduce((a, c) => a + c, 0) : null, 'Aucun plafond par centre renseigné', ['Plafonds facultatifs par centre']),
        item('available', 'Disponible sur la période', available, expected === null ? 'Solde attendu inconnu' : 'Épargne nécessaire inconnue', ['Disponible = solde attendu − épargne nécessaire − provisions']),
        item('weekly', 'Montant indicatif par semaine', available === null ? null : Math.floor(available / weeks), 'Disponible non calculable', [`${weeks ?? '?'} semaine(s) restantes dans la période`]),
      ],
      surplus,
    };
  }

  // ---------- projection et simulation ----------

  function hypotheses(b, q = {}) {
    const v = visionOf(b.comp);
    const bt = budgetType({ userId: b.userId });
    const stock = metrics.evaluate(h.metricContext(b.state, b.userId, {}), 'bpm.patrimoineConstitue');
    const horizonYears = q.horizon !== undefined && q.horizon !== '' ? Math.min(Math.max(Math.round(Number(q.horizon)), 1), 80) : v.horizonYears;
    const ratePct = q.rate !== undefined && q.rate !== '' ? percent('rate', q.rate, { min: -50, max: 50 }) : v.annualReturnPct;
    const inflationPct = q.inflation !== undefined && q.inflation !== '' ? percent('inflation', q.inflation, { min: -20, max: 50 }) : v.inflationPct;
    let contributionCents = v.contributionCents;
    let contributionSource = 'Apport saisi';
    let cadence = v.contributionCadence ?? 'monthly';
    if (q.contribution !== undefined && q.contribution !== '') {
      contributionCents = queryMoney('contribution', q.contribution, { signed: true });
      contributionSource = 'Apport de la simulation';
    } else if (contributionCents === null) {
      contributionCents = bt.empty ? 0 : bt.averageNetCents;
      contributionSource = bt.empty ? 'Aucun apport : budget type vide' : 'Moyenne mensuelle du budget type';
      cadence = 'monthly';
    }
    return { horizonYears, ratePct, inflationPct, inflationSource: v.inflationSource, contributionCents, contributionSource, cadence, perYear: PER_YEAR[cadence], startCents: cents(stock.value), stockReason: stock.unavailableReason ?? null };
  }

  function projection(ctx, q = {}) {
    const b = base(ctx);
    const hy = hypotheses(b, q);
    const goals = goalsOf(b.state, b.userId).map((g) => ({ id: g.id, label: g.label, type: g.type, date: g.date, targetTodayCents: g.targetTodayCents }));
    const startYear = Number(today().slice(0, 4));
    if (hy.ratePct === null) {
      return { context: contextOf(b), hypotheses: hy, status: 'missing-hypothesis', reason: 'Rendement annuel à renseigner (Objectifs et avenir › Hypothèses).', rows: [], goals: [] };
    }
    const extraCents = q.extra !== undefined && q.extra !== '' ? queryMoney('extra', q.extra, { signed: true }) : 0;
    const run = (contribution) => project({ startCents: hy.startCents, startYear, horizonYears: hy.horizonYears, ratePct: hy.ratePct, inflationPct: hy.inflationPct, contributionCents: contribution, perYear: hy.perYear, goals });
    const result = run(hy.contributionCents + extraCents);
    const out = { context: contextOf(b), hypotheses: { ...hy, extraCents }, label: 'Estimation', ...result };
    if (extraCents) {
      const baseline = run(hy.contributionCents);
      out.baseline = { rows: baseline.rows, keyFigures: baseline.keyFigures };
      out.difference = result.rows.map((r, i) => ({ year: r.year, nominalCents: r.nominalCents - baseline.rows[i].nominalCents, realCents: r.realCents - baseline.rows[i].realCents }));
    }
    // Comparaison des apports : moyenne réelle des clôtures (≥ 2), mêmes autres hypothèses.
    const closures = h.closuresOf(b.state, b.cycle?.id);
    if (closures.length >= 2 && hy.contributionSource !== 'Moyenne réelle des clôtures') {
      const avg = Math.round(sum(closures, (c) => c.resultCents) / closures.length);
      const alt = project({ startCents: hy.startCents, startYear, horizonYears: hy.horizonYears, ratePct: hy.ratePct, inflationPct: hy.inflationPct, contributionCents: avg, perYear: 12, goals });
      out.comparison = { label: 'Apport fondé sur la moyenne réelle des clôtures', contributionCents: avg, closures: closures.length, rows: alt.rows, keyFigures: alt.keyFigures };
    } else {
      out.comparison = { label: 'Comparaison indisponible', reason: 'Au moins deux clôtures sont nécessaires.' };
    }
    return out;
  }

  // ---------- aperçu d'une saisie (aucune mutation) ----------

  function previewEntry(ctx, input = {}) {
    const b = base(ctx);
    if (!b.period) fail('FORBIDDEN_BY_RULE', 'Cycle à configurer : aucune période pour l’aperçu.');
    const direction = oneOf('direction', input.direction, ['income', 'charge']);
    const cadence = oneOf('cadence', input.cadence, ['once', ...CADENCES], 'once');
    const amountCents = money('amount', input.amount, { positive: true });
    const { start, end } = b.period;
    let plannedInPeriod = 0;
    let realizedInPeriod = 0;
    if (cadence === 'once') {
      const d = date('date', input.date, { required: true });
      const realized = input.status === 'realized';
      const rd = realized ? date('realizedDate', input.realizedDate ?? d, { required: true }) : null;
      if (rd && rd > today()) fail('FUTURE_REALIZATION', 'Date de réalisation dans le futur.', { field: 'realizedDate' });
      const realCents = realized ? money('realizedAmount', input.realizedAmount ?? amountCents / 100, { positive: true }) : 0;
      if (realized && rd >= start && rd <= end) realizedInPeriod = realCents;
      else if (!realized && d >= start && d <= end) plannedInPeriod = amountCents;
    } else {
      const firstDate = date('firstDate', input.firstDate ?? input.date, { required: true });
      const endDate = date('endDate', input.endDate);
      const fake = { cadence, firstDate, endDate };
      // Occurrences de la période : attendues tant qu'elles ne sont pas réglées.
      plannedInPeriod = occurrenceDates(fake, start, end).length * amountCents;
    }
    const s = sign(direction);
    const sm = summary(ctx);
    const exp = sm.figures['bpm.soldeAttendu'].valueCents;
    const net = sm.figures[RESULT].valueCents;
    const stock = sm.figures['bpm.patrimoineConstitue'].valueCents;
    const after = {
      netCents: net === null ? null : net + s * realizedInPeriod,
      expectedCents: exp === null ? null : exp + s * (realizedInPeriod + plannedInPeriod),
    };
    return {
      context: sm.context,
      mutation: false,
      before: { netCents: net, expectedCents: exp, stockEstimateCents: stock === null || exp === null ? null : stock + exp },
      after: { ...after, stockEstimateCents: stock === null || after.expectedCents === null ? null : stock + after.expectedCents },
      effectInPeriod: { plannedCents: plannedInPeriod, realizedCents: realizedInPeriod },
      note: stock === null ? 'Stock à renseigner : estimation du Patrimoine non calculable.' : null,
    };
  }

  return {
    summary, register, lineDetail, centers, centerDetail, spendingCaps, capsReview, capAlertsFor, previewCaps, incomes, balance, history, impact, budgetType, due, events, directives, projection, previewEntry, visionOf, goalsOf, surplusProgress, GOAL_TYPES,
    // Outils partagés avec la gestion du projet de vie (`life.mjs`) : même contexte, mêmes états, mêmes lignes.
    base, contextOf, decorate, validatedProjectLines,
  };
}
