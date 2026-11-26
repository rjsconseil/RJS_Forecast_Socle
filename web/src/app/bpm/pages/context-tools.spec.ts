import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Api, RecetteContext } from '../../core/api.service';
import { BpmApi } from '../data/bpm-api.service';
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
