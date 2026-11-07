// Projets de la vie dans l'application BPM (niveau 3) : lectures de présentation (fiches, synthèses, contrôles de fin
// de cycle), composition des créations et enchaînement des commandes. Les règles et commandes du financement
// (enveloppe, parts des tâches, retours, demandes, dépassements, facturation) sont celles du middleware Budget
// (`../budget/funding.mjs`) ; BPM lui fournit la période du cycle (extension `fundingPeriod`).
//
// Les projets et les tâches restent ceux du noyau, seule source : leur création passe par le noyau. BPM les lit,
// les rattache et change leur état par les commandes du noyau ; il ne duplique aucune donnée de financement. Les créations depuis BPM composent les builders du
// noyau et du middleware Budget en une seule écriture Object Management.
//
// Charges de projet, charges spéciales [P] : le budget attribué figure dans le budget de vie comme une charge non
// récurrente, mais elle n'entre pas dans les dépenses à leur date de facturation. Seules les charges du projet que
// l'utilisateur a validées comme réglées (opérations réglées du Budget standard, depuis la date d'attribution)
// comptent dans les dépenses du budget de vie, à leur date réelle (variable `projets.chargesReglees`).
import { projectChecks, periodPaidCents } from '../budget/project-analysis.mjs';
import { fail } from '../../socle/errors.mjs';
import { money, text } from '../../socle/validation.mjs';
import { CADENCE_LABEL } from '../budget/recurrence.mjs';
import {
  fmt, frDate, fundingFigures, inRegime, isValidatedCharge, isValidatedMove, projectMoveCents, openRequest, OVERRUN_STATUS, overrunsOf, overrunView, requestsOf, requestView, sharesOf, standardOfProject, sum, taskFunding,
} from '../budget/funding.mjs';
import { addDays, periodByIndex, periodContaining, today } from '../budget/periods.mjs';

export { inRegime, isValidatedCharge, isValidatedRefund, isValidatedMove, projectMoveCents, OVERRUN_REASONS, OVERRUN_STATUS } from '../budget/funding.mjs';

const compositionOf = (state, userId) => Object.values(state.bpmCompositions ?? {}).find((c) => c.userId === userId) ?? null;
const cycleOf = (state, compositionId) => Object.values(state.cycleLinks ?? {}).find((c) => c.bpmCompositionId === compositionId) ?? null;

/** Chiffres d'un projet standard : ceux du financement (middleware Budget), plus le réglé de la période du cycle. */
export function projectBudget(state, b, now = today()) {
  const fig = fundingFigures(state, b, now);
  const comp = compositionOf(state, b.userId);
  const cycle = comp ? cycleOf(state, comp.id) : null;
  const period = cycle?.state === 'active' ? periodContaining(now, cycle.anchorDay) : null;
  fig.periodPaidCents = periodPaidCents(state, b, period);
  return fig;
}

/** Période du cycle de l'application qui contient une date : fournie au middleware Budget pour dater la facturation. */
export const projectExtensions = {
  fundingPeriod(state, userId, ymd) {
    const comp = compositionOf(state, userId);
    const cycle = comp ? cycleOf(state, comp.id) : null;
    return cycle?.state === 'active' ? periodContaining(ymd, cycle.anchorDay) : null;
  },
};

/** Métriques du cycle en cours lues pour la variante non standard (budget de vie). */
export const LIFE_BUDGET_KEYS = [
  'bpm.revenusPrevus', 'bpm.chargesPrevues', 'bpm.resultatPrevu', 'bpm.charges', 'bpm.chargesProjets',
  'bpm.resteAPayer', 'bpm.soldeAttendu', 'bpm.patrimoineConstitue',
];

/**
 * Variante non standard de `projectBudget` : le budget de vie, unique par user, rattaché au projet de vie unique et
 * au patrimoine, lu avec la même interface qu'un projet standard, sur le cycle en cours [P] :
 * - budget attribué / plafond = entrées prévues du cycle (ses ressources ; il ne reçoit pas d'enveloppe) ;
 * - ventilation (`shares`, `sharesCents`) = enveloppes attribuées à ses projets fils, comme un projet ventile sur ses tâches ;
 * - disponible = budget initial du cycle (entrées prévues − charges prévues) ;
 * - engagé = charges prévues du budget de vie + charges validées des projets ; réglé = Dépensé du cycle ;
 * - dépassements = ceux de ses projets fils, qu'il décide et qui lui sont facturés en fin de cycle ;
 * - `life` = accès au projet de vie, au patrimoine, au cycle et à tous ses budgets fils (avec leurs propres chiffres).
 */
