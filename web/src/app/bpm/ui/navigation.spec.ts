import { Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { RecetteContext } from '../../core/api.service';
import { PageObjectLabels } from '../../shared/plan-context';
import { BpmNavigation } from './navigation';
import { BpmPageContext } from './page-context';
import { bpmQueryState } from './query-state';

@Component({ template: '', providers: [BpmPageContext] })
class Page {
  query = bpmQueryState('q', '', { replace: true });
  filter = bpmQueryState('filter', 'all');
  context = inject(BpmPageContext);
}

describe('coordination des pages BPM', () => {
  let harness: RouterTestingHarness;
  let nav: BpmNavigation;
  let router: Router;
  async function settle() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    TestBed.tick();
    await harness.fixture.whenStable();
  }
  beforeEach(async () => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'app/gestion-projet', component: Page },
          { path: 'app/gestion-projet/:id', component: Page },
          { path: 'projet-de-vie', component: Page },
          { path: 'socle/budget', component: Page },
        ]),
        provideLocationMocks(),
      ],
    });
    TestBed.inject(RecetteContext).userId.set('user-A');
    nav = TestBed.inject(BpmNavigation);
    router = TestBed.inject(Router);
    router.setUpLocationChangeListener();
    harness = await RouterTestingHarness.create();
  });
  it('retrouve les filtres après liste → projet → projet de vie puis deux retours et deux reprises', async () => {
    await harness.navigateByUrl('/app/gestion-projet?q=travaux&filter=open', Page);
    await harness.navigateByUrl('/app/gestion-projet/prj_1', Page);
    await harness.navigateByUrl('/projet-de-vie?period=2026-10', Page);
    nav.back();
    await settle();
    expect(router.url).toBe('/app/gestion-projet/prj_1');
    nav.back();
    await settle();
    expect(router.url).toBe('/app/gestion-projet?q=travaux&filter=open');
    expect((harness.routeDebugElement!.componentInstance as Page).query()).toBe('travaux');
    nav.forward();
    await settle();
    nav.forward();
    await settle();
    expect(router.url).toBe('/projet-de-vie?period=2026-10');
  });
  it('fusionne les remises à zéro de plusieurs filtres sans perdre les autres paramètres', async () => {
    const page = await harness.navigateByUrl(
      '/app/gestion-projet?q=travaux&filter=open&period=2026-10',
      Page,
    );
    page.query.set('');
    page.filter.set('all');
    await settle();
    expect(router.url).toBe('/app/gestion-projet?period=2026-10');
  });
  it('garde une identité de visite dans l’historique navigateur et isole les profils', async () => {
    await harness.navigateByUrl('/app/gestion-projet', Page);
    expect((TestBed.inject(Location).getState() as any).bpmVisitId).toBeTruthy();
    await harness.navigateByUrl('/projet-de-vie', Page);
    expect(nav.previous()?.url).toBe('/app/gestion-projet');
    TestBed.inject(RecetteContext).userId.set('user-B');
    TestBed.tick();
    expect(nav.previous()).toBeNull();
  });
  it('une excursion hors de BPM ne crée pas d’étape et ne fait rien perdre', async () => {
    await harness.navigateByUrl('/app/gestion-projet', Page);
    await harness.navigateByUrl('/projet-de-vie', Page);
    await harness.navigateByUrl('/socle/budget', Page);
    expect(nav.current()?.url).toBe('/projet-de-vie');
    await harness.navigateByUrl('/app/gestion-projet/prj_1', Page);
    expect(nav.visits().map((v) => v.url)).toEqual(['/app/gestion-projet', '/projet-de-vie', '/app/gestion-projet/prj_1']);
    nav.back();
    await settle();
    // Le navigateur garderait la page du socle : le parcours rejoint directement l’étape BPM précédente.
    expect(router.url).toBe('/projet-de-vie');
  });
  it('revient de trois étapes, avance par un lien de la page, puis rejoint la dernière étape atteinte', async () => {
    await harness.navigateByUrl('/app/gestion-projet', Page);
    await harness.navigateByUrl('/app/gestion-projet/prj_1', Page);
    await harness.navigateByUrl('/projet-de-vie', Page);
    await harness.navigateByUrl('/projet-de-vie?period=2026-10', Page);
    for (let i = 0; i < 3; i++) {
      nav.back();
      await settle();
    }
    expect(router.url).toBe('/app/gestion-projet');
    expect(nav.ahead()).toBe(3);
    await harness.navigateByUrl('/app/gestion-projet/prj_1', Page);
    expect(nav.ahead()).toBe(2);
    nav.forward();
    await settle();
    expect(router.url).toBe('/projet-de-vie');
    nav.jump(nav.visits().length - 1);
    await settle();
    expect(router.url).toBe('/projet-de-vie?period=2026-10');
    nav.jump(0);
    await settle();
    expect(router.url).toBe('/app/gestion-projet');
    expect(nav.visits()).toHaveLength(4);
  });
  it('retire les étapes d’un parcours confirmé : « Retour » ramène à la page d’avant', async () => {
    await harness.navigateByUrl('/app/gestion-projet', Page);
    await harness.navigateByUrl('/app/gestion-projet/prj_1', Page);
    nav.completeFlow((url) => url.startsWith('/app/gestion-projet/'));
    await router.navigateByUrl('/projet-de-vie', { state: { bpmNotice: 'Projet enregistré.' } });
    await settle();
    expect(nav.notice()).toBe('Projet enregistré.');
    await router.navigateByUrl('/projet-de-vie?expanded=indispensable', { replaceUrl: true });
    await settle();
    expect(nav.notice()).toBe('Projet enregistré.');
    nav.back();
    await settle();
    expect(router.url).toBe('/app/gestion-projet');
    expect(nav.visits().map((v) => v.url)).toEqual(['/app/gestion-projet', '/projet-de-vie?expanded=indispensable']);
  });
  it('ouvrir une autre adresse au chargement (favori, adresse tapée) ajoute une étape, recharger la même la garde', async () => {
    sessionStorage.setItem(
      'bpm-navigation:user-B',
      JSON.stringify({
        visits: [
          { id: 'liste', url: '/app/gestion-projet', label: 'Gestion de projet' },
          { id: 'fiche', url: '/app/gestion-projet/prj_1', label: 'Fiche du projet' },
        ],
        cursor: 1,
      }),
    );
    TestBed.inject(RecetteContext).userId.set('user-B');
    TestBed.tick();
    expect(router.navigated).toBe(false);
    await router.navigateByUrl('/projet-de-vie', { replaceUrl: true });
    await settle();
    expect(nav.visits().map((v) => v.id).slice(0, 2)).toEqual(['liste', 'fiche']);
    expect(nav.visits()).toHaveLength(3);
    expect(nav.cursor()).toBe(2);
    nav.back();
    await settle();
    expect(router.url).toBe('/app/gestion-projet/prj_1');
  });
  it('garde le nom d’une fiche dans le parcours quand la page ne le publie plus (rechargement)', async () => {
    const labels = TestBed.inject(PageObjectLabels);
    await harness.navigateByUrl('/app/gestion-projet/prj_1', Page);
    labels.set('/app/gestion-projet/prj_1', 'Vacances en Bretagne');
    await settle();
    await harness.navigateByUrl('/projet-de-vie', Page);
    labels.set('/app/gestion-projet/prj_1', null);
    await settle();
    expect(nav.visits()[0].label).toBe('Vacances en Bretagne');
    nav.back();
    await settle();
    expect(router.url).toBe('/app/gestion-projet/prj_1');
    expect(nav.current()?.label).toBe('Vacances en Bretagne');
  });
});
