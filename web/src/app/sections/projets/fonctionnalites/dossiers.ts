import type { LigneApplication } from '../../../platform/grand-noyau';

/**
 * Fonctionnalités Mes projets · dossiers PRINCE2 (données de l'application autonome, tables AA_MP_…).
 * Le dossier d'un projet du noyau et ses produits de management, créés par les règles d'instanciation du catalogue
 * PRINCE2 standard (donnees.json). Fonctions pures, réutilisables par une application hybride.
 */
export const APPLICATION = 'projets';
export const COLLECTIONS = { dossiers: 'dossiers', livrables: 'livrables', roles: 'roles', etapes: 'etapes' } as const;

export interface ResumeDossier {
  dossierId: string;
  processus: string | null;
  livrables: number;
  approuves: number;
  /** Part des produits de management approuvés, en pourcentage entier. */
  avancement: number;
}

/** Les dossiers PRINCE2, résumés par projet du noyau (avec leurs produits de management). */
export function dossiersParProjet(dossiers: readonly LigneApplication[], livrables: readonly LigneApplication[]): Map<string, ResumeDossier> {
  const out = new Map<string, ResumeDossier>();
  for (const d of dossiers) {
    if (!d.projectId) continue;
    const own = livrables.filter((l) => l.projectId === d.projectId);
    const approuves = own.filter((l) => l['statut'] === 'approuve').length;
    out.set(d.projectId, {
      dossierId: d.id,
      processus: typeof d['processusCourant'] === 'string' ? d['processusCourant'] : null,
      livrables: own.length,
      approuves,
      avancement: own.length ? Math.round((approuves / own.length) * 100) : 0,
    });
  }
  return out;
}
