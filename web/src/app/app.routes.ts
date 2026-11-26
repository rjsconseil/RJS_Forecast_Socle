import { navigationSettingsGuard } from './navigation/navigation-settings.guard';
import { inject } from '@angular/core';
import { RedirectFunction, ResolveFn, Router, Routes } from '@angular/router';
import { loadCalendarPage } from './calendar/calendar.route';
import { RecetteContext } from './core/api.service';
import { planTitle } from './plan/site-plan';
import { PAGE_WORKSPACES } from './plan/page-workspaces';
import { APPLICATIONS, defaultApplicationHome, loadUserCreation } from './platform/applications';

/** Une seule adresse par écran : les anciennes adresses y mènent en gardant la période et les filtres. */
const canonical = (target: (params: Record<string, string>) => string[]): RedirectFunction => ({ params, queryParams, fragment }) =>
  inject(Router).createUrlTree(target(params as Record<string, string>), { queryParams, fragment: fragment ?? undefined });

/** Titre des accueils génériques du plan : « Section · Zone · RJS Forecast ». */
const planRouteTitle: ResolveFn<string> = (route) => planTitle(route.paramMap.get('zone'), route.paramMap.get('section'));

const mainRoutes: Routes = [
  // Connexion et inscription (connexion exigée par le serveur, SOCLE_AUTH=required).
  { path: 'connexion', title: 'Connexion · RJS Forecast', loadComponent: () => import('./core/login.page').then(m => m.LoginPage) },
  // Mon compte : adresse e-mail et mot de passe du profil actif (et déconnexion de toutes les sessions).
  { path: 'compte', title: 'Mon compte · RJS Forecast', loadComponent: () => import('./core/account.page').then(m => m.AccountPage) },
  { path: 'navigation', canDeactivate: [navigationSettingsGuard], title: 'Navigation system — RJS Forecast', loadComponent: () => import('./navigation/navigation-settings.page').then(m => m.NavigationSettingsPage) },
  // L'application par défaut (la première du registre) s'ouvre à la racine, en gardant la lecture.
  { path: '', pathMatch: 'full', redirectTo: ({ queryParams }) => inject(Router).createUrlTree([defaultApplicationHome()], { queryParams }) },
  // Tous les modules : le portail des zones (applications, Budget, Patrimoine, Noyau transverse, Administration).
  { path: 'modules', pathMatch: 'full', title: 'Tous les modules · RJS Forecast', loadComponent: () => import('./home/home').then((m) => m.HomePage) },
  // ---------- Utilisateurs (distinct de l'Administration) ----------
  { path: 'utilisateurs', title: 'Utilisateurs — RJS Forecast', loadComponent: loadUserCreation },

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
      offer: ['patrimoine'],
      eyebrow: 'Noyau transverse · Calendrier',
      title: 'Voir le travail',
      emphasis: 'dans son temps.',
      intro: 'Parcourez les projets, leurs tâches et leurs échéances dans une même période. Choisissez la semaine, le mois ou l’année ; survolez un jour pour lire ses repères.',
      groupsTitle: 'Projets de la période',
      groupKicker: 'Projet',
    },
    loadComponent: loadCalendarPage,
  },
  {
    path: 'patrimoine/calendrier',
    title: 'Calendrier — Patrimoine',
    data: {
      calendar: 'patrimoine',
      offer: ['noyau'],
      eyebrow: 'Patrimoine · Calendrier',
      title: 'Le patrimoine',
      emphasis: 'dans la durée.',
      intro: 'L’ouverture du patrimoine, les résultats de période qui l’alimentent et vos objectifs de vie datés.',
      groupsTitle: 'Patrimoine de la période',
      groupKicker: 'Patrimoine',
    },
    loadComponent: loadCalendarPage,
  },

  // ---------- Socle : niveau 2 (middlewares, interfaces de test) ----------
  { path: 'socle/budget', title: 'Budget (test) — Middleware', loadComponent: () => import('./middleware/budget-test').then((m) => m.BudgetTest) },
  { path: 'socle/cycle', title: 'Cycle et temps (test) — Middleware technique', loadComponent: () => import('./middleware/cycle-test').then((m) => m.CycleTest) },
  { path: 'socle/patrimoine', title: 'Patrimoine (test) — Middleware', loadComponent: () => import('./middleware/patrimoine-test').then((m) => m.PatrimoineTest) },

  // ---------- Socle : transverse ----------
  { path: 'object-management', title: 'Object Management — Socle', loadComponent: () => import('./object-management/object-management').then((m) => m.ObjectManagement) },
  { path: 'admin', title: 'Administration — Socle', loadComponent: () => import('./admin/admin').then((m) => m.AdminPage) },
  { path: 'admin/calculs', title: 'Calculs — Administration', loadComponent: () => import('./admin/metrics').then((m) => m.AdminMetrics) },
  { path: 'admin/calculs/:key', title: 'Formule — Administration', loadComponent: () => import('./admin/metric-editor').then((m) => m.MetricEditor) },
  // ---------- Applications : chaque déclaration apporte ses adresses (`platform/applications.ts`) ----------
  ...APPLICATIONS.flatMap((application) => application.routes),
  // Accueils génériques du plan du site (`plan/site-plan.ts`) : accueil de zone, accueil de section.
  { path: 'zones/:zone', title: planRouteTitle, loadComponent: () => import('./home/zone-home').then((m) => m.ZoneHomePage) },
  { path: 'zones/:zone/:section', title: planRouteTitle, loadComponent: () => import('./home/section-landing').then((m) => m.SectionLandingPage) },

  { path: '**', redirectTo: '' },
];

// Les destinations spécialisées précèdent les identifiants dynamiques et partagent leur module.
export const routes: Routes = ([
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
] as Routes);
