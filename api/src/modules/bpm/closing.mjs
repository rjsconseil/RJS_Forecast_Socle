// Parcours de clôture d'un cycle (page « Clôture du cycle » de BPM-Astra) : suivi des points, puis clôture.
//
// Un point à suivre est un évènement du cycle qui demande une revue :
// - une échéance prévue du budget du projet de vie (entrée ou charge, récurrente ou saisie comme prévision) ;
// - un flux prévu d'un projet de la vie financé par le cycle (enveloppe attribuée) ;
// - une décision de financement en attente (part de budget demandée, dépassement à autoriser) ;
// - la vérification du compte, une fois le cycle terminé (point bloquant).
// Il s'ouvre quand l'évènement existe dans le cycle et se clôt dès qu'il est traité là où il vit sur le site
// (règlement, écart, décision) : la page le montre clos à l'instant, avec son heure. Une saisie déjà réglée
// n'ouvre aucun point.
//
// Tant que le cycle court, la page est un suivi (complétude, points ouverts et clos, bilan provisoire, impacts sur
// le cycle suivant) : aucune action n'y est proposée. À la fin de son dernier jour, le cycle entre en clôture : la
// liste de ses points est figée (aucune nouvelle prévision n'y entre : garde `CYCLE_IN_CLOSING`), le cycle suivant
// attend (`CYCLE_AWAITING_CLOSURE`), et la page ne donne accès qu'aux points encore ouverts : les valider, ou décider
// qu'un point non bloquant ne le sera pas dans ce cycle. Il garde alors une marque (« reporté ») et se revoit dans
// le cycle choisi : le suivant, ou un cycle plus lointain (un flux de projet, selon l'avancement du projet).
//
// La finalisation, à 100 %, en une écriture : clôture (bilan figé, résultat capitalisé une fois, marques des points
// reportés), échéances reportées inscrites au premier jour de leur cycle, décisions effacées ; le verrou tombe.
// La commande `closePeriod` reste la clôture comptable seule (reprises de données, scénarios) : la page passe par ici.
//
// La page suit aussi toutes les actions enregistrées sur Astra qui touchent le cycle (`cycle-actions.mjs`, classées
// par catégorie) et les contrôles de cohérence (`closing-checks.mjs`) : la clôture n'est possible qu'à 100 % et sans
// contrôle bloquant en échec ; elle fige les actions et les contrôles du cycle dans sa clôture (historisation).
import { fail } from '../../socle/errors.mjs';
import { text } from '../../socle/validation.mjs';
import { addDays, linkedProjectBudgets, OVERRUN_REASONS, periodByIndex, periodByKey, projectFundingSource, today } from '../budget/api.mjs';
import { actionsSnapshot, cycleActions } from './cycle-actions.mjs';
import { closingChecks } from './closing-checks.mjs';
import { frDate, cents, sum, plural } from './format.mjs';
import { objectsWith, positions } from '../../socle/indexes.mjs';

export const LOCK_PARAMETER = 'bpm.verrouCycleSuivant';
const RESULT = 'bpm.resultatPeriode';
/** Un point se reporte au plus deux ans après le cycle qui se clôture. */
const DEFER_HORIZON = 24;
const days = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
/** Jour local d'un horodatage. */
const dayOf = (iso) => (iso ? new Date(iso).toLocaleDateString('sv-SE') : null);
const flows = (ls) => ({
  count: ls.length,
  incomeCents: sum(ls.filter((l) => l.direction === 'income'), (l) => l.plannedCents),
  chargeCents: sum(ls.filter((l) => l.direction !== 'income'), (l) => l.plannedCents),
});

/**
 * Cycle qui attend sa clôture [P] : la première période non close est terminée. Elle est en clôture (ses points
 * sont figés) ; la période d'aujourd'hui (et la suite) attend d'être lancée, `from` est son premier jour.
 * Null si aucune période terminée n'attend.
 */
export function awaitingClosure(cs) {
  if (!cs || cs.firstOpen.status !== 'ended') return null;
  return { periodKey: cs.firstOpen.key, periodLabel: cs.firstOpen.label, start: cs.firstOpen.start, end: cs.firstOpen.end, from: cs.current.start, nextKey: cs.current.key, nextLabel: cs.current.label, backlog: cs.current.index - cs.firstOpen.index };
}

export function lockMessage(lock) {
  const waiting = lock.backlog > 1 ? `les cycles terminés se clôturent dans l’ordre avant que ${lock.nextLabel} démarre` : `${lock.nextLabel} démarrera à sa clôture`;
  return `${lock.periodLabel} est terminé et attend sa clôture : ${waiting}. Aucune entrée datée du ${frDate(lock.from)} ou après n’est possible avant (page « Clôture du cycle »).`;
}

