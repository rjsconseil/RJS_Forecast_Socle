/**
 * Le grand noyau (socle) : l'interface unique que les fonctionnalités par section et les applications autonomes appellent.
 *
 * Trois étages (docs/sections/README.md) :
 *   1. le grand noyau (socle) : noyau technique et middlewares communs (Budget, Patrimoine, Cycle, Calendrier,
 *      Navigation), servis par l'API et exposés au site ici ;
 *   2. les fonctionnalités par section (Mes projets, Mon budget…) : `sections/<clé>/fonctionnalites/`, sans écran ;
 *   3. les applications autonomes, de section (`sections/<clé>/application/`) ou hybrides (`hybrides/<nom>/`).
 *
 * Les fonctionnalités par section et les applications autonomes n'importent le socle que par ce fichier (garde : api/test/application-isolation.test.mjs).
 * Ajouter une entrée ici, c'est faire évoluer le socle : mode socle, PR à part, non-régression complète.
 */

// Accès à l'API du grand noyau (lectures, commandes, utilisateur courant).
export { Api, ApiError, RecetteContext, toApiError, newRequestKey } from '../core/api.service';
// Modèles des objets du noyau et des middlewares.
export type * from '../core/models';
// Mise en forme commune (heures, dates, montants).
export * from '../core/format';
// Sections du site : catalogue, flux entre sections, ouverture d'un fait à sa source, accueil de section.
export { SITE_SECTIONS, SECTION_FLOWS, sectionOf, flowsInto, flowsFrom, type SectionKey, type SiteSection, type SectionFlow } from './sections';
export { sourceLink, sourceLinkOfId, kindOfId } from './source-link';
export { SectionHome, type SectionIndicator, type SectionAlone } from './section-home';
export type { SourceRef, SourceLink } from './application';
