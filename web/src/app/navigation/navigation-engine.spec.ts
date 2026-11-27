import { describe, expect, it } from 'vitest';
import { auditNavigation, navigationLoop, AppNavigation } from './navigation-engine';
import { applicationModules, applicationNavigation } from '../plan/application-navigation';
import { planZone } from '../plan/site-plan';
import { APPLICATIONS_INSCRITES } from '../sections/inscriptions';

describe('Navigation system · moteur des modules applicatifs', () => {
  it('BPM-Astra est d’équerre pour un utilisateur connecté comme pour un visiteur', () => {
    expect(applicationModules()).toEqual(['bpm-astra']);
    for (const connected of [true, false]) {
      const nav = applicationNavigation('bpm-astra', connected)!;
      expect(auditNavigation(nav), connected ? 'connecté' : 'visiteur').toEqual([]);
    }
  });
  it('organise les quatre parties numérotées de BPM-Astra', () => {
    const nav = applicationNavigation('bpm-astra')!;
    expect(nav.sections.map((s) => `${s.mark} ${s.label}`)).toEqual(['01 Mon quotidien', '02 Mes projets', '03 Mon budget', '04 Patrimoine', '05 Cycles']);
    expect(planZone('bpm-astra')!.sections.map(section => section.tone)).toEqual(['astra-quotidien', 'astra-projets', 'astra-budget', 'astra-patrimoine', 'astra-cycles']);
  });
  it('chaque partie range ses pages dans l’ordre du menu, l’accueil en tête du quotidien', () => {
    const nav = applicationNavigation('bpm-astra')!;
    expect(nav.sections[0].pages.map((p) => p.link)).toEqual(['/bpm-astra', '/bpm-astra/mouvements', '/bpm-astra/calendrier']);
    // Pages du socle d'abord, puis celles des applications autonomes inscrites dans la section.
    const inscrites = APPLICATIONS_INSCRITES.filter((a) => a.section === 'projets').flatMap((a) => a.pages.map((p) => '/bpm-astra/' + p.slug));
    expect(nav.sections[1].pages.map((p) => p.link)).toEqual(['/bpm-astra/projets', '/bpm-astra/taches', ...inscrites]);
    expect(nav.sections[2].pages.map((p) => p.link)).toEqual(['/bpm-astra/budget', '/bpm-astra/plafonds']);
    expect(nav.sections[3].pages[0].link).toBe('/bpm-astra/objectif');
  });
  it('parcourt la boucle de toutes les sous-pages, sans adresse en double', () => {
    const loop = navigationLoop(applicationNavigation('bpm-astra')!);
    expect(new Set(loop.map((entry) => entry.subpage.link)).size).toBe(loop.length);
    expect(loop[0].subpage.link).toBe('/bpm-astra');
    expect(loop.some((entry) => entry.subpage.link === '/bpm-astra/cloture/compte')).toBe(true);
  });
  it('signale ce qui manque à une navigation incomplète', () => {
    const broken: AppNavigation = { module: 'demo', label: 'Démo', sections: [
      { id: 'vide', mark: '01', label: 'Vide', tone: '', pages: [] },
      { id: 'a', mark: '02', label: 'A', tone: '', pages: [{ link: '/a', label: 'A', subpages: [
        { link: '/a', label: 'Accueil', home: true, actions: [], anchors: [] },
        { link: '/a/b', label: 'B', home: false, actions: [], anchors: [{ id: 'x', label: 'X' }, { id: 'x', label: 'Y' }] },
        { link: '/a/c', label: 'C', home: false, actions: [], anchors: [] },
      ] }] },
    ] };
    expect(auditNavigation(broken).map((f) => f.rule).sort()).toEqual(['N2', 'N4', 'N5', 'N6']);
  });
});
