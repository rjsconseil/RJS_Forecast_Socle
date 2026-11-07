import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BpmApi } from '../../core/bpm-api.service';
import { CapsReview, ChargeCategory, ReviewCenter, ReviewCharge } from '../../core/bpm-caps.models';
import { BpmCapsPage } from './caps';

const center = (ref: string, label: string, capCents: number | null): ReviewCenter => ({
  ref,
  label,
  capCents,
  standard: true,
  paidCents: 0,
  toPayCents: 0,
  engagedCents: 0,
  marginCents: capCents,
  usedPct: capCents === null ? null : 0,
  over: false,
  lineCount: 0,
  chargeIds: [],
});
const catalog: ChargeCategory[] = [
  {
    id: 'cat_cine',
    label: 'Cinéma',
    costCenterRef: 'std:loisirs',
    costCenterLabel: 'Loisirs',
    capCents: 4000,
    revision: 3,
    archived: false,
  },
  {
    id: 'cat_old',
    label: 'Ancienne catégorie',
    costCenterRef: 'std:loisirs',
    costCenterLabel: 'Loisirs',
    capCents: 1000,
    revision: 1,
    archived: true,
  },
];
const review: CapsReview = {
  context: {
    user: { id: 'usr_test', label: 'Test', userType: 'individual' },
    scope: 'principal',
    scopeLabel: 'Budget du projet de vie',
    budgets: [],
    period: null,
    calculationDate: '2026-11-06',
    revision: 1,
    unit: 'EUR',
  },
  lifeBudget: { budgetId: 'bud_test', revision: 7, capsCents: { 'std:loisirs': 20000 } },
  centers: [center('std:loisirs', 'Loisirs', 20000), center('std:transport', 'Transport', null)],
  // Une catégorie retirée sans charge ne figure plus dans la revue mais reste au catalogue.
  categories: [],
  charges: {},
  totals: {
    cappedCount: 1,
    overCount: 0,
    toCompensateCents: 0,
    headroomCents: 20000,
    expectedCents: 20000,
    initialCents: 0,
  },
};

