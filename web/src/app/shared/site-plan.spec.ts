import { describe, expect, it } from 'vitest';
import { hasPageMenu, hasSectionHome, locate, menuPages, pageChildren, planTitle, planZone, PLAN_ZONES, sectionEntry, zoneHomeLink } from './site-plan';
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
    for (const link of ['/depenses']) {
      expect(locate(link)).toMatchObject({ kind: 'page', zone: { id: 'bpm' }, section: { id: 'vision' }, page: { hidden: true } });
    }
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
});
