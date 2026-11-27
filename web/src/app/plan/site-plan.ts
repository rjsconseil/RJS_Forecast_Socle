/**
 * Plan du site, sur le modèle du registre de navigation de la référence
 * (`site/configuration/navigation-catalog.json` et `shared/site-plan.ts` de rjsconseil/rjs-forecast) :
 * zones rangées en bandes → sections → pages. Le portail, les accueils de zone (`/zones/<zone>`)
 * et de section (`/zones/<zone>/<section>`), la barre latérale et le fil d'Ariane en sont des projections.
 * Les libellés, sigles, symboles et tons reprennent ceux du registre ; les liens sont ceux de ce projet.
 */
import { matchWorkspace, PAGE_WORKSPACES } from './page-workspaces';
import { orderItems } from '../navigation/navigation-model';
import { navigationNumber } from '../navigation/navigation-engine';
import { bandKey, objectKey, planOrder, PORTAL_KEY, sectionKey, zoneKey } from './plan-order';
import { PlanTabLink, tabLinksKey, tabLinksOf } from './tab-links';
import { ApplicationDetail, ApplicationObject, overviewSection, PLAN_ROOT } from '../platform/application';
import { APPLICATIONS, ESPACES_AUTONOMES } from '../platform/applications';
import { sectionApplicationsAutonomes } from '../platform/applications-autonomes';

export interface PlanPage {
  id: string;
  label: string;
  link: string;
  symbol: string;
  /** Ne correspond qu'à l'adresse exacte, pas à ses sous-pages. */
  exact?: boolean;
  /** Repère de page, distinct de la dominante de sa section. */
  tone?: string;
  /** Accueil commun de zone (`/zones/<zone>`). */
  zoneOverview?: boolean;
  /** Vue globale : dominante commune des vues d'ensemble. */
  overview?: boolean;
  /** Repérable par l'adresse, mais absente des menus. */
  hidden?: boolean;
  /** Nuance d'espace de `_identities.scss` propre à la page. */
  space?: string;
  /** La phase du parcours que la page représente, affichée sur l'accueil de section. */
  step?: string;
  /** Nom de la vue principale quand la page a des sous-pages : premier onglet du bandeau. */
  mainLabel?: string;
  /** Profondeur dans le menu latéral (sous-page d'une fiche ouverte). */
  depth?: number;
  /** Libellé de l'onglet d'une vue de fiche, quand le bandeau nomme déjà l'objet ouvert. */
  tabLabel?: string;
  description: string;
  result: string;
}
export interface PlanSection {
  id: string;
  acronym: string;
  label: string;
  intention: string;
  description: string;
  tone: string;
  /** Repère propre à l'accueil de la section. */
  homeTone?: string;
  /** `direct` : la section s'ouvre sur sa première page, sans accueil intermédiaire. */
  home?: 'direct';
  /** Section intégrée ailleurs : son ancienne adresse reste reconnue, sans entrée de menu. */
  hidden?: boolean;
  /** Section hors numérotation (ex. « Météo BPM ») : elle montre son sigle et ne décale pas les numéros 01, 02… */
  unnumbered?: true;
  redirectTo?: string;
  /** Accueil stable, même lorsqu'un ancien ordre de menu a été enregistré. */
  homePage?: string;
  /** Propriétaire des réglages (module de `_identities.scss`), indépendant de la couleur de navigation. */
  module?: string;
  /** Nuance d'espace de `_identities.scss`. */
  space: string;
  /** Public de la section ; absent = tout le monde. Voir `PlanAudience`. */
  audience?: PlanAudience;
  pages: PlanPage[];
}
/**
 * `visitor` : seulement sans user connecté (« Démarrer un projet » : le projet de vie naît avec son user).
 * Réservé : `sponsor`, un user connecté qui créera des users rattachés dont il sera le parent (non codé).
 */
export type PlanAudience = 'visitor' | 'sponsor';
/** Les bandes de l'accueil ; une application peut déclarer la sienne (`ApplicationDeclaration.band`). */
export type PlanBandId = 'flagship' | 'assembled' | 'core' | 'technical' | (string & {});
export interface PlanZone {
  id: string;
  label: string;
  acronym: string;
  eyebrow: string;
  mission: string;
  scope?: string;
  band: PlanBandId;
  size: 'feature' | 'medium' | 'full';
  tone: string;
  /** Module de `_identities.scss` porté par la coquille sur les pages de la zone. */
  module?: string;
  assembles?: string[];
  /** Contenu éditorial de l'accueil commun de la zone, sans état métier inventé. */
  overview?: { outcomes: string[]; start: string };
  kind: 'zone';
  /** Module applicatif (Navigation system) : ses sections visibles sont numérotées dans leur ordre, 01, 02… */
  numbered?: true;
  /** Une application peut ouvrir directement sa page principale. */
  home?: string;
  sections: PlanSection[];
}
export interface PlanBand { id: PlanBandId; label: string; description: string }
/** Carte de destination commune aux accueils de zone et de section. */
export interface PlanCard {
  id: string;
  label: string;
  description: string;
  result: string;
  link: string;
  query?: Record<string, string> | null;
  fragment?: string;
  tone?: string;
  pageTone?: string;
  step?: string;
  metric?: number | null;
  action?: string;
}

