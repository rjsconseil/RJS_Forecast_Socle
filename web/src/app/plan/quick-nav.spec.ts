import { contextActions, contextLinks, searchLinks, siteDestinations, uniqueLinks } from './quick-nav';
import { PIN_LIMIT, togglePin } from './shell-preferences';

describe('accès rapides dérivés du plan', () => {
  it('liste chaque destination du plan une seule fois, selon le public', () => {
    const connected = siteDestinations(true);
    const links = connected.map((link) => link.link);
    expect(new Set(links).size).toBe(links.length);
    for (const link of ['/bpm-astra', '/bpm-astra/projets', '/bpm-astra/taches', '/bpm-astra/calendrier', '/bpm-astra/plafonds', '/bpm-astra/plafonds/postes', '/bpm-astra/objectif']) expect(links).toContain(link);
    // Les réglages et catégories de plafonds n'existent plus : une seule page Plafonds.
    for (const gone of ['/bpm-astra/plafonds/reglages', '/bpm-astra/plafonds/categories']) expect(links).not.toContain(gone);
    // Les anciennes adresses BPM ne sont plus des destinations ; les fiches (`:id`) non plus.
    for (const old of ['/zones/bpm', '/app/gestion-projet', '/tableau-de-bord', '/creer']) expect(links).not.toContain(old);
    expect(links.some((link) => link.includes(':'))).toBe(false);
  });

  it('propose le niveau supérieur, les autres vues et les pages voisines en gardant la lecture', () => {
    const links = contextLinks('/bpm-astra/cloture/reglages?period=2026-10&entry=new');
    expect(links.map((link) => `${link.kind}:${link.link}`).slice(0, 3)).toEqual([
      'up:/bpm-astra/cloture',
      'view:/bpm-astra/cloture',
      'sibling:/bpm-astra/bilans',
    ]);
    // La période suit le lien, jamais la saisie ouverte.
    expect(links.every((link) => link.query?.['period'] === '2026-10' && !link.query?.['entry'])).toBe(true);
    expect(links.every((link) => link.carries)).toBe(true);
  });

  it('nomme la fiche ouverte dans ses liens de contexte', () => {
    const links = contextLinks('/bpm-astra/projets/prj_1/taches', 'Cuisine');
    expect(links[0]).toMatchObject({ kind: 'up', label: 'Cuisine', link: '/bpm-astra/projets/prj_1' });
    expect(links.filter((link) => link.kind === 'view').map((link) => link.label)).toEqual(['Vue d’ensemble', 'Budget et décisions']);
    expect(contextLinks('/')).toEqual([]);
  });

  it('ouvre la saisie sur la période lue et propose les créations d’Astra', () => {
    const actions = contextActions('/bpm-astra?period=2026-10', true);
    expect(actions.find((a) => a.id === 'entry:charge')).toMatchObject({ label: 'Saisir une dépense', link: '/bpm-astra/mouvements', query: { period: '2026-10', entry: 'new', entryDirection: 'charge' } });
    expect(actions.find((a) => a.id === 'entry:income')?.query).toMatchObject({ entryDirection: 'income' });
    expect(actions.find((a) => a.id === 'create:project')).toMatchObject({ link: '/bpm-astra/projets', query: { editProject: 'new' } });
    expect(contextActions('/bpm-astra/projets/prj_1', true, 'Cuisine').find((action) => action.id.startsWith('object-tasks'))).toMatchObject({ link: '/bpm-astra/taches', query: { project: 'prj_1' } });
    // Les créations restent dans leur zone ; sans utilisateur, aucune saisie n'est proposée.
    expect(contextActions('/projects', true).map((action) => action.link)).toEqual(['/projects/new', '/tasks/new']);
    expect(contextActions('/bpm-astra', false).some((action) => action.id.startsWith('entry:'))).toBe(false);
  });

  it('cherche sans accents ni casse et place la zone courante devant', () => {
    const all = siteDestinations(true);
    expect(searchLinks(all, 'postes et REVENUS')[0].link).toBe('/bpm-astra/plafonds/postes');
    expect(searchLinks(all, 'TACHES', 'noyau')[0].link).toBe('/tasks');
    expect(searchLinks(all, 'TACHES', 'bpm-astra')[0].link).toBe('/bpm-astra/taches');
    expect(searchLinks(all, 'zzz')).toEqual([]);
    expect(searchLinks(all, '   ')).toBe(all);
  });

  it('ne garde qu’un lien par adresse, le plus proche du contexte', () => {
    const near = contextLinks('/bpm-astra/plafonds');
    const unique = uniqueLinks([...near, ...siteDestinations(true)]);
    expect(unique.filter((link) => link.link === '/bpm-astra/plafonds/postes')).toHaveLength(1);
    expect(unique.find((link) => link.link === '/bpm-astra/plafonds/postes')?.group).toBe('context');
  });

  it('épingle et désépingle une page, dans la limite prévue', () => {
    const pin = (link: string) => ({ link, label: link, hint: '' });
    let pins = togglePin([], pin('/bpm-astra/objectif/echeances'));
    expect(pins.map((entry) => entry.link)).toEqual(['/bpm-astra/objectif/echeances']);
    pins = togglePin(pins, pin('/bpm-astra/objectif/echeances'));
    expect(pins).toEqual([]);
    for (let i = 0; i < PIN_LIMIT + 3; i++) pins = togglePin(pins, pin(`/bpm-astra/projets/prj_${i}`));
    expect(pins).toHaveLength(PIN_LIMIT);
    expect(pins.at(-1)?.link).toBe(`/bpm-astra/projets/prj_${PIN_LIMIT + 2}`);
  });
});
