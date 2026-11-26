import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';
import { Api } from '../../core/api.service';
import { BpmApi } from '../data/bpm-api.service';
import { ProjectFunding } from '../ui/project-funding';
import { BpmProjectEditor, BpmTaskEditor } from './project-editors';
import { BpmProjectsPage } from './projects.page';

function setup(query: Record<string, string> = {}) {
  const project = (id: string, title: string, role = 'standard') => ({
    project: { id, title, description: '', priority: 'medium', revision: 2 },
    role,
    view: { column: 'todo', status: 'todo', statusLabel: 'À faire', doneCount: 0, completionPercent: 0, time: { taskCount: 1 } },
    budget: role === 'life' ? null : { budgetId: `budget-${id}`, regime: false, state: 'unallocated', allocationCents: null },
  });
  const state = {
    context: { calculationDate: '2026-11-17' },
    lifeProject: project('life', 'Mon projet de vie', 'life'),
    projects: [project('p1', 'Rénover la cuisine')],
    candidates: [],
    life: { pendingRequests: [], taskRequests: [], billable: [], fundedCount: 0, allocatedCents: 0, paidCents: 0, remainingCents: 0, availableCents: 0 },
  };
  const params = new BehaviorSubject(convertToParamMap(query));
  const workspace = { key: 'life-projects', parent: '/projet-de-vie/projets', title: 'Projets par statut', lead: '' };
  const bpm = {
    projectsOverview: vi.fn(async () => structuredClone(state)),
    createProject: vi.fn(async (input: { title: string }) => {
      state.projects.push(project('p2', input.title));
      return { coreProjectId: 'p2' };
    }),
    createTask: vi.fn(async () => ({ taskId: 't1' })),
  };
  TestBed.configureTestingModule({ providers: [
    provideRouter([]),
    { provide: Api, useValue: {} },
    { provide: BpmApi, useValue: bpm },
    { provide: ProjectFunding, useValue: {} },
    { provide: ActivatedRoute, useValue: {
      data: of({ workspace }), queryParamMap: params, queryParams: of(query),
      paramMap: of(convertToParamMap({})), fragment: of(null),
      snapshot: { data: { workspace }, queryParamMap: convertToParamMap(query), queryParams: query },
    } },
  ] });
  const fixture = TestBed.createComponent(BpmProjectsPage);
  const page = fixture.componentInstance as any;
  page.data.set(structuredClone(state));
  page.loading.set(false);
  return { fixture, page, bpm, params };
}

describe('page canonique des projets de Mon projet de vie', () => {
  it('garde un seul tableau avec accès au financement et aux tâches globales', () => {
    const { fixture } = setup();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('section.board')).toHaveLength(1);
    expect(root.querySelector('bpm-life-daily')).toBeNull();
    const links = [...root.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(links).toContain('/projet-de-vie/financement');
    expect(links).toContain('/app/taches');
    expect(links).toContain('/app/gestion-projet/p1');
    expect(links).toContain('/app/gestion-projet/p1/taches');
  });

  it('conserve recherche, édition directe et création sur la page canonique', async () => {
    const { fixture, page, params, bpm } = setup({ editProject: 'p1', q: 'cuisine' });
    fixture.detectChanges();
    expect(page.visible().map((p: any) => p.project.id)).toEqual(['p1']);
    expect(fixture.nativeElement.querySelector('dialog[aria-label="Modifier le projet de la vie"]')).toBeTruthy();
    params.next(convertToParamMap({}));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('bpm-project-editor')).toBeNull();

    const create = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    create.find((button) => button.textContent?.includes('Créer un projet de la vie'))!.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('dialog[aria-label="Créer un projet de la vie"]')).toBeTruthy();
    const editor = fixture.debugElement.query(By.directive(BpmProjectEditor)).componentInstance as any;
    editor.title = 'Préparer le voyage';
    await editor.save();
    await fixture.whenStable();
    expect(bpm.createProject).toHaveBeenCalledWith(expect.objectContaining({ title: 'Préparer le voyage', amount: null }));
    expect(page.data().projects.map((p: any) => p.project.id)).toEqual(['p1', 'p2']);
    expect(page.projectEditor()).toBe('');
    expect(page.notice().text).toContain('créé');
  });

  it('crée une tâche depuis sa carte avec le projet déjà choisi et ferme le formulaire après succès', async () => {
    const { fixture, page, bpm } = setup();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button[aria-label="Créer une tâche pour Rénover la cuisine"]').click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const editor = fixture.debugElement.query(By.directive(BpmTaskEditor)).componentInstance as any;
    expect(editor.defaultProjectId()).toBe('p1');
    expect(fixture.nativeElement.querySelector('select[name="projectId"]').disabled).toBe(true);
    editor.title = 'Comparer les devis';
    await editor.save();
    await fixture.whenStable();
    expect(bpm.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Comparer les devis', projectId: 'p1' }));
    expect(page.taskEditor()).toBe('');
    expect(page.notice().text).toContain('Compar');
  });

  it('conserve le tableau sans le cockpit ni ses commandes et filtres supprimés', () => {
    const { fixture } = setup();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.projects-cockpit')).toBeNull();
    expect(fixture.nativeElement.querySelector('.pc-console, .pc-priorities, .pc-filters')).toBeNull();
    expect(fixture.nativeElement.querySelector('section.board')).not.toBeNull();
  });
});
