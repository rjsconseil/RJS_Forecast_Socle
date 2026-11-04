// Parcours métier BPM appliqués aux objets du noyau.
// Ces règles guident le site et le catalogue des commandes métier ; elles ne deviennent
// jamais une interdiction globale du stockage (contrat J1 §8, P-IHM-01, A-PARC-01).

/** Contexte d'enrichissement d'un projet noyau, retrouvé par les références des Budgets. */
export function enrichmentOf(state, projectId) {
  if (!projectId) return null;
  const budgets = Object.values(state.budgets).filter((b) => b.coreProjectId === projectId);
  const life = budgets.find((b) => b.role === 'life');
  const standard = budgets.find((b) => b.role === 'standard');
  if (life) {
    const patrimoine = Object.values(state.patrimoines).find((p) => p.principalBudgetId === life.id) ?? null;
    const bpm = Object.values(state.bpmCompositions).find((a) => a.budgetId === life.id) ?? null;
    return {
      kind: 'life',
      label: 'Racine principale (projet de vie)',
      budgetId: life.id,
      budgetName: life.name,
      parentBudgetId: null,
      patrimoineId: patrimoine?.id ?? null,
      bpmCompositionId: bpm?.id ?? null,
    };
  }
  if (standard) {
    const parent = state.budgets[standard.parentBudgetId] ?? null;
    return {
      kind: 'standard',
      label: 'Racine de branche (projet de la vie)',
      budgetId: standard.id,
      budgetName: standard.name,
      parentBudgetId: standard.parentBudgetId,
      parentBudgetName: parent?.name ?? null,
    };
  }
  return null;
}

export function projectPathways(enrichment) {
  if (enrichment?.kind === 'life') {
    return {
      canAddTask: false,
      isTaskDestination: false,
      tasksCanChangeProject: false,
      note: "Racine principale consultable : le travail passe par une branche (projet de la vie). Aucune création métier directe de tâche.",
    };
  }
  if (enrichment?.kind === 'standard') {
    return {
      canAddTask: true,
      isTaskDestination: true,
      tasksCanChangeProject: false,
      note: "Branche budgétisée : le changement de rattachement de ses tâches attend la règle A-PARC-01.",
    };
  }
  return { canAddTask: true, isTaskDestination: true, tasksCanChangeProject: true, note: null };
}

export function taskQualification(state, task) {
  if (!task.projectId) return { code: 'standalone', label: 'Tâche autonome', budgetIdDerived: null };
  const e = enrichmentOf(state, task.projectId);
  if (e?.kind === 'standard') {
    return { code: 'budgetedProjectTask', label: "Tâche d'un projet budgétisé", budgetIdDerived: e.budgetId };
  }
  if (e?.kind === 'life') {
    return {
      code: 'principalRootTask',
      label: 'Reliée à la racine principale (hors parcours métier)',
      budgetIdDerived: e.budgetId,
    };
  }
  return { code: 'genericProjectTask', label: 'Tâche de projet générique', budgetIdDerived: null };
}

/** Catalogue des commandes métier exposées par les parcours. */
export const BUSINESS_COMMANDS = [
  { command: 'createInitialUserBundle', label: 'Créer la chaîne principale du user (Budget principal, Patrimoine, BPM)' },
  { command: 'createLifeSubprojectBundle', label: 'Créer un projet de la vie (branche) avec au moins une tâche' },
  { command: 'createTask', label: 'Ajouter une tâche à une branche ou à un projet générique', excludes: 'racine principale' },
];
