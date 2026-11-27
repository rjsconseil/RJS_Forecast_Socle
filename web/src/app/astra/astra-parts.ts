import type { Type } from '@angular/core';
import { sectionOf, type SectionKey } from '../platform/sections';

// Les cinq parties de BPM-Astra : une seule déclaration donne le menu, la couleur, le parcours et les ponts.
// Mes projets et Mon budget apportent le contenu (projets et tâches ; échéances récurrentes et plafonds) ;
// Mon quotidien le gère au jour le jour ; Cycles valide tout le cycle avant d'ouvrir le suivant ;
// Patrimoine est la finalité : les objectifs que tout le reste fait grandir.

/** Les parties d'Astra sont les sections du site (catalogue commun `platform/sections.ts`). */
export type AstraPartKey = SectionKey;

export interface AstraPage {
  /** Adresse sous /bpm-astra ('' : accueil). */
  slug: string;
  label: string;
  /** Écran métier de BPM présenté par Astra, ou écran propre à Astra (`own`). */
  source?: string;
  own?: () => Promise<Type<unknown>>;
}

export interface AstraPart {
  key: AstraPartKey;
  label: string;
  /** Teinte déclarée dans le plan : elle colore le cadre, le menu et les pages de la partie. */
  tone: `astra-${AstraPartKey}`;
  icon: string;
  role: string;
  pages: AstraPage[];
}

export const ASTRA_PARTS: AstraPart[] = [
  {
    key: 'quotidien',
    label: sectionOf('quotidien').label,
    tone: sectionOf('quotidien').tone,
    icon: 'quotidien',
    role: 'Gérer le cycle au jour le jour : ce qui entre, ce qui sort et ce qui est prévu, projets compris.',
    pages: [
      { slug: '', label: 'Mon projet de vie', own: () => import('./astra.page').then(m => m.AstraHome) },
      { slug: 'mouvements', label: 'Mouvements', source: 'tableau-de-bord/entrees' },
      { slug: 'calendrier', label: 'Calendrier', source: 'calendrier-budget' },
    ],
  },
  {
    key: 'projets',
    label: sectionOf('projets').label,
    tone: sectionOf('projets').tone,
    icon: 'projets',
    role: 'Sortir de la routine : créer vos projets de la vie, les financer depuis leur fiche, les réaliser.',
    pages: [
      { slug: 'projets', label: 'Projets de la vie', source: 'projet-de-vie/projets' },
      { slug: 'taches', label: 'Tâches', source: 'app/taches' },
    ],
  },
  {
    key: 'budget',
    label: sectionOf('budget').label,
    tone: sectionOf('budget').tone,
    icon: 'budget',
    role: 'Poser le budget de chaque cycle : les échéances récurrentes et les plafonds des postes.',
    pages: [
      { slug: 'budget', label: 'Budget récurrent', source: 'projet-de-vie/budget-type' },
      { slug: 'plafonds', label: 'Plafonds', source: 'plafonds' },
    ],
  },
  {
    key: 'patrimoine',
    label: sectionOf('patrimoine').label,
    tone: sectionOf('patrimoine').tone,
    icon: 'patrimoine',
    role: 'La finalité : se fixer des objectifs et faire grandir son patrimoine.',
    pages: [
      { slug: 'objectif', label: 'Objectif et projection', own: () => import('./astra-goal.page').then(m => m.AstraGoalPage) },
      { slug: 'patrimoine', label: 'Patrimoine', own: () => import('./astra-wealth.page').then(m => m.AstraWealthPage) },
    ],
  },
  {
    key: 'cycles',
    label: sectionOf('cycles').label,
    tone: sectionOf('cycles').tone,
    icon: 'cycle',
    role: 'Valider tout le cycle avant de passer au suivant, puis relire ses bilans.',
    pages: [
      { slug: 'cloture', label: 'Clôture du cycle', source: 'projet-de-vie/cloture' },
      { slug: 'bilans', label: 'Bilans', source: 'projet-de-vie/bilans' },
    ],
  },
];