/** Mode clôture : la liste des points du cycle terminé est figée ; ce qui a eu lieu se saisit toujours. */
export function closingModeMessage(lock) {
  const who = lock.backlog > 1 ? `Les cycles terminés depuis le ${frDate(lock.start)} sont en clôture : leurs points sont figés` : `${lock.periodLabel} est en clôture : ses points sont figés`;
  return `${who}. On y valide, écarte ou reporte ce qui était prévu ; une nouvelle prévision attend la clôture (page « Clôture du cycle »). Une dépense ou une entrée déjà faite se saisit toujours.`;
}

const GROUPS = [
  { key: 'income', label: 'Entrées reçues', todo: (n) => `${plural(n, 'entrée')} à recevoir ou décider` },
  { key: 'charges', label: 'Charges réglées', todo: (n) => `${plural(n, 'charge')} à régler ou décider` },
  { key: 'projects', label: 'Flux des projets imputés au cycle', todo: (n) => `${plural(n, 'flux de projet', 'flux de projets')} à valider ou décider` },
  { key: 'decisions', label: 'Décisions de financement', todo: (n) => `${plural(n, 'décision')} à prendre ou reporter` },
  { key: 'account', label: 'Compte vérifié', todo: (_n, p) => (p?.stale ? 'compte à vérifier de nouveau' : 'compte à vérifier') },
];
const DECIDED = {
  overrun: { approved: 'Autorisé', refused: 'Refusé', cancelled: 'Annulé', billed: 'Autorisé et consolidé' },
  request: { approved: 'Accordée', refused: 'Refusée', cancelled: 'Annulée' },
};

/** Une saisie ponctuelle ouvre un point si elle a été prévue (repli sur son historique pour les données anciennes). */
const wasPlanned = (o) => (o.entryStatus ? o.entryStatus === 'planned' : o.status !== 'realized' || !!o.carriedFrom || !!o.closedAt || o.lastChange?.command === 'realizeOperation');
/**
 * Moment où un point s'est clos (règlement, écart) : `closedAt` (heure) et `closedOn` (jour du socle) posés à
 * l'écriture ; repli sur l'historique pour les données anciennes.
 */
const settledAt = (o) => o.closedAt ?? (o.recurrenceId && o.provenance?.command === 'settleOccurrence' ? o.provenance.at : o.lastChange?.at ?? o.updatedAt ?? null);
const skippedAt = (o) => o.closedAt ?? o.lastChange?.at ?? o.provenance?.at ?? o.updatedAt ?? null;
/** Jour d'entrée d'une saisie ou d'une définition dans le cycle (jour du socle), repli sur sa création. */
const enteredOf = (x) => x?.enteredOn ?? dayOf(x?.createdAt);
const occurrenceIdOf = (o) => (o.recurrenceId ? `${o.recurrenceId}@${o.occurrenceDate}` : o.id);

/**
 * @param h outils du module BPM : requireComposition, compositionOf, cycleOf, cycleState, closuresOf, closingOf,
 *          closingContract, recordClosure, closureView, figuresFor
 * @param reads lectures communes (base, contextOf, decorate, decorateProjectLine)
 * @param bilans bilans des cycles (bilan figé à la clôture)
 */
