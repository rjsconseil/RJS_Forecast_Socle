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

/**
 * Espace propre d'une application autonome, hors de BPM-Astra : sa propre adresse, servie dans l'interface habituelle
 * du site, et un lien dans la section « Applications autonomes » de la zone Noyau transverse.
 */
export interface EspaceInscrit {
  /** Adresse de l'application, sans « / » de tête (par exemple `mes-projets`). */
  chemin: string;
  /** Nom de l'application : le nom de sa section, ou celui de l'application hybride. */
  titre: string;
  /** L'application en une phrase (carte de la section Applications autonomes). */
  description: string;
  /** Ce que l'on y obtient, en une phrase. */
  resultat: string;
  /** Symbole court de la carte (un caractère). */
  symbole?: string;
  /** L'écran d'accueil de l'application, chargé à la demande. */
  ecran: () => Promise<Type<unknown>>;
}

export interface InscriptionApplication {
  /** Clé de l'application : la clé de sa section, ou le nom de l'application hybride. */
  cle: string;
  /** Partie de BPM-Astra (section) dont le menu accueille ses pages, après les pages du socle. */
  section: SectionKey;
  pages: PageInscrite[];
  actions?: ActionInscrite[];
  /** Son espace propre hors de BPM-Astra, s'il y en a un. */
  espace?: EspaceInscrit;
  /** Jeux d'essai lancés par `npm run app` en plus du jeu commun (chemins depuis la racine du dépôt). */
  essais?: string[];
}
