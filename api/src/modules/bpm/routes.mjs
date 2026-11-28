// Routes HTTP de BPM : chaque adresse appelle une lecture ou une commande du module, rien d'autre.
import { projectFundingSource } from '../budget/api.mjs';

export function bpmRoutes(socle) {
  const s = socle.modules.bpm;
  const { budget, patrimoine } = socle.modules;
  const lifeBudgetId = (ctx) => socle.modules.bpm.compositionOf(socle.stateOf(ctx), socle.om.requireUser(socle.stateOf(ctx), ctx))?.budgetId;
  /** Ajoute les plafonds dépassés touchés par la dépense écrite : information, jamais un refus. */
  const withCapAlerts = (ctx, r) => {
    const x = r?.operation ?? r?.recurrence;
    if (!x) return r;
    const project = socle.stateOf(ctx).budgets[x.budgetId];
    if (project?.role === 'standard' && projectFundingSource(x, project) === 'patrimoine') return { ...r, capAlerts: [] };
    try {
      const alerts = s.reads.capAlertsFor(ctx, { date: x.accountingDate ?? x.realizedDate ?? x.date ?? x.firstDate, costCenterRef: x.costCenterRef, direction: x.direction });
      return { ...r, capAlerts: alerts };
    } catch {
      return { ...r, capAlerts: [] };
    }
  };
  return [
    // Horloge commune des sections : période, phase et verrou du cycle.
    ['GET', '/api/bpm/cycle/clock', ({ ctx }) => s.cycleClock(ctx)],
    ['GET', '/api/bpm/dashboard', ({ ctx, query }) => s.dashboard(ctx, { periodKey: query.get('period') || undefined })],
    ['GET', '/api/bpm/figures/:key', ({ ctx, params, query }) => s.figure(ctx, params.key, { periodKey: query.get('period') || undefined })],
    ['GET', '/api/bpm/summary', ({ ctx, query }) => s.reads.summary(ctx, { periodKey: query.get('period') || undefined })],
    ['GET', '/api/bpm/register', ({ ctx, query }) => s.reads.register(ctx, Object.fromEntries(query))],
    ['GET', '/api/bpm/project-flows', ({ ctx, query }) => s.reads.projectFlows(ctx, Object.fromEntries(query))],
    ['GET', '/api/bpm/financial-outlook', ({ ctx, query }) => s.reads.financialOutlook(ctx, Object.fromEntries(query))],
    ['GET', '/api/bpm/lines/:id', ({ ctx, params, query }) => s.reads.lineDetail(ctx, params.id, { periodKey: query.get('period') || undefined })],
    ['GET', '/api/bpm/centers', ({ ctx, query }) => s.reads.centers(ctx, Object.fromEntries(query))],
    ['GET', '/api/bpm/centers/:ref', ({ ctx, params, query }) => s.reads.centerDetail(ctx, params.ref, Object.fromEntries(query))],
    ['GET', '/api/bpm/incomes', ({ ctx, query }) => s.reads.incomes(ctx, Object.fromEntries(query))],
    ['GET', '/api/bpm/history', ({ ctx, query }) => s.reads.history(ctx, { before: query.get('before') ?? undefined, limit: query.get('limit') ?? undefined })],
    ['GET', '/api/bpm/impact', ({ ctx, query }) => s.reads.impact(ctx, { period: query.get('period') || undefined })],
    ['GET', '/api/bpm/budget-type', ({ ctx }) => s.reads.budgetType(ctx)],
    ['GET', '/api/bpm/due', ({ ctx }) => s.reads.due(ctx)],
    ['GET', '/api/bpm/events', ({ ctx }) => s.reads.events(ctx)],
    ['GET', '/api/bpm/directives', ({ ctx }) => s.reads.directives(ctx)],
    ['GET', '/api/bpm/projection', ({ ctx, query }) => s.reads.projection(ctx, Object.fromEntries(query))],
    ['GET', '/api/bpm/life-management', ({ ctx, query }) => s.life.lifeManagement(ctx, { periodKey: query.get('period') || undefined })],
    ['POST', '/api/bpm/caps/preview', ({ ctx, body }) => s.reads.previewCaps(ctx, body)],
    ['POST', '/api/bpm/operations/preview', ({ ctx, body }) => s.reads.previewEntry(ctx, body)],
    ['PUT', '/api/bpm/vision', ({ ctx, body }) => s.updateVision(ctx, body)],
    ['GET', '/api/bpm/goals', ({ ctx }) => s.goals(ctx)],
    ['POST', '/api/bpm/goals', ({ ctx, body }) => s.createGoal(ctx, body)],
    ['PUT', '/api/bpm/goals/:id', ({ ctx, params, body }) => s.updateGoal(ctx, params.id, body)],
    ['POST', '/api/bpm/goals/:id/remove', ({ ctx, params, body }) => s.removeGoal(ctx, params.id, body)],
    ['GET', '/api/bpm/setup', ({ ctx }) => s.setupProfile(ctx)],
    ['POST', '/api/bpm/setup', ({ ctx, body }) => s.setupProject(ctx, body)],
    ['GET', '/api/bpm/recurrences', ({ ctx, query }) => budget.recurrences(ctx, { budgetId: query.get('budgetId') || undefined })],
    ['PUT', '/api/bpm/recurrences/:id', async ({ ctx, params, body }) => withCapAlerts(ctx, await budget.updateRecurrence(ctx, params.id, body))],
    ['POST', '/api/bpm/recurrences/:id/settle', async ({ ctx, params, body }) => withCapAlerts(ctx, await budget.settleOccurrence(ctx, params.id, body))],
    // Une échéance qui n'aura pas lieu s'écarte (et se rétablit) ; une définition saisie par erreur se supprime.
    ['POST', '/api/bpm/recurrences/:id/skip', ({ ctx, params, body }) => budget.skipOccurrence(ctx, params.id, body)],
    ['POST', '/api/bpm/recurrences/:id/restore', ({ ctx, params, body }) => budget.restoreOccurrence(ctx, params.id, body)],
    ['POST', '/api/bpm/recurrences/:id/cancel', ({ ctx, params, body }) => budget.cancelRecurrence(ctx, params.id, body)],
    ['PUT', '/api/bpm/operations/:id', async ({ ctx, params, body }) => withCapAlerts(ctx, await budget.updateOperation(ctx, params.id, body))],
    ['POST', '/api/bpm/operations/:id/cancel-realization', ({ ctx, params, body }) => budget.cancelRealization(ctx, params.id, body)],
    ['POST', '/api/bpm/operations/:id/cancel', ({ ctx, params, body }) => budget.cancelOperation(ctx, params.id, body)],
    ['PUT', '/api/bpm/caps', ({ ctx, body }) => budget.setCaps(ctx, lifeBudgetId(ctx), body)],
    // Plafonds de dépenses : centres de coût et catégories personnalisées (jamais bloquants).
    ['GET', '/api/bpm/spending-caps', ({ ctx, query }) => s.reads.spendingCaps(ctx, Object.fromEntries(query))],
    ['GET', '/api/bpm/caps-review', ({ ctx, query }) => s.reads.capsReview(ctx, Object.fromEntries(query))],
    ['GET', '/api/bpm/periods', ({ ctx, query }) => s.periods(ctx, { before: query.get('before') ?? undefined, limit: query.get('limit') ?? undefined })],
    ['GET', '/api/bpm/closures/preview', ({ ctx, query }) => s.closingPreview(ctx, query.get('period'))],
    ['GET', '/api/bpm/preparation', ({ ctx }) => s.preparation(ctx)],
    ['POST', '/api/bpm/prepare', ({ ctx, body }) => s.prepareComposition(ctx, body)],
    ['PUT', '/api/bpm/cycle', ({ ctx, body }) => s.configureCycle(ctx, body)],
    ['GET', '/api/bpm/closures', ({ ctx }) => s.closures(ctx)],
    ['GET', '/api/bpm/bilans', ({ ctx }) => s.bilans.list(ctx)],
    ['GET', '/api/bpm/meteo', ({ ctx }) => s.meteo.report(ctx)],
    ['GET', '/api/bpm/bilans/:periodKey', ({ ctx, params }) => s.bilans.detail(ctx, params.periodKey)],
    ['POST', '/api/bpm/closures', ({ ctx, body }) => s.closePeriod(ctx, body)],
    // Parcours de clôture (page « Clôture du cycle ») : suivi des points, décisions, clôture qui lance le cycle suivant.
    ['GET', '/api/bpm/closing', ({ ctx }) => s.closingJourney(ctx)],
    // Résumé pour le cadre des pages : mode clôture et points qui viennent de se clore.
    ['GET', '/api/bpm/closing/brief', ({ ctx }) => s.closingBrief(ctx)],
    ['POST', '/api/bpm/closing/decisions', ({ ctx, body }) => s.closingDecision(ctx, body)],
    ['POST', '/api/bpm/closing/finalize', ({ ctx, body }) => s.finalizeClosing(ctx, body)],
    ['GET', '/api/bpm/life-projects', ({ ctx }) => s.lifeProjects(ctx)],
    // Projets et tâches du budget de vie (les projets et tâches sont ceux du noyau ; BPM porte leurs budgets).
    ['GET', '/api/bpm/projects', ({ ctx }) => s.projects.overview(ctx)],
    ['POST', '/api/bpm/projects', ({ ctx, body }) => s.projects.createProject(ctx, body)],
    ['POST', '/api/bpm/projects/adopt', ({ ctx, body }) => s.projects.adoptProject(ctx, body)],
    ['GET', '/api/bpm/projects/:id', ({ ctx, params }) => s.projects.projectDetail(ctx, params.id)],
    ['GET', '/api/bpm/tasks', ({ ctx }) => s.projects.tasksOverview(ctx)],
    ['POST', '/api/bpm/tasks', ({ ctx, body }) => s.projects.createTask(ctx, body)],
    ['POST', '/api/bpm/project-budgets/:id/requests/:taskId', ({ ctx, params, body }) => s.projects.requestTaskBudget(ctx, params.id, params.taskId, body)],
    ['POST', '/api/bpm/task-budget-requests/:id/decision', ({ ctx, params, body }) => s.projects.decideTaskBudget(ctx, params.id, body)],
    ['PUT', '/api/bpm/project-budgets/:id/allocation', ({ ctx, params, body }) => s.projects.allocate(ctx, params.id, body)],
    ['PUT', '/api/bpm/project-budgets/:id/task-cost', ({ ctx, params, body }) => s.projects.setTaskCost(ctx, params.id, body)],
    ['PUT', '/api/bpm/project-budgets/:id/shares/:taskId', ({ ctx, params, body }) => s.projects.setTaskShare(ctx, params.id, params.taskId, body)],
    ['POST', '/api/bpm/project-budgets/:id/shares/:taskId/release', ({ ctx, params, body }) => s.projects.releaseTaskShare(ctx, params.id, params.taskId, body)],
    ['PUT', '/api/bpm/project-budgets/:id/returns/:taskId', ({ ctx, params, body }) => s.projects.setTaskReturn(ctx, params.id, params.taskId, body)],
    ['POST', '/api/bpm/project-budgets/:id/overruns', ({ ctx, params, body }) => s.projects.requestOverrun(ctx, params.id, body)],
    // Abandonner un projet de la vie rend son enveloppe non consommée au budget de vie ; le reprendre le rouvre.
    ['POST', '/api/bpm/project-budgets/:id/abandon', ({ ctx, params, body }) => s.projects.abandonProject(ctx, params.id, body)],
    ['POST', '/api/bpm/project-budgets/:id/resume', ({ ctx, params, body }) => s.projects.resumeProject(ctx, params.id, body)],
    ['POST', '/api/bpm/overruns/bill', ({ ctx, body }) => s.projects.billOverruns(ctx, body)],
    ['POST', '/api/bpm/overruns/:id/decision', ({ ctx, params, body }) => s.projects.decideOverrun(ctx, params.id, body)],
    ['POST', '/api/bpm/life-projects', ({ ctx, body }) => s.createLifeProject(ctx, body)],
    ['GET', '/api/bpm/cost-centers', ({ ctx }) => budget.costCenters(ctx)],
    ['POST', '/api/bpm/cost-centers', ({ ctx, body }) => budget.addCustomCostCenter(ctx, body)],
    // Éditeur partagé : ponctuelle ou récurrente ; Budget du projet de vie par défaut, ou une branche du user.
    ['POST', '/api/bpm/operations', async ({ ctx, body }) => withCapAlerts(ctx, await budget.createEntry(ctx, { ...body, budgetId: body?.budgetId || lifeBudgetId(ctx) }))],
    ['POST', '/api/bpm/operations/:id/realize', async ({ ctx, params, body }) => withCapAlerts(ctx, await budget.realizeOperation(ctx, params.id, body))],
    ['PUT', '/api/bpm/patrimoine', ({ ctx, body }) => patrimoine.updatePatrimoine(ctx, socle.modules.bpm.compositionOf(socle.stateOf(ctx), socle.om.requireUser(socle.stateOf(ctx), ctx))?.patrimoineId, body)],
  ];
}
