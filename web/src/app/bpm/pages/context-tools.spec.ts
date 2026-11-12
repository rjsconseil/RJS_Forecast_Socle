import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Api, RecetteContext } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmActPage } from './act';
import { BpmPilotPage } from './pilot';
import { BpmSettings } from '../settings';

const context = {
  user: { id: 'tools-user', label: 'Test' },
  budgets: [],
  calculationDate: '2026-11-07',
  period: { key: '2026-11', label: 'Novembre' },
};
const figure = (valueCents: number | null) => ({
  valueCents,
  status: valueCents === null ? 'unavailable' : 'ok',
  unavailableReason: valueCents === null ? 'Stock inconnu' : null,
});
const summary = (expected = 20000) => ({
  context,
  closed: false,
  figures: {
    'bpm.soldeAttendu': figure(expected),
    'bpm.resultatPeriode': figure(10000),
    'bpm.patrimoineConstitue': figure(100000),
  },
});
const line = (id: string, plannedDate: string, extra = {}) => ({
  id,
  label: id,
  plannedDate,
  plannedCents: 10000,
  status: 'due',
  settled: false,
  direction: 'charge',
  ...extra,
});

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  TestBed.tick();
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('commandes contextuelles du bandeau BPM', () => {
  it('propose une échéance ouverte puis passe à la suivante après règlement', async () => {
    let lines = [
      line('réglée', '2026-10-01', { settled: true }),
      line('close', '2026-10-02', { status: 'unrealized' }),
      line('récente', '2026-11-07'),
      line('ancienne', '2026-11-02', { status: 'late' }),
    ];
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: BpmApi,
          useValue: { due: async () => ({ context, lines }), summary: async () => summary() },
        },
      ],
    });
    TestBed.overrideComponent(BpmActPage, { set: { template: '' } });
    TestBed.inject(RecetteContext).userId.set('tools-user');
    const fixture = TestBed.createComponent(BpmActPage);
    const page = fixture.componentInstance as any;
    await settle(fixture);
    expect(page.pending().map((item: any) => item.id)).toEqual(['ancienne', 'récente']);
    expect(page.focus().tone).toBe('warning');
    page.priorityId.set('ancienne');
    lines = lines.map((item) => (item.id === 'ancienne' ? { ...item, settled: true } : item));
    page.due.reload();
    await settle(fixture);
    expect(page.priority().id).toBe('récente');
    expect(page.dueCount()).toBe(1);
  });

  it('diagnostique le déficit et le plafond dépassé puis retire les alertes résolues', async () => {
    let currentSummary = summary(-2000);
    let rows = [{ ref: 'maison', label: 'Maison', capCents: 10000, marginCents: -3000 }];
    const bpm = {
      summary: async () => currentSummary,
      impact: async () => ({}),
      centers: async () => ({ rows }),
      incomes: async () => ({}),
      history: async () => ({ rows: [] }),
      directives: async () => ({ items: [] }),
      events: async () => ({ rows: [] }),
      budgetType: async () => ({ lines: [] }),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: BpmApi, useValue: { ...bpm, closures: async () => [] } },
        { provide: Api, useValue: {} },
      ],
    });
    TestBed.overrideComponent(BpmPilotPage, { set: { template: '' } });
    TestBed.inject(RecetteContext).userId.set('tools-user');
    const fixture = TestBed.createComponent(BpmPilotPage);
    const page = fixture.componentInstance as any;
    await settle(fixture);
    expect(page.analysisPoint().key).toBe('deficit');
    page.analysisKey.set('cap:maison');
    expect(page.analysisPoint().link).toEqual(['/argent/postes', 'maison']);
    expect(page.focus().detail).toContain('30');
    currentSummary = summary();
    rows = [];
    page.refreshAnalysis();
    await settle(fixture);
    expect(page.analysisPoints()).toEqual([]);
    expect(page.focus().tone).toBe('success');
  });

  it('isole les parties modifiées des réglages et conserve les autres saisies après un enregistrement', async () => {
    let dashboard = {
      cycle: { state: 'active', anchorDay: 1, startDate: '2026-11-01', revision: 1 },
      patrimoine: {
        id: 'pat',
        revision: 1,
        openingStock: 1000,
        openingDate: '2026-11-01',
        objective: null,
      },
    };
    const configureCycle = vi.fn(async (input: any) => {
      dashboard = {
        ...dashboard,
        cycle: { ...dashboard.cycle, anchorDay: input.anchorDay, revision: 2 },
      };
      return dashboard;
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: BpmApi,
          useValue: {
            summary: async () => summary(),
            dashboard: async () => dashboard,
            closures: async () => [],
            costCenters: async () => [],
            configureCycle,
          },
        },
        { provide: Api, useValue: {} },
      ],
    });
    TestBed.overrideComponent(BpmSettings, { set: { template: '' } });
    TestBed.inject(RecetteContext).userId.set('tools-user');
    const fixture = TestBed.createComponent(BpmSettings);
    const page = fixture.componentInstance as any;
    await settle(fixture);
    expect(page.cycleDirty()).toBe(false);
    expect(page.patDirty()).toBe(false);
    page.cAnchor.set('5');
    page.pStock.set('1250');
    expect(page.focus().title).toContain('2');
    await page.saveCycle();
    expect(configureCycle).toHaveBeenCalledWith({
      anchorDay: 5,
      startDate: '2026-11-01',
      expectedRevision: 1,
    });
    expect(page.cycleDirty()).toBe(false);
    expect(page.patDirty()).toBe(true);
    expect(page.pStock()).toBe('1250');
    page.resetPatrimoine();
    expect(page.pStock()).toBe('1000');
    expect(page.patDirty()).toBe(false);
  });
});
