import type { Type } from '@angular/core';
import type { SectionKey } from '../platform/sections';

/**
 * Point d'inscription des applications autonomes (de section ou hybrides) dans BPM-Astra.
 * Chaque application déclare ici, depuis son propre dossier (`sections/<clé>/application/inscription.ts` ou
 * `hybrides/<nom>/inscription.ts`), ses pages, ses actions, ses pages à tester et son jeu d'essai. BPM-Astra les
 * reprend tout seul : une PR d'application ne touche jamais au menu, aux actions ni aux tests du socle.
 * Ces déclarations sont lues aussi par les scripts Node (`npm run app`, `e2e:app`, tests d'interface) :
 * des données simples, sans import autre que de types.
 */
export interface PageInscrite {
  /** Adresse sous /bpm-astra, propre à l'application (jamais celle d'une page du socle). */
  slug: string;
  /** Libellé dans le menu et dans les onglets ; c'est aussi le début du titre de la page. */
  label: string;
  /** L'écran de la page, chargé à la demande. */
  ecran: () => Promise<Type<unknown>>;
  /** Vérifiée aussi sur écran étroit par les tests d'interface. */
  mobile?: boolean;
}

/** Un geste de la page, montré dans ses onglets et dans la palette (⌘K). */
export interface ActionInscrite {
  /** Page de l'application qui montre le geste. */
  page: string;
  label: string;
  /** Paramètres d'adresse qui ouvrent la saisie (par exemple `{ editTask: 'new' }`). */
  query: Record<string, string>;
  /** Page d'Astra où se fait la saisie, si ce n'est pas la page elle-même. */
  vers?: string;
}

export interface InscriptionApplication {
  /** Clé de l'application : la clé de sa section, ou le nom de l'application hybride. */
  cle: string;
  /** Partie de BPM-Astra (section) dont le menu accueille ses pages, après les pages du socle. */
  section: SectionKey;
  pages: PageInscrite[];
  actions?: ActionInscrite[];
  /** Jeux d'essai lancés par `npm run app` en plus du jeu commun (chemins depuis la racine du dépôt). */
  essais?: string[];
}
