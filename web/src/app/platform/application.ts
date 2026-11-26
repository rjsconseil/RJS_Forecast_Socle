/**
 * Déclaration d'application : le seul contrat à remplir pour ajouter au site une application de
 * niveau 3 (comme BPM), quel que soit son sujet. L'application apporte un fichier qui décrit sa zone,
 * ses pages, ses sous-pages, ses actions, ses sections de contenu, ses fiches et ses routes ; la
 * plateforme assemble le plan, le menu, le cadre du haut, la numérotation, l'audit et les adresses.
 * Ce fichier ne dépend d'aucune application et d'aucun catalogue : il ne porte que le contrat.
 */
import type { Type } from '@angular/core';
import type { Route, Routes } from '@angular/router';
import type { ContentSection } from '../navigation/content-section-catalog';
import type { WorkspaceDestination } from '../plan/page-workspaces';
import type { QuickLink } from '../plan/quick-nav';
import type { PlanBand, PlanLocation, PlanPage, PlanSection, PlanZone } from '../plan/site-plan';
import type { TabLink } from '../plan/tab-links';

/** Le chemin des accueils génériques : `/zones/<zone>` et `/zones/<zone>/<section>`. */
export const PLAN_ROOT = 'zones';

/** Une adresse de détail rattachée à une page du plan (fil d'Ariane et menu). */
export interface ApplicationDetail {
  pattern: RegExp;
  /** La section de la zone qui accueille le détail. */
  section: string;
  /** L'adresse de la page de menu dont dépend le détail. */
  parent: string;
  label: string;
}
/** Une fiche : un objet ouvert dans une page, dont les sous-pages deviennent les onglets du bandeau. */
export interface ApplicationObject {
  kind: string;
  /** L'adresse de la page de menu qui liste ces objets. */
  home: string;
  /** Base des fiches lorsque leur adresse diffère de celle de la liste. */
  base?: string;
  /** Reconnaît l'adresse d'une fiche ; le premier groupe capture l'identifiant. */
  pattern: RegExp;
  /** Le nom court d'une fiche quand son titre n'est pas encore connu. */
  fallback: string;
}
/** Là où se trouve l'utilisateur quand la palette demande ses actions rapides à l'application. */
export interface ApplicationActionContext {
  path: string;
  location: PlanLocation;
  /** La lecture en cours (période, filtres), à emporter dans les liens. */
  reading: Record<string, string>;
  tone: string;
  connected: boolean;
  objectLabel: string | null;
}
export interface ApplicationDeclaration {
  /** Identifiant de l'application : celui de sa zone et de son module serveur. */
  id: string;
  /** La zone : identité, sections (niveau 1) et pages (niveau 2). `numbered: true` pour une application. */
  zone: PlanZone;
  /** Une bande d'accueil propre, si l'application ne rejoint pas une bande existante. */
  band?: PlanBand;
  /** Les adresses des pages de menu, des détails et les redirections. */
  routes: Routes;
  /** Anciennes adresses de liste : conserver aussi leur contexte dans l'historique et les favoris. */
  aliases?: Record<string, string>;
  /** Les sous-pages (niveau 3) : chacune reçoit sa route et son onglet. */
  workspaces?: WorkspaceDestination[];
  /** Les actions des onglets (N4). */
  actions?: TabLink[];
  /** Les sections de contenu (niveau 4), par adresse de page ou de sous-page. */
  contentSections?: Record<string, ContentSection[]>;
  details?: ApplicationDetail[];
  objects?: ApplicationObject[];
  /** Modèles d'adresse réglables dans l'atelier de navigation : [adresse, libellé]. */
  templates?: [string, string][];
  /** Contenu propre de l'accueil de la zone ; sans lui, l'accueil générique s'affiche. Le composant reçoit `zone`. */
  overview?: () => Promise<Type<unknown>>;
  /**
   * Point d'extension « création d'utilisateur » : l'écran qui crée un utilisateur et son espace, affiché par la
   * page technique Utilisateurs. Une seule application le fournit (BPM : un user naît avec son projet de vie).
   */
  userCreation?: () => Promise<Type<unknown>>;
  /**
   * Application de présentation construite sur les écrans d'une autre application (ex. BPM-Astra sur BPM) :
   * seule cette dépendance-là est admise entre applications, et le test d'isolation la vérifie.
   */
  builtOn?: string;
  /** Teintes de section propres à l'application (sa feuille de style les définit) ; s'ajoutent aux identités communes. */
  tones?: string[];
  /** Point d'extension « choisir un profil » : écran affiché par le cadre quand aucun utilisateur n'est choisi dans la zone. */
  profilePicker?: () => Promise<Type<unknown>>;
  /** Les actions rapides propres à l'application, proposées dans la palette de commandes. */
  quickActions?: (context: ApplicationActionContext) => QuickLink[];
}

/** La section « Vue d'ensemble » d'une zone : son accueil commun. */
export function overviewSection(zone: string, description: string, module: string | undefined, space: string,
  options: { intention?: string; label?: string; mainLabel?: string; step?: string; acronym?: string; pages?: PlanPage[] } = {}): PlanSection {
  return {
    id: 'ensemble',
    acronym: options.acronym ?? 'VE',
    label: 'Vue d’ensemble',
    intention: options.intention ?? 'Comprendre et commencer',
    description,
    tone: 'nav-navy',
    homeTone: 'nav-lagoon',
    home: 'direct',
    module,
    space,
    pages: [
      { id: 'ensemble', label: options.label ?? 'Vue d’ensemble', mainLabel: options.mainLabel ?? 'Comprendre et commencer', link: `/${PLAN_ROOT}/${zone}`, symbol: '◫', tone: 'nav-navy', zoneOverview: true, overview: true, step: options.step, description, result: 'Le rôle du module, ses parcours et le point de départ.' },
      ...(options.pages ?? []),
    ],
  };
}
/** Une sous-page : son adresse, la page dont elle dépend, sa clé, son libellé, son intention et son écran. */
export const subpage = (path: string, parent: string, key: string, label: string, lead: string,
  loadComponent?: Route['loadComponent'], existing = false): WorkspaceDestination =>
  ({ path, parent, key, label, title: label, lead, loadComponent, existing });
/** Une action qui ouvre une autre destination (sous-page ou espace), sans paramètre de commande. */
export const openAction = (tab: string, label: string, link: string): TabLink => ({ tab, label, query: {}, link });
/** Les sections de contenu d'une adresse : [identifiant du titre, libellé]. */
export const contentSections = (...items: [string, string][]): ContentSection[] => items.map(([id, label]) => ({ id, label }));
