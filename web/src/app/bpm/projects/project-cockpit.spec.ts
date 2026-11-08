import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';
import { Api, ApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmProjectDetail, BpmTaskCard } from '../../core/bpm-projects.models';
import { BpmProjectPage } from './project.page';
import { BpmTaskEditor } from './project-editors';
import { BpmProjectMetricsComponent } from './project-metrics';

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

async function setup(render = false, workspaceKey?: string, initialQuery: Record<string, string> = {}) {
  const state = detail();
  const params = new BehaviorSubject(convertToParamMap({ id: 'prj_1' }));
  const query = new BehaviorSubject(convertToParamMap({ lifePeriod: '2026-09', ...initialQuery }));
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
      {
        provide: ActivatedRoute,
        useValue: {
          data: of(workspaceKey ? { workspace: { key: workspaceKey, title: 'Vue spécialisée', lead: '', parent: '/app/gestion-projet' } } : {}),
          paramMap: params,
          fragment: of(null),
          queryParams: of({ lifePeriod: '2026-09' }),
          queryParamMap: query,
        },
      },
    ],
  });
  if (!render) TestBed.overrideComponent(BpmProjectPage, { set: { template: '' } });
  const fixture = TestBed.createComponent(BpmProjectPage);
  // Exercise user commands through the component; rendering is covered separately below.
  const page = fixture.componentInstance as any;
  await page.load();
  return { fixture, page, bpm, api, state, params, query };
}

