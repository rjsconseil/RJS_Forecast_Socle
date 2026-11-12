import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Api, RecetteContext } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmLifeManagementPage } from './life-management.page';

const context = {
  user: { id: 'life-workspace-test', label: 'Profil test' },
  budgets: [{ id: 'budget-life', role: 'life', name: 'Budget de vie' }],
  period: { key: '2026-11', label: 'Novembre', start: '2026-11-01', endExclusive: '2026-12-01' },
  scope: 'principal', calculationDate: '2026-11-07',
};
const preview = {
  periodKey: '2026-10', periodLabel: 'Octobre', resultCents: 25000,
  stockBefore: 1000, stockAfter: 1250, capitalizationDate: '2026-11-01', conditions: ['Le cycle est terminé.'],
};
const life = {
  context,
  lifeProject: { title: 'Projet de vie', coreProjectId: 'life' },
  pilot: { volets: [], counts: { ok: 0, alert: 0, watch: 0, unknown: 0 } },
  cycle: { status: 'active', period: context.period, reading: 'current', flows: { netCents: 25000, expectedCents: 25000 } },
  patrimoine: { stockCents: 100000 },
  results: { toCloseCount: 1, closing: { possible: true, preview } },
  projects: { projects: [], pendingRequests: [], taskRequestCount: 0, billable: [] },
  dueSoon: { lines: [], lateCount: 0 },
  natures: { indispensable: { overCount: 0 }, courante: { overCount: 0 } },
};

describe('vues spécialisées du projet de vie', () => {
  let harness: RouterTestingHarness;
  let api: { closePeriod: ReturnType<typeof vi.fn> };
  let bpm: { lifeManagement: ReturnType<typeof vi.fn>; budgetType: ReturnType<typeof vi.fn>; costCenters: ReturnType<typeof vi.fn> };
  const dom = () => harness.routeNativeElement!;
  async function settle() { harness.detectChanges(); await harness.fixture.whenStable(); harness.detectChanges(); }
  async function click(label: string) {
    [...dom().querySelectorAll<HTMLButtonElement>('bpm-page-banner button')].find(button => button.textContent?.trim().startsWith(label))!.click();
    await settle();
  }
  beforeEach(async () => {
    sessionStorage.clear();
    api = { closePeriod: vi.fn().mockResolvedValue({ closure: { periodLabel: 'Octobre', result: 250 } }) };
    bpm = {
      lifeManagement: vi.fn().mockResolvedValue(life),
      budgetType: vi.fn().mockResolvedValue({ context, label: 'Mensuel', lines: [], averageIncomeCents: 0, averageChargeCents: 0, averageNetCents: 0 }),
      costCenters: vi.fn().mockResolvedValue([{ ref: 'std:salaire', direction: 'income', label: 'Salaire' }, { ref: 'std:logement', direction: 'charge', label: 'Logement' }]),
    };
    TestBed.configureTestingModule({ providers: [
      provideRouter([
        { path: 'projet-de-vie/budget-type', component: BpmLifeManagementPage, data: { workspace: { key: 'life-budget', parent: '/projet-de-vie', title: 'Budget type', lead: 'Préparer les prochaines périodes.' } } },
        { path: 'projet-de-vie/cloture', component: BpmLifeManagementPage, data: { workspace: { key: 'life-closing', parent: '/projet-de-vie', title: 'Clôture', lead: 'Relire et capitaliser le résultat.' } } },
      ]),
      { provide: BpmApi, useValue: { ...bpm, closePeriod: api.closePeriod } }, { provide: Api, useValue: {} },
    ] });
    TestBed.inject(RecetteContext).select('life-workspace-test', { remember: false });
    harness = await RouterTestingHarness.create();
  });

  it('commande le budget type depuis le bandeau et retrouve le brouillon après la clôture', async () => {
    await harness.navigateByUrl('/projet-de-vie/budget-type?period=2026-11');
    await settle();
    expect(dom().querySelector('.life-summary')).toBeNull();
    expect(dom().querySelector('.bpm-management-grid')).toBeNull();
    expect(dom().querySelectorAll('bpm-act-budget-type')).toHaveLength(1);
    await click('＋ Entrée récurrente');
    const label = dom().querySelector<HTMLInputElement>('[aria-label="Libellé de la nouvelle ligne"]')!;
    label.value = 'Salaire préparé'; label.dispatchEvent(new Event('input'));
    await settle();
    expect(dom().querySelector('.bpm-toolbar-primary')!.textContent).toContain('Enregistrer le budget type');
    await harness.navigateByUrl('/projet-de-vie/cloture');
    await settle();
    await harness.navigateByUrl('/projet-de-vie/budget-type');
    await settle();
    expect(dom().querySelector<HTMLInputElement>('[aria-label="Libellé de la nouvelle ligne"]')!.value).toBe('Salaire préparé');
    expect(api.closePeriod).not.toHaveBeenCalled();
  });

  it('montre l’aperçu de clôture dans la page et utilise la même commande métier', async () => {
    await harness.navigateByUrl('/projet-de-vie/cloture?period=2026-11');
    await settle();
    expect(dom().querySelector('dialog[open]')).toBeNull();
    expect(dom().querySelector('bpm-act-budget-type')).toBeNull();
    expect(dom().textContent).toContain('Le cycle est terminé.');
    expect(api.closePeriod).not.toHaveBeenCalled();
    await click('Clôturer Octobre');
    expect(api.closePeriod).toHaveBeenCalledWith({ requestKey: expect.any(String), periodKey: '2026-10', expectedResultCents: 25000 });
  });
});
