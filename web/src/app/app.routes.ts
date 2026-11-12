import { inject } from '@angular/core';
import { CanActivateFn, RedirectFunction, ResolveFn, Router, Routes } from '@angular/router';
import { RecetteContext } from './core/api.service';
import { planTitle } from './shared/site-plan';
import { PAGE_WORKSPACES } from './shared/page-workspaces';

/** Une seule adresse par écran : les anciennes adresses y mènent en gardant la période et les filtres. */
const canonical = (target: (params: Record<string, string>) => string[]): RedirectFunction => ({ params, queryParams, fragment }) =>
  inject(Router).createUrlTree(target(params as Record<string, string>), { queryParams, fragment: fragment ?? undefined });

/** Titre des accueils génériques du plan : « Section · Zone · RJS Forecast ». */
const planRouteTitle: ResolveFn<string> = (route) => planTitle(route.paramMap.get('zone'), route.paramMap.get('section'));

// Trois espaces : l'application BPM (niveau 3) en deux sections, la gestion des utilisateurs et le socle
// (noyau, middlewares en interfaces de test, Object Management, Administration).
/** « Démarrer un projet » est réservé au visiteur : un user connecté a déjà son projet de vie et le modifie dans sa gestion. */
const visitorOnly: CanActivateFn = () => !inject(RecetteContext).connected() || inject(Router).createUrlTree(['/projet-de-vie']);

