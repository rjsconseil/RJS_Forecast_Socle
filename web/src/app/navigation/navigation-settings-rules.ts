// Règles de la page de réglages de la navigation, en fonctions pures (testées seules) : contrôle des valeurs saisies,
// liste des changements à enregistrer, aperçu d'un style, nature d'un lien, préréglages et niveau d'une zone.
import type { NavigationConfiguration, NavigationLevel, NavigationNode, NavigationStyle, NavigationSurface } from './navigation-model';

/** Réglages numériques d'un style, avec leurs bornes (les autres réglages sont des couleurs #RRGGBB). */
export const NAVIGATION_NUMERIC_FIELDS = [
  { key: 'size', label: 'Taille du texte', min: 12, max: 28, step: 1, unit: 'px' },
  { key: 'weight', label: 'Graisse du texte', min: 400, max: 800, step: 100, unit: '' },
  { key: 'spacing', label: 'Marge intérieure verticale', min: 0, max: 20, step: 1, unit: 'px' },
  { key: 'horizontalPadding', label: 'Marge intérieure horizontale', min: 0, max: 40, step: 1, unit: 'px' },
  { key: 'minHeight', label: 'Hauteur minimale', min: 28, max: 72, step: 1, unit: 'px' },
  { key: 'radius', label: 'Arrondi des liens', min: 0, max: 32, step: 1, unit: 'px' },
  { key: 'borderWidth', label: 'Épaisseur de bordure', min: 0, max: 4, step: 1, unit: 'px' },
  { key: 'letterSpacing', label: 'Espacement des lettres', min: 0, max: 4, step: 1, unit: 'px' },
] as const;

/**
 * Erreurs des réglages en cours : celles du plan généré, puis, pour le module et ses pages seulement, la largeur et
 * le délai du menu de contenu, les réglages numériques hors bornes et les couleurs mal écrites.
 */
export function navigationValidationErrors(draft: NavigationConfiguration, moduleScope: string, pageLinks: readonly string[], generatedErrors: readonly string[] = []): string[] {
  const errors: string[] = [...generatedErrors];
  for (const [scope, settings] of Object.entries(draft.scopes)) {
    if (scope !== moduleScope && !pageLinks.some((link) => scope === 'page:' + link)) continue;
    const menu = settings.contentMenu;
    if (menu?.width !== undefined && (!Number.isInteger(menu.width) || menu.width < 220 || menu.width > 480))
      errors.push(scope + ' : largeur du menu entre 220 et 480 px.');
    if (menu?.closeDelay !== undefined && (!Number.isInteger(menu.closeDelay) || menu.closeDelay < 0 || menu.closeDelay > 600))
      errors.push(scope + ' : délai de fermeture entre 0 et 600 ms.');
    for (const [surface, levels] of Object.entries(settings.styles ?? {}))
      for (const [level, style] of Object.entries(levels ?? {}))
        for (const [key, value] of Object.entries(style)) {
          const field = NAVIGATION_NUMERIC_FIELDS.find((f) => f.key === key);
          if (field && (!Number.isInteger(value) || Number(value) < field.min || Number(value) > field.max))
            errors.push(`${surface} · ${level} : ${field.label} doit être compris entre ${field.min} et ${field.max}.`);
          else if (!field && (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)))
            errors.push(`${surface} · ${level} : couleur ${key} invalide (#RRGGBB).`);
        }
  }
  return errors;
}

export interface NavigationChange { key: string; label: string; description: string }

