// Gestion du projet de vie : lecture de pilotage du projet unique du user, celui qui englobe tous les autres.
// Six volets : le cycle en cours (budget de la période cyclique), les charges indispensables, les charges
// courantes (la vie de tous les jours, hors projet précis), les projets de la vie financés, les résultats des
// cycles et l'objectif d'excédent, le patrimoine qui s'accumule.
// Lecture seule. Chaque montant vient des métriques administrées (mêmes chiffres que le tableau de bord) ou des
// lignes du registre (`budgetLines`) : Σ dépensé des natures + charges des projets = « Dépensé » (`bpm.charges`),
// Σ « à payer » des natures = « À payer » (`bpm.resteAPayer`).
// L'usage de l'excédent capitalisé (placements, affectations) n'est pas géré ici : il relève d'un module à venir.
import { monthlyAverageCents } from '../budget/recurrence.mjs';
import { centerRefOf, essentialRefsOf, ESSENTIALS_PARAMETER, NATURE_LABEL, natureOf } from './natures.mjs';
import { addDays, today } from './periods.mjs';

const RESULT = 'bpm.resultatPeriode';
const KEYS = [
  'bpm.revenus', 'bpm.charges', 'bpm.chargesProjets', RESULT, 'bpm.resteARecevoir', 'bpm.resteAPayer', 'bpm.soldeAttendu', 'bpm.resultatPrevu',
  'bpm.tauxEpargne', 'bpm.consommationCharges', 'bpm.patrimoineConstitue', 'bpm.patrimoineFinPeriode', 'bpm.progressionObjectif', 'bpm.resteObjectif',
];
const OPEN = ['late', 'due', 'pending'];
export const HEALTH_LABEL = { ok: 'En règle', watch: 'À surveiller', alert: 'À traiter', unknown: 'À renseigner' };
/** Une marge de plafond sous ce seuil (part du plafond) met le volet « à surveiller » [P]. */
const NEAR_CAP_PCT = 10;
export const SURPLUS_USE_NOTE = 'L’usage de l’excédent capitalisé (placements, affectations) relève d’un module à venir : cette page constate ce qui s’accumule et pilote ce qui l’alimente.';

