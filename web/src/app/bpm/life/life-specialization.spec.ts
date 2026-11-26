import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Api, RecetteContext } from '../../core/api.service';
import { BpmApi } from '../data/bpm-api.service';
import { BpmLifeManagementPage } from './life-management.page';

const context = {
  user: { id: 'life-workspace-test', label: 'Profil test' },
  budgets: [{ id: 'budget-life', role: 'life', name: 'Budget de vie' }],
  period: { key: '2026-11', label: 'Novembre', start: '2026-11-01', end: '2026-11-30', endExclusive: '2026-12-01' },
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
    [...dom().querySelectorAll<HTMLButtonElement>('rjs-page-banner button')].find(button => button.textContent?.trim().startsWith(label))!.click();
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
        { path: 'projet-de-vie/financement', component: BpmLifeManagementPage, data: { workspace: { key: 'life-funding', parent: '/projet-de-vie', title: 'Projets et décisions', lead: 'Financer les projets.' } } },
        { path: 'projet-de-vie/echeances', component: BpmLifeManagementPage, data: { workspace: { key: 'life-due', parent: '/projet-de-vie', title: 'Échéances à traiter', lead: 'Régler les échéances.' } } },
        { path: 'projet-de-vie/budget-type', component: BpmLifeManagementPage, data: { workspace: { key: 'life-budget', parent: '/projet-de-vie', title: 'Budget type', lead: 'Préparer les prochaines périodes.' } } },
      ]),
      { provide: BpmApi, useValue: { projectFlows: async () => null, financialOutlook: async () => null, ...bpm, closePeriod: api.closePeriod } }, { provide: Api, useValue: {} },
    ] });
    TestBed.inject(RecetteContext).select('life-workspace-test', { remember: false });
    harness = await RouterTestingHarness.create();
  });

  it('commande le budget type depuis le bandeau et retrouve le brouillon après un détour', async () => {
    await harness.navigateByUrl('/projet-de-vie/budget-type?period=2026-11');
    await settle();
    expect(dom().querySelector('.life-summary')).toBeNull();
    expect(dom().querySelector('.bpm-management-grid')).toBeNull();
    expect(dom().querySelectorAll('bpm-act-budget-type')).toHaveLength(1);
    await click('＋ Entrée récurrente');
    const label = dom().querySelector<HTMLInputElement>('[aria-label="Libellé de la nouvelle ligne"]')!;
    label.value = 'Salaire préparé'; label.dispatchEvent(new Event('input'));
    await settle();
    expect(dom().querySelector('.page-toolbar-primary')!.textContent).toContain('Enregistrer tout');
    await harness.navigateByUrl('/projet-de-vie/echeances');
    await settle();
    await harness.navigateByUrl('/projet-de-vie/budget-type');
    await settle();
    expect(dom().querySelector<HTMLInputElement>('[aria-label="Libellé de la nouvelle ligne"]')!.value).toBe('Salaire préparé');
    expect(api.closePeriod).not.toHaveBeenCalled();
  });

  it('isole le financement et les échéances sans dupliquer les six cadres', async () => {
    await harness.navigateByUrl('/projet-de-vie/financement?period=2026-11');
    await settle();
    expect(dom().querySelector('#life-funding')).not.toBeNull();
    expect(dom().querySelector('#life-due')).toBeNull();
    expect(dom().querySelector('.bpm-management-grid')).toBeNull();
    expect(dom().textContent).toContain('Aucun projet de la vie');
    await harness.navigateByUrl('/projet-de-vie/echeances?period=2026-11');
    await settle();
    expect(dom().querySelector('#life-due')).not.toBeNull();
    expect(dom().querySelector('#life-funding')).toBeNull();
    expect(dom().textContent).toContain('Aucune échéance ouverte');
    expect(bpm.lifeManagement).toHaveBeenCalledWith('2026-11');
    expect(api.closePeriod).not.toHaveBeenCalled();
  });

  it('filtre les échéances sans mélanger les entrées et dépenses ni perdre la période consultée', async () => {
    const dueLines = [
      { id: 'charge-next', label: 'Matériel', direction: 'charge', plannedDate: '2026-11-10', plannedCents: 14500, status: 'pending', statusLabel: 'À venir', settled: false, costCenterLabel: 'Équipement', project: { name: 'Atelier', taskTitle: 'Installer', coreProjectId: 'atelier', funded: true } },
      { id: 'income-late', label: 'Salaire', direction: 'income', plannedDate: '2026-11-04', plannedCents: 240000, status: 'late', statusLabel: 'En retard', settled: false },
      { id: 'charge-late', label: 'Loyer', direction: 'charge', plannedDate: '2026-11-02', plannedCents: 78000, status: 'late', statusLabel: 'En retard', settled: false },
    ];
    bpm.lifeManagement.mockResolvedValue({ ...life, dueSoon: { from: '2026-11-01', to: '2026-11-14', lateCount: 2, lines: dueLines } });
    await harness.navigateByUrl('/projet-de-vie/echeances?period=2026-10&due=charge');
    await settle();
    const rows = () => [...dom().querySelectorAll('.life-line-table tbody tr')];
    expect(rows().map(row => row.querySelector('th')?.textContent?.trim())).toEqual(['Loyer', 'Matériel']);
    expect(dueLines[0].id).toBe('charge-next'); // Le tri du cockpit ne réordonne pas la réponse métier.
    expect(dom().querySelector('.life-due-filters button[aria-pressed="true"]')!.textContent).toContain('925');
    expect(dom().querySelector('[aria-label="Marquer payée aujourd’hui : Loyer"]')).not.toBeNull();
    const search = dom().querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'atelier'; search.dispatchEvent(new Event('input')); await settle();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain('Matériel');
    search.value = 'inexistant'; search.dispatchEvent(new Event('input')); await settle();
    expect(dom().textContent).toContain('Aucune échéance ne correspond à ces filtres.');
    [...dom().querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Tout afficher')!.click();
    await settle();
    expect(rows().map(row => row.querySelector('th')?.textContent?.trim())).toEqual(['Loyer', 'Salaire', 'Matériel']);
    const lateFilter = [...dom().querySelectorAll<HTMLButtonElement>('.life-due-filters button')].find(button => button.textContent?.includes('En retard'))!;
    lateFilter.click(); await settle();
    expect(rows()).toHaveLength(2);
    expect(TestBed.inject(Router).url).toContain('period=2026-10');
    expect(TestBed.inject(Router).url).toContain('due=late');
    expect(api.closePeriod).not.toHaveBeenCalled();
  });

  it('ouvre directement l’attribution d’une enveloppe et présente les déficits avant les projets sans financement', async () => {
    bpm.lifeManagement.mockResolvedValue({ ...life, projects: { ...life.projects, projectCount: 2, funding: null, billable: [{ id: 'legacy-authorization' }], billableCents: 8000, projects: [
      { budgetId: 'new-budget', coreProjectId: 'voyage', name: 'Voyage', state: 'unallocated', remainingCents: null },
      { budgetId: 'risk-budget', coreProjectId: 'travaux', name: 'Travaux', state: 'deficit', remainingCents: -8000 },
    ] } });
    await harness.navigateByUrl('/projet-de-vie/financement?period=2026-11');
    await settle();
    const projects = [...dom().querySelectorAll('.life-funding-actions article')];
    expect(projects.map(project => project.querySelector('h3')!.textContent)).toEqual(['Travaux', 'Voyage']);
    expect(projects[1].querySelector('a')!.getAttribute('href')).toContain('/app/gestion-projet/voyage?lifePeriod=2026-11#enveloppe');
    expect(projects[0].querySelector('a')!.getAttribute('href')).toContain('#budget-title');
    expect(dom().querySelector('.life-billing-action')).toBeNull();
    expect([...dom().querySelectorAll('button')].some(button => /facturer|Intégrer au budget de vie/i.test(button.textContent ?? ''))).toBe(false);
    expect(dom().textContent).toContain('sans créer de charge');
  });

});
