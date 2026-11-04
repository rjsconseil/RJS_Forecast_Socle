import { describe, expect, it } from 'vitest';
import { hasSectionHome, locate, planTitle, planZone, PLAN_ZONES, sectionEntry, zoneHomeLink } from './site-plan';

describe('plan du site', () => {
  it('range les zones de l’accueil : BPM, Budget, Patrimoine, Noyau transverse, Administration', () => {
    expect(PLAN_ZONES.map((z) => z.label)).toEqual(['Budget/Patrimoine Management', 'Budget management', 'Patrimoine Management', 'Noyau transverse', 'Administration du site']);
    expect(PLAN_ZONES.find((z) => z.id === 'bpm')!.assembles).toEqual(['budget', 'patrimoine']);
  });

  it('situe une page, un détail et l’accueil', () => {
    expect(locate('/')).toMatchObject({ kind: 'portal', zone: null });
    expect(locate('/piloter/agir')).toMatchObject({ kind: 'page', zone: { id: 'bpm' }, section: { id: 'vision' }, page: { id: 'agir' } });
    expect(locate('/piloter')).toMatchObject({ page: { id: 'piloter' } });
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

  it('titre les accueils génériques', () => {
    expect(planTitle('administration', 'parametres')).toBe('Administration · Administration du site · RJS Forecast');
    expect(planTitle('noyau')).toBe('Noyau transverse · RJS Forecast');
    expect(planTitle('x')).toBe('Destination introuvable · RJS Forecast');
  });
});