/** Écrans ouverts depuis une page du menu : ils appartiennent à la partie de leur page et la suivent dans les onglets. */
export const ASTRA_SECONDARY: [slug: string, parent: string, source: string][] = [
  ['mouvements/echeances', 'mouvements', 'projet-de-vie/echeances'],
  ['calendrier/agenda', 'calendrier', 'calendrier-budget/agenda'],
  ['plafonds/postes', 'plafonds', 'app/reglages/postes'],
  ['projets/:id/budget', 'projets', 'app/gestion-projet/:id/budget'],
  ['projets/:id/taches', 'projets', 'app/gestion-projet/:id/taches'],
  ['financement/enveloppes', 'projets', 'projet-de-vie/projets-finances'],
  ['cloture/compte', 'cloture', 'tableau-de-bord/rapprochement'],
  ['cloture/reglages', 'cloture', 'app/reglages/cycle'],
  ['patrimoine/reglages', 'patrimoine', 'app/reglages/patrimoine'],
];

/** Fiches et détails : même partie que leur liste. */
export const ASTRA_DETAILS: [slug: string, label: string, source: string, parent: string][] = [
  ['objectif/echeances', 'Objectifs datés', 'vision', 'objectif'],
  ['projets/:id', 'Fiche du projet', 'app/gestion-projet/:id', 'projets'],
  ['plafonds/:poste', 'Détail du poste', 'argent/postes/:poste', 'plafonds'],
];

/**
 * Navigation secondaire (onglets de la barre de titre). Libellé court de chaque page : le titre de la page ou
 * son début (vérifié par astra-parts.spec.ts), pour qu'un onglet et la page qu'il ouvre portent le même nom.
 */
export const ASTRA_TAB_LABELS: Record<string, string> = {
  '': 'Mon projet de vie', mouvements: 'Mouvements', 'mouvements/echeances': 'Échéances', calendrier: 'Calendrier', 'calendrier/agenda': 'Agenda',
  projets: 'Projets de la vie', 'projets/:id': 'Fiche', 'projets/:id/budget': 'Budget du projet', 'projets/:id/taches': 'Tâches du projet',
  'financement/enveloppes': 'Règlements par cycle', taches: 'Tâches',
  budget: 'Budget récurrent', plafonds: 'Plafonds', 'plafonds/:poste': 'Poste', 'plafonds/postes': 'Postes et revenus',
  objectif: 'Objectif et projection', 'objectif/echeances': 'Objectifs datés', patrimoine: 'Patrimoine', 'patrimoine/reglages': 'Point de départ',
  cloture: 'Clôture du cycle', 'cloture/compte': 'Vérifier le compte', 'cloture/reglages': 'Ancrage du cycle', bilans: 'Bilans',
};

/**
 * Ordre global du travail, lu dans les déclarations : l'ordre du menu (les parties, puis leurs pages dans l'ordre
 * des gestes), chaque page suivie de ses fiches puis de ses écrans. Les onglets suivent donc le menu latéral.
 */
export const ASTRA_ORDER: string[] = ASTRA_PARTS.flatMap(part => part.pages.flatMap(page => [
  page.slug,
  ...ASTRA_DETAILS.filter(([, , , parent]) => parent === page.slug).map(([slug]) => slug),
  ...ASTRA_SECONDARY.filter(([, parent]) => parent === page.slug).map(([slug]) => slug),
]));

/**
 * Liens entre parties (chacun vaut dans les deux sens). Dans une partie, toutes ses pages sont toujours en onglets :
 * seuls les liens qui traversent les parties se déclarent, une fois, au nom du geste qui les justifie.
 */
