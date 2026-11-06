import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';
import { Api, ApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmProjectDetail, BpmTaskCard } from '../../core/bpm-projects.models';
import { BpmProjectPage } from './project.page';
import { BpmTaskEditor } from './project-editors';

const task = (id: string, title: string, status = 'todo') =>
  ({
    task: {
      id,
      title,
      description: 'Travail à préparer',
      projectId: 'prj_1',
      status,
      revision: 3,
      spentHours: 2,
      plannedHours: 8,
      startDate: null,
      dueDate: null,
    },
    pathways: { canChangeProject: true },
    budget: {
      shareCents: 10000,
      remainingCents: 8000,
      paidCents: 2000,
      engagedCents: 4000,
      request: null,
      return: null,
      timeConsumptionPercent: 25,
      timeConsumedCents: 2500,
    },
  }) as BpmTaskCard;
const detail = () =>
  ({
    role: 'standard',
    project: {
      project: {
        id: 'prj_1',
        title: 'Rénover la cuisine',
        description: 'Un projet de test',
        revision: 1,
      },
      view: {
        status: 'ongoing',
        statusLabel: 'En cours',
        time: { spentHoursTotal: 2, plannedHoursKnown: 8, plannedIsPartial: false },
      },
    },
    budget: {
      budgetId: 'bud_1',
      revision: 7,
      allocationCents: 50000,
      regime: true,
      paidCents: 2000,
      remainingCents: 48000,
      toPayCents: 2000,
      sharesCents: 10000,
      availableCents: 40000,
      state: 'ok',
    },
    tasks: [task('tsk_1', 'Choisir le plan'), task('tsk_2', 'Commander les matériaux', 'doing')],
    attachable: [],
    requests: [],
    overruns: [],
    checks: [],
    charges: [],
    context: { period: null },
  }) as unknown as BpmProjectDetail;

async function setup(render = false) {
  const state = detail();
  const params = new BehaviorSubject(convertToParamMap({ id: 'prj_1' }));
  const bpm = {
    projectDetail: vi.fn(async () => state),
    allocate: vi.fn(async (_id: string, amount: number, _revision: number) => {
      state.budget!.allocationCents = Math.round(amount * 100);
    }),
    createTask: vi.fn(async (_input: unknown) => ({})),
  };
  const api = {
    changeTaskStatus: vi.fn(async () => ({ task: state.tasks[0].task })),
    attachTask: vi.fn(async () => ({})),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Api, useValue: api },
      { provide: BpmApi, useValue: bpm },
      { provide: ActivatedRoute, useValue: { paramMap: params, fragment: of(null) } },
    ],
  });
  if (!render) TestBed.overrideComponent(BpmProjectPage, { set: { template: '' } });
  const fixture = TestBed.createComponent(BpmProjectPage);
  // Exercise user commands through the component; rendering is covered separately below.
  const page = fixture.componentInstance as any;
  await page.load();
  return { fixture, page, bpm, api, state, params };
}

