import { describe, expect, it } from 'vitest';
import { hasPageMenu, hasSectionHome, locate, menuPages, pageChildren, planContext, planTitle, planZone, PLAN_ZONES, sectionEntry, zoneHomeLink, zoneSections } from './site-plan';
import { PAGE_WORKSPACES } from './page-workspaces';

describe('plan du site', () => {
  it('range les zones : BPM-Astra d’abord, puis le socle et l’administration', () => {
    expect(PLAN_ZONES.map((z) => z.label)).toEqual(['BPM-Astra', 'Budget management', 'Patrimoine Management', 'Cycle et temps', 'Noyau transverse', 'Administration du site', 'Navigation system']);
    expect(planZone('bpm'), 'l’ancienne application BPM n’existe plus').toBeNull();
  });

  it('situe une page, un détail et l’accueil', () => {
    expect(locate('/')).toMatchObject({ kind: 'portal', zone: null });
    expect(locate('/bpm-astra')).toMatchObject({ kind: 'page', zone: { id: 'bpm-astra' }, section: { id: 'astra-0' }, page: { link: '/bpm-astra' } });
    expect(locate('/bpm-astra/mouvements/echeances')).toMatchObject({ kind: 'subpage', section: { id: 'astra-0' }, page: { link: '/bpm-astra/mouvements' }, subpage: { id: 'life-due' } });
    expect(locate('/bpm-astra/plafonds/std%3Alogement')).toMatchObject({ kind: 'detail', section: { id: 'astra-2' }, page: { link: '/bpm-astra/plafonds' } });
    expect(locate('/bpm-astra/projets/prj_1')).toMatchObject({ kind: 'detail', section: { id: 'astra-1' }, page: { link: '/bpm-astra/projets' } });
    expect(locate('/bpm-astra/cloture/compte')).toMatchObject({ kind: 'subpage', section: { id: 'astra-4' }, page: { link: '/bpm-astra/cloture' }, subpage: { id: 'reconciliation' } });
    expect(locate('/piloter').kind).toBe('none');
    expect(locate('/tasks')).toMatchObject({ zone: { id: 'noyau' }, section: { id: 'taches' } });
    expect(locate('/projects/abc')).toMatchObject({ kind: 'detail', detailLabel: 'Détail du projet' });
    expect(locate('/admin/calculs')).toMatchObject({ page: { id: 'calculs' } });
  });

  it('ouvre chaque zone sur son accueil et chaque section sur son accueil ou sa page utile', () => {
    const astra = planZone('bpm-astra')!;
    expect(zoneHomeLink(astra)).toBe('/bpm-astra');
    expect(astra.sections.map((s) => sectionEntry(astra, s).link)).toEqual(['/bpm-astra', '/bpm-astra/projets', '/bpm-astra/budget', '/bpm-astra/objectif', '/bpm-astra/cloture']);
    expect(zoneSections(astra, true).map((s) => s.id)).toEqual(['astra-0', 'astra-1', 'astra-2', 'astra-3', 'astra-4']);
    const admin = planZone('administration')!;
    const parametres = admin.sections.find((s) => s.id === 'parametres')!;
    expect(hasSectionHome(parametres)).toBe(true);
    expect(sectionEntry(admin, parametres).link).toBe('/zones/administration/parametres');
    expect(locate('/zones/administration/parametres')).toMatchObject({ kind: 'section', section: { id: 'parametres' } });
    expect(locate('/zones/inconnue')).toMatchObject({ kind: 'unknown' });
  });





  it('rattache chaque vue spécialisée à une page principale visible du même plan', () => {
    for (const view of PAGE_WORKSPACES) {
      const path = '/' + view.path.replace(':id', 'prj_test');
      const at = locate(path + '?period=2026-10');
      // Navigation system v2 : une route déclarée comme page est une page du plan, pas une sous-page.
      if (view.page) { expect(at.kind, path).toBe('page'); continue; }
      expect(at.kind, path).toBe('subpage');
      expect(at.page?.link, path).toBe(view.parent);
      expect(at.page?.hidden, path).not.toBe(true);
      expect(at.subpage?.label, path).toBe(view.label);
      // Une vue ouverte par un bouton ou un geste garde son contexte, sans entrée de menu.
      expect(pageChildren(at.page!, path).some(child => child.link === path), path).toBe(view.menu !== false);
    }
  });

  it('propose le détail courant sans exposer un identifiant de projet non résolu', () => {
    const page = locate('/bpm-astra/projets').page!;
    expect(pageChildren(page).some(child => child.link.includes(':id'))).toBe(false);
    expect(pageChildren(page, '/bpm-astra/projets/prj_42').find(child => child.id === 'project-budget')?.link).toBe('/bpm-astra/projets/prj_42/budget');
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
    const page = planContext('/bpm-astra/plafonds?period=2026-10');
    expect(page.eyebrow).toBe('Mon budget');
    expect(page.up).toBeNull();
    expect(page.tabs.map(t => [t.label, t.current])).toEqual([['Vue principale', true], ['Postes et revenus', false]]);
    expect(page.crumbs.map(c => c.label)).toEqual(['BPM-Astra', 'Mon budget', 'Plafonds']);
    expect(page.crumbs.at(-1)!.link).toBeUndefined();
    const sub = planContext('/bpm-astra/plafonds/postes');
    expect(sub.eyebrow).toBe('Mon budget · Plafonds');
    expect(sub.up).toEqual({ label: 'Plafonds', link: '/bpm-astra/plafonds' });
    expect(sub.tabs.find(t => t.current)?.label).toBe('Postes et revenus');
  });



  it('nomme la fiche ouverte et range ses sous-pages en onglets', () => {
    const fiche = planContext('/bpm-astra/projets/prj_42?period=2026-10', 'Cuisine');
    expect(fiche.location.object).toMatchObject({ kind: 'project', id: 'prj_42', link: '/bpm-astra/projets/prj_42' });
    expect(fiche.crumbs.map(c => c.label)).toEqual(['BPM-Astra', 'Mes projets', 'Projets de la vie', 'Cuisine']);
    expect(fiche.up).toEqual({ label: 'Projets de la vie', link: '/bpm-astra/projets' });
    expect(fiche.tabs.map(t => [t.label, t.current])).toEqual([['Vue d’ensemble', true], ['Budget et décisions', false], ['Tâches', false]]);
    const budget = planContext('/bpm-astra/projets/prj_42/budget', 'Cuisine');
    expect(budget.up).toEqual({ label: 'Cuisine', link: '/bpm-astra/projets/prj_42' });
    expect(budget.crumbs.map(c => c.label).slice(-2)).toEqual(['Cuisine', 'Budget du projet']);
    expect(budget.eyebrow).toBe('Mes projets · Projets de la vie');
    const menu = pageChildren(locate('/bpm-astra/projets').page!, '/bpm-astra/projets/prj_42/taches', 'Cuisine');
    expect(menu.map(c => [c.label, c.depth])).toEqual([['Règlements par cycle', 1], ['Cuisine', 1], ['Budget du projet', 2], ['Tâches du projet', 2]]);
  });

  it('rattache un détail à sa page et donne le chemin de retour', () => {
    const detail = planContext('/bpm-astra/plafonds/std%3Aloisirs');
    expect(detail.up).toEqual({ label: 'Plafonds', link: '/bpm-astra/plafonds' });
    expect(detail.tabs).toEqual([]);
    expect(detail.crumbs.at(-1)!.label).toBe('Détail du poste');
  });
});
