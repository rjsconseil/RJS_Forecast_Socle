/**
 * Mes projets · fonctionnalités propres à la section — calculs purs du pilotage, sans toucher au socle : tout vient des lectures existantes du noyau
 * (`ProjectSummary`, `TaskView`). Aucun chiffre financier n'est recalculé ici ; un projet financé le dit seulement.
 */
import type { Priority, ProjectSummary, TaskStatus, TaskView } from '../../../platform/grand-noyau';

export type Health = 'done' | 'late' | 'watch' | 'ok' | 'idle';

export const HEALTH_LABEL: Record<Health, string> = {
  done: 'Terminé', late: 'En retard', watch: 'À surveiller', ok: 'Dans les temps', idle: 'Pas commencé',
};

export const PRIORITY_LABEL: Record<Priority, string> = { high: 'Haute', medium: 'Moyenne', low: 'Basse' };
const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export const BOARD_COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: 'À faire' },
  { id: 'doing', label: 'En cours' },
  { id: 'blocked', label: 'À prioriser' },
  { id: 'done', label: 'Terminée' },
];

export interface PortfolioRow {
  id: string;
  title: string;
  priority: Priority;
  priorityLabel: string;
  statusLabel: string;
  completion: number;
  startDate: string | null;
  dueDate: string | null;
  /** Jours avant l'échéance (négatif : dépassée) ; null sans échéance. */
  daysLeft: number | null;
  taskCount: number;
  openTaskCount: number;
  lateTaskCount: number;
  blockedTaskCount: number;
  plannedHours: number;
  spentHours: number;
  /** Heures passées / prévues, en % ; null si aucune estimation. */
  timeUse: number | null;
  /** Projet rattaché à un budget (financé) : information, le financement se gère dans sa fiche. */
  funded: boolean;
  health: Health;
  healthLabel: string;
  /** Pourquoi cette santé, en une phrase. */
  reason: string;
}

export interface PortfolioTotals {
  projectCount: number;
  activeCount: number;
  lateCount: number;
  watchCount: number;
  doneCount: number;
  openTaskCount: number;
  lateTaskCount: number;
  dueThisWeek: number;
  plannedHours: number;
  spentHours: number;
  /** Avancement moyen des projets non terminés (%), null s'il n'y en a pas. */
  averageCompletion: number | null;
  fundedCount: number;
}

const DAY = 86400000;
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);
export const localToday = () => new Date().toLocaleDateString('sv-SE');

/**
 * Le projet principal (« Projet de vie », racine du budget de vie et du patrimoine) n'est pas un projet à mener :
 * le portefeuille ne montre que les projets.
 */
export const isWorkProject = (p: ProjectSummary) => p.enrichment?.kind !== 'life';

const isLateTask = (t: TaskView, today: string) => t.task.status !== 'done' && !!t.task.dueDate && t.task.dueDate < today;

function healthOf(p: ProjectSummary, tasks: TaskView[], today: string): { health: Health; reason: string } {
  const v = p.view;
  if (v.status === 'done') return { health: 'done', reason: 'Toutes les tâches sont terminées.' };
  const due = p.project.dueDate;
  const late = tasks.filter((t) => isLateTask(t, today)).length;
  if (due && due < today) return { health: 'late', reason: `Échéance du projet dépassée de ${daysBetween(due, today)} j.` };
  if (late) return { health: 'late', reason: late === 1 ? 'Une tâche a dépassé son échéance.' : `${late} tâches ont dépassé leur échéance.` };
  const blocked = v.countsByStatus.blocked ?? 0;
  const timeUse = v.time.spentToPlannedPercent;
  if (due && v.completionPercent < 100) {
    const total = p.project.startDate ? daysBetween(p.project.startDate, due) : null;
    const elapsed = p.project.startDate ? daysBetween(p.project.startDate, today) : null;
    if (total && total > 0 && elapsed !== null && elapsed >= 0 && elapsed / total * 100 - v.completionPercent > 25) {
      return { health: 'watch', reason: `${Math.round(elapsed / total * 100)} % du temps écoulé pour ${v.completionPercent} % d'avancement.` };
    }
    if (daysBetween(today, due) <= 7) return { health: 'watch', reason: `Échéance dans ${daysBetween(today, due)} j.` };
  }
  if (blocked) return { health: 'watch', reason: blocked === 1 ? 'Une tâche est à prioriser.' : `${blocked} tâches sont à prioriser.` };
  if (timeUse !== null && timeUse > 100) return { health: 'watch', reason: `Temps passé : ${timeUse} % du temps prévu.` };
  if (v.status === 'planned' && v.doneCount === 0 && !(v.countsByStatus.doing ?? 0)) return { health: 'idle', reason: 'Aucune tâche commencée.' };
  return { health: 'ok', reason: 'Rien en retard.' };
}

