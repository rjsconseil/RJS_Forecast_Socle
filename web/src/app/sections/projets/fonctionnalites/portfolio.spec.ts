import { describe, expect, it } from 'vitest';
import type { ProjectSummary, TaskStatus, TaskView } from '../../../platform/grand-noyau';
import { board, portfolio, timeline, totals } from './portfolio';

const TODAY = '2026-11-27';
let n = 0;
const meta = (id: string) => ({ id, kind: 'x', provenance: { command: 'x', requestKey: null, at: '2026-11-01T00:00:00Z' }, userId: 'usr_1', revision: 1, createdAt: `2026-11-01T00:00:0${n++ % 10}Z`, updatedAt: '2026-11-01T00:00:00Z' });

function project(id: string, o: Partial<{ title: string; priority: 'low' | 'medium' | 'high'; start: string | null; due: string | null; statuses: TaskStatus[]; life: boolean; funded: boolean; planned: number; spent: number }> = {}): ProjectSummary {
  const statuses = o.statuses ?? [];
  const done = statuses.filter((s) => s === 'done').length;
  const counts = { todo: 0, doing: 0, blocked: 0, done: 0 } as Record<TaskStatus, number>;
  for (const s of statuses) counts[s]++;
  const status = statuses.length && done === statuses.length ? 'done' : counts.doing ? 'active' : 'planned';
  return {
    project: { ...meta(id), title: o.title ?? id, description: '', priority: o.priority ?? 'medium', startDate: o.start ?? null, dueDate: o.due ?? null },
    view: {
      projectId: id, status, statusLabel: status, column: 'todo', columnLabel: '', explanation: '', taskIds: [], countsByStatus: counts, doneCount: done,
      completionPercent: statuses.length ? Math.round(done / statuses.length * 100) : 0,
      time: { taskCount: statuses.length, estimatedTaskCount: 0, missingEstimateCount: 0, plannedHoursKnown: o.planned ?? 0, plannedIsPartial: false, spentHoursTotal: o.spent ?? 0, spentToPlannedPercent: o.planned ? Math.round((o.spent ?? 0) / o.planned * 100) : null },
    },
    enrichment: o.life ? ({ kind: 'life' } as ProjectSummary['enrichment']) : o.funded ? ({ kind: 'standard' } as ProjectSummary['enrichment']) : null,
    pathways: { canAddTask: true, isTaskDestination: true, tasksCanChangeProject: true, note: null },
  } as ProjectSummary;
}

const task = (id: string, projectId: string | null, status: TaskStatus, due: string | null = null, start: string | null = null, planned: number | null = null): TaskView => ({
  task: { ...meta(id), title: id, description: '', projectId, status, plannedHours: planned, spentHours: 0, startDate: start, dueDate: due },
  projectTitle: projectId, qualification: { code: 'x', label: 'x', budgetIdDerived: null }, pathways: { canChangeProject: true },
});