describe('cockpit du projet', () => {
  it('enregistre uniquement l’enveloppe et ferme son formulaire après succès', async () => {
    const { page, bpm, api } = await setup();
    page.editAllocation();
    page.allocation.set('1250,50');
    await page.allocate('bud_1', page.allocationRevision());
    expect(bpm.allocate).toHaveBeenCalledExactlyOnceWith('bud_1', 1250.5, 7);
    expect(page.allocationEditing()).toBe(false);
    expect(page.notice().text).toBe('Enveloppe budgétaire enregistrée.');
    expect(bpm.createTask).not.toHaveBeenCalled();
    expect(api.changeTaskStatus).not.toHaveBeenCalled();
    expect(page.editorOpen()).toBe(false);
  });

  it('conserve la saisie et le formulaire en cas de conflit, avec la révision initiale', async () => {
    const { page, bpm, state } = await setup();
    page.editAllocation();
    page.allocation.set('950');
    state.budget!.revision = 8;
    bpm.allocate.mockRejectedValueOnce(
      new ApiError(409, { code: 'REVISION_CONFLICT', action: null, message: 'Conflit' }),
    );
    await page.allocate('bud_1', page.allocationRevision());
    expect(page.allocationEditing()).toBe(true);
    expect(page.allocation()).toBe('950');
    expect(page.allocationRevision()).toBe(7);
    expect(page.allocationError()).toBeTruthy();
  });

  it('refuse un montant invalide sans effectuer d’écriture', async () => {
    const { page, bpm } = await setup();
    page.editAllocation();
    page.allocation.set('-1');
    await page.allocate('bud_1', page.allocationRevision());
    expect(bpm.allocate).not.toHaveBeenCalled();
    expect(page.allocationEditing()).toBe(true);
  });

  it('affiche le refus budgétaire, demande une autorisation et rejoue la part après accord', async () => {
    const { fixture, page, bpm, state } = await setup(true);
    const setTaskShare = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(409, {
          code: 'OVERRUN_AUTHORIZATION_REQUIRED',
          action: null,
          message: 'Il manque 100 €.',
          details: {
            budgetId: 'bud_1',
            taskId: 'tsk_1',
            overrunCents: 10000,
            ceilingCents: 50000,
            reason: 'ventilation',
          },
        }),
      )
      .mockResolvedValue({});
    Object.assign(bpm, {
      setTaskShare,
      requestOverrun: vi.fn(async () => ({
        overrun: {
          id: 'ovr_1',
          revision: 1,
          status: 'pending',
          amountCents: 10000,
          reasonLabel: 'Ventilation',
          requestedAt: '2026-11-05',
        },
      })),
      decideOverrun: vi.fn(async () => ({})),
    });
    await page.saveShare('bud_1', state.tasks[0], '600', 7);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const flow = root.querySelector('[aria-label="Autorisation du budget du projet de vie"]');
    expect(flow?.textContent).toContain('Il manque 100 €');
    expect(flow?.querySelector('button')?.textContent).toContain('Demander l’autorisation');
    flow?.querySelector('button')?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      root.querySelector('[aria-label="Autorisation du budget du projet de vie"] bpm-overrun-request'),
    ).toBeTruthy();
    await page.decideFlow('approve');
    expect(setTaskShare).toHaveBeenCalledTimes(2);
    expect(setTaskShare).toHaveBeenLastCalledWith('bud_1', 'tsk_1', 600, 7);
    expect(page.flow()).toBeNull();
  });

  it('annule les déplacements avec Échap et ignore les tâches étrangères au projet', async () => {
    const { page, api, state } = await setup();
    const drop = {
      previousContainer: {},
      container: { data: 'doing' },
      isPointerOverContainer: true,
      item: { data: state.tasks[0] },
    };
    page.started();
    page.cancelDrag();
    await page.dropped(drop);
    expect(api.changeTaskStatus).not.toHaveBeenCalled();
    await page.changeStatus(
      { ...state.tasks[0], task: { ...state.tasks[0].task, projectId: 'prj_other' } },
      'done',
    );
    expect(api.changeTaskStatus).not.toHaveBeenCalled();
    page.started();
    await page.dropped(drop);
    expect(api.changeTaskStatus).toHaveBeenCalledExactlyOnceWith('tsk_1', 'doing', 3);
  });

  it('rétablit le sélecteur après une erreur et relit le projet', async () => {
    const { page, api, state, bpm } = await setup();
    const select = document.createElement('select');
    select.innerHTML =
      '<option value="todo">À faire</option><option value="done">Terminée</option>';
    select.value = 'done';
    api.changeTaskStatus.mockRejectedValueOnce(new Error('Indisponible'));
    const reads = bpm.projectDetail.mock.calls.length;
    await page.changeStatus(state.tasks[0], 'done', select);
    expect(select.value).toBe('todo');
    expect(bpm.projectDetail.mock.calls.length).toBeGreaterThan(reads);
    expect(page.notice().error).toBe(true);
  });

  it('affiche les quatre colonnes et retrouve une tâche sans modifier les totaux', async () => {
    const { fixture, page } = await setup(true);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelectorAll('.board-column').length).toBe(4);
    expect(root.querySelectorAll('.project-task-card').length).toBe(2);
    page.query.set('MATÉRIAUX');
    fixture.detectChanges();
    expect(root.querySelectorAll('.project-task-card').length).toBe(1);
    expect(root.querySelector('.project-task-card')?.textContent).toContain(
      'Commander les matériaux',
    );
    expect(page.data().tasks.length).toBe(2);
  });

  it('isole les opérations par tâche et ne rattache que les tâches disponibles sans projet', async () => {
    const { page, state, api } = await setup();
    state.charges = [
      { id: 'op_1', taskId: 'tsk_1' },
      { id: 'op_2', taskId: 'tsk_2' },
      { id: 'op_3', taskId: null },
    ] as any;
    state.attachable = [
      task('taken', 'Déjà rattachée'),
      {
        ...task('free', 'Disponible'),
        task: { ...task('free', 'Disponible').task, projectId: null },
      },
      {
        ...task('locked', 'Indisponible'),
        task: { ...task('locked', 'Indisponible').task, projectId: null },
        pathways: { canChangeProject: false },
      },
    ];
    page.data.set({ ...state });
    expect(page.taskCharges('tsk_1').map((c: any) => c.id)).toEqual(['op_1']);
    expect(page.unassignedCharges().map((c: any) => c.id)).toEqual(['op_3']);
    await page.attach('taken');
    expect(api.attachTask).not.toHaveBeenCalled();
    await page.attach('free');
    expect(api.attachTask).toHaveBeenCalledExactlyOnceWith('free', 'prj_1', 3);
  });

  it('réinitialise les formulaires quand le projet affiché change', async () => {
    const { page, params } = await setup();
    page.editAllocation();
    page.editingTask.set(task('tsk_1', 'Ancienne tâche'));
    page.taskEditor.set(true);
    page.query.set('ancien');
    params.next(convertToParamMap({ id: 'prj_2' }));
    expect(page.allocationEditing()).toBe(false);
    expect(page.taskEditor()).toBe(false);
    expect(page.editingTask()).toBeNull();
    expect(page.query()).toBe('');
  });
});

describe('création depuis un projet', () => {
  it('impose le projet de la page dans la commande, même si le brouillon change', async () => {
    const createTask = vi.fn(async () => ({}));
    TestBed.configureTestingModule({
      providers: [
        { provide: Api, useValue: {} },
        { provide: BpmApi, useValue: { createTask } },
      ],
    });
    TestBed.overrideComponent(BpmTaskEditor, { set: { template: '' } });
    const fixture = TestBed.createComponent(BpmTaskEditor);
    fixture.componentRef.setInput('defaultProjectId', 'prj_1');
    fixture.detectChanges();
    const editor = fixture.componentInstance as any;
    editor.title = 'Nouvelle tâche';
    editor.projectId = 'prj_other';
    await editor.save();
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Nouvelle tâche', projectId: 'prj_1' }),
    );
  });
});
