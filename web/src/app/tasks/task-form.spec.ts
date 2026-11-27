import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideRouter, Router } from '@angular/router';
import { Api, ApiError } from '../core/api.service';
import { TaskForm } from './task-form';

const project = (id: string, over: any = {}) => ({
  project: { id, title: `Projet ${id}`, startDate: '2026-11-01', dueDate: '2026-11-30' },
  view: { statusLabel: 'En cours' },
  pathways: { isTaskDestination: true, canChangeProject: true, note: null },
  ...over,
});
const taskView = (over: any = {}) => ({
  task: { id: 'tsk_1', title: 'Devis', description: 'Trois devis', projectId: 'prj_1', status: 'doing', plannedHours: 4, spentHours: 1.5, startDate: '2026-11-03', dueDate: null, revision: 7 },
  pathways: { canChangeProject: false },
  ...over,
});

async function setup(inputs: Record<string, string> = {}, api: Partial<Record<keyof Api, any>> = {}) {
  const mock = {
    projects: vi.fn(async () => [project('prj_1'), project('prj_2'), project('prj_root', { pathways: { isTaskDestination: false, canChangeProject: true, note: 'Racine principale' } })]),
    task: vi.fn(async () => taskView()),
    createTask: vi.fn(async () => ({ task: { projectId: 'prj_2' } })),
    updateTask: vi.fn(async () => ({ task: { projectId: null } })),
    ...api,
  };
  TestBed.configureTestingModule({
    imports: [TaskForm],
    providers: [provideRouter([]), { provide: Api, useValue: mock }, { provide: Location, useValue: { back: vi.fn() } }],
  });
  const fixture = TestBed.createComponent(TaskForm);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, form: fixture.componentInstance as any, api: mock, navigate, root: fixture.nativeElement as HTMLElement };
}

describe('formulaire d’une tâche', () => {
  it('crée une tâche dans le projet demandé, avec une clé de requête', async () => {
    const { form, api, navigate } = await setup({ projectId: 'prj_2' });
    expect(form.title()).toBe('Nouvelle tâche');
    expect(form.destinations().map((p: any) => p.project.id)).toEqual(['prj_1', 'prj_2']);
    expect(form.form.controls.projectId.value).toBe('prj_2');
    form.form.patchValue({ title: 'Commander', plannedHours: '2,5', spentHours: '0' });
    await form.submit();
    const body = api.createTask.mock.calls[0][0];
    expect(body).toMatchObject({ title: 'Commander', projectId: 'prj_2', plannedHours: 2.5, spentHours: 0, startDate: null });
    expect(body.requestKey).toBeTruthy();
    expect(navigate).toHaveBeenCalledWith(['/projects', 'prj_2']);
  });

  it('ne propose pas la racine principale comme projet de destination', async () => {
    const { form } = await setup({ projectId: 'prj_root' });
    expect(form.form.controls.projectId.value).toBe('');
  });

  it('refuse un nom vide et des heures invalides sans rien envoyer', async () => {
    const { form, api } = await setup();
    await form.submit();
    expect(form.error().body.details.field).toBe('title');
    form.form.patchValue({ title: 'Ok', plannedHours: '-1' });
    await form.submit();
    expect(form.error().body.details.field).toBe('plannedHours');
    form.form.patchValue({ plannedHours: '', spentHours: '' });
    await form.submit();
    expect(form.error().body.details.field).toBe('spentHours');
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it('signale des dates hors de la période du projet ou inversées, sans bloquer', async () => {
    const { form } = await setup({ projectId: 'prj_1' });
    form.form.patchValue({ startDate: '2026-10-20' });
    expect(form.planningHint()).toContain('dépassent la période du projet');
    form.form.patchValue({ startDate: '2026-11-20', dueDate: '2026-11-10' });
    expect(form.planningHint()).toContain('dépasse l’échéance');
    form.form.patchValue({ startDate: '2026-11-05', dueDate: '2026-11-10' });
    expect(form.planningHint()).toBe('');
  });

  it('modifie une tâche à sa révision, rattachement verrouillé, et reprend un conflit', async () => {
    const conflict = new ApiError(409, { code: 'STALE_VERSION', action: 'Modification', message: 'Version périmée', details: {} } as any);
    const { form, api, navigate, fixture, root } = await setup({ id: 'tsk_1' }, { updateTask: vi.fn().mockRejectedValueOnce(conflict).mockResolvedValue({ task: { projectId: null } }) });
    expect(form.title()).toBe('Modifier la tâche');
    expect(form.form.getRawValue()).toMatchObject({ title: 'Devis', plannedHours: '4', spentHours: '1.5', dueDate: '' });
    expect(form.projectLocked()).toBe(true);
    expect(form.form.controls.projectId.disabled).toBe(true);
    expect(form.lockReason()).toBe('Rattachement non modifiable dans ce parcours.');
    form.form.patchValue({ title: 'Devis signé' });
    await form.submit();
    expect(api.updateTask.mock.calls[0][1]).toMatchObject({ title: 'Devis signé', expectedRevision: 7 });
    expect(api.updateTask.mock.calls[0][1]).not.toHaveProperty('projectId');
    expect(form.errorText()).toBe('Modification refusée : Version périmée');
    fixture.detectChanges();
    expect(root.querySelector('.editor-conflict')).not.toBeNull();
    api.task.mockResolvedValueOnce(taskView({ task: { ...taskView().task, revision: 8 } }));
    await form.rebase();
    expect(form.form.controls.title.value).toBe('Devis signé');
    await form.submit();
    expect(api.updateTask.mock.calls[1][1].expectedRevision).toBe(8);
    expect(navigate).toHaveBeenCalledWith(['/tasks']);
    await form.reloadCurrent();
    expect(form.form.controls.title.value).toBe('Devis');
    form.cancel();
    expect(TestBed.inject(Location).back).toHaveBeenCalled();
  });

  it('dit quand la lecture échoue', async () => {
    const { form, root } = await setup({}, { projects: vi.fn().mockRejectedValue(new Error('Réseau coupé')) });
    expect(form.loadError()).toContain('Réseau coupé');
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('Réseau coupé');
  });
});
