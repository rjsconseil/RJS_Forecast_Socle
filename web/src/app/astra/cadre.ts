/**
 * Cadre d'accueil BPM-Astra des applications autonomes : ce qu'une application autonome (de section ou hybride) utilise
 * pour vivre dans BPM-Astra (contexte de page, rafraîchissement, chargement, adresses). Les fonctionnalités par section
 * n'y ont pas accès : elles ne connaissent que le grand noyau (platform/grand-noyau.ts).
 */
export { BpmPageContext, BpmRefresh, bpmLoader } from '../bpm/ui';
export { astraUrl, astraSectionHome } from './astra-parts';
export type { InscriptionApplication, PageInscrite, ActionInscrite } from './inscription';
