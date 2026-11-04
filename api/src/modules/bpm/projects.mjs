// Projets de la vie dans l'application BPM (niveau 3). Le budget de vie (Budget « Projet de vie ») attribue un
// montant à chacun de ses projets standards (Budgets standards enfants) ; chaque projet ventile ce montant sur
// ses tâches ; tout dépassement est autorisé par le budget de vie, puis facturé au budget de vie à la fin de son
// cycle. Un projet peut aussi retourner un revenu au budget de vie quand une de ses tâches est terminée.
//
// Les projets et les tâches restent ceux du noyau, seule source : leur création passe par le noyau. BPM les lit,
// les rattache et change leur état par les commandes du noyau ; il ne porte que ses propres données (montant
// attribué, parts des tâches, dépassements, retours), dans des champs des Budgets standards et dans la nature
// `projectOverrun`.
//
// Charges de projet, charges spéciales [P] : le budget attribué figure dans le budget de vie comme une charge non
// récurrente, mais elle n'entre pas dans les dépenses à leur date de facturation. Seules les charges du projet que
// l'utilisateur a validées comme réglées (opérations réglées du Budget standard, depuis la date d'attribution)
// comptent dans les dépenses du budget de vie, à leur date réelle (variable `projets.chargesReglees`).
import { fail } from '../../socle/errors.mjs';
import { expectedRevisionOf, money, oneOf, text } from '../../socle/validation.mjs';
import { CADENCE_LABEL, CADENCES, occurrenceDates } from '../budget/recurrence.mjs';
import { addDays, periodContaining, today } from './periods.mjs';

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const fmt = (cents) => euro.format(cents / 100).replace(/[  ]/g, ' ');
const sum = (list, f = (x) => x) => list.reduce((s, x) => s + (f(x) ?? 0), 0);

export const OVERRUN_REASONS = { ventilation: 'Part de budget d’une tâche', reglement: 'Règlement d’une dépense' };
export const OVERRUN_STATUS = {
  pending: 'En attente de la décision du budget de vie',
  approved: 'Autorisé · facturé au budget de vie en fin de cycle',
  refused: 'Refusé par le budget de vie',
  billed: 'Facturé au budget de vie',
};
const RETURN_CADENCES = ['once', ...CADENCES];
/** Engagé d'une récurrence sans date de fin : ses occurrences des 12 prochains mois [P]. */
const HORIZON_DAYS = 365;

const compositionOf = (state, userId) => Object.values(state.bpmCompositions ?? {}).find((c) => c.userId === userId) ?? null;
const cycleOf = (state, compositionId) => Object.values(state.cycleLinks ?? {}).find((c) => c.bpmCompositionId === compositionId) ?? null;

/** Projet standard financé par le budget de vie : un montant lui est attribué (régime des charges de projet). */
export const inRegime = (b) => b?.role === 'standard' && Number.isInteger(b.allocationCents) && typeof b.allocationDate === 'string';
const standardOfProject = (state, coreProjectId) => Object.values(state.budgets).find((b) => b.role === 'standard' && b.coreProjectId === coreProjectId) ?? null;
const sharesOf = (b) => b.taskSharesCents ?? {};
const returnsOf = (b) => b.taskReturns ?? {};
const overrunsOf = (state, budgetId) => Object.values(state.projectOverruns ?? {}).filter((x) => x.budgetId === budgetId);

/** Charge d'un projet validée comme réglée pour ses besoins, depuis l'attribution : comptée dans le budget de vie. */
export const isValidatedCharge = (o, b) => inRegime(b) && o.budgetId === b.id && o.direction === 'charge' && o.status === 'realized' && o.realizedDate >= b.allocationDate;

/**
 * Charges du projet qui forment son engagé : réglées validées, prévues ponctuelles, occurrences attendues.
 * Les règlements antérieurs à l'attribution restent dans l'historique du projet, hors budget attribué.
 */