/** Les lignes du portefeuille, des plus urgentes aux plus calmes. */
export function portfolio(projects: ProjectSummary[], tasks: TaskView[], today: string): PortfolioRow[] {
  const byProject = new Map<string, TaskView[]>();
  for (const t of tasks) if (t.task.projectId) byProject.set(t.task.projectId, [...(byProject.get(t.task.projectId) ?? []), t]);
  const order: Record<Health, number> = { late: 0, watch: 1, ok: 2, idle: 3, done: 4 };
  return projects.filter(isWorkProject).map((p): PortfolioRow => {
    const own = byProject.get(p.project.id) ?? [];
    const { health, reason } = healthOf(p, own, today);
    const v = p.view;
    return {
      id: p.project.id, title: p.project.title, priority: p.project.priority, priorityLabel: PRIORITY_LABEL[p.project.priority],
      statusLabel: v.statusLabel, completion: v.completionPercent, startDate: p.project.startDate, dueDate: p.project.dueDate,
      daysLeft: p.project.dueDate ? daysBetween(today, p.project.dueDate) : null,
      taskCount: v.time.taskCount, openTaskCount: v.time.taskCount - v.doneCount,
      lateTaskCount: own.filter((t) => isLateTask(t, today)).length, blockedTaskCount: v.countsByStatus.blocked ?? 0,
      plannedHours: v.time.plannedHoursKnown, spentHours: v.time.spentHoursTotal, timeUse: v.time.spentToPlannedPercent,
      funded: !!p.enrichment, health, healthLabel: HEALTH_LABEL[health], reason,
    };
  }).sort((a, b) => order[a.health] - order[b.health] || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.title.localeCompare(b.title));
}

export function totals(rows: PortfolioRow[], tasks: TaskView[], today: string): PortfolioTotals {
  const open = rows.filter((r) => r.health !== 'done');
  const projectIds = new Set(rows.map((r) => r.id));
  const mine = tasks.filter((t) => !t.task.projectId || projectIds.has(t.task.projectId));
  const weekEnd = new Date(Date.parse(today) + 7 * DAY).toISOString().slice(0, 10);
  return {
    projectCount: rows.length,
    activeCount: open.length,
    lateCount: rows.filter((r) => r.health === 'late').length,
    watchCount: rows.filter((r) => r.health === 'watch').length,
    doneCount: rows.length - open.length,
    openTaskCount: mine.filter((t) => t.task.status !== 'done').length,
    lateTaskCount: mine.filter((t) => isLateTask(t, today)).length,
    dueThisWeek: mine.filter((t) => t.task.status !== 'done' && !!t.task.dueDate && t.task.dueDate >= today && t.task.dueDate <= weekEnd).length,
    plannedHours: Math.round(rows.reduce((s, r) => s + r.plannedHours, 0) * 100) / 100,
    spentHours: Math.round(rows.reduce((s, r) => s + r.spentHours, 0) * 100) / 100,
    averageCompletion: open.length ? Math.round(open.reduce((s, r) => s + r.completion, 0) / open.length) : null,
    fundedCount: rows.filter((r) => r.funded).length,
  };
}

export interface BoardFilter {
  projectId?: string | null;
  query?: string;
  onlyLate?: boolean;
}

/** Le tableau des tâches : une colonne par état, les tâches en retard puis par échéance. */
export function board(tasks: TaskView[], projectIds: Set<string>, filter: BoardFilter, today: string) {
  const q = (filter.query ?? '').trim().toLowerCase();
  const kept = tasks.filter((t) => (!t.task.projectId || projectIds.has(t.task.projectId))
    && (!filter.projectId || (filter.projectId === 'none' ? !t.task.projectId : t.task.projectId === filter.projectId))
    && (!q || t.task.title.toLowerCase().includes(q) || (t.projectTitle ?? '').toLowerCase().includes(q))
    && (!filter.onlyLate || isLateTask(t, today)));
  const sort = (a: TaskView, b: TaskView) => Number(isLateTask(b, today)) - Number(isLateTask(a, today))
    || (a.task.dueDate ?? '9999').localeCompare(b.task.dueDate ?? '9999') || a.task.title.localeCompare(b.task.title);
  return BOARD_COLUMNS.map((c) => {
    const cards = kept.filter((t) => t.task.status === c.id).sort(sort);
    return { ...c, cards: cards.map((t) => ({ view: t, late: isLateTask(t, today) })), hours: Math.round(cards.reduce((s, t) => s + (t.task.plannedHours ?? 0), 0) * 100) / 100 };
  });
}

