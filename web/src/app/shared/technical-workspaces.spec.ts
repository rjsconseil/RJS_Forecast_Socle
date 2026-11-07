import { signal, Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Api, ApiError, RecetteContext, UserDirectory } from '../core/api.service';
import { BudgetTest } from '../middleware/budget-test';
import { PatrimoineTest } from '../middleware/patrimoine-test';
import { AdminPage } from '../admin/admin';
import { AdminMetrics } from '../admin/metrics';
import { ObjectManagement } from '../object-management/object-management';
import { BpmOnboarding } from '../bpm/onboarding';

const budget = (id: string) => ({ id, name: id, role: 'life', coreProjectId: 'project', operationCount: 0, realizedCount: 0, revision: 1 });
const patrimoine = {
  patrimoine: { id: 'pat-1', label: 'Mon patrimoine', revision: 3, openingStock: 100, openingDate: '2026-11-01', objective: null },
  capitalizations: [{ id: 'cap-1', label: 'Clôture octobre', date: '2026-10-31', amount: 20, amountCents: 2000, revision: 1, source: null }],
  raw: { openingStock: 100, capitalized: 20 },
};

function setup(component: Type<unknown>, key: string, parent: string, api: object) {
  const users = signal([{ id: 'user-1', label: 'Camille', userType: 'person', userTypeLabel: 'Particulier' }]);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'workspace', component, data: { workspace: { key, parent, title: 'Travail spécialisé', lead: 'Une action précise dans son contexte.' } } }]),
      { provide: Api, useValue: api },
      { provide: RecetteContext, useValue: { userId: signal('user-1'), select: vi.fn() } },
      { provide: UserDirectory, useValue: { users, refresh: async () => undefined } },
    ],
  });
}

async function ready(harness: RouterTestingHarness) {
  harness.detectChanges();
  TestBed.tick();
  await harness.fixture.whenStable();
  harness.detectChanges();
  return harness.routeNativeElement as HTMLElement;
}