function chargeItems(state, b, now) {
  const from = inRegime(b) ? b.allocationDate : null;
  const horizon = addDays(now, HORIZON_DAYS);
  const items = [];
  const materialized = new Set();
  for (const o of Object.values(state.operations)) {
    if (o.budgetId !== b.id) continue;
    if (o.recurrenceId) materialized.add(`${o.recurrenceId}@${o.occurrenceDate}`);
    if (o.direction !== 'charge') continue;
    if (o.status === 'realized') {
      if (from && o.realizedDate < from) items.push({ taskId: o.taskId ?? null, cents: o.realizedAmountCents, paid: false, before: true });
      else items.push({ taskId: o.taskId ?? null, cents: o.realizedAmountCents, paid: true });
    } else items.push({ taskId: o.taskId ?? null, cents: o.amountCents, paid: false });
  }
  for (const r of Object.values(state.recurrences ?? {})) {
    if (r.budgetId !== b.id || r.direction !== 'charge') continue;
    const start = from && from > r.firstDate ? from : r.firstDate;
    for (const d of occurrenceDates(r, start, r.endDate ?? horizon)) {
      if (!materialized.has(`${r.id}@${d}`)) items.push({ taskId: r.taskId ?? null, cents: r.amountCents, paid: false, unbounded: !r.endDate });
    }
  }
  return items;
}

