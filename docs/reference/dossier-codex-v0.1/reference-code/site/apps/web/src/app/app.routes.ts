import { inject } from '@angular/core';
import { CanMatchFn, ResolveFn, Routes, Router } from '@angular/router';
import { ItemKind, SECTIONS } from './work-items';
import { accessGuard, administrationGuard, sessionGuard } from './utilisateurs/access.guard';
import { UserSession, entityCategory } from './utilisateurs/utilisateurs.contract';
import { planZone } from './shared/site-plan';

/** Le titre de l'onglet nomme le même parent que la page et son menu. */
const planRouteTitle: ResolveFn<string> = (route) => {
  const zone = planZone(route.paramMap.get('zone'));
  const section = zone?.sections.find((entry) => entry.id === route.paramMap.get('section'));
  return [section?.label, zone?.label ?? 'Destination introuvable', 'RJS Forecast']
    .filter(Boolean)
    .join(' · ');
};

function sectionHomeRoute(kind: ItemKind) {
  const section = SECTIONS[kind];
  return {
    path: section.base.slice(1),
    title: section.name + ' · RJS Forecast',
    data: { kind },
    loadComponent: () => import('./section-home.page').then((m) => m.SectionHomePage),
  };
}
function budgetManagerRoute(path: string, title: string, detail = false, creation = false) {
  return {
    path: `${creation ? 'creer' : 'manager'}/${path}${detail ? '/:id' : ''}`,
    title: `${title} · ${creation ? 'Créer' : 'Manager'} · Budget management`,
    data: { budgetStage: 'manage', budgetType: path, creation },
    loadComponent: () => import('./budget/budget-home.page').then((m) => m.BudgetHomePage),
  };
}
/** Les entreprises travaillent leurs projets dans Mon entreprise. */
const personalVisionGuard: CanMatchFn = async () => {
  const session = inject(UserSession),
    router = inject(Router);
  await session.ready();
  return (
    !['entreprise-personnelle', 'association'].includes(entityCategory(session.profile())) ||
    router.createUrlTree(['/budget-patrimoine-management/entreprise/projets'], {
      queryParams: { entreprise: session.profile()?.id },
    })
  );
};
/** Les anciennes ancres d’action restent accessibles après la séparation du pilotage. */
const pilotFragmentGuard: CanMatchFn = () => {
  const router = inject(Router),
    requested = router.currentNavigation()?.extractedUrl;
  if (
    !requested?.fragment ||
    ![
      'agir',
      'bp-groupe-directives',
      'bp-dir-title',
      'bp-pending-title',
      'bp-flow-title',
      'mois-type',
      'bp-target-title',
      'bp-sim-title',
      'bp-levers-title',
    ].includes(requested.fragment)
  )
    return true;
  return router.createUrlTree(['/budget-patrimoine-management/piloter/agir'], {
    queryParams: requested.queryParams,
    fragment: requested.fragment === 'bp-groupe-directives' ? 'bp-dir-title' : requested.fragment,
  });
};
/** Les anciennes ancres du tableau de bord rejoignent les repères de sa présentation réunifiée. */
const dashboardFragmentGuard: CanMatchFn = () => {
  const router = inject(Router),
    requested = router.currentNavigation()?.extractedUrl;
  const targets: Record<string, string> = {
    'etat-des-lieux': 'bm-key-figures',
    'daily-budget-title': 'bm-key-figures',
    'daily-wealth-title': 'bm-wealth',
    'bpm-trend-title': 'bm-wealth',
    'bpm-daily-routine': 'bm-budget-title',
    agir: 'bm-budget-title',
    'bpm-next-title': 'bm-budget-title',
    'bpm-journey-title': 'bm-budget-title',
  };
  const fragment = targets[requested?.fragment ?? ''];
  return !fragment || !requested
    ? true
    : router.createUrlTree(['/budget-patrimoine-management/tableau-de-bord'], {
        queryParams: requested.queryParams,
        fragment,
      });
};
export const routes: Routes = [
  {
    path: 'budget-patrimoine-management/creer/sources/:type',
    canMatch: [accessGuard],
    data: { acces: 'budget' },
    title: 'Éléments sources · Budget/Patrimoine',
    loadComponent: () => import('./bpm/bpm-source.page').then((m) => m.BpmSourcePage),
  },
  { path: 'zones/noyau/applicatif', pathMatch: 'full', redirectTo: '/zones/noyau' },
  {
    path: 'patrimoine-management/calendrier-360',
    canMatch: [accessGuard],
    data: { acces: 'patrimoine' },
    title: 'Calendrier 360 · Patrimoine',
    loadComponent: () =>
      import('./patrimoine/patrimoine-calendar.page').then((m) => m.PatrimoineCalendarPage),
  },
  {
    path: 'patrimoine-management',
    pathMatch: 'full',
    canMatch: [accessGuard],
    data: { acces: 'patrimoine' },
    title: 'Synthèse globale · Patrimoine',
    loadComponent: () =>
      import('./patrimoine/patrimoine-synthesis.page').then((m) => m.PatrimoineSynthesisPage),
  },
  // Niveau 1 : Budget/Patrimoine Management, parcours guidé sur les fonctions de Budget et de Patrimoine.
  { path: 'budget-patrimoine-management', pathMatch: 'full', redirectTo: '/zones/bpm' },
  {
    path: 'budget-patrimoine-management/creer',
    canMatch: [accessGuard],
    data: { acces: 'budget' },
    title: 'Créer un projet · Budget/Patrimoine Management',
    loadComponent: () => import('./bpm/bpm-create.page').then((m) => m.BpmCreatePage),
  },
  {
    // Seconde partie d'« Assembler l'existant » : l'atelier qui réunit les fiches créées dans les modules.
    path: 'budget-patrimoine-management/creer/assembler',
    canMatch: [accessGuard],
    data: { acces: 'budget' },
    title: 'Atelier d’assemblage · Budget/Patrimoine Management',
    loadComponent: () => import('./bpm/bpm-assembly.page').then((m) => m.BpmAssemblyPage),
  },
  {
    path: 'budget-patrimoine-management/tableau-de-bord',
    canMatch: [accessGuard, personalVisionGuard, dashboardFragmentGuard],
    data: { acces: 'budget' },
    title: 'Tableau de bord · Ma vision budgétaire',
    loadComponent: () => import('./bpm/bpm-money.page').then((m) => m.BpmMoneyPage),
  },
  {
    // Composition : le cycle relie Budget et Patrimoine sans qu'aucun n'importe l'autre.
    path: 'budget-patrimoine-management/cycle',
    canMatch: [accessGuard],
    data: { acces: 'budget' },
    title: 'Cycle budgétaire · Budget/Patrimoine Management',
    loadComponent: () => import('./composition/budget-cycle.page').then((m) => m.BudgetCyclePage),
  },
  {
    path: 'budget-patrimoine-management/piloter/agir',
    canMatch: [accessGuard, personalVisionGuard],
    data: { acces: 'budget', pilotView: 'actions' },
    title: 'Ce qu’il faut faire · Piloter la période',
    loadComponent: () => import('./bpm/bpm-pilot.page').then((m) => m.BpmPilotPage),
  },
  {
    path: 'budget-patrimoine-management/piloter',
    canMatch: [accessGuard, personalVisionGuard, pilotFragmentGuard],
    data: { acces: 'budget', pilotView: 'stats' },
    title: 'Graphiques & chiffres · Piloter la période',
    loadComponent: () => import('./bpm/bpm-pilot.page').then((m) => m.BpmPilotPage),
  },
  {
    path: 'budget-patrimoine-management/entreprise/projets',
    canMatch: [accessGuard],
    data: { acces: 'budget', expenses: true, professional: true },
    title: 'Projets des structures · Mon entreprise',
    loadComponent: () =>
      import('./bpm/bpm-enterprise-projects.page').then((m) => m.BpmEnterpriseProjectsPage),
  },
  {
    path: 'budget-patrimoine-management/entreprise/depenses',
    canMatch: [accessGuard],
    data: { acces: 'budget', expenses: true, professional: true },
    title: 'Dépenses des structures · Mon entreprise',
    loadComponent: () => import('./bpm/bpm-expenses.page').then((m) => m.BpmExpensesPage),
  },
  {
    path: 'budget-patrimoine-management/depenses',
    canMatch: [accessGuard, personalVisionGuard],
    data: { acces: 'budget', expenses: true },
    title: 'Dépenses de la période · Ma vision budgétaire',
    loadComponent: () => import('./bpm/bpm-expenses.page').then((m) => m.BpmExpensesPage),
  },
  {
    path: 'budget-patrimoine-management/argent',
    pathMatch: 'full',
    redirectTo: ({ queryParams, fragment }) =>
      inject(Router).createUrlTree(['/budget-patrimoine-management/tableau-de-bord'], {
        queryParams,
        fragment: fragment ?? undefined,
      }),
  },
  {
    // Creuser une ligne du tableau de bord : un poste, les entrées ou le reste.
    path: 'budget-patrimoine-management/argent/postes/:poste',
    canMatch: [accessGuard, personalVisionGuard],
    data: { acces: 'budget', nature: 'poste' },
    title: 'Un poste · Tableau de bord',
    loadComponent: () => import('./bpm/bpm-money-detail.page').then((m) => m.BpmMoneyDetailPage),
  },
  {
    path: 'budget-patrimoine-management/argent/a-preciser',
    redirectTo: ({ queryParams, fragment }) =>
      inject(Router).createUrlTree(['/budget-patrimoine-management/tableau-de-bord'], {
        queryParams,
        fragment: fragment ?? undefined,
      }),
    pathMatch: 'full',
  },
  {
    path: 'budget-patrimoine-management/argent/:nature',
    canMatch: [accessGuard, personalVisionGuard],
    data: { acces: 'budget' },
    title: 'Détail · Tableau de bord',
    loadComponent: () => import('./bpm/bpm-money-detail.page').then((m) => m.BpmMoneyDetailPage),
  },
  {
    path: 'budget-patrimoine-management/entreprise',
    canMatch: [accessGuard],
    data: { acces: 'budget' },
    title: 'Versements et apports · Mes patrimoines',
    loadComponent: () => import('./bpm/bpm-business.component').then((m) => m.BpmBusinessComponent),
  },
  {
    // Le patrimoine personnel et la part détenue des patrimoines professionnels, en une lecture.
    path: 'budget-patrimoine-management/patrimoine-global',
    canMatch: [accessGuard],
    data: { acces: 'budget' },
    title: 'Patrimoine global · Mes patrimoines',
    loadComponent: () => import('./bpm/bpm-global.page').then((m) => m.BpmGlobalPage),
  },
  {
    // Le pilotage d'une entreprise rattachée : factures, encaissements, clients.
    path: 'budget-patrimoine-management/entreprise/pilotage',
    canMatch: [accessGuard],
    data: { acces: 'budget' },
    title: 'Pilotage de l’entreprise · Mon entreprise',
    loadComponent: () => import('./bpm/bpm-enterprise.page').then((m) => m.BpmEnterprisePage),
  },
  {
    path: 'budget-patrimoine-management/vision',
    canMatch: [accessGuard, personalVisionGuard],
    data: { acces: 'budget' },
    title: 'Objectifs & avenir · Ma vision budgétaire',
    loadComponent: () => import('./bpm/bpm-vision.page').then((m) => m.BpmVisionPage),
  },
  {
    path: 'budget-patrimoine-management/parcours',
    canMatch: [accessGuard],
    data: { acces: 'budget' },
    title: 'Mon parcours · Budget/Patrimoine Management',
    loadComponent: () => import('./bpm/bpm-journey.page').then((m) => m.BpmJourneyPage),
  },
  {
    path: 'patrimoine-management/projection',
    canMatch: [accessGuard],
    data: { acces: 'patrimoine', projection: true },
    title: 'Réel & prévisionnel · Patrimoine',
    loadComponent: () => import('./patrimoine/patrimoine.page').then((m) => m.PatrimoinePage),
  },
  ...['creer', 'manager'].flatMap((stage) =>
    ['projects', 'allocations', 'people', 'operations', 'providers', 'assets'].map((family) => ({
      path: `patrimoine-management/${stage}/${family}`,
      canMatch: [accessGuard],
      data: { acces: 'patrimoine', family, stage },
      title: `${stage === 'creer' ? 'Créer' : 'Manager'} · Patrimoine`,
      loadComponent: () => import('./patrimoine/patrimoine.page').then((m) => m.PatrimoinePage),
    })),
  ),

  {
    path: '',
    title: 'Accueil · RJS Forecast',
    loadComponent: () => import('./overview.page').then((m) => m.OverviewPage),
  },
  { path: 'zones/budget/fiches', pathMatch: 'full', redirectTo: '/zones/budget/manager' },
  // Accueils génériques du plan du site (`configuration/navigation-catalog.json`).
  {
    path: 'zones/:zone',
    title: planRouteTitle,
    loadComponent: () => import('./zone-home.page').then((m) => m.ZoneHomePage),
  },
  {
    path: 'zones/:zone/:section',
    title: planRouteTitle,
    loadComponent: () => import('./section-landing.page').then((m) => m.SectionLandingPage),
  },
  sectionHomeRoute('project'),
  {
    path: 'calendar-360',
    title: 'Calendrier 360 · Projets · RJS Forecast',
    loadComponent: () => import('./calendar-360.page').then((m) => m.Calendar360Page),
  },
  { path: 'projects/calendar-360', pathMatch: 'full', redirectTo: 'calendar-360' },
  {
    path: 'projects/explorer',
    pathMatch: 'full',
    redirectTo: 'projects',
  },
  { path: 'projects/list', pathMatch: 'full', redirectTo: 'projects' },
  { path: 'projects/calendar', pathMatch: 'full', redirectTo: 'projects' },
  { path: 'projects/deadlines', pathMatch: 'full', redirectTo: 'projects' },
  {
    path: 'projects/:id',
    title: 'Projets · RJS Forecast',
    loadComponent: () => import('./projects.page').then((m) => m.ProjectsPage),
  },
  sectionHomeRoute('task'),
  {
    path: 'pilotage',
    title: 'Pilotage · RJS Forecast',
    loadComponent: () => import('./pilotage.page').then((m) => m.PilotagePage),
  },
  {
    path: 'reinitialisation',
    title: 'Ré initialisation des données · RJS Forecast',
    loadComponent: () => import('./reinitialisation.page').then((m) => m.ReinitialisationPage),
  },
  {
    path: 'tests/points',
    title: 'Points à instruire · RJS Forecast',
    loadComponent: () => import('./tests-points.page').then((m) => m.TestsPointsPage),
  },
  {
    path: 'tests/cas/:id',
    title: 'Dossier de test · RJS Forecast',
    loadComponent: () => import('./tests-case.page').then((m) => m.TestsCasePage),
  },
  {
    path: 'tests/bilans/:id',
    title: 'Bilan de tests · RJS Forecast',
    loadComponent: () => import('./tests-reports.page').then((m) => m.TestsReportsPage),
  },
  {
    path: 'tests/bilans',
    title: 'Bilans des tests · RJS Forecast',
    loadComponent: () => import('./tests-reports.page').then((m) => m.TestsReportsPage),
  },
  {
    path: 'tests',
    pathMatch: 'full',
    title: 'Tests · RJS Forecast',
    loadComponent: () => import('./tests.page').then((m) => m.TestsPage),
  },
  {
    path: 'administration/journal',
    title: 'Journal d’activité · Administration · RJS Forecast',
    canMatch: [accessGuard],
    data: { acces: 'budget-administration', accesAttribue: true },
    loadComponent: () => import('./audit-admin.page').then((m) => m.AuditAdminPage),
  },
  {
    path: 'configuration',
    pathMatch: 'full',
    title: 'Configuration · RJS Forecast',
    canMatch: [accessGuard],
    data: { acces: 'configuration', configView: 'home' },
    loadComponent: () =>
      import('./configuration/configuration.page').then((m) => m.ConfigurationPage),
  },
  {
    path: 'configuration/contenus',
    title: 'Contenus & présentation · Configuration',
    canMatch: [accessGuard],
    data: { acces: 'configuration' },
    loadComponent: () =>
      import('./configuration/configuration-content.page').then((m) => m.ConfigurationContentPage),
  },
  {
    path: 'configuration/catalogue',
    title: 'Registre des réglages · Configuration',
    canMatch: [accessGuard],
    data: { acces: 'configuration', configView: 'catalog' },
    loadComponent: () =>
      import('./configuration/configuration.page').then((m) => m.ConfigurationPage),
  },
  {
    path: 'configuration/journaux',
    canDeactivate: [(component: { canLeave(): boolean }) => component.canLeave()],
    title: 'Rétention des journaux · Configuration',
    canMatch: [accessGuard],
    data: { acces: 'configuration', configView: 'logs' },
    loadComponent: () =>
      import('./configuration/configuration.page').then((m) => m.ConfigurationPage),
  },
  {
    path: 'configuration/apparence',
    canDeactivate: [(component: { canLeave(): boolean }) => component.canLeave()],
    title: 'Patterns visuels · Configuration',
    canMatch: [accessGuard],
    data: { acces: 'configuration', configView: 'design' },
    loadComponent: () =>
      import('./configuration/configuration.page').then((m) => m.ConfigurationPage),
  },
  {
    path: 'configuration/navigation',
    canDeactivate: [(component: { canLeave(): boolean }) => component.canLeave()],
    title: 'Navigation gauche · Configuration',
    canMatch: [accessGuard],
    data: { acces: 'configuration', configView: 'navigation' },
    loadComponent: () =>
      import('./configuration/configuration.page').then((m) => m.ConfigurationPage),
  },
  {
    path: 'configuration/reglages',
    canDeactivate: [(component: { canLeave(): boolean }) => component.canLeave()],
    title: 'Réglages · Configuration',
    canMatch: [accessGuard],
    data: { acces: 'configuration', configView: 'settings' },
    loadComponent: () =>
      import('./configuration/configuration.page').then((m) => m.ConfigurationPage),
  },
  {
    path: 'configuration/fichier',
    canDeactivate: [(component: { canLeave(): boolean }) => component.canLeave()],
    title: 'Fichier CSV · Configuration',
    canMatch: [accessGuard],
    data: { acces: 'configuration', configView: 'file' },
    loadComponent: () =>
      import('./configuration/configuration.page').then((m) => m.ConfigurationPage),
  },
  {
    // Niveau 1 : la Formation admin étend directement le noyau, module à part entière,
    // hors de Budget. Son administration demande un droit réellement attribué.
    path: 'formation-site/administration',
    title: 'Administration · Formation admin',
    canMatch: [accessGuard],
    data: { acces: 'formation-site-administration', accesAttribue: true },
    loadComponent: () =>
      import('./formation-site/formation-site-administration.page').then(
        (m) => m.FormationSiteAdministrationPage,
      ),
  },
  {
    path: 'formation-site',
    title: 'Formation admin · RJS Forecast',
    canMatch: [accessGuard],
    data: { acces: 'formation-site' },
    loadComponent: () =>
      import('./formation-site/site-training.page').then((m) => m.SiteTrainingPage),
  },
  {
    // Niveau 1 : Budget étend le noyau. Son périmètre s'ouvre avec la Formation,
    // module de niveau 2 qui vit par lui ; la production exige en plus Budget.
    path: 'budget-management',
    title: 'Budget management · RJS Forecast',
    canMatch: [accessGuard],
    data: { acces: 'formation' },
    loadComponent: () => import('./budget/budget-shell.page').then((m) => m.BudgetShellPage),
    children: [
      {
        path: 'formation/administration',
        pathMatch: 'full',
        title: 'Administration de la formation · Budget management',
        canMatch: [accessGuard],
        data: { acces: 'budget-administration', accesAttribue: true, compactHost: true },
        loadComponent: () =>
          import('./formation/formation-administration.page').then(
            (m) => m.FormationAdministrationPage,
          ),
      },
      {
        path: 'formation',
        pathMatch: 'full',
        title: 'Formation · Budget management',
        data: { compactHost: true },
        loadComponent: () =>
          import('./formation/budget-training.page').then((m) => m.BudgetTrainingPage),
      },
      {
        path: '',
        canMatch: [accessGuard],
        data: { acces: 'budget' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            title: 'Budget management · RJS Forecast',
            loadComponent: () => import('./budget/budget-home.page').then((m) => m.BudgetHomePage),
          },
          {
            path: 'preparer',
            pathMatch: 'full',
            redirectTo: ({ queryParams, fragment }) => {
              if (fragment === 'budget-cash-settings')
                return inject(Router).createUrlTree(['/budget-management/manager/operations'], {
                  queryParams,
                  fragment,
                });
              const family =
                (
                  {
                    project: 'projets',
                    center: 'centres',
                    person: 'personnes',
                    operation: 'operations',
                    provider: 'prestataires',
                    asset: 'patrimoine',
                  } as Record<string, string>
                )[queryParams['create']] ?? 'projets';
              return inject(Router).createUrlTree(
                family === 'patrimoine'
                  ? ['/patrimoine-management/creer/assets']
                  : ['/budget-management/creer', family],
                { queryParams, fragment: 'budget-preparation-wizard' },
              );
            },
          },
          {
            path: 'manager',
            pathMatch: 'full',
            redirectTo: 'manager/projets',
          },
          { path: 'creer', pathMatch: 'full', redirectTo: '/zones/budget/creer' },
          budgetManagerRoute('projets', 'Projets budgétaires', true, true),
          budgetManagerRoute('projets', 'Projets budgétaires', false, true),
          budgetManagerRoute('centres', 'Centres de coûts', true, true),
          budgetManagerRoute('centres', 'Centres de coûts', false, true),
          budgetManagerRoute('personnes', 'Personnes', true, true),
          budgetManagerRoute('personnes', 'Personnes', false, true),
          budgetManagerRoute('operations', 'Opérations', true, true),
          budgetManagerRoute('operations', 'Opérations', false, true),
          budgetManagerRoute('prestataires', 'Prestataires', true, true),
          budgetManagerRoute('prestataires', 'Prestataires', false, true),
          { path: 'creer/patrimoine', redirectTo: '/patrimoine-management/creer/assets' },
          budgetManagerRoute('centres', 'Centre de coûts', true),
          budgetManagerRoute('centres', 'Centres de coûts'),
          budgetManagerRoute('personnes', 'Personne', true),
          budgetManagerRoute('personnes', 'Personnes'),
          budgetManagerRoute('projets', 'Projet budgétaire', true),
          budgetManagerRoute('projets', 'Projets budgétaires'),
          budgetManagerRoute('operations', 'Opération', true),
          budgetManagerRoute('operations', 'Opérations'),
          budgetManagerRoute('prestataires', 'Prestataire', true),
          budgetManagerRoute('prestataires', 'Prestataires'),
          budgetManagerRoute('patrimoine', 'Fiche de patrimoine', true),
          budgetManagerRoute('patrimoine', 'Patrimoine'),
          {
            path: 'suivre',
            title: 'Tableau de bord · Suivre & décider · Budget management',
            data: { budgetStage: 'monitor' },
            loadComponent: () =>
              import('./budget/budget-decision-dashboard.page').then(
                (m) => m.BudgetDecisionDashboardPage,
              ),
          },
          {
            path: 'parcours',
            title: 'Les neuf parcours · Suivre & décider · Budget management',
            data: { budgetStage: 'monitor' },
            loadComponent: () =>
              import('./budget/budget-journeys.page').then((m) => m.BudgetJourneysPage),
          },
          {
            path: 'notions',
            title: 'Les notions clés · Budget management',
            data: { budgetStage: 'monitor' },
            loadComponent: () =>
              import('./budget/budget-notions.page').then((m) => m.BudgetNotionsPage),
          },
          {
            path: 'regles',
            title: 'Les 45 règles · Suivre & décider · Budget management',
            data: { budgetStage: 'monitor' },
            loadComponent: () =>
              import('./budget/budget-rules.page').then((m) => m.BudgetRulesPage),
          },
          {
            path: 'budget-360',
            title: 'Budget 360 · Budget management',
            loadComponent: () =>
              import('./budget/budget-dashboard.page').then((m) => m.BudgetDashboardPage),
          },
          { path: 'centres', pathMatch: 'full', redirectTo: 'manager/centres' },
          {
            path: 'centres/:id',
            title: 'Centre de coûts · Budget management',
            loadComponent: () =>
              import('./budget/budget-center-detail.page').then((m) => m.BudgetCenterDetailPage),
          },
          { path: 'operations', pathMatch: 'full', redirectTo: 'manager/complements/operations' },
          {
            path: 'manager/complements/operations',
            title: 'Devis & règlements · Manager',
            loadComponent: () =>
              import('./budget/budget-operations.page').then((m) => m.BudgetOperationsPage),
          },
          {
            path: 'operations/:id',
            title: 'Opération · Budget management',
            loadComponent: () =>
              import('./budget/budget-operation-detail.page').then(
                (m) => m.BudgetOperationDetailPage,
              ),
          },
          { path: 'projets', pathMatch: 'full', redirectTo: 'manager/projets' },
          {
            path: 'projets/:id',
            title: 'Projet budgétaire · Budget management',
            loadComponent: () =>
              import('./budget/budget-project-detail.page').then((m) => m.BudgetProjectDetailPage),
          },
          { path: 'personnes', pathMatch: 'full', redirectTo: 'manager/personnes' },
          { path: 'prestataires', pathMatch: 'full', redirectTo: 'manager/prestataires' },
          {
            path: 'prestataires/:id',
            title: 'Fiche prestataire · Budget management',
            loadComponent: () =>
              import('./budget/budget-provider-detail.page').then(
                (m) => m.BudgetProviderDetailPage,
              ),
          },
          // Le cycle vit désormais dans Budget/Patrimoine Management ; l'ancienne adresse y mène.
          { path: 'cycle', redirectTo: '/budget-patrimoine-management/cycle' },
          {
            path: 'calendrier-360',
            title: 'Calendrier 360 · Budget management',
            loadComponent: () =>
              import('./budget/budget-calendar.page').then((m) => m.BudgetCalendarPage),
          },
          { path: 'patrimoine', pathMatch: 'full', redirectTo: 'manager/complements/patrimoine' },
          {
            path: 'manager/complements/patrimoine',
            title: 'Valeurs des actifs historiques · Manager',
            loadComponent: () =>
              import('./budget/budget-assets.page').then((m) => m.BudgetAssetsPage),
          },
        ],
      },
    ],
  },
  { path: 'budget-360', pathMatch: 'full', redirectTo: 'budget-management/budget-360' },
  { path: 'budget-360/centres', pathMatch: 'full', redirectTo: 'budget-management/centres' },
  { path: 'budget-360/centres/:id', redirectTo: 'budget-management/centres/:id' },
  { path: 'budget-360/operations', pathMatch: 'full', redirectTo: 'budget-management/operations' },
  {
    path: 'budget-360/calendrier',
    pathMatch: 'full',
    redirectTo: 'budget-management/calendrier-360',
  },
  { path: 'budget-360/patrimoine', pathMatch: 'full', redirectTo: 'budget-management/patrimoine' },
  {
    path: 'documentation',
    title: 'Documentation · RJS Forecast',
    loadComponent: () => import('./documentation.page').then((m) => m.DocumentationPage),
    children: [
      {
        path: 'architecture',
        title: 'Architecture · Documentation · RJS Forecast',
        data: { sectionId: 'architecture' },
        loadComponent: () =>
          import('./documentation/documentation-architecture.page').then(
            (m) => m.DocumentationArchitecturePage,
          ),
      },
      {
        path: 'modele',
        title: 'Modèle de données · Documentation · RJS Forecast',
        data: { sectionId: 'modele' },
        loadComponent: () =>
          import('./documentation/documentation-modele.page').then(
            (m) => m.DocumentationModelePage,
          ),
      },
      {
        path: 'statuts',
        title: 'Statuts et calculs · Documentation · RJS Forecast',
        data: { sectionId: 'statuts' },
        loadComponent: () =>
          import('./documentation/documentation-statuts.page').then(
            (m) => m.DocumentationStatutsPage,
          ),
      },
      {
        path: 'stockage',
        title: 'Stockage et écritures · Documentation · RJS Forecast',
        data: { sectionId: 'stockage' },
        loadComponent: () =>
          import('./documentation/documentation-stockage.page').then(
            (m) => m.DocumentationStockagePage,
          ),
      },
      {
        path: 'vues',
        title: 'Vues de travail · Documentation · RJS Forecast',
        data: { sectionId: 'vues' },
        loadComponent: () =>
          import('./documentation/documentation-vues.page').then((m) => m.DocumentationVuesPage),
      },
      {
        path: 'calendrier',
        title: 'Calendrier 360 · Documentation · RJS Forecast',
        data: { sectionId: 'calendrier' },
        loadComponent: () =>
          import('./documentation/documentation-calendrier.page').then(
            (m) => m.DocumentationCalendrierPage,
          ),
      },
      {
        path: 'pilotage',
        title: 'Créneau et Pilotage · Documentation · RJS Forecast',
        data: { sectionId: 'pilotage' },
        loadComponent: () =>
          import('./documentation/documentation-pilotage.page').then(
            (m) => m.DocumentationPilotagePage,
          ),
      },
      {
        path: 'echanges',
        title: 'Échanges de données · Documentation · RJS Forecast',
        data: { sectionId: 'echanges' },
        loadComponent: () =>
          import('./documentation/documentation-echanges.page').then(
            (m) => m.DocumentationEchangesPage,
          ),
      },
      {
        path: 'interface',
        title: 'Interface et styles · Documentation · RJS Forecast',
        data: { sectionId: 'interface' },
        loadComponent: () =>
          import('./documentation/documentation-interface.page').then(
            (m) => m.DocumentationInterfacePage,
          ),
      },
      {
        path: 'decisions',
        title: 'Décisions et sources · Documentation · RJS Forecast',
        data: { sectionId: 'decisions' },
        loadComponent: () =>
          import('./documentation/documentation-decisions.page').then(
            (m) => m.DocumentationDecisionsPage,
          ),
      },
      // Anciennes rubriques du guide (avant sa réécriture du 1er octobre 2026).
      { path: 'comprendre', pathMatch: 'full', redirectTo: 'architecture' },
      { path: 'projets', pathMatch: 'full', redirectTo: 'statuts' },
      { path: 'taches', pathMatch: 'full', redirectTo: 'vues' },
      { path: 'creneau', pathMatch: 'full', redirectTo: 'pilotage' },
      { path: 'donnees', pathMatch: 'full', redirectTo: 'echanges' },
      { path: 'sources', pathMatch: 'full', redirectTo: 'decisions' },
    ],
  },
  { path: 'delivery/list', pathMatch: 'full', redirectTo: 'delivery' },
  { path: 'delivery/calendar', pathMatch: 'full', redirectTo: 'delivery' },
  { path: 'delivery/deadlines', pathMatch: 'full', redirectTo: 'delivery' },
  { path: 'delivery/board', pathMatch: 'full', redirectTo: 'delivery' },
  {
    path: 'delivery/:id',
    title: 'Taches · RJS Forecast',
    loadComponent: () => import('./task-detail.page').then((m) => m.TaskDetailPage),
  },
  // Niveau 1, module central : Utilisateurs. Le choix du profil et le refus
  // restent ouverts ; l'administration s'ouvre à qui administre un périmètre.
  {
    path: 'acces',
    title: 'Choisir son profil · RJS Forecast',
    loadComponent: () =>
      import('./utilisateurs/profile-choice.page').then((m) => m.ProfileChoicePage),
  },
  {
    path: 'acces/refus',
    title: 'Accès refusé · RJS Forecast',
    loadComponent: () =>
      import('./utilisateurs/access-refused.page').then((m) => m.AccessRefusedPage),
  },
  {
    path: 'utilisateurs',
    title: 'Utilisateurs · RJS Forecast',
    canMatch: [administrationGuard],
    loadComponent: () => import('./utilisateurs/utilisateurs.page').then((m) => m.UtilisateursPage),
  },
  {
    path: '**',
    title: 'Destination introuvable · RJS Forecast',
    loadComponent: () => import('./shared/not-found.page').then((m) => m.NotFoundPage),
  },
];

// La sélection locale reste facultative par défaut ; le mode nominal exige un profil.
for (const route of routes)
  if (!route.redirectTo && !route.path?.startsWith('acces'))
    route.canMatch = [sessionGuard, ...(route.canMatch ?? [])];