export function lifeProjectBudget(state, comp, { figures, period, children, overruns, requests, funding = null, now = today() }) {
  const lifeB = state.budgets[comp.budgetId];
  const c = (k) => (figures[k]?.value === null || figures[k]?.value === undefined ? null : Math.round(figures[k].value * 100));
  const regime = !!period;
  const planned = c('bpm.revenusPrevus');
  const plannedCharges = c('bpm.chargesPrevues');
  const projectsPaid = c('bpm.chargesProjets') ?? 0;
  const paid = c('bpm.charges') ?? 0;
  const expected = c('bpm.soldeAttendu');
  const approved = overruns.filter((x) => x.status === 'approved');
  const pending = overruns.find((x) => x.status === 'pending') ?? null;
  const funded = children.filter((f) => f.regime);
  const shares = Object.fromEntries(funded.map((f) => [f.budgetId, f.allocationCents]));
  const sharesCents = sum(Object.values(shares));
  const engaged = regime ? (plannedCharges ?? 0) + projectsPaid : 0;
  const billing = approved.map((x) => x.billingDate).filter(Boolean).sort();
  const pat = state.patrimoines[comp.patrimoineId];
  return {
    budgetId: lifeB.id,
    kind: 'life',
    nonStandard: true,
    name: 'Budget du projet de vie',
    coreProjectId: comp.coreProjectId,
    parentBudgetId: null,
    revision: lifeB.revision,
    regime,
    taskFundingRequired: false,
    allocationCents: regime ? planned : null,
    allocationDate: period?.start ?? null,
    initialAllocationCents: regime ? planned : null,
    approvedOverrunCents: sum(approved, (x) => x.amountCents),
    billedOverrunCents: sum(overruns.filter((x) => x.status === 'billed'), (x) => x.amountCents),
    pendingOverrun: pending,
    ceilingCents: regime ? planned : null,
    sharesCents,
    availableCents: regime ? c('bpm.resultatPrevu') : null,
    engagedCents: engaged,
    paidCents: paid,
    remainingCents: regime && planned !== null ? planned - paid : null,
    toPayCents: c('bpm.resteAPayer') ?? 0,
    uncommittedCents: regime && planned !== null ? planned - engaged : null,
    periodPaidCents: regime ? paid : null,
    pendingRequestsCents: sum(requests, (x) => x.amountCents),
    paidBeforeAllocationCents: 0,
    unsharedChargesCents: paid - projectsPaid,
    state: !regime ? 'unallocated' : expected !== null && expected < 0 ? 'deficit' : planned !== null && engaged > planned ? 'at-risk' : 'ok',
    deficit: expected !== null && expected < 0,
    nextBillingDate: billing.find((d) => d > now) ?? billing[0] ?? null,
    byTask: {},
    beforeByTask: {},
    shares,
    returns: {},
    life: {
      unique: true,
      compositionId: comp.id,
      lifeProjectId: comp.coreProjectId,
      patrimoineId: comp.patrimoineId,
      patrimoine: { stockCents: c('bpm.patrimoineConstitue'), objectiveCents: pat?.objectiveCents ?? null, openingStockCents: pat?.openingStockCents ?? null },
      period: period ? { key: period.key, label: period.label, start: period.start, end: period.end } : null,
      expectedCents: expected,
      projectsPaidCents: regime ? projectsPaid : null,
      childCount: children.length,
      fundedCount: funded.length,
      children,
      funding,
    },
  };
}

/**
 * Contrôles de fin de cycle d'un projet en régime : le budget attribué correspond-il à la somme des parts, et les
 * charges des tâches sont-elles planifiées avec des montants et des récurrences à jour ? Lecture seule.
 */
export function cycleChecks(state, b, fig = projectBudget(state, b)) {
  return projectChecks(state, b, fig, projectExtensions.fundingPeriod(state, b.userId, today()));
}

/**
 * Contrôles de fin de cycle de la variante non standard (budget de vie) : mêmes codes de lecture que `cycleChecks`,
 * appliqués à ses projets fils (financement, dépassements à décider ou à facturer) et à son cycle.
 */