const cents = (v) => (v === null || v === undefined ? null : Math.round(v * 100));
const sum = (xs, f) => xs.reduce((s, x) => s + (f(x) ?? 0), 0);
const days = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const pct = (part, whole) => (whole > 0 && part !== null ? Math.round((part / whole) * 1000) / 10 : null);
const pad = (n) => String(n).padStart(2, '0');
const addMonthsKey = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`;
};
const health = (state, alert = null) => ({ health: state, healthLabel: HEALTH_LABEL[state], alert });

/** Ligne réduite pour l'affichage (le détail complet se lit par `/api/bpm/lines/:id`). */
const lineOf = (l, essentials) => ({
  id: l.id,
  label: l.label,
  direction: l.direction,
  nature: natureOf(l, essentials),
  plannedDate: l.plannedDate,
  plannedCents: l.plannedCents,
  realizedDate: l.realizedDate ?? null,
  realizedCents: l.realizedCents ?? null,
  settled: !!l.settled,
  status: l.status,
  statusLabel: l.statusLabel,
  costCenterRef: centerRefOf(l),
  costCenterLabel: l.costCenterLabel ?? null,
  cadenceLabel: l.cadenceLabel ?? null,
});

/**
 * @param h       helpers du module BPM : figuresFor, closuresOf, closingOf
 * @param reads   lectures communes (`reads.mjs`) : base, contextOf, decorate, budgetType, directives, visionOf, surplusProgress
 * @param projects lectures des projets de la vie (`projects.mjs`) : overview
 */
export function createLife(socle, h, reads, projects) {
  const budget = () => socle.modules.budget;

  /**
   * @param periodKey période lue (AAAA-MM) ; absente = période courante. Les volets suivent la période lue ;
   *   les commandes du jour (échéances à régler, clôtures, décisions, facturation) restent celles d'aujourd'hui.
   */
  function lifeManagement(ctx, { periodKey } = {}) {
    const b = reads.base(ctx, { periodKey });
    const { state, userId, comp, cycle, cs, period } = b;
    const now = today();
    const isCurrent = !!period && !!cs && period.key === cs.current.key;
    // Échéances ouvertes qui concernent la période lue : la période courante reprend aussi les retards
    // des périodes non closes qui la précèdent ; une autre période ne lit que ses propres dates.
    const inReading = (l) => !!period && l.plannedDate <= period.end && (isCurrent || l.plannedDate >= period.start);
    const essentials = essentialRefsOf(socle, state);
    const { figures } = h.figuresFor(state, userId, KEYS, { periodKey: period?.key });
    const f = (k) => cents(figures[k]?.value);
    const core = state.coreProjects[comp.coreProjectId];
    const pat = state.patrimoines[comp.patrimoineId];
    const v = reads.visionOf(comp);
    const closures = h.closuresOf(state, cycle?.id);

    // ---------- lignes du budget de vie ----------
    const lifeLines = (from, to, by) => budget().budgetLines(state, [comp.budgetId], { from, to, by });
    const planned = period ? lifeLines(period.start, period.end, 'planned').map((l) => reads.decorate(b, l)) : [];
    const realized = period ? lifeLines(period.start, period.end, 'realized') : [];
    // Échéances ouvertes : en retard depuis la première période non close, et celles des 7 prochains jours.
    const openFrom = cs ? (cs.firstOpen.start < now ? cs.firstOpen.start : now) : now;
    const open = lifeLines(openFrom, addDays(now, 7), 'planned')
      .filter((l) => !l.settled)
      .map((l) => reads.decorate(b, l))
      .filter((l) => OPEN.includes(l.status))
      .sort((x, y) => x.plannedDate.localeCompare(y.plannedDate) || x.label.localeCompare(y.label));

    // ---------- volet 1 : cycle en cours ----------
    const expected = f('bpm.soldeAttendu');
    const initial = f('bpm.resultatPrevu');
    const incomes = planned.filter((l) => l.direction === 'income');
    const lateIncome = open.filter((l) => inReading(l) && l.direction === 'income' && l.status === 'late');
    const closure = period ? closures.find((c) => c.periodKey === period.key) ?? null : null;
    const toCloseCount = cs ? Math.max(0, cs.current.index - cs.firstOpen.index) : 0;
    const total = period ? days(period.start, period.end) + 1 : null;
    const elapsed = period ? Math.min(Math.max(days(period.start, now) + 1, 0), total) : null;
    const cycleBlock = {
      key: 'cycle',
      label: !period || isCurrent ? 'Cycle en cours' : closure ? 'Cycle clôturé' : period.status === 'ended' ? 'Cycle terminé' : 'Cycle consulté',
      reading: !period ? null : isCurrent ? 'current' : closure ? 'closed' : 'ended',
      closedResultCents: closure?.resultCents ?? null,
      status: cs ? 'active' : 'to_configure',
      anchorDay: cycle?.anchorDay ?? null,
      startDate: cycle?.startDate ?? null,
      period: period ? { key: period.key, label: period.label, start: period.start, end: period.end, status: period.status } : null,
      days: period ? { total, elapsed, left: total - elapsed, elapsedPct: pct(elapsed, total) } : null,
      closedCount: closures.length,
      toCloseCount,
      flows: period
        ? {
            receivedCents: f('bpm.revenus'),
            toReceiveCents: f('bpm.resteARecevoir'),
            paidCents: f('bpm.charges'),
            toPayCents: f('bpm.resteAPayer'),
            netCents: f(RESULT),
            expectedCents: expected,
            initialBudgetCents: initial,
            gapToInitialCents: expected === null || initial === null ? null : expected - initial,
            savingsRatePct: figures['bpm.tauxEpargne']?.value ?? null,
            consumptionPct: figures['bpm.consommationCharges']?.value ?? null,
            projectsPaidCents: f('bpm.chargesProjets'),
            incomeCount: incomes.length,
            receivedCount: incomes.filter((l) => l.settled).length,
            lateIncomeCents: sum(lateIncome, (l) => l.plannedCents),
            lateIncomeCount: lateIncome.length,
            nextIncome: (() => {
              const n = incomes.filter((l) => ['due', 'pending'].includes(l.status)).sort((x, y) => x.plannedDate.localeCompare(y.plannedDate))[0];
              return n ? lineOf(n, essentials) : null;
            })(),
            incomeLines: incomes.map((l) => lineOf(l, essentials)),
          }
        : null,
    };
    Object.assign(
      cycleBlock,
      !cs
        ? health('unknown', 'Cycle à configurer : renseignez le jour d’ancrage pour suivre la période.')
        : closure
          ? closure.resultCents < 0
            ? health('watch', 'Cycle clôturé avec un résultat négatif : il a réduit le patrimoine.')
            : health('ok')
          : expected !== null && expected < 0
          ? health('alert', 'Le solde prévu à la clôture est négatif : les charges prévues dépassent les entrées du cycle.')
          : lateIncome.length
            ? health('watch', `${lateIncome.length} entrée(s) attendue(s) en retard.`)
            : !isCurrent && period.status === 'ended'
              ? health('watch', 'Période terminée, pas encore clôturée : son résultat n’est pas encore capitalisé.')
              : expected !== null && initial !== null && expected < initial
                ? health('watch', 'Le solde prévu est en dessous du budget initial du cycle.')
                : health('ok'),
    );

    // ---------- volets 2 et 3 : charges indispensables et courantes ----------
    const chargeCenters = budget().costCentersOf(state, userId).filter((c) => c.direction === 'charge');
    const caps = state.budgets[comp.budgetId].capsCents ?? {};
    const bt = reads.budgetType(ctx);
    const directives = Object.fromEntries(reads.directives(ctx).items.map((i) => [i.key, i]));
    const totalPaid = f('bpm.charges');

    function natureBlock(n) {
      const isN = (l) => l.direction === 'charge' && natureOf(l, essentials) === n;
      const centers = chargeCenters.filter((c) => essentials.has(c.ref) === (n === 'indispensable'));
      const paidLines = realized.filter(isN);
      const plannedLines = planned.filter(isN);
      const openLines = plannedLines.filter((l) => OPEN.includes(l.status));
      const late = open.filter((l) => inReading(l) && isN(l) && l.status === 'late');
      const due = open.filter((l) => inReading(l) && isN(l) && l.status === 'due');
      const refs = [...new Set([...centers.map((c) => c.ref), ...paidLines.map(centerRefOf), ...plannedLines.map(centerRefOf)])];
      const rows = refs
        .map((ref) => {
          const c = chargeCenters.find((x) => x.ref === ref);
          const of = (ls) => ls.filter((l) => centerRefOf(l) === ref);
          const paidCents = sum(of(paidLines), (l) => l.realizedCents);
          const toPayCents = sum(of(openLines), (l) => l.plannedCents);
          const capCents = caps[ref] ?? null;
          return {
            ref,
            label: c?.label ?? `${ref.replace(/^std:/, '')} (retiré)`,
            paidCents,
            toPayCents,
            plannedCents: sum(of(plannedLines), (l) => l.plannedCents),
            capCents,
            marginCents: capCents === null ? null : capCents - paidCents - toPayCents,
            over: capCents !== null && paidCents + toPayCents > capCents,
            lateCount: of(late).length,
            lineCount: of(plannedLines).length,
          };
        })
        .filter((r) => r.paidCents || r.toPayCents || r.plannedCents || r.capCents !== null);
      const capped = rows.filter((r) => r.capCents !== null);
      const capCents = capped.length ? sum(capped, (r) => r.capCents) : null;
      const marginCents = capped.length ? sum(capped, (r) => r.marginCents) : null;
      const overCount = capped.filter((r) => r.over).length;
      const nearCap = capped.some((r) => !r.over && r.capCents > 0 && (r.marginCents / r.capCents) * 100 < NEAR_CAP_PCT);
      const paidCents = sum(paidLines, (l) => l.realizedCents);
      const plannedCents = sum(plannedLines, (l) => l.plannedCents);
      const next = openLines.filter((l) => ['due', 'pending'].includes(l.status)).sort((x, y) => x.plannedDate.localeCompare(y.plannedDate))[0] ?? null;
      const block = {
        key: n,
        label: NATURE_LABEL[n],
        centers: centers.map((c) => ({ ref: c.ref, label: c.label })),
        paidCents,
        toPayCents: sum(openLines, (l) => l.plannedCents),
        plannedCents,
        consumedPct: pct(paidCents, plannedCents),
        shareOfPaidPct: pct(paidCents, totalPaid),
        lateCents: sum(late, (l) => l.plannedCents),
        lateCount: late.length,
        dueTodayCount: due.length,
        settledCount: plannedLines.filter((l) => l.settled).length,
        lineCount: plannedLines.length,
        capCents,
        marginCents,
        overCount,
        monthlyAverageCents: sum(bt.lines.filter((r) => r.direction === 'charge' && essentials.has(r.costCenterRef) === (n === 'indispensable')), (r) => monthlyAverageCents(r.amountCents, r.cadence)),
        next: next ? lineOf(next, essentials) : null,
        rows,
        lines: plannedLines.map((l) => lineOf(l, essentials)),
      };
      if (!period) return { ...block, ...health('unknown', 'Cycle à configurer : aucune période à lire.') };
      if (n === 'indispensable') {
        return {
          ...block,
          ...(late.length
            ? health('alert', `${late.length} charge(s) indispensable(s) en retard de paiement.`)
            : overCount
              ? health('alert', `${overCount} poste(s) indispensable(s) au-delà de leur plafond.`)
              : due.length || nearCap
                ? health('watch', due.length ? `${due.length} charge(s) indispensable(s) à régler aujourd’hui.` : 'Un poste indispensable approche de son plafond.')
                : !plannedLines.length && !paidCents
                  ? health('unknown', 'Aucune charge indispensable prévue : complétez le budget type (loyer, courses, transport…).')
                  : health('ok')),
        };
      }
      // Charges courantes : ce qui reste pour profiter de la vie de tous les jours, une fois l'essentiel assuré.
      // Repère du cycle en cours seulement : une période passée n'a plus de disponible à dépenser.
      const available = isCurrent ? directives.available ?? null : { valueCents: null, reason: 'Repère calculé pour le cycle en cours uniquement.' };
      return {
        ...block,
        availableCents: available?.valueCents ?? null,
        availableReason: available?.reason ?? null,
        weeklyCents: isCurrent ? directives.weekly?.valueCents ?? null : null,
        ...(overCount
          ? health('alert', `${overCount} poste(s) courant(s) au-delà de leur plafond.`)
          : late.length
            ? health('watch', `${late.length} charge(s) courante(s) en retard.`)
            : available?.valueCents !== null && available?.valueCents !== undefined && available.valueCents < 0
              ? health('watch', 'Le disponible du cycle est négatif après l’épargne visée : réduire les dépenses courantes.')
              : nearCap
                ? health('watch', 'Un poste courant approche de son plafond.')
                : health('ok')),
      };
    }

    const indispensable = natureBlock('indispensable');
    const courante = natureBlock('courante');

    // ---------- volet 4 : projets de la vie financés ----------
    const ov = projects.overview(ctx);
    const list = ov.projects.map((p) => ({
      budgetId: p.budget.budgetId,
      coreProjectId: p.budget.coreProjectId,
      name: p.project?.title ?? p.budget.name,
      status: p.view?.status ?? null,
      statusLabel: p.view?.statusLabel ?? null,
      regime: p.budget.regime,
      allocationCents: p.budget.allocationCents,
      paidCents: p.budget.paidCents,
      remainingCents: p.budget.remainingCents,
      periodPaidCents: p.budget.periodPaidCents,
      state: p.budget.state,
      pendingOverrun: !!p.budget.pendingOverrun,
    }));
    const life = ov.life;
    const unfundedCount = list.filter((p) => !p.regime).length;
    const projectsBlock = {
      key: 'projets',
      label: 'Projets financés',
      projectCount: life.projectCount,
      fundedCount: life.fundedCount,
      unfundedCount,
      allocatedCents: life.allocatedCents,
      paidCents: life.paidCents,
      remainingCents: life.remainingCents,
      availableCents: life.availableCents,
      approvedOverrunCents: life.approvedOverrunCents,
      periodPaidCents: period ? f('bpm.chargesProjets') : null,
      pendingRequests: life.pendingRequests,
      taskRequestCount: life.taskRequests.length,
      billable: life.billable,
      billableCents: life.billableCents,
      nextBillingDate: life.nextBillingDate,
      deficitCount: life.deficitCount,
      projects: list,
      // Financement des projets fils cycle par cycle, lu dans l'interface commune (variante non standard du budget).
      funding: ov.lifeProject.budget?.life?.funding ?? null,
      ...(life.pendingRequests.length || life.taskRequests.length
        ? health('alert', `${life.pendingRequests.length + life.taskRequests.length} décision(s) du budget de vie attendue(s).`)
        : life.billable.length
          ? health('watch', `${life.billable.length} dépassement(s) autorisé(s) à facturer.`)
          : life.deficitCount
            ? health('watch', `${life.deficitCount} projet(s) en déficit autorisé.`)
            : unfundedCount
              ? health('watch', `${unfundedCount} projet(s) sans budget attribué.`)
              : health('ok')),
    };

    // ---------- volet 5 : résultats des cycles et objectif d'excédent ----------
    const surplus = reads.surplusProgress(b, v);
    const targetOf = (key) => (surplus && key >= surplus.startKey ? surplus.perPeriodCents : v.savingsTargetCents ?? null);
    const rows = closures
      .map((c) => {
        const target = targetOf(c.periodKey);
        return { closureId: c.id, periodKey: c.periodKey, periodLabel: c.periodLabel ?? c.periodKey, periodStart: c.periodStart, periodEnd: c.periodEnd, resultCents: c.resultCents, closedAt: c.createdAt, targetCents: target, meetsTarget: target === null ? null : c.resultCents >= target };
      })
      .reverse();
    const results = rows.map((r) => r.resultCents);
    const best = rows.length ? rows.reduce((a, r) => (r.resultCents > a.resultCents ? r : a)) : null;
    const worst = rows.length ? rows.reduce((a, r) => (r.resultCents < a.resultCents ? r : a)) : null;
    const plan = surplus
      ? (() => {
          const targetToDate = surplus.perPeriodCents * surplus.closedPeriods;
          const remainingPeriods = Math.max(surplus.periods - surplus.closedPeriods, 0);
          const remainingCents = Math.max(surplus.targetCents - surplus.cumulatedCents, 0);
          return {
            ...surplus,
            endKey: addMonthsKey(surplus.startKey, surplus.periods - 1),
            targetToDateCents: targetToDate,
            gapCents: surplus.cumulatedCents - targetToDate,
            onTrack: surplus.cumulatedCents >= targetToDate,
            remainingPeriods,
            remainingCents,
            requiredPerPeriodCents: remainingPeriods > 0 ? Math.ceil(remainingCents / remainingPeriods) : null,
            reached: surplus.cumulatedCents >= surplus.targetCents,
          };
        })()
      : null;
    const currentTarget = period ? targetOf(period.key) : null;
    const closing = cs && cs.firstOpen.status === 'ended' ? h.closingOf(state, userId, cs.firstOpen, cs) : null;
    const last = rows[0] ?? null;
    const resultsBlock = {
      key: 'resultats',
      label: 'Résultats des cycles',
      rows,
      count: rows.length,
      positiveCount: results.filter((x) => x > 0).length,
      negativeCount: results.filter((x) => x < 0).length,
      zeroCount: results.filter((x) => x === 0).length,
      metCount: rows.filter((r) => r.meetsTarget).length,
      totalCents: sum(results, (x) => x),
      averageCents: rows.length ? Math.round(sum(results, (x) => x) / rows.length) : null,
      best,
      worst,
      last,
      savingsTargetCents: v.savingsTargetCents,
      surplus: plan,
      current: period ? { periodKey: period.key, expectedCents: expected, targetCents: currentTarget, meetsTarget: currentTarget === null || expected === null ? null : expected >= currentTarget } : null,
      toCloseCount,
      firstOpen: cs ? { key: cs.firstOpen.key, label: cs.firstOpen.label, start: cs.firstOpen.start, end: cs.firstOpen.end, status: cs.firstOpen.status } : null,
      closing,
      surplusUseNote: SURPLUS_USE_NOTE,
      ...(toCloseCount
        ? health('alert', `${toCloseCount} période(s) terminée(s) à clôturer : leur résultat n’est pas encore capitalisé.`)
        : plan && !plan.onTrack
          ? health('watch', 'L’excédent cumulé est en retard sur l’objectif à date.')
          : last && last.resultCents < 0
            ? health('watch', 'Le dernier cycle clôturé est négatif.')
            : !plan && v.savingsTargetCents === null
              ? health('unknown', 'Aucun objectif d’excédent ni épargne visée : fixez-en un dans la vision.')
              : health('ok')),
    };

    // ---------- volet 6 : patrimoine du projet de vie ----------
    const stock = f('bpm.patrimoineConstitue');
    const after = f('bpm.patrimoineFinPeriode');
    const effect = period ? f(RESULT) : null;
    const patrimoineBlock = {
      key: 'patrimoine',
      label: 'Patrimoine accumulé',
      patrimoineId: pat.id,
      stockCents: stock,
      stockReason: figures['bpm.patrimoineConstitue']?.unavailableReason ?? null,
      effectCents: effect,
      afterCents: after,
      expectedAfterCents: stock === null || expected === null ? null : stock + expected,
      objectiveCents: pat.objectiveCents ?? null,
      progressPct: figures['bpm.progressionObjectif']?.value ?? null,
      remainingCents: pat.objectiveCents === null || pat.objectiveCents === undefined ? null : f('bpm.resteObjectif'),
      openingStockCents: pat.openingStockCents ?? null,
      openingDate: pat.openingDate ?? null,
      capitalizedCents: sum(closures, (c) => c.resultCents),
      capitalizationCount: closures.length,
      surplusUseNote: SURPLUS_USE_NOTE,
      ...(stock === null
        ? health('unknown', 'Stock d’ouverture à renseigner pour suivre le patrimoine.')
        : stock < 0
          ? health('alert', 'Le stock enregistré est négatif.')
          : effect !== null && effect < 0
            ? health('watch', closure ? 'Ce cycle clôturé a fait baisser le patrimoine.' : 'Ce cycle fait baisser le patrimoine à ce jour.')
            : pat.objectiveCents === null || pat.objectiveCents === undefined
              ? health('watch', 'Aucun objectif de stock : fixez-en un pour mesurer l’accumulation.')
              : health('ok')),
    };

    const volets = [cycleBlock, indispensable, courante, projectsBlock, resultsBlock, patrimoineBlock];
    const counts = { ok: 0, watch: 0, alert: 0, unknown: 0 };
    for (const x of volets) counts[x.health] += 1;

    return {
      context: reads.contextOf(b),
      lifeProject: {
        coreProjectId: comp.coreProjectId,
        title: core?.title ?? 'Projet de vie',
        description: core?.description ?? null,
        budgetId: comp.budgetId,
        patrimoineId: comp.patrimoineId,
        compositionId: comp.id,
      },
      pilot: { volets: volets.map((x) => ({ key: x.key ?? null, label: x.label, health: x.health, healthLabel: x.healthLabel, alert: x.alert })), counts },
      cycle: cycleBlock,
      natures: { indispensable, courante },
      projects: projectsBlock,
      results: resultsBlock,
      patrimoine: patrimoineBlock,
      budgetType: {
        empty: bt.empty,
        averageIncomeCents: bt.averageIncomeCents,
        averageChargeCents: bt.averageChargeCents,
        averageNetCents: bt.averageNetCents,
        byNature: { indispensable: indispensable.monthlyAverageCents, courante: courante.monthlyAverageCents },
      },
      directives: {
        savingsCents: directives.savings?.valueCents ?? null,
        provisionsCents: directives.provisions?.valueCents ?? null,
        availableCents: directives.available?.valueCents ?? null,
        weeklyCents: directives.weekly?.valueCents ?? null,
      },
      dueSoon: { from: openFrom, to: addDays(now, 7), lines: open.map((l) => lineOf(l, essentials)), lateCount: open.filter((l) => l.status === 'late').length },
      essentials: { parameter: ESSENTIALS_PARAMETER, refs: [...essentials], labels: chargeCenters.filter((c) => essentials.has(c.ref)).map((c) => c.label) },
    };
  }

  return { lifeManagement };
}
