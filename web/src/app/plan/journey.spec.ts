import { Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { RecetteContext } from '../core/api.service';
import { PageObjectLabels } from './plan-context';
import { Journey } from './journey';
import { BpmPageContext } from '../bpm/ui/page-context';
import { bpmQueryState } from '../bpm/ui/query-state';

@Component({ template: '', providers: [BpmPageContext] })
class Page {
  query = bpmQueryState('q', '', { replace: true });
  filter = bpmQueryState('filter', 'all');
  context = inject(BpmPageContext);
}

describe('coordination des pages BPM', () => {
  let harness: RouterTestingHarness;
  let nav: Journey;
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
          { path: 'bpm-astra/projets', component: Page },
          { path: 'bpm-astra/projets/:id', component: Page },
          { path: 'bpm-astra', component: Page },
          { path: 'socle/budget', component: Page },
          { path: '', component: Page },
        ]),
        provideLocationMocks(),
      ],
    });
    TestBed.inject(RecetteContext).userId.set('user-A');
    nav = TestBed.inject(Journey);
    router = TestBed.inject(Router);
    router.setUpLocationChangeListener();
    harness = await RouterTestingHarness.create();
  });
  it('retrouve les filtres après liste → projet → projet de vie puis deux retours et deux reprises', async () => {
    await harness.navigateByUrl('/bpm-astra/projets?q=travaux&filter=open', Page);
    await harness.navigateByUrl('/bpm-astra/projets/prj_1', Page);
    await harness.navigateByUrl('/bpm-astra?period=2026-10', Page);
    nav.back();
    await settle();
    expect(router.url).toBe('/bpm-astra/projets/prj_1');
    nav.back();
    await settle();
    expect(router.url).toBe('/bpm-astra/projets?q=travaux&filter=open');
    expect((harness.routeDebugElement!.componentInstance as Page).query()).toBe('travaux');
    nav.forward();
    await settle();
    nav.forward();
    await settle();
    expect(router.url).toBe('/bpm-astra?period=2026-10');
  });
  it('fusionne les remises à zéro de plusieurs filtres sans perdre les autres paramètres', async () => {
    const page = await harness.navigateByUrl(
      '/bpm-astra/projets?q=travaux&filter=open&period=2026-10',
      Page,
    );
    page.query.set('');
    page.filter.set('all');
    await settle();
    expect(router.url).toBe('/bpm-astra/projets?period=2026-10');
  });
  it('suit les pages de tous les modules dans un seul parcours', async () => {
    await harness.navigateByUrl('/bpm-astra', Page);
    await harness.navigateByUrl('/socle/budget', Page);
    expect(nav.visits().map((v) => v.url)).toEqual(['/bpm-astra', '/socle/budget']);
    expect(nav.previous()?.url).toBe('/bpm-astra');
  });
  it('garde une identité de visite dans l’historique navigateur et isole les profils', async () => {
    await harness.navigateByUrl('/bpm-astra/projets', Page);
    expect((TestBed.inject(Location).getState() as any).journeyVisitId).toBeTruthy();
    await harness.navigateByUrl('/bpm-astra', Page);
    expect(nav.previous()?.url).toBe('/bpm-astra/projets');
    TestBed.inject(RecetteContext).userId.set('user-B');
    TestBed.tick();
    expect(nav.previous()).toBeNull();
  });
  it('un passage par le portail ne crée pas d’étape et ne fait rien perdre', async () => {
    await harness.navigateByUrl('/bpm-astra/projets', Page);
    await harness.navigateByUrl('/bpm-astra', Page);
    await harness.navigateByUrl('/', Page);
    expect(nav.current()?.url).toBe('/bpm-astra');
    await harness.navigateByUrl('/bpm-astra/projets/prj_1', Page);
    expect(nav.visits().map((v) => v.url)).toEqual(['/bpm-astra/projets', '/bpm-astra', '/bpm-astra/projets/prj_1']);
    nav.back();
    await settle();
    // Le navigateur garderait le portail : le parcours rejoint directement l’étape précédente.
    expect(router.url).toBe('/bpm-astra');
  });
  it('revient de trois étapes, avance par un lien de la page, puis rejoint la dernière étape atteinte', async () => {
    await harness.navigateByUrl('/bpm-astra/projets', Page);
    await harness.navigateByUrl('/bpm-astra/projets/prj_1', Page);
    await harness.navigateByUrl('/bpm-astra', Page);
    await harness.navigateByUrl('/bpm-astra?period=2026-10', Page);
    for (let i = 0; i < 3; i++) {
      nav.back();
      await settle();
    }
    expect(router.url).toBe('/bpm-astra/projets');
    expect(nav.ahead()).toBe(3);
    await harness.navigateByUrl('/bpm-astra/projets/prj_1', Page);
    expect(nav.ahead()).toBe(2);
    nav.forward();
    await settle();
    expect(router.url).toBe('/bpm-astra');
    nav.jump(nav.visits().length - 1);
    await settle();
    expect(router.url).toBe('/bpm-astra?period=2026-10');
    nav.jump(0);
    await settle();
    expect(router.url).toBe('/bpm-astra/projets');
    expect(nav.visits()).toHaveLength(4);
  });
  it('retire les étapes d’un parcours confirmé : « Retour » ramène à la page d’avant', async () => {
    await harness.navigateByUrl('/bpm-astra/projets', Page);
    await harness.navigateByUrl('/bpm-astra/projets/prj_1', Page);
    nav.completeFlow((url) => url.startsWith('/bpm-astra/projets/'));
    await router.navigateByUrl('/bpm-astra', { state: { journeyNotice: 'Projet enregistré.' } });
    await settle();
    expect(nav.notice()).toBe('Projet enregistré.');
    await router.navigateByUrl('/bpm-astra?expanded=indispensable', { replaceUrl: true });
    await settle();
    expect(nav.notice()).toBe('Projet enregistré.');
    nav.back();
    await settle();
    expect(router.url).toBe('/bpm-astra/projets');
    expect(nav.visits().map((v) => v.url)).toEqual(['/bpm-astra/projets', '/bpm-astra?expanded=indispensable']);
  });
  it('ouvrir une autre adresse au chargement (favori, adresse tapée) ajoute une étape, recharger la même la garde', async () => {
    sessionStorage.setItem(
      'rjs-journey:user-B',
      JSON.stringify({
        visits: [
          { id: 'liste', url: '/bpm-astra/projets', label: 'Projets et financement' },
          { id: 'fiche', url: '/bpm-astra/projets/prj_1', label: 'Fiche du projet' },
        ],
        cursor: 1,
      }),
    );
    TestBed.inject(RecetteContext).userId.set('user-B');
    TestBed.tick();
    expect(router.navigated).toBe(false);
    await router.navigateByUrl('/bpm-astra', { replaceUrl: true });
    await settle();
    expect(nav.visits().map((v) => v.id).slice(0, 2)).toEqual(['liste', 'fiche']);
    expect(nav.visits()).toHaveLength(3);
    expect(nav.cursor()).toBe(2);
    nav.back();
    await settle();
    expect(router.url).toBe('/bpm-astra/projets/prj_1');
  });
  it('garde le nom d’une fiche dans le parcours quand la page ne le publie plus (rechargement)', async () => {
    const labels = TestBed.inject(PageObjectLabels);
    await harness.navigateByUrl('/bpm-astra/projets/prj_1', Page);
    labels.set('/bpm-astra/projets/prj_1', 'Vacances en Bretagne');
    await settle();
    await harness.navigateByUrl('/bpm-astra', Page);
    labels.set('/bpm-astra/projets/prj_1', null);
    await settle();
    expect(nav.visits()[0].label).toBe('Vacances en Bretagne');
    nav.back();
    await settle();
    expect(router.url).toBe('/bpm-astra/projets/prj_1');
    expect(nav.current()?.label).toBe('Vacances en Bretagne');
  });
});
