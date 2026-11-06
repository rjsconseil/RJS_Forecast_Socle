// Financement des projets de la vie — middleware Budget (niveau 2).
//
// Le budget de vie (Budget « Projet de vie ») attribue une enveloppe à chacun de ses Budgets standards ; chaque projet
// la répartit en parts de ses tâches ; tout dépassement est autorisé par le budget de vie, puis facturé à la fin de la
// période du cycle ; une tâche terminée peut retourner un revenu au budget de vie. Ce module porte les règles, les
// chiffres et les commandes de ce financement. L'application BPM (niveau 3) les présente et les enchaîne ; elle fournit
// la seule donnée qu'elle porte : la période du cycle (extension `fundingPeriod`).
//
// Charges de projet [P] : seules les charges qu'un projet a validées comme réglées depuis la date d'attribution
// comptent dans les dépenses du budget de vie, à leur date réelle.
import { fail } from '../../socle/errors.mjs';
import { today } from '../../socle/clock.mjs';
import { expectedRevisionOf, money, oneOf, text } from '../../socle/validation.mjs';
import { CADENCE_LABEL, CADENCES, occurrenceDates } from './recurrence.mjs';

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
  approved: 'Autorisé · facturé au budget de vie en fin de cycle',
  refused: 'Refusé par le budget de vie',
  billed: 'Facturé au budget de vie',
};
const RETURN_CADENCES = ['once', ...CADENCES];
/** Engagé d'une récurrence sans date de fin : ses occurrences des 12 prochains mois [P]. */
const HORIZON_DAYS = 365;


/** Projet standard financé par le budget de vie : un montant lui est attribué (régime des charges de projet). */
export const inRegime = (b) => b?.role === 'standard' && Number.isInteger(b.allocationCents) && typeof b.allocationDate === 'string';
export const standardOfProject = (state, coreProjectId) => Object.values(state.budgets).find((b) => b.role === 'standard' && b.coreProjectId === coreProjectId) ?? null;
export const sharesOf = (b) => b.taskSharesCents ?? {};
export const returnsOf = (b) => b.taskReturns ?? {};
export const overrunsOf = (state, budgetId) => Object.values(state.projectOverruns ?? {}).filter((x) => x.budgetId === budgetId);
export const requestsOf = (state, budgetId) => Object.values(state.taskBudgetRequests ?? {}).filter((x) => x.budgetId === budgetId);
export const openRequest = (x) => ['pending', 'awaiting-life'].includes(x.status);
export const REQUEST_STATUS = { pending: 'À valider par le projet', 'awaiting-life': 'Autorisation du budget du projet de vie attendue', approved: 'Montant accordé', refused: 'Demande refusée', cancelled: 'Demande annulée' };

export function requestView(state, x) {
  const b = state.budgets[x.budgetId];
  return { ...structuredClone(x), statusLabel: REQUEST_STATUS[x.status], taskTitle: state.tasks[x.taskId]?.title ?? '', budgetName: b?.name ?? '', coreProjectId: b?.coreProjectId ?? null, grantedCents: sharesOf(b ?? {})[x.taskId] ?? null };
}

/** Charge d'un projet validée comme réglée pour ses besoins, depuis l'attribution : comptée dans le budget de vie. */
export const isValidatedCharge = (o, b) => inRegime(b) && o.budgetId === b.id && o.direction === 'charge' && o.status === 'realized' && o.realizedDate >= b.allocationDate;

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
    life: null,
  };
}


/** Crée le revenu de retour d'une tâche dans le budget de vie (ponctuel ou récurrent), dans la transaction. */
function triggerReturn(tx, socle, b, task, ret) {
  const { budget } = socle.modules;
  const centers = budget.costCentersOf(tx.draft, tx.userId).filter((c) => c.direction === 'income');
  const center = centers.find((c) => c.ref === 'std:autresRevenus') ?? centers[0];
  if (!center) return { module: 'budget', kind: 'projectReturn', message: `Retour de « ${task.title} » non créé : aucun centre de revenus pour ce user.`, ids: [] };
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
  return { module: 'budget', kind: 'projectReturn', message: `Retour au budget de vie enregistré : « ${ret.label} », ${fmt(ret.amountCents)} (${when}).`, ids: [entry.id] };
}

