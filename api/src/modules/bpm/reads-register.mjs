// Lectures BPM — registre des flux : lignes du cycle, flux des projets, perspectives financières, détail d'une ligne.
import { fail } from '../../socle/errors.mjs';
import { date, oneOf } from '../../socle/validation.mjs';
import { parseOccurrenceKey } from '../budget/api.mjs';
import { addDays, today, periodContaining, periodByIndex } from '../budget/api.mjs';
import { linkedProjectBudgets, isValidatedMove, projectAccountingDate, projectFundingSource } from '../budget/api.mjs';
import { essentialRefsOf, NATURES, NATURE_LABEL, natureOf } from './natures.mjs';
import { sum } from './format.mjs';
import { RESULT, NATURE_ORDER, WITH_PROJECTS } from './reads-shared.mjs';

/** `h` : outils du module BPM ; `kit` : contexte commun des lectures (reads.mjs). */
export function createRegisterReads(socle, h, kit) {
  const { om } = socle;
  const { budget, base, contextOf, closedPeriodOf, decorate, decorateProjectLine, windowOf, validatedProjectLines, paymentTrace, budgetIdsOf, capsBrief, capsRead, summary } = kit;

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
    // Plafonds de la période : état de chaque poste. Même périmètre que les plafonds (budget de vie et charges validées
    // des projets), donc lu aussi dans la vue « avec les projets » de Mouvements (BPM-Astra).
    const caps = (principal || scope === WITH_PROJECTS) && win.kind === 'period' ? capsBrief(capsRead(b)) : null;
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

  return { projectFlows, financialOutlook, register, lineDetail };
}
