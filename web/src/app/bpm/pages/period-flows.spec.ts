import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Api } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { RegisterLine } from '../../core/bpm-models';
import { BpmCenterPage } from './center';
import { BpmExpensesPage } from './expenses';
import { BpmIncomesPage } from './incomes';
import { settlementOutsideWindow } from './period-presentation';

const context = {
  user: { id: 'usr_review', label: 'Recette dates', userType: 'individual' },
  scope: 'principal',
  scopeLabel: 'Budget du projet de vie',
  budgets: [],
  period: {
    key: '2026-11',
    label: 'Novembre 2026',
    start: '2026-11-01',
    end: '2026-11-30',
    endExclusive: '2026-12-01',
  },
  periods: { firstKey: '2026-10', currentKey: '2026-11' },
  calculationDate: '2026-11-06',
  revision: 1,
  unit: 'EUR',
};
const line = (
  id: string,
  plannedDate: string,
  realizedDate: string | null,
  status = realizedDate ? 'settled' : 'pending',
) =>
  ({
    id,
    operationId: id,
    occurrenceKey: null,
    recurrenceId: null,
    label: id,
    kind: 'operation',
    plannedDate,
    realizedDate,
    settled: !!realizedDate,
    status,
    statusLabel:
      status === 'settled' ? 'Réglé' : status === 'unrealized' ? 'Non réalisé' : 'À venir',
    plannedCents: 15000,
    realizedCents: realizedDate ? 12000 : null,
    direction: 'charge',
    costCenterRef: 'std:loisirs',
    costCenterLabel: 'Loisirs',
    centerKnown: true,
    cadence: 'once',
    cadenceLabel: 'Ponctuelle',
    budgetRole: 'life',
    budgetId: 'bud_life',
    budgetName: 'Projet de vie',
    special: false,
    categoryId: null,
    categoryLabel: null,
    note: null,
    taskId: null,
    taskTitle: null,
  }) as RegisterLine;
const delayed = line('Paiement décalé depuis octobre', '2026-10-28', '2026-11-03');
const advanced = line('Achat de décembre payé en avance', '2026-12-15', '2026-11-05');
const historical = line('Achat de novembre réglé en octobre', '2026-11-15', '2026-10-30');
const pending = line('Échéance du mois', '2026-11-20', null);
const missed = line('Échéance non réalisée', '2026-10-20', null, 'unrealized');
const selection = 'Paiements selon leur date réelle ; échéances ouvertes selon leur date prévue.';
const totals = {
  lineCount: 1,
  unfilteredCount: 1,
  plannedCents: 15000,
  paidCents: 12000,
  toPayCents: 0,
  unrealizedCents: 0,
  specialCents: 0,
};