/** Ce qui diffère entre les réglages enregistrés et le brouillon : périmètres, ordres des liens, relations. */
export function navigationChanges(saved: NavigationConfiguration, draft: NavigationConfiguration, moduleScope: string): NavigationChange[] {
  const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  const keys = (a: object = {}, b: object = {}) => [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return [
    ...keys(saved.scopes, draft.scopes)
      .filter((k) => differs(saved.scopes[k], draft.scopes[k]))
      .map((key) => ({
        key,
        label: key === moduleScope ? 'Présentation du module' : 'Réglages d’une page',
        description: 'Libellés, styles ou comportement des menus.',
      })),
    ...keys(saved.order, draft.order)
      .filter((k) => differs(saved.order?.[k], draft.order?.[k]))
      .map((key) => ({ key, label: 'Ordre des liens', description: 'Position des enfants dans la navigation.' })),
    ...(differs(saved.relations, draft.relations)
      ? [{ key: 'relations', label: 'Relations entre les liens', description: 'Parents, accueils et zones d’affichage.' }]
      : []),
  ];
}

/** Aperçu d'un lien dans un état (au repos, au survol, sélectionné), avec les valeurs par défaut du site. */
export function navigationSampleStyle(s: NavigationStyle, state: string): Record<string, string | number> {
  return {
    'font-size': (s.size ?? 14) + 'px',
    'font-weight': s.weight ?? 600,
    padding: (s.spacing ?? 10) + 'px ' + (s.horizontalPadding ?? 16) + 'px',
    'min-height': (s.minHeight ?? 44) + 'px',
    'border-radius': (s.radius ?? 10) + 'px',
    border: (s.borderWidth ?? 1) + 'px solid ' + (s.borderColor ?? '#dbe2ec'),
    'letter-spacing': (s.letterSpacing ?? 0) + 'px',
    color: state === 'active' ? (s.activeColor ?? '#ffffff') : state === 'hover' ? (s.hoverColor ?? s.color ?? '#24344b') : (s.color ?? '#24344b'),
    background: state === 'active' ? (s.activeBackground ?? '#364cc5') : state === 'hover' ? (s.hoverBackground ?? '#edf0fc') : (s.background ?? '#ffffff'),
  };
}

/** Nature d'un lien, telle que la page la nomme. */
export function navigationNodeKind(node: Pick<NavigationNode, 'key' | 'level'>): string {
  if (node.key.endsWith('#main')) return 'Sous-page d’accueil';
  if (node.key.includes('?')) return 'Action';
  return node.level === 'content' ? 'Section de contenu' : node.level === 'section' ? 'Section' : node.level === 'page' ? 'Page' : 'Sous-page';
}

/** Le lien d'une clé dans l'arbre, ou `undefined`. */
export function findNavigationNode(nodes: readonly NavigationNode[], key: string): NavigationNode | undefined {
  for (const n of nodes) {
    if (n.key === key) return n;
    const found = findNavigationNode(n.children ?? [], key);
    if (found) return found;
  }
  return undefined;
}

/** Le niveau que règle chaque zone d'affichage. */
export function levelOfSurface(surface: NavigationSurface): NavigationLevel {
  return surface === 'contents' ? 'content'
    : surface === 'actions' || surface === 'secondary' ? 'detail'
      : surface === 'tertiary' || surface === 'portal' ? 'page'
        : 'section';
}

/** Les niveaux qu'une zone d'affichage peut régler. */
export function levelAllowedOnSurface(surface: NavigationSurface, level: NavigationLevel): boolean {
  return surface === 'contents' ? level === 'content'
    : surface === 'actions' || surface === 'secondary' ? level === 'detail'
      : surface === 'portal' ? level === 'page'
        : level !== 'content';
}

/** Préréglages d'un niveau : compact, confortable, contrasté. */
export const NAVIGATION_PRESETS: Record<'compact' | 'comfortable' | 'contrast', NavigationStyle> = {
  compact: { size: 13, spacing: 5, horizontalPadding: 10, minHeight: 32, radius: 6 },
  comfortable: { size: 15, spacing: 10, horizontalPadding: 16, minHeight: 44, radius: 10 },
  contrast: {
    color: '#182b45', background: '#ffffff', activeColor: '#ffffff', activeBackground: '#183b63',
    hoverColor: '#183b63', hoverBackground: '#e6eff9', weight: 700,
  },
};
