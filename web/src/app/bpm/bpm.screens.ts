/**
 * Catalogue des écrans métier BPM (Budget/Patrimoine Management).
 *
 * BPM n'est plus une application du site : BPM-Astra (`astra/`) est la seule application qui présente ces écrans,
 * dans sa navigation, son cadre et ses adresses (`/bpm-astra/…`). Ce fichier ne déclare donc ni zone, ni menu,
 * ni adresse publique : il décrit chaque écran (comment le charger, ses données de route, son titre et sa
 * présentation) sous une clé stable, l'ancienne adresse BPM, que les écrans utilisent encore pour leurs liens
 * internes. Astra traduit ces clés en adresses Astra (`astraPagePath`) et sert les anciennes adresses en redirection.
 */
import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { RecetteContext } from '../core/api.service';
import { contentSections, subpage } from '../platform/application';
import type { WorkspaceDestination } from '../plan/page-workspaces';

/** Clés des fiches projet ; les écrans construisent leurs liens avec, Astra les traduit. */
export const PROJECT_HOME = '/app/gestion-projet';
export const PROJECT_LIST = '/projet-de-vie/projets';
export const projectLink = (id: string) => `${PROJECT_HOME}/${id}`;
const loadCalendarPage = () => import('./pages/calendar.page').then(m => m.loadBpmCalendar());
const lifePage = () => import('./life/life-management.page').then(m => m.BpmLifeManagementPage);
const projectPage = () => import('./projects/project.page').then(m => m.BpmProjectPage);
const settingsPage = () => import('./settings').then(m => m.BpmSettings);
const capsPage = () => import('./pages/caps').then(m => m.BpmCapsPage);
const closingPage = () => import('./life/closing.page').then(m => m.BpmClosingPage);
const meteoPage = () => import('./meteo/meteo.page').then(m => m.BpmMeteoPage);

/** « Démarrer un projet » est réservé au visiteur : un user connecté retrouve l'application par défaut (racine du site). */
const visitorOnly: CanActivateFn = () => !inject(RecetteContext).connected() || inject(Router).createUrlTree(['/']);

/** Écrans de premier niveau (et leurs données de route). */
export const BPM_SCREEN_ROUTES: Routes = [
  ...([['meteo', 'Météo du jour', 'home'], ['meteo/projet-de-vie', 'Météo du projet de vie', 'life'], ['meteo/gestion-de-projet', 'Météo de la gestion de projet', 'projects'], ['meteo/patrimoine', 'Météo du patrimoine', 'wealth'], ['meteo/previsions', 'Prévisions', 'forecast'], ['meteo/tendances', 'Tendances des cycles', 'trends']] as const)
    .map(([path, title, view]) => ({ path, title, data: { meteo: view }, loadComponent: meteoPage })),
  { path: 'plafonds', title: 'Plafonds', loadComponent: capsPage },
  { path: 'vision', title: 'Patrimoine et objectifs', loadComponent: () => import('./objectives/objectives.page').then(m => m.BpmObjectivesPage) },
  { path: 'argent/postes/:poste', title: 'Détail du poste', loadComponent: () => import('./pages/center').then(m => m.BpmCenterPage) },
  { path: 'app/gestion-projet/:id', title: 'Fiche du projet', loadComponent: projectPage },
  { path: 'app/taches', title: 'Tâches par statut', loadComponent: () => import('./projects/tasks.page').then(m => m.BpmTasksPage) },
  {
    path: 'calendrier-budget',
    title: 'Calendrier — Budget/Patrimoine',
    data: {
      calendar: 'budgetPatrimoine',
      eyebrow: 'Budget/Patrimoine · Calendrier',
      title: 'Le budget',
      emphasis: 'dans le temps.',
      intro: 'Revenus et dépenses, attendus ou réglés, règlements et échéances des projets, fins de période et versements au patrimoine. Survolez un jour pour lire ses montants et ses repères.',
      groupsTitle: 'Budgets et projets de la période',
      groupKicker: 'Regroupement',
      pageClass: 'bpm-app',
      tone: 'budget',
      // La page propose au branchement les sources du noyau et du patrimoine ; la personne choisit.
      offer: ['noyau', 'patrimoine'],
    },
    loadComponent: loadCalendarPage,
  },
];

