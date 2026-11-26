import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Api } from '../../core/api.service';
import { BpmApi } from '../data/bpm-api.service';
import { RegisterLine } from '../data/bpm-models';
import { BpmCenterPage } from './center';
import { BpmExpensesPage } from './expenses';
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
        levels: { mid: 50, high: 75, near: 90 },
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
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'argent/postes/:poste', component: BpmCenterPage },
          { path: 'depenses/registre', component: BpmExpensesPage, data: {workspace:{key:'register',title:'Registre de flux',parent:'/tableau-de-bord'}} },
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
      a.textContent!.includes('Registre de flux'),
    )!;
    expect(back.getAttribute('href')).toBe('/tableau-de-bord/entrees?period=2026-10');
  });
  it('ouvre la fenêtre du plafond du poste depuis ses actions et n’écrit que ce poste', async () => {
    const base = await api['center']();
    const cap = { ref: 'std:loisirs', label: 'Loisirs', standard: true, paidCents: 24000, toPayCents: 15000, engagedCents: 39000, capCents: null, marginCents: null, usedPct: null, over: false, near: false, level: 'none', lineCount: 3 };
    api['center'].mockResolvedValue({ ...base, cap });
    api['setCaps'] = vi.fn().mockResolvedValue({});
    await harness.navigateByUrl('/argent/postes/std:loisirs', BpmCenterPage);
    await settle();
    const open = [...harness.routeNativeElement!.querySelectorAll<HTMLButtonElement>('rjs-page-banner button')].find((x) => x.textContent!.trim() === 'Fixer un plafond')!;
    open.click();
    await settle();
    const dialog = harness.routeNativeElement!.querySelector<HTMLElement>('bpm-cap-dialog')!;
    expect(dialog.textContent).toContain('390,00');
    const input = dialog.querySelector<HTMLInputElement>('input[name="capAmount"]')!;
    input.value = '500';
    input.dispatchEvent(new Event('input'));
    await settle();
    [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent!.trim() === 'Enregistrer le plafond')!.click();
    await settle();
    expect(api['setCaps']).toHaveBeenCalledExactlyOnceWith({ expectedRevision: 1, caps: { 'std:loisirs': 500 }, merge: true });
    expect(harness.routeNativeElement!.querySelector('bpm-cap-dialog')).toBeNull();
  });
  it('le registre garde la date prévue et signale un paiement fait dans une autre période', async () => {
    await harness.navigateByUrl('/depenses/registre?period=2026-11', BpmExpensesPage);
    await settle();
    expect(text()).toContain(historical.label);
    expect(text()).toContain('Réglé hors de cette période');
    expect(text()).toContain('le tableau de bord les compte à leur date réelle');
  });
  it('ne fait pas quitter silencieusement le périmètre d’un projet par un lien de poste global', async () => {
    const response = await api['register']();
    api['register'].mockResolvedValue({ ...response, context: { ...context, scope: 'budget' } });
    await harness.navigateByUrl('/depenses/registre?period=2026-11&budgetId=bud_project', BpmExpensesPage);
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
      '/depenses/registre?period=2026-11&dateBasis=realized&status=settled',
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
  it('distingue les entrées et dépenses pour les bilans positifs, négatifs et équilibrés des groupes', async () => {
    const flow = (id: string, direction: RegisterLine['direction'], plannedCents: number, realizedCents: number | null, status?: string): RegisterLine => ({
      ...line(id, '2026-11-20', realizedCents === null ? null : '2026-11-05', status),
      direction, plannedCents, realizedCents,
    });
    const mixed = [
      flow('Salaire reçu', 'income', 20000, 18000),
      flow('Remboursement attendu', 'income', 5000, null),
      flow('Achat réglé', 'charge', 9000, 10000),
      flow('Facture en retard', 'charge', 4000, null, 'late'),
      flow('Facture du jour', 'charge', 3000, null, 'due'),
      flow('Achat à venir', 'charge', 2000, null),
    ];
    const negative = [{ ...flow('Dépense seule', 'charge', 12000, null), costCenterRef: 'std:logement' }];
    const balanced = [
      { ...flow('Gain attendu', 'income', 8000, null), costCenterRef: 'std:transport' },
      { ...flow('Frais attendus', 'charge', 8000, null), costCenterRef: 'std:transport' },
    ];
    const response = await api['register']();
    api['register'].mockResolvedValue({
      ...response,
      lines: [...mixed, ...negative, ...balanced],
      groups: [
        { key: 'std:loisirs', label: 'Loisirs', lineIds: mixed.map(l => l.id), plannedCents: 43000, paidCents: 28000, toPayCents: 14000, specialCents: 0 },
        { key: 'std:logement', label: 'Logement', lineIds: negative.map(l => l.id), plannedCents: 12000, paidCents: 0, toPayCents: 12000, specialCents: 0 },
        { key: 'std:transport', label: 'Transport', lineIds: balanced.map(l => l.id), plannedCents: 16000, paidCents: 0, toPayCents: 16000, specialCents: 0 },
      ],
      totals: { ...totals, lineCount: 9, unfilteredCount: 9, plannedCents: 71000, paidCents: 28000, toPayCents: 42000 },
    });
    const page = await harness.navigateByUrl('/depenses/registre?period=2026-11', BpmExpensesPage);
    await settle();
    const summaries = (page as any).groupSummaries();
    expect(summaries.get('std:loisirs')).toMatchObject({
      income: { plannedCents: 25000, settledCents: 18000, openCents: 5000 },
      charge: { plannedCents: 18000, settledCents: 10000, openCents: 9000 },
      balanceCents: 7000, tone: 'pos',
    });
    expect(summaries.get('std:logement')).toMatchObject({ balanceCents: -12000, tone: 'neg' });
    expect(summaries.get('std:transport')).toMatchObject({ balanceCents: 0, tone: 'zero' });
    expect(harness.routeNativeElement!.querySelectorAll('details.expense-group[open]')).toHaveLength(0);
  });
  it('change le bilan selon la date lue, exclut les réservations et garde un règlement inconnu distinct de zéro', async () => {
    const flow = (id: string, direction: RegisterLine['direction'], plannedCents: number, realizedCents: number | null, status?: string): RegisterLine => ({
      ...line(id, '2026-11-20', realizedCents === null ? null : '2026-11-05', status),
      direction, plannedCents, realizedCents,
    });
    const mixed = [
      flow('Revenu reçu', 'income', 50000, 30000),
      flow('Dépense payée', 'charge', 20000, 35000),
      flow('Revenu attendu', 'income', 10000, null),
      flow('Dépense en retard', 'charge', 5000, null, 'late'),
      flow('Revenu non réalisé', 'income', 7000, null, 'unrealized'),
      flow('Dépense non réalisée', 'charge', 3000, null, 'unrealized'),
      { ...flow('Réservation entrante', 'income', 900000, 900000), special: true },
      { ...flow('Enveloppe réservée', 'charge', 800000, 800000), special: true },
    ];
    const unknown = [
      { ...flow('Revenu connu', 'income', 15000, 10000), costCenterRef: 'std:transport' },
      { ...flow('Règlement sans montant réel', 'charge', 11000, null), costCenterRef: 'std:transport', settled: true, status: 'settled', statusLabel: 'Réglé', realizedDate: '2026-11-05' },
    ];
    const response = await api['register']();
    api['register'].mockImplementation(async (...args: unknown[]) => {
      const query = args[0] as { dateBasis?: string };
      return ({
      ...response,
      dateBasis: query.dateBasis,
      lines: [...mixed, ...unknown].filter(l => query.dateBasis !== 'realized' || l.settled),
      groups: [
        { key: 'std:loisirs', label: 'Loisirs', lineIds: mixed.filter(l => query.dateBasis !== 'realized' || l.settled).map(l => l.id), plannedCents: query.dateBasis === 'realized' ? 70000 : 95000, paidCents: 65000, toPayCents: query.dateBasis === 'realized' ? 0 : 15000, specialCents: 1700000 },
        { key: 'std:transport', label: 'Transport', lineIds: unknown.map(l => l.id), plannedCents: 26000, paidCents: 10000, toPayCents: 0, specialCents: 0 },
      ],
      totals: { ...totals, lineCount: query.dateBasis === 'realized' ? 6 : 10, unfilteredCount: 10, plannedCents: query.dateBasis === 'realized' ? 96000 : 121000, paidCents: 75000, toPayCents: query.dateBasis === 'realized' ? 0 : 15000, unrealizedCents: query.dateBasis === 'realized' ? 0 : 10000, specialCents: 1700000 },
      });
    });
    const page = await harness.navigateByUrl('/depenses/registre?period=2026-11', BpmExpensesPage);
    await settle();
    expect((page as any).groupSummaries().get('std:loisirs')).toMatchObject({
      income: { plannedCents: 67000, settledCents: 30000, openCents: 10000 },
      charge: { plannedCents: 28000, settledCents: 35000, openCents: 5000 },
      balanceCents: 39000, tone: 'pos',
    });
    expect((page as any).groupSummaries().get('std:transport')).toMatchObject({ balanceCents: 4000, tone: 'pos' });
    const dateBasis = harness.routeNativeElement!.querySelector<HTMLSelectElement>('select[name="expense-date-basis"]')!;
    dateBasis.value = 'realized';
    dateBasis.dispatchEvent(new Event('change'));
    await settle();
    expect((page as any).groupSummaries().get('std:loisirs')).toMatchObject({
      income: { settledCents: 30000, openCents: 0 },
      charge: { settledCents: 35000, openCents: 0 },
      balanceCents: -5000, tone: 'neg',
    });
    expect((page as any).groupSummaries().get('std:transport')).toMatchObject({
      income: { settledCents: 10000 },
      charge: { settledCents: null },
      balanceCents: null, tone: 'unknown',
    });
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