function overrunView(state, x) {
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

/** Chiffres d'un projet standard (centimes) : attribué, dépassements, ventilé, engagé, réglé validé, reste. */
export function projectBudget(state, b, now = today()) {
  const regime = inRegime(b);
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
  for (const i of items) {
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
    budgetId: b.id,
    name: b.name,
    coreProjectId: b.coreProjectId,
    parentBudgetId: b.parentBudgetId,
    revision: b.revision,
    regime,
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
    paidBeforeAllocationCents: sum(items.filter((i) => i.before), (i) => i.cents),
    unsharedChargesCents: sum(current.filter((i) => !i.taskId), (i) => i.cents),
    state: !regime ? 'unallocated' : deficit ? 'deficit' : engagedCents > ceilingCents ? 'at-risk' : 'ok',
    deficit,
    nextBillingDate: billing[0] ?? null,
    byTask,
    shares: { ...shares },
    returns: structuredClone(returnsOf(b)),
  };
}

/**
 * Contrôles de fin de cycle d'un projet en régime : le budget attribué correspond-il à la somme des parts, et les
 * charges des tâches sont-elles planifiées avec des montants et des récurrences à jour ? Lecture seule.
 */
export function cycleChecks(state, b, fig = projectBudget(state, b)) {
  if (!fig.regime) return [];
  const out = [];
  const gap = fig.ceilingCents - fig.sharesCents;
  out.push(
    gap === 0
      ? { code: 'shares', level: 'ok', taskId: null, message: `Le budget du projet (${fmt(fig.ceilingCents)}) correspond à la somme des parts de ses tâches.` }
      : { code: 'shares', level: 'warning', taskId: null, message: `${fmt(gap)} du budget du projet ne sont ventilés sur aucune tâche (parts : ${fmt(fig.sharesCents)} sur ${fmt(fig.ceilingCents)}).` },
  );
  for (const [taskId, share] of Object.entries(fig.shares)) {
    const title = state.tasks[taskId]?.title ?? taskId;
    const s = fig.byTask[taskId] ?? { engagedCents: 0, unbounded: false };
    if (s.unbounded) out.push({ code: 'recurrence', level: 'warning', taskId, message: `« ${title} » : une charge récurrente n'a pas de date de fin ; son engagé est compté sur 12 mois.` });
    if (s.engagedCents > share) out.push({ code: 'engaged', level: 'warning', taskId, message: `« ${title} » : charges planifiées (${fmt(s.engagedCents)}) au-delà de sa part (${fmt(share)}).` });
    else if (s.engagedCents < share) out.push({ code: 'engaged', level: 'info', taskId, message: `« ${title} » : ${fmt(share - s.engagedCents)} de sa part ne sont pas encore planifiés en charges.` });
    else out.push({ code: 'engaged', level: 'ok', taskId, message: `« ${title} » : charges planifiées égales à sa part (${fmt(share)}).` });
  }
  for (const [taskId, s] of Object.entries(fig.byTask)) {
    if (!(taskId in fig.shares)) out.push({ code: 'unshared', level: 'warning', taskId, message: `« ${state.tasks[taskId]?.title ?? taskId} » porte ${fmt(s.engagedCents)} de charges sans part de budget.` });
  }
  if (fig.unsharedChargesCents) out.push({ code: 'no-task', level: 'info', taskId: null, message: `${fmt(fig.unsharedChargesCents)} de charges du projet ne sont reliées à aucune tâche.` });
  return out;
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
export const projectVariables = [
  {
    name: 'projets.chargesReglees',
    label: 'Charges des projets validées',
    unit: 'EUR',
    description:
      'Charges des projets de la vie validées comme réglées pour leurs besoins (opérations réglées des Budgets standards auxquels le budget de vie attribue un montant, depuis la date d’attribution), datées dans la période par leur date réelle. Une charge de projet non validée n’est pas comptée.',
    resolve(ctx) {
      if (!ctx.budgetId) return { value: null, sources: [], note: 'Aucun Budget dans le contexte' };
      if (!ctx.period) return { value: null, sources: [], note: 'Aucune période : cycle à configurer' };
      const { start, end } = ctx.period;
      const standards = Object.values(ctx.state.budgets).filter((b) => b.parentBudgetId === ctx.budgetId && inRegime(b));
      const lines = [];
      for (const b of standards) {
        for (const o of Object.values(ctx.state.operations)) {
          if (isValidatedCharge(o, b) && o.realizedDate >= start && o.realizedDate <= end) lines.push({ o, b });
        }
      }
      lines.sort((x, y) => x.o.realizedDate.localeCompare(y.o.realizedDate));
      return {
        value: sum(lines, (l) => l.o.realizedAmountCents) / 100,
        sources: lines.map(({ o, b }) => ({ id: o.id, kind: 'operation', label: `${o.label} · ${b.name}`, amount: o.realizedAmountCents / 100, date: o.realizedDate, status: 'realized' })),
        note: lines.length ? null : 'Aucune charge de projet validée dans la période',
      };
    },
  },
];

/** Crée le revenu de retour d'une tâche dans le budget de vie (ponctuel ou récurrent), dans la transaction. */
function triggerReturn(tx, socle, b, task, ret) {
  const { budget } = socle.modules;
  const centers = budget.costCentersOf(tx.draft, tx.userId).filter((c) => c.direction === 'income');
  const center = centers.find((c) => c.ref === 'std:autresRevenus') ?? centers[0];
  if (!center) return { module: 'bpm', kind: 'projectReturn', message: `Retour de « ${task.title} » non créé : aucun centre de revenus pour ce user.`, ids: [] };
  const now = today();
  const input = {
    budgetId: b.parentBudgetId,
    direction: 'income',
    label: ret.label,
    amount: ret.amountCents / 100,
    costCenterRef: center.ref,
    note: `Retour du projet « ${b.name} » à la complétion de « ${task.title} ».`,
  };
  const entry = ret.cadence === 'once' ? budget.buildOperation(tx, { ...input, date: now, status: 'planned' }) : budget.buildRecurrence(tx, { ...input, cadence: ret.cadence, firstDate: now });
  socle.om.update(tx, b, { taskReturns: { ...returnsOf(b), [task.id]: { ...ret, entryId: entry.id, entryKind: entry.kind, triggeredAt: now } } });
  const when = ret.cadence === 'once' ? `prévu le ${now}` : `${CADENCE_LABEL[ret.cadence].toLowerCase()}, dès le ${now}`;
  return { module: 'bpm', kind: 'projectReturn', message: `Retour au budget de vie enregistré : « ${ret.label} », ${fmt(ret.amountCents)} (${when}).`, ids: [entry.id] };
}

/** Extensions consommées par le noyau (rattachement, état d'une tâche) et par Budget (validation d'un règlement). */
export const projectExtensions = {
  /** Une tâche qui porte des données du budget de son projet ne change pas de projet tant qu'elles existent. */
  taskMoveGuard(state, { task, fromProjectId }) {
    const b = fromProjectId ? standardOfProject(state, fromProjectId) : null;
    if (!b) return;
    const links = [];
    if (task.id in sharesOf(b)) links.push('une part de budget');
    if (task.id in returnsOf(b)) links.push('un retour au budget de vie');
    const entries = Object.values(state.operations).filter((o) => o.taskId === task.id).length + Object.values(state.recurrences ?? {}).filter((r) => r.taskId === task.id).length;
    if (entries) links.push(entries > 1 ? `${entries} dépenses ou entrées` : 'une dépense ou entrée');
    if (links.length) {
      fail('FORBIDDEN_BY_RULE', `« ${task.title} » porte des données du budget du projet « ${b.name} » (${links.join(', ')}) : retirez-les avant de changer la tâche de projet.`, {
        field: 'projectId',
        taskId: task.id,
        budgetId: b.id,
        links,
      });
    }
  },

  /** Une tâche terminée déclenche son retour au budget de vie, une seule fois. */
  onTaskStatusChange(tx, { task }, socle) {
    if (task.status !== 'done' || !task.projectId) return [];
    const b = standardOfProject(tx.draft, task.projectId);
    const ret = b ? returnsOf(b)[task.id] : null;
    if (!ret || ret.entryId) return [];
    return [triggerReturn(tx, socle, b, task, ret)];
  },

  /** Valider un règlement qui ferait dépasser le budget du projet exige l'autorisation du budget de vie. */
  settlementGuard(state, { budgetId, direction, amountCents, realizedDate, taskId, operationId, recurrenceId, occurrenceDate }) {
    const b = state.budgets[budgetId];
    if (direction !== 'charge' || !inRegime(b) || realizedDate < b.allocationDate) return;
    const fig = projectBudget(state, b);
    const after = fig.paidCents + amountCents;
    if (after <= fig.ceilingCents) return;
    fail(
      'OVERRUN_AUTHORIZATION_REQUIRED',
      `Ce règlement porterait les dépenses réglées du projet « ${b.name} » à ${fmt(after)}, au-delà de son budget (${fmt(fig.ceilingCents)}) : le budget de vie doit autoriser un dépassement de ${fmt(after - fig.ceilingCents)}.`,
      { reason: 'reglement', budgetId, taskId: taskId ?? null, overrunCents: after - fig.ceilingCents, paidCents: fig.paidCents, ceilingCents: fig.ceilingCents, amountCents, operationId: operationId ?? null, recurrenceId: recurrenceId ?? null, occurrenceDate: occurrenceDate ?? null },
    );
  },
};

/**
 * Service des projets de l'application BPM.
 * @param socle socle complet
 * @param h     helpers du module BPM : requireComposition, cycleState
 */
export function createProjects(socle, h) {
  const { om } = socle;
  const core = () => socle.modules.core;
  const budgetModule = () => socle.modules.budget;

  /** Budget standard du user, enfant de son budget de vie. */
  function standardOf(state, userId, budgetId) {
    const b = om.owned(state, 'budget', budgetId, userId);
    const comp = compositionOf(state, userId);
    if (b.role !== 'standard' || b.parentBudgetId !== comp?.budgetId) fail('INCOMPATIBLE_REFERENCE', 'Ce Budget n’est pas un projet standard de votre budget de vie.', { field: 'budgetId', budgetId });
    return b;
  }

  function taskOf(state, userId, b, taskId) {
    const t = om.owned(state, 'task', taskId, userId);
    if (t.projectId !== b.coreProjectId) fail('INCOMPATIBLE_REFERENCE', `La tâche doit appartenir au projet « ${b.name} ».`, { field: 'taskId', taskId });
    return t;
  }

  /** Période du cycle du budget de vie qui contient une date, ou null si le cycle est à configurer. */
  function periodOf(state, userId, ymd) {
    const comp = compositionOf(state, userId);
    const cycle = comp ? cycleOf(state, comp.id) : null;
    return cycle?.state === 'active' ? periodContaining(ymd, cycle.anchorDay) : null;
  }

  function overrunRefusal(b, fig, sharesAfter, taskId) {
    const over = sharesAfter - fig.ceilingCents;
    fail('OVERRUN_AUTHORIZATION_REQUIRED', `Cette part porterait la ventilation du projet « ${b.name} » à ${fmt(sharesAfter)}, au-delà de son budget (${fmt(fig.ceilingCents)}) : le budget de vie doit autoriser un dépassement de ${fmt(over)}.`, {
      reason: 'ventilation',
      budgetId: b.id,
      taskId,
      overrunCents: over,
      sharesCents: fig.sharesCents,
      ceilingCents: fig.ceilingCents,
    });
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
      deficitCount: figs.filter((f) => f.deficit).length,
      pendingRequests: overruns.filter((x) => x.status === 'pending').map((x) => overrunView(state, x)),
      billable: billable.map((x) => overrunView(state, x)),
      billableCents: sum(billable, (x) => x.amountCents),
      nextBillingDate: overruns.filter((x) => x.status === 'approved' && x.billingDate > now).map((x) => x.billingDate).sort()[0] ?? null,
    };
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
      lifeProject: projectCard(state, comp.coreProjectId, 'life', null),
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
    const share = fig ? fig.shares[t.id] ?? null : null;
    const s = fig?.byTask[t.id] ?? null;
    const ret = fig?.returns[t.id] ?? null;
    return {
      ...view,
      projectRole: fig ? 'standard' : t.projectId && figsByProject.lifeRoot === t.projectId ? 'life' : null,
      budgetId: fig?.budgetId ?? null,
      budget: fig
        ? {
            shareCents: share,
            engagedCents: s?.engagedCents ?? 0,
            paidCents: s?.paidCents ?? 0,
            remainingCents: share === null ? null : share - (s?.paidCents ?? 0),
            over: share !== null && (s?.paidCents ?? 0) > share,
            unbounded: s?.unbounded ?? false,
            return: ret ? { ...ret, cadenceLabel: CADENCE_LABEL[ret.cadence] } : null,
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
    const fig = b ? figs.get(coreProjectId) : null;
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
      overruns: b ? overrunsOf(state, b.id).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).map((x) => overrunView(state, x)) : [],
      checks: b ? cycleChecks(state, b, fig) : [],
      charges: [],
      life: null,
    };
    if (b) {
      const lines = budgetModule().budgetLines(state, [b.id], { from: addDays(now, -365), to: addDays(now, 365), by: 'planned' });
      out.charges = lines
        .filter((l) => l.direction === 'charge')
        .map((l) => {
          const v = budgetModule().lineView(state, l);
          return { ...v, validated: l.settled && inRegime(b) && l.realizedDate >= b.allocationDate, beforeAllocation: l.settled && inRegime(b) && l.realizedDate < b.allocationDate };
        });
    } else {
      out.life = {
        ...lifeSummary(state, comp, standards, now),
        projects: standards.map((x) => ({ projectId: x.coreProjectId, title: state.coreProjects[x.coreProjectId]?.title ?? x.name, budget: figs.get(x.coreProjectId) })),
      };
    }
    return out;
  }

  // ---------- commandes ----------

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

  /**
   * Montant attribué par le budget de vie (charge non récurrente spéciale du budget de vie). La première attribution
   * fixe la date à partir de laquelle les charges validées du projet comptent dans le budget de vie.
   */
  async function allocate(ctx, budgetId, input = {}) {
    await om.command('allocateProjectBudget', ctx, input, (tx) => {
      const b = standardOf(tx.draft, tx.userId, budgetId);
      om.checkRevision(b, expectedRevisionOf(input));
      const cents = money('amount', input.amount);
      const fig = projectBudget(tx.draft, b);
      if (fig.regime) {
        const billed = fig.billedOverrunCents;
        if (cents < billed) fail('FORBIDDEN_BY_RULE', `Le budget attribué ne peut pas descendre sous les dépassements déjà facturés (${fmt(billed)}).`, { field: 'amount' });
        if (cents + fig.approvedOverrunCents < fig.sharesCents) fail('FORBIDDEN_BY_RULE', `Les parts des tâches (${fmt(fig.sharesCents)}) dépassent ce montant : réduisez d’abord les parts.`, { field: 'amount', sharesCents: fig.sharesCents });
        if (cents + fig.approvedOverrunCents < fig.paidCents) fail('FORBIDDEN_BY_RULE', `Les dépenses déjà réglées du projet (${fmt(fig.paidCents)}) dépassent ce montant.`, { field: 'amount', paidCents: fig.paidCents });
        if (cents === b.allocationCents) {
          tx.unchanged = true;
          return {};
        }
        om.update(tx, b, { allocationCents: cents });
      } else {
        om.update(tx, b, { allocationCents: cents, allocationDate: today(), taskSharesCents: sharesOf(b), taskReturns: returnsOf(b) });
      }
      return { budgetId };
    });
    return projectDetail(ctx, socle.state.budgets[budgetId].coreProjectId);
  }

  /** Part du budget du projet réservée à une tâche ; `amount: null` la retire. Le budget du projet s'en trouve décrémenté. */
  async function setTaskShare(ctx, budgetId, taskId, input = {}) {
    await om.command('setTaskShare', ctx, input, (tx) => {
      const b = standardOf(tx.draft, tx.userId, budgetId);
      om.checkRevision(b, expectedRevisionOf(input));
      if (!inRegime(b)) fail('FORBIDDEN_BY_RULE', 'Attribuez d’abord un budget à ce projet depuis le budget de vie.', { field: 'amount' });
      taskOf(tx.draft, tx.userId, b, taskId);
      const cents = money('amount', input.amount, { nullable: true });
      const shares = { ...sharesOf(b) };
      if (cents === null) delete shares[taskId];
      else shares[taskId] = cents;
      if (cents === (sharesOf(b)[taskId] ?? null)) {
        tx.unchanged = true;
        return {};
      }
      const fig = projectBudget(tx.draft, b);
      const after = sum(Object.values(shares));
      if (cents !== null && after > fig.ceilingCents && after > fig.sharesCents) overrunRefusal(b, fig, after, taskId);
      om.update(tx, b, { taskSharesCents: shares });
      return { budgetId };
    });
    return projectDetail(ctx, socle.state.budgets[budgetId].coreProjectId);
  }

  /** Retour d'une tâche vers le budget de vie (revenu ponctuel ou récurrent), créé quand la tâche est terminée. */
  async function setTaskReturn(ctx, budgetId, taskId, input = {}) {
    const effects = [];
    await om.command('setTaskReturn', ctx, input, (tx) => {
      const b = standardOf(tx.draft, tx.userId, budgetId);
      om.checkRevision(b, expectedRevisionOf(input));
      const t = taskOf(tx.draft, tx.userId, b, taskId);
      const returns = { ...returnsOf(b) };
      const current = returns[taskId] ?? null;
      const cents = money('amount', input.amount, { nullable: true, positive: input.amount !== null && input.amount !== undefined && input.amount !== '' });
      if (cents === null) {
        if (!current) {
          tx.unchanged = true;
          return {};
        }
        delete returns[taskId];
        om.update(tx, b, { taskReturns: returns });
        return { budgetId };
      }
      if (current?.entryId) fail('FORBIDDEN_BY_RULE', 'Ce retour est déjà enregistré dans le budget de vie : modifiez-le depuis les entrées du budget de vie.', { field: 'amount', entryId: current.entryId });
      const ret = {
        label: text('label', input.label, { max: 200 }) || `Retour · ${t.title}`,
        amountCents: cents,
        cadence: oneOf('cadence', input.cadence, RETURN_CADENCES, 'once'),
        entryId: null,
        entryKind: null,
        triggeredAt: null,
      };
      returns[taskId] = ret;
      om.update(tx, b, { taskReturns: returns });
      // Tâche déjà terminée : le retour est dû tout de suite.
      if (t.status === 'done') effects.push(triggerReturn(tx, socle, b, t, ret));
      return { budgetId };
    });
    return { ...projectDetail(ctx, socle.state.budgets[budgetId].coreProjectId), effects };
  }

  /** Demande d'autorisation de dépassement adressée au budget de vie (une demande en attente par projet). */
  async function requestOverrun(ctx, budgetId, input = {}) {
    const r = await om.command(
      'requestProjectOverrun',
      ctx,
      input,
      (tx) => {
        const b = standardOf(tx.draft, tx.userId, budgetId);
        if (!inRegime(b)) fail('FORBIDDEN_BY_RULE', 'Ce projet n’a pas de budget attribué : attribuez-lui d’abord un montant.', { field: 'budgetId' });
        if (overrunsOf(tx.draft, b.id).some((x) => x.status === 'pending')) fail('UNIQUENESS_VIOLATION', 'Une demande de dépassement de ce projet attend déjà la décision du budget de vie.', { budgetId });
        const taskId = input.taskId ? taskOf(tx.draft, tx.userId, b, input.taskId).id : null;
        const x = om.create(tx, 'projectOverrun', {
          budgetId: b.id,
          taskId,
          reason: oneOf('reason', input.reason, Object.keys(OVERRUN_REASONS)),
          amountCents: money('amount', input.amount, { positive: true }),
          note: text('note', input.note, { max: 1000 }) || null,
          status: 'pending',
          requestedAt: today(),
          decidedAt: null,
          billingDate: null,
          periodKey: null,
          billedAt: null,
        });
        return { overrunId: x.id, budgetId: b.id };
      },
      { creation: true },
    );
    return { ...r, overrun: overrunView(socle.state, socle.state.projectOverruns[r.overrunId]) };
  }

  /**
   * Décision du budget de vie. Autoriser : le projet passe en déficit (rouge), son plafond augmente du montant
   * autorisé et la charge de dépassement sera facturée au budget de vie à la fin de la période en cours du cycle.
   */
  async function decideOverrun(ctx, id, input = {}) {
    await om.command('decideProjectOverrun', ctx, input, (tx) => {
      const x = om.owned(tx.draft, 'projectOverrun', id, tx.userId);
      om.checkRevision(x, expectedRevisionOf(input));
      if (x.status !== 'pending') fail('FORBIDDEN_BY_RULE', 'Cette demande a déjà reçu une décision.', { status: x.status });
      const decision = oneOf('decision', input.decision, ['approve', 'refuse']);
      const now = today();
      if (decision === 'refuse') om.update(tx, x, { status: 'refused', decidedAt: now });
      else {
        const period = periodOf(tx.draft, tx.userId, now);
        om.update(tx, x, { status: 'approved', decidedAt: now, billingDate: period?.end ?? null, periodKey: period?.key ?? null });
      }
      return { overrunId: id };
    });
    const x = socle.state.projectOverruns[id];
    return { overrun: overrunView(socle.state, x), detail: projectDetail(ctx, socle.state.budgets[x.budgetId].coreProjectId) };
  }

  /**
   * Fin de cycle : les dépassements autorisés dont la date de facturation est atteinte sont facturés au budget de vie ;
   * le budget attribué de chaque projet concerné intègre ces montants, son déficit est soldé et ses contrôles de fin
   * de cycle (budget = somme des parts, charges des tâches planifiées et à jour) sont rendus.
   */
  async function billOverruns(ctx, input = {}) {
    const touched = new Set();
    await om.command('billProjectOverruns', ctx, input, (tx) => {
      const comp = compositionOf(tx.draft, tx.userId);
      if (!comp) fail('NOT_FOUND', 'Espace BPM à préparer.');
      const now = today();
      const due = om.list(tx.draft, 'projectOverrun', (x) => x.userId === tx.userId && x.status === 'approved' && (!input.budgetId || x.budgetId === input.budgetId));
      const billable = due.filter((x) => !x.billingDate || x.billingDate <= now);
      if (!billable.length) {
        const next = due.map((x) => x.billingDate).filter(Boolean).sort()[0];
        fail('FORBIDDEN_BY_RULE', next ? `Aucun dépassement à facturer avant la fin du cycle (${next}).` : 'Aucun dépassement autorisé à facturer.', { nextBillingDate: next ?? null });
      }
      for (const x of billable) {
        const b = tx.draft.budgets[x.budgetId];
        om.update(tx, b, { allocationCents: b.allocationCents + x.amountCents });
        om.update(tx, x, { status: 'billed', billedAt: now });
        touched.add(b.id);
      }
      return { billed: billable.map((x) => x.id) };
    });
    const state = socle.state;
    return {
      projects: [...touched].map((id) => {
        const b = state.budgets[id];
        const fig = projectBudget(state, b);
        return { budgetId: id, name: b.name, coreProjectId: b.coreProjectId, allocationCents: fig.allocationCents, billedOverrunCents: fig.billedOverrunCents, checks: cycleChecks(state, b, fig) };
      }),
    };
  }

  return { overview, tasksOverview, projectDetail, adoptProject, allocate, setTaskShare, setTaskReturn, requestOverrun, decideOverrun, billOverruns };
}
