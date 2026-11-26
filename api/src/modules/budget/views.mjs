// Budget Management — vues et références partagées par les commandes et les lectures du middleware : Budget de vie,
// centres de coût, catégories de dépenses, tâche d'une opération, et formes présentées (opération, définition, ligne).
// Fonctions pures sur l'état lu (vue de la partition du user), sans écriture.
import { fail } from '../../socle/errors.mjs';
import { text } from '../../socle/validation.mjs';
import { CADENCE_LABEL } from './recurrence.mjs';
import { STD } from './lines.mjs';

export const DIRECTIONS = ['income', 'charge'];
export const DIRECTION_LABEL = { income: 'Revenu', charge: 'Charge' };
export const toEuros = (cents) => (cents === null || cents === undefined ? null : cents / 100);

export function createBudgetViews(socle) {
  const { om, parameters } = socle;


  const lifeBudgetOf = (state, userId) => om.list(state, 'budget', (b) => b.userId === userId && b.role === 'life')[0] ?? null;

  function costCentersOf(state, userId) {
    const user = om.get(state, 'user', userId);
    const standard = parameters
      .value(state, 'budget.centresStandards')
      .filter((c) => !c.userTypes || c.userTypes.includes(user?.userType))
      .map((c) => ({ ref: STD + c.key, key: c.key, label: c.label, direction: c.direction, directionLabel: DIRECTION_LABEL[c.direction], standard: true }));
    const custom = om
      .list(state, 'costCenter', (c) => c.userId === userId)
      .map((c) => ({ ref: c.id, id: c.id, label: c.label, direction: c.direction, directionLabel: DIRECTION_LABEL[c.direction], standard: false }));
    return [...standard, ...custom];
  }

  /** Résout la référence de centre : standard (`std:<clé>`) ou centre personnalisé (ID). */
  function costCenterFields(state, userId, ref, direction) {
    const center = costCentersOf(state, userId).find((c) => c.ref === ref);
    if (!center) fail('REFERENCE_NOT_FOUND', 'Centre de coût inconnu pour ce user.', { field: 'costCenterRef', ref });
    if (center.direction !== direction) fail('INCOMPATIBLE_REFERENCE', `Ce centre de coût concerne les ${center.direction === 'income' ? 'revenus' : 'charges'}.`, { field: 'costCenterRef' });
    return center.standard ? { standardCostCenter: center.key, costCenterId: null } : { standardCostCenter: null, costCenterId: center.id };
  }

  const costCenterLabel = (state, o) =>
    o.costCenterId
      ? state.costCenters[o.costCenterId]?.label ?? null
      : parameters.value(state, 'budget.centresStandards').find((c) => c.key === o.standardCostCenter)?.label ?? `${o.standardCostCenter} (retiré)`;

  const categoryLabel = (state, o) => (o.categoryId ? state.chargeCategories?.[o.categoryId]?.label ?? null : null);

  function categoriesOf(state, userId, { archived = false } = {}) {
    return om
      .list(state, 'chargeCategory', (k) => k.userId === userId && (archived || !k.archived))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  }

  /** Libellé d'une catégorie active, unique dans son centre (sans tenir compte de la casse). */
  function uniqueCategoryLabel(state, userId, ref, label, exceptId = null) {
    const same = (k) => k.id !== exceptId && k.costCenterRef === ref && k.label.toLocaleLowerCase('fr') === label.toLocaleLowerCase('fr');
    if (categoriesOf(state, userId).some(same)) fail('UNIQUENESS_VIOLATION', `La catégorie « ${label} » existe déjà dans ce centre.`, { field: 'label' });
    return label;
  }

  function categoryView(state, k) {
    const center = costCentersOf(state, k.userId).find((c) => c.ref === k.costCenterRef);
    return { ...k, capCents: k.capCents ?? null, costCenterLabel: center?.label ?? `${k.costCenterRef} (retiré)` };
  }

  /**
   * Catégorie d'une dépense : facultative, du user, active, dans le centre de la dépense. Elle ne
   * concerne que les charges ; une catégorie choisie sans centre donne son centre à la dépense.
   */
  function categoryFor(state, userId, categoryId, { direction, costCenterRef }) {
    if (categoryId === undefined || categoryId === null || categoryId === '') return null;
    const k = om.owned(state, 'chargeCategory', categoryId, userId);
    if (k.archived) fail('FORBIDDEN_BY_RULE', `La catégorie « ${k.label} » est retirée : choisissez-en une autre.`, { field: 'categoryId' });
    if (direction !== 'charge') fail('INCOMPATIBLE_REFERENCE', 'Une catégorie de dépense ne concerne que les charges.', { field: 'categoryId' });
    if (costCenterRef && costCenterRef !== k.costCenterRef) fail('INCOMPATIBLE_REFERENCE', `La catégorie « ${k.label} » appartient à un autre centre de coût.`, { field: 'categoryId' });
    return k;
  }

  /**
   * Catégorie après modification d'une dépense : celle demandée, sinon l'actuelle tant qu'elle reste dans le
   * centre de la dépense ; un changement de centre ou de sens détache une catégorie devenue incohérente.
   */
  function categoryPatch(state, userId, current, input, next) {
    const ref = next.costCenterId ?? (next.standardCostCenter ? STD + next.standardCostCenter : null) ?? current.costCenterId ?? STD + current.standardCostCenter;
    // Catégorie inchangée : elle reste sur la dépense (même retirée) tant qu'elle reste cohérente avec son centre.
    const same = 'categoryId' in input && (input.categoryId || null) === (current.categoryId ?? null);
    if ('categoryId' in input && !same) return { categoryId: categoryFor(state, userId, input.categoryId, { direction: next.direction, costCenterRef: ref })?.id ?? null };
    const k = current.categoryId ? state.chargeCategories?.[current.categoryId] : null;
    return k && (next.direction !== 'charge' || k.costCenterRef !== ref) ? { categoryId: null } : {};
  }

  const operationView = (state, o) => ({
    ...o,
    amount: toEuros(o.amountCents),
    realizedAmount: toEuros(o.realizedAmountCents),
    directionLabel: DIRECTION_LABEL[o.direction],
    costCenterRef: o.costCenterId ?? STD + o.standardCostCenter,
    costCenterLabel: costCenterLabel(state, o),
    categoryId: o.categoryId ?? null,
    categoryLabel: categoryLabel(state, o),
    budgetName: state.budgets[o.budgetId]?.name ?? null,
  });

  function operationsOf(state, budgetId, { from, to } = {}) {
    return om
      .list(state, 'operation', (o) => o.budgetId === budgetId)
      .filter((o) => {
        const d = o.realizedDate ?? o.date;
        return (!from || d >= from) && (!to || d <= to);
      })
      .sort((a, b) => (b.realizedDate ?? b.date).localeCompare(a.realizedDate ?? a.date) || b.createdAt.localeCompare(a.createdAt))
      .map((o) => operationView(state, o));
  }

  function budgetView(state, b) {
    const ops = om.by(state, 'operation', 'budgetId', b.id);
    return {
      ...b,
      projectTitle: state.coreProjects[b.coreProjectId]?.title ?? null,
      parentBudgetName: b.parentBudgetId ? state.budgets[b.parentBudgetId]?.name ?? null : null,
      operationCount: ops.length,
      realizedCount: ops.filter((o) => o.status === 'realized').length,
      cancelledCount: ops.filter((o) => o.status === 'cancelled').length,
    };
  }

  /** Tâche éventuelle d'une opération : seulement une tâche du projet de la vie de ce Budget (branche). */
  function taskFor(state, userId, budget, taskId) {
    if (taskId === undefined || taskId === null || taskId === '') {
      // Un projet de la vie n'a de dépenses et de gains qu'au niveau de ses tâches (docs/COMPTABILITE-PROJET-DE-VIE.md).
      if (budget.role === 'standard') fail('VALIDATION', 'Une dépense ou un gain d’un projet de la vie se saisit sur l’une de ses tâches.', { field: 'taskId' });
      return null;
    }
    const t = om.owned(state, 'task', taskId, userId);
    if (budget.role !== 'standard' || t.projectId !== budget.coreProjectId) {
      fail('INCOMPATIBLE_REFERENCE', 'La tâche doit appartenir au projet de la vie de ce Budget.', { field: 'taskId' });
    }
    return t.id;
  }

  const note = (v) => text('note', v, { max: 1000 }) || null;

  const recurrenceView = (state, r) => ({
    ...r,
    amount: toEuros(r.amountCents),
    cadenceLabel: CADENCE_LABEL[r.cadence],
    directionLabel: DIRECTION_LABEL[r.direction],
    costCenterRef: r.costCenterId ?? STD + r.standardCostCenter,
    costCenterLabel: costCenterLabel(state, r),
    categoryId: r.categoryId ?? null,
    categoryLabel: categoryLabel(state, r),
    budgetName: state.budgets[r.budgetId]?.name ?? null,
    settlementIds: om.by(state, 'operation', 'recurrenceId', r.id).map((o) => o.id),
  });

  /** Ligne de `budgetLines` enrichie pour l'affichage (centre, Budget, cadence). */
  const lineView = (state, l) => {
    const rec = l.recurrenceId ? state.recurrences[l.recurrenceId] : null;
    return {
      ...l,
      costCenterRef: l.costCenterId ?? STD + l.standardCostCenter,
      costCenterLabel: costCenterLabel(state, l),
      categoryLabel: categoryLabel(state, l),
      budgetName: state.budgets[l.budgetId]?.name ?? null,
      budgetRole: state.budgets[l.budgetId]?.role ?? null,
      cadence: rec?.cadence ?? 'once',
      cadenceLabel: CADENCE_LABEL[rec?.cadence ?? 'once'],
      firstDate: rec?.firstDate ?? null,
      endDate: rec?.endDate ?? null,
      taskTitle: l.taskId ? state.tasks[l.taskId]?.title ?? null : null,
      differenceCents: l.settled ? l.realizedCents - l.plannedCents : null,
    };
  };

  return {
    lifeBudgetOf, costCentersOf, costCenterFields, costCenterLabel, categoryLabel, categoriesOf, uniqueCategoryLabel, categoryView,
    categoryFor, categoryPatch, operationView, operationsOf, budgetView, taskFor, note, recurrenceView, lineView,
  };
}