/** Dominante commune du type « vue d'ensemble ». */
export const PLAN_OVERVIEW_TONE = 'nav-navy';
export { PLAN_ROOT };

export const PLAN_BANDS: PlanBand[] = [
  { id: 'flagship', label: 'Module phare', description: 'Votre vision budgétaire, qui ouvre sur vos projets de la vie ; le calendrier en reflète les événements.' },
  { id: 'assembled', label: 'Les deux modules qu’il réunit', description: 'Budget et Patrimoine restent deux modules frères, construits en miroir. Budget/Patrimoine Management les ouvre sur un même projet.' },
  { id: 'core', label: 'Le socle commun', description: 'Projets, tâches et identités des objets : la base sur laquelle reposent tous les modules.' },
  { id: 'technical', label: 'Modules techniques', description: 'Utilisateurs, administration et paramètres du site.' },
];
// Une application peut apporter sa propre bande d'accueil.
for (const { band } of APPLICATIONS) if (band && !PLAN_BANDS.some((entry) => entry.id === band.id)) PLAN_BANDS.push(band);

const ensemble = overviewSection;

export const PLAN_ZONES: PlanZone[] = [
  ...APPLICATIONS.map((application) => application.zone),
  {
    id: 'budget',
    kind: 'zone',
    label: 'Budget management',
    acronym: 'BM',
    eyebrow: 'Zone principale · niveau 2',
    mission: 'Le middleware Budget : opérations, récurrences, centres de coûts et plafonds, en interface de test.',
    scope: 'Interface de recette : les commandes appellent directement le middleware, hors parcours applicatif. Les actions métier passent par Budget/Patrimoine Management.',
    band: 'assembled',
    size: 'medium',
    tone: 'budget',
    overview: {
      outcomes: [
        'Lire les budgets, les opérations et les centres de coûts de l’utilisateur actif.',
        'Éprouver les services du middleware Budget sur des données de recette.',
        'Revenir à Budget/Patrimoine Management pour les actions métier.',
      ],
      start: 'Ouvrir l’interface de test Budget ; les données sont fictives.',
    },
    sections: [
      ensemble('budget', 'Le middleware Budget : opérations, récurrences, centres de coûts et plafonds, en interface de test.', 'budget', 'budget-home'),
      {
        id: 'tests',
        acronym: '01',
        label: 'Interface de test',
        intention: 'Éprouver les services Budget',
        description: 'Lecture brute des budgets, opérations et centres de coûts, et commandes de test du middleware.',
        tone: 'nav-indigo',
        homeTone: 'nav-lagoon',
        module: 'budget',
        space: 'budget-manage',
        pages: [{ id: 'budget', label: 'Budget (test)', link: '/socle/budget', symbol: '€', tone: 'nav-blue', description: 'Lecture brute des budgets, opérations et centres de coûts de l’utilisateur actif.', result: 'Les services Budget éprouvés sur des données de recette.' }],
      },
    ],
  },
  {
    id: 'patrimoine',
    kind: 'zone',
    label: 'Patrimoine Management',
    acronym: 'PPM',
    eyebrow: 'Zone principale · niveau 2',
    mission: 'Le middleware Patrimoine : stock initial, objectif et capitalisation des clôtures, en interface de test.',
    scope: 'Interface de recette : les commandes appellent directement le middleware, hors parcours applicatif. Les actions métier passent par Budget/Patrimoine Management.',
    band: 'assembled',
    size: 'medium',
    tone: 'budget',
    module: 'patrimoine',
    overview: {
      outcomes: [
        'Lire l’objet Patrimoine de l’utilisateur actif et ses sommes brutes.',
        'Éprouver le stock initial, l’objectif et la capitalisation des clôtures.',
        'Revenir à Budget/Patrimoine Management pour les actions métier.',
      ],
      start: 'Ouvrir l’interface de test Patrimoine ; les données sont fictives.',
    },
    sections: [
      ensemble('patrimoine', 'Le middleware Patrimoine : stock initial, objectif et capitalisation des clôtures, en interface de test.', 'patrimoine', 'patrimoine-create'),
      {
        id: 'tests',
        acronym: '01',
        label: 'Interface de test',
        intention: 'Éprouver les services Patrimoine',
        description: 'Lecture brute de l’objet Patrimoine et commandes de test du middleware.',
        tone: 'nav-indigo',
        homeTone: 'nav-lagoon',
        module: 'patrimoine',
        space: 'patrimoine-manager',
        pages: [{ id: 'patrimoine', label: 'Patrimoine (test)', link: '/socle/patrimoine', symbol: '◇', tone: 'nav-blue', description: 'Lecture brute de l’objet Patrimoine de l’utilisateur actif et de ses sommes.', result: 'Les services Patrimoine éprouvés sur des données de recette.' }],
      },
      {
        id: 'calendrier',
        acronym: '02',
        label: 'Calendrier',
        intention: 'Le patrimoine dans la durée',
        description: 'Ouverture du patrimoine, versements des résultats de période et objectifs de vie datés.',
        tone: 'nav-cyan',
        homeTone: 'nav-lagoon',
        home: 'direct',
        module: 'calendar',
        space: 'patrimoine-calendrier',
        pages: [{ id: 'patrimoine-calendrier', label: 'Calendrier du patrimoine', link: '/patrimoine/calendrier', symbol: '▦', tone: 'nav-cyan', step: 'Situer', description: 'Ouverture du patrimoine, versements des résultats de période et objectifs de vie datés.', result: 'Voir le patrimoine se constituer dans le temps.' }],
      },
    ],
  },
  {
    id: 'cycle',
    kind: 'zone',
    label: 'Cycle et temps',
    acronym: 'CT',
    eyebrow: 'Middleware technique · niveau 2',
    mission: 'Les règles du temps partagées par les middlewares métier : périodes du cycle et cadences, en interface de test.',
    scope: 'Interface de recette en lecture pure : ce middleware ne porte aucun objet. Budget et Patrimoine s’en servent ; une application y accède par eux.',
    band: 'assembled',
    size: 'medium',
    tone: 'budget',
    overview: {
      outcomes: [
        'Situer une date dans la période d’un cycle, selon son jour d’ancrage.',
        'Lire les périodes voisines et leurs bornes.',
        'Comparer les cadences : occurrences par an, moyenne mensuelle.',
      ],
      start: 'Ouvrir l’interface de test Cycle et temps ; rien n’est enregistré.',
    },
    sections: [
      ensemble('cycle', 'Le middleware technique Cycle et temps : périodes du cycle et cadences, en interface de test.', 'budget', 'budget-home'),
      {
        id: 'tests',
        acronym: '01',
        label: 'Interface de test',
        intention: 'Éprouver les règles du temps',
        description: 'Périodes d’un cycle et cadences, en lecture pure.',
        tone: 'nav-indigo',
        homeTone: 'nav-lagoon',
        module: 'budget',
        space: 'budget-manage',
        pages: [{ id: 'cycle', label: 'Cycle et temps (test)', link: '/socle/cycle', symbol: '◴', tone: 'nav-blue', description: 'Périodes d’un cycle selon son jour d’ancrage, et cadences des répétitions.', result: 'Les règles du temps éprouvées sans rien enregistrer.' }],
      },
    ],
  },
  {
    id: 'noyau',
    kind: 'zone',
    label: 'Noyau transverse',
    acronym: 'N0',
    eyebrow: 'Zone principale · niveau 0',
    mission: 'Le socle commun : projets, tâches et identités des objets sur lesquels reposent tous les modules du site.',
    band: 'core',
    size: 'full',
    tone: 'core',
    overview: {
      outcomes: [
        'Cadrer les projets et leurs tâches dans un socle commun.',
        'Retrouver l’identité, les références et le rejeu des objets persistés.',
        'Fournir aux modules un cadre stable sans mélanger leurs données métier.',
      ],
      start: 'Commencer par créer ou ouvrir un projet du noyau ; les modules Budget et Patrimoine pourront ensuite s’y rattacher.',
    },
    sections: [
      ensemble('noyau', 'Le socle commun : projets, tâches et identités des objets sur lesquels reposent tous les modules du site.', 'core', 'projects'),
      {
        id: 'projets',
        acronym: '01',
        label: 'Projets',
        intention: 'Cadrer',
        description: 'Chaque projet comme un ensemble cohérent : son cadre et son plan de tâches.',
        tone: 'nav-blue',
        homeTone: 'nav-lagoon',
        home: 'direct',
        module: 'core',
        space: 'projects',
        pages: [{ id: 'projects', label: 'Projets', link: '/projects', symbol: '◫', tone: 'nav-blue', step: 'Cadrer', description: 'Chaque projet comme un ensemble cohérent : son cadre et son plan de tâches.', result: 'Le tableau des projets, leur fiche et leur plan.' }],
      },
      {
        id: 'taches',
        acronym: '02',
        label: 'Tâches',
        intention: 'Agir',
        description: 'La vue transversale des tâches, rattachées ou non à un projet, avec filtres et recherche.',
        tone: 'nav-indigo',
        homeTone: 'nav-lagoon',
        home: 'direct',
        module: 'core',
        space: 'tasks',
        pages: [{ id: 'tasks', label: 'Tâches', link: '/tasks', symbol: '◇', tone: 'nav-indigo', step: 'Agir', description: 'La vue transversale des tâches, rattachées ou non à un projet, avec filtres et recherche.', result: 'Le tableau des tâches et le détail de chacune.' }],
      },
      {
        id: 'calendrier',
        acronym: '03',
        label: 'Calendrier',
        intention: 'Situer dans le temps',
        description: 'Les projets et les tâches dans le temps : débuts, dates prévues et échéances, en semaine, mois ou année.',
        tone: 'nav-cyan',
        homeTone: 'nav-lagoon',
        home: 'direct',
        module: 'calendar',
        space: 'calendar',
        pages: [{ id: 'calendrier', label: 'Calendrier', link: '/calendrier', symbol: '▦', tone: 'nav-cyan', step: 'Situer', description: 'Les projets et les tâches dans le temps : débuts, dates prévues et échéances, en semaine, mois ou année.', result: 'Voir le travail dans son temps et le replanifier.' }],
      },
      {
        id: 'objets',
        acronym: '04',
        label: 'Object Management',
        intention: 'Identités, références et rejeu',
        description: 'Diagnostic en lecture seule des objets persistés des trois niveaux.',
        tone: 'nav-teal',
        homeTone: 'nav-lagoon',
        home: 'direct',
        module: 'core',
        space: 'projects',
        pages: [{ id: 'object-management', label: 'Object Management', link: '/object-management', symbol: '⌘', tone: 'nav-teal', step: 'Tracer', description: 'Diagnostic en lecture seule des objets persistés des trois niveaux.', result: 'L’identité, les références et le rejeu de chaque objet.' }],
      },
      // Les applications autonomes qui reposent sur le noyau, chacune dans son propre espace (platform/applications-autonomes.ts).
      sectionApplicationsAutonomes(ESPACES_AUTONOMES, '05'),
    ],
  },
  {
    id: 'administration',
    kind: 'zone',
    label: 'Administration du site',
    acronym: 'AS',
    eyebrow: 'Zone technique · niveau 1',
    mission: 'Les utilisateurs et leurs types, les paramètres et les formules de calcul du site.',
    band: 'technical',
    size: 'medium',
    tone: 'users',
    overview: {
      outcomes: [
        'Créer les utilisateurs et choisir celui qui travaille ; son budget « Projet de vie », son patrimoine et sa composition BPM sont créés avec lui.',
        'Régler les paramètres du site.',
        'Consulter et éditer les formules de calcul des chiffres présentés.',
      ],
      start: 'Commencer par Utilisateurs : sans utilisateur, les modules métier restent vides.',
    },
    sections: [
      ensemble('administration', 'Les utilisateurs et leurs types, les paramètres et les formules de calcul du site.', 'users', 'users'),
      {
        id: 'utilisateurs',
        acronym: 'UT',
        label: 'Utilisateurs',
        intention: 'Créer et choisir qui travaille',
        description: 'Créer les utilisateurs et choisir celui qui travaille.',
        tone: 'nav-blue',
        homeTone: 'nav-lagoon',
        home: 'direct',
        module: 'users',
        space: 'users-admin',
        pages: [{ id: 'utilisateurs', label: 'Utilisateurs', link: '/utilisateurs', symbol: '⚿', tone: 'nav-blue', description: 'Les utilisateurs et leur type.', result: 'Une identité commune à tous les modules.' }],
      },
      {
        id: 'parametres',
        acronym: 'AD',
        label: 'Administration',
        intention: 'Paramètres et calculs',
        description: 'Les paramètres du site et les formules de calcul des chiffres présentés.',
        tone: 'nav-teal',
        homeTone: 'nav-lagoon',
        module: 'configuration',
        space: 'configuration-settings',
        pages: [
          { id: 'admin', label: 'Paramètres', link: '/admin', symbol: '⚙', tone: 'nav-blue', exact: true, step: 'Régler', description: 'Les paramètres du site, rangés par niveau et par groupe.', result: 'Des réglages explicites, appliqués à tout le site.' },
          { id: 'calendriers', label: 'Calendriers · Sources et affichage', link: '/admin/calendriers', symbol: '▦', tone: 'nav-teal', step: 'Configurer', description: 'Les sources proposées par chaque instance, les valeurs initiales et les commandes accessibles aux utilisateurs.', result: 'Un calendrier commun, configuré pour chaque module.' },
          { id: 'calculs', label: 'Calculs', link: '/admin/calculs', symbol: '∑', tone: 'nav-teal', step: 'Justifier', description: 'Le catalogue des formules, les références disponibles et l’édition d’une formule avec aperçu.', result: 'La formule qui justifie chaque chiffre présenté.' },
        ],
      },
    ],
  },
  {
    id: 'navigation', kind: 'zone', label: 'Navigation system', acronym: 'NS',
    eyebrow: 'Module technique · niveau 0', mission: 'Régler la navigation commune à tous les modules.',
    band: 'technical', size: 'medium', tone: 'nav-navy', module: 'navigation',
    sections: [{ id: 'presentation', acronym: 'NS', label: 'Présentation et libellés', intention: 'Personnaliser les parcours',
      description: 'Régler les menus, les onglets et les repères de navigation.', tone: 'nav-blue', home: 'direct', space: 'navigation',
      pages: [{ id: 'navigation', label: 'Navigation system', link: '/navigation', symbol: '☷', description: 'Présentation et libellés par site, module ou page.', result: 'Une navigation cohérente et personnalisable.' }] }],
  },
];

