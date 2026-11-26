// Lectures communes de l'application BPM (contrats partagés par les pages, graphes et détails).
// Chaque montant est en centimes entiers (`…Cents`) ; chaque contrat porte son contexte (user,
// périmètre, période début incluse / fin exclue, date de calcul, révision du stockage).
// Les sommes passent par `budgetLines` (middleware Budget) ou par les métriques administrées :
// un même montant n'est jamais recalculé avec une autre formule. Aucune lecture n'écrit.
import { fail } from '../../socle/errors.mjs';
import { date, isCalendarDate, money, oneOf } from '../../socle/validation.mjs';
import { CADENCES, CAP_LEVEL_PCT, PER_YEAR, monthlyAverageCents, occurrenceDates, parseOccurrenceKey } from '../budget/api.mjs';
import { addDays, today, periodContaining, periodByIndex } from '../budget/api.mjs';
import { GOAL_TYPES } from '../patrimoine/api.mjs';
import { percent } from '../patrimoine/api.mjs';
import { linkedProjectBudgets, isValidatedMove, projectAccountingDate, projectFundingSource } from '../budget/api.mjs';
import { createCapsReads } from './reads-caps.mjs';
import { essentialRefsOf, NATURES, NATURE_LABEL, natureOf } from './natures.mjs';
import { cents, sum } from './format.mjs';

const RESULT = 'bpm.resultatPeriode';
const SUMMARY_KEYS = ['bpm.revenus', 'bpm.charges', RESULT, 'bpm.resteARecevoir', 'bpm.resteAPayer', 'bpm.soldeAttendu', 'bpm.resultatPrevu', 'bpm.tauxEpargne', 'bpm.patrimoineConstitue', 'bpm.patrimoineDisponible', 'bpm.patrimoineFinPeriode', 'bpm.progressionObjectif', 'bpm.resteObjectif'];
const STATUS_LABEL = { settled: 'Réglé', due: 'Du jour', late: 'En retard', pending: 'À venir', unrealized: 'Non réalisé' };
const NATURE_ORDER = ['entrees', ...NATURES];
const WITH_PROJECTS = 'life-with-projects';
const SCOPE_LABELS = {
  principal: 'Budget du projet de vie',
  consolidated: 'Tous les Budgets du user (chaque Budget une fois ; aucun flux père/enfant calculé)',
  [WITH_PROJECTS]: 'Quotidien et projets de la vie',
};

const sign = (direction) => (direction === 'income' ? 1 : -1);

