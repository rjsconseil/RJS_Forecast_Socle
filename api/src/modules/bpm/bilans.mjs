// Bilans des cycles budgétaires (docs/LORE-BPM.md) : pour chaque période du cycle, tous les faits
// (entrées, dépenses par nature, résultat, patrimoine avant et après, projets de la vie, postes,
// plafonds, échéances, décisions) et les faits marquants qui s'en dégagent.
// - À la clôture, le bilan est ENREGISTRÉ dans la clôture : il ne change plus ensuite (source « enregistré »).
// - Une période close avant les bilans est recalculée avec les données actuelles (source « recalculé »).
// - La période en cours ou terminée non close est un bilan provisoire (source « provisoire »).
// Les dépenses des projets de la vie comptent dans le cycle où elles sont réglées : chaque bilan dit ce
// que chaque projet a coûté au cycle, donc au patrimoine qui reçoit son résultat.
// Aucune lecture n'écrit ; aucun montant n'est recalculé avec une autre formule que celles du registre.
import { fail } from '../../socle/errors.mjs';
import { NATURES, NATURE_LABEL } from './natures.mjs';
import { cents, sum } from './format.mjs';

export const BILAN_VERSION = 1;
const RESULT = 'bpm.resultatPeriode';
const FIGURES = ['bpm.revenus', 'bpm.charges', 'bpm.chargesProjets', RESULT, 'bpm.tauxEpargne', 'bpm.resultatPrevu', 'bpm.patrimoineConstitue'];
const MAX_PERIODS = 36;

const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : null);
const eur = (c) => (c === null || c === undefined ? 'inconnu' : (c / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }));
const signed = (c) => (c > 0 ? '+' : c < 0 ? '−' : '') + eur(Math.abs(c ?? 0));
const num = (v) => Number(v).toLocaleString('fr-FR');
const within = (d, p) => !!d && d >= p.start && d <= p.end;

/**
 * @param socle socle complet
 * @param h     outils du module BPM : requireComposition, cycleState, figuresFor, closuresOf
 * @param reads lectures communes (registre, plafonds, lignes des projets)
 */
