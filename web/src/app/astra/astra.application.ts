import { PAGE_GUIDANCE } from '../shared/page-guidance';
import { astraGuidance } from './astra-guidance';
import { inject, type Type } from '@angular/core';
import { Router, type RedirectFunction, type Route } from '@angular/router';
import { openAction, type ApplicationActionContext, type ApplicationDeclaration } from '../platform/application';
import type { TabLink } from '../plan/tab-links';
import type { QuickLink } from '../plan/quick-nav';
import type { PlanSection } from '../plan/site-plan';
import { BPM_LEGACY_PATHS, BPM_SCREEN_ROUTES, BPM_SCREEN_SECTIONS, BPM_SCREEN_WORKSPACES, BPM_START_ROUTES, loadBpmOnboarding } from '../bpm/bpm.screens';
import { BPM_CORE_LINKS, BPM_PAGE_PATH } from '../bpm/ui/bpm-page-path';
import { ASTRA_DETAILS, ASTRA_PARTS, ASTRA_SECONDARY, astraUrl, type AstraPage } from './astra-parts';

export const astraGroups = ASTRA_PARTS.map((part) => ({
  label: part.label,
  pages: part.pages.map((page) => ({ label: page.label, link: astraUrl(page.slug) })),
}));
// La teinte de chaque partie est déclarée dans le plan : le cadre du site la reçoit comme toute teinte de section.
const sections: PlanSection[] = ASTRA_PARTS.map((part, i) => ({
  id: 'astra-' + i,
  acronym: String(i + 1),
  label: part.label,
  intention: part.role,
  description: part.role,
  tone: part.tone,
  space: 'bpm-parcours',
  home: 'direct',
  pages: part.pages.map((page, j) => ({
    label: page.label,
    link: astraUrl(page.slug),
    id: 'astra-' + i + '-' + j,
    symbol: '◫',
    tone: part.tone,
    description: page.label,
    result: page.label,
    exact: true,
  })),
}));

const allPages = ASTRA_PARTS.flatMap(part => part.pages);
/** Section du plan qui porte une page du menu (elle suit l'ordre des parties). */
const sectionOfPage = (slug: string) => 'astra-' + ASTRA_PARTS.findIndex(part => part.pages.some(page => page.slug === slug));
const sourceWorkspaces = BPM_SCREEN_WORKSPACES;
const sourcePaths = new Map<string, string>([
  ...allPages.filter(page => page.source).map((page): [string, string] => ['/' + page.source, astraUrl(page.slug)]),
  ...ASTRA_SECONDARY.map(([slug, , source]): [string, string] => ['/' + source, astraUrl(slug)]),
  ['/projet-de-vie', astraUrl('')],
  ['/tableau-de-bord', astraUrl('')],
  ['/projet-de-vie/patrimoine', astraUrl('patrimoine')],
  ['/vision', astraUrl('objectif/echeances')],
  ['/vision/projection', astraUrl('objectif')],
  ['/vision/reperes', astraUrl('objectif')],
  // Le financement se règle sur la fiche de chaque projet : les anciennes pages de financement mènent aux projets.
  ['/projet-de-vie/financement', astraUrl('projets')],
  ['/app/gestion-projet/financement', astraUrl('projets')],
  ['/app/gestion-projet', astraUrl('projets')],
  ['/app/gestion-projet/decisions', astraUrl('projets')],
  ['/argent/postes', astraUrl('plafonds')],
  // Créer se fait là où l'on voit déjà les projets et les tâches : les anciennes pages de création y mènent.
  ['/app/gestion-projet/nouveau', astraUrl('nouveau')],
  ['/app/taches/nouvelle', astraUrl('taches/nouvelle')],
  ['/app/taches/rattacher', astraUrl('taches/rattacher')],
  // Anciennes adresses de BPM, devenu BPM-Astra : chacune mène à la page qui fait désormais le travail.
  ...([
    ['/projet-de-vie/cycle', ''], ['/projet-de-vie/pilotage', ''], ['/piloter', ''], ['/app', ''], ['/app/bienvenue', ''],
    ['/zones/bpm', ''], ['/zones/bpm/ensemble', ''], ['/bpm/espaces', ''], ['/bpm/structure', ''],
    ['/projet-de-vie/charges-indispensables', 'mouvements'], ['/projet-de-vie/charges-courantes', 'mouvements'],
    ['/depenses', 'mouvements'], ['/depenses/registre', 'mouvements'], ['/argent/entrees', 'mouvements'], ['/app/operations', 'mouvements'],
    ['/piloter/agir', 'mouvements/echeances'], ['/app/gestion-projet/cycle/echeances', 'mouvements/echeances'],
    // Les plafonds se fixent poste par poste sur la page Plafonds ; les catégories de dépense sont retirées.
    ['/plafonds/reglages', 'plafonds'], ['/plafonds/categories', 'plafonds'],
    ['/argent/reste', 'cloture/compte'], ['/app/gestion-projet/cycle', 'cloture'], ['/app/gestion-projet/cycle/cloture', 'cloture'], ['/app/reglages', 'cloture/reglages'],
    ['/app/projets', 'projets'], ['/projet-de-la-vie', 'projets'], ['/zones/bpm/projets-vie', 'projets'], ['/zones/bpm/gestion', 'projets'],
    ['/app/projets/suivi', 'financement/enveloppes'],
    ['/app/gestion-projet/planning', 'calendrier'], ['/zones/bpm/calendrier', 'calendrier'], ['/calendrier-budget/sources', 'calendrier'],
    ['/app/gestion-projet/planning/agenda', 'calendrier/agenda'],
    ['/zones/bpm/patrimoine', 'patrimoine'], ['/zones/bpm/vision', 'objectif'],
  ] as const).map(([from, to]): [string, string] => [from, astraUrl(to)]),
]);

