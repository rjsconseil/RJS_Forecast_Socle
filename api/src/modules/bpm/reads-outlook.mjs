// Lectures BPM — historique et impact, budget type, échéances, événements et directives, vision et projection,
// aperçu d'une saisie (aucune mutation).
import { fail } from '../../socle/errors.mjs';
import { isCalendarDate, oneOf } from '../../socle/validation.mjs';
import { CADENCES, PER_YEAR, monthlyAverageCents } from '../budget/api.mjs';
import { addDays, today, periodContaining, periodByIndex } from '../budget/api.mjs';
import { percent } from '../patrimoine/api.mjs';
import { projectFundingSource } from '../budget/api.mjs';
import { cents, sum } from './format.mjs';
import { RESULT, sign, queryMoney } from './reads-shared.mjs';

/** `h` : outils du module BPM ; `kit` : contexte commun des lectures (reads.mjs). */
export function createOutlookReads(socle, h, kit) {
  const { om, metrics } = socle;
  const { budget, base, contextOf, decorate, summary } = kit;

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
    // Les échéances non réglées des périodes closes (douze derniers mois) restent visibles, à part :
    // elles ne comptent pas dans le solde net à traiter, qui ne porte que sur les périodes ouvertes.
    const open = b.cs ? b.cs.firstOpen.start : addDays(now, -366);
    const from = open < addDays(now, -366) ? open : addDays(now, -366);
    const lines = budget()
      .budgetLines(b.state, b.budgets.map((x) => x.id), { from: from < addDays(now, -730) ? addDays(now, -730) : from, to: now, by: 'planned' })
      .filter((l) => !l.settled)
      .map((l) => decorate(b, l));
    const pending = lines.filter((l) => l.status !== 'unrealized');
    const unrealized = lines.filter((l) => l.status === 'unrealized');
    return {
      context: contextOf(b, 'consolidated'),
      lines,
      totalCents: sum(pending, (l) => sign(l.direction) * l.plannedCents),
      unrealizedCount: unrealized.length,
      unrealizedNetCents: sum(unrealized, (l) => sign(l.direction) * l.plannedCents),
    };
  }

  const visionOf = (comp) => ({ ...socle.modules.patrimoine.projectionSettingsOf(socle.state, comp.patrimoineId), ...socle.modules.budget.objectivesOf(socle.state, comp.budgetId) });
  const goalsOf = (state, userId) => socle.modules.patrimoine.goalsOf(state, userId);
  function events(ctx) {
    const b = base(ctx);
    const v = visionOf(b.comp);
    const now = today();
    return {
      context: contextOf(b),
      assumptions: [`Inflation ${v.inflationPct} % par an (${v.inflationSource})`, 'Provision = coût futur ÷ périodes mensuelles restantes'],
      rows: socle.modules.patrimoine.goalProvisions(goalsOf(b.state, b.userId), v.inflationPct, now),
    };
  }

  function surplusProgress(b, v) {
    if (!v.surplus) return null;
    return socle.modules.budget.surplusProgress(h.closuresOf(b.state, b.cycle?.id), v.surplus);
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

  function savingsProjection(b, v, { horizonYears, ratePct, inflationPct }) {
    const last = h.closuresOf(b.state, b.cycle?.id).at(-1);
    const patrimoine = b.state.patrimoines[b.comp.patrimoineId];
    const startDate = last?.periodEnd ?? patrimoine.openingDate ?? today();
    let startCents = patrimoine.openingStockCents ?? null;
    if (last) {
      const accounting = h.metricContext(b.state, b.userId, { periodKey: last.periodKey });
      startCents = last.bilan?.patrimoine?.stockAfterCents ??
        cents(metrics.evaluate({ ...accounting, asOf: startDate }, 'bpm.patrimoineDisponible').value);
    }
    const anchor = b.cycle?.anchorDay ?? 1;
    const startingPeriod = periodContaining(startDate, anchor);
    const first = Math.max(startingPeriod.index, b.cs?.first.index ?? startingPeriod.index);
    const checkpoints = [startDate];
    for (let year = 1; year <= horizonYears; year++) {
      const ymd = `${Number(startDate.slice(0, 4)) + year}${startDate.slice(4)}`;
      checkpoints.push(last ? periodByIndex(startingPeriod.index + 12 * year, anchor).end
        : isCalendarDate(ymd) ? ymd : ymd.slice(0, -2) + '28');
    }
    const cycleEnds = [];
    for (let index = first; ; index++) {
      const { end } = periodByIndex(index, anchor);
      if (end > checkpoints.at(-1)) break;
      if (end > startDate) cycleEnds.push(end);
    }
    return {
      basis: 'savings-goal', horizonYears, ratePct: ratePct ?? 0, inflationPct, inflationSource: v.inflationSource,
      contributionCents: v.savingsTargetCents, contributionSource: 'Objectif d’épargne', cadence: 'monthly', perYear: 12,
      startCents, startDate, startPeriodKey: last?.periodKey ?? null,
      stockReason: startCents === null ? 'Patrimoine de départ à renseigner.' : null,
      timeline: { startDate, cycleEnds, checkpoints },
    };
  }

  function hypotheses(b, q = {}) {
    const v = visionOf(b.comp);
    const horizon = Number(q.horizon);
    const horizonYears = q.horizon !== undefined && q.horizon !== '' && Number.isFinite(horizon)
      ? Math.min(Math.max(Math.round(horizon), 1), 80) : v.horizonYears;
    const ratePct = q.rate !== undefined && q.rate !== '' ? percent('rate', q.rate, { min: -50, max: 50 }) : v.annualReturnPct;
    const inflationPct = q.inflation !== undefined && q.inflation !== '' ? percent('inflation', q.inflation, { min: -20, max: 50 }) : v.inflationPct;
    if (q.basis === 'savings-goal') return savingsProjection(b, v, { horizonYears, ratePct, inflationPct });
    const stock = metrics.evaluate(h.metricContext(b.state, b.userId, {}), 'bpm.patrimoineDisponible');
    let contributionCents = v.contributionCents;
    let contributionSource = 'Apport saisi';
    let cadence = v.contributionCadence ?? 'monthly';
    if (q.contribution !== undefined && q.contribution !== '') {
      contributionCents = queryMoney('contribution', q.contribution, { signed: true });
      contributionSource = 'Apport de la simulation';
    } else if (contributionCents === null) {
      const bt = budgetType({ userId: b.userId });
      contributionCents = bt.empty ? 0 : bt.averageNetCents;
      contributionSource = bt.empty ? 'Aucun apport : budget type vide' : 'Moyenne mensuelle du budget type';
      cadence = 'monthly';
    }
    return { horizonYears, ratePct, inflationPct, inflationSource: v.inflationSource, contributionCents, contributionSource, cadence, perYear: PER_YEAR[cadence], startCents: cents(stock.value), stockReason: stock.unavailableReason ?? null };
  }

  function projection(ctx, q = {}) {
    const b = base(ctx);
    const { timeline, ...hy } = hypotheses(b, q);
    const goals = goalsOf(b.state, b.userId).map((g) => ({ id: g.id, label: g.label, type: g.type, date: g.date, targetTodayCents: g.targetTodayCents }));
    const startYear = Number((hy.startDate ?? today()).slice(0, 4));
    if (hy.contributionCents === null || hy.ratePct === null) {
      const reason = hy.contributionCents === null ? 'Fixez votre objectif d’épargne par cycle pour calculer la projection.' : 'Rendement annuel à renseigner (Objectifs et avenir › Hypothèses).';
      return { context: contextOf(b), hypotheses: hy, status: 'missing-hypothesis', reason, rows: [], goals: [] };
    }
    const extraCents = q.extra !== undefined && q.extra !== '' ? queryMoney('extra', q.extra, { signed: true }) : 0;
    const run = (contribution) => socle.modules.patrimoine.project({ startCents: hy.startCents, startYear, horizonYears: hy.horizonYears, ratePct: hy.ratePct, inflationPct: hy.inflationPct, contributionCents: contribution, perYear: hy.perYear, goals, timeline });
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
      const alt = timeline ? run(avg) : socle.modules.patrimoine.project({ startCents: hy.startCents, startYear, horizonYears: hy.horizonYears, ratePct: hy.ratePct, inflationPct: hy.inflationPct, contributionCents: avg, perYear: 12, goals });
      out.comparison = { label: 'Apport fondé sur la moyenne réelle des clôtures', contributionCents: avg, closures: closures.length, rows: alt.rows, keyFigures: alt.keyFigures };
    } else {
      out.comparison = { label: 'Comparaison indisponible', reason: 'Au moins deux clôtures sont nécessaires.' };
    }
    return out;
  }

  // ---------- aperçu d'une saisie (aucune mutation) ----------

  /** Même constructeur Budget que l'écriture, sur une copie de l'état, puis mêmes métriques que la synthèse (audit ARCH-01). */
  function previewEntry(ctx, input = {}) {
    let b = base(ctx);
    const cadence = oneOf('cadence', input.cadence, ['once', ...CADENCES], 'once');
    const entry = { ...input, label: input.label || 'Aperçu', budgetId: input.budgetId || b.comp.budgetId };
    const { draft } = om.simulate('previewEntry', ctx, entry, (tx) => (cadence === 'once' ? budget().buildOperation(tx, entry) : budget().buildRecurrence(tx, entry)));
    const project = b.state.budgets[entry.budgetId];
    const source = project?.role === 'standard' ? projectFundingSource(entry, project) : 'cycle';
    const accountingDate = input.accountingDate || input.realizedDate || input.date || input.firstDate;
    // Une validation d'octobre doit montrer octobre, même si le formulaire est ouvert en novembre.
    if (cadence === 'once' && source === 'cycle' && b.cycle?.state === 'active' && accountingDate && accountingDate <= today()) {
      const target = periodContaining(accountingDate, b.cycle.anchorDay);
      if (b.cs.find(target.key)) b = base(ctx, { periodKey: target.key });
    }
    if (!b.period && source !== 'patrimoine') fail('FORBIDDEN_BY_RULE', 'Cycle à configurer : aucune période pour l’aperçu.');
    const keys = ['bpm.soldeAttendu', RESULT, 'bpm.patrimoineDisponible'];
    const read = (state) => {
      const { figures } = h.figuresFor(state, b.userId, keys, { periodKey: b.period?.key });
      const [expectedCents, netCents, stock] = keys.map((k) => cents(figures[k].value));
      return { netCents, expectedCents, stockCents: stock, stockEstimateCents: stock === null || expectedCents === null ? null : stock + expectedCents };
    };
    const before = read(b.state);
    return {
      context: contextOf(b),
      mutation: false,
      source,
      accountingDate,
      before,
      after: read(draft),
      note: before.stockEstimateCents === null && before.expectedCents !== null ? 'Stock à renseigner : estimation du Patrimoine non calculable.' : null,
    };
  }

  return { history, impact, budgetType, due, visionOf, goalsOf, events, surplusProgress, directives, projection, previewEntry };
}