describe('lecture des dates des flux dans BPM', () => {
  let harness: RouterTestingHarness;
  let api: Record<string, ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<any>>>>;
  const text = () => harness.routeNativeElement!.textContent!;
  const section = (id: string) =>
    harness.routeNativeElement!.querySelector(`#${id}`)!.closest('section')!;
  async function settle() {
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
  }
  beforeEach(async () => {
    api = {
      center: vi.fn().mockResolvedValue({
        context,
        center: {
          ref: 'std:loisirs',
          label: 'Loisirs',
          standard: true,
          direction: 'charge',
          directionLabel: 'Charges',
          paidCents: 24000,
          remainingCents: 15000,
          sharePct: null,
          capCents: null,
          marginCents: null,
        },
        basis: {
          kind: 'spent',
          label: 'Paiements de la période',
          spentCents: 24000,
          receivedCents: 0,
          baseCents: 24000,
        },
        lines: [delayed, advanced, pending],
        settledLines: [delayed, advanced],
        pendingLines: [pending],
        unrealizedLines: [],
        selection,
        totals,
        cap: null,
        categories: [],
        lifeBudget: { budgetId: 'bud_life', revision: 1 },
      }),
      incomes: vi.fn().mockResolvedValue({
        context,
        receivedCents: 24000,
        expectedCents: 15000,
        lines: [delayed, advanced, pending],
        settledLines: [delayed, advanced],
        pendingLines: [pending],
        unrealizedLines: [],
        selection,
        sources: [],
      }),
      register: vi.fn().mockResolvedValue({
        context,
        window: { from: '2026-11-01', to: '2026-11-30', kind: 'period' },
        lines: [historical],
        groups: [{ key: 'std:loisirs', label: 'Loisirs', lineIds: [historical.id], ...totals }],
        totals,
        selection,
        caps: null,
      }),
      costCenters: vi.fn().mockResolvedValue([]),
      categories: vi.fn().mockResolvedValue([]),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'argent/postes/:poste', component: BpmCenterPage },
          { path: 'argent/entrees', component: BpmIncomesPage },
          { path: 'depenses', component: BpmExpensesPage },
        ]),
        { provide: BpmApi, useValue: api },
        { provide: Api, useValue: { tasks: vi.fn().mockResolvedValue([]) } },
      ],
    });
    harness = await RouterTestingHarness.create();
  });
  it('affiche dans un poste les règlements du mois même si leurs dates prévues sont hors du mois', async () => {
    await harness.navigateByUrl('/argent/postes/std:loisirs?period=2026-11', BpmCenterPage);
    await settle();
    const payments = section('bmd-entries-title').textContent!;
    expect(payments).toContain(delayed.label);
    expect(payments).toContain(advanced.label);
    expect(payments).not.toContain(historical.label);
    expect(payments).not.toContain(pending.label);
    expect(text()).toContain('240,00');
    expect(text()).toContain('en 2 montant(s)');
    expect(text()).toContain(selection);
    expect(api['center']).toHaveBeenCalledWith('std:loisirs', '2026-11');
  });
  it('sépare les non-réalisées des échéances encore à payer dans un poste', async () => {
    const response = await api['center']();
    api['center'].mockResolvedValue({
      ...response,
      lines: [missed],
      settledLines: [],
      pendingLines: [],
      unrealizedLines: [missed],
    });
    await harness.navigateByUrl('/argent/postes/std:loisirs?period=2026-10', BpmCenterPage);
    await settle();
    expect(section('bmd-unrealized-title').textContent).toContain(missed.label);
    expect(harness.routeNativeElement!.querySelector('#bmd-pending-title')).toBeNull();
    expect(text()).not.toContain('Encore prévu d’ici la fin de la période');
  });
  it('conserve le chemin de retour et la période après ouverture d’une source de revenus', async () => {
    await harness.navigateByUrl(
      '/argent/postes/std:loisirs?period=2026-10&from=entrees',
      BpmCenterPage,
    );
    await settle();
    const back = [...harness.routeNativeElement!.querySelectorAll('a')].find((a) =>
      a.textContent!.includes('Retour au détail des entrées'),
    )!;
    expect(back.getAttribute('href')).toBe('/argent/entrees?period=2026-10');
  });
  it('conserve le plafond saisi dans le bandeau après une relecture sans changement serveur', async () => {
    const page = await harness.navigateByUrl('/argent/postes/std:loisirs', BpmCenterPage);
    await settle();
    const input = harness.routeNativeElement!.querySelector<HTMLInputElement>('bpm-page-banner input[name="cap"]')!;
    input.value = '250';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    (page as any).read.reload();
    await settle();
    expect(input.value).toBe('250');
    expect((harness.routeNativeElement!.querySelector('bpm-page-banner button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  });
  it('les entrées affichent les montants réellement reçus et un compteur cohérent', async () => {
    await harness.navigateByUrl('/argent/entrees?period=2026-11', BpmIncomesPage);
    await settle();
    const received = section('bmd-entries-title').textContent!;
    expect(received).toContain(delayed.label);
    expect(received).toContain(advanced.label);
    expect(received).not.toContain(pending.label);
    expect(text()).toContain('en 2 montant(s)');
    expect(section('bmd-pending-title').textContent).toContain(pending.label);
  });
  it('le registre garde la date prévue et signale un paiement fait dans une autre période', async () => {
    await harness.navigateByUrl('/depenses?period=2026-11', BpmExpensesPage);
    await settle();
    expect(text()).toContain(historical.label);
    expect(text()).toContain('Réglé hors de cette période');
    expect(text()).toContain('le tableau de bord les compte à leur date réelle');
    const back = [...harness.routeNativeElement!.querySelectorAll('a')].find((a) =>
      a.textContent!.includes('Gestion du projet de vie'),
    )!;
    expect(back.getAttribute('href')).toBe('/projet-de-vie?period=2026-11');
  });
  it('ne fait pas quitter silencieusement le périmètre d’un projet par un lien de poste global', async () => {
    const response = await api['register']();
    api['register'].mockResolvedValue({ ...response, context: { ...context, scope: 'budget' } });
    await harness.navigateByUrl('/depenses?period=2026-11&budgetId=bud_project', BpmExpensesPage);
    await settle();
    expect(harness.routeNativeElement!.querySelector('.expense-group h2 a')).toBeNull();
    expect(harness.routeNativeElement!.querySelector('.expense-charge-summary')).not.toBeNull();
  });
  it('lit le détail du Dépensé selon les dates réelles et permet de revenir aux échéances prévues', async () => {
    const response = await api['register']();
    api['register'].mockResolvedValue({
      ...response,
      dateBasis: 'realized',
      lines: [advanced],
      groups: [{ ...response.groups[0], lineIds: [advanced.id] }],
    });
    await harness.navigateByUrl(
      '/depenses?period=2026-11&dateBasis=realized&status=settled',
      BpmExpensesPage,
    );
    await settle();
    expect(api['register']).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateBasis: 'realized', status: 'settled', period: '2026-11' }),
    );
    expect(text()).toContain('Règlements sélectionnés par date réelle');
    expect(text()).toContain('Date de règlement');
    expect(
      (
        harness.routeNativeElement!.querySelector(
          'select[name="expense-status"]',
        ) as HTMLSelectElement
      ).value,
    ).toBe('settled');
    expect(text()).not.toContain('Les totaux suivent vos filtres et les dates prévues.');
    const selector = harness.routeNativeElement!.querySelector(
      'select[name="expense-date-basis"]',
    ) as HTMLSelectElement;
    expect(selector.value).toBe('realized');
    selector.value = 'planned';
    selector.dispatchEvent(new Event('change'));
    await settle();
    expect(api['register']).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateBasis: 'planned' }),
    );
    expect(api['register'].mock.lastCall![0]).not.toEqual(
      expect.objectContaining({ status: expect.any(String) }),
    );
  });
});

describe('repère de paiement hors période (affichage uniquement)', () => {
  const window = { from: '2026-11-01', to: '2026-11-30' };
  it('compare uniquement la date réelle, avec bornes inclusives', () => {
    expect(settlementOutsideWindow(historical, window)).toBe(true);
    expect(settlementOutsideWindow(delayed, window)).toBe(false);
    expect(settlementOutsideWindow(advanced, window)).toBe(false);
    expect(settlementOutsideWindow(line('début', '2026-10-01', '2026-11-01'), window)).toBe(false);
    expect(settlementOutsideWindow(line('fin', '2026-12-01', '2026-11-30'), window)).toBe(false);
    expect(settlementOutsideWindow(line('après', '2026-11-01', '2026-12-01'), window)).toBe(true);
  });
  it('ne transforme jamais une absence de règlement ou de contexte en dépassement', () => {
    expect(settlementOutsideWindow(pending, window)).toBe(false);
    expect(settlementOutsideWindow(historical, null)).toBe(false);
  });
});