describe('les trois espaces des plafonds BPM', () => {
  let harness: RouterTestingHarness;
  let api: {
    capsReview: ReturnType<typeof vi.fn>;
    line: ReturnType<typeof vi.fn>;
    categories: ReturnType<typeof vi.fn>;
    setCaps: ReturnType<typeof vi.fn>;
    updateCategory: ReturnType<typeof vi.fn>;
    createCategory: ReturnType<typeof vi.fn>;
  };
  const dom = () => harness.routeNativeElement!;
  const control = <T extends HTMLElement>(selector: string) => dom().querySelector<T>(selector)!;
  async function settle() {
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
  }
  async function select(name: string, value: string) {
    const el = control<HTMLSelectElement>(`select[name="${name}"]`);
    el.value = value;
    el.dispatchEvent(new Event('change'));
    await settle();
  }
  async function fill(name: string, value: string) {
    const el = control<HTMLInputElement>(`input[name="${name}"]`);
    el.value = value;
    el.dispatchEvent(new Event('input'));
    await settle();
  }
  async function submit(label: string) {
    control<HTMLFormElement>(`form[aria-label="${label}"]`).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await settle();
  }
  async function click(label: string) {
    [...dom().querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === label)!.click();
    await settle();
  }
  // Chaque vue a sa propre adresse : le suivi sur la page, les réglages et les catégories en sous-pages.
  const VIEW_ROUTES: Record<string, string> = { suivi: '/plafonds', plafonds: '/plafonds/reglages', categories: '/plafonds/categories' };
  async function open(view = 'plafonds') {
    const page = await harness.navigateByUrl(VIEW_ROUTES[view], BpmCapsPage);
    await settle();
    return page;
  }

  beforeEach(async () => {
    api = {
      capsReview: vi.fn().mockResolvedValue(review),
      line: vi.fn().mockRejectedValue(new Error('Détail chargé par son service dédié')),
      categories: vi.fn().mockResolvedValue(catalog),
      setCaps: vi.fn().mockResolvedValue({}),
      updateCategory: vi.fn().mockResolvedValue({}),
      createCategory: vi
        .fn()
        .mockResolvedValue({ category: { label: 'Livres', costCenterLabel: 'Loisirs' } }),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'plafonds', component: BpmCapsPage },
          { path: 'plafonds/reglages', component: BpmCapsPage, data: { workspace: { key: 'caps-settings', parent: '/plafonds', title: 'Définir mes plafonds', lead: 'Régler mes limites.' } } },
          { path: 'plafonds/categories', component: BpmCapsPage, data: { workspace: { key: 'caps-categories', parent: '/plafonds', title: 'Organiser mes catégories', lead: 'Ranger mes dépenses.' } } },
        ]),
        { provide: BpmApi, useValue: api },
      ],
    });
    harness = await RouterTestingHarness.create();
  });

  it('propose tous les postes puis enregistre uniquement le plafond sélectionné', async () => {
    await open();
    expect(
      control<HTMLButtonElement>('form[aria-label="Plafond d’un poste"] button[type="submit"]')
        .disabled,
    ).toBe(true);
    expect(control('select[name="centerRef"]').textContent).toContain('Transport · sans plafond');
    await select('centerRef', 'std:transport');
    await fill('centerCap', '85,50');
    await submit('Plafond d’un poste');
    expect(api.setCaps).toHaveBeenCalledExactlyOnceWith({
      expectedRevision: 7,
      caps: { 'std:transport': 85.5 },
      merge: true,
    });
    expect(api.updateCategory).not.toHaveBeenCalled();
  });

  it('permet de retirer un plafond et refuse un montant négatif sans écrire', async () => {
    await open();
    await select('centerRef', 'std:loisirs');
    await fill('centerCap', '-2');
    await submit('Plafond d’un poste');
    expect(api.setCaps).not.toHaveBeenCalled();
    expect(dom().textContent).toContain('Saisissez un montant positif');
    await fill('centerCap', '');
    await submit('Plafond d’un poste');
    expect(api.setCaps).toHaveBeenCalledWith({
      expectedRevision: 7,
      caps: { 'std:loisirs': null },
      merge: true,
    });
  });

  it('modifie le plafond de catégorie indépendamment de son poste', async () => {
    await open();
    expect(control('select[name="categoryId"]').textContent).not.toContain('Ancienne catégorie');
    await select('categoryId', 'cat_cine');
    expect(control<HTMLInputElement>('input[name="categoryCap"]').value).toBe('40');
    await fill('categoryCap', '50');
    await submit('Plafond d’une catégorie');
    expect(api.updateCategory).toHaveBeenCalledExactlyOnceWith('cat_cine', {
      expectedRevision: 3,
      cap: 50,
    });
    expect(api.setCaps).not.toHaveBeenCalled();
  });

  it('crée une catégorie sans plafond dans le poste choisi et conserve les catégories retirées', async () => {
    await open('categories');
    expect(api.categories).toHaveBeenCalledWith(true);
    expect(dom().textContent).toContain('Ancienne catégorie');
    expect(dom().textContent).toContain('Rétablir');
    await select('newCenter', 'std:loisirs');
    await fill('newLabel', ' Livres ');
    await submit('Créer une catégorie');
    expect(api.createCategory).toHaveBeenCalledWith({
      requestKey: expect.any(String),
      label: 'Livres',
      costCenterRef: 'std:loisirs',
    });
    expect(control<HTMLInputElement>('input[name="newLabel"]').value).toBe('');
    expect(api.setCaps).not.toHaveBeenCalled();
    expect(api.updateCategory).not.toHaveBeenCalled();
  });

  it('renomme une catégorie sans modifier son plafond ni son rattachement', async () => {
    await open('categories');
    const row = [...dom().querySelectorAll<HTMLElement>('.caps-cat-row')].find((el) =>
      el.textContent?.includes('Cinéma'),
    )!;
    [...row.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === 'Renommer')!
      .click();
    await settle();
    await fill('editLabel', ' Cinéma et spectacles ');
    control<HTMLFormElement>('form.caps-cat-edit').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await settle();
    expect(api.updateCategory).toHaveBeenCalledExactlyOnceWith('cat_cine', {
      expectedRevision: 3,
      label: 'Cinéma et spectacles',
    });
    expect(api.setCaps).not.toHaveBeenCalled();
  });

  it('retire puis rétablit une catégorie en conservant son plafond et ses données', async () => {
    await open('categories');
    const row = () =>
      [...dom().querySelectorAll<HTMLElement>('.caps-cat-row')].find((el) =>
        el.textContent?.includes('Cinéma'),
      )!;
    const action = (label: string) =>
      [...row().querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === label,
      )!;
    const retired = { ...catalog[0], archived: true, revision: 4 };
    api.categories.mockResolvedValue([retired, catalog[1]]);
    action('Retirer').click();
    await settle();
    expect(api.updateCategory).toHaveBeenNthCalledWith(1, 'cat_cine', {
      expectedRevision: 3,
      archived: true,
    });
    await vi.waitFor(async () => {
      await settle();
      expect(row().textContent).toContain('Retirée des choix');
    });
    expect(row().textContent).toContain('Plafond');
    expect(action('Rétablir')).toBeTruthy();
    api.categories.mockResolvedValue([{ ...retired, archived: false, revision: 5 }, catalog[1]]);
    action('Rétablir').click();
    await settle();
    expect(api.updateCategory).toHaveBeenNthCalledWith(2, 'cat_cine', {
      expectedRevision: 4,
      archived: false,
    });
    await vi.waitFor(async () => {
      await settle();
      expect(row().textContent).not.toContain('Retirée des choix');
    });
    expect(action('Retirer')).toBeTruthy();
    expect(api.setCaps).not.toHaveBeenCalled();
  });

  it('signale un échec d’enregistrement et conserve la saisie pour réessayer', async () => {
    api.setCaps.mockRejectedValueOnce(new Error('Conflit : actualisez la page'));
    const page = await open();
    await select('centerRef', 'std:transport');
    await fill('centerCap', '90');
    await page.saveCenter();
    await settle();
    expect(control<HTMLInputElement>('input[name="centerCap"]').value).toBe('90');
    expect(control('[role="alert"]').textContent).toContain('Conflit : actualisez la page');
    expect(
      control<HTMLButtonElement>('form[aria-label="Plafond d’un poste"] button[type="submit"]')
        .disabled,
    ).toBe(false);
  });

  it('retire les anciennes données d’édition si le chargement de la nouvelle période échoue', async () => {
    await harness.navigateByUrl('/plafonds/reglages?period=2026-10', BpmCapsPage);
    await settle();
    await select('centerRef', 'std:loisirs');
    await select('categoryId', 'cat_cine');
    expect(control<HTMLInputElement>('input[name="centerCap"]').value).toBe('200');
    expect(control<HTMLInputElement>('input[name="categoryCap"]').value).toBe('40');
    api.capsReview.mockRejectedValueOnce(new Error('Impossible de charger la période de novembre'));

    await harness.navigateByUrl('/plafonds/reglages?period=2026-11', BpmCapsPage);
    await vi.waitFor(async () => {
      await settle();
      expect(control('[role="alert"]').textContent).toContain(
        'Impossible de charger la période de novembre',
      );
    });

    expect(api.capsReview).toHaveBeenLastCalledWith('2026-11');
    expect(dom().querySelector('form[aria-label="Plafond d’un poste"]')).toBeNull();
    expect(dom().querySelector('form[aria-label="Plafond d’une catégorie"]')).toBeNull();
    expect(api.setCaps).not.toHaveBeenCalled();
    expect(api.updateCategory).not.toHaveBeenCalled();
  });

  it('préserve la période en passant du suivi au paramétrage par les onglets du bandeau', async () => {
    await harness.navigateByUrl('/plafonds?period=2026-10', BpmCapsPage);
    await settle();
    expect(control('.page-tab[aria-current="page"]').textContent).toContain('Suivi des plafonds');
    [...dom().querySelectorAll<HTMLAnchorElement>('.page-tab')].find(tab => tab.textContent?.includes('Définir les plafonds'))!.click();
    await settle();
    expect(TestBed.inject(Router).url).toBe('/plafonds/reglages?period=2026-10');
    expect(control('.page-tab[aria-current="page"]').textContent).toContain('Définir les plafonds');
  });

  it('conduit les anciens liens de réglages vers leur sous-page en gardant la période', async () => {
    await harness.navigateByUrl('/plafonds?period=2026-10#reglages-categories');
    await vi.waitFor(async () => {
      await settle();
      expect(TestBed.inject(Router).url).toBe('/plafonds/categories?period=2026-10#reglages-categories');
    });
    expect(control('.page-tab[aria-current="page"]').textContent).toContain('Organiser les catégories');
    expect(control('form[aria-label="Créer une catégorie"]')).toBeTruthy();
    [...dom().querySelectorAll<HTMLAnchorElement>('.page-tab')].find(tab => tab.textContent?.includes('Suivi des plafonds'))!.click();
    await settle();
    expect(TestBed.inject(Router).url).toBe('/plafonds?period=2026-10');
    await harness.navigateByUrl('/plafonds?period=2026-10&view=plafonds');
    await vi.waitFor(async () => {
      await settle();
      expect(TestBed.inject(Router).url).toBe('/plafonds/reglages?period=2026-10');
    });
  });
  it('reprend le plafond choisi dans un panneau depuis le bandeau et conserve une saisie refusée', async () => {
    await open();
    await select('centerRef', 'std:transport');
    await fill('centerCap', '95');
    await click('Relire le plafond choisi');
    expect(control<HTMLInputElement>('input[name="quickCenterAmount"]').value).toBe('95');
    expect(control('dialog[open]').textContent).toContain('Transport');
    api.setCaps.mockRejectedValueOnce(new Error('Enregistrement momentanément indisponible'));
    await click('Enregistrer ce plafond');
    await vi.waitFor(async () => { await settle(); expect(control('dialog[open]').textContent).toContain('Enregistrement momentanément indisponible'); });
    expect(control<HTMLInputElement>('input[name="quickCenterAmount"]').value).toBe('95');
    expect(api.setCaps).toHaveBeenCalledWith({ expectedRevision: 7, caps: { 'std:transport': 95 }, merge: true });
  });

  it('enchaîne création contextualisée et préparation du plafond sans créer de limite automatiquement', async () => {
    await open();
    await select('centerRef', 'std:transport');
    await click('Créer une catégorie dans ce poste');
    expect(control<HTMLSelectElement>('select[name="quickNewCenter"]').value).toBe('std:transport');
    const created = { ...catalog[0], id: 'cat_train', label: 'Train', costCenterRef: 'std:transport', costCenterLabel: 'Transport', capCents: null, revision: 1 };
    api.createCategory.mockResolvedValue({ category: created });
    api.categories.mockResolvedValue([...catalog, created]);
    await fill('quickNewLabel', 'Train');
    await click('Créer puis préparer son plafond');
    expect(api.createCategory).toHaveBeenCalledWith(expect.objectContaining({ label: 'Train', costCenterRef: 'std:transport' }));
    expect(control('dialog[open]').textContent).toContain('Train');
    expect(control('input[name="quickCategoryAmount"]')).toBeTruthy();
    expect(api.updateCategory).not.toHaveBeenCalled();
    await fill('quickCategoryAmount', '60');
    await vi.waitFor(async () => { await settle(); expect(control<HTMLButtonElement>('dialog[open] button[type="submit"]').disabled).toBe(false); });
    await click('Enregistrer ce plafond');
    expect(api.updateCategory).toHaveBeenCalledWith('cat_train', { expectedRevision: 1, cap: 60 });
    expect(api.setCaps).not.toHaveBeenCalled();
  });

  it('ouvre une charge encore à payer du dépassement de catégorie, même si le poste reste sous sa limite', async () => {
    const charge = (id: string, categoryId: string | null, engagedCents: number, engagedAs: 'paid' | 'toPay'): ReviewCharge => ({
      id, categoryId, label: id, engagedCents, engagedAs, cadence: 'once', cadenceLabel: 'Ponctuelle',
      plannedDate: '2026-11-08', plannedCents: engagedCents, status: 'pending', origin: '2026-11-08',
      sinceMonths: 0, rank: null, perYearCents: null, monthlyCents: null, newThisPeriod: true,
    }) as ReviewCharge;
    const charges = [charge('already_paid', 'cat_cine', 4500, 'paid'), charge('still_planned', 'cat_cine', 1500, 'toPay'), charge('other_category', null, 9000, 'toPay')];
    api.capsReview.mockResolvedValue({ ...review,
      centers: [{ ...review.centers[0], engagedCents: 15000, paidCents: 4500, toPayCents: 10500, marginCents: 5000, chargeIds: charges.map(charge => charge.id) }],
      categories: [{ ...catalog[0], paidCents: 4500, toPayCents: 1500, engagedCents: 6000, marginCents: -2000, usedPct: 150, over: true, lineCount: 2, chargeIds: ['already_paid', 'still_planned'] }],
      charges: Object.fromEntries(charges.map(charge => [charge.id, charge])),
      totals: { ...review.totals, overCount: 1 },
    });
    await open('suivi');
    expect(control('.bpm-toolbar-focus').textContent).toContain('catégorie dépassé');
    expect(control('.bpm-toolbar-focus').textContent).not.toContain('0,00');
    await click('Revoir une charge avant paiement');
    expect(TestBed.inject(Router).url).toContain('ligne=still_planned');
    expect(api.line).toHaveBeenCalledWith('still_planned', undefined);
    expect(api.setCaps).not.toHaveBeenCalled();
    expect(api.updateCategory).not.toHaveBeenCalled();
  });

  it('donne priorité à la sauvegarde du plafond et conserve le résultat dans le bandeau', async () => {
    await open();
    await select('centerRef', 'std:transport');
    await fill('centerCap', '75');
    expect(control('.bpm-toolbar-primary').textContent).toContain('Enregistrer le poste modifié');
    expect(control('.page-toolbar-scope').textContent).toContain('Transport');
    expect(control('.page-toolbar-scope').textContent).toContain('toutes les périodes');
    api.setCaps.mockRejectedValueOnce(new Error('Révision modifiée par un autre enregistrement'));
    await click('Enregistrer le poste modifié');
    await vi.waitFor(async () => { await settle(); expect(control('.page-toolbar-result').textContent).toContain('Révision modifiée'); });
    expect(control('.page-toolbar-result').getAttribute('role')).toBe('alert');
    expect(control<HTMLInputElement>('input[name="centerCap"]').value).toBe('75');
  });

  it('isole les catégories sur leur route puis rejoint le réglage du plafond choisi', async () => {
    await harness.navigateByUrl('/plafonds/categories?period=2026-10');
    await settle();
    expect(dom().querySelector('.caps-workspaces')).toBeNull();
    expect(dom().querySelector('.caps-review')).toBeNull();
    expect(control('#caps-categories-title').textContent).toContain('catégories');
    const row = [...dom().querySelectorAll<HTMLElement>('.caps-cat-row')].find(el => el.textContent?.includes('Cinéma'))!;
    [...row.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Définir le plafond')!.click();
    await settle();
    expect(TestBed.inject(Router).url).toContain('/plafonds/reglages');
    expect(TestBed.inject(Router).url).toContain('period=2026-10');
    expect(TestBed.inject(Router).url).toContain('target=category:cat_cine');
    expect(dom().querySelector('.caps-review')).toBeNull();
    expect(api.updateCategory).not.toHaveBeenCalled();
  });

});