/** Une ancienne adresse ouvre la page qui fait désormais le travail, en gardant la lecture (période…). */
const moved = (target: string, extra: Record<string, string> = {}): RedirectFunction => ({ queryParams }) =>
  inject(Router).createUrlTree([target], { queryParams: { ...queryParams, ...extra } });

export function astraPagePath(path: string): string {
  const exact = sourcePaths.get(path);
  if (exact) return exact;
  const project = /^\/app\/(?:gestion-projet|projets)\/(prj_[^/?#]+)(\/(?:budget|taches))?$/.exec(path);
  if (project) return astraUrl('projets/' + project[1] + (project[2] ?? ''));
  const center = /^\/argent\/postes\/([^/?#]+)$/.exec(path);
  return center ? astraUrl('plafonds/' + center[1]) : path;
}

/** Une ancienne adresse BPM, avec ses paramètres, mène à son équivalent Astra (sinon à l'accueil d'Astra). */
const legacy = (path: string): RedirectFunction => ({ params, queryParams, fragment }) => {
  const url = '/' + path.replace(/:([a-z]+)/g, (_, key: string) => String(params[key] ?? ''));
  const target = astraPagePath(url);
  return inject(Router).createUrlTree([target.startsWith('/bpm-astra') ? target : astraUrl('')], { queryParams, fragment: fragment ?? undefined });
};

const secondaryWorkspaces = ASTRA_SECONDARY.map(([slug, parent, source]) => {
  const workspace = sourceWorkspaces.find(view => view.path === source);
  if (!workspace) throw new Error('Vue métier BPM introuvable : ' + source);
  // Une étape d'un processus porte le nom de l'étape (« Vérifier le compte ») dans le fil d'Ariane.
  const title = astraGuidance[slug]?.title;
  return { ...workspace, title: title ?? workspace.title, label: title ?? workspace.label, path: astraUrl(slug).slice(1), parent: astraUrl(parent), existing: true };
});

const menuTitles = new Map(allPages.map(page => [page.slug, page.label]));
const frame = () => import('./astra-part').then(m => m.AstraPartFrame);

function screen(page: AstraPage): Route {
  const { slug, label, source } = page;
  const address = astraUrl(slug).slice(1);
  // Une entrée de menu et la page qu'elle ouvre portent le même nom.
  const named = !slug.includes(':');
  const guidance = astraGuidance[slug] && { ...(named ? { title: menuTitles.get(slug) ?? label } : {}), ...astraGuidance[slug] };
  const title = (guidance?.title ?? label) + ' · BPM-Astra';
  const providers = [{ provide: BPM_PAGE_PATH, useValue: astraPagePath }, { provide: BPM_CORE_LINKS, useValue: false }, { provide: PAGE_GUIDANCE, useValue: guidance ?? null }];
  if (page.own) return {
    path: address, providers, pathMatch: 'full', title,
    loadComponent: frame, data: { astraSlug: slug, astraScreen: page.own },
  };
  const workspace = sourceWorkspaces.find(view => view.path === source);
  const route = BPM_SCREEN_ROUTES.find(route => route.path === source);
  const parent = BPM_SCREEN_ROUTES.find(route => '/' + route.path === workspace?.parent);
  const view = secondaryWorkspaces.find(view => view.path === 'bpm-astra/' + slug);
  const load = (workspace?.loadComponent ?? route?.loadComponent) as (() => Promise<Type<unknown>>) | undefined;
  return {
    path: address, providers, title,
    loadComponent: frame,
    data: {
      ...parent?.data, ...route?.data,
      astraSlug: slug, astraScreen: load,
      workspace: view ?? (workspace && {
        ...workspace, parent: astraPagePath(workspace.parent),
      }),
      ...(slug === 'mouvements' ? { registerScope: 'life-with-projects' } : {}),
      ...(slug === 'calendrier' || slug === 'calendrier/agenda' ? { compactCalendar: true } : {}),
      ...(source === 'vision' || source?.startsWith('vision/') ? { projectionBasis: 'savings-goal' } : {}),
    },
  };
}
/**
 * Actions rapides de la palette (⌘K) : les mêmes créations que le menu « Nouveau », sur la lecture en cours.
 * Chacune ouvre la page qui porte la saisie, avec sa fenêtre déjà ouverte.
 */
function quickActions({ location, reading, tone, connected, objectLabel }: ApplicationActionContext): QuickLink[] {
  if (!connected) return [];
  const action = (id: string, label: string, slug: string, query: Record<string, string>, mark: string, hint: string, keywords: string): QuickLink =>
    ({ id, group: 'action', kind: 'action', label, link: astraUrl(slug), query: { ...reading, ...query }, carries: !!Object.keys(reading).length, mark, tone, zone: 'bpm-astra', hint, keywords });
  const actions = [
    action('entry:charge', 'Saisir une dépense', 'mouvements', { entry: 'new', entryDirection: 'charge' }, '＋', 'Mon quotidien › Mouvements', 'opération charge ajouter nouveau'),
    action('entry:income', 'Saisir une entrée d’argent', 'mouvements', { entry: 'new', entryDirection: 'income' }, '＋', 'Mon quotidien › Mouvements', 'opération revenu ajouter nouveau'),
    action('create:project', 'Créer un projet de la vie', 'projets', { editProject: 'new' }, '＋', 'Mes projets › Projets de la vie', 'projet nouveau enveloppe'),
    action('create:task', 'Créer une tâche', 'taches', { editTask: 'new' }, '＋', 'Mes projets › Tâches', 'tâche nouvelle'),
    action('goal:new', 'Créer un objectif daté', 'objectif', { goal: 'new' }, '＋', 'Patrimoine › Objectif et projection', 'objectif date épargne'),
  ];
  if (location.object) {
    const name = objectLabel || location.object.fallback;
    actions.push(action('object-tasks:' + location.object.id, `Ouvrir les tâches de « ${name} »`, 'taches', { project: location.object.id }, '☑', 'Tâches filtrées sur ce projet', 'tâches projet'));
  }
  return actions;
}

/** Les gestes de chaque page du menu, déclarés au Navigation system (onglets, palette, audit N4). */
const entryActions = (tab: string, link?: string): TabLink[] => [
  { tab, label: 'Saisir une dépense', query: { entry: 'new', entryDirection: 'charge' }, link },
  { tab, label: 'Saisir une entrée d’argent', query: { entry: 'new', entryDirection: 'income' }, link },
];
const actions: TabLink[] = [
  ...entryActions(astraUrl(''), astraUrl('mouvements')),
  ...entryActions(astraUrl('mouvements')),
  openAction(astraUrl('calendrier'), 'Ouvrir l’agenda', astraUrl('calendrier/agenda')),
  openAction(astraUrl('budget'), 'Fixer les plafonds', astraUrl('plafonds')),
  openAction(astraUrl('plafonds'), 'Ajouter un poste personnel', astraUrl('plafonds/postes')),
  { tab: astraUrl('projets'), label: 'Créer un projet de la vie', query: { editProject: 'new' } },
  { tab: astraUrl('projets'), label: 'Créer une tâche', query: { editTask: 'new' }, link: astraUrl('taches') },
  { tab: astraUrl('taches'), label: 'Créer une tâche', query: { editTask: 'new' } },
  { tab: astraUrl('objectif'), label: 'Créer un objectif daté', query: { goal: 'new' } },
  openAction(astraUrl('patrimoine'), 'Corriger le point de départ', astraUrl('patrimoine/reglages')),
  openAction(astraUrl('cloture'), 'Vérifier le compte', astraUrl('cloture/compte')),
  openAction(astraUrl('cloture'), 'Fixer le cycle', astraUrl('cloture/reglages')),
  openAction(astraUrl('bilans'), 'Clôturer le cycle', astraUrl('cloture')),
];

/** Les sections de contenu des écrans métier, servies à leurs adresses Astra (pages et sous-pages seulement). */
const destinations = new Set([...allPages.map(page => astraUrl(page.slug)), ...secondaryWorkspaces.map(view => '/' + view.path)]);
const contentSections = Object.fromEntries(Object.entries(BPM_SCREEN_SECTIONS)
  .map(([key, sections]): [string, typeof sections] => [key.startsWith('/app/gestion-projet/:id') ? key.replace('/app/gestion-projet/:id', astraUrl('projets/:id')) : astraPagePath(key), sections])
  .filter(([link]) => destinations.has(link)));

export const ASTRA_APPLICATION: ApplicationDeclaration = {
  id: 'bpm-astra',
  // Astra présente les écrans métier de BPM dans sa propre navigation : c'est sa seule dépendance.
  builtOn: 'bpm',
  // Une teinte par partie : Mon quotidien, Mes projets, Mon budget, Patrimoine, Cycles (styles/_astra-parts.scss).
  tones: ASTRA_PARTS.map(part => part.tone),
  profilePicker: () => import('./astra-profile').then((m) => m.AstraProfilePicker),
  // Le visiteur démarre ici son profil et son projet de vie (écran métier BPM servi par Astra).
  userCreation: loadBpmOnboarding,
  quickActions,
  actions,
  contentSections,
  zone: {
    id: 'bpm-astra',
    kind: 'zone',
    numbered: true,
    label: 'BPM-Astra',
    acronym: 'Astra',
    eyebrow: 'Gestion du projet de vie',
    mission: 'Vivre son budget au quotidien, mener ses projets de la vie et viser son patrimoine de demain.',
    home: '/bpm-astra',
    band: 'flagship',
    size: 'feature',
    tone: 'budget',
    module: 'bpm',
    sections,
  },
  routes: [
    { path: 'bpm-astra/nouveau', pathMatch: 'full', redirectTo: moved(astraUrl('projets'), { editProject: 'new' }) },
    { path: 'bpm-astra/taches/nouvelle', pathMatch: 'full', redirectTo: moved(astraUrl('taches'), { editTask: 'new' }) },
    // Rattacher se fait sur la carte de la tâche : l'ancienne page ouvre le tableau sur les tâches sans projet.
    { path: 'bpm-astra/taches/rattacher', pathMatch: 'full', redirectTo: moved(astraUrl('taches'), { project: 'none' }) },
    // La synthèse du cycle doublait l'accueil (solde prévu, reçu, dépensé, jours restants).
    { path: 'bpm-astra/mouvements/synthese', pathMatch: 'full', redirectTo: moved(astraUrl('')) },
    // Objectif et projection ne font qu'une page : on fixe l'épargne visée et on en lit aussitôt l'effet.
    { path: 'bpm-astra/objectifs', pathMatch: 'full', redirectTo: moved(astraUrl('objectif')) },
    { path: 'bpm-astra/projection', pathMatch: 'full', redirectTo: moved(astraUrl('objectif')) },
    { path: 'bpm-astra/objectifs/echeancier', pathMatch: 'full', redirectTo: moved(astraUrl('objectif/echeances')) },
    // Vérifier le compte est la première étape de la clôture.
    // L'enveloppe et sa source se règlent sur la fiche du projet : la page Financement est retirée.
    { path: 'bpm-astra/financement', pathMatch: 'full', redirectTo: moved(astraUrl('projets')) },
    // La page Météo est retirée (24 nov.) : ses adresses ramènent à l'accueil.
    { path: 'bpm-astra/meteo', pathMatch: 'full', redirectTo: moved(astraUrl('')) },
    { path: 'bpm-astra/meteo/:vue', pathMatch: 'full', redirectTo: moved(astraUrl('')) },
    { path: 'bpm-astra/rapprochement', pathMatch: 'full', redirectTo: moved(astraUrl('cloture/compte')) },
    // Les limites se fixent poste par poste sur la page Plafonds ; les catégories de dépense sont abandonnées.
    { path: 'bpm-astra/plafonds/reglages', pathMatch: 'full', redirectTo: moved(astraUrl('plafonds')) },
    { path: 'bpm-astra/plafonds/categories', pathMatch: 'full', redirectTo: moved(astraUrl('plafonds')) },
    ...BPM_START_ROUTES,
    ...BPM_LEGACY_PATHS.map(path => ({ path, pathMatch: 'full' as const, redirectTo: legacy(path) })),
    ...allPages.map(screen),
    ...ASTRA_SECONDARY.map(([slug, , source], index) => screen({ slug, label: secondaryWorkspaces[index].title, source })),
    ...ASTRA_DETAILS.map(([slug, label, source]) => screen({ slug, label, source })),
  ],
  templates: [['/bpm-astra/projets/:id', 'Fiche du projet'], ['/bpm-astra/plafonds/:poste', 'Détail du poste']],
  objects: [{
    kind: 'project', home: '/bpm-astra/projets',
    pattern: /^\/bpm-astra\/projets\/([^/?#]+)(?:\/|$)/, fallback: 'Fiche du projet',
  }],
  workspaces: secondaryWorkspaces,
  // Un fait, une section propriétaire : la page qui gère chaque nature d'objet.
  sources: {
    coreProject: ({ id }) => ({ link: astraUrl('projets') + '/' + encodeURIComponent(id) }),
    task: ({ projectId }) => projectId ? { link: astraUrl('projets') + '/' + encodeURIComponent(projectId) + '/taches' } : { link: astraUrl('taches') },
    projectOverrun: ({ projectId }) => projectId ? { link: astraUrl('projets') + '/' + encodeURIComponent(projectId) } : { link: astraUrl('projets') },
    taskBudgetRequest: ({ projectId }) => projectId ? { link: astraUrl('projets') + '/' + encodeURIComponent(projectId) } : { link: astraUrl('projets') },
    operation: () => ({ link: astraUrl('mouvements') }),
    recurrence: () => ({ link: astraUrl('budget') }),
    costCenter: () => ({ link: astraUrl('plafonds/postes') }),
    lifeGoal: () => ({ link: astraUrl('objectif/echeances') }),
    patrimoine: () => ({ link: astraUrl('patrimoine') }),
    capitalization: () => ({ link: astraUrl('patrimoine') }),
    closure: () => ({ link: astraUrl('bilans') }),
    cycleLink: () => ({ link: astraUrl('cloture/reglages') }),
  },
  details: [
    { pattern: /^\/bpm-astra\/plafonds\/[^/]+$/, section: sectionOfPage('plafonds'), parent: astraUrl('plafonds'), label: 'Détail du poste' },
    { pattern: /^\/bpm-astra\/objectif\/echeances$/, section: sectionOfPage('objectif'), parent: astraUrl('objectif'), label: 'Objectifs datés' },
  ],
};
