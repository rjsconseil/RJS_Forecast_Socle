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
    const bpm = tree.find(part => part.key === 'zone:bpm')!;
    const page = walk([bpm]).find(node => node.key === '/app/gestion-projet')!;
    expect(page.level).toBe('page');
    expect(page.children?.find(child => child.key === '/app/gestion-projet/:id')).toMatchObject({ fixed: true });
    expect(page.children?.find(child => child.key === '/app/gestion-projet/:id')?.children?.map(child => child.key)).toEqual(['/app/gestion-projet/:id/budget', '/app/gestion-projet/:id/taches']);
  });
  it('applique l’ordre au menu, aux onglets et à l’accueil sans changer la destination d’une section', () => {
    const bpm = planZone('bpm')!;
    const sections = zoneSections(bpm, true).map(section => section.id);
    const section = bpm.sections.find(entry => menuPages(entry).length > 1)!;
    const pages = menuPages(section).map(page => page.link);
    const entry = sectionEntry(bpm, section).link;
    planOrder.set({
      'zone:bpm': [...sections].reverse().map(id => `section:bpm:${id}`),
      [`section:bpm:${section.id}`]: [...pages].reverse(),
      '/plafonds': ['/plafonds/categories', '/plafonds/reglages'],
      '/app/gestion-projet/:id': ['/app/gestion-projet/:id/taches', '/app/gestion-projet/:id/budget'],
      '/': ['anchor:portal:technical'],
    });
    expect(zoneSections(bpm, true).map(item => item.id)).toEqual([...sections].reverse());
    expect(menuPages(section).map(page => page.link)).toEqual([...pages].reverse());
    expect(sectionEntry(bpm, section).link).toBe(entry);
    const caps = menuPages(bpm.sections.find(item => item.pages.some(page => page.link === '/plafonds'))!).find(page => page.link === '/plafonds')!;
    expect(pageChildren(caps).map(child => child.link)).toEqual(['/plafonds/categories', '/plafonds/reglages']);
    expect(planContext('/plafonds').tabs.map(tab => tab.link)).toEqual(['/plafonds', '/plafonds/categories', '/plafonds/reglages']);
    expect(planContext('/app/gestion-projet/prj_1').tabs.map(tab => tab.id)).toEqual(['object', 'project-tasks', 'project-budget']);
    expect(orderedZones()[0].band).toBe('technical');
    expect(orderedZones()).toHaveLength(PLAN_ZONES.length);
  });
  it('donne à chaque onglet ses gestes, rangés dans l’ordre réglé, et les déclare dans l’arbre', () => {
    const tabs = planContext('/vision/reperes?period=2026-10').tabs;
    expect(tabs.find(tab => tab.id === 'main')?.links.map(link => link.key)).toEqual(['/vision?goal=new']);
    const landmarks = tabs.find(tab => tab.link === '/vision/reperes')!;
    expect(landmarks.links.map(link => link.label)).toEqual(['Régler l’épargne visée', 'Régler le cap patrimonial']);
    expect(planContext('/plafonds').tabs.every(tab => tab.links.length === 0)).toBe(true);
    planOrder.set({ '/vision/reperes': ['/vision/reperes?reglage=wealth', '/vision/reperes?reglage=savings'], '/tableau-de-bord#main': ['/tableau-de-bord?entry=new&entryDirection=charge'] });
    expect(planContext('/vision/reperes').tabs.find(tab => tab.link === '/vision/reperes')?.links.map(link => link.query['reglage'])).toEqual(['wealth', 'savings']);
    expect(planContext('/tableau-de-bord').tabs[0].links.map(link => link.query['entryDirection'])).toEqual(['charge', 'income']);
    const bpm = walk(SITE_NAVIGATION.tree.filter(part => part.key === 'zone:bpm'));
    expect(bpm.find(node => node.key === '/vision/reperes')?.children?.map(child => child.key)).toEqual(['/vision/reperes?reglage=savings', '/vision/reperes?reglage=wealth']);
    expect(bpm.find(node => node.key === '/tableau-de-bord#main')).toMatchObject({ fixed: true, unlabeled: true });
  });
  it('sans réglage, garde l’ordre du plan', () => {
    expect(orderedZones()).toBe(PLAN_ZONES);
  });
});