export const planZone = (id: string | null | undefined): PlanZone | null => PLAN_ZONES.find((z) => z.id === id) ?? null;

/** Les sections d'une zone visibles pour ce public : `connected` = un user est connecté. */
export function zoneSections(zone: PlanZone, connected: boolean): PlanSection[] {
  const sections = zone.sections.filter((section) => !section.hidden && (!section.audience || (section.audience === 'visitor') !== connected));
  return orderItems(sections, (section) => sectionKey(zone.id, section.id), planOrder()[zoneKey(zone.id)]);
}
/**
 * Le repère d'une section : dans un module applicatif, son rang parmi les sections visibles (01, 02…),
 * qui suit l'ordre réglé et le public ; ailleurs, son sigle. La couleur de la section ne change pas.
 */
export function sectionMark(zone: PlanZone, section: PlanSection, visible: readonly PlanSection[]): string {
  const index = zone.numbered && !section.unnumbered ? visible.filter((entry) => !entry.unnumbered).findIndex((entry) => entry.id === section.id) : -1;
  return index < 0 ? section.acronym : navigationNumber(index);
}
/** Les zones dans l'ordre réglé : bandes de l'accueil, puis zones de chaque bande. Sans réglage, l'ordre du plan. */
export function orderedZones(): PlanZone[] {
  const order = planOrder();
  if (!order[PORTAL_KEY] && !PLAN_BANDS.some((band) => order[bandKey(band.id)])) return PLAN_ZONES;
  const rows = orderItems(portalBands(PLAN_ZONES), (row) => bandKey(row.band?.id ?? ''), order[PORTAL_KEY]);
  return rows.flatMap((row) => orderItems(row.zones, (zone) => zoneKey(zone.id), order[bandKey(row.band?.id ?? '')]));
}
const SECTION_ZONE = new WeakMap<PlanSection, string>();
function zoneOf(section: PlanSection): string {
  if (!SECTION_ZONE.has(section)) for (const zone of PLAN_ZONES) for (const entry of zone.sections) SECTION_ZONE.set(entry, zone.id);
  return SECTION_ZONE.get(section) ?? '';
}
/** Les pages de menu dans l'ordre du plan : lui seul décide de la destination d'une section. */
function planPages(section: PlanSection): PlanPage[] {
  return section.pages.filter((page) => !page.hidden);
}

