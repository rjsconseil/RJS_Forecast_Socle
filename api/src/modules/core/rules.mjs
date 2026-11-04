// Noyau transverse : règles pures des tâches et des projets (états, complétude, temps).
// Aucune donnée financière ici : ni montant, ni type de Budget.

export const TASK_STATUSES = ['todo', 'blocked', 'doing', 'done'];

export const COLUMNS = [
  { id: 'todo', label: 'À faire' },
  { id: 'blocked', label: 'À prioriser' },
  { id: 'doing', label: 'En cours' },
  { id: 'done', label: 'Terminée' },
];

export const TASK_STATUS_LABEL = { todo: 'À faire', blocked: 'À prioriser', doing: 'En cours', done: 'Terminée' };

export const PROJECT_STATUS = {
  planned: { label: 'À faire', column: 'todo' },
  active: { label: 'En cours', column: 'doing' },
  done: { label: 'Terminée', column: 'done' },
  paused: { label: 'À prioriser', column: 'blocked' },
  onHold: { label: 'En pause', column: 'todo' },
  toResume: { label: 'À reprendre', column: 'blocked' },
  toFinish: { label: 'À finir', column: 'doing' },
};

export const PRIORITIES = ['low', 'medium', 'high'];

/**
 * État dérivé d'un projet depuis toutes ses tâches (contrat J1 §12, ordre exact).
 * @param {string[]} statuses états de toutes les tâches rattachées, sans filtre de lecture
 */
export function deriveProjectStatus(statuses) {
  const n = statuses.length;
  const has = (s) => statuses.includes(s);
  let status;
  if (has('doing')) status = 'active';
  else if (n > 0 && statuses.every((s) => s === 'done')) status = 'done';
  else if (n > 0 && statuses.every((s) => s === 'todo')) status = 'planned';
  else if (has('blocked')) status = 'paused';
  else status = 'planned';

  if (n > 1 && has('done')) {
    if (status === 'planned') status = 'onHold';
    else if (status === 'paused') status = 'toResume';
    else if (status === 'active') status = 'toFinish';
  }
  return status;
}

export function completionPercent(statuses) {
  if (statuses.length === 0) return 0;
  const done = statuses.filter((s) => s === 'done').length;
  return Math.round((done / statuses.length) * 100);
}

// Les heures sont manipulées en centièmes entiers pour des sommes exactes,
// puis restituées en heures décimales (précision 0,01 h).
const toCents = (h) => Math.round(h * 100);
const fromCents = (c) => c / 100;

export function timeAggregates(tasks) {
  let plannedCents = 0;
  let spentCents = 0;
  let estimated = 0;
  for (const t of tasks) {
    if (t.plannedHours !== null && t.plannedHours !== undefined) {
      plannedCents += toCents(t.plannedHours);
      estimated += 1;
    }
    spentCents += toCents(t.spentHours ?? 0);
  }
  const total = tasks.length;
  return {
    taskCount: total,
    estimatedTaskCount: estimated,
    missingEstimateCount: total - estimated,
    plannedHoursKnown: fromCents(plannedCents),
    plannedIsPartial: total - estimated > 0,
    spentHoursTotal: fromCents(spentCents),
    // Rapport d'usage du temps prévu : information, jamais source d'un état.
    spentToPlannedPercent:
      total > 0 && estimated === total && plannedCents > 0 ? Math.round((spentCents / plannedCents) * 100) : null,
  };
}

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

export function explainProjectStatus(statuses, status) {
  if (statuses.length === 0) return `Aucune tâche : ${PROJECT_STATUS[status].label}`;
  const count = (s) => statuses.filter((x) => x === s).length;
  const parts = [
    [count('done'), 'tâche terminée', 'tâches terminées'],
    [count('doing'), 'tâche en cours', 'tâches en cours'],
    [count('blocked'), 'tâche à prioriser', 'tâches à prioriser'],
    [count('todo'), 'tâche à faire', 'tâches à faire'],
  ]
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => plural(n, one, many));
  return `${parts.join(', ')} : ${PROJECT_STATUS[status].label}`;
}

/** Projection complète d'un projet depuis ses tâches réelles. */
export function projectView(project, tasks) {
  const statuses = tasks.map((t) => t.status);
  const status = deriveProjectStatus(statuses);
  const countsByStatus = Object.fromEntries(TASK_STATUSES.map((s) => [s, statuses.filter((x) => x === s).length]));
  return {
    projectId: project.id,
    status,
    statusLabel: PROJECT_STATUS[status].label,
    column: PROJECT_STATUS[status].column,
    columnLabel: COLUMNS.find((c) => c.id === PROJECT_STATUS[status].column).label,
    explanation: explainProjectStatus(statuses, status),
    taskIds: tasks.map((t) => t.id),
    countsByStatus,
    doneCount: countsByStatus.done,
    completionPercent: completionPercent(statuses),
    time: timeAggregates(tasks),
  };
}
