import { describe, expect, it } from 'vitest';
import { hasPageMenu, hasSectionHome, locate, menuPages, pageChildren, planContext, planTitle, planZone, PLAN_ZONES, sectionEntry, zoneHomeLink, zoneSections } from './site-plan';
import { PAGE_WORKSPACES } from './page-workspaces';

describe('plan du site', () => {
  it('range les zones de l’accueil : BPM, Budget, Patrimoine, Noyau transverse, Administration', () => {
    expect(PLAN_ZONES.map((z) => z.label)).toEqual(['Budget/Patrimoine Management', 'Budget management', 'Patrimoine Management', 'Noyau transverse', 'Administration du site']);
    expect(PLAN_ZONES.find((z) => z.id === 'bpm')!.assembles).toEqual(['budget', 'patrimoine']);
  });

  it('situe une page, un détail et l’accueil', () => {
    expect(locate('/')).toMatchObject({ kind: 'portal', zone: null });
    expect(locate('/piloter/agir')).toMatchObject({ kind: 'subpage', zone: { id: 'bpm' }, section: { id: 'vision' }, page: { id: 'projet-de-vie' }, subpage: { id: 'actions' } });
    expect(locate('/piloter')).toMatchObject({ page: { id: 'tableau-de-bord' }, subpage: { id: 'analysis' } });
    expect(locate('/projet-de-vie')).toMatchObject({ kind: 'page', zone: { id: 'bpm' }, section: { id: 'vision' }, page: { id: 'projet-de-vie' } });
    expect(locate('/plafonds')).toMatchObject({ kind: 'page', zone: { id: 'bpm' }, section: { id: 'vision' }, page: { id: 'plafonds', label: 'Plafonds et catégories' } });
    expect(locate('/argent/postes/std%3Alogement')).toMatchObject({ kind: 'detail', section: { id: 'vision' } });
    expect(locate('/tasks')).toMatchObject({ zone: { id: 'noyau' }, section: { id: 'taches' } });
    expect(locate('/projects/abc')).toMatchObject({ kind: 'detail', detailLabel: 'Détail du projet' });
    expect(locate('/admin/calculs')).toMatchObject({ page: { id: 'calculs' } });
    expect(locate('/app/gestion-projet')).toMatchObject({ zone: { id: 'bpm' }, section: { id: 'projets-vie' }, page: { id: 'gestion-projet' } });
    expect(locate('/app/gestion-projet/prj_1')).toMatchObject({ section: { id: 'projets-vie' }, page: { id: 'gestion-projet' } });
  });

  it('ouvre chaque zone sur son accueil et chaque section sur son accueil ou sa page utile', () => {
    const bpm = planZone('bpm')!;
    expect(zoneHomeLink(bpm)).toBe('/zones/bpm');
    expect(locate('/zones/bpm')).toMatchObject({ kind: 'zone', zone: { id: 'bpm' }, section: { id: 'ensemble' } });
    expect(sectionEntry(bpm, bpm.sections.find((s) => s.id === 'ensemble')!).link).toBe('/zones/bpm');
    expect(sectionEntry(bpm, bpm.sections.find((s) => s.id === 'vision')!).link).toBe('/tableau-de-bord');
    const admin = planZone('administration')!;
    const parametres = admin.sections.find((s) => s.id === 'parametres')!;
    expect(hasSectionHome(parametres)).toBe(true);
    expect(sectionEntry(admin, parametres).link).toBe('/zones/administration/parametres');
    expect(locate('/zones/administration/parametres')).toMatchObject({ kind: 'section', section: { id: 'parametres' } });
    expect(locate('/zones/inconnue')).toMatchObject({ kind: 'unknown' });
  });

  it('expose les objectifs comme quatrième page de Ma vision budgétaire', () => {
    const section = planZone('bpm')!.sections.find((s) => s.id === 'vision')!;
    expect(menuPages(section).map((p) => p.id)).toEqual(['tableau-de-bord', 'projet-de-vie', 'plafonds', 'vision']);
    expect(locate('/depenses/registre')).toMatchObject({ kind: 'subpage', page: { id: 'tableau-de-bord' }, subpage: { id: 'register' } });
  });

  it('rattache chaque vue spécialisée à une page principale visible du même plan', () => {
    for (const view of PAGE_WORKSPACES) {
      const path = '/' + view.path.replace(':id', 'prj_test');
      const at = locate(path + '?period=2026-10');
      expect(at.kind, path).toBe('subpage');
      expect(at.page?.link, path).toBe(view.parent);
      expect(at.page?.hidden, path).not.toBe(true);
      expect(at.subpage?.label, path).toBe(view.label);
      expect(pageChildren(at.page!, path).some(child => child.link === path), path).toBe(true);
    }
  });

  it('propose le détail courant sans exposer un identifiant de projet non résolu', () => {
    const page = locate('/app/gestion-projet').page!;
    expect(pageChildren(page).some(child => child.link.includes(':id'))).toBe(false);
    expect(pageChildren(page, '/app/gestion-projet/nouveau').some(child => child.id === 'project-budget')).toBe(false);
    expect(pageChildren(page, '/app/projets/prj_42').find(child => child.id === 'project-budget')?.link).toBe('/app/gestion-projet/prj_42/budget');
    expect(pageChildren(locate('/projects').page!, '/projects/prj_42/edit').at(-1)?.link).toBe('/projects/prj_42/edit');
  });

  it('ouvre les pages spécialisées des sections simples sans ajouter un accueil intermédiaire', () => {
    const budget = planZone('budget')!;
    const section = budget.sections.find(section => section.id === 'tests')!;
    expect(hasPageMenu(section)).toBe(true);
    expect(hasSectionHome(section)).toBe(false);
    expect(sectionEntry(budget, section).link).toBe('/socle/budget');
  });

  it('titre les accueils génériques', () => {
    expect(planTitle('administration', 'parametres')).toBe('Administration · Administration du site · RJS Forecast');
    expect(planTitle('noyau')).toBe('Noyau transverse · RJS Forecast');
    expect(planTitle('x')).toBe('Destination introuvable · RJS Forecast');
  });

  it('donne à chaque adresse le même contexte : surtitre, niveau supérieur, onglets et fil', () => {
    const page = planContext('/plafonds?period=2026-10');
    expect(page.eyebrow).toBe('Ma vision budgétaire');
    expect(page.up).toBeNull();
    expect(page.tabs.map(t => [t.label, t.current])).toEqual([['Suivi des plafonds', true], ['Définir les plafonds', false], ['Organiser les catégories', false]]);
    expect(page.crumbs.map(c => c.label)).toEqual(['Budget/Patrimoine Management', 'Ma vision budgétaire', 'Plafonds et catégories']);
    expect(page.crumbs.at(-1)!.link).toBeUndefined();

    const sub = planContext('/plafonds/categories');
    expect(sub.eyebrow).toBe('Ma vision budgétaire · Plafonds et catégories');
    expect(sub.up).toEqual({ label: 'Plafonds et catégories', link: '/plafonds' });
    expect(sub.tabs.find(t => t.current)?.label).toBe('Organiser les catégories');
    expect(sub.label).toBe('Organiser les catégories');
  });

  it('ne répète pas une page qui porte le nom de sa section', () => {
    expect(planContext('/creer').crumbs.map(c => c.label)).toEqual(['Budget/Patrimoine Management', 'Démarrer un projet']);
    expect(planContext('/creer/projet-de-vie').crumbs.map(c => c.label)).toEqual(['Budget/Patrimoine Management', 'Démarrer un projet', 'Créer mon projet de vie']);
    expect(planContext('/creer/projet-de-vie').eyebrow).toBe('Démarrer un projet');
  });

  it('ne montre « Démarrer un projet » qu’au visiteur non connecté', () => {
    const bpm = planZone('bpm')!;
    expect(zoneSections(bpm, false).map(s => s.id)).toContain('demarrer');
    expect(zoneSections(bpm, true).map(s => s.id)).not.toContain('demarrer');
    expect(zoneSections(bpm, true).map(s => s.id)).toEqual(['ensemble', 'vision', 'projets-vie', 'calendrier']);
  });

  it('nomme la fiche ouverte et range ses sous-pages en onglets', () => {
    const fiche = planContext('/app/gestion-projet/prj_42?period=2026-10', 'Cuisine');
    expect(fiche.location.object).toEqual({ kind: 'project', id: 'prj_42', link: '/app/gestion-projet/prj_42' });
    expect(fiche.crumbs.map(c => c.label)).toEqual(['Budget/Patrimoine Management', 'Mes projets de la vie', 'Gestion de projet', 'Cuisine']);
    expect(fiche.up).toEqual({ label: 'Gestion de projet', link: '/app/gestion-projet' });
    expect(fiche.tabs.map(t => [t.label, t.current])).toEqual([['Vue d’ensemble', true], ['Budget et décisions', false], ['Tâches', false]]);

    const budget = planContext('/app/gestion-projet/prj_42/budget', 'Cuisine');
    expect(budget.up).toEqual({ label: 'Cuisine', link: '/app/gestion-projet/prj_42' });
    expect(budget.crumbs.map(c => c.label).slice(-2)).toEqual(['Cuisine', 'Budget du projet']);
    expect(budget.eyebrow).toBe('Mes projets de la vie · Gestion de projet');
    expect(planContext('/app/gestion-projet/prj_42/budget').up?.label).toBe('Fiche du projet');

    const menu = pageChildren(locate('/app/gestion-projet').page!, '/app/gestion-projet/prj_42/taches', 'Cuisine');
    expect(menu.map(c => [c.label, c.depth])).toEqual([
      ['Créer un projet de la vie', 1], ['Attribuer les enveloppes', 1], ['Décider les financements', 1],
      ['Cuisine', 1], ['Budget du projet', 2], ['Tâches du projet', 2],
    ]);
  });

  it('rattache un détail à sa page et donne le chemin de retour', () => {
    const detail = planContext('/argent/postes/std%3Aloisirs');
    expect(detail.up).toEqual({ label: 'Tableau de bord', link: '/tableau-de-bord' });
    expect(detail.tabs).toEqual([]);
    expect(detail.crumbs.at(-1)!.label).toBe('Détail d’un poste');
  });
});