/** Les pages de menu d'une section, dans l'ordre réglé : sans les pages seulement repérables. */
export function menuPages(section: PlanSection): PlanPage[] {
  const pages = orderItems(planPages(section), (page) => page.link, planOrder()[sectionKey(zoneOf(section), section.id)]);
  return section.homePage ? pages.sort((a, b) => Number(b.link === section.homePage) - Number(a.link === section.homePage)) : pages;
}
/** Une section à plusieurs pages montre ses pages sous son grand bouton. */
export function hasPageMenu(section: PlanSection): boolean {
  return planPages(section).length > 1 || planPages(section).some(page => PAGE_WORKSPACES.some(view => !view.page && view.parent === page.link));
}
/** Une section à plusieurs pages a son accueil, sauf si elle s'ouvre sur sa page représentative. */
export function hasSectionHome(section: PlanSection): boolean {
  return planPages(section).length > 1 && section.home !== 'direct';
}
/** Titre d'onglet des accueils génériques : « Section · Zone · RJS Forecast ». */
export function planTitle(zoneId: string | null | undefined, sectionId?: string | null): string {
  const zone = planZone(zoneId);
  const section = zone?.sections.find((entry) => entry.id === sectionId);
  return [section?.label, zone?.label ?? 'Destination introuvable', 'RJS Forecast'].filter(Boolean).join(' · ');
}
/** Entrée d'une zone : son accueil commun. */
export const zoneHomeLink = (zone: PlanZone) => zone.home ?? `/${PLAN_ROOT}/${zone.id}`;
export const sectionHomeLink = (zone: PlanZone, section: PlanSection) => `/${PLAN_ROOT}/${zone.id}/${section.id}`;
/** La destination d'une grande entrée de section : son accueil ou sa page utile. */
export function sectionEntry(zone: PlanZone, section: PlanSection): { link: string; query: Record<string, string> | null } {
  if (section.redirectTo) return { link: section.redirectTo, query: null };
  if (hasSectionHome(section)) return { link: sectionHomeLink(zone, section), query: null };
  const page = menuPages(section)[0] ?? section.pages[0];
  return { link: page.link, query: null };
}

