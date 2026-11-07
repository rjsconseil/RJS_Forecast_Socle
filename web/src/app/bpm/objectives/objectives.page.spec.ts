import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Api, RecetteContext } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmObjectivesPage } from './objectives.page';

const goal = {
  id: 'goal_1',
  label: 'Études',
  type: 'etudes',
  typeLabel: 'Études',
  date: '2030-09-01',
  targetTodayCents: 1500000,
  revision: 3,
  removed: false,
};
const profile = () => ({
  principal: {
    revision: 9,
    patrimoine: { revision: 4, objectiveCents: 3000000 },
    vision: {
      horizonYears: 20,
      annualReturnPct: 3,
      inflationPct: 2,
      inflationSource: 'Hypothèse',
      contributionCents: 20000,
      contributionCadence: 'monthly',
      savingsTargetCents: 10000,
      surplus: null,
    },
  },
  goalTypes: [
    { key: 'etudes', label: 'Études', consumes: true },
    { key: 'achat', label: 'Achat', consumes: true },
  ],
});

describe('page dédiée Objectifs et avenir', () => {
  let harness: RouterTestingHarness;
  let bpm: Record<string, ReturnType<typeof vi.fn>>;
  let api: { updateBpmPatrimoine: ReturnType<typeof vi.fn> };
  const element = <T extends HTMLElement>(selector: string) =>
    harness.routeNativeElement!.querySelector<T>(selector)!;
  async function settle() {
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
  }
  async function fill(name: string, value: string) {
    const el = element<HTMLInputElement>(`input[name="${name}"]`);
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  }
  async function submitFor(name: string) {
    element(`input[name="${name}"]`)
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
  }
  async function click(label: string) {
    const button = [
      ...harness.routeNativeElement!.querySelectorAll<HTMLButtonElement>('button'),
    ].find((b) => b.textContent!.trim() === label)!;
    button.click();
    await settle();
  }
  beforeEach(async () => {
    bpm = {
      setupProfile: vi.fn().mockResolvedValue(profile()),
      summary: vi.fn().mockResolvedValue({ context: { user: { label: 'Profil test' }, calculationDate: '2026-11-06', scope: 'principal', period: { key: '2026-11', label: 'Novembre 2026', start: '2026-11-01', endExclusive: '2026-12-01' } }, figures: {} }),
      directives: vi.fn().mockResolvedValue({ items: [], surplus: null }),
      goals: vi.fn().mockResolvedValue([goal]),
      projection: vi.fn().mockResolvedValue({ status: 'unknown', rows: [], goals: [] }),
      updateVision: vi.fn().mockResolvedValue({ revision: 10 }),
      removeGoal: vi.fn().mockResolvedValue({}),
      createGoal: vi.fn().mockResolvedValue({ replayed: false, goal: { label: 'Voyage' } }),
      updateGoal: vi.fn().mockResolvedValue({}),
    };
    api = { updateBpmPatrimoine: vi.fn().mockResolvedValue({}) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'vision', component: BpmObjectivesPage },
          { path: 'vision/projection', component: BpmObjectivesPage, data: { workspace: { key: 'vision-projection', parent: '/vision', title: 'Projection et hypothèses', lead: 'Préparer mon scénario.' } } },
          { path: 'vision/reperes', component: BpmObjectivesPage, data: { workspace: { key: 'vision-landmarks', parent: '/vision', title: 'Épargne et patrimoine', lead: 'Fixer mes repères.' } } },
        ]),
        { provide: BpmApi, useValue: bpm },
        { provide: Api, useValue: api },
      ],
    });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/vision', BpmObjectivesPage);
    await settle();
  });
  it('ouvre le suivi et garde les réglages dans leur espace dédié', () => {
    expect(element('.life-goal-list').textContent).toContain('Études');
    expect(element<HTMLElement>('.objectives-reperes').hidden).toBe(true);
    expect(element<HTMLElement>('#life-dated-goals').hidden).toBe(false);
    expect(harness.routeNativeElement!.textContent).not.toContain(
      'L’objectif de patrimoine se règle à l’étape',
    );
  });
  it('modifie le cap patrimonial sans modifier le stock ni le budget', async () => {
    await fill('wealthTarget', '45 000,50');
    await submitFor('wealthTarget');
    expect(api.updateBpmPatrimoine).toHaveBeenCalledWith({
      expectedRevision: 4,
      objective: 45000.5,
    });
    expect(bpm['updateVision']).not.toHaveBeenCalled();
  });
  it('enregistre séparément épargne visée et excédent cumulé', async () => {
    await fill('savingsTarget', '175');
    await submitFor('savingsTarget');
    expect(bpm['updateVision']).toHaveBeenLastCalledWith({
      expectedRevision: 9,
      savingsTarget: 175,
    });
    await fill('sTarget', '1200');
    await fill('sPeriods', '6');
    await fill('sStart', '2026-11');
    await submitFor('sTarget');
    expect(bpm['updateVision']).toHaveBeenLastCalledWith({
      expectedRevision: 9,
      surplus: { target: 1200, periods: 6, startKey: '2026-11' },
    });
    expect(api.updateBpmPatrimoine).not.toHaveBeenCalled();
  });
  it('refuse les montants invalides et conserve la saisie après un échec', async () => {
    await fill('wealthTarget', '-5');
    await submitFor('wealthTarget');
    expect(api.updateBpmPatrimoine).not.toHaveBeenCalled();
    api.updateBpmPatrimoine.mockRejectedValueOnce(new Error('Échec de connexion'));
    await fill('wealthTarget', '42000');
    await submitFor('wealthTarget');
    expect(element<HTMLInputElement>('input[name="wealthTarget"]').value).toBe('42000');
    expect(harness.routeNativeElement!.textContent).toContain('Votre saisie est conservée');
  });
  it('crée et modifie un objectif avec l’éditeur partagé', async () => {
    await click('+ Ajouter un objectif daté');
    await fill('label', 'Voyage');
    await fill('target', '2500');
    await fill('date', '2028-06-01');
    await submitFor('label');
    expect(bpm['createGoal']).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Voyage',
        targetToday: 2500,
        date: '2028-06-01',
        requestKey: expect.any(String),
      }),
    );
    element<HTMLButtonElement>('[aria-label="Modifier l’objectif Études"]').click();
    await settle();
    await fill('target', '17000');
    await submitFor('target');
    expect(bpm['updateGoal']).toHaveBeenCalledWith(
      'goal_1',
      expect.objectContaining({ expectedRevision: 3, targetToday: 17000 }),
    );
  });
  it('retire un objectif uniquement après confirmation', async () => {
    element<HTMLButtonElement>('[aria-label="Retirer l’objectif Études"]').click();
    await settle();
    expect(bpm['removeGoal']).not.toHaveBeenCalled();
    await click('Retirer l’objectif');
    expect(bpm['removeGoal']).toHaveBeenCalledWith('goal_1', 3);
  });
  it('enregistre les hypothèses sans écraser les objectifs budgétaires', async () => {
    await fill('horizon', '25');
    await fill('rate', '4,5');
    await fill('contribution', '300');
    await submitFor('horizon');
    expect(bpm['updateVision']).toHaveBeenCalledWith({
      expectedRevision: 9,
      horizonYears: 25,
      annualReturnPct: 4.5,
      inflationPct: 2,
      inflationSource: 'Hypothèse',
      contribution: 300,
      contributionCadence: 'monthly',
    });
  });
  it('ouvre les réglages visés depuis les boutons du cockpit', async () => {
    await harness.navigateByUrl('/vision#cap-patrimonial');
    await settle();
    expect(element<HTMLElement>('.objectives-reperes').hidden).toBe(false);
    expect(element<HTMLElement>('#life-dated-goals').hidden).toBe(true);
    await harness.navigateByUrl('/vision#life-projection');
    await settle();
    expect(element<HTMLElement>('#life-projection').hidden).toBe(false);
  });
  it('filtre sans modifier les objectifs ni masquer les totaux de synthèse', async () => {
    const input = element<HTMLInputElement>('input[type="search"]');
    input.value = 'etudes';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(element('.life-goal-list').textContent).toContain('Études');
    input.value = 'voyage';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(element('.life-goal-list').textContent).toContain('Aucun objectif ne correspond');
    expect(element('.objectives-summary-band').textContent).toContain('15');
    expect(bpm['updateGoal']).not.toHaveBeenCalled();
    await click('Afficher tous les objectifs');
    expect(element('.life-goal-list').textContent).toContain('Études');
  });
  it('conserve un réglage non enregistré en changeant d’espace', async () => {
    await harness.navigateByUrl('/vision?view=reperes');
    await settle();
    await fill('wealthTarget', '48000');
    await harness.navigateByUrl('/vision?view=suivi');
    await settle();
    await harness.navigateByUrl('/vision?view=reperes');
    await settle();
    expect(element<HTMLInputElement>('input[name="wealthTarget"]').value).toBe('48000');
    expect(api.updateBpmPatrimoine).not.toHaveBeenCalled();
  });
  it('ouvre le scénario depuis le bandeau et réutilise la saisie sans formulaire concurrent', async () => {
    await harness.navigateByUrl('/vision?view=suivi&q=etudes');
    await settle();
    await click('Calculer la couverture des objectifs');
    expect(TestBed.inject(Router).url).toContain('reglage=projection');
    expect(TestBed.inject(Router).url).toContain('q=etudes');
    expect(harness.routeNativeElement!.querySelectorAll('input[name="horizon"]')).toHaveLength(1);
    await fill('rate', '5');
    bpm['updateVision'].mockRejectedValueOnce(new Error('Connexion interrompue'));
    await click('Enregistrer le scénario saisi');
    expect(element<HTMLInputElement>('input[name="rate"]').value).toBe('5');
    expect(element('dialog[open]').textContent).toContain('Connexion interrompue');
    await click('Enregistrer le scénario saisi');
    expect(bpm['updateVision']).toHaveBeenLastCalledWith(expect.objectContaining({ annualReturnPct: 5 }));
    await vi.waitFor(async () => { await settle(); expect(harness.routeNativeElement!.querySelector('dialog[open]')).toBeNull(); });
    expect(harness.routeNativeElement!.querySelectorAll('input[name="horizon"]')).toHaveLength(1);
  });

  it('enregistre un repère saisi depuis le bandeau sans toucher à l’autre', async () => {
    await harness.navigateByUrl('/vision?view=reperes');
    await settle();
    await fill('wealthTarget', '49000');
    expect(element('.bpm-toolbar-focus').textContent).toContain('repère non enregistré');
    await click('Enregistrer le cap saisi');
    expect(api.updateBpmPatrimoine).toHaveBeenCalledWith({ expectedRevision: 4, objective: 49000 });
    expect(bpm['updateVision']).not.toHaveBeenCalled();
  });

  it('propose de revoir l’objectif en retard avant une intention future', async () => {
    bpm['goals'].mockResolvedValue([{ ...goal, id: 'past', label: 'Ancien achat', date: '2026-09-01' }, goal]);
    await click('Actualiser');
    expect(element('.bpm-toolbar-focus').textContent).toContain('Échéance passée : Ancien achat');
    await click('Revoir Ancien achat');
    expect(element<HTMLInputElement>('input[name="label"]').value).toBe('Ancien achat');
  });

  it('respecte les objectifs filtrés pour choisir la commande principale', async () => {
    bpm['goals'].mockResolvedValue([{ ...goal, id: 'past', label: 'Ancien achat', type: 'achat', typeLabel: 'Achat', date: '2026-09-01' }, goal]);
    bpm['projection'].mockResolvedValue({ status: 'estimate', rows: [], goals: [{ goalId: goal.id, status: 'partial', nominalTargetCents: 1800000, coveredCents: 500000, coveragePct: 28 }] });
    await click('Actualiser');
    await harness.navigateByUrl('/vision?q=etudes');
    await settle();
    expect(element('.bpm-toolbar-primary').textContent).toContain('Revoir Études');
    expect(element('.bpm-toolbar-primary').textContent).not.toContain('Ancien achat');
    expect(element('.page-toolbar-scope').textContent).toContain('1 affiché(s) sur 2');
    await click('Revoir Études');
    expect(element<HTMLInputElement>('input[name="label"]').value).toBe('Études');
  });

  it('priorise une saisie conservée et affiche son résultat dans le bandeau', async () => {
    await harness.navigateByUrl('/vision?view=reperes');
    await settle();
    await fill('wealthTarget', '51000');
    await harness.navigateByUrl('/vision?view=suivi');
    await settle();
    expect(element('.bpm-toolbar-primary').textContent).toContain('Enregistrer le cap saisi');
    expect(element('.page-toolbar-scope').textContent).toContain('Cap patrimonial');
    await click('Enregistrer le cap saisi');
    await vi.waitFor(async () => { await settle(); expect(element('.page-toolbar-result').textContent).toContain('Cap patrimonial enregistré'); });
    expect(api.updateBpmPatrimoine).toHaveBeenCalledWith({ expectedRevision: 4, objective: 51000 });
    expect(bpm['updateVision']).not.toHaveBeenCalled();
  });

  it('ouvre directement une vue spécialisée malgré un ancien onglet et garde le contexte au retour', async () => {
    await harness.navigateByUrl('/vision/projection?view=suivi&period=2026-10&q=etudes');
    await settle();
    expect(element<HTMLElement>('#life-projection').hidden).toBe(false);
    expect(element<HTMLElement>('#life-dated-goals').hidden).toBe(true);
    expect(harness.routeNativeElement!.querySelector('.objectives-tabs')).toBeNull();
    const back = element<HTMLAnchorElement>('bpm-heading a');
    expect(back.href).toContain('/vision?');
    expect(back.href).toContain('period=2026-10');
    expect(back.href).toContain('q=etudes');
  });

  it('retrouve une hypothèse non enregistrée après un parcours entre les deux sous-pages', async () => {
    TestBed.inject(RecetteContext).select('vision-workspace-test', { remember: false });
    await settle();
    await harness.navigateByUrl('/vision/projection');
    await settle();
    await fill('rate', '6,5');
    await harness.navigateByUrl('/vision/reperes');
    await settle();
    await harness.navigateByUrl('/vision/projection');
    await settle();
    expect(element<HTMLInputElement>('input[name="rate"]').value).toBe('6,5');
    expect(element('.bpm-toolbar-primary').textContent).toContain('Enregistrer le scénario saisi');
    expect(bpm['updateVision']).not.toHaveBeenCalled();
  });

});
