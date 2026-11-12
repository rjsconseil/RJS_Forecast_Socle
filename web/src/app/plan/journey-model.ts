import { locate, OBJECT_FALLBACK } from './site-plan';

export interface JourneyVisit {
  id: string;
  url: string;
  label: string;
  /** Le nom de l'objet ouvert à cette étape (projet, poste), retenu pour survivre au rechargement. */
  object?: string;
}
export interface JourneyTrail {
  visits: JourneyVisit[];
  cursor: number;
}
/** Assez d'étapes pour une longue séance : revenir en arrière n'est jamais limité en pratique. */
export const TRAIL_LIMIT = 200;
export const emptyTrail = (): JourneyTrail => ({ visits: [], cursor: -1 });
/** Toute page d'une zone du plan est une étape du parcours ; le portail et les adresses externes n'en sont pas. */
export const journeyAddress = (url: string) =>
  url.startsWith('/') && !url.startsWith('//') && !!locate(url).zone;

/** Deux adresses identiques à l'ordre des paramètres près désignent la même étape. */
export function sameStep(a: string, b: string): boolean {
  return normalizeUrl(a) === normalizeUrl(b);
}
export function normalizeUrl(url: string): string {
  const parsed = new URL(url, 'http://local');
  const params = [...parsed.searchParams.entries()].sort(([a, va], [b, vb]) => a.localeCompare(b) || va.localeCompare(vb));
  const query = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return `${parsed.pathname.replace(/\/+$/, '') || '/'}${query ? '?' + query : ''}${parsed.hash}`;
}

/**
 * L'adresse de l'objet qu'une étape visite (la fiche d'un projet pour toutes ses vues, le détail
 * d'un poste) : deux étapes de même clé portent le même nom d'objet.
 */
