import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { RecetteContext } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmCreatePage } from './create';
import { BpmNavigation } from '../ui/navigation';
import { BpmPageFrame } from '../ui/page-frame';

@Component({ template: '' })
class Result {}
const profile = {
  user: { id: 'user-A', label: 'Profil test', userType: 'individuel' },
  principal: {
    budgetId: 'bud-life',
    project: { title: 'Projet de vie', description: '' },
    patrimoine: { openingStockCents: 100000, openingDate: '2026-11-01', objectiveCents: null },
    cycle: { state: 'active', anchorDay: 1, startDate: '2026-11-01' },
    vision: { annualReturnPct: null, inflationPct: 2, savingsTargetCents: null },
  },
  budgetType: { context: { budgets: [] }, lines: [] },
  cycleState: { frozen: false },
  suggestions: [],
  goals: [],
  centers: [],
  goalTypes: [],
};

describe('assistant BPM : étapes et reprise', () => {
  let harness: RouterTestingHarness;
  let nav: BpmNavigation;
  let router: Router;
  let setup: ReturnType<typeof vi.fn>;
  async function settle() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    TestBed.tick();
    await harness.fixture.whenStable();
  }
  beforeEach(async () => {
    sessionStorage.clear();
    setup = vi
      .fn()
      .mockResolvedValue({
        mode: 'branch',
        coreProjectId: 'prj-created',
        created: [],
        updated: [],
        taskIds: ['t1'],
      });
    TestBed.configureTestingModule({
      providers: [
        provideLocationMocks(),
        provideRouter([
          { path: 'creer/projet-de-vie', component: BpmCreatePage, data: { workspace: { key: 'start-life', parent: '/creer', title: 'Projet de vie', lead: '' } } },
          { path: 'creer/projet-de-la-vie', component: BpmCreatePage, data: { workspace: { key: 'start-project', parent: '/creer', title: 'Nouveau projet', lead: '' } } },
          { path: 'creer', component: BpmCreatePage },
          { path: 'app/gestion-projet/:id', component: Result },
          { path: 'projet-de-vie', component: Result },
        ]),
        { provide: BpmApi, useValue: { setupProfile: vi.fn().mockResolvedValue(profile), setup } },
      ],
    });
    TestBed.overrideComponent(BpmCreatePage, { set: { template: '' } });
    TestBed.inject(RecetteContext).userId.set('user-A');
    nav = TestBed.inject(BpmNavigation);
    router = TestBed.inject(Router);
    router.setUpLocationChangeListener();
    harness = await RouterTestingHarness.create();
  });
  it('inscrit chaque étape validée dans l’URL et reprend les champs et la même clé de demande', async () => {
    const page = (await harness.navigateByUrl('/creer', BpmCreatePage)) as any;
    await settle();
    expect(router.url).toBe('/creer?step=1');
    const key = page.draft().requestKey;
    page.next();
    await settle();
    expect(page.draft().step).toBe(2);
    Object.assign(page.draft(), {
      mode: 'branch',
      branchName: 'Cuisine',
      branchDescription: 'Saisie à garder',
    });
    page.draft().tasks[0].title = 'Comparer les devis';
    page.touch();
    page.next();
    await settle();
    expect(router.url).toBe('/creer?step=3');
    nav.back();
    await settle();
    expect(page.draft().step).toBe(2);
    nav.back();
    await settle();
    expect(page.draft().step).toBe(1);
    nav.forward();
    await settle();
    nav.forward();
    await settle();
    expect(page.draft().step).toBe(3);
    expect(page.draft().branchDescription).toBe('Saisie à garder');
    expect(page.draft().requestKey).toBe(key);
    expect(setup).not.toHaveBeenCalled();
  });
  it('refuse une étape non atteinte dans une arrivée directe', async () => {
    const page = (await harness.navigateByUrl('/creer?step=99', BpmCreatePage)) as any;
    await settle();
    expect(page.draft().step).toBe(1);
    expect(router.url).toBe('/creer?step=1');
  });
  it('après confirmation, ouvre le projet créé pour poursuivre son pilotage', async () => {
    const page = (await harness.navigateByUrl('/creer', BpmCreatePage)) as any;
    await settle();
    Object.assign(page.draft(), {
      mode: 'branch',
      branchName: 'Cuisine',
      visionLater: true,
      maxReached: 7,
    });
    page.draft().tasks[0].title = 'Comparer les devis';
    page.touch();
    page.go(7);
    await settle();
    await page.confirm();
    await settle();
    expect(setup).toHaveBeenCalledTimes(1);
    expect(router.url).toBe('/app/gestion-projet/prj-created');
    expect(sessionStorage.getItem('bpm-create-draft:user-A')).toBeNull();
  });

  it('présélectionne le nouveau projet et reste dans son entrée spécialisée pendant les validations', async () => {
    const page = (await harness.navigateByUrl('/creer/projet-de-la-vie', BpmCreatePage)) as any;
    await settle();
    expect(page.draft().mode).toBe('branch');
    expect(page.draft().step).toBe(1);
    page.next();
    await settle();
    expect(router.url).toBe('/creer/projet-de-la-vie?step=2');
    page.next();
    await settle();
    expect(page.draft().step).toBe(2);
    expect(page.stepErrors().join(' ')).toContain('nom est obligatoire');
    page.draft().branchName = 'Cuisine';
    page.draft().tasks[0].title = 'Comparer les devis';
    page.touch();
    page.next();
    await settle();
    expect(router.url).toBe('/creer/projet-de-la-vie?step=3');
    expect(setup).not.toHaveBeenCalled();
  });

  it('conserve les deux brouillons par mode et nettoie seulement la demande confirmée', async () => {
    const branch = (await harness.navigateByUrl('/creer', BpmCreatePage)) as any;
    await settle();
    Object.assign(branch.draft(), { mode: 'branch', branchName: 'Cuisine', visionLater: true, maxReached: 7 });
    branch.draft().tasks[0].title = 'Comparer les devis';
    branch.touch();
    const branchKey = branch.draft().requestKey;

    const life = (await harness.navigateByUrl('/creer/projet-de-vie', BpmCreatePage)) as any;
    await settle();
    expect(life.draft().mode).toBe('principal');
    expect(life.draft().requestKey).not.toBe(branchKey);
    life.draft().principalDescription = 'Mon cadrage à reprendre';
    life.touch();
    const lifeKey = life.draft().requestKey;

    const resumed = (await harness.navigateByUrl('/creer/projet-de-la-vie', BpmCreatePage)) as any;
    await settle();
    expect(resumed.draft().branchName).toBe('Cuisine');
    expect(resumed.draft().requestKey).toBe(branchKey);
    resumed.go(7);
    await settle();
    await resumed.confirm();
    await settle();
    expect(setup).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem('bpm-create-draft:user-A')).toBeNull();
    expect(sessionStorage.getItem('bpm-create-draft:user-A:branch')).toBeNull();
    const retained = JSON.parse(sessionStorage.getItem('bpm-create-draft:user-A:principal')!);
    expect(retained.requestKey).toBe(lifeKey);
    expect(retained.principalDescription).toBe('Mon cadrage à reprendre');
    const remaining = (await harness.navigateByUrl('/creer', BpmCreatePage)) as any;
    await settle();
    expect(remaining.draft().requestKey).toBe(lifeKey);
    expect(remaining.draft().principalDescription).toBe('Mon cadrage à reprendre');
  });
});

