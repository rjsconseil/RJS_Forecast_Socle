// Lectures communes de l'application BPM (contrats partagés par les pages, graphes et détails).
// Chaque montant est en centimes entiers (`…Cents`) ; chaque contrat porte son contexte (user,
// périmètre, période début incluse / fin exclue, date de calcul, révision du stockage).
// Les sommes passent par `budgetLines` (middleware Budget) ou par les métriques administrées :
// un même montant n'est jamais recalculé avec une autre formule. Aucune lecture n'écrit.
import { fail } from '../../socle/errors.mjs';
import { date } from '../../socle/validation.mjs';
import { addDays, today, periodContaining } from '../budget/api.mjs';
import { GOAL_TYPES } from '../patrimoine/api.mjs';
import { linkedProjectBudgets, isValidatedMove, projectAccountingDate, projectFundingSource } from '../budget/api.mjs';
import { createCapsReads } from './reads-caps.mjs';
import { cents } from './format.mjs';
import { SUMMARY_KEYS, STATUS_LABEL, WITH_PROJECTS, SCOPE_LABELS } from './reads-shared.mjs';
import { createRegisterReads } from './reads-register.mjs';
import { createCenterReads } from './reads-centers.mjs';
import { createOutlookReads } from './reads-outlook.mjs';

/**
 * @param socle socle complet
 * @param h     helpers du module BPM : requireComposition, metricContext, cycleState, figuresFor, closuresOf
 */
export function createReads(socle, h) {
  const { om } = socle;
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

  // ---------- plafonds de dépenses : centres de coût et catégories ----------
  const { capsBrief, capsRead, capsReview, spendingCaps, capAlertsFor, previewCaps } = createCapsReads(socle, h, { budget, base, contextOf, statusOf, decorate, validatedProjectLines });

  const kit = { budget, base, contextOf, closedPeriodOf, statusOf, decorate, decorateProjectLine, windowOf, validatedProjectLines, patrimoineProjectLines, paymentTrace, budgetIdsOf, capsBrief, capsRead, summary };
  const { projectFlows, financialOutlook, register, lineDetail } = createRegisterReads(socle, h, kit);
  const { centers, centerDetail, incomes, balance } = createCenterReads(socle, h, kit);
  const { history, impact, budgetType, due, visionOf, goalsOf, events, surplusProgress, directives, projection, previewEntry } = createOutlookReads(socle, h, kit);

  return {
    summary, register, projectFlows, financialOutlook, lineDetail, centers, centerDetail, spendingCaps, capsReview, capAlertsFor, previewCaps, incomes, balance, history, impact, budgetType, due, events, directives, projection, previewEntry, visionOf, goalsOf, surplusProgress, GOAL_TYPES,
    // Outils partagés avec la gestion du projet de vie (`life.mjs`) et la clôture : même contexte, mêmes états, mêmes lignes.
    base, contextOf, decorate, decorateProjectLine, validatedProjectLines, patrimoineProjectLines, capsRead,
  };
}