/**
 * Regroupe des zones déjà ordonnées en bandes du portail. Une bande prend la
 * place de sa première zone ; une zone sans bande déclarée forme sa propre rangée.
 */
export function portalBands(zones: readonly PlanZone[], bands: readonly PlanBand[] = PLAN_BANDS): { band: PlanBand | null; zones: PlanZone[] }[] {
  const rows: { band: PlanBand | null; zones: PlanZone[] }[] = [];
  for (const zone of zones) {
    const band = bands.find((entry) => entry.id === zone.band) ?? null;
    const row = band ? rows.find((entry) => entry.band?.id === band.id) : undefined;
    if (row) row.zones.push(zone);
    else rows.push({ band, zones: [zone] });
  }
  return rows;
}

/** Pages supplémentaires (détails) rattachées à une page pour le fil d'Ariane et le menu. */
export const PLAN_DETAILS: (ApplicationDetail & { zone: string })[] = [
  ...APPLICATIONS.flatMap((application) => (application.details ?? []).map((detail) => ({ ...detail, zone: application.id }))),
  { pattern: /^\/projects\/new/, zone: 'noyau', section: 'projets', parent: '/projects', label: 'Nouveau projet' },
  { pattern: /^\/projects\/[^/]+\/edit/, zone: 'noyau', section: 'projets', parent: '/projects', label: 'Modifier le projet' },
  { pattern: /^\/projects\/[^/]+/, zone: 'noyau', section: 'projets', parent: '/projects', label: 'Détail du projet' },
  { pattern: /^\/tasks\/new/, zone: 'noyau', section: 'taches', parent: '/tasks', label: 'Nouvelle tâche' },
  { pattern: /^\/tasks\/[^/]+\/edit/, zone: 'noyau', section: 'taches', parent: '/tasks', label: 'Modifier la tâche' },
  { pattern: /^\/admin\/calculs\/.+/, zone: 'administration', section: 'parametres', parent: '/admin/calculs', label: 'Formule' },
];
/** Les fiches déclarées par les applications : un objet ouvert dans une page de menu. */
export const PLAN_OBJECTS: ApplicationObject[] = APPLICATIONS.flatMap((application) => application.objects ?? []);
/** Le modèle de fiche garde sa clé quand sa liste change de page. */
export const objectTemplate = (home: string) => objectKey(PLAN_OBJECTS.find(object => object.home === home)?.base ?? home);