describe('cockpit du projet', () => {
  it('reprend la bonne tâche depuis un lien direct et suit les retours de l’historique', async () => {
    const { fixture, page, query } = await setup(true, undefined, { editTask: 'tsk_2' });
    fixture.detectChanges();
    expect(page.editingTask()?.task.title).toBe('Commander les matériaux');
    expect(fixture.nativeElement.querySelector('dialog[aria-label="Modifier la tâche"]')).toBeTruthy();
    query.next(convertToParamMap({ lifePeriod: '2026-09' })); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('bpm-task-editor')).toBeNull();
    query.next(convertToParamMap({ lifePeriod: '2026-09', editTask: 'new' })); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('dialog[aria-label="Créer une tâche"]')).toBeTruthy();
    expect(page.editingTask()).toBeNull();
  });

  it('reprend aussi la modification du projet après un rechargement', async () => {
    const { fixture } = await setup(true, undefined, { editProject: 'prj_1' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('dialog[aria-label="Modifier le projet de la vie"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('button[aria-label="Fermer la fenêtre"]')).toBeTruthy();
  });
  it('consacre la vue budget aux finances et la vue tâches au travail du même projet', async () => {
    const budget = await setup(true, 'project-budget');
    budget.fixture.detectChanges();
    expect(budget.fixture.nativeElement.querySelector('.project-cockpit')).toBeTruthy();
    expect(budget.fixture.nativeElement.querySelector('.project-task-board')).toBeNull();
    expect(budget.fixture.nativeElement.querySelector('section[aria-label="Parts des tâches à décider"]')).toBeTruthy();
    budget.fixture.destroy();
    TestBed.resetTestingModule();
    const tasks = await setup(true, 'project-tasks');
    tasks.fixture.detectChanges();
    expect(tasks.fixture.nativeElement.querySelector('.project-task-board')).toBeTruthy();
    expect(tasks.fixture.nativeElement.querySelector('.project-cockpit')).toBeNull();
  });

  it('propose l’enveloppe avant la première dépense et ouvre sa saisie sans écriture', async () => {
    const { page, state, bpm } = await setup();
    page.data.set({ ...state, budget: { ...state.budget!, regime: false, allocationCents: null } });
    expect(page.pageFocus().title).toContain('reste à attribuer');
    expect(page.nextActionLabel()).toBe('Attribuer l’enveloppe');
    page.runNextAction();
    expect(page.allocationEditing()).toBe(true);
    expect(bpm.allocate).not.toHaveBeenCalled();
  });

  it('ouvre le règlement exigible le plus ancien dans la tâche concernée, sans le valider', async () => {
    const { page, state, api } = await setup();
    page.data.set({
      ...state,
      context: { ...state.context, calculationDate: '2026-11-07' },
      charges: [
        {
          id: 'later',
          taskId: 'tsk_2',
          label: 'Commande',
          plannedDate: '2026-11-06',
          plannedCents: 6000,
          settled: false,
        },
        {
          id: 'first',
          taskId: 'tsk_1',
          label: 'Acompte',
          plannedDate: '2026-11-02',
          plannedCents: 2000,
          settled: false,
        },
        {
          id: 'future',
          taskId: 'tsk_1',
          label: 'Livraison',
          plannedDate: '2026-12-01',
          plannedCents: 3000,
          settled: false,
        },
      ],
    });
    expect(page.pageFocus().title).toContain('Acompte');
    page.runNextAction();
    expect(page.openTaskId()).toBe('tsk_1');
    expect(page.settling()).toBe('first');
    expect(api.changeTaskStatus).not.toHaveBeenCalled();
  });

  it('privilégie les décisions de financement et conserve les filtres lors de leur ouverture', async () => {
    const { page, state } = await setup();
    state.tasks[0].task.status = 'blocked';
    page.data.set({ ...state, requests: [{ id: 'request', taskId: 'tsk_1', status: 'pending' }] });
    page.query.set('Choisir');
    page.taskAttention.set('blocked');
    page.runNextAction();
    expect(page.decisionsOpen()).toBe(true);
    expect(page.query()).toBe('Choisir');
    expect(page.taskAttention()).toBe('blocked');
    expect(page.pageFocus().title).toContain('1 décision');
  });
  it('ne propose pas une décision ou un règlement d’une tâche masquée par la sélection', async () => {
    const { page, state } = await setup();
    page.data.set({ ...state, requests: [{ id: 'request', taskId: 'tsk_1', status: 'pending' }] });
    page.query.set('aucune tâche');
    expect(page.pendingTaskRequests()).toEqual([]);
    expect(page.nextTask()).toBeNull();
    expect(page.nextActionLabel()).toBe('Réinitialiser la sélection');
    page.runNextAction();
    expect(page.decisionsOpen()).toBe(false);
    expect(page.query()).toBe('');
  });

  it('suspend la fenêtre de la tâche pendant la saisie, puis la reprend à la fermeture', async () => {
    const { page, fixture, state } = await setup(true);
    fixture.detectChanges();
    await fixture.whenStable();
    page.openTaskId.set(state.tasks[0].task.id);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('dialog[aria-label="Choisir le plan"]')).not.toBeNull();
    page.addExpense(state.tasks[0].task.id);
    fixture.detectChanges();
    expect(root.querySelector('dialog[aria-label="Choisir le plan"]')).toBeNull();
    expect(page.openTaskId()).toBe(state.tasks[0].task.id);
    page.entryId.set('');
    fixture.detectChanges();
    expect(root.querySelector('dialog[aria-label="Choisir le plan"]')).not.toBeNull();
  });

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
    const buttons = flow?.querySelectorAll('button') ?? [];
    // Geste nominal en premier (vous pilotez aussi le projet de vie) ; la demande seule reste possible.
    expect(buttons[0]?.textContent).toMatch(/Autoriser 100,00\s€ de dépassement et enregistrer/);
    expect(buttons[1]?.textContent).toContain('Demander sans décider maintenant');
    (buttons[1] as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      root.querySelector(
        '[aria-label="Autorisation du budget du projet de vie"] bpm-overrun-request',
      ),
    ).toBeTruthy();
    await page.decideFlow('approve');
    // La demande déposée puis autorisée, la part est rejouée telle quelle (sans financement : elle tient désormais).
    expect(setTaskShare).toHaveBeenCalledTimes(2);
    expect(setTaskShare).toHaveBeenLastCalledWith('bud_1', 'tsk_1', 600, 7, {
      authorizeOverrun: undefined,
    });
    expect(page.flow()).toBeNull();
  });

  it('autorise le dépassement et enregistre la part en une seule écriture du middleware', async () => {
    const { page, bpm, state } = await setup();
    const setTaskShare = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(422, {
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
    const requestOverrun = vi.fn(async () => ({
      overrunId: 'ovr_1',
      overrun: { id: 'ovr_1', revision: 1 },
    }));
    const decideOverrun = vi.fn(async () => ({ notice: null }));
    Object.assign(bpm, { setTaskShare, requestOverrun, decideOverrun });
    await page.saveShare('bud_1', state.tasks[0], '600', 7);
    await page.authorizeFlow();
    // Plus d'enchaînement côté interface : la part est rejouée avec l'autorisation du dépassement dans la même écriture.
    expect(requestOverrun).not.toHaveBeenCalled();
    expect(decideOverrun).not.toHaveBeenCalled();
    expect(setTaskShare).toHaveBeenCalledTimes(2);
    expect(setTaskShare).toHaveBeenLastCalledWith('bud_1', 'tsk_1', 600, 7, {
      authorizeOverrun: true,
    });
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

  it('garde des cartes de taille fixe : les dépenses s’ouvrent dans la fenêtre de la tâche', async () => {
    const { fixture, page, state } = await setup(true);
    const charge = (i: number) => ({
      id: `op_${i}`,
      taskId: 'tsk_1',
      label: `Location ${i}`,
      plannedDate: '2026-11-06',
      plannedCents: 4000,
      realizedDate: null,
      realizedCents: null,
      settled: false,
      validated: false,
      cadenceLabel: 'Mensuelle',
    });
    page.data.set({ ...state, charges: Array.from({ length: 13 }, (_, i) => charge(i)) });
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const card = root.querySelector('.project-task-card') as HTMLElement;
    // La carte n'énumère pas les dépenses : elle en donne le nombre et ouvre la fenêtre.
    expect(card.querySelectorAll('.task-charge').length).toBe(0);
    const open = [...card.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Dépenses · 13'),
    );
    expect(open).toBeTruthy();
    open!.click();
    fixture.detectChanges();
    const dialog = root.querySelector('dialog') as HTMLElement;
    expect(dialog.querySelectorAll('.task-charge').length).toBe(13);
    expect(dialog.textContent).toContain('Dépenses de la tâche · 13');
    // « Demander un montant » ouvre la même fenêtre, formulaire de part déjà déplié.
    page.closeTaskPanel();
    fixture.detectChanges();
    expect(root.querySelector('dialog')).toBeNull();
    const ask = [...card.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Demander un montant'),
    );
    ask!.click();
    fixture.detectChanges();
    expect(root.querySelector('dialog .task-funding-box input[name="amount"]')).toBeTruthy();
  });

  it('réinitialise les formulaires quand le projet affiché change', async () => {
    const { page, params } = await setup();
    page.editAllocation();
    page.editTask(task('tsk_1', 'Ancienne tâche'));
    page.query.set('ancien');
    params.next(convertToParamMap({ id: 'prj_2' }));
    expect(page.allocationEditing()).toBe(false);
    expect(page.taskEditor()).toBe(false);
    expect(page.editingTask()).toBeNull();
    expect(page.query()).toBe('');
  });

  it.each([
    {
      label: 'avant l’enveloppe',
      regime: true,
      validated: false,
      beforeAllocation: true,
      expected: 'Sa date réelle précède l’attribution',
    },
    {
      label: 'sans enveloppe',
      regime: false,
      validated: false,
      beforeAllocation: false,
      expected: 'Ce projet n’a pas d’enveloppe',
    },
    {
      label: 'sur l’enveloppe',
      regime: true,
      validated: true,
      beforeAllocation: false,
      expected: 'remonté au budget du projet de vie à sa date réelle',
    },
  ])(
    'explique le règlement $label à partir de la lecture du middleware, sans changer la date prévue',
    async ({ regime, validated, beforeAllocation, expected }) => {
      const { page, bpm, state } = await setup();
      state.budget!.regime = regime;
      const charge = {
        id: 'op_date',
        operationId: 'op_date',
        kind: 'operation',
        taskId: 'tsk_1',
        label: 'Devis avancé',
        plannedDate: '2027-02-05',
        plannedCents: 4000,
        revision: 2,
        settled: false,
      } as any;
      state.charges = [charge];
      const realizeOperation = vi.fn(async () => {
        state.charges = [
          {
            ...charge,
            settled: true,
            realizedDate: '2026-11-05',
            realizedCents: 4500,
            validated,
            beforeAllocation,
          },
        ];
      });
      Object.assign(bpm, { realizeOperation });
      const form = document.createElement('form');
      form.innerHTML = '<input name="date" value="2026-11-05"><input name="amount" value="45">';
      await page.settle(charge, form.elements);
      expect(realizeOperation).toHaveBeenCalledExactlyOnceWith('op_date', {
        expectedRevision: 2,
        realizedDate: '2026-11-05',
        realizedAmount: 45,
        fund: undefined,
      });
      expect(state.charges[0].plannedDate).toBe('2027-02-05');
      expect(page.notice().text).toContain(expected);
      if (!validated) expect(page.notice().text).not.toContain('Il est remonté');
    },
  );

  it('permet de retrouver et modifier une dépense depuis sa tâche tout en conservant la tâche ouverte', async () => {
    const { page, state, bpm } = await setup();
    const line = { id: 'op_1', taskId: 'tsk_1', plannedDate: '2027-02-05' } as any;
    page.showTask(state.tasks[0], 'charges');
    page.openCharge(line);
    expect(page.lineId()).toBe('op_1');
    page.editCharge(line);
    expect(page.lineId()).toBeNull();
    expect(page.entryId()).toBe(line.id);
    expect(page.editorOpen()).toBe(true);
    expect(page.openTaskId()).toBe('tsk_1');
    const reads = bpm.projectDetail.mock.calls.length;
    await page.onSaved('Date prévue modifiée.');
    expect(page.editorOpen()).toBe(false);
    expect(page.entryId()).toBe('');
    expect(page.openTaskId()).toBe('tsk_1');
    expect(bpm.projectDetail.mock.calls.length).toBeGreaterThan(reads);
  });

  it('conserve la période du projet de vie pour le retour sans présenter la fiche projet comme historique', async () => {
    const { fixture, page } = await setup(true);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const back = [...root.querySelectorAll<HTMLAnchorElement>('a')].find((a) =>
      a.textContent?.includes('Échéances à régler dans le projet de vie'),
    )!;
    expect(back.getAttribute('href')).toBe('/projet-de-vie?period=2026-09#life-due');
    expect(root.querySelector('.project-reading-scope')?.textContent).toContain(
      'toute la durée du projet',
    );
    expect(page.lifePeriod()).toBe('2026-09');
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

describe('repères budgétaires du projet et estimation de la tâche', () => {
  it.each([
    { remaining: -100, label: 'Enveloppe dépassée', tone: 'red' },
    { remaining: 0, label: 'Enveloppe épuisée', tone: 'red' },
    { remaining: 1999, label: 'Budget presque épuisé', tone: 'red' },
    { remaining: 2000, label: 'Budget à surveiller', tone: 'orange' },
    { remaining: 5000, label: 'Budget disponible', tone: 'green' },
    { remaining: null, label: 'Consommation à estimer', tone: 'unknown' },
  ])('nomme correctement un reste de $remaining centimes', ({ remaining, label, tone }) => {
    const f = TestBed.createComponent(BpmProjectMetricsComponent);
    f.componentRef.setInput('budget', {
      ...detail().budget,
      regime: true,
      ceilingCents: 10000,
      remainingCents: remaining,
    });
    f.detectChanges();
    const root: HTMLElement = f.nativeElement;
    expect(root.querySelector('.pm-signal')?.textContent).toContain(label);
    expect(root.querySelector('.pm-budget')?.getAttribute('data-tone')).toBe(tone);
  });

  it('distingue un dépassement estimé selon le temps des règlements réellement payés', () => {
    const f = TestBed.createComponent(BpmProjectMetricsComponent);
    const t = task('tsk_1', 'Finir');
    f.componentRef.setInput('task', {
      ...t,
      budget: {
        ...t.budget,
        shareCents: 10000,
        paidCents: 1000,
        timeConsumedCents: 12000,
        timeRemainingCents: -2000,
        timeConsumptionPercent: 120,
      },
    });
    f.detectChanges();
    const root: HTMLElement = f.nativeElement;
    expect(root.querySelector('.pm-signal')?.textContent).toContain(
      'Estimation au-delà de la part',
    );
    expect(root.textContent).toContain('Estimation au prorata du temps saisi');
    expect(root.querySelector('.pm-metric-caption')?.textContent).not.toContain(
      'Réglé sur l’enveloppe',
    );
  });
  it('rend le reliquat avec la révision lue sans avoir ouvert l’éditeur d’enveloppe', async () => {
    const { page, bpm, state } = await setup();
    await page.applyCheck('bud_1', 10000, 'Rendre le reliquat');
    expect(bpm.allocate).toHaveBeenCalledWith('bud_1', 100, 7);
    expect(state.budget!.allocationCents).toBe(10000);
  });

});
