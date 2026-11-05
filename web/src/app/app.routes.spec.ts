import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Component } from '@angular/core';
import { routes } from './app.routes';

// Destinations BPM adressables directement et redirections des anciens liens (spec §4).
describe('routes BPM', () => {
  const find = (path: string) => routes.find((r) => r.path === path);

  it('déclare chaque destination de la section Ma vision budgétaire et Démarrer un projet', () => {
    for (const path of ['creer', 'tableau-de-bord', 'projet-de-vie', 'depenses', 'plafonds', 'piloter', 'piloter/agir', 'vision', 'argent/entrees', 'argent/postes/:poste', 'argent/reste', 'utilisateurs', 'app/gestion-projet', 'app/gestion-projet/:id']) {
      const r = find(path);
      expect(r, path).toBeTruthy();
      expect(r!.loadComponent, path).toBeTypeOf('function');
      expect(r!.title, path).toBeTruthy();
    }
  });

  it('ouvre l’accueil des zones à la racine', () => {
    expect(find('')?.loadComponent).toBeTruthy();
    expect(find('**')?.redirectTo).toBe('');
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