export type PlanLocationKind = 'portal' | 'zone' | 'section' | 'page' | 'subpage' | 'detail' | 'unknown' | 'none';
/** Objet ouvert dans une page (fiche) : ses sous-pages deviennent les onglets du bandeau. */
export interface PlanObject {
  kind: string;
  id: string;
  link: string;
  /** La page de menu qui liste ces objets. */
  home: string;
  /** Le nom court de la fiche quand son titre n'est pas encore connu. */
  fallback: string;
}
export interface PlanLocation {
  kind: PlanLocationKind;
  zone: PlanZone | null;
  section: PlanSection | null;
  page: PlanPage | null;
  detailLabel: string | null;
  subpage: PlanPage | null;
  object?: PlanObject | null;
}

const at = (kind: PlanLocationKind, zone: PlanZone | null = null, section: PlanSection | null = null, page: PlanPage | null = null, detailLabel: string | null = null, subpage: PlanPage | null = null, object: PlanObject | null = null): PlanLocation => ({ kind, zone, section, page, detailLabel, subpage, object });
const matches = (page: PlanPage, path: string) => (page.exact ? path === page.link : path === page.link || path.startsWith(page.link + '/'));

/** Le nom court d'une fiche quand ni son titre ni sa déclaration ne le donnent. */
export const OBJECT_FALLBACK = 'Fiche';
/** La fiche ouverte à cette adresse, d'après les déclarations des applications. */
function objectAt(path: string): PlanObject | null {
  for (const entry of PLAN_OBJECTS) {
    const id = entry.pattern.exec(path)?.[1];
    if (id) return { kind: entry.kind, id, link: `${entry.base ?? entry.home}/${id}`, home: entry.home, fallback: entry.fallback };
  }
  return null;
}

