import type { Type } from '@angular/core';
import type { PlanPage, PlanSection } from '../plan/site-plan';

/**
 * Les applications autonomes qui ont leur propre espace, hors de BPM-Astra (inscription `espace`). Le site leur donne
 * leur adresse, servie dans son interface habituelle, et un lien dans la section « Applications autonomes » de la
 * zone Noyau transverse : elles reposent sur le noyau. Fonctions pures, vérifiées par applications-autonomes.spec.ts.
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

/** Les routes des espaces : l'accueil de chaque application, et ses sous-adresses (gérées par l'application). */
export const routesAutonomes = (espaces: readonly EspaceAutonome[]) => espaces.flatMap((e) => [
  { path: e.chemin, title: `${e.titre} · Application autonome`, loadComponent: e.ecran },
  { path: `${e.chemin}/**`, title: `${e.titre} · Application autonome`, loadComponent: e.ecran },
]);

/** La section « Applications autonomes » de la zone Noyau transverse : une page (un lien) par application. */
export function sectionApplicationsAutonomes(espaces: readonly EspaceAutonome[], acronym: string): PlanSection {
  const pages: PlanPage[] = espaces.map((e) => ({
    id: 'autonome-' + e.cle, label: e.titre, link: '/' + e.chemin, symbol: e.symbole, tone: 'nav-teal',
    step: 'Aller plus loin', description: e.description, result: e.resultat,
  }));
  return {
    id: 'applications', acronym, label: 'Applications autonomes', intention: 'Aller plus loin',
    description: 'Les applications autonomes bâties sur le noyau : chacune présente toutes ses fonctionnalités dans sa propre interface.',
    tone: 'nav-teal', homeTone: 'nav-lagoon', module: 'core', space: 'projects',
    // Sans application inscrite, la section n'apparaît pas.
    ...(pages.length ? {} : { hidden: true }),
    pages,
  };
}