describe('assistant BPM : contrôles du formulaire réel', () => {
  it('conserve le choix d’un projet entre input et change, puis affiche ses champs', async () => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideLocationMocks(),
        provideRouter([{ path: 'creer', component: BpmCreatePage }]),
        { provide: BpmApi, useValue: { setupProfile: vi.fn().mockResolvedValue(profile) } },
      ],
    });
    // Seul le cadre de page est allégé : les contrôles et liaisons de l’assistant restent réels.
    TestBed.overrideComponent(BpmPageFrame, { set: { template: '<ng-content />' } });
    TestBed.inject(RecetteContext).userId.set('user-A');
    const harness = await RouterTestingHarness.create();
    const page = (await harness.navigateByUrl('/creer', BpmCreatePage)) as any;
    async function settle() {
      TestBed.tick();
      await harness.fixture.whenStable();
      harness.detectChanges();
    }
    await settle();
    page.next();
    await settle();
    const radio = harness.routeNativeElement!.querySelector<HTMLInputElement>('input[value="branch"]')!;
    radio.checked = true;
    radio.dispatchEvent(new Event('input', { bubbles: true }));
    // Une mise à jour de vue peut s’intercaler entre les deux événements natifs.
    await settle();
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(page.draft().mode).toBe('branch');
    expect(harness.routeNativeElement!.textContent).toContain('Nom du projet de la vie');
    const stored = JSON.parse(sessionStorage.getItem('bpm-create-draft:user-A')!);
    expect(stored.mode).toBe('branch');
  });

  it('affiche directement les champs du projet spécialisé et garde ce mode après un redémarrage du brouillon', async () => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideLocationMocks(),
        provideRouter([{ path: 'creer/projet-de-la-vie', component: BpmCreatePage, data: { workspace: { key: 'start-project', parent: '/creer', title: 'Nouveau projet', lead: '' } } }]),
        { provide: BpmApi, useValue: { setupProfile: vi.fn().mockResolvedValue(profile) } },
      ],
    });
    TestBed.overrideComponent(BpmPageFrame, { set: { template: '<ng-content />' } });
    TestBed.inject(RecetteContext).userId.set('user-A');
    const harness = await RouterTestingHarness.create();
    const page = (await harness.navigateByUrl('/creer/projet-de-la-vie', BpmCreatePage)) as any;
    async function settle() {
      TestBed.tick();
      await harness.fixture.whenStable();
      harness.detectChanges();
    }
    await settle();
    page.next();
    await settle();
    expect(harness.routeNativeElement!.querySelector('[role="radiogroup"]')).toBeNull();
    expect(harness.routeNativeElement!.textContent).toContain('Nom du projet de la vie');
    expect(harness.routeNativeElement!.textContent).not.toContain('Nom du Budget du projet de vie');
    const previousKey = page.draft().requestKey;
    page.restart();
    await settle();
    expect(page.draft().mode).toBe('branch');
    expect(page.draft().requestKey).not.toBe(previousKey);
    expect(page.draft().step).toBe(1);
  });
});