export function createBilans(socle, h, reads) {
  /** Tous les faits d'une période, lus avec les mêmes règles que le registre et les chiffres administrés. */
  function build(ctx, period) {
    const state = socle.stateOf(ctx);
    const { userId, comp, cycle } = h.requireComposition(state, ctx);
    const key = period.key;
    const register = reads.register(ctx, { period: key, dateBasis: 'realized', groupBy: 'none' });
    const realized = register.lines.filter((l) => !l.special);
    const planned = reads.register(ctx, { period: key, dateBasis: 'planned', groupBy: 'none' }).lines.filter((l) => !l.special);
    const { figures } = h.figuresFor(state, userId, FIGURES, { periodKey: key });
    const fig = (k) => cents(figures[k]?.value);
    const charges = realized.filter((l) => l.direction === 'charge' && l.settled);
    const spentCents = fig('bpm.charges');
    const receivedCents = fig('bpm.revenus');
    const resultCents = fig(RESULT);
    const closure = period.closureId ? state.closures[period.closureId] : null;

    // Dépenses par nature : indispensables, courantes, projets de la vie.
    const natures = NATURES.map((n) => {
      const ls = charges.filter((l) => l.nature === n);
      const paidCents = sum(ls, (l) => l.realizedCents);
      return { key: n, label: NATURE_LABEL[n], paidCents, count: ls.length, sharePct: pct(paidCents, spentCents) };
    });

    // Projets de la vie : ce que chacun a coûté au cycle, son enveloppe et son cumul depuis l'attribution.
    const b = reads.base(ctx, { periodKey: key });
    const toDate = reads.validatedProjectLines(b, { from: '0001-01-01', to: period.end, by: 'realized' });
    // Projets financés par le patrimoine : leurs dépenses sont prélevées sur le patrimoine, hors du cycle.
    const drawn = reads.patrimoineProjectLines(b, { from: period.start, to: period.end, by: 'realized' }).filter((l) => l.settled);
    const drawnToDate = reads.patrimoineProjectLines(b, { from: '0001-01-01', to: period.end, by: 'realized' }).filter((l) => l.settled);
    const standards = Object.values(state.budgets).filter((x) => x.userId === userId && x.role === 'standard');
    const projects = standards
      .flatMap(pb => ['cycle', 'patrimoine'].map(source => {
        const ls = (source === 'patrimoine' ? drawn : realized.filter(l => l.projectCharge)).filter(l => l.budgetId === pb.id);
        const core = state.coreProjects[pb.coreProjectId];
        return {
          fundingSource: source,
          budgetId: pb.id,
          coreProjectId: pb.coreProjectId,
          name: core?.title ?? pb.name,
          paidCents: sum(ls, (l) => l.direction === 'income' ? -l.realizedCents : l.realizedCents),
          paymentCount: ls.length,
          allocationCents: Number.isInteger(pb.allocationCents) ? pb.allocationCents : null,
          allocationDate: pb.allocationDate ?? null,
          allocatedInPeriod: source === (pb.fundingSource ?? 'cycle') && within(pb.allocationDate, period),
          paidToDateCents: sum((source === 'patrimoine' ? drawnToDate : toDate).filter((l) => l.budgetId === pb.id), (l) => l.direction === 'income' ? -l.realizedCents : l.realizedCents),
        };
      }))
      .filter((p) => p.paidCents !== 0 || p.allocatedInPeriod)
      .sort((x, y) => y.paidCents - x.paidCents);
    // Retenu sur le résultat du cycle (projets du cycle) ; prélevé directement sur le patrimoine (projets hors cycle).
    const projectsCents = sum(projects.filter((p) => p.fundingSource === 'cycle'), (p) => p.paidCents);
    const withdrawnCents = sum(projects.filter((p) => p.fundingSource === 'patrimoine'), (p) => p.paidCents);

    // Postes : les cinq qui ont le plus dépensé (hors projets), puis les plafonds dépassés.
    const byCenter = new Map();
    for (const l of charges.filter((x) => !x.projectCharge)) {
      const k = l.costCenterRef ?? 'autre';
      const c = byCenter.get(k) ?? { ref: k, label: l.costCenterLabel ?? 'Poste à préciser', paidCents: 0 };
      c.paidCents += l.realizedCents;
      byCenter.set(k, c);
    }
    const centers = [...byCenter.values()].sort((x, y) => y.paidCents - x.paidCents).slice(0, 5);
    // Les dépenses des projets portent aussi un poste : elles comptent dans ses plafonds comme les autres.
    const byProjectCenter = new Map();
    for (const l of charges.filter((x) => x.projectCharge)) {
      const k = l.costCenterRef ?? 'autre';
      const c = byProjectCenter.get(k) ?? { ref: k, label: l.costCenterLabel ?? 'Poste à préciser', paidCents: 0, projects: [] };
      c.paidCents += l.realizedCents;
      if (l.budgetName && !c.projects.includes(l.budgetName)) c.projects.push(l.budgetName);
      byProjectCenter.set(k, c);
    }
    const projectCenters = [...byProjectCenter.values()].sort((x, y) => y.paidCents - x.paidCents);
    const caps = reads.capsReview(ctx, { period: key });
    // Postes en dépassement : dépenses payées au-delà du plafond du cycle (plafonds figés à la clôture pour un cycle clos).
    const over = caps.centers
      .filter((r) => r.paidOverCents > 0)
      .map((r) => ({ level: 'Poste', ref: r.ref, label: r.label, capCents: r.capCents, paidCents: r.paidCents, overCents: r.paidOverCents }))
      .sort((x, y) => y.overCents - x.overCents);

    // Échéances : ce qui n'a jamais été réglé (période close) ou reste ouvert (période en cours).
    const unrealized = planned.filter((l) => l.status === 'unrealized');
    const open = planned.filter((l) => ['late', 'due', 'pending'].includes(l.status));
    const biggest = charges.filter((l) => l.realizedCents > 0).sort((x, y) => y.realizedCents - x.realizedCents)[0] ?? null;

    // Décisions de financement prises pendant la période.
    const mine = new Set(standards.map((x) => x.id));
    const requests = Object.values(state.taskBudgetRequests ?? {}).filter((r) => mine.has(r.budgetId) && within(r.decidedAt, period));
    const overruns = Object.values(state.projectOverruns ?? {}).filter((o) => mine.has(o.budgetId));
    const decisions = {
      sharesGranted: requests.filter((r) => r.status === 'approved').length,
      sharesGrantedCents: sum(requests.filter((r) => r.status === 'approved'), (r) => r.grantedCents ?? r.amountCents),
      sharesRefused: requests.filter((r) => r.status === 'refused').length,
      overrunsApproved: overruns.filter((o) => ['approved', 'billed'].includes(o.status) && within(o.decidedAt, period)).length,
      overrunsApprovedCents: sum(overruns.filter((o) => ['approved', 'billed'].includes(o.status) && within(o.decidedAt, period)), (o) => o.amountCents),
      overrunsBilledCents: sum(overruns.filter((o) => o.status === 'billed' && within(o.billedAt, period)), (o) => o.amountCents),
    };

    // Patrimoine : stock avant la période, résultat versé (ou prévu), stock après, objectif.
    const pat = state.patrimoines[comp.patrimoineId];
    const stockBeforeCents = closure?.stockBeforeCents ?? fig('bpm.patrimoineConstitue');
    const capitalizedCents = closure ? closure.resultCents : null;
    const flowCents = closure ? closure.resultCents : resultCents;
    const stockAfterCents = stockBeforeCents === null || flowCents === null ? null : stockBeforeCents + flowCents - withdrawnCents;
    const objectiveCents = pat?.objectiveCents ?? null;
    const patrimoine = {
      stockBeforeCents,
      capitalizedCents,
      stockAfterCents,
      objectiveCents,
      progressBeforePct: objectiveCents ? pct(stockBeforeCents ?? 0, objectiveCents) : null,
      progressAfterPct: objectiveCents && stockAfterCents !== null ? pct(stockAfterCents, objectiveCents) : null,
      // Sans les projets de la vie du cycle, le résultat versé aurait été plus élevé de ce montant.
      projectsCents,
      // Dépenses des projets hors cycle, prélevées directement sur le patrimoine pendant la période.
      withdrawnCents,
    };
    const savingsTargetCents = socle.modules.budget.objectivesOf(state, comp.budgetId).savingsTargetCents ?? null;

    const facts = {
      version: BILAN_VERSION,
      period: { key, label: period.label, start: period.start, end: period.end },
      flows: {
        receivedCents,
        spentCents,
        resultCents,
        savingsRatePct: figures['bpm.tauxEpargne']?.value ?? null,
        plannedResultCents: fig('bpm.resultatPrevu'),
        savingsTargetCents,
        receivedCount: realized.filter((l) => l.direction === 'income' && l.settled).length,
        paidCount: charges.length,
      },
      natures,
      projects,
      // Notification bancaire sans incidence sur le résultat de cette période.
      paymentTrace: register.paymentTrace ?? [],
      announcementTrace: register.announcementTrace ?? [],
      centers,
      projectCenters,
      caps: { overCount: over.length, overCents: sum(over, (o) => o.overCents), over },
      deadlines: {
        unrealizedCount: unrealized.length,
        unrealizedCents: sum(unrealized, (l) => (l.direction === 'income' ? l.plannedCents : -l.plannedCents)),
        openCount: open.length,
        openCents: sum(open, (l) => (l.direction === 'income' ? l.plannedCents : -l.plannedCents)),
      },
      biggest: biggest ? { label: biggest.label, cents: biggest.realizedCents, date: biggest.realizedDate, project: biggest.projectCharge ? biggest.budgetName : null } : null,
      decisions,
      patrimoine,
    };
    const closed = h.closuresOf(state, cycle?.id);
    return { ...facts, highlights: highlightsOf(facts, { closed, closure, status: period.status }) };
  }

  /** Les faits marquants : ce qu'un regard rapide doit retenir du cycle, du plus important au moins important. */
  function highlightsOf(f, { closed, closure, status }) {
    const out = [];
    const add = (kind, tone, title, text) => out.push({ kind, tone, title, text });
    const r = closure ? closure.resultCents : f.flows.resultCents;
    const final = !!closure;
    if (r !== null) {
      if (r > 0) add('result', 'positive', final ? 'Cycle excédentaire' : 'Cycle excédentaire à ce jour', `${signed(r)} ${final ? 'versés' : 'à verser'} au patrimoine${f.flows.savingsRatePct !== null ? `, soit ${num(f.flows.savingsRatePct)} % des entrées conservées` : ''}.`);
      else if (r < 0) add('result', 'negative', final ? 'Cycle déficitaire' : 'Cycle déficitaire à ce jour', `${signed(r)} ${final ? 'retirés' : 'à retirer'} du patrimoine : les dépenses ont dépassé les entrées.`);
      else add('result', 'neutral', 'Cycle à l’équilibre', 'Les entrées ont couvert exactement les dépenses : le patrimoine ne bouge pas.');
    }
    const others = closed.filter((c) => !closure || c.id !== closure.id).map((c) => c.resultCents);
    if (final && others.length >= 2) {
      if (closure.resultCents > Math.max(...others)) add('record', 'positive', 'Meilleur résultat', `Le meilleur résultat de tous vos cycles clos (${others.length + 1}).`);
      if (closure.resultCents < Math.min(...others)) add('record', 'warning', 'Résultat le plus faible', `Le plus faible résultat de tous vos cycles clos (${others.length + 1}).`);
    }
    if (f.flows.savingsTargetCents && r !== null) {
      if (r >= f.flows.savingsTargetCents) add('savings', 'positive', 'Épargne visée atteinte', `${eur(r)} pour ${eur(f.flows.savingsTargetCents)} visés.`);
      else add('savings', 'warning', 'Épargne visée manquée', `Il a manqué ${eur(f.flows.savingsTargetCents - r)} pour atteindre les ${eur(f.flows.savingsTargetCents)} visés.`);
    }
    if (f.paymentTrace?.length) add('payment-trace', 'neutral', 'Paiements imputés à un autre cycle', f.paymentTrace.map(l => `${l.label} : ${eur(l.realizedCents)}, paiement le ${l.realizedDate}, imputation le ${l.accountingDate}`).join(' ; ') + '. Ces notifications ne sont pas comptées une seconde fois dans ce cycle.');
    const p = f.patrimoine;
    if (p.projectsCents > 0) {
      const top = f.projects[0];
      const share = f.natures.find((n) => n.key === 'projet')?.sharePct;
      add('projects', 'neutral', 'Ce que les projets ont coûté au cycle', `${eur(p.projectsCents)} réglés pour vos projets de la vie${share !== null && share !== undefined ? ` (${num(share)} % du dépensé)` : ''}${top ? `, dont ${eur(top.paidCents)} pour « ${top.name} »` : ''}. Sans eux, le patrimoine aurait reçu ${eur(p.projectsCents)} de plus.`);
    }
    if (p.withdrawnCents) {
      const top = f.projects.filter((x) => x.fundingSource === 'patrimoine').sort((x, y) => y.paidCents - x.paidCents)[0];
      add('withdrawal', 'neutral', 'Prélevé sur le patrimoine', `${eur(p.withdrawnCents)} réglés par vos projets hors cycle${top ? `, dont ${eur(top.paidCents)} pour « ${top.name} »` : ''} : ils ne touchent pas au résultat du cycle.`);
    }
    for (const x of f.projects.filter((x) => x.allocatedInPeriod)) add('allocation', 'neutral', 'Enveloppe attribuée', `${x.allocationCents !== null ? eur(x.allocationCents) : 'Une enveloppe'} réservés pour « ${x.name} »${x.allocationDate ? ` le ${x.allocationDate.split('-').reverse().join('/')}` : ''}.`);
    if (f.caps.overCount) {
      const n = f.caps.overCount;
      add('caps', 'negative', `${n} poste${n > 1 ? 's' : ''} en dépassement de plafond`, f.caps.over.map((o) => `« ${o.label} » en dépassement de ${eur(o.overCents)} (plafond ${eur(o.capCents)})`).join(' ; ') + '.');
    }
    if (p.objectiveCents && p.progressBeforePct !== null && p.progressAfterPct !== null) {
      const step = [25, 50, 75, 100].find((s) => p.progressBeforePct < s && p.progressAfterPct >= s);
      if (step) add('milestone', 'positive', step === 100 ? 'Objectif de patrimoine atteint' : `${step} % de l’objectif de patrimoine`, `Le patrimoine passe à ${eur(p.stockAfterCents)} sur ${eur(p.objectiveCents)} visés.`);
    }
    if (f.decisions.sharesGranted || f.decisions.overrunsApproved) add('decisions', 'neutral', 'Décisions de financement', [f.decisions.sharesGranted ? `${f.decisions.sharesGranted} part(s) accordée(s) pour ${eur(f.decisions.sharesGrantedCents)}` : '', f.decisions.overrunsApproved ? `${f.decisions.overrunsApproved} dépassement(s) accordé(s) pour ${eur(f.decisions.overrunsApprovedCents)}` : ''].filter(Boolean).join(' · ') + '.');
    if (f.biggest) add('biggest', 'neutral', 'Plus grosse dépense', `« ${f.biggest.label} », ${eur(f.biggest.cents)}${f.biggest.project ? ` pour le projet « ${f.biggest.project} »` : ''}.`);
    if (final && f.deadlines.unrealizedCount) add('unrealized', 'warning', 'Échéances jamais réglées', `${f.deadlines.unrealizedCount} échéance(s) prévue(s) n’ont pas eu lieu (${signed(f.deadlines.unrealizedCents)} au net).`);
    if (!final && status !== 'closed' && f.deadlines.openCount) add('open', 'warning', 'Échéances encore ouvertes', `${f.deadlines.openCount} échéance(s) à régler avant la clôture (${signed(f.deadlines.openCents)} au net).`);
    return out;
  }

  /** Le bilan d'une période : enregistré à la clôture, recalculé pour une clôture ancienne, provisoire sinon. */
  function bilanOf(ctx, period) {
    const closure = period.closureId ? socle.stateOf(ctx).closures[period.closureId] : null;
    if (closure?.bilan) return { ...closure.bilan, status: 'closed', source: 'enregistré', closureId: closure.id, closedAt: closure.createdAt };
    return { ...build(ctx, period), status: period.status, source: closure ? 'recalculé' : 'provisoire', closureId: closure?.id ?? null, closedAt: closure?.createdAt ?? null };
  }

  function periodsOf(ctx) {
    const { cycle } = h.requireComposition(socle.stateOf(ctx), ctx);
    const cs = cycle ? h.cycleState(socle.stateOf(ctx), cycle) : null;
    if (!cs) return [];
    return cs.page({ limit: MAX_PERIODS }).periods.filter((p) => p.status !== 'future');
  }

  const summaryOf = (x) => ({
    period: x.period,
    status: x.status,
    source: x.source,
    closedAt: x.closedAt,
    receivedCents: x.flows.receivedCents,
    spentCents: x.flows.spentCents,
    resultCents: x.patrimoine.capitalizedCents ?? x.flows.resultCents,
    projectsCents: x.patrimoine.projectsCents,
    withdrawnCents: x.patrimoine.withdrawnCents ?? 0,
    stockAfterCents: x.patrimoine.stockAfterCents,
    highlights: x.highlights.slice(0, 3),
    highlightCount: x.highlights.length,
  });

  return {
    build,

    /** Le bilan à enregistrer dans une clôture : le résultat est celui qui est versé au patrimoine. */
    forClosure(ctx, period, resultCents) {
      const f = build(ctx, period);
      const { cycle } = h.requireComposition(socle.stateOf(ctx), ctx);
      const p = f.patrimoine;
      const patrimoine = { ...p, capitalizedCents: resultCents, stockAfterCents: p.stockBeforeCents === null ? null : p.stockBeforeCents + resultCents - (p.withdrawnCents ?? 0) };
      if (p.objectiveCents && patrimoine.stockAfterCents !== null) patrimoine.progressAfterPct = pct(patrimoine.stockAfterCents, p.objectiveCents);
      const facts = { ...f, patrimoine };
      return { ...facts, highlights: highlightsOf(facts, { closed: h.closuresOf(socle.stateOf(ctx), cycle?.id), closure: { id: null, resultCents }, status: 'closed' }) };
    },

    /** Tous les bilans, du plus récent au plus ancien, et ce que chaque projet a coûté à chaque cycle. */
    list(ctx) {
      const bilans = periodsOf(ctx).map((p) => bilanOf(ctx, p)).sort((x, y) => y.period.start.localeCompare(x.period.start));
      const closed = bilans.filter((x) => x.status === 'closed');
      const ledger = new Map();
      for (const x of bilans) {
        for (const p of x.projects) {
          const row = ledger.get(p.budgetId) ?? { budgetId: p.budgetId, coreProjectId: p.coreProjectId, name: p.name, fundingSource: p.fundingSource ?? 'cycle', allocationCents: p.allocationCents, closedCents: 0, provisionalCents: 0, cycles: [] };
          if (p.paidCents) row.cycles.push({ periodKey: x.period.key, label: x.period.label, paidCents: p.paidCents, status: x.status });
          if (x.status === 'closed') row.closedCents += p.paidCents;
          else row.provisionalCents += p.paidCents;
          ledger.set(p.budgetId, row);
        }
      }
      return {
        context: reads.contextOf(reads.base(ctx)),
        bilans: bilans.map(summaryOf),
        totals: {
          closedCount: closed.length,
          capitalizedCents: sum(closed, (x) => x.patrimoine.capitalizedCents ?? 0),
          // Les dépenses des projets déjà passées par des cycles clos : ce qu'elles ont retenu du patrimoine.
          projectsClosedCents: sum(closed, (x) => x.patrimoine.projectsCents),
          // Les dépenses des projets hors cycle, prélevées sur le patrimoine (toutes périodes lues).
          withdrawnCents: sum(bilans, (x) => x.patrimoine.withdrawnCents ?? 0),
        },
        projects: [...ledger.values()].filter((r) => r.cycles.length || r.allocationCents !== null).sort((x, y) => y.closedCents + y.provisionalCents - (x.closedCents + x.provisionalCents)),
      };
    },

    /** Le bilan complet d'une période du cycle. */
    detail(ctx, periodKey) {
      const periods = periodsOf(ctx);
      // « current » : la période en cours (la plus récente lisible).
      const period = periodKey === 'current' ? periods.find((p) => p.status === 'current') ?? periods.at(-1) : periods.find((p) => p.key === periodKey);
      if (!period) fail('NOT_FOUND', 'Aucun bilan pour cette période.', { periodKey });
      return { context: reads.contextOf(reads.base(ctx, { periodKey: period.key })), bilan: bilanOf(ctx, period) };
    },
  };
}
