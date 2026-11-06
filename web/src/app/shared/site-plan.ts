/**
 * Plan du site, sur le modèle du registre de navigation de la référence
 * (`site/configuration/navigation-catalog.json` et `shared/site-plan.ts` de rjsconseil/rjs-forecast) :
 * zones rangées en bandes → sections → pages. Le portail, les accueils de zone (`/zones/<zone>`)
 * et de section (`/zones/<zone>/<section>`), la barre latérale et le fil d'Ariane en sont des projections.
 * Les libellés, sigles, symboles et tons reprennent ceux du registre ; les liens sont ceux de ce projet.
 */
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
  /** Propriétaire des réglages (module de `_identities.scss`), indépendant de la couleur de navigation. */
  module?: string;
  /** Nuance d'espace de `_identities.scss`. */
  space: string;
  pages: PlanPage[];
}
export type PlanBandId = 'flagship' | 'assembled' | 'core' | 'technical';
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
/** Le chemin des accueils génériques : `/zones/<zone>` et `/zones/<zone>/<section>`. */
export const PLAN_ROOT = 'zones';

export const PLAN_BANDS: PlanBand[] = [
  { id: 'flagship', label: 'Module phare', description: 'Le parcours le plus abouti : un seul projet pour piloter ensemble votre budget et votre patrimoine, de la saisie à la clôture.' },
  { id: 'assembled', label: 'Les deux modules qu’il réunit', description: 'Budget et Patrimoine restent deux modules frères, construits en miroir. Budget/Patrimoine Management les ouvre sur un même projet.' },
  { id: 'core', label: 'Le socle commun', description: 'Projets, tâches et identités des objets : la base sur laquelle reposent tous les modules.' },
  { id: 'technical', label: 'Modules techniques', description: 'Utilisateurs, administration et paramètres du site.' },
];

/** La section « Vue d'ensemble » d'une zone : son accueil commun. */
function ensemble(zone: string, description: string, module: string | undefined, space: string, intention = 'Comprendre et commencer'): PlanSection {
  return {
    id: 'ensemble',
    acronym: 'VE',
    label: 'Vue d’ensemble',
    intention,
    description,
    tone: 'nav-navy',
    homeTone: 'nav-lagoon',
    home: 'direct',
    module,
    space,
    pages: [{ id: 'ensemble', label: 'Vue d’ensemble', link: `/${PLAN_ROOT}/${zone}`, symbol: '◫', tone: 'nav-navy', zoneOverview: true, overview: true, description, result: 'Le rôle du module, ses parcours et le point de départ.' }],
  };
}