describe('Mes projets · portefeuille (propre à la section)', () => {
  const projects = [
    project('vie', { life: true, statuses: ['todo'] }),
    project('site', { title: 'Site', due: '2026-11-20', statuses: ['doing', 'todo'] }),
    project('salon', { title: 'Salon', priority: 'high', start: '2026-11-01', due: '2026-12-30', statuses: ['done', 'todo', 'todo', 'todo'] }),
    project('audit', { title: 'Audit', statuses: ['todo', 'blocked'], funded: true }),
    project('fini', { title: 'Fini', statuses: ['done'] }),
    project('neuf', { title: 'Neuf', statuses: ['todo'], planned: 4, spent: 6 }),
  ];
  const tasks = [
    task('t1', 'site', 'doing', '2026-11-25', '2026-11-10', 3),
    task('t2', 'site', 'todo', '2026-12-02', null, 2),
    task('t3', 'salon', 'todo', '2026-11-20'),
    task('t4', 'audit', 'blocked'),
    task('t5', null, 'todo', '2026-11-30'),
    task('t6', 'vie', 'todo', '2026-11-01'),
  ];
  const rows = portfolio(projects, tasks, TODAY);

  it('écarte le projet de vie (racine du budget) et classe du plus urgent au plus calme', () => {
    expect(rows.map((r) => r.id)).toEqual(['salon', 'site', 'audit', 'neuf', 'fini']);
    expect(rows.map((r) => r.health)).toEqual(['late', 'late', 'watch', 'watch', 'done']);
  });

  it('explique chaque santé et dit seulement qu’un projet est financé', () => {
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by['site'].reason).toBe('Échéance du projet dépassée de 7 j.');
    expect(by['salon'].reason).toBe('Une tâche a dépassé son échéance.');
    expect(by['audit'].reason).toBe('Une tâche est à prioriser.');
    expect(by['neuf'].reason).toBe('Temps passé : 150 % du temps prévu.');
    expect(by['audit'].funded).toBe(true);
    expect(by['site'].funded).toBe(false);
    expect(by['site'].daysLeft).toBe(-7);
  });

  it('totalise sans le projet de vie : retards, tâches ouvertes, échéances de la semaine', () => {
    const t = totals(rows, tasks, TODAY);
    expect([t.projectCount, t.activeCount, t.doneCount, t.lateCount, t.watchCount]).toEqual([5, 4, 1, 2, 2]);
    expect(t.openTaskCount).toBe(5); // t1, t2, t3, t4, t5 (t6 appartient au projet de vie)
    expect(t.lateTaskCount).toBe(2); // t1, t3
    expect(t.dueThisWeek).toBe(2); // t2 (2 déc.), t5 (30 nov.)
  });

  it('tableau : une colonne par état, les retards d’abord, filtres par projet, recherche et retard', () => {
    const ids = new Set(rows.map((r) => r.id));
    const cols = board(tasks, ids, {}, TODAY);
    expect(cols.map((c) => c.id)).toEqual(['todo', 'doing', 'blocked', 'done']);
    expect(cols[0].cards.map((c) => c.view.task.id)).toEqual(['t3', 't5', 't2']);
    expect(cols[1].hours).toBe(3);
    expect(board(tasks, ids, { projectId: 'site' }, TODAY).flatMap((c) => c.cards.map((x) => x.view.task.id))).toEqual(['t2', 't1']);
    expect(board(tasks, ids, { projectId: 'none' }, TODAY).flatMap((c) => c.cards.map((x) => x.view.task.id))).toEqual(['t5']);
    expect(board(tasks, ids, { onlyLate: true }, TODAY).flatMap((c) => c.cards.map((x) => x.view.task.id))).toEqual(['t3', 't1']);
    expect(board(tasks, ids, { query: 'T4' }, TODAY).flatMap((c) => c.cards.map((x) => x.view.task.id))).toEqual(['t4']);
  });

  it('planning : fenêtre au mois, projets datés par eux-mêmes ou par leurs tâches, sans date à part', () => {
    const p = timeline(rows, tasks, TODAY);
    expect(p.from).toBe('2026-11-01');
    expect(p.to).toBe('2027-01-01');
    expect(p.months.map((m) => m.key)).toEqual(['2026-11', '2026-12']);
    expect(p.rows.map((r) => r.project.id)).toEqual(['salon', 'site']);
    const site = p.rows[1];
    expect([site.project.start, site.project.end]).toEqual(['2026-11-10', '2026-11-20']);
    expect(site.tasks.map((t) => [t.id, t.start, t.end, t.point, t.late])).toEqual([['t1', '2026-11-10', '2026-11-25', false, true], ['t2', '2026-12-02', '2026-12-02', true, false]]);
    expect(p.undated.map((u) => u.id)).toEqual(['audit', 'neuf', 'fini']);
    expect(p.todayLeft).toBeGreaterThan(40);
    expect(p.todayLeft).toBeLessThan(45);
  });
});