/** Demande de dépassement en attente d'un projet, réduite à ce qu'il faut pour la décider depuis un autre écran. */
/**
 * Chiffres de financement d'une tâche, lus dans les chiffres de son projet : part, engagé, réglé, reste, charges
 * prévues non réglées et part inutilisée d'une tâche terminée (à rendre à l'enveloppe).
 */
export function taskFunding(state, fig, taskId) {
  const share = fig.shares[taskId] ?? null;
  const s = fig.byTask[taskId] ?? { engagedCents: 0, paidCents: 0, unbounded: false };
  const openCents = s.engagedCents - s.paidCents;
  const done = state.tasks[taskId]?.status === 'done';
  return {
    shareCents: share,
    engagedCents: s.engagedCents,
    paidCents: s.paidCents,
    openCents,
    remainingCents: share === null ? null : share - s.paidCents,
    over: share !== null && s.paidCents > share,
    unbounded: s.unbounded,
    paidBeforeCents: fig.beforeByTask?.[taskId] ?? 0,
    unusedCents: done && share !== null && openCents <= 0 && s.paidCents < share ? share - s.paidCents : 0,
  };
}

export function pendingOf(state, fig) {
  const x = fig.pendingOverrun;
  if (!x) return null;
  const request = x.taskBudgetRequestId ? state.taskBudgetRequests?.[x.taskBudgetRequestId] : null;
  return { id: x.id, revision: x.revision, amountCents: x.amountCents, reason: x.reason, taskId: x.taskId ?? null, taskTitle: x.taskTitle ?? null, requestCents: request?.amountCents ?? null };
}

/** Demande de dépassement en attente du projet, et si l'autoriser couvre la part nécessaire à la tâche. */
function pendingFor(state, fig, taskId, neededCents) {
  const pending = pendingOf(state, fig);
  return { pendingOverrun: pending, pendingCovers: !!pending && pending.taskId === taskId && (pending.requestCents ?? 0) >= neededCents };
}