export interface TimelineBar {
  id: string;
  label: string;
  kind: 'project' | 'task';
  projectId: string | null;
  /** Position et largeur en % de la fenêtre. */
  left: number;
  width: number;
  start: string;
  end: string;
  /** Une seule date connue : un repère plutôt qu'une barre. */
  point: boolean;
  completion: number | null;
  late: boolean;
  health?: Health;
}

export interface Timeline {
  from: string;
  to: string;
  months: { key: string; label: string; left: number; width: number }[];
  todayLeft: number | null;
  rows: { project: TimelineBar; tasks: TimelineBar[] }[];
  /** Projets sans aucune date, hors planning. */
  undated: { id: string; title: string }[];
}

const monthLabel = (ymd: string) => new Date(ymd + 'T00:00:00').toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });

/**
 * Le planning : les projets et leurs tâches dans le temps, à partir de leurs dates de début et d'échéance.
 * Une tâche sans date suit son projet ; un projet sans date prend celles de ses tâches.
 */
export function timeline(rows: PortfolioRow[], tasks: TaskView[], today: string): Timeline {
  const dated = (s: string | null, e: string | null) => [s, e].filter((d): d is string => !!d);
  const items = rows.map((r) => {
    const own = tasks.filter((t) => t.task.projectId === r.id);
    const taskDates = own.flatMap((t) => dated(t.task.startDate, t.task.dueDate));
    const all = [...dated(r.startDate, r.dueDate), ...taskDates].sort();
    return { r, own, start: r.startDate ?? all[0] ?? null, end: r.dueDate ?? all.at(-1) ?? null };
  });
  const withDates = items.filter((i) => i.start && i.end);
  const undated = items.filter((i) => !i.start || !i.end).map((i) => ({ id: i.r.id, title: i.r.title }));
  const bounds = [today, ...withDates.flatMap((i) => [i.start as string, i.end as string])].sort();
  const first = bounds[0].slice(0, 7) + '-01';
  const lastMonth = new Date(Date.parse(bounds.at(-1)!.slice(0, 7) + '-01T00:00:00Z'));
  lastMonth.setUTCMonth(lastMonth.getUTCMonth() + 1);
  const to = lastMonth.toISOString().slice(0, 10);
  const span = Math.max(1, daysBetween(first, to));
  const pos = (d: string) => Math.min(100, Math.max(0, daysBetween(first, d) / span * 100));
  const bar = (id: string, label: string, kind: 'project' | 'task', projectId: string | null, s: string, e: string, completion: number | null, late: boolean, health?: Health): TimelineBar => {
    const [a, b] = s <= e ? [s, e] : [e, s];
    const left = pos(a);
    const end = pos(new Date(Date.parse(b) + DAY).toISOString().slice(0, 10));
    return { id, label, kind, projectId, left, width: Math.max(0.6, end - left), start: a, end: b, point: a === b, completion, late, health };
  };
  const months: Timeline['months'] = [];
  for (const d = new Date(first + 'T00:00:00Z'); d.toISOString().slice(0, 10) < to; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const next = new Date(d); next.setUTCMonth(next.getUTCMonth() + 1);
    months.push({ key: key.slice(0, 7), label: monthLabel(key), left: pos(key), width: pos(next.toISOString().slice(0, 10)) - pos(key) });
  }
  return {
    from: first, to, months, todayLeft: pos(today), undated,
    rows: withDates.map(({ r, own, start, end }) => ({
      project: bar(r.id, r.title, 'project', r.id, start as string, end as string, r.completion, r.health === 'late', r.health),
      tasks: own.filter((t) => t.task.startDate || t.task.dueDate).map((t) => bar(t.task.id, t.task.title, 'task', r.id,
        t.task.startDate ?? t.task.dueDate!, t.task.dueDate ?? t.task.startDate!, t.task.status === 'done' ? 100 : null, isLateTask(t, today))),
    })),
  };
}