/** Démarrer : le visiteur crée son profil et son projet de vie (servi tel quel par Astra). */
export const BPM_START_ROUTES: Routes = [
  { path: 'creer', title: 'Démarrer un projet — RJS Forecast', canActivate: [visitorOnly], loadComponent: () => import('./pages/start').then(m => m.BpmStartPage) },
  { path: 'creer/projet-de-vie', title: 'Créer mon projet de vie — RJS Forecast', canActivate: [visitorOnly], loadComponent: () => import('./onboarding').then(m => m.BpmOnboarding) },
];
export const loadBpmOnboarding = () => import('./onboarding').then(m => m.BpmOnboarding);

/** Écrans de second niveau : titre, présentation et écran ; leur parent est l'écran qui les ouvre. */
export const BPM_SCREEN_WORKSPACES: WorkspaceDestination[] = [
  ...([['meteo/projet-de-vie', 'meteo-vie', 'Météo du projet de vie', 'Chaque volet du projet de vie, son état et les actions à mener.'],
    ['meteo/gestion-de-projet', 'meteo-gestion', 'Météo de la gestion de projet', 'Les signaux des projets, leurs tâches et leurs moyens.'],
    ['meteo/patrimoine', 'meteo-patrimoine', 'Météo du patrimoine', 'Le stock, les mouvements des projets et votre cap patrimonial.'],
    ['meteo/previsions', 'meteo-previsions', 'Prévisions', 'Les échéances et les événements des trente prochains jours.'],
    ['meteo/tendances', 'meteo-tendances', 'Tendances des cycles', 'Les résultats de vos cycles et leur évolution.'],
    ['meteo/lecture', 'meteo-reading', 'Lire la météo', 'La règle unique de la météo, l’état de chaque signal et ce qui les calcule.']] as const)
    .map(([path, id, title, lead]) => subpage(path, '/meteo', id, title, lead, meteoPage)),
  subpage('tableau-de-bord/entrees', '/tableau-de-bord', 'register', 'Registre de flux', 'Toutes les entrées et les dépenses : ce qui est réglé, ce qui reste à venir et les opérations à vérifier.', () => import('./pages/expenses').then(m => m.BpmExpensesPage)),
  subpage('tableau-de-bord/rapprochement', '/tableau-de-bord', 'reconciliation', 'Rapprochement bancaire', 'Reliez vos cycles budgétaires aux soldes de vos comptes. Comparez le même périmètre, aux mêmes dates, puis expliquez l’écart.', () => import('./pages/balance').then(m => m.BpmBalancePage)),
  { ...subpage('projet-de-vie/projets', '/projet-de-vie', 'life-projects', 'Projets de la vie', 'Vos projets de la vie par statut : attribuez les enveloppes et faites avancer les tâches.', () => import('./projects/projects.page').then(m => m.BpmProjectsPage)), page: true as const },
  subpage('projet-de-vie/projets-finances', PROJECT_LIST, 'life-projets', 'Projets financés', 'Retrouvez, projet par projet, le budget attribué, les montants réglés et le reste disponible.', lifePage),
  subpage('projet-de-vie/echeances', '/projet-de-vie', 'life-due', 'Échéances à traiter', 'Les règlements à vérifier : d’abord les retards, puis les sept prochains jours.', lifePage),
  subpage('projet-de-vie/budget-type', '/projet-de-vie', 'life-budget', 'Préparer le budget type', 'Construisez les revenus et les charges qui reviennent dans votre projet de vie.', lifePage),
  { ...subpage('projet-de-vie/cloture', '/projet-de-vie', 'life-closing', 'Clôture du cycle', 'Le suivi et l’historique de tout ce qui a été fait pour le cycle ; à la fin de son dernier jour, la clôture qui fige le cycle et lance le suivant.', closingPage), page: true as const },
  subpage('projet-de-vie/bilans', '/projet-de-vie/cloture', 'life-bilans', 'Bilans des cycles', 'L’historique de vos cycles : entrées, dépenses, coût des projets de la vie, effet sur le patrimoine et faits marquants.', () => import('./life/bilans.page').then(m => m.BpmBilansPage)),
  { ...subpage('app/gestion-projet/:id/budget', PROJECT_LIST, 'project-budget', 'Budget du projet', 'Attribuez l’enveloppe, répartissez les parts et examinez les décisions de ce projet.', projectPage), tabLabel: 'Budget et décisions' },
  { ...subpage('app/gestion-projet/:id/taches', PROJECT_LIST, 'project-tasks', 'Tâches du projet', 'Préparez et faites avancer les tâches de ce projet.', projectPage), tabLabel: 'Tâches' },
  subpage('app/reglages/cycle', '/projet-de-vie/cloture', 'settings-cycle', 'Ancrage du cycle', 'Consultez l’ancrage du cycle, ses bornes et les clôtures enregistrées.', settingsPage),
  subpage('app/reglages/patrimoine', '/vision', 'settings-wealth', 'Point de départ', 'Renseignez le stock initial et sa date : le patrimoine se construit à partir de lui.', settingsPage),
  subpage('app/reglages/postes', '/plafonds', 'settings-centers', 'Postes et revenus', 'Retrouvez les postes disponibles et ajoutez un poste personnel.', settingsPage),
  subpage('calendrier-budget/agenda', '/calendrier-budget', 'calendar-agenda', 'Agenda des événements', 'Parcourez les repères datés, ouvrez leur détail et replanifiez ceux qui le permettent.', loadCalendarPage),
];

