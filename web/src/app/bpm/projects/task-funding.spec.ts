import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Api, ApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmProjectDetail, BpmTaskCard, TaskBudgetRequest } from '../../core/bpm-projects.models';
import { BpmManagedTaskComponent, TaskFundingSubmission } from './managed-task';
import { BpmProjectPage } from './project.page';
import { BpmTaskRequestsComponent } from './project-parts';

const task = {
  task: {
    id: 'tsk_1',
    projectId: 'prj_1',
    title: 'Comparer les devis',
    description: '',
    status: 'todo',
    revision: 1,
    plannedHours: 4,
    spentHours: 0,
  },
  budgetId: 'bud_1',
  budget: {
    shareCents: null,
    engagedCents: 0,
    paidCents: 0,
    remainingCents: null,
    request: null,
    timeConsumptionPercent: 0,
    timeConsumedCents: null,
    timeRemainingCents: null,
  },
} as BpmTaskCard;

const request = {
  id: 'dmt_1',
  revision: 1,
  budgetId: 'bud_1',
  taskId: 'tsk_1',
  amountCents: 10000,
  status: 'pending',
  statusLabel: 'En attente',
} as TaskBudgetRequest;

describe('clés des demandes de montant depuis une tâche dépliée', () => {
  it('permet de préparer une demande sans enveloppe et guide vers son attribution', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const f = TestBed.createComponent(BpmManagedTaskComponent);
    f.componentRef.setInput('task', task);
    f.componentRef.setInput('funded', false);
    f.detectChanges();
    const root: HTMLElement = f.nativeElement;
    const ask = root.querySelector<HTMLButtonElement>('[aria-label="Demander un montant pour Comparer les devis"]')!;
    expect(ask.disabled).toBe(false);
    expect(root.querySelector('a')?.getAttribute('href')).toBe('/app/gestion-projet/prj_1#enveloppe');
    ask.click();
    f.detectChanges();
    expect(root.querySelector('input[name="amount"]')).toBeTruthy();
  });

  it('explique pourquoi une demande préparée sans enveloppe ne peut pas encore être accordée', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const f = TestBed.createComponent(BpmTaskRequestsComponent);
    f.componentRef.setInput('requests', [{ ...request, coreProjectId: 'prj_1', budgetName: 'Cuisine', taskTitle: 'Comparer les devis' }]);
    f.componentRef.setInput('funded', false);
    f.detectChanges();
    const root: HTMLElement = f.nativeElement;
    const grant = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Accorder'))!;
    expect(grant.disabled).toBe(true);
    expect(root.textContent).toContain('Attribuez d’abord une enveloppe');
    expect([...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Refuser'))?.disabled).toBe(false);
  });

  it('renouvelle la clé dès la confirmation du POST, même avant la relecture du projet', () => {
    const f = TestBed.createComponent(BpmManagedTaskComponent);
    f.componentRef.setInput('task', task);
    f.componentRef.setInput('funded', true);
    f.detectChanges();
    const editor = f.componentInstance as unknown as { amount: string; submit(): void };
    const sent: TaskFundingSubmission[] = [];
    f.componentInstance.request.subscribe((input) => sent.push(input));
    editor.amount = '100';
    editor.submit();
    sent[0].onAccepted?.();
    editor.submit();
    expect(sent[1].requestKey).not.toBe(sent[0].requestKey);
  });

  it('conserve la clé pour une nouvelle tentative sans confirmation et la renouvelle après clôture', () => {
    const f = TestBed.createComponent(BpmManagedTaskComponent);
    f.componentRef.setInput('task', task);
    f.componentRef.setInput('funded', true);
    f.detectChanges();
    const editor = f.componentInstance as unknown as {
      amount: string;
      note: string;
      submit(): void;
    };
    const sent: TaskFundingSubmission[] = [];
    f.componentInstance.request.subscribe((input) => sent.push(input));
    editor.amount = '100';
    editor.note = 'Devis';
    editor.submit();
    editor.submit(); // aucune réponse : une nouvelle tentative doit rester rejouable
    expect(sent[1].requestKey).toBe(sent[0].requestKey);

    f.componentRef.setInput('task', { ...task, budget: { ...task.budget, request } });
    f.detectChanges();
    // Une demande refusée ou annulée n'apparaît plus parmi les demandes ouvertes.
    f.componentRef.setInput('task', { ...task, budget: { ...task.budget, request: null } });
    f.detectChanges();
    editor.submit();
    expect(sent[2].requestKey).not.toBe(sent[0].requestKey);
  });
});

