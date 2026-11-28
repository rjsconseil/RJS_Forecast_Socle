// Commandes du financement des projets — middleware Budget (niveau 2) : enveloppes, parts des tâches, demandes de
// montant, retours, règlements financés. Les dépassements et l'abandon sont dans `funding-project.mjs`.
import { fail } from '../../socle/errors.mjs';
import { today } from '../../socle/clock.mjs';
import { expectedRevisionOf, money, oneOf, text } from '../../socle/validation.mjs';
import { fmt, sum, RETURN_CADENCES, TASK_COST_MODES, inRegime, FUNDING_SOURCES, fundingSourceOf, sharesOf, returnsOf, overrunsOf, requestsOf, openRequest, isAbandoned, abandonedRefusal, requestView, isValidatedCharge, fundingFigures } from './funding-rules.mjs';
import { taskFunding, pendingOf } from './funding.mjs';
import { createProjectCommands } from './funding-project.mjs';
import { triggerReturn } from './funding-extensions.mjs';

/**
 * Commandes du financement des projets. Elles écrivent par Object Management et rendent l'essentiel (identifiants,
 * avertissement) : la lecture détaillée d'un projet reste celle de l'application.
 * @param socle        socle complet
 * @param lifeBudgetOf (state, userId) => Budget « Projet de vie » du user
 */
