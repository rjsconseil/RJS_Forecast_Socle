import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Api, ApiError } from '../../core/api.service';
import { BpmApi } from '../data/bpm-api.service';
import { BpmProjectDetail, BpmTaskCard, TaskBudgetRequest } from '../data/bpm-projects.models';
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
