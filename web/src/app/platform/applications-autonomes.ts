import type { Type } from '@angular/core';
import type { PlanBand, PlanPage, PlanSection, PlanZone } from '../plan/site-plan';

/**
 * Les applications autonomes qui ont leur propre espace, hors de BPM-Astra (inscription `espace`). Le site leur donne
 * leur adresse, servie dans son interface habituelle, et leur propre zone « Applications autonomes » : une bande de
 * l'accueil des modules (/modules), une entrée des zones principales et une section par application.
 * Fonctions pures, vérifiées par applications-autonomes.spec.ts.
 */
/** Ce que le site lit d'une inscription : sa clé et son espace (forme décrite par `EspaceInscrit` dans astra/inscription.ts). */
export interface InscriptionAvecEspace {
  cle: string;
  espace?: { chemin: string; titre: string; description: string; resultat: string; symbole?: string; ecran: () => Promise<Type<unknown>> };
}

export interface EspaceAutonome {
  cle: string;
  chemin: string;
  titre: string;
  description: string;
  resultat: string;
  symbole: string;
  ecran: () => Promise<Type<unknown>>;
}

export const espacesAutonomes = (inscriptions: readonly InscriptionAvecEspace[]): EspaceAutonome[] =>
  inscriptions.filter((app) => app.espace).map((app) => ({ cle: app.cle, symbole: '◫', ...app.espace!, chemin: app.espace!.chemin.replace(/^\/+|\/+$/g, '') }));

/** La route de chaque espace : une adresse par application ; elle navigue en interne par ses paramètres (`?theme=`…). */
export const routesAutonomes = (espaces: readonly EspaceAutonome[]) => espaces.map((e) => (
  { path: e.chemin, title: `${e.titre} · Application autonome`, loadComponent: e.ecran }
));

/** La bande de l'accueil des modules qui présente les applications autonomes. */
export const BANDE_APPLICATIONS_AUTONOMES: PlanBand = {
  id: 'autonomes',
  label: 'Applications autonomes',
  description: 'Des applications complètes bâties sur le socle commun, chacune dans sa propre interface.',
};

/** Une section par application autonome, qui s'ouvre directement sur son espace. */
export function sectionsApplicationsAutonomes(espaces: readonly EspaceAutonome[]): PlanSection[] {
  return espaces.map((e, i) => {
    const page: PlanPage = {
      id: 'autonome-' + e.cle, label: e.titre, link: '/' + e.chemin, symbol: e.symbole, tone: 'nav-teal',
      step: 'Ouvrir', description: e.description, result: e.resultat,
    };
    return {
      id: e.cle, acronym: String(i + 1).padStart(2, '0'), label: e.titre, intention: e.description, description: e.description,
      tone: 'nav-teal', homeTone: 'nav-lagoon', home: 'direct', module: 'core', space: 'projects', pages: [page],
    };
  });
}

/** Identifiant de la zone : ses applications ont leur propre interface, sans la barre de parcours du site. */
export const ZONE_APPLICATIONS_AUTONOMES = 'applications-autonomes';

/** La zone « Applications autonomes » (au même niveau que les autres zones), ou rien tant qu'aucune n'est inscrite. */
export function zoneApplicationsAutonomes(espaces: readonly EspaceAutonome[]): PlanZone | null {
  if (!espaces.length) return null;
  return {
    id: ZONE_APPLICATIONS_AUTONOMES,
    kind: 'zone',
    label: 'Applications autonomes',
    acronym: 'AA',
    eyebrow: 'Zone principale · applications',
    mission: 'Des applications complètes bâties sur le socle commun : chacune présente toutes ses fonctionnalités dans sa propre interface.',
    band: BANDE_APPLICATIONS_AUTONOMES.id,
    size: 'full',
    tone: 'core',
    sections: sectionsApplicationsAutonomes(espaces),
  };
}