function pageOf(link: string): { zone: PlanZone; section: PlanSection; page: PlanPage } | null {
  for (const zone of PLAN_ZONES) for (const section of zone.sections) {
    const page = section.pages.find(entry => entry.link === link);
    if (page) return { zone, section, page };
  }
  return null;
}

/** Situe une adresse dans le plan : portail, accueil de zone ou de section, page, sous-page, fiche ou détail rattaché. */
export function locate(url: string): PlanLocation {
  let path = url.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const visited = new Set<string>();
  while (!visited.has(path)) {
    visited.add(path);
    const target = APPLICATIONS.find(application => application.aliases?.[path])?.aliases?.[path];
    if (!target) break;
    path = target;
  }
  if (path === '/') return at('portal');
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === PLAN_ROOT) {
    const zone = planZone(parts[1]);
    if (!zone || parts.length > 3) return at('unknown');
    if (parts.length === 2) {
      if (zone.home) return locate(zone.home);
      const section = zone.sections.find((s) => s.pages.some((p) => p.zoneOverview)) ?? null;
      return at('zone', zone, section, section?.pages.find((p) => p.zoneOverview) ?? null);
    }
    const section = zone.sections.find((entry) => entry.id === parts[2]) ?? null;
    if (section?.redirectTo) return locate(section.redirectTo);
    return section ? at('section', zone, section) : at('unknown', zone);
  }
  const object = objectAt(path);
  const specialized = matchWorkspace(path);
  if (specialized && !specialized.workspace.page) {
    const owner = pageOf(specialized.workspace.parent);
    if (owner) return at('subpage', owner.zone, owner.section, owner.page, null, {
      id: specialized.workspace.key, link: path, label: specialized.workspace.label, tabLabel: specialized.workspace.tabLabel,
      symbol: '↳', tone: owner.page.tone, description: specialized.workspace.lead, result: specialized.workspace.lead,
    }, object);
  }
  if (object) {
    const owner = pageOf(object.home);
    if (owner) return at('detail', owner.zone, owner.section, owner.page, object.fallback, null, object);
  }
  const detail = PLAN_DETAILS.find((d) => d.pattern.test(path) && planZone(d.zone));
  if (detail) {
    const zone = planZone(detail.zone)!;
    const section = zone.sections.find((s) => s.id === detail.section) ?? null;
    return at('detail', zone, section, section?.pages.find(page => page.link === detail.parent) ?? null, detail.label);
  }
  let best: { zone: PlanZone; section: PlanSection; page: PlanPage } | null = null;
  for (const zone of PLAN_ZONES)
    for (const section of zone.sections)
      for (const page of section.pages)
        if (!page.zoneOverview && matches(page, path) && (!best || page.link.length > best.page.link.length)) best = { zone, section, page };
  return best ? at('page', best.zone, best.section, best.page) : at('none');
}

/** Les sous-pages d'une page ; une fiche ouverte ajoute son nœud et ses propres sous-pages. */
export function pageChildren(page: PlanPage, url = '', objectLabel: string | null = null): PlanPage[] {
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '');
  const current = locate(url);
  const object = current.page?.link === page.link ? current.object ?? null : null;
  const child = (view: (typeof PAGE_WORKSPACES)[number], depth = 1): PlanPage => ({
    id: view.key, label: view.label, link: `/${view.path.replace(':id', object?.id ?? '')}`,
    symbol: '↳', tone: page.tone, description: view.lead, result: view.lead, depth,
  });
  const views = PAGE_WORKSPACES.filter(view => !view.page && view.parent === page.link && view.menu !== false);
  const sorted = (list: typeof views, parent: string) => orderItems(list, view => '/' + view.path, planOrder()[parent]);
  const children = sorted(views.filter(view => !view.path.includes(':id')), page.link).map(view => child(view));
  if (object) {
    children.push({ id: 'object', label: objectLabel || object.fallback, link: object.link, symbol: '◆', tone: page.tone, description: 'La fiche ouverte : sa vue principale.', result: '', depth: 1 });
    children.push(...sorted(views.filter(view => view.path.includes(':id')), objectTemplate(page.link)).map(view => child(view, 2)));
  }
  if (current.kind === 'detail' && !current.object && current.page?.link === page.link && current.detailLabel)
    children.push({ id: 'current-detail', label: objectLabel || current.detailLabel, link: path, symbol: '↳', tone: page.tone, description: '', result: '', depth: 1 });
  return children;
}

export interface PlanCrumb { label: string; link?: string }
/** Un onglet du bandeau ; `links` : ses gestes, ouverts en liste verticale sous l'onglet. */
export interface PlanTab { id: string; label: string; link: string; current: boolean; links: PlanTabLink[] }
/**
 * Le contexte d'une adresse, lu par tout le cadre : surtitre et titre du bandeau, lien vers le
 * niveau supérieur, onglets des sous-pages et fil d'Ariane. Une seule règle pour toutes les pages.
 */
