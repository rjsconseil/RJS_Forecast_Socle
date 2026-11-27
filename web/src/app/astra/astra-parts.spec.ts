import { describe, expect, it } from 'vitest';
import { ASTRA_APPLICATION } from './astra.application';
import { astraLinkDoublesTab } from './astra-actions';
import { ASTRA_LINKS, ASTRA_ORDER, ASTRA_PARTS, ASTRA_TAB_LABELS, astraPartOf, astraTabsOf } from './astra-parts';

const routes = ASTRA_APPLICATION.routes.filter(r => !r.redirectTo);
const routed = new Set(routes.map(r => (r.path ?? '').replace(/^bpm-astra\/?/, '')));
const titleOf = (slug: string) => String(routes.find(r => r.path === ('bpm-astra/' + slug).replace(/\/$/, ''))?.title ?? '').replace(/ · BPM-Astra$/, '');
const slugs = Object.keys(ASTRA_TAB_LABELS);

describe('navigation secondaire de BPM-Astra', () => {
  it('chaque onglet mène à une page d’Astra qui a un écran', () => {
    for (const slug of slugs) expect(routed.has(slug), slug).toBe(true);
    for (const [a, b] of ASTRA_LINKS) expect([a, b].every(s => s in ASTRA_TAB_LABELS), `${a} ↔ ${b}`).toBe(true);
    expect([...ASTRA_ORDER].sort()).toEqual([...slugs].sort());
  });

  it('un onglet porte le nom de la page qu’il ouvre (ou son début)', () => {
    for (const slug of slugs.filter(s => !s.includes(':'))) expect(titleOf(slug).startsWith(ASTRA_TAB_LABELS[slug]), `${slug} : « ${titleOf(slug)} »`).toBe(true);
    for (const part of ASTRA_PARTS) for (const page of part.pages) expect(ASTRA_TAB_LABELS[page.slug], page.slug).toBe(page.label);
  });

  it('dans une partie, les onglets de la partie sont les mêmes sur toutes ses pages, dans l’ordre du menu', () => {
    for (const part of ASTRA_PARTS) {
      const pages = slugs.filter(s => !s.includes(':') && astraPartOf(s).key === part.key);
      const ownTabs = (slug: string) => astraTabsOf(slug).tabs.filter(t => t.part === part.key).map(t => t.slug);
      for (const slug of pages) expect(ownTabs(slug), slug).toEqual(ownTabs(pages[0]));
      // Les onglets de la partie viennent avant ceux des autres parties.
      for (const slug of pages) {
        const kinds = astraTabsOf(slug).tabs.map(t => t.part === part.key);
        expect(kinds.indexOf(false) === -1 || kinds.lastIndexOf(true) < kinds.indexOf(false), slug).toBe(true);
      }
    }
    expect(astraTabsOf('').tabs.filter(t => t.part === 'quotidien').map(t => t.label)).toEqual(['Mon projet de vie', 'Mouvements', 'Échéances', 'Calendrier', 'Agenda']);
  });

  it('aller et retour : si A propose B, B propose A (hors fiches, qui ne s’ouvrent que d’une fiche)', () => {
    for (const slug of slugs.filter(s => !s.includes(':'))) {
      for (const tab of astraTabsOf(slug).tabs) {
        if (tab.current || tab.slug.includes(':')) continue;
        expect(astraTabsOf(tab.slug).tabs.map(t => t.slug), `${tab.slug} → ${slug}`).toContain(slug);
      }
    }
  });

  it('chaque page a des voisines et se reconnaît dans ses onglets', () => {
    for (const slug of slugs) {
      const { tabs } = astraTabsOf(slug);
      expect(tabs.length, slug).toBeGreaterThanOrEqual(3);
      expect(tabs.filter(t => t.current).map(t => t.slug)).toEqual([slug]);
    }
  });

  it('la clôture garde ses étapes numérotées en tête, sur toutes les pages de Cycles', () => {
    for (const slug of ['cloture', 'cloture/compte', 'cloture/reglages', 'bilans']) {
      expect(astraTabsOf(slug).tabs.slice(0, 3).map(t => [t.slug, t.step]), slug).toEqual([['cloture/compte', 1], ['cloture', 2], ['bilans', 3]]);
    }
    // Une étape seule, ailleurs, n'a pas de numéro.
    expect(astraTabsOf('').tabs.find(t => t.slug === 'cloture/compte')?.step).toBeNull();
  });

  it('une fiche montre ses voisines de fiche, une liste ne les montre pas', () => {
    expect(astraTabsOf('projets/:id').tabs.map(t => t.slug)).toEqual(expect.arrayContaining(['projets', 'projets/:id/budget', 'projets/:id/taches', 'taches']));
    expect(astraTabsOf('projets').tabs.some(t => t.slug.includes(':'))).toBe(false);
  });


});

describe('liens des commandes d’un écran dans le cadre Astra', () => {
  const here = 'https://site.example/bpm-astra/mouvements';
  const tabs = new Set(['/bpm-astra/mouvements', '/bpm-astra/calendrier']);
  it('un lien vers une page déjà en onglet la double ; une action, une ancre, un autre site ou un lien gardé non', () => {
    expect(astraLinkDoublesTab('/bpm-astra/calendrier', here, tabs)).toBe(true);
    expect(astraLinkDoublesTab('/bpm-astra/calendrier?entry=1', here, tabs)).toBe(false);
    expect(astraLinkDoublesTab('/bpm-astra/calendrier#jour', here, tabs)).toBe(false);
    expect(astraLinkDoublesTab('/bpm-astra/budget', here, tabs)).toBe(false);
    expect(astraLinkDoublesTab('https://ailleurs.example/bpm-astra/calendrier', here, tabs)).toBe(false);
    expect(astraLinkDoublesTab('/bpm-astra/calendrier', here, tabs, true)).toBe(false);
  });
});
