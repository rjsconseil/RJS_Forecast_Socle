import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';
import { Api } from '../../core/api.service';
import { BpmApi } from '../data/bpm-api.service';
import { BpmTaskCard, BpmTasksOverview } from '../data/bpm-projects.models';
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
  const api = { attachTask: vi.fn(async (taskId: string, projectId: string, _revision: number) => {
    const attached = state.attachable.find((t) => t.task.id === taskId)!;
    attached.task.projectId = projectId;
    state.attachable = state.attachable.filter((t) => t.task.id !== taskId);
    state.tasks.push(attached);
    return { task: attached.task };
  }) };
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
  it('présente les commandes dans le bandeau et la capture rapide au-dessus du tableau', () => {
    const { fixture, page } = setup({ project: 'p1' }, true);
    page.loading.set(false);
    fixture.detectChanges();
    const banner = fixture.nativeElement.querySelector('rjs-page-banner') as HTMLElement;
    expect(banner.querySelector('.page-toolbar-focus')?.textContent).toContain('échéance');
    // Le rattachement se fait sur chaque carte ; le bandeau ne porte plus de formulaire de rattachement.
    expect(banner.querySelector('form select[name="taskId"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('form.task-capture input')).toBeTruthy();
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
    const banner = fixture.nativeElement.querySelector('rjs-page-banner') as HTMLElement;
    expect(page.visible().map((t: BpmTaskCard) => t.task.id)).toEqual(['devis']);
    expect(banner.querySelector('.page-toolbar-focus')?.textContent).not.toContain('bloquée');
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

  it('conserve les tâches sans projet dans les indicateurs globaux et leur attribution depuis une carte', async () => {
    const { fixture, page, params, api } = setup({ project: 'none' }, true);
    page.loading.set(false);
    fixture.detectChanges();
    expect(page.selectedProjectId()).toBeNull();
    expect(page.remaining()).toBe(3);
    expect(page.progress()).toBe(25);
    expect(page.counts().todo).toBe(1);
    expect(page.toolbarScope()).toContain('Sans projet · 1 / 4 tâche(s)');
    const links = [...fixture.nativeElement.querySelectorAll('a')] as HTMLAnchorElement[];
    expect(links.some((link) => link.getAttribute('href') === '/projet-de-vie/projets')).toBe(true);
    expect(links.some((link) => link.getAttribute('href')?.includes('/none'))).toBe(false);

    const select = fixture.nativeElement.querySelector('.task-attach select') as HTMLSelectElement;
    select.value = 'p2';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.attachTask).toHaveBeenCalledExactlyOnceWith('libre', 'p2', 4);
    expect(fixture.nativeElement.querySelector('.task-attach')).toBeNull();
    params.next(convertToParamMap({ project: 'p2' }));
    fixture.detectChanges();
    expect(page.visible().map((t: BpmTaskCard) => t.task.id)).toEqual(['bloquee', 'libre']);
    expect(page.remaining()).toBe(3);
  });

  it('garde les compteurs globaux stables pendant une recherche et ouvre la tâche ciblée dans son projet', () => {
    const { fixture, page, params } = setup({}, true);
    page.loading.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a.task-title-link[href*="task=retard"]')?.getAttribute('href')).toBe('/app/gestion-projet/p1/taches?task=retard');
    params.next(convertToParamMap({ q: 'retard' }));
    expect(page.visible()).toHaveLength(1);
    expect(page.filterOptions()[0].label).toContain('(4)');
    expect(page.filterOptions()[1].label).toContain('(1)');
    expect(page.progress()).toBe(25);
  });
});