describe('clés des demandes de montant depuis la fiche projet', () => {
  it('reconnaît la demande relue après une réponse perdue et permet de redemander après clôture', async () => {
    const calls: { requestKey: string }[] = [];
    let accepted = false;
    TestBed.configureTestingModule({
      providers: [
        { provide: Api, useValue: {} },
        {
          provide: BpmApi,
          useValue: {
            projectDetail: async () =>
              ({
                budget: null,
                requests: accepted ? [request] : [],
              }) as unknown as BpmProjectDetail,
            requestTaskBudget: async (_b: string, _t: string, input: { requestKey: string }) => {
              calls.push(input);
              accepted = true;
              throw new ApiError(504, { code: 'NETWORK', action: null, message: 'Réponse perdue' });
            },
          },
        },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: 'prj_1' })), fragment: of(null), queryParamMap: of(convertToParamMap({})) },
        },
      ],
    });
    TestBed.overrideComponent(BpmProjectPage, { set: { template: '' } });
    const page = TestBed.createComponent(BpmProjectPage).componentInstance as unknown as {
      requestBudget(
        budgetId: string,
        task: BpmTaskCard,
        controls: HTMLFormControlsCollection,
      ): Promise<unknown>;
    };
    const form = document.createElement('form');
    form.innerHTML = '<input name="amount" value="100"><input name="note" value="Devis">';
    await page.requestBudget('bud_1', task, form.elements);
    accepted = false; // la demande observée a ensuite été clôturée
    await page.requestBudget('bud_1', task, form.elements);
    expect(calls[1].requestKey).not.toBe(calls[0].requestKey);
  });

  it('réutilise la clé après un échec réseau, puis crée une nouvelle demande après un succès', async () => {
    const calls: { requestKey: string }[] = [];
    let failNext = true;
    const bpm = {
      projectDetail: async () => ({ budget: null }) as BpmProjectDetail,
      requestTaskBudget: async (
        _budgetId: string,
        _taskId: string,
        input: { requestKey: string },
      ) => {
        calls.push(input);
        if (failNext) {
          failNext = false;
          throw new ApiError(504, { code: 'NETWORK', action: null, message: 'Réponse perdue' });
        }
        return { request };
      },
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: Api, useValue: {} },
        { provide: BpmApi, useValue: bpm },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: 'prj_1' })), fragment: of(null), queryParamMap: of(convertToParamMap({})) },
        },
      ],
    });
    TestBed.overrideComponent(BpmProjectPage, { set: { template: '' } });
    const f = TestBed.createComponent(BpmProjectPage);
    const page = f.componentInstance as unknown as {
      requestBudget(
        budgetId: string,
        task: BpmTaskCard,
        controls: HTMLFormControlsCollection,
      ): Promise<unknown>;
    };
    const form = document.createElement('form');
    form.innerHTML = '<input name="amount" value="100"><input name="note" value="Devis">';
    await page.requestBudget('bud_1', task, form.elements);
    await page.requestBudget('bud_1', task, form.elements);
    expect(calls[1].requestKey).toBe(calls[0].requestKey);
    // La demande précédente a pu être refusée/annulée entre les deux soumissions.
    await page.requestBudget('bud_1', task, form.elements);
    expect(calls[2].requestKey).not.toBe(calls[0].requestKey);
  });
});
