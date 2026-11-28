import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { Api, RecetteContext, type ProjectSummary, type TaskView } from '../../../platform/grand-noyau';
import { ProjetsGestionProjetPage } from './gestion-projet.page';

const at = '2026-11-01T00:00:00Z';
const meta = (id: string) => ({ id, kind: 'x', userId: 'usr_1', revision: 3, createdAt: at, updatedAt: at, provenance: { command: 'x', requestKey: null, at } });
const project = (id: string, title: string, status: 'planned' | 'active'): ProjectSummary => ({
  project: { ...meta(id), title, description: '', priority: 'medium', startDate: '2026-11-01', dueDate: '2099-01-01' },
  view: {
    projectId: id, status, statusLabel: status === 'active' ? 'En cours' : 'Prévu', column: 'doing', columnLabel: '', explanation: '', taskIds: ['tsk_1'],
    countsByStatus: { todo: 0, doing: 1, blocked: 0, done: 0 }, doneCount: 0, completionPercent: 0,
    time: { taskCount: 1, estimatedTaskCount: 1, missingEstimateCount: 0, plannedHoursKnown: 2, plannedIsPartial: false, spentHoursTotal: 0, spentToPlannedPercent: 0 },
  },
  enrichment: null, pathways: { canAddTask: true, isTaskDestination: true, tasksCanChangeProject: true, note: null },
});
const task = (id: string, projectId: string | null, status: 'todo' | 'doing'): TaskView => ({
  task: { ...meta(id), title: 'Tâche ' + id, description: '', projectId, status, plannedHours: 2, spentHours: 0, startDate: null, dueDate: null },
  projectTitle: projectId ? 'Lancement' : null, qualification: { code: 'x', label: 'x', budgetIdDerived: null }, pathways: { canChangeProject: true },
});

async function settle(f: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  for (let i = 0; i < 3; i++) {
    f.detectChanges();
    await f.whenStable();
    await new Promise((r) => setTimeout(r, 0));
  }
  f.detectChanges();
}

async function render(projects: ProjectSummary[], tasks: TaskView[], url = '/') {
  const api = {
    projects: vi.fn(async () => projects), tasks: vi.fn(async () => tasks),
    createProject: vi.fn(async () => ({})), createTask: vi.fn(async () => ({})),
    attachTask: vi.fn(async () => ({})), detachTask: vi.fn(async () => ({})), changeTaskStatus: vi.fn(async () => ({})),
    aaList: vi.fn(async (_app: string, collection: string) => ({ collection, items: [] })),
    aaCreate: vi.fn(async () => ({ replayed: false, item: {} })), aaInstancier: vi.fn(async () => ({ declencheur: 'creation-dossier', created: [] })),
  };
  TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', children: [] }]), { provide: Api, useValue: api }] });
  TestBed.inject(RecetteContext).userId.set('usr_1');
  await TestBed.inject(Router).navigateByUrl(url);
  const f = TestBed.createComponent(ProjetsGestionProjetPage);
  await settle(f);
  return { f, api, el: f.nativeElement as HTMLElement };
}

describe('Mes projets · application de gestion de projet (PRINCE2)', () => {
  it('accueil : le bandeau, les 8 onglets et la séquence des processus, sans aucune donnée de projet', async () => {
    const { el } = await render([project('prj_1', 'Lancement', 'active')], [task('tsk_1', 'prj_1', 'doing')]);
    expect(el.querySelector('h1')?.textContent).toBe('Project management');
    expect(el.querySelector('.mp-eyebrow')?.textContent).toContain('My Projects');
    expect(el.querySelectorAll('.mp-tabs a')).toHaveLength(8);
    expect(el.querySelector('.mp-tabs a.is-current')?.textContent).toContain('Overview');
    expect([...el.querySelectorAll('.mp-list li .mp-code')].map((c) => c.textContent)).toEqual(['DP', 'SU', 'IP', 'CS', 'MP', 'SB', 'CP']);
    expect(el.querySelector('.mp-body')?.textContent).not.toContain('Lancement');
    expect(el.querySelector('.mp-facts, .mp-table, .mp-board, .mp-attach')).toBeNull();
  });

  it('crée un projet et une tâche seule par les commandes du grand noyau', async () => {
    const { f, api, el } = await render([project('prj_1', 'Lancement', 'active')], []);
    (el.querySelector('.mp-hero-actions .mp-hero-btn') as HTMLButtonElement).click();
    await settle(f);
    const form = el.querySelector('form.mp-form') as HTMLFormElement;
    (form.querySelector('[name=title]') as HTMLInputElement).value = 'Refonte';
    form.dispatchEvent(new Event('submit'));
    await settle(f);
    expect(api.createProject).toHaveBeenCalledWith(expect.objectContaining({ title: 'Refonte', priority: 'medium', startDate: null }));
    expect(el.querySelector('.mp-alert.success')?.textContent).toContain('Refonte');

    (el.querySelectorAll('.mp-hero-actions .mp-hero-btn')[1] as HTMLButtonElement).click();
    await settle(f);
    const taskForm = el.querySelector('form.mp-form') as HTMLFormElement;
    expect([...taskForm.querySelectorAll('[name=projectId] option')].map((o) => o.textContent)).toContain('Lancement');
    taskForm.dispatchEvent(new Event('submit'));
    await settle(f);
    expect(el.querySelector('.mp-alert.danger')?.textContent).toBe('Enter a title.');
    (taskForm.querySelector('[name=title]') as HTMLInputElement).value = 'Exposé';
    taskForm.dispatchEvent(new Event('submit'));
    await settle(f);
    expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Exposé', projectId: null }));
  });

  it('un thème : où il s’applique, puis la liste simple de ses processus, rien d’autre', async () => {
    const { f, el } = await render([], [], '/?theme=risque');
    expect(el.querySelector('h1')?.textContent).toBe('Risk');
    expect(el.querySelector('.mp-question')?.textContent).toBe('What if?');
    expect(el.querySelector('.mp-intro')?.textContent).toContain('Identify, assess and control uncertainty');
    expect(el.querySelectorAll('.mp-ribbon li.on')).toHaveLength(5);
    expect([...el.querySelectorAll('.mp-list li strong')].map((h) => h.textContent)).toEqual(['Starting up a Project', 'Directing a Project', 'Initiating a Project', 'Controlling a Stage', 'Managing a Stage Boundary']);
    expect(el.querySelectorAll('.mp-section')).toHaveLength(2);
    expect(el.querySelector('.mp-tabs a.is-current')?.textContent).toContain('Risk');
    await TestBed.inject(Router).navigateByUrl('/?theme=progression');
    await settle(f);
    expect(el.querySelector('h1')?.textContent).toBe('Progress');
  });
});