/** Extensions consommées par le noyau (rattachement, état d'une tâche) et par Budget lui-même (validation d'un règlement). */
export const fundingExtensions = {
  /** Une tâche qui porte des données du budget de son projet ne change pas de projet tant qu'elles existent. */
  taskMoveGuard(state, { task, fromProjectId }) {
    const b = fromProjectId ? standardOfProject(state, fromProjectId) : null;
    if (!b) return;
    const links = [];
    if (task.id in sharesOf(b)) links.push('une part de budget');
    if (task.id in returnsOf(b)) links.push('un retour au budget de vie');
    if (requestsOf(state, b.id).some((x) => x.taskId === task.id && openRequest(x))) links.push('une demande de montant en attente (à annuler avant le rattachement)');
    const entries = Object.values(state.operations).filter((o) => o.taskId === task.id).length + Object.values(state.recurrences ?? {}).filter((r) => r.taskId === task.id).length;
    if (entries) links.push(entries > 1 ? `${entries} dépenses ou entrées` : 'une dépense ou entrée');
    if (links.length) {
      fail('FORBIDDEN_BY_RULE', `« ${task.title} » porte des données de l’enveloppe du projet « ${b.name} » (${links.join(', ')}) : retirez-les avant de changer la tâche de projet.`, {
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
    const previous = operationId ? state.operations[operationId] : null;
    const previousPaid = previous && isValidatedCharge(previous, b) ? previous.realizedAmountCents : 0;
    // Une dépense réellement réglée avant la première attribution reste dans l'historique du projet,
    // hors enveloppe et hors parts. La date de saisie ne doit pas la faire financer rétroactivement.
    if (inRegime(b) && realizedDate < b.allocationDate) return;
    if (direction === 'charge' && b?.taskFundingRequired) {
      if (!inRegime(b)) fail('FORBIDDEN_BY_RULE', `Attribuez d’abord une enveloppe au projet « ${b.name} » : ses dépenses se règlent sur les parts de ses tâches.`, { field: 'budgetId', budgetId });
      if (!taskId || state.tasks[taskId]?.projectId !== b.coreProjectId) fail('FORBIDDEN_BY_RULE', `Reliez cette dépense à une tâche du projet « ${b.name} » avant de la régler : chaque règlement consomme la part d’une tâche.`, { field: 'taskId', budgetId });
      const sfig = fundingFigures(state, b);
      const taskPaid = (sfig.byTask[taskId]?.paidCents ?? 0) - (previous?.taskId === taskId ? previousPaid : 0);
      const share = sharesOf(b)[taskId] ?? null;
      if (taskPaid + amountCents > (share ?? 0)) {
        const title = state.tasks[taskId]?.title ?? 'la tâche';
        const needed = taskPaid + amountCents;
        fail(
          'FORBIDDEN_BY_RULE',
          share === null
            ? `« ${title} » n’a pas encore de part de l’enveloppe : accordez-lui au moins ${fmt(needed)} pour régler cette dépense.`
            : `« ${title} » : part de ${fmt(share)}, déjà ${fmt(taskPaid)} réglés ; ce règlement de ${fmt(amountCents)} la dépasserait de ${fmt(needed - share)}. Portez sa part à ${fmt(needed)} pour le régler.`,
          { reason: 'task-share', field: 'taskId', budgetId, budgetRevision: b.revision, taskId, taskTitle: title, shareCents: share, paidCents: taskPaid, amountCents, neededCents: needed, availableCents: sfig.availableCents, grantOverrunCents: Math.max(0, needed - (share ?? 0) - sfig.availableCents), ...pendingFor(state, sfig, taskId, needed) },
        );
      }
    }
    if (direction !== 'charge' || !inRegime(b) || realizedDate < b.allocationDate) return;
    const fig = fundingFigures(state, b);
    const after = fig.paidCents - previousPaid + amountCents;
    if (after <= fig.ceilingCents) return;
    fail(
      'OVERRUN_AUTHORIZATION_REQUIRED',
      `Ce règlement porterait les dépenses réglées du projet « ${b.name} » à ${fmt(after)}, au-delà de son enveloppe (${fmt(fig.ceilingCents)}) : le projet de vie doit autoriser un dépassement de ${fmt(after - fig.ceilingCents)}.`,
      { reason: 'reglement', budgetId, taskId: taskId ?? null, overrunCents: after - fig.ceilingCents, paidCents: fig.paidCents, ceilingCents: fig.ceilingCents, amountCents, operationId: operationId ?? null, recurrenceId: recurrenceId ?? null, occurrenceDate: occurrenceDate ?? null },
    );
  },
};


/**
 * Commandes du financement des projets. Elles écrivent par Object Management et rendent l'essentiel (identifiants,
 * avertissement) : la lecture détaillée d'un projet reste celle de l'application.
 * @param socle        socle complet
 * @param lifeBudgetOf (state, userId) => Budget « Projet de vie » du user
 */
export function createFunding(socle, { lifeBudgetOf }) {
  const { om } = socle;

  /** Budget standard du user, enfant de son budget de vie. */
  function standardOf(state, userId, budgetId) {
    const b = om.owned(state, 'budget', budgetId, userId);
    const life = lifeBudgetOf(state, userId);
    if (b.role === 'life' && b.id === life?.id) fail('FORBIDDEN_BY_RULE', 'Le budget de vie est non standard : ses ressources sont les entrées du cycle et il finance ses projets fils ; il ne reçoit ni enveloppe, ni part de tâche, ni dépassement.', { field: 'budgetId', budgetId, kind: 'life' });
    if (b.role !== 'standard' || b.parentBudgetId !== life?.id) fail('INCOMPATIBLE_REFERENCE', 'Ce Budget n’est pas un projet standard de votre budget de vie.', { field: 'budgetId', budgetId });
    return b;
  }

  function taskOf(state, userId, b, taskId) {
    const t = om.owned(state, 'task', taskId, userId);
    if (t.projectId !== b.coreProjectId) fail('INCOMPATIBLE_REFERENCE', `La tâche doit appartenir au projet « ${b.name} ».`, { field: 'taskId', taskId });
    return t;
  }

  /** Période du cycle qui contient une date, fournie par l'application (extension `fundingPeriod`), ou null. */
  function periodOf(state, userId, ymd) {
    for (const ext of socle.registry.extensions('fundingPeriod')) {
      const p = ext(state, userId, ymd, socle);
      if (p) return p;
    }
    return null;
  }

  function overrunRefusal(b, fig, sharesAfter, taskId) {
    const over = sharesAfter - fig.ceilingCents;
    fail('OVERRUN_AUTHORIZATION_REQUIRED', `Cette part porterait la ventilation du projet « ${b.name} » à ${fmt(sharesAfter)}, au-delà de son enveloppe (${fmt(fig.ceilingCents)}) : le projet de vie doit autoriser un dépassement de ${fmt(over)}.`, {
      reason: 'ventilation',
      budgetId: b.id,
      taskId,
      overrunCents: over,
      sharesCents: fig.sharesCents,
      ceilingCents: fig.ceilingCents,
    });
  }


  /** Champs d'une autorisation : facturation à la fin de la période du cycle en cours. */
  function approval(state, userId) {
    const now = today();
    const period = periodOf(state, userId, now);
    return { status: 'approved', decidedAt: now, billingDate: period?.end ?? null, periodKey: period?.key ?? null };
  }

  /** Une seule demande de dépassement en attente par projet. */
  function noPendingOverrun(state, b) {
    if (!overrunsOf(state, b.id).some((x) => x.status === 'pending')) return;
    const pending = pendingOf(state, fundingFigures(state, b));
    fail('UNIQUENESS_VIOLATION', `Une demande de dépassement de ${fmt(pending.amountCents)}${pending.taskTitle ? ` pour « ${pending.taskTitle} »` : ''} attend déjà la décision du projet de vie : décidez-la d’abord (Projet de vie › Décisions attendues).`, { budgetId: b.id, pendingOverrun: pending });
  }

  function newOverrun(tx, b, { taskId, reason, amountCents, note, approve }) {
    noPendingOverrun(tx.draft, b);
    return om.create(tx, 'projectOverrun', {
      budgetId: b.id,
      taskId,
      reason,
      amountCents,
      note,
      status: 'pending',
      requestedAt: today(),
      decidedAt: null,
      billingDate: null,
      periodKey: null,
      billedAt: null,
      ...(approve ? approval(tx.draft, tx.userId) : {}),
    });
  }

  async function requestTaskBudget(ctx, budgetId, taskId, input = {}) {
    const r = await om.command('requestTaskBudget', ctx, input, (tx) => {
      const b = standardOf(tx.draft, tx.userId, budgetId);
      taskOf(tx.draft, tx.userId, b, taskId);
      if (requestsOf(tx.draft, b.id).some((x) => x.taskId === taskId && openRequest(x))) fail('UNIQUENESS_VIOLATION', 'Cette tâche a déjà une demande en attente.');
      const amountCents = money('amount', input.amount, { positive: true });
      if (amountCents <= (sharesOf(b)[taskId] ?? 0)) fail('FORBIDDEN_BY_RULE', 'Le montant total demandé doit dépasser la part déjà accordée à la tâche.', { field: 'amount' });
      const x = om.create(tx, 'taskBudgetRequest', { budgetId, taskId, amountCents, note: text('note', input.note, { max: 1000 }) || null, status: 'pending', requestedAt: today(), decidedAt: null, overrunId: null });
      return { requestId: x.id };
    }, { creation: true });
    return { ...r, request: requestView(socle.state, socle.state.taskBudgetRequests[r.requestId]) };
  }

  /** Valider accorde la part, ou transmet le seul manque au budget du projet de vie, sans dépense. */
  async function decideTaskBudget(ctx, id, input = {}) {
    await om.command('decideTaskBudget', ctx, input, (tx) => {
      const x = om.owned(tx.draft, 'taskBudgetRequest', id, tx.userId);
      om.checkRevision(x, expectedRevisionOf(input));
      const b = standardOf(tx.draft, tx.userId, x.budgetId);
      taskOf(tx.draft, tx.userId, b, x.taskId);
      if (!openRequest(x)) fail('FORBIDDEN_BY_RULE', 'Cette demande est déjà traitée.');
      const decision = oneOf('decision', input.decision, ['approve', 'refuse', 'cancel']);
      if (decision !== 'approve') {
        const overrun = tx.draft.projectOverruns[x.overrunId];
        if (overrun?.status === 'pending') om.update(tx, overrun, { status: 'refused', decidedAt: today() });
        om.update(tx, x, { status: decision === 'cancel' ? 'cancelled' : 'refused', decidedAt: today() });
        return { requestId: id };
      }
      if (x.status !== 'pending') fail('FORBIDDEN_BY_RULE', 'Le budget du projet de vie doit d’abord décider du dépassement.');
      om.checkRevision(b, expectedRevisionOf({ expectedRevision: input.expectedBudgetRevision }));
      if (!inRegime(b)) fail('FORBIDDEN_BY_RULE', 'Attribuez d’abord une enveloppe au projet : les parts des tâches s’y répartissent.');
      const fig = fundingFigures(tx.draft, b);
      const after = fig.sharesCents - (fig.shares[x.taskId] ?? 0) + x.amountCents;
      if (after <= fig.ceilingCents) {
        grantRequest(tx, b, x);
      } else {
        if (fig.pendingOverrun) fail('UNIQUENESS_VIOLATION', `Une demande de dépassement de ${fmt(fig.pendingOverrun.amountCents)}${fig.pendingOverrun.taskTitle ? ` pour « ${fig.pendingOverrun.taskTitle} »` : ''} attend déjà la décision du projet de vie : décidez-la d’abord (Projet de vie › Décisions attendues).`, { pendingOverrun: pendingOf(tx.draft, fig) });
        const overrun = om.create(tx, 'projectOverrun', { budgetId: b.id, taskId: x.taskId, taskBudgetRequestId: x.id, reason: 'ventilation', amountCents: after - fig.ceilingCents, note: x.note, status: 'pending', requestedAt: today(), decidedAt: null, billingDate: null, periodKey: null, billedAt: null });
        om.update(tx, x, { status: 'awaiting-life', overrunId: overrun.id });
      }
      return { requestId: id };
    });
    return { request: requestView(socle.state, socle.state.taskBudgetRequests[id]) };
  }

  function grantRequest(tx, b, x) {
    const current = sharesOf(b)[x.taskId] ?? 0;
    // Une autre décision peut déjà avoir augmenté la part : ne jamais la réduire lors d'une approbation.
    om.update(tx, b, { taskSharesCents: { ...sharesOf(b), [x.taskId]: Math.max(current, x.amountCents) } });
    om.update(tx, x, { status: 'approved', decidedAt: today() });
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
      const fig = fundingFigures(tx.draft, b);
      if (fig.regime) {
        const billed = fig.billedOverrunCents;
        if (cents < billed) fail('FORBIDDEN_BY_RULE', `L’enveloppe ne peut pas descendre sous les dépassements déjà facturés (${fmt(billed)}).`, { field: 'amount' });
        if (cents + fig.approvedOverrunCents < fig.sharesCents) fail('FORBIDDEN_BY_RULE', `Les parts des tâches (${fmt(fig.sharesCents)}) dépassent ${fmt(cents + fig.approvedOverrunCents)} : réduisez d’abord des parts, ou gardez une enveloppe d’au moins ${fmt(fig.sharesCents - fig.approvedOverrunCents)}.`, { field: 'amount', sharesCents: fig.sharesCents });
        if (cents + fig.approvedOverrunCents < fig.paidCents) fail('FORBIDDEN_BY_RULE', `Les dépenses déjà réglées sur l’enveloppe (${fmt(fig.paidCents)}) dépassent ${fmt(cents + fig.approvedOverrunCents)} : gardez une enveloppe d’au moins ${fmt(fig.paidCents - fig.approvedOverrunCents)}.`, { field: 'amount', paidCents: fig.paidCents });
        if (cents === b.allocationCents) {
          tx.unchanged = true;
          return {};
        }
        om.update(tx, b, { allocationCents: cents });
      } else {
        if (cents === 0) fail('FORBIDDEN_BY_RULE', `Une enveloppe de 0 € ne permettrait de régler aucune dépense du projet « ${b.name} » : indiquez le montant prévu, ou laissez le projet sans enveloppe tant qu’il n’a rien à payer.`, { field: 'amount' });
        om.update(tx, b, { allocationCents: cents, allocationDate: today(), taskSharesCents: sharesOf(b), taskReturns: returnsOf(b) });
      }
      return { budgetId };
    });
    return { budgetId };
  }

  /**
   * Part du budget du projet réservée à une tâche ; `amount: null` la retire. Le budget du projet s'en trouve décrémenté.
   * `authorizeOverrun: true` : si la part dépasse l'enveloppe, le manque est autorisé en dépassement dans la même
   * écriture (le user pilote à la fois le projet et le projet de vie) ; sinon la commande le refuse.
   */
  async function setTaskShare(ctx, budgetId, taskId, input = {}) {
    let overrunCents = 0;
    await om.command('setTaskShare', ctx, input, (tx) => {
      const b = standardOf(tx.draft, tx.userId, budgetId);
      om.checkRevision(b, expectedRevisionOf(input));
      if (!inRegime(b)) fail('FORBIDDEN_BY_RULE', 'Attribuez d’abord une enveloppe à ce projet : les parts des tâches s’y répartissent.', { field: 'amount' });
      const t = taskOf(tx.draft, tx.userId, b, taskId);
      const cents = money('amount', input.amount, { nullable: true });
      const shares = { ...sharesOf(b) };
      if (cents === null) delete shares[taskId];
      else shares[taskId] = cents;
      if (cents === (sharesOf(b)[taskId] ?? null)) {
        tx.unchanged = true;
        return {};
      }
      const fig = fundingFigures(tx.draft, b);
      const after = sum(Object.values(shares));
      if ((cents ?? 0) < (fig.byTask[taskId]?.paidCents ?? 0)) fail('FORBIDDEN_BY_RULE', 'La part ne peut pas être inférieure aux dépenses déjà réglées de la tâche.', { field: 'amount' });
      if (cents !== null && after > fig.ceilingCents && after > fig.sharesCents) {
        if (input.authorizeOverrun !== true) overrunRefusal(b, fig, after, taskId);
        overrunCents = after - fig.ceilingCents;
        newOverrun(tx, b, { taskId, reason: 'ventilation', amountCents: overrunCents, note: text('note', input.note, { max: 1000 }) || `Part de « ${t.title} » portée à ${fmt(cents)}.`, approve: true });
      }
      om.update(tx, b, { taskSharesCents: shares });
      return { budgetId };
    });
    return { budgetId, overrunCents };
  }

  /** Tâche terminée sans charge restant à régler : sa part non consommée revient à l'enveloppe. */
  async function releaseTaskShare(ctx, budgetId, taskId, input = {}) {
    let released = null;
    await om.command('releaseTaskShare', ctx, input, (tx) => {
      const b = standardOf(tx.draft, tx.userId, budgetId);
      om.checkRevision(b, expectedRevisionOf(input));
      const t = taskOf(tx.draft, tx.userId, b, taskId);
      const f = taskFunding(tx.draft, fundingFigures(tx.draft, b), taskId);
      if (t.status !== 'done') fail('FORBIDDEN_BY_RULE', `« ${t.title} » n’est pas terminée : sa part reste réservée à ses dépenses.`, { taskId });
      if (f.openCents > 0) fail('FORBIDDEN_BY_RULE', `« ${t.title} » garde ${fmt(f.openCents)} de charges prévues non réglées : réglez-les ou retirez-les avant de rendre sa part.`, { taskId, openCents: f.openCents });
      if (!f.unusedCents) fail('FORBIDDEN_BY_RULE', `La part de « ${t.title} » est entièrement consommée : rien à rendre à l’enveloppe.`, { taskId });
      const shares = { ...sharesOf(b) };
      if (f.paidCents) shares[taskId] = f.paidCents;
      else delete shares[taskId];
      om.update(tx, b, { taskSharesCents: shares });
      released = { releasedCents: f.unusedCents, shareCents: f.paidCents || null, taskTitle: t.title };
      return { budgetId };
    });
    return { budgetId, ...released };
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
      // Conserver la trace d'un retour déclenché : la retirer permettrait de créer un second revenu
      // en reconfigurant la même tâche, y compris après une simple réouverture.
      if (current?.entryId) fail('FORBIDDEN_BY_RULE', 'Ce retour est déjà enregistré dans le budget de vie : modifiez ou annulez le revenu depuis les entrées du budget de vie. Sa trace reste liée à la tâche pour éviter de le créer une seconde fois.', { field: 'amount', entryId: current.entryId });
      if (cents === null) {
        if (!current) {
          tx.unchanged = true;
          return {};
        }
        delete returns[taskId];
        om.update(tx, b, { taskReturns: returns });
        return { budgetId };
      }
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
    return { budgetId, effects };
  }

  /**
   * Demande d'autorisation de dépassement adressée au budget de vie (une demande en attente par projet).
   * `approve: true` la demande et l'autorise d'une même écriture.
   */
  async function requestOverrun(ctx, budgetId, input = {}) {
    const r = await om.command(
      'requestProjectOverrun',
      ctx,
      input,
      (tx) => {
        const b = standardOf(tx.draft, tx.userId, budgetId);
        if (!inRegime(b)) fail('FORBIDDEN_BY_RULE', 'Ce projet n’a pas encore d’enveloppe : attribuez-la d’abord, un dépassement se demande ensuite.', { field: 'budgetId' });
        noPendingOverrun(tx.draft, b);
        const taskId = input.taskId ? taskOf(tx.draft, tx.userId, b, input.taskId).id : null;
        const x = newOverrun(tx, b, {
          taskId,
          reason: oneOf('reason', input.reason, Object.keys(OVERRUN_REASONS)),
          amountCents: money('amount', input.amount, { positive: true }),
          note: text('note', input.note, { max: 1000 }) || null,
          approve: input.approve === true,
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
    let notice = null;
    await om.command('decideProjectOverrun', ctx, input, (tx) => {
      const x = om.owned(tx.draft, 'projectOverrun', id, tx.userId);
      om.checkRevision(x, expectedRevisionOf(input));
      if (x.status !== 'pending') fail('FORBIDDEN_BY_RULE', 'Cette demande a déjà reçu une décision.', { status: x.status });
      const decision = oneOf('decision', input.decision, ['approve', 'refuse']);
      const now = today();
      om.update(tx, x, decision === 'refuse' ? { status: 'refused', decidedAt: now } : approval(tx.draft, tx.userId));
      const request = x.taskBudgetRequestId ? tx.draft.taskBudgetRequests[x.taskBudgetRequestId] : null;
      if (request?.status === 'awaiting-life') {
        const b = standardOf(tx.draft, tx.userId, x.budgetId);
        taskOf(tx.draft, tx.userId, b, request.taskId);
        if (decision === 'refuse') om.update(tx, request, { status: 'refused', decidedAt: now });
        else {
          const fig = fundingFigures(tx.draft, b);
          const after = fig.sharesCents + Math.max(0, request.amountCents - (fig.shares[request.taskId] ?? 0));
          if (after <= fig.ceilingCents) grantRequest(tx, b, request);
          // Si la ventilation a changé entre-temps, la demande reste visible et doit être réexaminée.
          else {
            om.update(tx, request, { status: 'pending', overrunId: null });
            const title = tx.draft.tasks[request.taskId]?.title ?? 'la tâche';
            notice = `Dépassement de ${fmt(x.amountCents)} autorisé : l’enveloppe passe à ${fmt(fig.ceilingCents)}. Mais les parts ont changé depuis la demande : accorder ${fmt(request.amountCents)} à « ${title} » demanderait encore ${fmt(after - fig.ceilingCents)}. La demande revient au projet pour être réexaminée.`;
          }
        }
      }
      return { overrunId: id };
    });
    const x = socle.state.projectOverruns[id];
    return { overrun: overrunView(socle.state, x), notice };
  }

  /**
   * Fin de cycle : les dépassements autorisés dont la date de facturation est atteinte sont facturés au budget de vie ;
   * le budget attribué de chaque projet concerné intègre ces montants, son déficit est soldé et ses contrôles de fin
   * de cycle (budget = somme des parts, charges des tâches planifiées et à jour) sont rendus.
   */
  async function billOverruns(ctx, input = {}) {
    const touched = new Set();
    await om.command('billProjectOverruns', ctx, input, (tx) => {
      if (!lifeBudgetOf(tx.draft, tx.userId)) fail('NOT_FOUND', 'Budget « Projet de vie » à préparer.');
      const now = today();
      const due = om.list(tx.draft, 'projectOverrun', (x) => x.userId === tx.userId && x.status === 'approved' && (!input.budgetId || x.budgetId === input.budgetId));
      const billable = due.filter((x) => !x.billingDate || x.billingDate <= now);
      if (!billable.length) {
        const next = due.map((x) => x.billingDate).filter(Boolean).sort()[0];
        fail('FORBIDDEN_BY_RULE', next ? `Les dépassements autorisés seront facturables à la fin du cycle, le ${frDate(next)} : rien à facturer avant.` : 'Aucun dépassement autorisé à facturer.', { nextBillingDate: next ?? null });
      }
      for (const x of billable) {
        const b = tx.draft.budgets[x.budgetId];
        om.update(tx, b, { allocationCents: b.allocationCents + x.amountCents });
        om.update(tx, x, { status: 'billed', billedAt: now });
        touched.add(b.id);
      }
      return { billed: billable.map((x) => x.id) };
    });
    return { budgetIds: [...touched] };
  }


  /**
   * Règlement financé (`fund: true` sur un règlement) : le user pilote le projet et le projet de vie. Avant la garde du
   * règlement, dans la même écriture, la part de la tâche est portée au nécessaire (projet en mode strict) et le
   * dépassement de l'enveloppe éventuel est autorisé. La garde `settlementGuard` s'applique ensuite telle quelle.
   */
  function fundSettlement(tx, { budgetId, direction, amountCents, realizedDate, taskId, operationId }) {
    const current = () => tx.draft.budgets[budgetId];
    let b = current();
    if (direction !== 'charge' || b?.role !== 'standard' || !inRegime(b) || realizedDate < b.allocationDate) return;
    standardOf(tx.draft, tx.userId, budgetId);
    const previous = operationId ? tx.draft.operations[operationId] : null;
    const previousPaid = previous && isValidatedCharge(previous, b) ? previous.realizedAmountCents : 0;
    if (b.taskFundingRequired && taskId && tx.draft.tasks[taskId]?.projectId === b.coreProjectId) {
      const fig = fundingFigures(tx.draft, b);
      const share = sharesOf(b)[taskId] ?? null;
      const needed = (fig.byTask[taskId]?.paidCents ?? 0) - (previous?.taskId === taskId ? previousPaid : 0) + amountCents;
      if (needed > (share ?? 0)) {
        const title = tx.draft.tasks[taskId].title;
        const after = fig.sharesCents - (share ?? 0) + needed;
        if (after > fig.ceilingCents) newOverrun(tx, b, { taskId, reason: 'ventilation', amountCents: after - fig.ceilingCents, note: `Part de « ${title} » portée à ${fmt(needed)} pour un règlement.`, approve: true });
        b = current();
        om.update(tx, b, { taskSharesCents: { ...sharesOf(b), [taskId]: needed } });
        b = current();
      }
    }
    const fig = fundingFigures(tx.draft, b);
    const after = fig.paidCents - previousPaid + amountCents;
    if (after > fig.ceilingCents) newOverrun(tx, b, { taskId: taskId ?? null, reason: 'reglement', amountCents: after - fig.ceilingCents, note: 'Règlement au-delà de l’enveloppe, autorisé en le validant.', approve: true });
  }

  /**
   * Builder pour une composition de l'application : un Budget standard créé pour un projet suit le financement par
   * tâche, avec son enveloppe éventuelle (jamais 0 €).
   */
  function startTaskFunding(tx, b, cents) {
    if (cents === 0) fail('FORBIDDEN_BY_RULE', 'Une enveloppe de 0 € ne permettrait de régler aucune dépense : indiquez le montant prévu, ou laissez le montant vide pour attribuer l’enveloppe plus tard.', { field: 'amount' });
    om.update(tx, b, { taskFundingRequired: true, taskSharesCents: {}, taskReturns: {}, ...(cents === null ? {} : { allocationCents: cents, allocationDate: today() }) });
  }

  return { standardOf, taskOf, startTaskFunding, fundSettlement, requestTaskBudget, decideTaskBudget, allocate, setTaskShare, releaseTaskShare, setTaskReturn, requestOverrun, decideOverrun, billOverruns };
}