/**
 * Anciennes adresses publiques de BPM (pages, sous-pages, fiches et anciens alias). Astra les sert toutes en
 * redirection vers son équivalent, en gardant la lecture (période, filtres, fragment).
 */
export const BPM_LEGACY_PATHS: string[] = [
  ...BPM_SCREEN_ROUTES.map(r => r.path!), ...BPM_SCREEN_WORKSPACES.map(w => w.path),
  'tableau-de-bord', 'projet-de-vie', 'projet-de-vie/cycle', 'projet-de-vie/charges-indispensables', 'projet-de-vie/charges-courantes',
  'projet-de-vie/financement', 'projet-de-vie/patrimoine', 'projet-de-vie/pilotage', 'vision/projection', 'vision/reperes',
  'zones/bpm', 'zones/bpm/ensemble', 'zones/bpm/vision', 'zones/bpm/projets-vie', 'zones/bpm/calendrier', 'zones/bpm/gestion', 'zones/bpm/patrimoine',
  'depenses', 'depenses/registre', 'piloter', 'piloter/agir', 'argent/entrees', 'argent/reste', 'argent/postes',
  'app', 'app/operations', 'app/bienvenue', 'app/projets', 'app/projets/suivi', 'app/projets/:id', 'projet-de-la-vie',
  'app/gestion-projet', 'app/gestion-projet/nouveau', 'app/gestion-projet/decisions', 'app/gestion-projet/financement',
  'app/gestion-projet/cycle', 'app/gestion-projet/cycle/echeances', 'app/gestion-projet/cycle/cloture',
  'app/gestion-projet/planning', 'app/gestion-projet/planning/agenda', 'app/taches/nouvelle', 'app/taches/rattacher',
  'app/reglages', 'bpm/espaces', 'bpm/structure', 'calendrier-budget/sources',
  // Réglage des limites et catégories : une seule page Plafonds depuis le 22 nov. 2026.
  'plafonds/reglages', 'plafonds/categories',
];

