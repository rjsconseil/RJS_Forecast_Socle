import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Component } from '@angular/core';
import { routes } from './app.routes';
import { RecetteContext } from './core/api.service';
import { BPM_LEGACY_PATHS } from './bpm/bpm.screens';

@Component({ template: '' })
class Blank {}

// BPM-Astra est l'application BPM du site et son module par défaut. Les anciennes adresses de BPM
// mènent toutes à leur équivalent Astra, en gardant la lecture (période, filtres, fragment).
describe('routes du site · BPM-Astra par défaut', () => {
  const find = (path: string) => routes.find((r) => r.path === path);

  it('ouvre BPM-Astra à la racine et garde le portail des zones dans « Tous les modules »', async () => {
    expect(find('modules')?.loadComponent).toBeTypeOf('function');
    expect(find('**')?.redirectTo).toBe('');
    TestBed.configureTestingModule({ providers: [provideRouter([find('')!, { path: 'bpm-astra', component: Blank }])] });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?period=2026-10');
    expect(router.url).toBe('/bpm-astra?period=2026-10');
  });

  it('réserve « Démarrer un projet » au visiteur : un user connecté retrouve l’application par défaut', () => {
    for (const path of ['creer', 'creer/projet-de-vie']) {
      const guard = find(path)!.canActivate![0] as () => unknown;
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [provideRouter([])] });
      const ctx = TestBed.inject(RecetteContext);
      ctx.userId.set(null);
      expect(TestBed.runInInjectionContext(guard), path).toBe(true);
      ctx.userId.set('usr_1');
      expect(String(TestBed.runInInjectionContext(guard)), path).toBe('/');
    }
  });

  it('ne sert plus aucun écran à une ancienne adresse BPM : chacune est une redirection', () => {
    for (const path of BPM_LEGACY_PATHS) {
      const r = find(path);
      expect(r, path).toBeTruthy();
      expect(r!.loadComponent, path).toBeUndefined();
      expect(r!.redirectTo, path).toBeTypeOf('function');
    }
  });

  it('conduit les anciennes adresses à leur équivalent Astra en gardant la lecture', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([...BPM_LEGACY_PATHS.map((path) => find(path)!), { path: '**', component: Blank }])] });
    const router = TestBed.inject(Router);
    for (const [from, to] of [
      ['/tableau-de-bord/entrees?period=2026-10&direction=income', '/bpm-astra/mouvements?period=2026-10&direction=income'],
      ['/depenses?period=2026-10', '/bpm-astra/mouvements?period=2026-10'],
      ['/argent/reste?period=2026-09#ecart', '/bpm-astra/cloture?period=2026-09#ecart'],
      ['/projet-de-vie?period=2026-09', '/bpm-astra?period=2026-09'],
      ['/projet-de-vie/projets', '/bpm-astra/projets'],
      ['/projet-de-vie/financement', '/bpm-astra/projets'],
      ['/app/gestion-projet/prj_42?task=tsk_1', '/bpm-astra/projets/prj_42?task=tsk_1'],
      ['/app/gestion-projet/prj_42/budget', '/bpm-astra/projets/prj_42/budget'],
      ['/app/projets/prj_42', '/bpm-astra/projets/prj_42'],
      ['/argent/postes/std:logement', '/bpm-astra/plafonds/std:logement'],
      ['/vision', '/bpm-astra/objectif/echeances'],
      ['/vision/projection', '/bpm-astra/objectif'],
      ['/meteo/tendances', '/bpm-astra'],
      ['/calendrier-budget/sources?vue=semaine', '/bpm-astra/calendrier?vue=semaine'],
      ['/app/reglages/postes', '/bpm-astra/plafonds/postes'],
      ['/zones/bpm', '/bpm-astra'],
    ]) {
      await router.navigateByUrl(from);
      expect(router.url, from).toBe(to);
    }
  });

  it('hérite de la configuration du bon calendrier', () => {
    for (const parent of ['calendrier', 'patrimoine/calendrier'])
      for (const mode of ['agenda', 'sources']) expect(find(`${parent}/${mode}`)?.data?.['calendar']).toBe(find(parent)?.data?.['calendar']);
  });

  it('déclare les accueils génériques de zone et de section', () => {
    for (const path of ['zones/:zone', 'zones/:zone/:section']) {
      const r = find(path);
      expect(r?.loadComponent, path).toBeTypeOf('function');
      expect(r?.title, path).toBeTypeOf('function');
    }
  });

  it('garde le socle, Object Management et l’Administration distincts de l’espace métier', () => {
    for (const path of ['projects', 'tasks', 'socle/budget', 'socle/patrimoine', 'object-management', 'admin', 'utilisateurs']) expect(find(path), path).toBeTruthy();
  });
});