export const ASTRA_LINKS: [string, string][] = [
  // Le quotidien porte l'argent des projets.
  ['', 'projets'], ['mouvements', 'financement/enveloppes'], ['mouvements/echeances', 'taches'], ['taches', 'calendrier'], ['projets', 'calendrier'],
  ['projets/:id/budget', 'mouvements'],
  // Le budget de chaque cycle se lit dans le quotidien et nourrit le cap.
  ['budget', 'calendrier'], ['plafonds', 'mouvements'], ['plafonds/:poste', 'mouvements'], ['budget', 'objectif'],
  // Le quotidien nourrit le cap et la clôture.
  ['', 'objectif'], ['', 'cloture/compte'], ['mouvements', 'cloture/compte'], ['mouvements/echeances', 'cloture'], ['objectif/echeances', 'calendrier'],
  // Les projets touchent le patrimoine et les bilans.
  ['projets', 'patrimoine'], ['financement/enveloppes', 'bilans'],
  // Patrimoine et Cycles : constater, viser, clôturer.
  ['bilans', 'patrimoine'], ['objectif', 'bilans'], ['patrimoine/reglages', 'cloture/reglages'],
];

/** La clôture est un processus : ses étapes viennent en tête et gardent leur numéro partout où elles apparaissent ensemble. */
export const ASTRA_CLOSING_STEPS = ['cloture/compte', 'cloture', 'bilans'];
/** Pages qui lisent la situation à date : pas de choix de période. */
const AT_DATE = /^(objectif|patrimoine|cloture\/reglages|cloture$|calendrier)/;

export interface AstraTab { slug: string; label: string; part: AstraPartKey; step: number | null; current: boolean }

/**
 * Onglets d'une page : toutes les pages de sa partie (toujours les mêmes, à la même place), puis ses voisines des
 * autres parties. Une fiche (« :id ») ne s'ouvre que depuis une fiche.
 */
export function astraTabsOf(slug: string): { tabs: AstraTab[]; period: boolean } {
  const fiche = slug.includes(':');
  const visible = (s: string) => s === slug || fiche || !s.includes(':');
  const own = astraPartOf(slug).key;
  const near = new Set(ASTRA_ORDER.filter(s => astraPartOf(s).key === own && visible(s)));
  for (const [a, b] of ASTRA_LINKS) {
    if (a === slug && visible(b)) near.add(b);
    if (b === slug && visible(a)) near.add(a);
  }
  const steps = ASTRA_CLOSING_STEPS.filter(s => near.has(s));
  const numbered = steps.length > 1;
  const stepRank = (s: string) => numbered && steps.includes(s) ? ASTRA_CLOSING_STEPS.indexOf(s) : 99;
  const partRank = (s: string) => { const k = astraPartOf(s).key; return k === own ? -1 : ASTRA_PARTS.findIndex(p => p.key === k); };
  const tabs = [...near].filter(s => s in ASTRA_TAB_LABELS)
    .sort((x, y) => partRank(x) - partRank(y) || stepRank(x) - stepRank(y) || ASTRA_ORDER.indexOf(x) - ASTRA_ORDER.indexOf(y))
    .map(s => ({
      slug: s, label: ASTRA_TAB_LABELS[s], part: astraPartOf(s).key, current: s === slug,
      step: numbered && steps.includes(s) ? ASTRA_CLOSING_STEPS.indexOf(s) + 1 : null,
    }));
  return { tabs, period: !AT_DATE.test(slug) };
}

export const astraUrl = (slug: string) => slug ? '/bpm-astra/' + slug : '/bpm-astra';

const parentOf = new Map<string, string>([
  ...ASTRA_SECONDARY.map(([slug, parent]): [string, string] => [slug, parent]),
  ...ASTRA_DETAILS.map(([slug, , , parent]): [string, string] => [slug, parent]),
]);

/** Partie d'une adresse d'Astra (« projets/:id/budget » → Mes projets). */
export function astraPartOf(slug: string): AstraPart {
  const page = parentOf.get(slug) ?? slug;
  return ASTRA_PARTS.find(part => part.pages.some(p => p.slug === page)) ?? ASTRA_PARTS[0];
}

/** Page du menu à laquelle se rattache une adresse. */
export function astraMenuSlug(slug: string): string {
  return parentOf.get(slug) ?? slug;
}



/** L'accueil d'une section dans Astra : la première page de sa partie. */
export const astraSectionHome = (key: AstraPartKey): string => astraUrl(ASTRA_PARTS.find((p) => p.key === key)?.pages[0]?.slug ?? '');
