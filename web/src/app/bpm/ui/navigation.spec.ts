import { Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { RecetteContext } from '../../core/api.service';
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
  it('garde une identité de visite dans l’historique navigateur et isole les profils et les zones', async () => {
    await harness.navigateByUrl('/app/gestion-projet', Page);
    expect((TestBed.inject(Location).getState() as any).bpmVisitId).toBeTruthy();
    await harness.navigateByUrl('/projet-de-vie', Page);
    expect(nav.previous()?.url).toBe('/app/gestion-projet');
    TestBed.inject(RecetteContext).userId.set('user-B');
    TestBed.tick();
    expect(nav.previous()).toBeNull();
    await harness.navigateByUrl('/socle/budget', Page);
    expect(nav.current()).toBeNull();
  });
});