export function createClosing(socle, h, reads, bilans) {
  const { om } = socle;
  const budget = () => socle.modules.budget;

  /** Décisions de clôture du cycle : points reportés (cycle cible) et compte vérifié. */
  const planOf = (cycle, periodKey, nextKey) => {
    const p = cycle?.closingPlan;
    if (p?.periodKey !== periodKey) return { defer: {}, account: null };
    const defer = { ...(p.defer ?? {}) };
    for (const id of p.carry ?? []) defer[id] ??= nextKey; // ancienne forme : report au cycle suivant
    return { defer, account: p.account ?? null };
  };

  const fundedBudgets = (state, lifeBudgetId) =>
    linkedProjectBudgets(state, lifeBudgetId).filter((x) => Number.isInteger(x.allocationCents) && typeof x.allocationDate === 'string');
  const projectOf = (state, budgetId) => {
    const pb = state.budgets[budgetId];
    return pb?.role === 'standard' ? { budgetId: pb.id, coreProjectId: pb.coreProjectId, name: state.coreProjects[pb.coreProjectId]?.title ?? pb.name } : null;
  };

  /** Points du cycle : échéances prévues (vie, projets financés par le cycle), écartées, décisions, compte. */
  function pointsOf(b, { phase, period, next, plan, account, targets }) {
    const { state, comp, cycle } = b;
    const window = { from: period.start, to: period.end, by: 'planned' };
    const labelOf = (key) => (key ? periodByKey(key, cycle.anchorDay)?.label ?? key : null);
    const targetOf = (key) => targets.find((t) => t.key === key) ?? (key ? { key, label: labelOf(key), start: periodByKey(key, cycle.anchorDay)?.start ?? null } : null);
    // Un report ne vaut que vers un cycle encore à venir : s'il vise un cycle terminé depuis (clôture tardive), il
    // tombe et le point redevient ouvert, pour être revu vers un cycle ouvert.
    const deferOf = (id) => (targets.some((t) => t.key === plan.defer[id]) ? plan.defer[id] : null);
    const openedOf = (d) => (d && d > period.start ? d : period.start);
    const inheritedOf = (o) => (o?.carriedFrom ? { periodKey: o.carriedFrom.periodKey ?? null, label: labelOf(o.carriedFrom.periodKey), date: o.carriedFrom.date ?? null } : null);

    const linePoint = (l, group) => {
      const o = l.operationId ? state.operations[l.operationId] : null;
      const rec = l.recurrenceId ? state.recurrences[l.recurrenceId] : null;
      const id = l.occurrenceKey ?? l.id;
      const deferKey = deferOf(id);
      const closedAt = l.settled && o ? settledAt(o) : null;
      const project = group === 'projects' ? l.project ?? null : null;
      const validated = group === 'projects' ? 'Validé' : l.direction === 'income' ? 'Reçue' : 'Payée';
      return {
        id,
        lineId: l.id,
        kind: 'line',
        group,
        blocking: false,
        lineKind: l.kind,
        operationId: l.operationId ?? null,
        recurrenceId: l.recurrenceId ?? null,
        occurrenceDate: l.occurrenceDate ?? null,
        revision: l.revision ?? null,
        label: l.label,
        detail: project?.name ?? l.costCenterLabel ?? null,
        direction: l.direction,
        plannedDate: l.plannedDate,
        plannedCents: l.plannedCents,
        realizedDate: l.realizedDate ?? null,
        realizedCents: l.realizedCents ?? null,
        costCenterLabel: l.costCenterLabel ?? null,
        cadenceLabel: l.cadenceLabel ?? null,
        project,
        status: l.status,
        statusLabel: l.statusLabel,
        state: l.settled ? 'closed' : deferKey ? 'deferred' : 'open',
        openedOn: openedOf(enteredOf(o && !o.recurrenceId ? o : rec ?? o)),
        closedAt,
        closedOn: l.settled ? o?.closedOn ?? dayOf(closedAt) ?? l.realizedDate : null,
        outcome: l.settled ? 'settled' : null,
        outcomeLabel: l.settled ? `${validated} le ${frDate(l.realizedDate)}` : null,
        inheritedFrom: inheritedOf(o),
        deferTo: !l.settled && deferKey ? targetOf(deferKey) : null,
      };
    };
    const isPoint = (l) => l.kind === 'occurrence' || !!l.recurrenceId || wasPlanned(state.operations[l.operationId]);

    const life = budget().budgetLines(state, [comp.budgetId], window).filter(isPoint).map((l) => reads.decorate(b, l));
    const funded = fundedBudgets(state, comp.budgetId);
    const projects = funded.length
      ? budget().budgetLines(state, funded.map((x) => x.id), window).filter(isPoint).map((l) => reads.decorateProjectLine(b, l)).filter((l) => l.fundingSource !== 'patrimoine')
      : [];
    const points = [...life.map((l) => linePoint(l, l.direction === 'income' ? 'income' : 'charges')), ...projects.map((l) => linePoint(l, 'projects'))];

    // Échéances écartées (ou prévisions annulées) dans le cycle : des points clos, avec leur heure.
    const scope = new Set([comp.budgetId, ...funded.map((x) => x.id)]);
    const order = positions(state.operations);
    const inScope = [...scope].flatMap((id) => objectsWith(state.operations, 'budgetId', id)).sort((a, b) => order.get(a.id) - order.get(b.id));
    for (const o of inScope) {
      if (o.status !== 'cancelled' || o.cancelledFrom !== 'planned' || o.carriedTo || /^Reportée/.test(o.cancelReason ?? '')) continue;
      if (o.date < period.start || o.date > period.end) continue;
      const project = o.budgetId === comp.budgetId ? null : projectOf(state, o.budgetId);
      if (project && projectFundingSource(o, state.budgets[o.budgetId]) === 'patrimoine') continue;
      const view = budget().lineView(state, { id: o.id, budgetId: o.budgetId, recurrenceId: o.recurrenceId ?? null, costCenterId: o.costCenterId, standardCostCenter: o.standardCostCenter, categoryId: o.categoryId ?? null, taskId: o.taskId ?? null, settled: false });
      const at = skippedAt(o);
      points.push({
        id: occurrenceIdOf(o),
        lineId: o.id,
        kind: 'line',
        group: project ? 'projects' : o.direction === 'income' ? 'income' : 'charges',
        blocking: false,
        lineKind: 'operation',
        operationId: o.id,
        recurrenceId: o.recurrenceId ?? null,
        occurrenceDate: o.occurrenceDate ?? null,
        revision: o.revision,
        label: o.label,
        detail: project?.name ?? view.costCenterLabel ?? null,
        direction: o.direction,
        plannedDate: o.date,
        plannedCents: o.amountCents,
        realizedDate: null,
        realizedCents: null,
        costCenterLabel: view.costCenterLabel ?? null,
        cadenceLabel: view.cadenceLabel ?? null,
        project,
        status: 'skipped',
        statusLabel: o.recurrenceId ? 'Écartée' : 'Annulée',
        state: 'closed',
        openedOn: openedOf(enteredOf(o.recurrenceId ? state.recurrences[o.recurrenceId] : o)),
        closedAt: at,
        closedOn: o.closedOn ?? dayOf(at),
        outcome: 'skipped',
        outcomeLabel: `${o.recurrenceId ? 'Écartée' : 'Annulée'} le ${frDate(o.closedOn ?? dayOf(at) ?? o.date)}${o.cancelReason ? ` · ${o.cancelReason}` : ''}`,
        inheritedFrom: inheritedOf(o),
        deferTo: null,
      });
    }

    // Décisions de financement des projets : en attente (ouvertes, même héritées), ou prises pendant le cycle.
    const projectIds = new Set(linkedProjectBudgets(state, comp.budgetId).map((x) => x.id));
    const decision = (x, kind) => {
      if (!projectIds.has(x.budgetId) || !x.requestedAt || x.requestedAt > period.end) return;
      const pending = x.status === 'pending';
      const decidedHere = !pending && !!x.decidedAt && x.decidedAt >= period.start && x.decidedAt <= period.end;
      if (!pending && !decidedHere) return;
      const id = `${kind}:${x.id}`;
      const deferKey = pending ? deferOf(id) : null;
      const task = x.taskId ? state.tasks[x.taskId]?.title ?? null : null;
      const project = projectOf(state, x.budgetId);
      points.push({
        id,
        lineId: null,
        kind: 'decision',
        group: 'decisions',
        blocking: false,
        decisionKind: kind,
        decisionId: x.id,
        label: `${kind === 'overrun' ? 'Dépassement à autoriser' : 'Part de budget demandée'}${task ? ` · ${task}` : ''}`,
        detail: [project?.name, kind === 'overrun' ? OVERRUN_REASONS[x.reason] : null].filter(Boolean).join(' · ') || null,
        direction: 'charge',
        plannedDate: x.requestedAt,
        plannedCents: x.amountCents,
        realizedDate: null,
        realizedCents: null,
        project,
        status: pending ? 'awaiting' : x.status,
        statusLabel: pending ? (kind === 'overrun' ? 'Décision du budget de vie attendue' : 'À valider par le projet') : DECIDED[kind][x.status] ?? x.status,
        state: pending ? (deferKey ? 'deferred' : 'open') : 'closed',
        openedOn: x.requestedAt > period.start ? x.requestedAt : period.start,
        closedAt: null,
        closedOn: decidedHere ? x.decidedAt : null,
        outcome: decidedHere ? x.status : null,
        outcomeLabel: decidedHere ? `${DECIDED[kind][x.status] ?? x.status} le ${frDate(x.decidedAt)}` : null,
        inheritedFrom: x.requestedAt < period.start ? { periodKey: null, label: null, date: x.requestedAt } : null,
        deferTo: deferKey ? targetOf(deferKey) : null,
      });
    };
    for (const x of Object.values(state.projectOverruns ?? {})) decision(x, 'overrun');
    for (const x of Object.values(state.taskBudgetRequests ?? {})) if (!x.overrunId) decision(x, 'request');

    // Le compte se vérifie une fois le cycle terminé : point bloquant, à refaire si le solde réalisé change.
    const accountDone = !!account && !account.stale;
    points.push({
      id: 'account',
      lineId: null,
      kind: 'account',
      group: 'account',
      blocking: true,
      label: 'Vérification du compte',
      detail: 'Sa variation vaut les entrées reçues moins les sorties payées du cycle.',
      status: phase === 'running' ? 'later' : accountDone ? 'settled' : 'late',
      statusLabel: phase === 'running' ? `À la fin du cycle, le ${frDate(addDays(period.end, 1))}` : accountDone ? 'Vérifié' : account?.stale ? 'À vérifier de nouveau' : 'À vérifier',
      state: phase === 'running' ? 'later' : accountDone ? 'closed' : 'open',
      stale: !!account?.stale,
      openedOn: phase === 'running' ? null : addDays(period.end, 1),
      closedAt: accountDone ? account.at ?? null : null,
      closedOn: accountDone ? account.confirmedAt : null,
      outcome: accountDone ? 'confirmed' : null,
      outcomeLabel: accountDone ? `Vérifié le ${frDate(account.confirmedAt)}` : null,
      inheritedFrom: null,
      deferTo: null,
    });
    const rank = { open: 0, deferred: 1, later: 2, closed: 3 };
    return points.sort((a, z) => rank[a.state] - rank[z.state] || (a.plannedDate ?? '9').localeCompare(z.plannedDate ?? '9') || a.label.localeCompare(z.label, 'fr'));
  }

  /** Phase, période, points et compteurs du cycle concerné, lus sur un état (stockage ou brouillon d'écriture). */
  function pointsState(state, userId) {
    const comp = h.compositionOf(state, userId);
    const cycle = comp ? h.cycleOf(state, comp.id) : null;
    const cs = cycle ? h.cycleState(state, cycle) : null;
    const lockEnabled = socle.parameters.value(state, LOCK_PARAMETER) !== false;
    if (!cs) return { comp, cycle, cs, lockEnabled, phase: 'to_configure', period: null };
    const phase = cs.firstOpen.status === 'ended' ? 'to_close' : 'running';
    const period = phase === 'to_close' ? cs.firstOpen : cs.current;
    const next = periodByIndex(period.index + 1, cycle.anchorDay);
    // Cycles où un point peut se revoir : ceux qui ne sont pas encore terminés. Quand plusieurs cycles terminés
    // attendent leur clôture, le cycle suivant est lui-même en clôture (ses points sont figés) : rien n'y entre.
    const first = Math.max(period.index + 1, cs.current.index);
    const targets = Array.from({ length: DEFER_HORIZON }, (_, i) => periodByIndex(first + i, cycle.anchorDay)).map((p) => ({ key: p.key, label: p.label, start: p.start }));
    const b = { state, userId, comp, cycle, cs };
    // Les décisions de clôture (reports, compte vérifié) ne valent qu'une fois le cycle terminé.
    const plan = phase === 'to_close' ? planOf(cycle, period.key, next.key) : { defer: {}, account: null };
    const netCents = cents(h.figuresFor(state, userId, [RESULT], { periodKey: period.key }).figures[RESULT]?.value);
    const account = plan.account ? { ...plan.account, stale: plan.account.netCents !== netCents } : null;
    const points = pointsOf(b, { phase, period, next, plan, account, targets });
    const count = (s) => points.filter((p) => p.state === s).length;
    const counts = { total: points.length, open: count('open'), closed: count('closed'), deferred: count('deferred'), later: count('later'), inherited: points.filter((p) => p.inheritedFrom).length };
    const done = counts.closed + counts.deferred;
    const percent = counts.total ? Math.floor((done * 100) / counts.total) : 100;
    return { comp, cycle, cs, b, lockEnabled, phase, period, next, targets, plan, netCents, account, points, counts, done, percent };
  }

  /** Ce que le cycle qui se clôture laisse au cycle suivant (et au-delà, pour les points reportés plus loin). */
  function impactsOf(s, closing) {
    const { state, comp } = s.b;
    const { next, points, phase } = s;
    const win = { from: next.start, to: next.end, by: 'planned' };
    const nextLife = budget().budgetLines(state, [comp.budgetId], win).filter((l) => !l.settled);
    const recurring = nextLife.filter((l) => l.kind === 'occurrence' || l.recurrenceId);
    const planned = nextLife.filter((l) => !(l.kind === 'occurrence' || l.recurrenceId));
    const funded = fundedBudgets(state, comp.budgetId);
    const nextProjects = funded.length
      ? budget().budgetLines(state, funded.map((x) => x.id), win).filter((l) => !l.settled).map((l) => reads.decorateProjectLine(s.b, l)).filter((l) => l.fundingSource !== 'patrimoine')
      : [];
    const deferred = points.filter((p) => p.state === 'deferred' && p.kind === 'line');
    const intoNext = deferred.filter((p) => p.deferTo?.key === next.key);
    const byCycle = [...new Set(deferred.map((p) => p.deferTo.key))].sort().map((key) => {
      const ps = deferred.filter((p) => p.deferTo.key === key);
      return { key, label: ps[0].deferTo.label, start: ps[0].deferTo.start, ...flows(ps), points: ps.map((p) => ({ id: p.id, label: p.label, group: p.group, direction: p.direction, plannedCents: p.plannedCents, project: p.project?.name ?? null })) };
    });
    const decisions = points.filter((p) => p.kind === 'decision' && p.state !== 'closed');
    const parts = [flows(recurring), flows(planned), flows(nextProjects), flows(intoNext)];
    const preview = closing?.preview ?? null;
    return {
      next: { key: next.key, label: next.label, start: next.start, end: next.end },
      capitalization: preview
        ? { resultCents: preview.resultCents, stockBefore: preview.stockBefore, stockAfter: preview.stockAfter, date: preview.capitalizationDate, provisional: false }
        : { resultCents: s.netCents, stockBefore: null, stockAfter: null, date: s.period.end, provisional: true },
      recurring: flows(recurring),
      planned: flows(planned),
      projects: flows(nextProjects),
      deferred: { ...flows(deferred), intoNext: flows(intoNext), byCycle },
      decisions: { count: decisions.length, points: decisions.map((p) => ({ id: p.id, label: p.label, project: p.project?.name ?? null, plannedCents: p.plannedCents, state: p.state })) },
      balanceCents: sum(parts, (f) => f.incomeCents) - sum(parts, (f) => f.chargeCents),
      opensEntries: phase === 'to_close' && s.lockEnabled,
    };
  }

  /**
   * Complétude, points, aperçu de la clôture, impacts, actions du cycle et contrôles de cohérence.
   * `full: false` : sans les actions ni les contrôles (décisions de clôture, qui n'en ont pas besoin).
   */
  function journeyOf(state, userId, { now = today(), full = true } = {}) {
    const s = pointsState(state, userId);
    if (s.phase === 'to_configure') {
      return { phase: 'to_configure', period: null, next: null, percent: 0, done: 0, total: 0, counts: null, criteria: [], points: [], targets: [], lock: { enabled: s.lockEnabled, active: false, from: null, message: null }, closingMode: { active: false, message: null }, canClose: false, closing: null, impacts: null, actions: null, checks: null };
    }
    const { phase, period, next, points, cs, cycle } = s;
    const criteria = GROUPS.map((g) => {
      const its = points.filter((p) => p.group === g.key);
      const open = its.filter((p) => p.state === 'open' || p.state === 'later');
      const done = its.length - open.length;
      // Pendant le cycle, un point est « à faire maintenant » s'il est en retard ou du jour ; les autres attendent leur date.
      const now_ = phase === 'to_close' || open.some((p) => p.state === 'open' && (p.kind === 'decision' || p.status === 'late' || p.status === 'due'));
      return {
        key: g.key,
        label: g.label,
        done,
        total: its.length,
        state: !its.length ? 'none' : !open.length ? 'done' : now_ ? 'todo' : 'later',
        remaining: open.length ? g.todo(open.length, open[0]) : null,
      };
    });
    const closing = phase === 'to_close' ? h.closingOf(state, userId, period, cs) : null;
    const lock = s.lockEnabled ? awaitingClosure(cs) : null;
    const total_ = days(period.start, period.end) + 1;
    const elapsed = Math.min(Math.max(days(period.start, now) + 1, 0), total_);
    const last = h.closuresOf(state, cycle.id).at(-1);
    // Ce qui a été fait (actions du cycle) et ce qui se tient (contrôles), lus sur le même état.
    const actions = full
      ? cycleActions(state, userId, period, { lifeBudgetId: s.comp.budgetId, projectBudgetIds: linkedProjectBudgets(state, s.comp.budgetId).map((x) => x.id), lineView: budget().lineView, anchorDay: cycle.anchorDay })
      : null;
    const checks = full ? closingChecks({ ...s, closing }, { budget: budget(), reads, inspector: socle.inspector }) : null;
    const blocking = (checks?.items ?? []).filter((c) => c.level === 'blocking' && c.state === 'fail' && c.key !== 'points' && c.key !== 'account');
    return {
      phase,
      period: { key: period.key, label: period.label, start: period.start, end: period.end, status: period.status },
      next: { key: next.key, label: next.label, start: next.start, end: next.end },
      opensOn: addDays(period.end, 1),
      days: { total: total_, elapsed, left: total_ - elapsed },
      backlog: Math.max(0, cs.current.index - cs.firstOpen.index),
      lock: { enabled: s.lockEnabled, active: !!lock, from: lock?.from ?? null, message: lock ? lockMessage(lock) : null },
      closingMode: { active: phase === 'to_close' && !!lock, message: lock ? closingModeMessage(lock) : null },
      percent: s.percent,
      done: s.done,
      total: s.counts.total,
      counts: s.counts,
      criteria,
      points,
      targets: s.targets,
      netCents: s.netCents,
      account: s.account,
      closing,
      canClose: phase === 'to_close' && s.percent === 100 && !!closing?.possible && !blocking.length,
      remaining: [...criteria.map((c) => c.remaining), ...blocking.map((c) => `${c.label.toLowerCase()} à rétablir`)].filter(Boolean),
      impacts: impactsOf(s, closing),
      actions,
      checks,
      lastClosure: last
        ? { periodKey: last.periodKey, periodLabel: last.periodLabel, resultCents: last.resultCents, closedAt: last.createdAt, deferredCount: last.journey?.deferred?.length ?? last.journey?.carried?.length ?? 0 }
        : null,
    };
  }

  function openOnly(j) {
    if (j.phase === 'to_configure') fail('FORBIDDEN_BY_RULE', 'Le cycle est à configurer : aucune période à clôturer.');
    if (j.phase === 'running') fail('FORBIDDEN_BY_RULE', `La clôture de ${j.period.label} s’ouvre le ${frDate(j.opensOn)}, à la fin de son dernier jour : d’ici là, les points se traitent là où ils vivent.`, { opensOn: j.opensOn });
  }
  function samePeriod(j, periodKey) {
    if (periodKey !== j.period.key) fail('FORBIDDEN_BY_RULE', `Les cycles se clôturent dans l’ordre : ${j.period.label} d’abord.`, { periodKey: j.period.key });
  }

  return {
    journeyOf,

    /** Lecture de la page : phase, complétude, points ouverts et clos, aperçu de la clôture, impacts, verrou. */
    journey(ctx) {
      const state = socle.state;
      const { userId } = h.requireComposition(state, ctx);
      return { context: reads.contextOf(reads.base(ctx)), ...journeyOf(state, userId) };
    },

    /**
     * Résumé pour le cadre des pages : phase, complétude et états des points (une page signale à l'instant un
     * point qui vient de se clore, et le mode clôture sur tout le site).
     */
    brief(ctx) {
      const state = socle.state;
      const { userId } = h.requireComposition(state, ctx);
      const s = pointsState(state, userId);
      if (s.phase === 'to_configure') return { phase: 'to_configure', period: null, next: null, percent: 0, counts: null, points: [], closingMode: { active: false, message: null } };
      const lock = s.lockEnabled ? awaitingClosure(s.cs) : null;
      return {
        phase: s.phase,
        period: { key: s.period.key, label: s.period.label, start: s.period.start, end: s.period.end },
        next: { key: s.next.key, label: s.next.label, start: s.next.start },
        opensOn: addDays(s.period.end, 1),
        percent: s.percent,
        counts: s.counts,
        closingMode: { active: s.phase === 'to_close' && !!lock, message: lock ? closingModeMessage(lock) : null },
        points: s.points.map((p) => ({ id: p.id, label: p.label, group: p.group, state: p.state })),
      };
    },

    /**
     * Décisions de clôture, une fois le cycle terminé : ne pas valider un point non bloquant dans ce cycle (il se
     * revoit dans le cycle choisi : `defer: { pointId, toPeriodKey }`, `toPeriodKey: null` retire le report), confirmer
     * (ou retirer) la vérification du compte. Elles restent sur la liaison de cycle jusqu'à la clôture.
     * Ancienne forme acceptée : `carry: { lineId, value }` (report au cycle suivant).
     */
    async decide(ctx, input = {}) {
      await om.command('closingDecision', ctx, input, (tx) => {
        const j = journeyOf(tx.draft, tx.userId, { full: false });
        openOnly(j);
        samePeriod(j, input.periodKey);
        const cycle = h.cycleOf(tx.draft, h.compositionOf(tx.draft, tx.userId).id);
        const plan = planOf(cycle, j.period.key, j.next.key);
        const defer = { ...plan.defer };
        let { account } = plan;
        const request = input.defer ?? (input.carry !== undefined ? { pointId: input.carry?.lineId, toPeriodKey: input.carry?.value === false ? null : j.targets[0].key } : undefined);
        if (request !== undefined) {
          const pointId = text('defer.pointId', request?.pointId, { required: true, max: 200 });
          const p = j.points.find((x) => x.id === pointId || x.lineId === pointId);
          if (!p) fail('NOT_FOUND', 'Point inconnu pour ce cycle.', { field: 'defer.pointId', pointId });
          if (p.blocking) fail('FORBIDDEN_BY_RULE', `« ${p.label} » bloque la clôture : il se traite avant de clôturer.`, { pointId: p.id });
          if (p.state === 'closed') fail('ALREADY_SETTLED', `« ${p.label} » est clos : rien à reporter.`, { pointId: p.id });
          if (request?.toPeriodKey == null) delete defer[p.id];
          else {
            const target = j.targets.find((t) => t.key === request.toPeriodKey);
            if (!target) fail('VALIDATION', 'Cycle de report inconnu : choisissez un cycle à venir, jusqu’à deux ans.', { field: 'defer.toPeriodKey' });
            if (p.kind === 'decision' && target.key !== j.targets[0].key) fail('VALIDATION', `Une décision en attente se revoit au premier cycle à venir (${j.targets[0].label}).`, { field: 'defer.toPeriodKey' });
            defer[p.id] = target.key;
          }
        }
        if (input.account !== undefined) {
          account = input.account?.confirmed === false
            ? null
            : { confirmedAt: today(), at: tx.now, netCents: j.netCents, note: input.account?.note ? text('account.note', input.account.note, { max: 500 }) : null };
        }
        om.update(tx, cycle, { closingPlan: { periodKey: j.period.key, defer, account } });
        return { periodKey: j.period.key };
      });
      return this.journey(ctx);
    },

    /**
     * Clôture du parcours : refusée sous 100 %. En une écriture : clôture (bilan figé, résultat capitalisé, marques
     * des points reportés), échéances reportées inscrites au premier jour de leur cycle, décisions effacées.
     * Le verrou tombe avec elle.
     */
    async finalize(ctx, input = {}) {
      // Le bilan est établi avant l'écriture, avec les données qui produisent le résultat versé (comme `closePeriod`).
      let bilan = null;
      try {
        const contract = h.closingContract(socle.state, om.requireUser(socle.state, ctx), input.periodKey);
        bilan = { ...bilans.forClosure(ctx, contract.period, contract.preview.resultCents), recordedAt: today() };
      } catch (err) {
        if (!err.code) throw err;
      }
      const r = await om.command(
        'finalizeClosing',
        ctx,
        input,
        (tx) => {
          const j = journeyOf(tx.draft, tx.userId);
          openOnly(j);
          samePeriod(j, input.periodKey);
          if (j.percent < 100) fail('CLOSING_INCOMPLETE', `Clôture à ${j.percent} % : ${j.remaining.join(', ')}.`, { percent: j.percent, remaining: j.remaining });
          // Rien ne se fige tant que la cohérence n'est pas validée.
          if (j.checks.blocking.length) fail('CLOSING_INCOHERENT', `Cohérence à rétablir avant de clôturer : ${j.checks.blocking.join(', ')}.`, { blocking: j.checks.blocking });
          const deferred = j.points.filter((p) => p.state === 'deferred');
          const journey = {
            percent: j.percent,
            points: j.total,
            closed: j.counts.closed,
            // Marques du cycle : chaque point non validé ici, et le cycle où il se revoit.
            deferred: deferred.map((p) => ({
              pointId: p.id, kind: p.kind, group: p.group, label: p.label, direction: p.direction ?? null, plannedCents: p.plannedCents ?? null,
              fromDate: p.plannedDate ?? null, toPeriodKey: p.deferTo.key, toPeriodLabel: p.deferTo.label, toDate: p.deferTo.start, project: p.project?.name ?? null,
            })),
            account: j.account ? { confirmedAt: j.account.confirmedAt, netCents: j.account.netCents, note: j.account.note ?? null } : null,
            // Historisation : les actions du cycle et les contrôles, tels qu'au moment de figer le cycle.
            actions: actionsSnapshot(j.actions),
            checks: j.checks.items.map((c) => ({ key: c.key, label: c.label, level: c.level, state: c.state, value: c.value })),
            finalizedAt: today(),
          };
          const out = h.recordClosure(tx, { periodKey: j.period.key, expectedResultCents: input.expectedResultCents }, bilan, { journey });
          // La clôture est écrite : le cycle suivant est ouvert, les reports entrent au premier jour de leur cycle.
          const lines = deferred.filter((p) => p.kind === 'line');
          for (const p of lines) {
            budget().carryOverLine(tx, p.id, { toDate: p.deferTo.start, periodKey: j.period.key, periodLabel: j.period.label, toPeriodKey: p.deferTo.key, toPeriodLabel: p.deferTo.label });
          }
          const cycle = h.cycleOf(tx.draft, h.compositionOf(tx.draft, tx.userId).id);
          om.update(tx, cycle, { closingPlan: null });
          return { closureId: out.closureId, capitalizationId: out.capitalizationId, carriedCount: lines.length, deferredCount: deferred.length };
        },
        { creation: true },
      );
      return { replayed: r.replayed, closure: h.closureView(socle.state.closures[r.closureId]), carriedCount: r.carriedCount ?? 0, deferredCount: r.deferredCount ?? 0, journey: this.journey(ctx) };
    },
  };
}
