import { contextActions, contextLinks, searchLinks, siteDestinations, uniqueLinks } from './quick-nav';
import { PIN_LIMIT, togglePin } from './shell-preferences';

describe('accès rapides dérivés du plan', () => {
  it('liste chaque destination du plan une seule fois, selon le public', () => {
    const connected = siteDestinations(true);
    const links = connected.map((link) => link.link);
    expect(new Set(links).size).toBe(links.length);
    expect(links).toContain('/zones/bpm');
    expect(links).toContain('/tableau-de-bord');
    expect(links).toContain('/plafonds/reglages');
    // « Démarrer un projet » est réservé au visiteur ; les fiches (`:id`) ne sont pas des destinations.
    expect(links).not.toContain('/creer');
    expect(links.some((link) => link.includes(':'))).toBe(false);
    expect(siteDestinations(false).map((link) => link.link)).toContain('/creer');
  });

  it('propose le niveau supérieur, les autres vues et les pages voisines en gardant la lecture', () => {
    const links = contextLinks('/plafonds/reglages?period=2026-10&entry=new');
    expect(links.map((link) => `${link.kind}:${link.link}`)).toEqual([
      'up:/plafonds',
      'view:/plafonds',
      'view:/plafonds/categories',
      'sibling:/projet-de-vie',
      'sibling:/vision',
    ]);
    // La période suit le lien, jamais la saisie ouverte.
    expect(links.every((link) => link.query?.['period'] === '2026-10' && !link.query?.['entry'])).toBe(true);
    expect(links.every((link) => link.carries)).toBe(true);
  });

  it('nomme la fiche ouverte dans ses liens de contexte', () => {
    const links = contextLinks('/app/gestion-projet/prj_1/taches', 'Cuisine');
    expect(links[0]).toMatchObject({ kind: 'up', label: 'Cuisine', link: '/app/gestion-projet/prj_1' });
    expect(links.filter((link) => link.kind === 'view').map((link) => link.label)).toEqual(['Vue d’ensemble', 'Budget et décisions']);
    expect(contextLinks('/')).toEqual([]);
  });

  it('ouvre la saisie sur la période lue et place d’abord les créations de la page', () => {
    const actions = contextActions('/tableau-de-bord?period=2026-10', true);
    expect(actions[0]).toMatchObject({ label: 'Saisir une entrée', link: '/tableau-de-bord', query: { period: '2026-10', entry: 'new', entryDirection: 'income' } });
    expect(actions[1].query).toMatchObject({ entryDirection: 'charge' });
    // Hors d'une page qui porte la saisie, elle s'ouvre depuis le tableau de bord, sur la même période.
    expect(contextActions('/vision?period=2026-10', true)[0]).toMatchObject({ link: '/tableau-de-bord', query: { period: '2026-10', entry: 'new' } });
    const project = contextActions('/app/gestion-projet', true).filter((action) => action.id.startsWith('create:'));
    expect(project[0].link).toBe('/app/gestion-projet/nouveau');
    expect(contextActions('/app/gestion-projet/prj_1', true, 'Cuisine').find((action) => action.id.startsWith('object-tasks'))).toMatchObject({ link: '/app/taches', query: { project: 'prj_1' } });
    // Les créations restent dans leur zone ; sans utilisateur, aucune saisie n'est proposée.
    expect(contextActions('/projects', true).map((action) => action.link)).toEqual(['/projects/new', '/tasks/new']);
    expect(contextActions('/zones/bpm', false).some((action) => action.id.startsWith('entry:'))).toBe(false);
  });

  it('cherche sans accents ni casse et place la zone courante devant', () => {
    const all = siteDestinations(true);
    expect(searchLinks(all, 'categories plaf')[0].link).toBe('/plafonds');
    expect(searchLinks(all, 'organiser categ')[0].link).toBe('/plafonds/categories');
    expect(searchLinks(all, 'TACHES', 'noyau')[0].link).toBe('/tasks');
    expect(searchLinks(all, 'TACHES', 'bpm')[0].link).toBe('/app/taches');
    expect(searchLinks(all, 'zzz')).toEqual([]);
    expect(searchLinks(all, '   ')).toBe(all);
  });

  it('ne garde qu’un lien par adresse, le plus proche du contexte', () => {
    const near = contextLinks('/plafonds');
    const unique = uniqueLinks([...near, ...siteDestinations(true)]);
    expect(unique.filter((link) => link.link === '/plafonds/reglages')).toHaveLength(1);
    expect(unique.find((link) => link.link === '/plafonds/reglages')?.group).toBe('context');
  });

  it('épingle et désépingle une page, dans la limite prévue', () => {
    const pin = (link: string) => ({ link, label: link, hint: '' });
    let pins = togglePin([], pin('/vision'));
    expect(pins.map((entry) => entry.link)).toEqual(['/vision']);
    pins = togglePin(pins, pin('/vision'));
    expect(pins).toEqual([]);
    for (let i = 0; i < PIN_LIMIT + 3; i++) pins = togglePin(pins, pin(`/app/gestion-projet/prj_${i}`));
    expect(pins).toHaveLength(PIN_LIMIT);
    expect(pins.at(-1)?.link).toBe(`/app/gestion-projet/prj_${PIN_LIMIT + 2}`);
  });
});
