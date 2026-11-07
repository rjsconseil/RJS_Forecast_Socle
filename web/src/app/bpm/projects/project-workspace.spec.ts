import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';
import { Api } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { ProjectFunding } from '../ui/project-funding';
import { BpmProjectWorkspacePage } from './project-workspace.page';

function setup(key: string, query: Record<string, string> = {}) {
  const params = new BehaviorSubject(convertToParamMap(query));
  const data = { key, parent: key.startsWith('task-') ? '/app/taches' : '/app/gestion-projet', title: 'Étape spécialisée', lead: 'Une seule étape à traiter.' };
  const project = (id: string, regime: boolean) => ({
    project: { id, title: id === 'p1' ? 'Cuisine' : 'Voyage', description: '', priority: 'medium', revision: 3 },
    role: 'standard', view: { column: 'todo', statusLabel: 'À faire', doneCount: 0, time: { taskCount: 0, spentHoursTotal: 0, plannedHoursKnown: 0, spentToPlannedPercent: null } },
    budget: { budgetId: `b-${id}`, revision: 7, regime, allocationCents: regime ? 10000 : null, state: regime ? 'ok' : 'unallocated' },
  });
  const state = {
    context: { calculationDate: '2026-11-07' },
    projects: [project('p1', false), project('p2', true)],
    life: { taskRequests: [], pendingRequests: [], fundedCount: 1, allocatedCents: 10000 },
    candidates: [],
  };
  const tasks = { projects: [], tasks: [], attachable: [{ task: { id: 't1', title: 'Comparer les devis', description: '', projectId: null, status: 'todo', revision: 4, plannedHours: null }, pathways: { canChangeProject: true } }] };
  const api = { attachTask: vi.fn(async () => { tasks.attachable = []; return {}; }) };
  const bpm = {
    projectsOverview: vi.fn(async () => structuredClone(state)),
    tasksOverview: vi.fn(async () => structuredClone(tasks)),
    allocate: vi.fn(async () => { state.projects[0].budget.regime = true; return {}; }),
  };
  const funding = { decideTaskRequest: vi.fn(async () => ({ message: 'Part accordée.' })) };
  TestBed.configureTestingModule({ providers: [
    provideRouter([]), { provide: Api, useValue: api }, { provide: BpmApi, useValue: bpm },
    { provide: ProjectFunding, useValue: funding },
    { provide: ActivatedRoute, useValue: { data: of({ workspace: data }), queryParamMap: params, queryParams: of(query), paramMap: of(convertToParamMap({})), fragment: of(null), snapshot: { data: { workspace: data }, queryParams: query, queryParamMap: convertToParamMap(query) } } },
  ] });
  const fixture = TestBed.createComponent(BpmProjectWorkspacePage);
  const page = fixture.componentInstance as any;
  page.data.set(structuredClone(state));
  page.tasks.set(structuredClone(tasks));
  return { fixture, page, api, bpm, funding, params, state };
}

describe('étapes spécialisées des projets BPM', () => {
  it('affiche le même éditeur de projet dans la page sans ouvrir de fenêtre', () => {
    const { fixture } = setup('project-create');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('bpm-project-editor .bpm-management-form')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('dialog')).toBeNull();
    expect(fixture.nativeElement.querySelector('.bpm-management-grid')).toBeNull();
  });

  it('attribue une enveloppe avec la révision du projet sans reprendre un filtre invisible de la vue générale', async () => {
    const { fixture, page, bpm } = setup('project-funding', { filter: 'done', period: '2026-10' });
    fixture.detectChanges();
    expect(page.fundingProjects().map((p: any) => p.project.id)).toEqual(['p1']);
    expect(fixture.nativeElement.querySelectorAll('.workspace-funding-card')).toHaveLength(1);
    await page.allocate(page.data().projects[0], '125,50');
    expect(bpm.allocate).toHaveBeenCalledExactlyOnceWith('b-p1', 125.5, 7);
    expect(page.fundingProjects()).toEqual([]);
    expect(page.notice().text).toContain('enregistré');
  });

  it('rattache une tâche une seule fois et refuse un destinataire périmé', async () => {
    const { fixture, page, api, params } = setup('task-attach', { project: 'absent', period: '2026-10' });
    await page.assignTask('t1');
    expect(api.attachTask).not.toHaveBeenCalled();
    params.next(convertToParamMap({ project: 'p1', period: '2026-10' }));
    fixture.detectChanges();
    await page.assignTask('t1');
    expect(api.attachTask).toHaveBeenCalledExactlyOnceWith('t1', 'p1', 4);
    expect(page.assignmentTasks()).toEqual([]);
    await page.assignTask('t1');
    expect(api.attachTask).toHaveBeenCalledTimes(1);
  });

  it('réemploie le financement commun pour décider une demande et sa révision', async () => {
    const { page, funding } = setup('project-decisions');
    const request = { id: 'r1', revision: 5, budgetId: 'b-p1', coreProjectId: 'p1', taskTitle: 'Devis', amountCents: 5000 };
    await page.decideRequest({ request, decision: 'approve' });
    expect(funding.decideTaskRequest).toHaveBeenCalledExactlyOnceWith(request, 'approve', 7);
    expect(page.notice().text).toBe('Part accordée.');
  });
});