export const PLAN_ZONES: PlanZone[] = [
  {
    id: 'bpm',
    kind: 'zone',
    label: 'Budget/Patrimoine Management',
    acronym: 'BPM',
    eyebrow: 'Application BPM · niveau 3',
    mission: 'Piloter les budgets de l’utilisateur et leur contribution à son patrimoine unique.',
    band: 'flagship',
    size: 'feature',
    tone: 'budget',
    module: 'bpm',
    assembles: ['budget', 'patrimoine'],
    sections: [
      ensemble('bpm', 'Reçu, dépensé, reste et impact patrimonial : la lecture de votre période, avec le détail de chaque flux.', 'bpm', 'bpm-creer'),
      {
        id: 'demarrer',
        acronym: '01',
        label: 'Démarrer un projet',
        intention: 'Le cœur : créer un projet',
        description: 'Configurer le projet de vie, son budget et le patrimoine unique du profil, ou préparer un nouveau projet de la vie.',
        tone: 'nav-teal',
        homeTone: 'nav-lagoon',
        home: 'direct',
        module: 'bpm',
        space: 'bpm-creer',
        pages: [{ id: 'creer', label: 'Démarrer un projet', link: '/creer', symbol: '＋', tone: 'nav-blue', description: 'Créer un projet Budget/Patrimoine à partir de zéro.', result: 'Un projet relié, prêt à entrer dans le cycle.' }],
      },
      {
        id: 'vision',
        acronym: '02',
        label: 'Ma vision budgétaire',
        intention: 'Comprendre · agir · préparer l’avenir',
        description: 'Trois espaces : comprendre la période, piloter le projet de vie et ses objectifs, suivre les plafonds et catégories.',
        tone: 'nav-iris',
        homeTone: 'nav-lagoon',
        home: 'direct',
        module: 'bpm',
        space: 'bpm-parcours',
        pages: [
          { id: 'tableau-de-bord', label: 'Tableau de bord', link: '/tableau-de-bord', symbol: '◎', tone: 'nav-blue', description: 'Reçu, dépensé, reste et impact patrimonial : les entrées, charges et projets de votre période, avec le détail de chaque flux.', result: 'Lire votre budget et son impact sur votre patrimoine, puis agir depuis chaque montant.' },
          { id: 'projet-de-vie', label: 'Gestion du projet de vie', link: '/projet-de-vie', symbol: '◫', tone: 'nav-indigo', description: 'Le projet unique qui englobe tous les autres : cycle en cours, charges indispensables et courantes, projets financés, résultats des cycles, objectif d’excédent et patrimoine.', result: 'Piloter d’un coup d’œil tout le budget du projet de vie et agir sur chaque volet.' },
          { id: 'depenses', hidden: true, label: 'Dépenses de la période', link: '/depenses', symbol: '≡', tone: 'nav-ocean', description: 'Toutes les dépenses effectuées ou attendues, par projet budgétaire, poste et tâche.', result: 'Comprendre chaque dépense et retrouver sa fiche complète.' },
          { id: 'plafonds', label: 'Plafonds et catégories', link: '/plafonds', symbol: '⌈', tone: 'nav-cobalt', description: 'Suivre les marges et les dépassements, définir les plafonds des postes et organiser les catégories de dépenses.', result: 'Voir ce qui dépasse, au niveau du centre et de la catégorie, sans jamais bloquer une dépense.' },
          { id: 'piloter', hidden: true, label: 'Graphiques et chiffres', link: '/piloter', symbol: '◎', tone: 'nav-cobalt', exact: true, description: 'Le bilan de la période : chiffres, graphiques, réel face au prévu, postes et clôtures.', result: 'Comprendre le bilan chiffré de la période.' },
          { id: 'agir', hidden: true, label: 'Ce qu’il faut faire', link: '/piloter/agir', symbol: '→', tone: 'nav-indigo', description: 'Les actions utiles de la période, classées par priorité.', result: 'Savoir quoi faire maintenant sur votre budget.' },
          { id: 'vision', hidden: true, label: 'Objectifs et avenir', link: '/vision', symbol: '✦', tone: 'nav-iris', description: 'Vos objectifs et la projection des prochaines périodes.', result: 'Préparer l’avenir à partir des seules données saisies.' },
        ],
      },
      {
        id: 'projets-vie',
        acronym: '03',
        label: 'Mes projets de la vie',
        intention: 'Projets, tâches, cycle et réglages',
        description: 'Les projets de la vie de l’utilisateur et leurs tâches, le cycle budgétaire et ses réglages.',
        tone: 'nav-petrol',
        homeTone: 'nav-lagoon',
        home: 'direct',
        module: 'bpm',
        space: 'bpm-parcours',
        pages: [
          { id: 'projets', label: 'Projets de la vie', link: '/app/projets', symbol: '▤', tone: 'nav-teal', description: 'Le projet de vie et ses projets de la vie par statut, avec le budget que le budget du projet de vie attribue à chacun.', result: 'Financer chaque projet, ventiler son budget sur ses tâches et suivre ses dépassements.' },
          { id: 'gestion-projet', label: 'Gestion de projet', link: '/app/gestion-projet', symbol: '◫', tone: 'nav-teal', description: 'Créer un projet de la vie et ses tâches, attribuer son budget et piloter les demandes de montant.', result: 'Des projets financés, des tâches dotées de leur montant et un consommé suivi jusqu’au budget du projet de vie.' },
          { id: 'taches', label: 'Tâches des projets', link: '/app/taches', symbol: '☑', tone: 'nav-petrol', description: 'Les tâches des projets de la vie par statut, avec leur part de budget ; glisser une tâche change son état et celui de son projet.', result: 'Faire avancer les tâches et les rattacher aux projets, comme dans le noyau.' },
          { id: 'reglages', label: 'Cycle et réglages', link: '/app/reglages', symbol: '↻', tone: 'nav-blue', description: 'Le cycle budgétaire, le patrimoine, les périodes closes, les centres de coûts et les calculs.', result: 'Un cycle et des réglages explicites.' },
        ],
      },
      {
        id: 'calendrier',
        acronym: '04',
        label: 'Calendrier',
        intention: 'Le budget et le patrimoine dans le temps',
        description: 'Revenus, dépenses, fins de période et versements au patrimoine, en semaine, mois ou année.',
        tone: 'nav-cyan',
        homeTone: 'nav-lagoon',
        home: 'direct',
        module: 'calendar',
        space: 'budget-calendar',
        pages: [{ id: 'calendrier-budget', label: 'Calendrier Budget/Patrimoine', link: '/calendrier-budget', symbol: '▦', tone: 'nav-cyan', step: 'Situer', description: 'Revenus, dépenses, fins de période et versements au patrimoine, en semaine, mois ou année.', result: 'Voir quand l’argent entre, sort et rejoint le patrimoine.' }],
      },
    ],
  },
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
          { id: 'calculs', label: 'Calculs', link: '/admin/calculs', symbol: '∑', tone: 'nav-teal', step: 'Justifier', description: 'Le catalogue des formules, les références disponibles et l’édition d’une formule avec aperçu.', result: 'La formule qui justifie chaque chiffre présenté.' },
        ],
      },
    ],
  },
];

