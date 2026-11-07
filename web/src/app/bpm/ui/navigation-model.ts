import { locate } from '../../shared/site-plan';

export interface BpmVisit {
  id: string;
  url: string;
  label: string;
}
export interface BpmTrail {
  visits: BpmVisit[];
  cursor: number;
}
export const emptyTrail = (): BpmTrail => ({ visits: [], cursor: -1 });
export const bpmAddress = (url: string) =>
  url.startsWith('/') && !url.startsWith('//') && locate(url).zone?.id === 'bpm';

export function visitLabel(url: string): string {
  const at = locate(url);
  if (!at.subpage && /^\/app\/(gestion-projet|projets)\/prj_[^/?#]+/.test(url)) return 'Détail du projet';
  const params = new URL(url, 'http://local').searchParams;
  const step = params.get('step');
  const entry = params.get('entry');
  if (entry) return entry === 'new' ? 'Saisir une opération' : 'Modifier une opération';
  return at.page?.id === 'creer' && step
    ? `${at.subpage?.label ?? 'Démarrer un projet'} · étape ${step}`
    : (at.subpage?.label ?? at.detailLabel ?? at.page?.label ?? at.section?.label ?? 'Accueil BPM');
}

/** Le curseur suit l'historique réel : revisiter une entrée ne crée jamais une boucle. */
export function recordVisit(
  trail: BpmTrail,
  visit: BpmVisit,
  options: { restoredId?: string; replace?: boolean } = {},
): BpmTrail {
  const restored =
    options.restoredId == null ? -1 : trail.visits.findIndex((v) => v.id === options.restoredId);
  if (restored >= 0)
    return { visits: trail.visits.map((v, i) => (i === restored ? visit : v)), cursor: restored };
  if (options.replace && trail.cursor >= 0)
    return {
      visits: trail.visits.map((v, i) => (i === trail.cursor ? visit : v)),
      cursor: trail.cursor,
    };
  const visits = [...trail.visits.slice(0, trail.cursor + 1), visit].slice(-60);
  return { visits, cursor: visits.length - 1 };
}