export function lifeChecks(state, fig, { toCloseCount = 0, now = today() } = {}) {
  const out = [];
  const life = fig.life;
  if (!fig.regime) return [{ code: 'cycle', level: 'warning', taskId: null, message: 'Cycle budgétaire à configurer : le budget de vie n’a pas encore de ressources de cycle.' }];
  out.push(
    toCloseCount
      ? { code: 'cycle', level: 'warning', taskId: null, message: `${toCloseCount} période${toCloseCount > 1 ? 's' : ''} terminée${toCloseCount > 1 ? 's' : ''} à clôturer avant de lire le résultat du cycle.` }
      : { code: 'cycle', level: 'ok', taskId: null, message: `Toutes les périodes terminées sont clôturées ; cycle en cours : ${life.period.label}.` },
  );
  out.push(
    fig.deficit
      ? { code: 'expected', level: 'warning', taskId: null, message: `Solde attendu négatif (${fmt(life.expectedCents)}) : les charges prévues dépassent les entrées du cycle.` }
      : { code: 'expected', level: 'ok', taskId: null, message: `Solde attendu du cycle : ${fmt(life.expectedCents ?? 0)}.` },
  );
  const unfunded = life.children.filter((c) => !c.regime);
  out.push(
    unfunded.length
      ? { code: 'shares', level: 'info', taskId: null, message: `${unfunded.length} projet${unfunded.length > 1 ? 's' : ''} rattaché${unfunded.length > 1 ? 's' : ''} sans enveloppe : ${unfunded.map((c) => `« ${c.name} »`).join(', ')}.` }
      : { code: 'shares', level: 'ok', taskId: null, message: `Enveloppes attribuées à ses ${life.fundedCount} projet${life.fundedCount > 1 ? 's' : ''} : ${fmt(fig.sharesCents)}.` },
  );
  if (fig.pendingOverrun) out.push({ code: 'overrun-pending', level: 'warning', taskId: null, message: `Dépassement de ${fmt(fig.pendingOverrun.amountCents)} à décider pour « ${state.budgets[fig.pendingOverrun.budgetId]?.name ?? ''} ».` });
  const billable = Object.values(state.projectOverruns ?? {}).filter((x) => x.status === 'approved' && life.children.some((c) => c.budgetId === x.budgetId) && (!x.billingDate || x.billingDate <= now));
  if (billable.length) out.push({ code: 'overrun-billable', level: 'warning', taskId: null, message: `${fmt(sum(billable, (x) => x.amountCents))} de dépassements autorisés à facturer au budget de vie.` });
  for (const c of life.children.filter((x) => x.regime && x.paidCents > x.ceilingCents)) {
    out.push({ code: 'task-paid', level: 'warning', taskId: null, message: `« ${c.name} » : réglé ${fmt(c.paidCents)}, au-delà de son enveloppe (${fmt(c.ceilingCents)}).` });
  }
  if (fig.pendingRequestsCents) out.push({ code: 'requests', level: 'info', taskId: null, message: `${fmt(fig.pendingRequestsCents)} de demandes de montant de tâches attendent l’autorisation du budget de vie.` });
  return out;
}

/**
 * Financement des projets fils par le budget de vie, cycle par cycle [P] : enveloppe attribuée (et sa période),
 * dépassements par période de décision, charges validées remontées au budget de vie par période.
 */
export function lifeFunding(state, children, cs, { limit = 12 } = {}) {
  if (!cs) return { periods: [], rows: [], totals: { byPeriod: {}, paidCents: 0, allocatedCents: 0 } };
  const from = Math.max(cs.first.index, cs.current.index - limit + 1);
  const periods = [];
  for (let i = from; i <= cs.current.index; i++) {
    // La clé d'une période ne dépend que de son mois de début : `find` la relit avec le jour d'ancrage du cycle.
    const p = cs.find(periodByIndex(i, 1).key);
    if (p) periods.push({ key: p.key, label: p.label, start: p.start, end: p.end, status: p.status });
  }
  const keyOf = (ymd) => (ymd ? periods.find((p) => ymd >= p.start && ymd <= p.end)?.key ?? null : null);
  const rows = children.map((c) => {
    const b = state.budgets[c.budgetId];
    const byPeriod = Object.fromEntries(periods.map((p) => [p.key, 0]));
    for (const o of Object.values(state.operations)) {
      if (!isValidatedMove(o, b)) continue;
      const k = keyOf(o.realizedDate);
      if (k) byPeriod[k] += projectMoveCents(o, b);
    }
    const overruns = overrunsOf(state, c.budgetId)
      .filter((x) => x.status !== 'refused')
      .map((x) => ({ id: x.id, status: x.status, statusLabel: OVERRUN_STATUS[x.status], amountCents: x.amountCents, periodKey: x.periodKey ?? keyOf(x.decidedAt ?? x.requestedAt), billingDate: x.billingDate }));
    return {
      budgetId: c.budgetId,
      coreProjectId: c.coreProjectId,
      name: c.name,
      regime: c.regime,
      state: c.state,
      allocationCents: c.allocationCents,
      initialAllocationCents: c.initialAllocationCents,
      allocationDate: c.allocationDate,
      allocationPeriodKey: keyOf(c.allocationDate),
      approvedOverrunCents: c.approvedOverrunCents,
      billedOverrunCents: c.billedOverrunCents,
      pendingOverrunCents: sum(overruns.filter((x) => x.status === 'pending'), (x) => x.amountCents),
      paidCents: c.regime ? c.paidCents : 0,
      remainingCents: c.remainingCents,
      byPeriod,
      overruns,
    };
  });
  const byPeriod = Object.fromEntries(periods.map((p) => [p.key, sum(rows, (r) => r.byPeriod[p.key])]));
  return { periods, rows, totals: { byPeriod, paidCents: sum(rows, (r) => r.paidCents), allocatedCents: sum(rows, (r) => r.allocationCents ?? 0) } };
}