export function createFunding(socle, { lifeBudgetOf }) {
  const { om } = socle;

  /** Budget standard du user, enfant de son budget de vie. */
  function standardOf(state, userId, budgetId, { allowAbandoned = false } = {}) {
    const b = om.owned(state, 'budget', budgetId, userId);
    const life = lifeBudgetOf(state, userId);
    if (b.role === 'life' && b.id === life?.id) fail('FORBIDDEN_BY_RULE', 'Le budget de vie est non standard : ses ressources sont les entrées du cycle et il finance ses projets fils ; il ne reçoit ni enveloppe, ni part de tâche, ni dépassement.', { field: 'budgetId', budgetId, kind: 'life' });
    if (b.role !== 'standard' || b.parentBudgetId !== life?.id) fail('INCOMPATIBLE_REFERENCE', 'Ce Budget n’est pas un projet standard de votre budget de vie.', { field: 'budgetId', budgetId });
    if (!allowAbandoned && isAbandoned(b)) abandonedRefusal(b);
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
    return { ...r, request: requestView(socle.stateOf(ctx), socle.stateOf(ctx).taskBudgetRequests[r.requestId]) };
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
    return { request: requestView(socle.stateOf(ctx), socle.stateOf(ctx).taskBudgetRequests[id]) };
  }

  function grantRequest(tx, b, x) {
    const current = sharesOf(b)[x.taskId] ?? 0;
    // Une autre décision peut déjà avoir augmenté la part : ne jamais la réduire lors d'une approbation.
    om.update(tx, b, { taskSharesCents: { ...sharesOf(b), [x.taskId]: Math.max(current, x.amountCents) } });
    om.update(tx, x, { status: 'approved', decidedAt: today() });
  }


  /**
   * Réservation de moyens du projet, sans charge ni prélèvement. La première attribution
   * fixe la date à partir de laquelle les charges validées du projet comptent dans le budget de vie.
   */
  async function allocate(ctx, budgetId, input = {}) {
    await om.command('allocateProjectBudget', ctx, input, (tx) => {
      const b = standardOf(tx.draft, tx.userId, budgetId);
      om.checkRevision(b, expectedRevisionOf(input));
      const cents = money('amount', input.amount);
      const fig = fundingFigures(tx.draft, b);
      const source = input.fundingSource === undefined ? fundingSourceOf(b) : oneOf('fundingSource', input.fundingSource, FUNDING_SOURCES);
      // Changer de source déplacerait des dépenses déjà comptabilisées d'un cycle au patrimoine (ou l'inverse) : refusé.
      if (source !== fundingSourceOf(b) && fig.fundingSourceLocked) {
        fail('FORBIDDEN_BY_RULE', `L’enveloppe du projet « ${b.name} » a déjà servi à des règlements. Choisissez la source directement sur chaque nouveau mouvement.`, { field: 'fundingSource' });
      }
      if (fig.regime) {
        const billed = fig.billedOverrunCents;
        if (cents < billed) fail('FORBIDDEN_BY_RULE', `L’enveloppe ne peut pas descendre sous les dépassements déjà facturés (${fmt(billed)}).`, { field: 'amount' });
        if (cents + fig.approvedOverrunCents < fig.sharesCents) fail('FORBIDDEN_BY_RULE', `Les parts des tâches (${fmt(fig.sharesCents)}) dépassent ${fmt(cents + fig.approvedOverrunCents)} : réduisez d’abord des parts, ou gardez une enveloppe d’au moins ${fmt(fig.sharesCents - fig.approvedOverrunCents)}.`, { field: 'amount', sharesCents: fig.sharesCents });
        if (cents + fig.approvedOverrunCents < fig.paidCents) fail('FORBIDDEN_BY_RULE', `Les dépenses déjà réglées sur l’enveloppe (${fmt(fig.paidCents)}) dépassent ${fmt(cents + fig.approvedOverrunCents)} : gardez une enveloppe d’au moins ${fmt(fig.paidCents - fig.approvedOverrunCents)}.`, { field: 'amount', paidCents: fig.paidCents });
        if (cents === b.allocationCents && source === fundingSourceOf(b)) {
          tx.unchanged = true;
          return {};
        }
        om.update(tx, b, { allocationCents: cents, fundingSource: source });
      } else {
        if (cents === 0) fail('FORBIDDEN_BY_RULE', `Une enveloppe de 0 € ne permettrait de régler aucune dépense du projet « ${b.name} » : indiquez le montant prévu, ou laissez le projet sans enveloppe tant qu’il n’a rien à payer.`, { field: 'amount' });
        om.update(tx, b, { allocationCents: cents, allocationDate: today(), taskSharesCents: sharesOf(b), taskReturns: returnsOf(b), fundingSource: source });
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
  /**
   * Calcul du budget restant des tâches d'un projet [P] : `mode` (`time-left` : part × temps restant / temps prévu ;
   * `time-spent` : taux horaire × heures passées) et `hourlyRate` (euros par heure, le même pour toutes les tâches du
   * projet ; null l'efface). Aucun flux financier : un réglage d'affichage du projet.
   */
  async function setTaskCost(ctx, budgetId, input = {}) {
    await om.command('setTaskCost', ctx, input, (tx) => {
      const b = standardOf(tx.draft, tx.userId, budgetId);
      om.checkRevision(b, expectedRevisionOf(input));
      const patch = {};
      if ('mode' in input) patch.taskCostMode = oneOf('mode', input.mode, TASK_COST_MODES);
      if ('hourlyRate' in input) patch.hourlyRateCents = money('hourlyRate', input.hourlyRate, { nullable: true, positive: input.hourlyRate !== null && input.hourlyRate !== undefined && input.hourlyRate !== '' });
      if (!Object.keys(patch).length) fail('VALIDATION', 'Rien à changer : donnez le mode ou le taux horaire.', { field: 'mode' });
      om.update(tx, b, patch);
      return { budgetId };
    });
    return { budgetId };
  }

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
   * Règlement financé (`fund: true` sur un règlement) : le user pilote le projet et le projet de vie. Avant la garde du
   * règlement, dans la même écriture, la part de la tâche est portée au nécessaire (projet en mode strict) et le
   * dépassement de l'enveloppe éventuel est autorisé. La garde `settlementGuard` s'applique ensuite telle quelle.
   */
  function fundSettlement(tx, { budgetId, direction, amountCents, realizedDate, accountingDate, taskId, operationId }) {
    const current = () => tx.draft.budgets[budgetId];
    let b = current();
    if (direction !== 'charge' || b?.role !== 'standard' || !inRegime(b) || (accountingDate ?? realizedDate) < b.allocationDate) return;
    standardOf(tx.draft, tx.userId, budgetId);
    const previous = operationId ? tx.draft.operations[operationId] : null;
    const previousPaid = previous && isValidatedCharge(previous, b) ? previous.realizedAmountCents : 0;
    // Autoriser un achat au-delà de sa part n'augmente jamais cette part : le négatif doit rester visible.
    if (b.taskFundingRequired && !(sharesOf(b)[taskId] > 0) && taskId && tx.draft.tasks[taskId]?.projectId === b.coreProjectId) {
      // Une décision explicite groupée peut réserver une part initiale avant le règlement, sans effet comptable propre.
      const fig = fundingFigures(tx.draft, b);
      const needed = Math.max(amountCents, (fig.byTask[taskId]?.paidCents ?? 0) - (previous?.taskId === taskId ? previousPaid : 0) + amountCents);
      const sharesAfter = fig.sharesCents - (sharesOf(b)[taskId] ?? 0) + needed;
      if (sharesAfter > fig.ceilingCents) newOverrun(tx, b, { taskId, reason: 'ventilation', amountCents: sharesAfter - fig.ceilingCents, note: 'Part initiale réservée lors de la validation du règlement.', approve: true });
      b = current();
      om.update(tx, b, { taskSharesCents: { ...sharesOf(b), [taskId]: needed } });
      b = current();
    }
    const fig = fundingFigures(tx.draft, b);
    const after = fig.paidCents - previousPaid + amountCents;
    if (after > fig.ceilingCents) newOverrun(tx, b, { taskId: taskId ?? null, reason: 'reglement', amountCents: after - fig.ceilingCents, note: 'Règlement au-delà de l’enveloppe, autorisé en le validant.', approve: true });
  }

  /**
   * Builder pour une composition de l'application : un Budget standard créé pour un projet suit le financement par
   * tâche, avec son enveloppe éventuelle (jamais 0 €).
   */
  function startTaskFunding(tx, b, cents, fundingSource = 'cycle') {
    if (cents === 0) fail('FORBIDDEN_BY_RULE', 'Une enveloppe de 0 € ne permettrait de régler aucune dépense : indiquez le montant prévu, ou laissez le montant vide pour attribuer l’enveloppe plus tard.', { field: 'amount' });
    om.update(tx, b, { taskFundingRequired: true, taskSharesCents: {}, taskReturns: {}, fundingSource: oneOf('fundingSource', fundingSource, FUNDING_SOURCES), ...(cents === null ? {} : { allocationCents: cents, allocationDate: today() }) });
  }

  const { requestOverrun, decideOverrun, billOverruns, abandonProject, resumeProject } = createProjectCommands(socle, { lifeBudgetOf, standardOf, taskOf, approval, grantRequest, newOverrun, noPendingOverrun });
  return { standardOf, taskOf, startTaskFunding, fundSettlement, requestTaskBudget, decideTaskBudget, allocate, setTaskShare, releaseTaskShare, setTaskCost, setTaskReturn, requestOverrun, decideOverrun, billOverruns, abandonProject, resumeProject };
}
