import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Api, RecetteContext } from '../core/api.service';
import { BpmApi } from '../core/bpm-api.service';
import { BpmSettings } from './settings';

const initial = () => ({
  cycle: { state: 'active', anchorDay: 1, startDate: '2026-11-01', revision: 4 },
  patrimoine: { id: 'pat', openingStock: 1000, openingDate: '2026-11-01', objective: null, revision: 3 },
});

describe('réglages BPM spécialisés', () => {
  let harness: RouterTestingHarness;
  let dashboard: ReturnType<typeof initial>;
  let api: Record<string, ReturnType<typeof vi.fn>>;
  const dom = () => harness.routeNativeElement!;
  async function settle() { harness.detectChanges(); await harness.fixture.whenStable(); harness.detectChanges(); }
  beforeEach(async () => {
    sessionStorage.clear();
    dashboard = initial();
    api = {
      dashboard: vi.fn(async () => dashboard),
      closures: vi.fn(async () => []), bpmCostCenters: vi.fn(async () => []),
      configureCycle: vi.fn(async (body) => { dashboard = { ...dashboard, cycle: { ...dashboard.cycle, anchorDay: body.anchorDay, revision: 5 } }; return dashboard; }),
      updateBpmPatrimoine: vi.fn(async (body) => { dashboard = { ...dashboard, patrimoine: { ...dashboard.patrimoine, openingStock: body.openingStock, revision: 4 } }; }),
      addCostCenter: vi.fn(async () => ({ costCenters: [{ ref: 'personal', standard: false, label: 'Honoraires', direction: 'income', directionLabel: 'Revenus' }] })),
    };
    const context = { user: { label: 'Profil test' }, budgets: [], period: null, calculationDate: '2026-11-07' };
    TestBed.configureTestingModule({ providers: [
      provideRouter([
        { path: 'app/reglages', component: BpmSettings },
        { path: 'app/reglages/cycle', component: BpmSettings, data: { workspace: { key: 'settings-cycle', parent: '/app/reglages', title: 'Cycle et clôtures', lead: 'Configurer les périodes.' } } },
        { path: 'app/reglages/patrimoine', component: BpmSettings, data: { workspace: { key: 'settings-wealth', parent: '/app/reglages', title: 'Point de départ du patrimoine', lead: 'Définir le stock initial.' } } },
        { path: 'app/reglages/postes', component: BpmSettings, data: { workspace: { key: 'settings-centers', parent: '/app/reglages', title: 'Postes et revenus', lead: 'Organiser les saisies.' } } },
      ]),
      { provide: Api, useValue: api }, { provide: BpmApi, useValue: { summary: async () => ({ context }) } },
    ] });
    TestBed.inject(RecetteContext).select('settings-specialized-test', { remember: false });
    harness = await RouterTestingHarness.create();
  });

  it.each([
    ['cycle', ['.bc-hero', '.bc-history'], ['.bc-wealth', '.bc-centers']],
    ['patrimoine', ['.bc-wealth'], ['.bc-hero', '.bc-history', '.bc-centers']],
    ['postes', ['.bc-centers'], ['.bc-hero', '.bc-history', '.bc-wealth']],
  ])('isole le travail de la sous-page %s', async (path, visible, absent) => {
    await harness.navigateByUrl(`/app/reglages/${path}`);
    await settle();
    for (const selector of visible) expect(dom().querySelector(selector)).toBeTruthy();
    for (const selector of absent) expect(dom().querySelector(selector)).toBeNull();
    expect(api['configureCycle']).not.toHaveBeenCalled();
    expect(api['updateBpmPatrimoine']).not.toHaveBeenCalled();
  });

  it('enregistre le patrimoine depuis sa vue sans proposer une saisie cachée du cycle', async () => {
    const page = await harness.navigateByUrl('/app/reglages/patrimoine', BpmSettings) as any;
    await settle();
    page.cAnchor.set('5');
    page.pStock.set('1250');
    await settle();
    expect(dom().querySelector('.bpm-toolbar-primary')!.textContent).toContain('Enregistrer le patrimoine');
    expect(dom().querySelector('.bpm-toolbar-primary')!.textContent).not.toContain('Enregistrer le cycle');
    dom().querySelector('#bpm-wealth-settings')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(api['updateBpmPatrimoine']).toHaveBeenCalledWith({ expectedRevision: 3, openingStock: 1250, openingDate: '2026-11-01', objective: null });
    expect(api['configureCycle']).not.toHaveBeenCalled();
    expect(page.cAnchor()).toBe('5');
  });

  it('retrouve le brouillon du patrimoine après un passage par les postes', async () => {
    const page = await harness.navigateByUrl('/app/reglages/patrimoine', BpmSettings) as any;
    await settle();
    page.pStock.set('1750');
    await harness.navigateByUrl('/app/reglages/postes');
    await settle();
    await harness.navigateByUrl('/app/reglages/patrimoine');
    await settle();
    expect(dom().querySelector<HTMLInputElement>('#bpm-wealth-settings input')!.value).toBe('1750');
    expect(dom().querySelector('.bpm-toolbar-primary')!.textContent).toContain('Enregistrer le patrimoine');
    expect(api['updateBpmPatrimoine']).not.toHaveBeenCalled();
  });

  it('ajoute une source personnelle dans la vue Postes avec la commande métier existante', async () => {
    const page = await harness.navigateByUrl('/app/reglages/postes', BpmSettings) as any;
    await settle();
    page.ccLabel.set('Honoraires'); page.ccDirection.set('income');
    await settle();
    expect(dom().querySelector('.bpm-toolbar-primary')!.textContent).toContain('Ajouter « Honoraires »');
    dom().querySelector('#bpm-center-settings')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(api['addCostCenter']).toHaveBeenCalledWith({ requestKey: expect.any(String), label: 'Honoraires', direction: 'income' });
    expect(dom().querySelector('.bc-centers')!.textContent).toContain('Honoraires');
  });
});