export const planZone = (id: string | null | undefined): PlanZone | null => PLAN_ZONES.find((z) => z.id === id) ?? null;

/** Les pages de menu d'une section : sans les pages seulement repérables. */
export function menuPages(section: PlanSection): PlanPage[] {
  return section.pages.filter((page) => !page.hidden);
}
/** Une section à plusieurs pages montre ses pages sous son grand bouton. */
export function hasPageMenu(section: PlanSection): boolean {
  return menuPages(section).length > 1;
}
/** Une section à plusieurs pages a son accueil, sauf si elle s'ouvre sur sa page représentative. */
export function hasSectionHome(section: PlanSection): boolean {
  return hasPageMenu(section) && section.home !== 'direct';
}
/** Titre d'onglet des accueils génériques : « Section · Zone · RJS Forecast ». */
export function planTitle(zoneId: string | null | undefined, sectionId?: string | null): string {
  const zone = planZone(zoneId);
  const section = zone?.sections.find((entry) => entry.id === sectionId);
  return [section?.label, zone?.label ?? 'Destination introuvable', 'RJS Forecast'].filter(Boolean).join(' · ');
}
/** Entrée d'une zone : son accueil commun. */
export const zoneHomeLink = (zone: PlanZone) => `/${PLAN_ROOT}/${zone.id}`;
export const sectionHomeLink = (zone: PlanZone, section: PlanSection) => `/${PLAN_ROOT}/${zone.id}/${section.id}`;
/** La destination d'une grande entrée de section : son accueil ou sa page utile. */
export function sectionEntry(zone: PlanZone, section: PlanSection): { link: string; query: Record<string, string> | null } {
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

/** Pages supplémentaires (détails) rattachées à une section pour le fil d'Ariane et le menu. */
const DETAILS: { re: RegExp; zone: string; section: string; label: string }[] = [
  { re: /^\/argent\/entrees/, zone: 'bpm', section: 'vision', label: 'Détail des entrées' },
  { re: /^\/argent\/postes\//, zone: 'bpm', section: 'vision', label: 'Détail d’un centre' },
  { re: /^\/argent\/reste/, zone: 'bpm', section: 'vision', label: 'Détail du solde' },
  { re: /^\/projects\/new/, zone: 'noyau', section: 'projets', label: 'Nouveau projet' },
  { re: /^\/projects\/[^/]+\/edit/, zone: 'noyau', section: 'projets', label: 'Modifier le projet' },
  { re: /^\/projects\/[^/]+/, zone: 'noyau', section: 'projets', label: 'Détail du projet' },
  { re: /^\/tasks\/new/, zone: 'noyau', section: 'taches', label: 'Nouvelle tâche' },
  { re: /^\/tasks\/[^/]+\/edit/, zone: 'noyau', section: 'taches', label: 'Modifier la tâche' },
  { re: /^\/admin\/calculs\/.+/, zone: 'administration', section: 'parametres', label: 'Formule' },
];

export type PlanLocationKind = 'portal' | 'zone' | 'section' | 'page' | 'detail' | 'unknown' | 'none';
export interface PlanLocation {
  kind: PlanLocationKind;
  zone: PlanZone | null;
  section: PlanSection | null;
  page: PlanPage | null;
  detailLabel: string | null;
}

const at = (kind: PlanLocationKind, zone: PlanZone | null = null, section: PlanSection | null = null, page: PlanPage | null = null, detailLabel: string | null = null): PlanLocation => ({ kind, zone, section, page, detailLabel });
const matches = (page: PlanPage, path: string) => (page.exact ? path === page.link : path === page.link || path.startsWith(page.link + '/'));

/** Situe une adresse dans le plan : portail, accueil de zone ou de section, page (ou détail rattaché). */
export function locate(url: string): PlanLocation {
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (path === '/') return at('portal');
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === PLAN_ROOT) {
    const zone = planZone(parts[1]);
    if (!zone || parts.length > 3) return at('unknown');
    if (parts.length === 2) {
      const section = zone.sections.find((s) => s.pages.some((p) => p.zoneOverview)) ?? null;
      return at('zone', zone, section, section?.pages.find((p) => p.zoneOverview) ?? null);
    }
    const section = zone.sections.find((entry) => entry.id === parts[2]) ?? null;
    return section ? at('section', zone, section) : at('unknown', zone);
  }
  const detail = DETAILS.find((d) => d.re.test(path));
  if (detail) {
    const zone = planZone(detail.zone)!;
    return at('detail', zone, zone.sections.find((s) => s.id === detail.section) ?? null, null, detail.label);
  }
  let best: { zone: PlanZone; section: PlanSection; page: PlanPage } | null = null;
  for (const zone of PLAN_ZONES)
    for (const section of zone.sections)
      for (const page of section.pages)
        if (!page.zoneOverview && matches(page, path) && (!best || page.link.length > best.page.link.length)) best = { zone, section, page };
  return best ? at('page', best.zone, best.section, best.page) : at('none');
}