export interface PlanContext {
  location: PlanLocation;
  /** « Section · Page » : où l'on est, sans répéter le titre. */
  eyebrow: string | null;
  /** Le nom de la destination courante tel que le menu l'affiche. */
  label: string | null;
  /** Le niveau supérieur (page principale ou fiche) ; null sur une page de menu. */
  up: { label: string; link: string } | null;
  /** Vue principale et sous-pages de la page, ou de la fiche ouverte. */
  tabs: PlanTab[];
  crumbs: PlanCrumb[];
}

export function planContext(url: string, objectLabel: string | null = null): PlanContext {
  const location = locate(url);
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const { kind, zone, section, page, subpage, detailLabel, object } = location;
  const objectName = objectLabel || object?.fallback || OBJECT_FALLBACK;
  const crumbs: PlanCrumb[] = [];
  if (!zone) {
    if (kind === 'none') crumbs.push({ label: 'Page hors du plan' });
    if (kind === 'unknown') crumbs.push({ label: 'Destination introuvable' });
    return { location, eyebrow: null, label: crumbs[0]?.label ?? null, up: null, tabs: [], crumbs };
  }
  crumbs.push({ label: zone.label, link: zoneHomeLink(zone) });
  if (kind !== 'zone' && section) crumbs.push({ label: section.label, link: sectionEntry(zone, section).link });
  // Une page qui porte le nom de sa section ne se répète pas dans le fil.
  if (kind !== 'zone' && page && section && page.label !== section.label && !page.zoneOverview) crumbs.push({ label: page.label, link: page.link });
  if (object) crumbs.push({ label: objectName, link: object.link });
  if (subpage) crumbs.push({ label: object ? subpage.label : subpage.label, link: path });
  else if (detailLabel && !object) crumbs.push({ label: objectLabel || detailLabel, link: path });
  if (kind === 'unknown') crumbs.push({ label: 'Destination introuvable' });
  // Le dernier maillon est la page courante : il n'est pas un lien.
  delete crumbs[crumbs.length - 1].link;

  const label = object && !subpage ? objectName : subpage?.label ?? ((detailLabel && (objectLabel || detailLabel)) || null) ?? page?.label ?? section?.label ?? zone.label;
  const inPage = kind === 'page' || kind === 'subpage' || kind === 'detail';
  const eyebrow = !section || kind === 'zone' || section.id === 'ensemble' ? zone.label
    : inPage && page && page.label !== section.label && (kind !== 'page') ? `${section.label} · ${page.label}`
      : section.label;
  const up = object
    ? subpage ? { label: objectName, link: object.link } : page ? { label: page.label, link: page.link } : null
    : (kind === 'subpage' || kind === 'detail') && page ? { label: page.label, link: page.link } : null;

  // Les gestes d'un onglet viennent du modèle de sa page (`:id` pour une fiche), dans l'ordre réglé.
  const withLinks = (tab: { id: string; label: string; link: string }, model = tab.link): PlanTab => ({
    ...tab, current: tab.link === path,
    links: orderItems(tabLinksOf(model), link => link.key, planOrder()[tabLinksKey(model, tab.id === 'main')]),
  });
  let tabs: PlanTab[] = [];
  if (object && page) {
    const views = orderItems(PAGE_WORKSPACES.filter(view => view.parent === page.link && view.path.includes(':id')), view => '/' + view.path, planOrder()[objectTemplate(page.link)]);
    tabs = [{ id: 'object', label: 'Vue d’ensemble', link: object.link },
      ...views.map(view => ({ id: view.key, label: view.tabLabel ?? view.label, link: `/${view.path.replace(':id', object.id)}` }))]
      .map(tab => withLinks(tab, tab.id === 'object' ? objectTemplate(page.link) : '/' + (views.find(view => view.key === tab.id)?.path ?? '')));
  } else if (page && (kind === 'page' || kind === 'subpage' || (kind === 'zone' && !!zone.numbered))) {
    const children = pageChildren(page, url).filter(entry => entry.id !== 'current-detail' && entry.id !== 'object' && (entry.depth ?? 1) === 1);
    // N3 · N4 : l'accueil de la page reste en tête dès qu'il porte des actions, même sans autre sous-page.
    if (children.length || tabLinksOf(page.link).length) tabs = [{ id: 'main', label: page.mainLabel ?? 'Vue principale', link: page.link }, ...children.map(entry => ({ id: entry.id, label: entry.label, link: entry.link }))]
      .map(tab => withLinks(tab));
  }
  return { location, eyebrow, label, up, tabs, crumbs };
}
