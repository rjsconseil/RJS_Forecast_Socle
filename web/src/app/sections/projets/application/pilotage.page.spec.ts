import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { Api, RecetteContext, type ProjectSummary, type TaskView } from '../../../platform/grand-noyau';
import { ProjetsPilotagePage } from './pilotage.page';

const at = '2026-11-01T00:00:00Z';
const meta = (id: string) => ({ id, kind: 'x', userId: 'usr_1', revision: 3, createdAt: at, updatedAt: at, provenance: { command: 'x', requestKey: null, at } });
const project = (id: string, title: string, statuses: ('todo' | 'doing' | 'done' | 'blocked')[], due: string | null): ProjectSummary => ({
  project: { ...meta(id), title, description: '', priority: 'medium', startDate: '2026-11-01', dueDate: due },
  view: {
    projectId: id, status: 'active', statusLabel: 'En cours', column: 'doing', columnLabel: '', explanation: '', taskIds: [],
    countsByStatus: { todo: statuses.filter((s) => s === 'todo').length, doing: statuses.filter((s) => s === 'doing').length, blocked: 0, done: statuses.filter((s) => s === 'done').length },
    doneCount: statuses.filter((s) => s === 'done').length, completionPercent: 50,
    time: { taskCount: statuses.length, estimatedTaskCount: 1, missingEstimateCount: 1, plannedHoursKnown: 4, plannedIsPartial: true, spentHoursTotal: 1, spentToPlannedPercent: 25 },
  },
  enrichment: null, pathways: { canAddTask: true, isTaskDestination: true, tasksCanChangeProject: true, note: null },
});
const task = (id: string, projectId: string, status: 'todo' | 'doing' | 'done', due: string | null): TaskView => ({
  task: { ...meta(id), title: 'Tâche ' + id, description: '', projectId, status, plannedHours: 2, spentHours: 0, startDate: null, dueDate: due },
  projectTitle: 'Lancement', qualification: { code: 'x', label: 'x', budgetIdDerived: null }, pathways: { canChangeProject: true },
});

async function settle(f: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  for (let i = 0; i < 3; i++) {
    f.detectChanges();
    await f.whenStable();
    await new Promise((r) => setTimeout(r, 0));
  }
  f.detectChanges();
}

async function render(projects: ProjectSummary[], tasks: TaskView[]) {
  const api = { projects: vi.fn(async () => projects), tasks: vi.fn(async () => tasks), changeTaskStatus: vi.fn(async () => ({})) };
  TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', children: [] }]), { provide: Api, useValue: api }] });
  TestBed.inject(RecetteContext).userId.set('usr_1');
  const f = TestBed.createComponent(ProjetsPilotagePage);
  await settle(f);
  return { f, api, el: f.nativeElement as HTMLElement };
}

describe('Mes projets · page Pilotage', () => {
  it('sans projet : l’accueil de la section invite à créer le premier, sans budget ni cycle', async () => {
    const { el } = await render([], []);
    expect(el.querySelector('h1')?.textContent).toContain('Pilotage des projets');
    expect(el.querySelector('.section-home-alone')?.textContent).toContain('Créer un projet');
  });

  it('portefeuille, tableau puis changement d’état par la commande du noyau', async () => {
    const { f, api, el } = await render([project('prj_1', 'Lancement', ['doing', 'todo'], '2099-01-01')], [task('tsk_1', 'prj_1', 'doing', null), task('tsk_2', 'prj_1', 'todo', '2000-01-01')]);
    expect(el.querySelector('.pilotage-table tbody th a')?.textContent).toBe('Lancement');
    expect(el.querySelector('.pilotage-table tbody th a')?.getAttribute('href')).toBe('/bpm-astra/projets/prj_1');
    expect(el.querySelector('.pilotage-health')?.textContent).toBe('En retard');
    expect([...el.querySelectorAll('.section-home-indicators b')].map((b) => b.textContent)).toContain('1');

    await TestBed.inject(Router).navigateByUrl('/?vue=tableau');
    await settle(f);
    const cols = [...el.querySelectorAll('.pilotage-column')];
    expect(cols.map((c) => c.querySelectorAll('.pilotage-card').length)).toEqual([1, 1, 0, 0]);
    expect(cols[0].querySelector('.pilotage-card')?.classList.contains('late')).toBe(true);
    (cols[0].querySelector('.pilotage-moves button') as HTMLButtonElement).click();
    await f.whenStable();
    expect(api.changeTaskStatus).toHaveBeenCalledWith('tsk_2', 'doing', 3);

    await TestBed.inject(Router).navigateByUrl('/?vue=planning');
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(el.querySelectorAll('.pilotage-plan-row.project').length).toBe(1);
    expect(el.querySelectorAll('.pilotage-plan-row.task').length).toBe(1);
  });
});
