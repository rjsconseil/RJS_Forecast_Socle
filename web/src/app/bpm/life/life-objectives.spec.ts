import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Api } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmLifeObjectives } from './life-objectives';

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

describe('objectifs intégrés au projet de vie', () => {
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
    el.dispatchEvent(new Event('input'));
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
      summary: vi.fn().mockResolvedValue({ context: { period: { key: '2026-11' } }, figures: {} }),
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
        provideRouter([{ path: 'projet-de-vie', component: BpmLifeObjectives }]),
        { provide: BpmApi, useValue: bpm },
        { provide: Api, useValue: api },
      ],
    });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/projet-de-vie', BpmLifeObjectives);
    await settle();
  });
  it('présente les objectifs datés et garde les réglages repliés', () => {
    expect(element('.life-goal-list').textContent).toContain('Études');
    expect(element<HTMLDetailsElement>('.life-objective-disclosure').open).toBe(false);
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
    await harness.navigateByUrl('/projet-de-vie#cap-patrimonial');
    await settle();
    expect(element<HTMLDetailsElement>('.life-objective-disclosure').open).toBe(true);
    await harness.navigateByUrl('/projet-de-vie#life-projection');
    await settle();
    expect(element<HTMLDetailsElement>('#life-projection').open).toBe(true);
  });
});