describe('vues techniques spécialisées', () => {
  it('reprend le Budget demandé et permet de saisir sans afficher les panneaux de diagnostic ni les centres', async () => {
    const readBudget = vi.fn(async (id: string) => ({ budget: budget(id), operations: [] }));
    setup(BudgetTest, 'budget-operations', '/socle/budget', {
      budgets: async () => [budget('budget-a'), budget('budget-b')], budgetCostCenters: async () => [], budget: readBudget,
    });
    const harness = await RouterTestingHarness.create('/workspace?budget=budget-b');
    const dom = await ready(harness);
    expect(readBudget).toHaveBeenCalledWith('budget-b');
    expect(dom.querySelector('#budget-test-create-title')).not.toBeNull();
    expect(dom.querySelector('#budget-test-centers-title')).toBeNull();
    expect(dom.querySelector('#budget-test-list-title')).toBeNull();
    expect(dom.querySelector<HTMLSelectElement>('.bw-manager-config select')?.value).toBe('budget-b');
    expect(dom.querySelector('.bpm-toolbar-primary')?.textContent).toContain('Créer l’opération saisie');
    dom.querySelector<HTMLButtonElement>('.bpm-toolbar-primary button')!.click();
    await ready(harness);
    expect(dom.querySelector('.page-toolbar-result')?.textContent).toContain('Montant en euros attendu');
  });

  it('isole les centres de coût et leur sens sans proposer de création d’opération', async () => {
    setup(BudgetTest, 'budget-centers', '/socle/budget', {
      budgets: async () => [], budgetCostCenters: async () => [{ ref: 'maison', label: 'Maison', direction: 'charge', standard: true }],
    });
    const harness = await RouterTestingHarness.create('/workspace');
    const dom = await ready(harness);
    expect(dom.textContent).toContain('Maison');
    expect(dom.querySelector('#budget-test-create-title')).toBeNull();
    expect(dom.querySelector('#budget-test-operations-title')).toBeNull();
  });

  it('garde la saisie des réglages après conflit et relit la nouvelle révision sans afficher les capitalisations', async () => {
    setup(PatrimoineTest, 'patrimoine-settings', '/socle/patrimoine', {
      patrimoine: async () => patrimoine,
      updatePatrimoine: async () => { throw new ApiError(409, { code: 'STALE_VERSION', action: null, message: 'Version modifiée' }); },
    });
    const harness = await RouterTestingHarness.create('/workspace');
    let dom = await ready(harness);
    const page = harness.routeDebugElement!.componentInstance as any;
    page.openingStock.set('450');
    await page.save(patrimoine);
    await page.reloadKeepingInput();
    dom = await ready(harness);
    expect(page.openingStock()).toBe('450');
    expect(dom.querySelector('#patrimoine-test-update-title')).not.toBeNull();
    expect(dom.querySelector('#patrimoine-test-caps-title')).toBeNull();
    expect(dom.querySelector('#patrimoine-test-object-title')).toBeNull();
  });

  it('ouvre directement les paramètres avec leur commande de modification, sans onglets concurrents', async () => {
    setup(AdminPage, 'admin-parameters', '/admin', {
      adminModules: async () => [],
      adminParameters: async () => [{ key: 'test', group: 'Budget', label: 'Paramètre du Budget', value: 4, type: 'integer', revision: 0, origin: 'default', history: [] }],
      journal: async () => [], recentErrors: async () => [],
    });
    const harness = await RouterTestingHarness.create('/workspace');
    const dom = await ready(harness);
    expect(dom.querySelector('[role="tablist"]')).toBeNull();
    expect(dom.textContent).toContain('Paramètre du Budget');
    const edit = [...dom.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === 'Modifier');
    edit!.click();
    await ready(harness);
    expect(dom.querySelector('.adm-edit input')?.getAttribute('inputmode')).toBe('decimal');
    expect(dom.querySelector('.bpm-toolbar-primary')?.textContent).toContain('Enregistrer le paramètre');
  });

  it('reprend le périmètre des relations et conserve ce contexte dans le lien de retour', async () => {
    const debug = vi.fn(async () => ({ scope: 'user-1', checks: [], relations: [], modules: [], parameters: [], journal: [], creationReceipts: [], views: {} }));
    setup(ObjectManagement, 'objects-relations', '/object-management', {
      omDebug: debug, omKinds: async () => [], omCsvFiles: async () => [], omObjects: async () => [],
    });
    const harness = await RouterTestingHarness.create('/workspace?scope=user-1&q=loyer');
    const dom = await ready(harness);
    expect(debug).toHaveBeenCalledWith('user-1');
    expect(dom.querySelector('#om-relations-title')).not.toBeNull();
    expect(dom.querySelector('#om-inventory-title')).toBeNull();
    expect(dom.querySelector('[role="tablist"]')).toBeNull();
    const back = dom.querySelector<HTMLAnchorElement>('a[href^="/object-management?"]')!;
    expect(back.getAttribute('href')).toContain('scope=user-1');
    expect(back.getAttribute('href')).toContain('q=loyer');
  });

  it('présente seulement le formulaire de nouvel utilisateur et valide la commande accessible dans le bandeau', async () => {
    setup(BpmOnboarding, 'users-new', '/utilisateurs', { userTypes: async () => [{ key: 'person', label: 'Particulier' }] });
    const harness = await RouterTestingHarness.create('/workspace');
    const dom = await ready(harness);
    expect(dom.querySelector('.us-form')).not.toBeNull();
    expect(dom.querySelector('.us-list')).toBeNull();
    expect(dom.querySelector('.us-filters')).toBeNull();
    const create = [...dom.querySelectorAll<HTMLButtonElement>('.bpm-toolbar-primary button')].find((button) => button.textContent?.includes('Créer l’utilisateur'))!;
    create.click();
    await ready(harness);
    expect(dom.querySelector('#e-label')?.textContent).toContain('libellé');
    expect(dom.querySelector('.page-toolbar-result')?.textContent).toContain('Quelques champs');
    expect(TestBed.inject(Router).url).toBe('/workspace');
  });

  it('isole les références de calcul tout en laissant chaque métrique accessible dans son éditeur', async () => {
    setup(AdminMetrics, 'metric-references', '/admin/calculs', {
      metricCatalog: async () => ({ metrics: [], functions: ['siInconnu'], references: [
        { type: 'variable', name: 'budget.total', label: 'Budget source', module: 'budget', unit: 'euro' },
        { type: 'metric', name: 'bpm.solde', label: 'Solde', module: 'bpm', unit: 'euro' },
      ] }),
    });
    const harness = await RouterTestingHarness.create('/workspace');
    const dom = await ready(harness);
    expect(dom.querySelector('#adm-refs-title')).not.toBeNull();
    expect(dom.querySelector('[aria-label="Métriques"]')).toBeNull();
    expect(dom.textContent).toContain('budget.total');
    expect(dom.querySelector('a[href="/admin/calculs/bpm.solde"]')).not.toBeNull();
  });
});
