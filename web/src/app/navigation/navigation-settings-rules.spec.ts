import {
  NAVIGATION_PRESETS,
  findNavigationNode,
  levelAllowedOnSurface,
  levelOfSurface,
  navigationChanges,
  navigationNodeKind,
  navigationSampleStyle,
  navigationValidationErrors,
} from './navigation-settings-rules';
import type { NavigationConfiguration, NavigationNode } from './navigation-model';

const MODULE = 'module:bpm';
const config = (scopes: NavigationConfiguration['scopes'] = {}, extra: Partial<NavigationConfiguration> = {}): NavigationConfiguration => ({ version: 1, scopes, ...extra });

describe('règles des réglages de navigation', () => {
  it('contrôle les valeurs du module et de ses pages seulement', () => {
    const draft = config({
      [MODULE]: { contentMenu: { width: 500, closeDelay: 700 }, styles: { primary: { section: { size: 40, color: 'rouge' } } } },
      'page:/plafonds': { styles: { primary: { page: { size: 14, color: '#AABBCC' } } } },
      'page:/ailleurs': { contentMenu: { width: 10 } },
    });
    expect(navigationValidationErrors(draft, MODULE, ['/plafonds'], ['erreur du plan'])).toEqual([
      'erreur du plan',
      'module:bpm : largeur du menu entre 220 et 480 px.',
      'module:bpm : délai de fermeture entre 0 et 600 ms.',
      'primary · section : Taille du texte doit être compris entre 12 et 28.',
      'primary · section : couleur color invalide (#RRGGBB).',
    ]);
  });

  it('liste les changements : périmètres, ordres et relations', () => {
    const saved = config({ [MODULE]: { labels: { a: 'A' } } }, { order: { x: ['1', '2'] } });
    const draft = config({ [MODULE]: { labels: { a: 'B' } }, 'page:/p': { labels: {} } }, { order: { x: ['2', '1'] }, relations: { z: {} } });
    expect(navigationChanges(saved, draft, MODULE).map((c) => [c.key, c.label])).toEqual([
      ['module:bpm', 'Présentation du module'],
      ['page:/p', 'Réglages d’une page'],
      ['x', 'Ordre des liens'],
      ['relations', 'Relations entre les liens'],
    ]);
    expect(navigationChanges(saved, structuredClone(saved), MODULE)).toEqual([]);
  });

  it('aperçu d’un lien : valeurs par défaut et couleurs de chaque état', () => {
    expect(navigationSampleStyle({}, 'rest')).toMatchObject({ 'font-size': '14px', padding: '10px 16px', color: '#24344b', background: '#ffffff' });
    expect(navigationSampleStyle({ color: '#111111' }, 'hover')).toMatchObject({ color: '#111111', background: '#edf0fc' });
    expect(navigationSampleStyle({ size: 19 }, 'active')).toMatchObject({ 'font-size': '19px', color: '#ffffff', background: '#364cc5' });
  });

  it('nomme la nature d’un lien et le retrouve dans l’arbre', () => {
    expect(navigationNodeKind({ key: '/p#main', level: 'detail' })).toBe('Sous-page d’accueil');
    expect(navigationNodeKind({ key: '/p?entry=new', level: 'detail' })).toBe('Action');
    expect(navigationNodeKind({ key: '/p', level: 'page' })).toBe('Page');
    expect(navigationNodeKind({ key: '/p/s', level: 'detail' })).toBe('Sous-page');
    const leaf = { key: 'c', label: 'C', level: 'page', surfaces: [] } as NavigationNode;
    const tree = [{ key: 'a', label: 'A', level: 'section', surfaces: [], children: [{ key: 'b', label: 'B', level: 'page', surfaces: [], children: [leaf] }] }] as NavigationNode[];
    expect(findNavigationNode(tree, 'c')).toBe(leaf);
    expect(findNavigationNode(tree, 'z')).toBeUndefined();
  });

  it('chaque zone règle son niveau', () => {
    expect(levelOfSurface('contents')).toBe('content');
    expect(levelOfSurface('secondary')).toBe('detail');
    expect(levelOfSurface('portal')).toBe('page');
    expect(levelOfSurface('primary')).toBe('section');
    expect(levelAllowedOnSurface('primary', 'content')).toBe(false);
    expect(levelAllowedOnSurface('primary', 'page')).toBe(true);
    expect(levelAllowedOnSurface('tertiary', 'section')).toBe(true);
    expect(levelAllowedOnSurface('portal', 'section')).toBe(false);
    expect(NAVIGATION_PRESETS.compact.size).toBe(13);
  });
});