/** Montant venant d'une adresse (texte « 12,50 » ou « 12.50 ») : converti à la frontière, puis validé en centimes. */
const queryMoney = (field, value, opts) => money(field, typeof value === 'string' && value.trim() !== '' ? Number(value.replace(',', '.').replace(/\s/g, '')) : value, opts);


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
      .map((b) => ({ id: b.id, name: b.role === 'life' ? 'Budget du projet de vie' : b.name, role: b.role, coreProjectId: b.coreProjectId, fundingSource: b.fundingSource ?? 'cycle', capsCents: b.capsCents ?? {}, revision: b.revision }));
    return { state, userId, comp, cycle, cs, mctx, period: mctx.period, budgets };
  }

  function contextOf(b, scope = 'principal') {
    const user = b.state.users[b.userId];
    return {
      user: { id: user.id, label: user.label, userType: user.userType },
      scope,
      scopeLabel: SCOPE_LABELS[scope],
      budgets: b.budgets,
      period: b.period ? { ...b.period, endExclusive: addDays(b.period.end, 1) } : null,
      // Bornes de navigation : de la première période du cycle à la période courante (seules lisibles).
      periods: b.cs ? { firstKey: b.cs.first.key, currentKey: b.cs.current.key } : null,
      cycleAnchorDay: b.cycle?.anchorDay ?? null,
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

  function decorateProjectLine(b, line) {
    const view = decorate(b, line);
    const pb = b.state.budgets[line.budgetId];
    if (pb?.role !== 'standard') return view;
    const operation = b.state.operations[line.operationId];
    const fundingSource = projectFundingSource(operation ?? line, pb);
    const posted = operation && isValidatedMove(operation, pb);
    // Une échéance imputable au patrimoine reste ouverte même après la fin du cycle de sa date prévue.
    const status = !line.settled && fundingSource === 'patrimoine' ? statusOf(b.state, null, line) : view.status;
    return {
      ...view, status, statusLabel: STATUS_LABEL[status], fundingSource,
      project: { budgetId: pb.id, coreProjectId: pb.coreProjectId, name: b.state.coreProjects[pb.coreProjectId]?.title ?? pb.name },
      projectPosting: posted ? 'validated' : line.settled ? 'historical' : 'planned',
    };
  }

  /** Fenêtre de lecture : période du cycle, ou vue libre semaine/mois/année (n'altère pas le cycle). */
  function windowOf(b, q) {
    if (q.from || q.to) {
      const from = date('from', q.from, { required: true });
      const to = date('to', q.to, { required: true });
      if (to < from) fail('VALIDATION', 'La fin de la fenêtre précède son début.', { field: 'to' });
      return { from, to, kind: 'custom' };
    }
    if (!b.period) {
      if (q.scope !== WITH_PROJECTS) fail('FORBIDDEN_BY_RULE', 'Cycle à configurer : aucune période à lire.', { field: 'period' });
      const month = periodContaining(today(), 1);
      return { from: month.start, to: month.end, kind: 'custom' };
    }
    return { from: b.period.start, to: b.period.end, kind: 'period' };
  }

  /** Les montants du cycle suivent l'imputation validée ; la date bancaire reste visible. */
  function projectLinesOf(source) {
    return (b, { from, to, by }) => linkedProjectBudgets(b.state, b.comp.budgetId).flatMap(sb => {
      const operations = Object.values(b.state.operations).filter(o => isValidatedMove(o, sb) && projectFundingSource(o, sb) === source &&
        (by === 'planned' ? o.date : projectAccountingDate(o)) >= from && (by === 'planned' ? o.date : projectAccountingDate(o)) <= to);
      if (!operations.length) return [];
      const ids = new Set(operations.map(o => o.id));
      const dates = operations.map(o => o.date).sort();
      return budget().budgetLines(b.state, [sb.id], { from: dates[0], to: dates.at(-1), by: 'planned' })
        .filter(l => ids.has(l.operationId))
        .map(l => ({ ...l, accountingDate: projectAccountingDate(b.state.operations[l.operationId]), fundingSource: source }));
    });
  }
  const validatedProjectLines = projectLinesOf('cycle');
  const patrimoineProjectLines = projectLinesOf('patrimoine');
  /** Paiements notifiés dans cette période, imputés ailleurs : mémoire bancaire sans seconde charge. */
  function paymentTrace(b, { from, to }, by = 'realized') {
    return linkedProjectBudgets(b.state, b.comp.budgetId).flatMap(sb => budget().budgetLines(b.state, [sb.id], { from, to, by })
      .filter(l => {
        const o = b.state.operations[l.operationId];
        const accounting = o && projectAccountingDate(o);
        return o && isValidatedMove(o, sb) && projectFundingSource(o, sb) === 'cycle' && (accounting < from || accounting > to);
      }).map(l => ({ ...decorate(b, l), projectCharge: true, fundingSource: 'cycle', accountingDate: projectAccountingDate(b.state.operations[l.operationId]) })));
  }

  const budgetIdsOf = (b, q) => {
    if (q.budgetId) {
      if (!b.budgets.some((x) => x.id === q.budgetId)) fail('NOT_FOUND', 'Budget inconnu pour ce user.', { field: 'budgetId' });
      return [q.budgetId];
    }
    if (q.scope === WITH_PROJECTS) return [b.comp.budgetId, ...linkedProjectBudgets(b.state, b.comp.budgetId).map(x => x.id)];
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

  /** Traçabilité des projets : mêmes validations, sources et dates que les chiffres BPM.
   * Cycle = période consultée ; patrimoine = stock cumulé au jour de lecture ; all = vie du projet.
   * Les prévisions restent séparées du réalisé, les enveloppes et parts ne sont jamais des flux.
   */
  function projectFlows(ctx, q = {}) {
    const source = oneOf('source', q.source, ['cycle', 'patrimoine', 'all'], 'cycle');
    const b = base(ctx, { periodKey: q.period || undefined });
    const now = today();
    const from = source === 'cycle' ? b.period?.start ?? null : null;
    const to = q.period && b.period ? (b.period.end < now ? b.period.end : now) : now;
    const until = q.until ? date('until', q.until, { required: true }) : source === 'cycle' ? b.period?.end ?? now : addDays(to, 30);
    const matches = (s) => source === 'all' || s === source;
    const rows = [], pending = [], paymentTraces = [], announcementTrace = [];
    for (const pb of linkedProjectBudgets(b.state, b.comp.budgetId).filter(x => !q.projectId || x.coreProjectId === q.projectId)) {
      const operations = Object.values(b.state.operations).filter(o => o.budgetId === pb.id && isValidatedMove(o, pb) && matches(projectFundingSource(o, pb)));
      const dates = operations.map(o => o.date).sort();
      const selected = new Map(operations.map(o => [o.id, o]));
      const decorateProject = (line) => ({ ...decorateProjectLine(b, line), projectCharge: true });
      if (dates.length) {
        for (const raw of budget().budgetLines(b.state, [pb.id], { from: dates[0], to: dates.at(-1), by: 'planned' })) {
          const op = selected.get(raw.operationId);
          if (!op) continue;
          const accountingDate = projectAccountingDate(op);
          const line = { ...decorateProject(raw), accountingDate };
          if ((source !== 'cycle' || b.period) && (!from || accountingDate >= from) && accountingDate <= (source === 'cycle' ? b.period?.end ?? to : to)) rows.push(line);
          else if (source === 'cycle' && b.period) {
            if (op.realizedDate >= b.period.start && op.realizedDate <= b.period.end) paymentTraces.push(line);
            if (op.date >= b.period.start && op.date <= b.period.end) announcementTrace.push(line);
          }
        }
      }
      const starts = [b.cycle?.startDate, pb.allocationDate, ...Object.values(b.state.operations).filter(o => o.budgetId === pb.id).map(o => o.date), ...Object.values(b.state.recurrences ?? {}).filter(r => r.budgetId === pb.id).map(r => r.firstDate)].filter(Boolean).sort();
      const pendingFrom = from ?? starts[0] ?? to;
      if (source === 'cycle' && !b.period) continue;
      for (const raw of budget().budgetLines(b.state, [pb.id], { from: pendingFrom, to: until, by: 'planned' })) {
        if (raw.settled) continue;
        const line = decorateProject(raw);
        if (!matches(line.fundingSource)) continue;
        if (line.status !== 'unrealized') pending.push(line);
      }
    }
    rows.sort((x, y) => y.accountingDate.localeCompare(x.accountingDate) || x.label.localeCompare(y.label));
    pending.sort((x, y) => x.plannedDate.localeCompare(y.plannedDate) || x.label.localeCompare(y.label));
    const totalsOf = (lines, planned = []) => {
      const paidCents = sum(lines.filter(l => l.direction === 'charge'), l => l.realizedCents);
      const receivedCents = sum(lines.filter(l => l.direction === 'income'), l => l.realizedCents);
      return { paidCents, receivedCents, netCents: receivedCents - paidCents, count: lines.length,
        pendingPaidCents: sum(planned.filter(l => l.direction === 'charge'), l => l.plannedCents), pendingReceivedCents: sum(planned.filter(l => l.direction === 'income'), l => l.plannedCents), pendingCount: planned.length };
    };
    const ids = [...new Set([...rows, ...pending].map(l => l.budgetId))];
    return { context: contextOf(b), source, from, to: source === 'cycle' ? b.period?.end ?? to : to, pendingUntil: until,
      totals: totalsOf(rows, pending),
      bySource: Object.fromEntries(['cycle', 'patrimoine'].map(s => [s, totalsOf(rows.filter(l => l.fundingSource === s), pending.filter(l => l.fundingSource === s))])),
      projects: ids.map(id => ({ ...b.budgets.find(x => x.id === id), ...totalsOf(rows.filter(l => l.budgetId === id), pending.filter(l => l.budgetId === id)) })),
      lines: rows, pending, paymentTrace: paymentTraces, announcementTrace };
  }

  /** Prévision de trésorerie : réalisé + échéances restant à valider, sans enveloppes.
   * Une échéance réalisée, même à une autre date, sort du prévisionnel. Les cycles clos ne
   * sont jamais capitalisés une deuxième fois ; les prélèvements déjà validés sont dans le stock.
   */
  function financialOutlook(ctx, q = {}) {
    const b = base(ctx);
    const horizon = Number(q.horizon ?? 3);
    if (!Number.isInteger(horizon) || horizon < 1 || horizon > 12) fail('VALIDATION', 'Choisissez entre 1 et 12 cycles.', { field: 'horizon' });
    const stockCents = summary(ctx).figures['bpm.patrimoineDisponible'].valueCents;
    if (!b.cs) return { context: contextOf(b), stockCents, waitingCents: 0, waiting: [], cycles: [], pending: [], reason: 'Fixez l’ancrage du cycle pour projeter les budgets. Le patrimoine reste disponible sans cycle.' };
    const current = b.cs.current;
    const periods = Array.from({ length: horizon }, (_, i) => periodByIndex(current.index + i, b.cycle.anchorDay));
    const movements = projectFlows(ctx, { source: 'all', until: periods.at(-1).end });
    const waiting = [];
    for (let index = b.cs.firstOpen.index; index < current.index; index++) {
      const p = periodByIndex(index, b.cycle.anchorDay);
      const result = summary(ctx, { periodKey: p.key }).figures[RESULT].valueCents;
      waiting.push({ period: p, resultCents: result });
    }
    const waitingCents = waiting.some(w => w.resultCents === null) ? null : sum(waiting, w => w.resultCents);
    let stock = stockCents === null || waitingCents === null ? null : stockCents + waitingCents;
    const cycles = periods.map((p, index) => {
      const planned = budget().budgetLines(b.state, [b.comp.budgetId], { from: p.start, to: p.end, by: 'planned' }).filter(l => !l.settled);
      const projects = movements.pending.filter(l => l.fundingSource === 'cycle' && l.plannedDate >= p.start && l.plannedDate <= p.end);
      const wealth = movements.pending.filter(l => l.fundingSource === 'patrimoine' && (index === 0 || l.plannedDate >= p.start) && l.plannedDate <= p.end);
      const incoming = ls => sum(ls.filter(l => l.direction === 'income'), l => l.plannedCents);
      const outgoing = ls => sum(ls.filter(l => l.direction === 'charge'), l => l.plannedCents);
      const actual = index === 0 ? summary(ctx).figures[RESULT].valueCents : 0;
      const lifeIncomeCents = incoming(planned), lifeChargeCents = outgoing(planned);
      const projectIncomeCents = incoming(projects), projectChargeCents = outgoing(projects);
      const wealthIncomeCents = incoming(wealth), wealthChargeCents = outgoing(wealth);
      const expectedCents = actual === null ? null : actual + lifeIncomeCents - lifeChargeCents + projectIncomeCents - projectChargeCents;
      const stockBeforeCents = stock;
      stock = stock === null || expectedCents === null ? null : stock + expectedCents + wealthIncomeCents - wealthChargeCents;
      return { period: p, actualCents: actual, lifeIncomeCents, lifeChargeCents, projectIncomeCents, projectChargeCents, wealthIncomeCents, wealthChargeCents, expectedCents, stockBeforeCents, stockAfterCents: stock,
        projects: movements.projects.filter(x => [...projects, ...wealth].some(l => l.budgetId === x.id)).map(x => ({ projectId: x.coreProjectId, name: x.name,
          cycleCents: incoming(projects.filter(l => l.budgetId === x.id)) - outgoing(projects.filter(l => l.budgetId === x.id)),
          patrimoineCents: incoming(wealth.filter(l => l.budgetId === x.id)) - outgoing(wealth.filter(l => l.budgetId === x.id)) })) };
    });
    return { context: contextOf(b), stockCents, waitingCents, waiting, cycles, pending: movements.pending, reason: null };
  }

  function register(ctx, q = {}) {
    const b = base(ctx, { periodKey: q.period });
    const win = windowOf(b, q);
    const dateBasis = oneOf('dateBasis', q.dateBasis, ['planned', 'realized'], 'planned');
    const scope = q.budgetId ? 'budget' : oneOf('scope', q.scope, ['principal', 'consolidated', WITH_PROJECTS], 'principal');
    const principal = scope === 'principal';
    const ids = budgetIdsOf(b, q);
    const all = budget().budgetLines(b.state, ids, { from: win.from, to: win.to, by: dateBasis }).map(l => decorateProjectLine(b, l));
    // La lecture comptable du cycle sélectionne les tâches validées par date d'imputation.
    if (principal) {
      for (const l of validatedProjectLines(b, { from: win.from, to: win.to, by: dateBasis })) all.push({ ...decorate(b, l), projectCharge: true });
    }
    const selectedDate = (line) => dateBasis === 'realized'
      ? (principal ? line.accountingDate ?? line.realizedDate : line.realizedDate)
      : line.plannedDate;
    all.sort((x, y) => selectedDate(x).localeCompare(selectedDate(y)) || x.label.localeCompare(y.label));
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
        (!q.taskId || l.taskId === q.taskId) &&
        (!needle || [l.label, l.note, l.costCenterLabel, l.project?.name, l.taskTitle].some((t) => (t ?? '').toLowerCase().includes(needle))),
    );
    const groupBy = oneOf('groupBy', q.groupBy, ['center', 'project', 'nature', 'date', 'none'], 'center');
    const keyOf = {
      center: (l) => [l.costCenterRef, l.costCenterLabel ?? 'Centre à préciser'],
      project: (l) => [l.budgetId, l.budgetRole === 'life' ? 'Budget du projet de vie' : l.budgetName],
      nature: (l) => (l.nature ? [l.nature, NATURE_LABEL[l.nature]] : ['entrees', 'Entrées']),
      date: (l) => [selectedDate(l), selectedDate(l)],
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
    // Plafonds de la période (budget du projet de vie seulement) : état de chaque poste.
    const caps = principal && win.kind === 'period' ? capsBrief(capsRead(b)) : null;
    const context = contextOf(b, scope);
    if (scope === 'budget') context.scopeLabel = b.budgets.find(x => x.id === q.budgetId).name;
    if (scope === WITH_PROJECTS) context.budgets = b.budgets.filter(x => ids.includes(x.id));
    const ordered = [...groups.values()];
    return {
      context,
      window: win,
      paymentTrace: principal ? paymentTrace(b, win) : [],
      announcementTrace: principal ? paymentTrace(b, win, 'planned') : [],
      dateBasis,
      selection: scope === WITH_PROJECTS
        ? 'Les mouvements du quotidien et des projets partagent les mêmes postes. Chaque mouvement indique son imputation. Les totaux portent sur les lignes affichées.'
        : dateBasis === 'realized'
        ? 'Les flux des tâches sont sélectionnés par leur date d’imputation au cycle ; la date du paiement reste visible. Les autres flux suivent leur date réelle.'
        : 'Les lignes sont sélectionnées par leur date prévue ; le réalisé des synthèses suit l’imputation validée des tâches et la date réelle des autres flux.',
      filters: { q: q.q ?? null, direction: q.direction ?? null, nature, status: q.status ?? null, center: q.center ?? null, taskId: q.taskId ?? null, budgetId: q.budgetId ?? null, groupBy, dateBasis },
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
      // Par nature : entrées, puis indispensables, courantes et projets.
      groups: groupBy === 'nature' ? ordered.sort((x, y) => NATURE_ORDER.indexOf(x.key) - NATURE_ORDER.indexOf(y.key)) : ordered,
      caps,
      lines,
    };
  }

  /** Détail d'une ligne (opération ou occurrence attendue) : définition, règlements et identifiants. */
  /** Projet de la vie qui porte une échéance (null pour le budget de vie) : de quoi prévenir avant un règlement hors enveloppe. */
  function projectOfLine(state, view) {
    const pb = state.budgets[view.budgetId];
    if (pb?.role !== 'standard') return null;
    const funded = Number.isInteger(pb.allocationCents) && typeof pb.allocationDate === 'string';
    const operation = view.operationId ? state.operations[view.operationId] : null;
    const inclusion = view.direction === 'income' && (!view.settled || operation && isValidatedMove(operation, pb))
      ? 'income' : !funded ? 'unfunded' : !view.settled ? 'pending' : operation && isValidatedMove(operation, pb) ? 'included' : 'before-allocation';
    return { fundingSource: projectFundingSource(operation ?? view, pb), budgetId: pb.id, coreProjectId: pb.coreProjectId, name: pb.name, funded, taskFundingRequired: !!pb.taskFundingRequired, allocationDate: funded ? pb.allocationDate : null, taskTitle: view.taskId ? state.tasks[view.taskId]?.title ?? null : null, inclusion };
  }

  function lineDetail(ctx, lineId, { periodKey } = {}) {
    const b = base(ctx, { periodKey });
    const state = b.state;
    const occ = parseOccurrenceKey(lineId);
    let line;
    let rec = null;
    if (occ) {
      rec = om.owned(state, 'recurrence', occ.recurrenceId, b.userId);
      const settled = om.by(state, 'operation', 'recurrenceId', rec.id).find((o) => o.occurrenceDate === occ.date);
      line = budget().budgetLines(state, [rec.budgetId], { from: occ.date, to: occ.date, by: 'planned' }).find((l) => l.occurrenceKey === lineId || l.operationId === settled?.id);
    } else {
      const o = om.owned(state, 'operation', lineId, b.userId);
      rec = o.recurrenceId ? state.recurrences[o.recurrenceId] : null;
      line = budget().budgetLines(state, [o.budgetId], { from: o.date, to: o.date, by: 'planned' }).find((l) => l.operationId === o.id);
    }
    if (!line) fail('NOT_FOUND', "Cette échéance n'existe pas (hors des dates de sa définition).", { lineId });
    const view = decorateProjectLine(b, line);
    // Échéances écartées de la définition : elles se rétablissent depuis n'importe quelle échéance de la série.
    const skipped = rec
      ? om
          .list(state, 'operation', (o) => o.recurrenceId === rec.id && o.status === 'cancelled' && o.cancelReason !== 'Définition supprimée')
          .sort((x, y) => x.occurrenceDate.localeCompare(y.occurrenceDate))
          .map((o) => ({ operationId: o.id, occurrenceDate: o.occurrenceDate, plannedCents: o.amountCents, reason: o.cancelReason ?? null, revision: o.revision }))
      : [];
    const settlements = rec
      ? om
          .list(state, 'operation', (o) => o.recurrenceId === rec.id && o.status === 'realized')
          .sort((x, y) => y.realizedDate.localeCompare(x.realizedDate))
          .map((o) => ({ operationId: o.id, occurrenceDate: o.occurrenceDate, plannedCents: o.amountCents, realizedCents: o.realizedAmountCents, realizedDate: o.realizedDate, outsidePeriod: !b.period || o.realizedDate < b.period.start || o.realizedDate > b.period.end }))
      : view.settled
        ? [{ operationId: view.operationId, occurrenceDate: null, plannedCents: view.plannedCents, realizedCents: view.realizedCents, realizedDate: view.realizedDate, outsidePeriod: !b.period || view.realizedDate < b.period.start || view.realizedDate > b.period.end }]
        : [];
    // Même portée que la garde d'écriture BPM : le budget de vie, ou les dates depuis
    // l'attribution d'un projet financé. Un règlement antérieur reste hors de cette enveloppe.
    const pb = state.budgets[view.budgetId];
    const independentIncome = line.operationId && state.operations[line.operationId]?.independentIncome;
    const protectedClosure = (ymd) => ymd && (view.budgetId === b.comp.budgetId || independentIncome || Number.isInteger(pb?.allocationCents) && pb?.allocationDate && ymd >= pb.allocationDate) ? closedPeriodOf(state, b.cycle, ymd) : null;
    const editClosure = pb?.role === 'standard' ? protectedClosure(view.accountingDate ?? view.realizedDate) : protectedClosure(view.plannedDate) ?? protectedClosure(view.realizedDate);
    const canEdit = view.kind === 'occurrence' || !editClosure;
    const timingPeriod = (ymd) => {
      if (!ymd || b.cycle?.state !== 'active') return null;
      const p = periodContaining(ymd, b.cycle.anchorDay);
      const status = closedPeriodOf(state, b.cycle, ymd) ? 'closed' : p.end < today() ? 'ended' : p.start > today() ? 'future' : 'current';
      return { key: p.key, label: p.label, start: p.start, end: p.end, status };
    };
    return {
      context: contextOf(b),
      line: view,
      definition: rec ? budget().recurrenceView(state, rec) : null,
      settlements,
      skipped,
      ids: { lineId, operationId: view.operationId, recurrenceId: view.recurrenceId, budgetId: view.budgetId, taskId: view.taskId },
      project: projectOfLine(state, view),
      timing: { plannedPeriod: timingPeriod(view.plannedDate), realizedPeriod: timingPeriod(view.realizedDate), accountingPeriod: timingPeriod(view.accountingDate ?? view.realizedDate) },
      actions: {
        canSettle: !view.settled && !(view.direction === 'charge' && pb?.taskFundingRequired && !Number.isInteger(pb.allocationCents)),
        canCancelSettlement: view.settled && !protectedClosure(view.accountingDate ?? view.realizedDate),
        canEdit,
        // Doublon ou erreur de saisie : une opération ponctuelle s'annule tant que ses dates ne sont pas closes.
        canCancelEntry: view.kind === 'operation' && !view.recurrenceId && !editClosure,
        // Échéance d'une définition : elle s'écarte tant qu'elle n'est pas réglée ; la définition se supprime tant qu'aucune n'est réglée.
        canSkipOccurrence: !!rec && !view.settled,
        canDeleteDefinition: !!rec && !om.by(state, 'operation', 'recurrenceId', rec.id).some((o) => o.status === 'realized'),
        editReason: canEdit ? null : `La période ${editClosure.periodLabel ?? editClosure.periodKey} est close : cette opération est conservée dans son historique.`,
        settlementPolicy: pb?.role === 'standard' ? 'La date du paiement garde la trace bancaire. Seule la date d’imputation validée affecte le cycle choisi ; le patrimoine est traité hors cycle.' : 'Une échéance d’une période close peut être réglée plus tard, à sa date réelle, sans modifier l’historique clos.',
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

  // ---------- plafonds de dépenses : centres de coût et catégories ----------

  /** Résumé d'un plafond pour les listes (registre) : plafond, engagé, marge, consommation, dépassement. */
  // Plafonds : voir reads-caps.mjs.
  const { capsBrief, capsRead, capsReview, spendingCaps, capAlertsFor, previewCaps } = createCapsReads(socle, h, { budget, base, contextOf, statusOf, decorate, validatedProjectLines });

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

  return {
    summary, register, projectFlows, financialOutlook, lineDetail, centers, centerDetail, spendingCaps, capsReview, capAlertsFor, previewCaps, incomes, balance, history, impact, budgetType, due, events, directives, projection, previewEntry, visionOf, goalsOf, surplusProgress, GOAL_TYPES,
    // Outils partagés avec la gestion du projet de vie (`life.mjs`) et la clôture : même contexte, mêmes états, mêmes lignes.
    base, contextOf, decorate, decorateProjectLine, validatedProjectLines, patrimoineProjectLines, capsRead,
  };
}