/** Sections de contenu de chaque écran (ancres de l'écran), sous la clé de l'écran. Astra les sert à ses adresses. */
export const BPM_SCREEN_SECTIONS: Record<string, ReturnType<typeof contentSections>> = {
  '/meteo/projet-de-vie': contentSections(['mt-life-title', 'État du projet de vie'], ['mt-life-signals', 'Les volets du projet de vie']),
  '/meteo/gestion-de-projet': contentSections(['mt-pm-title', 'État de la gestion de projet'], ['mt-pm-signals', 'Les signaux'], ['mt-pm-projects', 'La météo de chaque projet']),
  '/meteo/patrimoine': contentSections(['mt-wealth-signals', 'Stock, mouvements et cap']),
  '/meteo/previsions': contentSections(['bpm-outlook-title', 'Budget et patrimoine prévisionnels'], ['mt-fc-title', 'Les événements à venir'], ['mt-goals-title', 'Objectifs datés']),
  '/meteo/tendances': contentSections(['mt-tr-title', 'Le sens des résultats'], ['mt-cycles-title', 'La météo de chaque cycle']),
  '/meteo/lecture': contentSections(['mt-rule-title', 'La règle de la météo'], ['mt-health-title', 'L’état d’un signal'], ['mt-sources-title', 'Ce que lit chaque signal']),
  '/projet-de-vie/budget-type': contentSections(['bm-month-title', 'Revenus et dépenses récurrents']),
  '/plafonds': contentSections(['caps-board-title', 'Postes de dépenses']),
  '/app/gestion-projet/:id/budget': contentSections(['enveloppe', 'Enveloppe et répartition'], ['project-flow-history-title', 'Flux, cycles et patrimoine'], ['project-requests-title', 'Décisions des tâches']),
  '/app/gestion-projet/:id/taches': contentSections(['shares-title', 'Tâches et avancement']),
  '/calendrier-budget/agenda': contentSections(['calendar-agenda-title', 'Événements de la période']),
  '/tableau-de-bord/entrees': contentSections(['flows-title', 'Synthèse des flux'], ['expense-overview-title', 'État des échéances'], ['register-details', 'Registre détaillé']),
  '/tableau-de-bord/rapprochement': contentSections(['bank-title', 'Comptes et périmètre'], ['bank-result', 'Comparer les variations'], ['bank-checks', 'Expliquer les écarts']),
  '/vision': contentSections(['wealth-project-flows-title', 'Mouvements des projets'], ['bpm-outlook-title', 'Prévision du stock'], ['dated-goals-title', 'Objectifs datés']),
  '/app/reglages/cycle': contentSections(['bc-cycle-title', 'Ancrage du cycle'], ['bc-history-title', 'Historique des clôtures']),
  '/app/reglages/patrimoine': contentSections(['bc-wealth-title', 'Stock d’ouverture']),
  '/app/reglages/postes': contentSections(['bc-centers-title', 'Postes et revenus']),
  '/projet-de-vie/projets': contentSections(['projects-cockpit-title', 'Cockpit de gestion'], ['projects-status-title', 'Projets par statut']),
  '/projet-de-vie/projets-finances': contentSections(['life-topic-title', 'Projets financés'], ['life-topic-detail', 'Détail']),
  '/projet-de-vie/echeances': contentSections(['life-due-title', 'Échéances à régler']),
  '/projet-de-vie/bilans': contentSections(['bl-history-title', 'Historique des cycles'], ['bl-detail-title', 'Résultat du cycle'], ['bl-spending-title', 'Dépenses du cycle'], ['bl-projects-title', 'Projets et décisions'], ['bl-ledger-title', 'Tous les cycles']),
  '/projet-de-vie/cloture': contentSections(['closing-state-title', 'Synthèse du cycle'], ['closing-path-title', 'À valider'], ['closing-checks-title', 'Cohérence du cycle'], ['closing-result-title', 'Résultat et cycle suivant'], ['life-closing-title', 'Clôturer et lancer le cycle suivant']),
};