/** Projets standards du budget de vie auxquels un montant est attribué (régime des charges de projet). */
export const fundedStandardsOf = (state, lifeBudgetId) => Object.values(state.budgets).filter((b) => b.parentBudgetId === lifeBudgetId && inRegime(b));

/**
 * Charges spéciales du budget de vie liées aux projets, présentées dans le registre sans entrer dans les totaux :
 * le budget attribué (charge non récurrente, à sa date d'attribution) et les dépassements autorisés, facturés à la
 * fin du cycle (à leur date de facturation).
 */
export function specialProjectLines(state, lifeBudgetId, { from, to }) {
  const out = [];
  for (const b of fundedStandardsOf(state, lifeBudgetId)) {
    const fig = projectBudget(state, b);
    if (b.allocationDate >= from && b.allocationDate <= to) {
      out.push({ id: `alloc:${b.id}`, kind: 'projectAllocation', budget: b, label: `Budget attribué · ${b.name}`, date: b.allocationDate, cents: fig.initialAllocationCents, statusLabel: 'Charge de projet · comptée à la validation de ses dépenses' });
    }
    for (const x of overrunsOf(state, b.id)) {
      if (!['approved', 'billed'].includes(x.status) || !x.billingDate || x.billingDate < from || x.billingDate > to) continue;
      const task = x.taskId ? state.tasks[x.taskId]?.title : null;
      out.push({
        id: `overrun:${x.id}`,
        kind: 'projectOverrun',
        budget: b,
        label: `Dépassement · ${b.name}${task ? ` · ${task}` : ''}`,
        date: x.billingDate,
        cents: x.amountCents,
        statusLabel: x.status === 'billed' ? 'Dépassement facturé en fin de cycle' : 'Dépassement autorisé · facturé en fin de cycle',
      });
    }
  }
  return out;
}

/** Variables des chiffres du budget de vie apportées par les projets. */
/**
 * Service des projets de l'application BPM.
 * @param socle socle complet
 * @param h     helpers du module BPM : requireComposition, cycleState
 */
