import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';
import { Api } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmTaskCard, BpmTasksOverview } from '../../core/bpm-projects.models';
import { BpmTasksPage } from './tasks.page';

const task = (
  id: string,
  status = 'todo',
  dueDate: string | null = null,
  projectId: string | null = 'p1',
) =>
  ({
    task: { id, title: id, description: '', status, dueDate, projectId, revision: 4 },
    pathways: { canChangeProject: true },
    budget: null,
  }) as unknown as BpmTaskCard;

function setup(query: Record<string, string> = {}, render = false) {
  const params = new BehaviorSubject(convertToParamMap(query));
  const state = {
    context: { calculationDate: '2026-11-07' },
    projects: [
      { projectId: 'p1', title: 'Cuisine', role: 'standard', budgetId: 'b1' },
      { projectId: 'p2', title: 'Voyage', role: 'standard', budgetId: 'b2' },
    ],
    tasks: [
      task('retard', 'doing', '2026-11-01'),
      task('terminee', 'done', '2026-10-01'),
      task('bloquee', 'blocked', null, 'p2'),
    ],
    attachable: [task('libre', 'todo', null, null)],
  } as unknown as BpmTasksOverview;
  const api = { attachTask: vi.fn(async () => ({ task: state.attachable[0].task })) };
  const bpm = { tasksOverview: vi.fn(async () => state) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Api, useValue: api },
      { provide: BpmApi, useValue: bpm },
      {
        provide: ActivatedRoute,
        useValue: {
          queryParamMap: params,
          queryParams: of(query),
          paramMap: of(convertToParamMap({})),
          fragment: of(null),
          snapshot: { queryParamMap: convertToParamMap(query), queryParams: query },
        },
      },
    ],
  });
  if (!render) TestBed.overrideComponent(BpmTasksPage, { set: { template: '' } });
  const fixture = TestBed.createComponent(BpmTasksPage);
  const page = fixture.componentInstance as any;
  page.data.set(state);
  return { fixture, page, api, bpm, params, state };
}

describe('outils contextuels du tableau de tâches BPM', () => {
  it('présente les commandes et le rattachement dans le bandeau partagé', () => {
    const { fixture, page } = setup({ project: 'p1' }, true);
    page.loading.set(false);
    fixture.detectChanges();
    const banner = fixture.nativeElement.querySelector('bpm-page-banner') as HTMLElement;
    expect(banner.querySelector('.bpm-toolbar-focus')?.textContent).toContain('échéance');
    expect(banner.querySelector('form select[name="taskId"]')).toBeTruthy();
    const create = [...banner.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Créer une tâche'),
    )!;
    create.click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('dialog[aria-label="Créer une tâche"]'),
    ).toBeTruthy();
    expect(page.taskProject()).toBe('p1');
  });

  it('combine projet et retard en excluant les tâches terminées, puis recalcule avec l’URL', () => {
    const { page, params } = setup({ project: 'p1', attention: 'late' });
    expect(page.visible().map((t: BpmTaskCard) => t.task.id)).toEqual(['retard']);
    expect(page.nextTask().kind).toBe('late');
    params.next(convertToParamMap({ attention: 'blocked' }));
    expect(page.visible().map((t: BpmTaskCard) => t.task.id)).toEqual(['bloquee']);
    expect(page.nextTask().kind).toBe('blocked');
  });

  it('ouvre la tâche visible après recherche et ne propose pas une tâche bloquée masquée', () => {
    const { fixture, page, params, state } = setup({ project: 'p1', q: 'Comparer' }, true);
    state.tasks = [task('mesures', 'blocked'), task('devis', 'doing', '2026-11-01')];
    state.tasks[0].task.title = 'Préparer les mesures';
    state.tasks[1].task.title = 'Comparer les devis';
    page.data.set({ ...state });
    page.loading.set(false);
    fixture.detectChanges();
    const banner = fixture.nativeElement.querySelector('bpm-page-banner') as HTMLElement;
    expect(page.visible().map((t: BpmTaskCard) => t.task.id)).toEqual(['devis']);
    expect(banner.querySelector('.bpm-toolbar-focus')?.textContent).not.toContain('bloquée');
    const review = [...banner.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Revoir une tâche en retard'),
    )!;
    expect(review).toBeTruthy();
    review.click();
    expect(page.taskEditor()).toBe('devis');
    expect(page.editingTask().task.title).toBe('Comparer les devis');
    params.next(convertToParamMap({ project: 'p1', q: 'Préparer', attention: 'late' }));
    expect(page.visible()).toEqual([]);
    expect(page.nextTask()).toBeNull();
    expect(page.pageFocus().title).toContain('Aucune tâche');
  });

  it('filtre aussi le rattachement sans écarter les tâches sans projet du projet destinataire choisi', async () => {
    const { page, params, state, api } = setup({ project: 'p1', q: 'libre', attention: 'blocked' });
    state.attachable = [
      task('libre à préparer', 'todo', null, null),
      task('libre bloquée', 'blocked', null, null),
      task('autre', 'blocked', null, null),
    ];
    page.data.set({ ...state });
    expect(page.attachableTasks().map((t: BpmTaskCard) => t.task.id)).toEqual(['libre bloquée']);
    expect(page.pageFocus().title).toContain('1 tâche(s) disponible(s)');
    await page.quickAttach('libre à préparer', 'p1');
    expect(api.attachTask).not.toHaveBeenCalled();
    params.next(convertToParamMap({ project: 'p1', q: 'introuvable' }));
    expect(page.attachableTasks()).toEqual([]);
    expect(page.nextTask()).toBeNull();
  });

  it('crée dans le projet sélectionné et ouvre une tâche existante sans écriture', () => {
    const { page, api, state } = setup({ project: 'p1' });
    page.openEditor();
    expect(page.taskEditor()).toBe('new');
    expect(page.taskProject()).toBe('p1');
    page.openEditor(state.tasks[0]);
    expect(page.taskEditor()).toBe('retard');
    expect(page.editingTask().task.id).toBe('retard');
    expect(page.taskProject()).toBe('');
    expect(api.attachTask).not.toHaveBeenCalled();
  });

  it('rattache une tâche disponible avec sa révision et refuse les sélections périmées', async () => {
    const { page, api, bpm } = setup();
    await page.quickAttach('inconnue', 'p1');
    await page.quickAttach('libre', 'inconnu');
    expect(api.attachTask).not.toHaveBeenCalled();
    await page.quickAttach('libre', 'p1');
    expect(api.attachTask).toHaveBeenCalledExactlyOnceWith('libre', 'p1', 4);
    expect(bpm.tasksOverview).toHaveBeenCalledOnce();
    expect(page.notice().text).toContain('Cuisine');
    expect(page.pending().size).toBe(0);
  });
});
