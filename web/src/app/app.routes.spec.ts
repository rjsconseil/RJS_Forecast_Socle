import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Component } from '@angular/core';
import { routes } from './app.routes';
import { PAGE_WORKSPACES } from './shared/page-workspaces';
import { RecetteContext } from './core/api.service';

// Destinations BPM adressables directement et redirections des anciens liens (spec §4).
describe('routes BPM', () => {
  const find = (path: string) => routes.find((r) => r.path === path);

  it('déclare chaque destination de la section Ma vision budgétaire et Démarrer un projet', () => {
    for (const path of ['creer', 'tableau-de-bord', 'projet-de-vie', 'depenses/registre', 'plafonds', 'piloter', 'piloter/agir', 'vision', 'tableau-de-bord/entrees', 'argent/postes/:poste', 'tableau-de-bord/rapprochement', 'utilisateurs', 'app/gestion-projet', 'app/gestion-projet/:id']) {
      const r = find(path);
      expect(r, path).toBeTruthy();
      expect(r!.loadComponent, path).toBeTypeOf('function');
      expect(r!.title, path).toBeTruthy();
    }
  });

  it('réserve « Démarrer un projet » au visiteur : un user connecté retrouve la gestion de son projet de vie', () => {
    for (const path of ['creer', 'creer/projet-de-vie']) {
      const guard = find(path)!.canActivate![0] as () => unknown;
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [provideRouter([])] });
      const ctx = TestBed.inject(RecetteContext);
      ctx.userId.set(null);
      expect(TestBed.runInInjectionContext(guard), path).toBe(true);
      ctx.userId.set('usr_1');
      expect(String(TestBed.runInInjectionContext(guard)), path).toBe('/projet-de-vie');
    }
    expect(find('creer/projet-de-la-vie'), 'plus de projet de la vie depuis Démarrer').toBeUndefined();
  });

  it('ouvre l’accueil des zones à la racine', () => {
    expect(find('')?.loadComponent).toBeTruthy();
    expect(find('**')?.redirectTo).toBe('');
  });

  it('enregistre chaque vue une seule fois avant les paramètres dynamiques', () => {
    for (const view of PAGE_WORKSPACES) {
      const registered = routes.filter(route => route.path === view.path);
      expect(registered, view.path).toHaveLength(1);
      expect(registered[0].data?.['workspace']?.key, view.path).toBe(view.key);
      expect(registered[0].loadComponent, view.path).toBeTypeOf('function');
    }
    for (const [specific, dynamic] of [['app/gestion-projet/nouveau', 'app/gestion-projet/:id'], ['projects/planning', 'projects/:id'], ['admin/calculs/references', 'admin/calculs/:key']])
      expect(routes.indexOf(find(specific)!)).toBeLessThan(routes.indexOf(find(dynamic)!));
    expect(routes.at(-1)?.path).toBe('**');
  });

  it('hérite de la configuration du bon calendrier', () => {
    for (const parent of ['calendrier', 'calendrier-budget', 'patrimoine/calendrier'])
      for (const mode of parent === 'calendrier-budget' ? ['agenda'] : ['agenda', 'sources']) expect(find(`${parent}/${mode}`)?.data?.['calendar']).toBe(find(parent)?.data?.['calendar']);
  });

  it('mène l’ancienne page des sources du calendrier BPM au dépliant « Sources et affichage »', async () => {
    @Component({ template: '' })
    class Empty {}
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'calendrier-budget', component: Empty }, find('calendrier-budget/sources')!])],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/calendrier-budget/sources?vue=semaine');
    expect(router.url).toBe('/calendrier-budget?vue=semaine#sources-et-affichage');
  });

  it('déclare les accueils génériques de zone et de section', () => {
    for (const path of ['zones/:zone', 'zones/:zone/:section']) {
      const r = find(path);
      expect(r?.loadComponent, path).toBeTypeOf('function');
      expect(r?.title, path).toBeTypeOf('function');
    }
  });

  it('redirige les anciens liens de l’application', () => {
    expect(find('app')?.redirectTo).toBe('tableau-de-bord');
    expect(find('app/operations')?.redirectTo).toBe('depenses');
    expect(find('app/bienvenue')?.redirectTo).toBe('utilisateurs');
  });

  it('garde le socle, Object Management et l’Administration distincts de l’espace métier', () => {
    for (const path of ['projects', 'tasks', 'socle/budget', 'socle/patrimoine', 'object-management', 'admin']) expect(find(path), path).toBeTruthy();
  });

  it('donne une seule adresse à chaque écran et y conduit les anciennes en gardant la lecture', async () => {
    @Component({ template: '' })
    class Blank {}
    const kept = ['depenses', 'argent/entrees', 'argent/reste', 'app/projets/:id'].map((path) => find(path)!);
    for (const route of kept) expect(route.loadComponent, route.path).toBeUndefined();
    TestBed.configureTestingModule({
      providers: [provideRouter([
        ...kept,
        ...['depenses/registre', 'tableau-de-bord/entrees', 'tableau-de-bord/rapprochement', 'app/gestion-projet/:id'].map((path) => ({ path, component: Blank })),
      ])],
    });
    const router = TestBed.inject(Router);
    for (const [from, to] of [
      ['/depenses?period=2026-10&direction=income', '/depenses/registre?period=2026-10&direction=income'],
      ['/argent/entrees?period=2026-09', '/tableau-de-bord/entrees?period=2026-09'],
      ['/argent/reste?period=2026-09#ecart', '/tableau-de-bord/rapprochement?period=2026-09#ecart'],
      ['/app/projets/prj_42?task=tsk_1', '/app/gestion-projet/prj_42?task=tsk_1'],
    ]) {
      await router.navigateByUrl(from);
      expect(router.url, from).toBe(to);
    }
  });

  it('conserve les paramètres d’un ancien lien redirigé', async () => {
    @Component({ template: '' })
    class Blank {}
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'depenses', component: Blank }, { path: 'app/operations', redirectTo: 'depenses' }])],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/app/operations?period=2026-10&q=loyer');
    expect(router.url).toBe('/depenses?period=2026-10&q=loyer');
  });
});