export function objectKey(url: string): string | null {
  const at = locate(url);
  if (at.object) return at.object.link;
  return at.kind === 'detail' ? url.split(/[?#]/)[0].replace(/\/+$/, '') : null;
}

/** Une saisie ouverte par-dessus la page (paramètre d'adresse) est une étape à part, nommée par son geste. */
function overlayLabel(params: URLSearchParams): string | null {
  const entry = params.get('entry');
  if (entry) return entry === 'new' ? 'Saisir une opération' : 'Modifier une opération';
  const project = params.get('editProject');
  if (project) return project === 'new' ? 'Créer un projet de la vie' : 'Modifier le projet';
  const task = params.get('editTask');
  if (task) return task === 'new' ? 'Créer une tâche' : 'Modifier une tâche';
  if (params.get('decisions')) return 'Décider les demandes';
  if (params.get('calPlan')) return 'Replanifier un événement';
  if (params.get('reglement')) return 'Préparer le règlement';
  if (params.get('demande')) return 'Demander une part de budget';
  if (params.get('retour')) return 'Prévoir un retour au projet de vie';
  const goal = params.get('goal');
  if (goal) return goal === 'new' ? 'Créer un objectif daté' : 'Modifier un objectif daté';
  const setting = params.get('reglage');
  if (setting) return ({ savings: 'Régler l’épargne visée', wealth: 'Régler le cap patrimonial', projection: 'Ajuster les hypothèses' } as Record<string, string>)[setting] ?? 'Ajuster les repères';
  if (params.get('ligne')) return 'Détail d’une échéance';
  if (params.get('occurrence') || params.get('operation')) return 'Détail d’une opération';
  if (params.get('task')) return 'Détail de la tâche';
  return null;
}

export function visitLabel(url: string, objectLabel: string | null = null): string {
  const at = locate(url);
  const params = new URL(url, 'http://local').searchParams;
  const overlay = overlayLabel(params);
  if (at.object) {
    const name = objectLabel || OBJECT_FALLBACK;
    // Le nom de l'objet précède : la vue reprend le libellé de son onglet (« Budget et décisions », « Tâches »).
    const view = at.subpage ? `${name} · ${at.subpage.tabLabel ?? at.subpage.label}` : name;
    return overlay ? `${view} · ${overlay}` : view;
  }
  if (overlay) return overlay;
  const step = params.get('step');
  return at.page?.id === 'creer' && step
    ? `${at.subpage?.label ?? 'Démarrer un projet'} · étape ${step}`
    : (at.subpage?.label ?? (at.detailLabel ? objectLabel || at.detailLabel : null) ?? at.page?.label ?? at.section?.label ?? at.zone?.label ?? 'Accueil');
}

/**
 * Le parcours est une suite d'étapes et un curseur.
 * - Revenir (bouton, navigateur) déplace le curseur sans rien perdre.
 * - Rejoindre l'étape voisine par un lien de la page (« Étape suivante », « ↑ parent ») déplace aussi
 *   le curseur : le chemin déjà parcouru en avant reste disponible jusqu'à la dernière étape atteinte.
 * - Seule une nouvelle direction remplace le chemin à venir, comme un navigateur.
 */
export function recordVisit(
  trail: JourneyTrail,
  visit: JourneyVisit,
  options: { restoredId?: string; replace?: boolean } = {},
): JourneyTrail {
  const restored =
    options.restoredId == null ? -1 : trail.visits.findIndex((v) => v.id === options.restoredId);
  if (restored >= 0)
    return { visits: trail.visits.map((v, i) => (i === restored ? { ...visit, id: v.id } : v)), cursor: restored };
  if (options.replace && trail.cursor >= 0) {
    // Refermer une saisie (`?entry=new` → la page) ramène à l'étape d'avant : elle n'est pas dupliquée,
    // sinon « Retour » mènerait à la page déjà affichée.
    const before = trail.visits[trail.cursor - 1];
    if (before && sameStep(before.url, visit.url))
      return {
        visits: [...trail.visits.slice(0, trail.cursor - 1), { ...visit, id: before.id }, ...trail.visits.slice(trail.cursor + 1)],
        cursor: trail.cursor - 1,
      };
    return {
      visits: trail.visits.map((v, i) => (i === trail.cursor ? { ...visit, id: v.id } : v)),
      cursor: trail.cursor,
    };
  }
  const next = trail.visits[trail.cursor + 1];
  if (next && sameStep(next.url, visit.url))
    return { visits: trail.visits.map((v, i) => (i === trail.cursor + 1 ? { ...visit, id: v.id } : v)), cursor: trail.cursor + 1 };
  const previous = trail.visits[trail.cursor - 1];
  if (previous && sameStep(previous.url, visit.url))
    return { visits: trail.visits.map((v, i) => (i === trail.cursor - 1 ? { ...visit, id: v.id } : v)), cursor: trail.cursor - 1 };
  const current = trail.visits[trail.cursor];
  if (current && sameStep(current.url, visit.url))
    return { visits: trail.visits.map((v, i) => (i === trail.cursor ? { ...visit, id: v.id } : v)), cursor: trail.cursor };
  const visits = [...trail.visits.slice(0, trail.cursor + 1), visit];
  const overflow = Math.max(0, visits.length - TRAIL_LIMIT);
  return { visits: visits.slice(overflow), cursor: visits.length - 1 - overflow };
}

/**
 * Un parcours guidé confirmé (assistant de démarrage…) n'a plus d'étapes où revenir : elles sont
 * retirées du parcours, le curseur reste sur ce qui précédait.
 */
export function removeVisits(trail: JourneyTrail, consumed: (url: string) => boolean): JourneyTrail {
  const kept = trail.visits.filter((v) => !consumed(v.url));
  if (kept.length === trail.visits.length) return trail;
  let cursor = -1;
  for (let i = 0; i <= trail.cursor && i < trail.visits.length; i++)
    if (!consumed(trail.visits[i].url)) cursor = kept.indexOf(trail.visits[i]);
  if (cursor < 0 && kept.length) cursor = 0;
  return { visits: kept, cursor };
}