const mainRoutes: Routes = [
  { path: 'navigation', title: 'Navigation system — RJS Forecast', loadComponent: () => import('./navigation/navigation-settings.page').then(m => m.NavigationSettingsPage) },
  // Accueil : le portail des zones (Budget/Patrimoine Management, Budget, Patrimoine, Noyau transverse, Administration).
  { path: '', pathMatch: 'full', title: 'Accueil · RJS Forecast', loadComponent: () => import('./home/home').then((m) => m.HomePage) },
  // Accueils génériques du plan du site (`shared/site-plan.ts`) : accueil de zone, accueil de section.
  { path: 'zones/:zone', title: planRouteTitle, loadComponent: () => import('./home/zone-home').then((m) => m.ZoneHomePage) },
  { path: 'zones/:zone/:section', title: planRouteTitle, loadComponent: () => import('./home/section-landing').then((m) => m.SectionLandingPage) },

  // ---------- Application BPM (niveau 3) : Démarrer un projet ----------
  { path: 'creer', title: 'Démarrer un projet — RJS Forecast', canActivate: [visitorOnly], loadComponent: () => import('./bpm/pages/start').then((m) => m.BpmStartPage) },

  // ---------- Application BPM : Ma vision budgétaire ----------
  { path: 'tableau-de-bord', title: 'Tableau de bord — RJS Forecast', loadComponent: () => import('./bpm/pages/dashboard').then((m) => m.BpmDashboard) },
  { path: 'depenses', pathMatch: 'full', redirectTo: canonical(() => ['/depenses/registre']) },
  { path: 'plafonds', title: 'Plafonds et catégories — RJS Forecast', loadComponent: () => import('./bpm/pages/caps').then((m) => m.BpmCapsPage) },
  { path: 'piloter', title: 'Graphiques et chiffres — RJS Forecast', loadComponent: () => import('./bpm/pages/pilot').then((m) => m.BpmPilotPage) },
  { path: 'piloter/agir', title: 'Échéances à traiter — RJS Forecast', loadComponent: () => import('./bpm/pages/act').then((m) => m.BpmActPage) },
  { path: 'projet-de-vie', title: 'Gestion du projet de vie — RJS Forecast', loadComponent: () => import('./bpm/life/life-management.page').then((m) => m.BpmLifeManagementPage) },
  { path: 'vision', title: 'Objectifs et avenir — RJS Forecast', loadComponent: () => import('./bpm/objectives/objectives.page').then((m) => m.BpmObjectivesPage) },

  // ---------- Détails (atteints depuis les chiffres, graphes et listes) ----------
  { path: 'argent/entrees', redirectTo: canonical(() => ['/tableau-de-bord/entrees']) },
  { path: 'argent/postes/:poste', title: 'Détail du poste — RJS Forecast', loadComponent: () => import('./bpm/pages/center').then((m) => m.BpmCenterPage) },
  { path: 'argent/reste', redirectTo: canonical(() => ['/tableau-de-bord/rapprochement']) },

  // ---------- Utilisateurs (distinct de l'Administration) ----------
  { path: 'utilisateurs', title: 'Utilisateurs — RJS Forecast', loadComponent: () => import('./bpm/onboarding').then((m) => m.BpmOnboarding) },

  // ---------- Anciens liens : redirections et écrans conservés hors menu ----------
  { path: 'app', pathMatch: 'full', redirectTo: 'tableau-de-bord' },
  { path: 'app/operations', redirectTo: 'depenses' },
  { path: 'app/bienvenue', redirectTo: 'utilisateurs' },
  // Projets et tâches du budget de vie : tableaux par statut réimplémentés depuis le noyau, enrichis du budget des projets.
  { path: 'app/gestion-projet', title: 'Gestion de projet — RJS Forecast', loadComponent: () => import('./bpm/projects/management.page').then((m) => m.BpmProjectManagementPage) },
  { path: 'app/gestion-projet/:id', title: 'Fiche du projet — RJS Forecast', loadComponent: () => import('./bpm/projects/project.page').then((m) => m.BpmProjectPage) },
  { path: 'app/projets', title: 'Projets de la vie — RJS Forecast', loadComponent: () => import('./bpm/projects/projects.page').then((m) => m.BpmProjectsPage) },
  // La fiche d'un projet a une seule adresse, sous la gestion de projet.
  { path: 'app/projets/:id', redirectTo: canonical((p) => ['/app/gestion-projet', p['id']]) },
  { path: 'app/taches', title: 'Tâches des projets — RJS Forecast', loadComponent: () => import('./bpm/projects/tasks.page').then((m) => m.BpmTasksPage) },
  { path: 'app/reglages', title: 'Cycle et réglages — RJS Forecast', loadComponent: () => import('./bpm/settings').then((m) => m.BpmSettings) },

  // ---------- Socle : niveau 1 (noyau) ----------
  { path: 'projects', title: 'Projets — Noyau', loadComponent: () => import('./projects/projects-board').then((m) => m.ProjectsBoard) },
  { path: 'projects/new', title: 'Nouveau projet — Noyau', loadComponent: () => import('./projects/project-form').then((m) => m.ProjectForm) },
  { path: 'projects/:id', title: 'Détail projet — Noyau', loadComponent: () => import('./projects/project-detail').then((m) => m.ProjectDetailPage) },
  { path: 'projects/:id/edit', title: 'Modifier le projet — Noyau', loadComponent: () => import('./projects/project-form').then((m) => m.ProjectForm) },
  { path: 'tasks', title: 'Tâches — Noyau', loadComponent: () => import('./tasks/tasks-board').then((m) => m.TasksBoard) },
  { path: 'tasks/new', title: 'Nouvelle tâche — Noyau', loadComponent: () => import('./tasks/task-form').then((m) => m.TaskForm) },
  { path: 'tasks/:id/edit', title: 'Modifier la tâche — Noyau', loadComponent: () => import('./tasks/task-form').then((m) => m.TaskForm) },

  // ---------- Module transverse Calendrier : un même code, une configuration par page (paramètre `calendrier.<id>`) ----------
  {
    path: 'calendrier',
    title: 'Calendrier — Noyau',
    data: {
      calendar: 'noyau',
      eyebrow: 'Noyau transverse · Calendrier',
      title: 'Voir le travail',
      emphasis: 'dans son temps.',
      intro: 'Parcourez les projets, leurs tâches et leurs échéances dans une même période. Choisissez la semaine, le mois ou l’année ; survolez un jour pour lire ses repères.',
      groupsTitle: 'Projets de la période',
      groupKicker: 'Projet',
    },
    loadComponent: () => import('./calendar/calendar.page').then((m) => m.CalendarPage),
  },
  {
    path: 'calendrier-budget',
    title: 'Calendrier — Budget/Patrimoine',
    data: {
      calendar: 'budgetPatrimoine',
      eyebrow: 'Budget/Patrimoine · Calendrier',
      title: 'Le budget',
      emphasis: 'dans le temps.',
      intro: 'Revenus et dépenses, attendus ou réglés, fins de période et versements au patrimoine. Survolez un jour pour lire ses montants et ses repères.',
      groupsTitle: 'Budgets de la période',
      groupKicker: 'Budget',
    },
    loadComponent: () => import('./calendar/calendar.page').then((m) => m.CalendarPage),
  },
  {
    path: 'patrimoine/calendrier',
    title: 'Calendrier — Patrimoine',
    data: {
      calendar: 'patrimoine',
      eyebrow: 'Patrimoine · Calendrier',
      title: 'Le patrimoine',
      emphasis: 'dans la durée.',
      intro: 'L’ouverture du patrimoine, les résultats de période qui l’alimentent et vos objectifs de vie datés.',
      groupsTitle: 'Patrimoine de la période',
      groupKicker: 'Patrimoine',
    },
    loadComponent: () => import('./calendar/calendar.page').then((m) => m.CalendarPage),
  },

  // ---------- Socle : niveau 2 (middlewares, interfaces de test) ----------
  { path: 'socle/budget', title: 'Budget (test) — Middleware', loadComponent: () => import('./middleware/budget-test').then((m) => m.BudgetTest) },
  { path: 'socle/patrimoine', title: 'Patrimoine (test) — Middleware', loadComponent: () => import('./middleware/patrimoine-test').then((m) => m.PatrimoineTest) },

  // ---------- Socle : transverse ----------
  { path: 'object-management', title: 'Object Management — Socle', loadComponent: () => import('./object-management/object-management').then((m) => m.ObjectManagement) },
  { path: 'admin', title: 'Administration — Socle', loadComponent: () => import('./admin/admin').then((m) => m.AdminPage) },
  { path: 'admin/calculs', title: 'Calculs — Administration', loadComponent: () => import('./admin/metrics').then((m) => m.AdminMetrics) },
  { path: 'admin/calculs/:key', title: 'Formule — Administration', loadComponent: () => import('./admin/metric-editor').then((m) => m.MetricEditor) },

  // L'ancienne page des sources du calendrier BPM : ses réglages sont dans le dépliant de la page du calendrier.
  {
    path: 'calendrier-budget/sources',
    redirectTo: ({ queryParams }) => inject(Router).createUrlTree(['/calendrier-budget'], { queryParams, fragment: 'sources-et-affichage' }),
  },
  { path: '**', redirectTo: '' },
];

// Les destinations spécialisées précèdent les identifiants dynamiques et partagent leur module.
export const routes: Routes = [
  ...PAGE_WORKSPACES.filter(view => !view.existing).map(view => {
    const parent = mainRoutes.find(route => route.path === view.parent.slice(1));
    return {
      path: view.path,
      title: `${view.title} — RJS Forecast`,
      loadComponent: view.loadComponent,
      canActivate: parent?.canActivate,
      data: { ...parent?.data, workspace: view },
    };
  }),
  ...mainRoutes.map(route => {
    const workspace = PAGE_WORKSPACES.find(view => view.existing && view.path === route.path);
    return workspace ? { ...route, data: { ...route.data, workspace } } : route;
  }),
];