export function createProjects(socle, h) {
  const { om } = socle;
  const core = () => socle.modules.core;
  const budgetModule = () => socle.modules.budget;
  const funding = () => socle.modules.budget.funding;

  /** Budget standard du user, enfant de son budget de vie. */
  function standardOf(state, userId, budgetId) {
    const b = om.owned(state, 'budget', budgetId, userId);
    const comp = compositionOf(state, userId);
    if (b.role === 'life' && b.id === comp?.budgetId) fail('FORBIDDEN_BY_RULE', 'Le budget de vie est non standard : ses ressources sont les entrées du cycle et il finance ses projets fils ; il ne reçoit ni enveloppe, ni part de tâche, ni dépassement.', { field: 'budgetId', budgetId, kind: 'life' });
    if (b.role !== 'standard' || b.parentBudgetId !== comp?.budgetId) fail('INCOMPATIBLE_REFERENCE', 'Ce Budget n’est pas un projet standard de votre budget de vie.', { field: 'budgetId', budgetId });
    return b;
  }

  /** Période du cycle du budget de vie qui contient une date, ou null si le cycle est à configurer. */
  function periodOf(state, userId, ymd) {
    const comp = compositionOf(state, userId);
    const cycle = comp ? cycleOf(state, comp.id) : null;
    return cycle?.state === 'active' ? periodContaining(ymd, cycle.anchorDay) : null;
  }

  // ---------- lectures ----------

  function contextOf(state, userId, comp) {
    const user = state.users[userId];
    const cs = h.cycleState(state, cycleOf(state, comp.id));
    return {
      user: { id: user.id, label: user.label, userType: user.userType },
      lifeBudget: { budgetId: comp.budgetId, name: 'Budget du projet de vie', coreProjectId: comp.coreProjectId },
      period: cs ? { key: cs.current.key, label: cs.current.label, start: cs.current.start, end: cs.current.end } : null,
      cycleState: cs ? 'active' : 'to_configure',
      calculationDate: today(),
      revision: state.revision,
      unit: 'centimes (EUR)',
    };
  }

  /** Projets du budget de vie : le projet de vie (racine) et ses projets standards, seulement ceux du user. */
  function budgetedProjects(state, comp) {
    const standards = om
      .list(state, 'budget', (b) => b.role === 'standard' && b.parentBudgetId === comp.budgetId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { standards, projectIds: new Set([comp.coreProjectId, ...standards.map((b) => b.coreProjectId)]) };
  }

  function lifeSummary(state, comp, standards, now) {
    const figs = standards.map((b) => projectBudget(state, b, now));
    const overruns = standards.flatMap((b) => overrunsOf(state, b.id));
    const billable = overruns.filter((x) => x.status === 'approved' && (!x.billingDate || x.billingDate <= now));
    return {
      budgetId: comp.budgetId,
      projectCount: standards.length,
      fundedCount: figs.filter((f) => f.regime).length,
      allocatedCents: sum(figs, (f) => f.allocationCents ?? 0),
      paidCents: sum(figs, (f) => (f.regime ? f.paidCents : 0)),
      approvedOverrunCents: sum(figs, (f) => f.approvedOverrunCents),
      sharesCents: sum(figs, (f) => f.sharesCents),
      availableCents: sum(figs, (f) => f.availableCents ?? 0),
      remainingCents: sum(figs, (f) => f.remainingCents ?? 0),
      periodPaidCents: periodOf(state, comp.userId, now) ? sum(figs, (f) => f.periodPaidCents ?? 0) : null,
      taskRequests: standards.flatMap((b) => requestsOf(state, b.id).filter(openRequest).map((x) => requestView(state, x))),
      deficitCount: figs.filter((f) => f.deficit).length,
      pendingRequests: overruns.filter((x) => x.status === 'pending').map((x) => overrunView(state, x)),
      billable: billable.map((x) => overrunView(state, x)),
      billableCents: sum(billable, (x) => x.amountCents),
      nextBillingDate: overruns.filter((x) => x.status === 'approved' && x.billingDate > now).map((x) => x.billingDate).sort()[0] ?? null,
    };
  }

  /** Chiffres du budget de vie dans l'interface d'un projet (variante non standard), sur le cycle en cours. */
  function lifeFigures(state, comp, standards, now) {
    const cs = h.cycleState(state, cycleOf(state, comp.id));
    const { figures } = h.figuresFor(state, comp.userId, LIFE_BUDGET_KEYS, {});
    const children = standards.map((b) => projectBudget(state, b, now));
    const overruns = standards.flatMap((b) => overrunsOf(state, b.id));
    const requests = standards.flatMap((b) => requestsOf(state, b.id).filter((x) => x.status === 'awaiting-life'));
    const fig = lifeProjectBudget(state, comp, { figures, period: cs?.current ?? null, children, overruns, requests, funding: lifeFunding(state, children, cs), now });
    return { fig, cs };
  }

  const projectCard = (state, projectId, role, fig) => ({ ...core().projectSummary(state, projectId), role, budget: fig });

  /** Tableau des projets BPM : projet de vie et projets standards du user, avec leur budget. */
  function overview(ctx) {
    const state = socle.state;
    const { userId, comp } = h.requireComposition(state, ctx);
    const now = today();
    const { standards, projectIds } = budgetedProjects(state, comp);
    const roots = new Set([...Object.values(state.budgets).map((b) => b.coreProjectId), ...Object.values(state.patrimoines ?? {}).map((p) => p.coreProjectId)]);
    return {
      context: contextOf(state, userId, comp),
      lifeProject: projectCard(state, comp.coreProjectId, 'life', lifeFigures(state, comp, standards, now).fig),
      life: lifeSummary(state, comp, standards, now),
      projects: standards.map((b) => projectCard(state, b.coreProjectId, 'standard', projectBudget(state, b, now))),
      // Projets du noyau que le budget de vie peut financer : ni racine d'un Budget ou d'un Patrimoine, ni déjà budgétés.
      candidates: om
        .list(state, 'coreProject', (p) => p.userId === userId && !roots.has(p.id) && !projectIds.has(p.id))
        .sort((a, b) => a.title.localeCompare(b.title, 'fr'))
        .map((p) => ({ projectId: p.id, title: p.title, taskCount: Object.values(state.tasks).filter((t) => t.projectId === p.id).length })),
    };
  }

  /** Vue d'une tâche pour BPM : vue du noyau, projet, part, engagé, réglé et retour. */
  function taskCard(state, t, figsByProject) {
    const view = core().readTask({ userId: t.userId }, t.id);
    const fig = t.projectId ? figsByProject.get(t.projectId) : null;
    const f = fig ? taskFunding(state, fig, t.id) : null;
    const share = f?.shareCents ?? null;
    const ret = fig?.returns[t.id] ?? null;
    // Valorisation indicative de la part au prorata du temps. Elle n'écrit aucune opération financière.
    const timeRatio = t.plannedHours > 0 ? t.spentHours / t.plannedHours : null;
    const timeConsumedCents = share === null || timeRatio === null ? null : Math.round(share * timeRatio);
    return {
      ...view,
      projectRole: fig ? 'standard' : t.projectId && figsByProject.lifeRoot === t.projectId ? 'life' : null,
      budgetId: fig?.budgetId ?? null,
      budget: fig
        ? {
            ...f,
            return: ret ? { ...ret, cadenceLabel: CADENCE_LABEL[ret.cadence] } : null,
            request: requestsOf(state, fig.budgetId).filter((x) => x.taskId === t.id && openRequest(x)).map((x) => requestView(state, x))[0] ?? null,
            timeConsumptionPercent: timeRatio === null ? null : Math.round(timeRatio * 1000) / 10,
            timeConsumedCents,
            timeRemainingCents: timeConsumedCents === null ? null : share - timeConsumedCents,
          }
        : null,
    };
  }

  function figuresByProject(state, standards, comp, now) {
    const m = new Map(standards.map((b) => [b.coreProjectId, projectBudget(state, b, now)]));
    m.lifeRoot = comp.coreProjectId;
    return m;
  }

  /** Tâches des projets du budget de vie, et tâches du noyau qu'on peut y rattacher. */
  function tasksOverview(ctx) {
    const state = socle.state;
    const { userId, comp } = h.requireComposition(state, ctx);
    const now = today();
    const { standards, projectIds } = budgetedProjects(state, comp);
    const figs = figuresByProject(state, standards, comp, now);
    const mine = om.list(state, 'task', (t) => t.userId === userId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      context: contextOf(state, userId, comp),
      projects: [
        { projectId: comp.coreProjectId, title: state.coreProjects[comp.coreProjectId]?.title ?? 'Projet de vie', role: 'life', budgetId: comp.budgetId },
        ...standards.map((b) => ({ projectId: b.coreProjectId, title: state.coreProjects[b.coreProjectId]?.title ?? b.name, role: 'standard', budgetId: b.id })),
      ],
      tasks: mine.filter((t) => projectIds.has(t.projectId)).map((t) => taskCard(state, t, figs)),
      attachable: mine.filter((t) => !projectIds.has(t.projectId)).map((t) => taskCard(state, t, figs)),
    };
  }

  /** Fiche BPM d'un projet : projet du noyau, budget, tâches, charges, dépassements et contrôles de fin de cycle. */
  function projectDetail(ctx, coreProjectId) {
    const state = socle.state;
    const { userId, comp } = h.requireComposition(state, ctx);
    const now = today();
    om.owned(state, 'coreProject', coreProjectId, userId);
    const { standards, projectIds } = budgetedProjects(state, comp);
    if (!projectIds.has(coreProjectId)) fail('NOT_FOUND', 'Ce projet n’appartient pas à votre budget de vie : budgétez-le d’abord depuis Projets.', { coreProjectId });
    const figs = figuresByProject(state, standards, comp, now);
    const b = standards.find((x) => x.coreProjectId === coreProjectId) ?? null;
    // Même interface pour les deux variantes : `budget.kind` dit si le projet est standard ou le projet de vie (non standard).
    const lf = b ? null : lifeFigures(state, comp, standards, now);
    const fig = b ? figs.get(coreProjectId) : lf.fig;
    const tasks = om.list(state, 'task', (t) => t.projectId === coreProjectId).sort((a, c) => a.createdAt.localeCompare(c.createdAt));
    const out = {
      context: contextOf(state, userId, comp),
      role: b ? 'standard' : 'life',
      project: core().projectSummary(state, coreProjectId),
      budget: fig,
      tasks: tasks.map((t) => taskCard(state, t, figs)),
      attachable: om
        .list(state, 'task', (t) => t.userId === userId && !projectIds.has(t.projectId))
        .sort((a, c) => a.createdAt.localeCompare(c.createdAt))
        .map((t) => taskCard(state, t, figs)),
      // Projet de vie : il porte les dépassements et les demandes de tous ses projets fils, qu'il décide.
      overruns: (b ? overrunsOf(state, b.id) : standards.flatMap((x) => overrunsOf(state, x.id))).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).map((x) => overrunView(state, x)),
      checks: b ? cycleChecks(state, b, fig) : lifeChecks(state, fig, { toCloseCount: lf.cs ? lf.cs.current.index - lf.cs.firstOpen.index : 0, now }),
      requests: (b ? requestsOf(state, b.id) : standards.flatMap((x) => requestsOf(state, x.id))).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).map((x) => requestView(state, x)),
      charges: [],
      life: null,
    };
    if (b) {
      const lines = budgetModule().budgetLines(state, [b.id], { from: addDays(now, -365), to: addDays(now, 365), by: 'planned' });
      // Les remboursements reçus figurent avec les dépenses de leur tâche : ils s'en déduisent (`refund`).
      out.charges = lines
        .filter((l) => l.direction === 'charge' || (l.direction === 'income' && l.kind === 'operation'))
        .map((l) => {
          const v = budgetModule().lineView(state, l);
          return { ...v, refund: l.direction === 'income', validated: l.settled && inRegime(b) && l.realizedDate >= b.allocationDate, beforeAllocation: l.settled && inRegime(b) && l.realizedDate < b.allocationDate };
        });
    } else {
      // Charges propres du budget de vie sur le cycle en cours (les projets fils gardent les leurs).
      const p = lf.cs?.current;
      if (p) out.charges = budgetModule().budgetLines(state, [comp.budgetId], { from: p.start, to: p.end, by: 'planned' }).filter((l) => l.direction === 'charge').map((l) => ({ ...budgetModule().lineView(state, l), validated: l.settled, beforeAllocation: false }));
      out.life = {
        ...lifeSummary(state, comp, standards, now),
        projects: standards.map((x) => ({ projectId: x.coreProjectId, title: state.coreProjects[x.coreProjectId]?.title ?? x.name, budget: figs.get(x.coreProjectId) })),
      };
    }
    return out;
  }

  // ---------- commandes ----------

  /** Un projet BPM est toujours associé à son propre Budget standard ; le financement et les tâches peuvent suivre. */
  async function createProject(ctx, input = {}) {
    const r = await om.command('createBpmProject', ctx, input, (tx) => {
      const comp = compositionOf(tx.draft, tx.userId);
      if (!comp) fail('NOT_FOUND', 'Espace BPM à préparer avant de créer un projet.');
      const p = core().buildProject(tx, input);
      const b = budgetModule().buildStandardBudget(tx, { coreProjectId: p.id, parentBudgetId: comp.budgetId, name: p.title });
      // Les projets historiques restent lisibles ; les nouveaux parcours financent leurs dépenses par tâche.
      funding().startTaskFunding(tx, b, money('amount', input.amount, { nullable: true }));
      return { coreProjectId: p.id, budgetId: b.id };
    }, { creation: true });
    return { ...r, detail: projectDetail(ctx, r.coreProjectId) };
  }

  /** La tâche peut être préparée seule ; le tronc principal n'est pas une destination du parcours BPM. */
  async function createTask(ctx, input = {}) {
    const r = await om.command('createBpmTask', ctx, input, (tx) => {
      const comp = compositionOf(tx.draft, tx.userId);
      if (!comp) fail('NOT_FOUND', 'Espace BPM à préparer.');
      const projectId = input.projectId || null;
      if (projectId) {
        const b = standardOfProject(tx.draft, projectId);
        if (!b) fail('INCOMPATIBLE_REFERENCE', 'Choisissez un projet de la vie, ou préparez la tâche sans projet.', { field: 'projectId' });
        standardOf(tx.draft, tx.userId, b.id);
      }
      return { taskId: core().buildTask(tx, { ...input, projectId }).id };
    }, { creation: true });
    return { ...r, ...core().readTask(ctx, r.taskId) };
  }

  /** Budgéter un projet du noyau : il devient un projet standard du budget de vie (le projet reste celui du noyau). */
  async function adoptProject(ctx, input = {}) {
    const r = await om.command(
      'adoptProject',
      ctx,
      input,
      (tx) => {
        const comp = compositionOf(tx.draft, tx.userId);
        if (!comp) fail('NOT_FOUND', 'Espace BPM à préparer avant de budgéter un projet.');
        const p = om.owned(tx.draft, 'coreProject', input.coreProjectId, tx.userId);
        if (p.id === comp.coreProjectId) fail('FORBIDDEN_BY_RULE', 'Le projet de vie est la racine du budget de vie : il ne devient pas un projet standard.', { field: 'coreProjectId' });
        if (Object.values(tx.draft.patrimoines ?? {}).some((x) => x.coreProjectId === p.id)) fail('FORBIDDEN_BY_RULE', 'Ce projet est la racine d’un Patrimoine.', { field: 'coreProjectId' });
        const name = text('name', input.name, { max: 200 }) || p.title;
        const b = budgetModule().buildStandardBudget(tx, { coreProjectId: p.id, parentBudgetId: comp.budgetId, name });
        return { budgetId: b.id, coreProjectId: p.id };
      },
      { creation: true },
    );
    return { ...r, detail: projectDetail(ctx, r.coreProjectId) };
  }

  // ---------- commandes du financement : exécutées par le middleware Budget, rendues avec la fiche du projet ----------

  const detailOf = (ctx, budgetId) => projectDetail(ctx, socle.state.budgets[budgetId].coreProjectId);

  async function requestTaskBudget(ctx, budgetId, taskId, input = {}) {
    return funding().requestTaskBudget(ctx, budgetId, taskId, input);
  }
  async function decideTaskBudget(ctx, id, input = {}) {
    const r = await funding().decideTaskBudget(ctx, id, input);
    return { ...r, detail: detailOf(ctx, r.request.budgetId) };
  }
  async function allocate(ctx, budgetId, input = {}) {
    await funding().allocate(ctx, budgetId, input);
    return detailOf(ctx, budgetId);
  }
  async function setTaskShare(ctx, budgetId, taskId, input = {}) {
    const r = await funding().setTaskShare(ctx, budgetId, taskId, input);
    return { ...detailOf(ctx, budgetId), overrunCents: r.overrunCents };
  }
  async function releaseTaskShare(ctx, budgetId, taskId, input = {}) {
    const r = await funding().releaseTaskShare(ctx, budgetId, taskId, input);
    return { ...detailOf(ctx, budgetId), released: { releasedCents: r.releasedCents, shareCents: r.shareCents, taskTitle: r.taskTitle } };
  }
  async function setTaskReturn(ctx, budgetId, taskId, input = {}) {
    const r = await funding().setTaskReturn(ctx, budgetId, taskId, input);
    return { ...detailOf(ctx, budgetId), effects: r.effects };
  }
  async function requestOverrun(ctx, budgetId, input = {}) {
    const r = await funding().requestOverrun(ctx, budgetId, input);
    return { ...r, detail: detailOf(ctx, budgetId) };
  }
  async function decideOverrun(ctx, id, input = {}) {
    const r = await funding().decideOverrun(ctx, id, input);
    return { ...r, detail: detailOf(ctx, r.overrun.budgetId) };
  }
  /** Fin de cycle : facturation par le middleware, puis contrôles de fin de cycle de chaque projet concerné. */
  async function billOverruns(ctx, input = {}) {
    const r = await funding().billOverruns(ctx, input);
    const state = socle.state;
    return {
      projects: r.budgetIds.map((id) => {
        const b = state.budgets[id];
        const fig = projectBudget(state, b);
        return { budgetId: id, name: b.name, coreProjectId: b.coreProjectId, allocationCents: fig.allocationCents, billedOverrunCents: fig.billedOverrunCents, checks: cycleChecks(state, b, fig) };
      }),
    };
  }

  return { overview, tasksOverview, projectDetail, createProject, createTask, requestTaskBudget, decideTaskBudget, adoptProject, allocate, setTaskShare, releaseTaskShare, setTaskReturn, requestOverrun, decideOverrun, billOverruns };
}
