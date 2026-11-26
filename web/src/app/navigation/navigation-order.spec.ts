import { afterEach, describe, expect, it } from 'vitest';
import { NavigationNode, filterTree, moveItem, orderItems, orderedChildren, reorder } from './navigation-model';
import { SITE_NAVIGATION } from '../plan/navigation-adapter';
import { PLAN_ZONES, menuPages, orderedZones, pageChildren, planContext, planZone, sectionEntry, zoneSections } from '../plan/site-plan';
import { planOrder } from '../plan/plan-order';

const leaf = (key: string, fixed = false): NavigationNode => ({ key, label: key, level: 'page', surfaces: ['primary'], fixed });
const parent: NavigationNode = { ...leaf('p'), children: [leaf('a'), leaf('b'), leaf('c'), leaf('fiche', true)] };
const walk = (nodes: NavigationNode[]): NavigationNode[] => nodes.flatMap(node => [node, ...walk(node.children ?? [])]);

describe('ordre des liens de navigation', () => {
  afterEach(() => planOrder.set({}));

  it('range selon l’ordre réglé et laisse les liens inconnus ou nouveaux à leur place d’origine', () => {
    expect(orderItems(['a', 'b', 'c'], key => key, ['c', 'zzz', 'a'])).toEqual(['c', 'a', 'b']);
    expect(orderItems(['a', 'b'], key => key)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 1, 9)).toEqual(['a', 'b', 'c']);
  });
  it('déplace un lien parmi ses voisins, garde les liens fixes en fin de liste et oublie un ordre revenu au plan', () => {
    let order = reorder({}, parent, 2, 0);
    expect(order).toEqual({ p: ['c', 'a', 'b'] });
    expect(orderedChildren(parent, order).map(node => node.key)).toEqual(['c', 'a', 'b', 'fiche']);
    order = reorder(order, parent, 0, 2);
    expect(order).toEqual({});
  });
  it('la recherche garde les parents des liens trouvés', () => {
    const found = filterTree([{ ...leaf('root'), children: [parent] }], node => node.key === 'b');
    expect(found[0].children?.[0].children?.map(node => node.key)).toEqual(['b']);
  });
  it('déclare l’accueil puis chaque module, niveau par niveau, sans oublier un lien du catalogue', () => {
    const tree = SITE_NAVIGATION.tree;
    expect(tree.map(part => part.key)).toEqual(['/', ...PLAN_ZONES.map(zone => 'zone:' + zone.id)]);
    expect(tree[0].children?.every(band => band.children?.every(zone => zone.key.startsWith('zone:')))).toBe(true);
    const keys = new Set(walk(tree).map(node => node.key));
    for (const entry of SITE_NAVIGATION.entries) expect(keys.has(entry.key), entry.key).toBe(true);
    // Sous un même parent, chaque lien n'apparaît qu'une fois : sa clé suffit à le ranger.
    for (const node of walk(tree)) expect(new Set(node.children?.map(child => child.key)).size).toBe(node.children?.length ?? 0);
    const bpm = tree.find(part => part.key === 'zone:bpm-astra')!;
    const page = walk([bpm]).find(node => node.key === '/bpm-astra/projets')!;
    expect(page.level).toBe('page');
    expect(page.children?.find(child => child.key === '/bpm-astra/projets/:id')).toMatchObject({ fixed: true });
    expect(page.children?.find(child => child.key === '/bpm-astra/projets/:id')?.children?.map(child => child.key)).toEqual(['/bpm-astra/projets/:id/budget', '/bpm-astra/projets/:id/taches']);
  });
  it('applique l’ordre aux parties, aux pages et aux onglets de BPM-Astra', () => {
    const astra = planZone('bpm-astra')!;
    const sections = zoneSections(astra, true).map(section => section.id);
    const section = astra.sections[0];
    const pages = menuPages(section).map(page => page.link);
    planOrder.set({
      'zone:bpm-astra': [...sections].reverse().map(id => `section:bpm-astra:${id}`),
      [`section:bpm-astra:${section.id}`]: [...pages].reverse(),
      '/bpm-astra/cloture': ['/bpm-astra/cloture/reglages', '/bpm-astra/cloture/compte'],
      '/bpm-astra/projets/:id': ['/bpm-astra/projets/:id/taches', '/bpm-astra/projets/:id/budget'],
      '/': ['anchor:portal:technical'],
    });
    expect(zoneSections(astra, true).map(item => item.id)).toEqual([...sections].reverse());
    expect(menuPages(section).map(page => page.link)).toEqual([...pages].reverse());
    expect(sectionEntry(astra, section).link).toBe(menuPages(section)[0].link);
    const closing = menuPages(astra.sections[4]).find(page => page.link === '/bpm-astra/cloture')!;
    expect(pageChildren(closing).map(child => child.link)).toEqual(['/bpm-astra/cloture/reglages', '/bpm-astra/cloture/compte']);
    expect(planContext('/bpm-astra/cloture').tabs.map(tab => tab.link)).toEqual(['/bpm-astra/cloture', '/bpm-astra/cloture/reglages', '/bpm-astra/cloture/compte']);
    expect(planContext('/bpm-astra/projets/prj_1').tabs.map(tab => tab.id)).toEqual(['object', 'project-tasks', 'project-budget']);
    expect(orderedZones()[0].band).toBe('technical');
    expect(orderedZones()).toHaveLength(PLAN_ZONES.length);
  });
  it('donne à chaque onglet ses gestes, rangés dans l’ordre réglé, et les déclare dans l’arbre', () => {
    // N4 : l'accueil porte les actions de la page ; les autres sous-pages n'en ont pas.
    const closing = planContext('/bpm-astra/cloture').tabs;
    expect(closing[0].links.map(link => link.link)).toEqual(['/bpm-astra/cloture/compte', '/bpm-astra/cloture/reglages']);
    expect(closing.slice(1).every(tab => tab.links.length === 0)).toBe(true);
    // Plafonds : une seule page pour fixer les plafonds, son seul geste mène aux postes.
    expect(planContext('/bpm-astra/plafonds').tabs[0].links.map(link => link.link)).toEqual(['/bpm-astra/plafonds/postes']);
    expect(planContext('/bpm-astra/mouvements?period=2026-10').tabs[0].links.map(link => link.query['entryDirection'])).toEqual(['charge', 'income']);
    planOrder.set({ '/bpm-astra/mouvements#main': ['/bpm-astra/mouvements?entry=new&entryDirection=income'] });
    expect(planContext('/bpm-astra/mouvements').tabs[0].links.map(link => link.query['entryDirection'])).toEqual(['income', 'charge']);
    const astra = walk(SITE_NAVIGATION.tree.filter(part => part.key === 'zone:bpm-astra'));
    expect(astra.find(node => node.key === '/bpm-astra/mouvements#main')).toMatchObject({ fixed: true });
    expect(astra.find(node => node.key === '/bpm-astra/mouvements#main')?.children?.some(child => child.key === '/bpm-astra/mouvements?entry=new&entryDirection=charge')).toBe(true);
  });
  it('sans réglage, garde l’ordre du plan', () => {
    expect(orderedZones()).toBe(PLAN_ZONES);
  });
});
