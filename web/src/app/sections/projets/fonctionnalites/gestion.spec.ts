import { describe, expect, it } from 'vitest';
import type { ProjectSummary, TaskView } from '../../../platform/grand-noyau';
import { commandeProjet, commandeTache, erreurSaisie, projetsParStatut, tachesDuProjet, tachesSansProjet } from './gestion';

const at = '2026-11-01T00:00:00Z';
const meta = (id: string, createdAt = at) => ({ id, kind: 'x', userId: 'usr_1', revision: 1, createdAt, updatedAt: createdAt, provenance: { command: 'x', requestKey: null, at } });
const project = (id: string, title: string, status: 'planned' | 'active' | 'done', life = false) => ({
  project: { ...meta(id), title, description: '', priority: 'medium', startDate: null, dueDate: null },
  view: { projectId: id, status, statusLabel: { planned: 'Prévu', active: 'En cours', done: 'Terminé' }[status], column: 'todo', columnLabel: '', explanation: '', taskIds: [], countsByStatus: { todo: 0, doing: 0, blocked: 0, done: 0 }, doneCount: 0, completionPercent: 0, time: {} },
  enrichment: life ? { kind: 'life' } : null, pathways: {},
}) as unknown as ProjectSummary;
const task = (id: string, projectId: string | null, createdAt = at) => ({
  task: { ...meta(id, createdAt), title: 'Tâche ' + id, description: '', projectId, status: 'todo', plannedHours: null, spentHours: 0, startDate: null, dueDate: null },
  projectTitle: null, qualification: { code: 'x', label: 'x', budgetIdDerived: null }, pathways: { canChangeProject: true },
}) as TaskView;

describe('Mes projets · gestion de base', () => {
  it('projets par état, dans l’ordre de lecture, sans le projet de vie', () => {
    const groups = projetsParStatut([project('p3', 'C', 'done'), project('p1', 'B', 'active'), project('p2', 'A', 'active'), project('pv', 'Vie', 'active', true), project('p4', 'D', 'planned')]);
    expect(groups.map((g) => [g.label, g.projets.map((p) => p.project.title)])).toEqual([['Prévu', ['D']], ['En cours', ['A', 'B']], ['Terminé', ['C']]]);
  });

  it('tâches sans projet (les plus récentes d’abord) et tâches d’un projet', () => {
    const tasks = [task('t1', null, '2026-11-01T00:00:00Z'), task('t2', 'p1'), task('t3', null, '2026-11-05T00:00:00Z')];
    expect(tachesSansProjet(tasks).map((t) => t.task.id)).toEqual(['t3', 't1']);
    expect(tachesDuProjet(tasks, 'p1').map((t) => t.task.id)).toEqual(['t2']);
  });

  it('prépare les commandes du grand noyau et refuse une saisie incomplète', () => {
    expect(erreurSaisie({ title: '  ' })).toBe('Donnez un titre.');
    expect(erreurSaisie({ title: 'X', startDate: '2026-12-01', dueDate: '2026-11-01' })).toContain('après le début');
    expect(erreurSaisie({ title: 'X', startDate: '2026-11-01', dueDate: '' })).toBeNull();
    expect(commandeProjet({ title: ' Site ', startDate: '', dueDate: '2026-12-31' }, 'k1')).toEqual({ requestKey: 'k1', title: 'Site', description: '', priority: 'medium', startDate: null, dueDate: '2026-12-31' });
    expect(commandeTache({ title: 'T', projectId: '', plannedHours: '2,5' }, 'k2')).toEqual({ requestKey: 'k2', title: 'T', projectId: null, plannedHours: 2.5, dueDate: null });
    expect(commandeTache({ title: 'T', projectId: 'p1', plannedHours: 'x' }, 'k3').plannedHours).toBeNull();
    expect(commandeTache({ title: 'T', projectId: 'p1' }).requestKey).toMatch(/^web-/);
  });
});
