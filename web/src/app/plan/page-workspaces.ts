import { Route } from '@angular/router';
import { PageWorkspace } from './page-workspace';
import { loadCalendarPage } from '../calendar/calendar.route';

export interface WorkspaceDestination extends PageWorkspace {
  path: string;
  label: string;
  existing?: boolean;
  /** Hors du menu et des onglets : la vue s'ouvre par un bouton ou un geste, pas comme une destination à part. */
  menu?: false;
  /** Libellé court de l'onglet quand le bandeau rappelle déjà l'objet ouvert. */
  tabLabel?: string;
  loadComponent?: Route['loadComponent'];
}
const view = (path: string, parent: string, key: string, label: string, lead: string,
  loadComponent?: Route['loadComponent'], existing = false): WorkspaceDestination =>
  ({ path, parent, key, label, title: label, lead, loadComponent, existing });

/** Un seul catalogue pour les routes, la profondeur du menu et le contexte des bandeaux. */
export const PAGE_WORKSPACES: WorkspaceDestination[] = [
  // Démarrer un projet ne crée que le projet de vie : le user et tout son espace naissent ensemble, une seule fois.
  view('creer/projet-de-vie', '/creer', 'start-life', 'Créer mon projet de vie', 'Donnez un nom à votre profil et, si vous les connaissez, votre patrimoine de départ et le début de votre cycle.', () => import('../bpm/onboarding').then(m => m.BpmOnboarding)),
  view('tableau-de-bord/entrees', '/tableau-de-bord', 'incomes', 'Entrées de la période', 'Vérifiez les réceptions, leurs sources et les montants encore attendus.', () => import('../bpm/pages/incomes').then(m => m.BpmIncomesPage)),
  view('tableau-de-bord/rapprochement', '/tableau-de-bord', 'reconciliation', 'Rapprocher avec mon compte', 'Comparez les soldes de votre compte au réalisé, puis expliquez un éventuel écart.', () => import('../bpm/pages/balance').then(m => m.BpmBalancePage)),
  view('depenses/registre', '/tableau-de-bord', 'register', 'Registre des flux', 'Retrouvez un flux, vérifiez son règlement ou préparez une nouvelle opération.', () => import('../bpm/pages/expenses').then(m => m.BpmExpensesPage)),
  view('piloter', '/tableau-de-bord', 'analysis', 'Graphiques et chiffres', 'Analysez le réalisé, les prévisions et les résultats des périodes.', undefined, true),
  view('projet-de-vie/budget-type', '/projet-de-vie', 'life-budget', 'Préparer le budget type', 'Construisez les revenus et les charges qui reviennent dans votre projet de vie.', () => import('../bpm/life/life-management.page').then(m => m.BpmLifeManagementPage)),
  view('projet-de-vie/cloture', '/projet-de-vie', 'life-closing', 'Suivi et clôture du cycle', 'Relisez les contrôles, les décisions et le résultat à capitaliser avant de clôturer.', () => import('../bpm/life/life-management.page').then(m => m.BpmLifeManagementPage)),
  view('piloter/agir', '/projet-de-vie', 'actions', 'Échéances à traiter', 'Examinez les échéances à régler et préparez la suite de la période.', undefined, true),
  view('plafonds/reglages', '/plafonds', 'caps-settings', 'Définir les plafonds', 'Réglez la limite du poste ou de la catégorie choisi, sans modifier vos opérations.', () => import('../bpm/pages/caps').then(m => m.BpmCapsPage)),
  view('plafonds/categories', '/plafonds', 'caps-categories', 'Organiser les catégories', 'Créez et rangez vos catégories dans leurs postes de dépense.', () => import('../bpm/pages/caps').then(m => m.BpmCapsPage)),
  view('vision/projection', '/vision', 'vision-projection', 'Projection patrimoniale', 'Ajustez vos hypothèses puis examinez la couverture de vos objectifs dans ce scénario.', () => import('../bpm/objectives/objectives.page').then(m => m.BpmObjectivesPage)),
  view('vision/reperes', '/vision', 'vision-landmarks', 'Épargne et cap patrimonial', 'Définissez vos repères d’épargne et le patrimoine que vous souhaitez construire.', () => import('../bpm/objectives/objectives.page').then(m => m.BpmObjectivesPage)),
  // Un seul lieu pour les projets : le tableau par statut et le suivi sont des vues de « Projets et financement ».
  view('app/projets', '/app/gestion-projet', 'projects-status', 'Projets par statut', 'Retrouvez le projet de vie et chaque projet de la vie selon son état, avec le budget qui lui est attribué.', undefined, true),
  view('app/projets/suivi', '/app/gestion-projet', 'projects-review', 'Suivi des projets financés', 'Examinez les enveloppes, les consommations et les projets qui demandent une attention.', () => import('../bpm/projects/projects.page').then(m => m.BpmProjectsPage)),
  // Les créations s'ouvrent par un bouton ou par le geste de l'onglet : elles ne doublent pas le menu.
  { ...view('app/gestion-projet/nouveau', '/app/gestion-projet', 'project-create', 'Créer un projet de la vie', 'Précisez le projet et, si vous le connaissez, son budget de départ.', () => import('../bpm/projects/project-workspace.page').then(m => m.BpmProjectWorkspacePage)), menu: false },
  view('app/gestion-projet/financement', '/app/gestion-projet', 'project-funding', 'Attribuer les enveloppes', 'Choisissez un projet puis attribuez les moyens nécessaires à ses tâches.', () => import('../bpm/projects/project-workspace.page').then(m => m.BpmProjectWorkspacePage)),
  view('app/gestion-projet/decisions', '/app/gestion-projet', 'project-decisions', 'Décider les financements', 'Relisez les demandes de part et les autorisations de dépassement avant de décider.', () => import('../bpm/projects/project-workspace.page').then(m => m.BpmProjectWorkspacePage)),
  { ...view('app/taches/nouvelle', '/app/taches', 'task-create', 'Créer une tâche', 'Préparez une tâche et choisissez son projet maintenant ou plus tard.', () => import('../bpm/projects/project-workspace.page').then(m => m.BpmProjectWorkspacePage)), menu: false },
  view('app/taches/rattacher', '/app/taches', 'task-attach', 'Rattacher des tâches', 'Choisissez une tâche disponible et le projet auquel elle doit contribuer.', () => import('../bpm/projects/project-workspace.page').then(m => m.BpmProjectWorkspacePage)),
  { ...view('app/gestion-projet/:id/budget', '/app/gestion-projet', 'project-budget', 'Budget du projet', 'Attribuez l’enveloppe, répartissez les parts et examinez les décisions de ce projet.', () => import('../bpm/projects/project.page').then(m => m.BpmProjectPage)), tabLabel: 'Budget et décisions' },
  { ...view('app/gestion-projet/:id/taches', '/app/gestion-projet', 'project-tasks', 'Tâches du projet', 'Préparez et faites avancer les tâches de ce projet.', () => import('../bpm/projects/project.page').then(m => m.BpmProjectPage)), tabLabel: 'Tâches' },
  view('app/reglages/cycle', '/app/reglages', 'settings-cycle', 'Régler le cycle', 'Consultez l’ancrage du cycle, ses bornes et les clôtures enregistrées.', () => import('../bpm/settings').then(m => m.BpmSettings)),
  view('app/reglages/patrimoine', '/app/reglages', 'settings-wealth', 'Point de départ du patrimoine', 'Renseignez le stock initial et sa date pour fiabiliser les lectures patrimoniales.', () => import('../bpm/settings').then(m => m.BpmSettings)),
  view('app/reglages/postes', '/app/reglages', 'settings-centers', 'Postes et sources de revenus', 'Retrouvez les postes disponibles et ajoutez un poste personnel.', () => import('../bpm/settings').then(m => m.BpmSettings)),
  view('projects/new', '/projects', 'core-project-create', 'Créer un projet', 'Définissez le but et les dates du nouveau projet.', undefined, true),
  view('projects/planning', '/projects', 'project-planning', 'Planifier les projets', 'Examinez les projets dans le créneau de dates qui vous intéresse.', () => import('../projects/projects-board').then(m => m.ProjectsBoard)),
  view('tasks/new', '/tasks', 'core-task-create', 'Créer une tâche', 'Précisez le travail et son rattachement au projet.', undefined, true),
  view('tasks/sans-projet', '/tasks', 'core-unassigned', 'Tâches sans projet', 'Retrouvez les tâches préparées séparément puis rattachez-les à un projet.', () => import('../tasks/tasks-board').then(m => m.TasksBoard)),
  view('socle/budget/operations', '/socle/budget', 'budget-operations', 'Opérations du budget', 'Éprouvez la création, le règlement et la lecture des opérations du budget choisi.', () => import('../middleware/budget-test').then(m => m.BudgetTest)),
  view('socle/budget/centres', '/socle/budget', 'budget-centers', 'Centres de coûts', 'Examinez et préparez les centres de coûts du budget choisi.', () => import('../middleware/budget-test').then(m => m.BudgetTest)),
  view('socle/patrimoine/reglages', '/socle/patrimoine', 'patrimoine-settings', 'Régler le patrimoine', 'Éprouvez le stock d’ouverture, sa date et l’objectif du patrimoine.', () => import('../middleware/patrimoine-test').then(m => m.PatrimoineTest)),
  view('socle/patrimoine/capitalisations', '/socle/patrimoine', 'patrimoine-capitalizations', 'Capitalisations enregistrées', 'Relisez les résultats de clôture qui ont alimenté le patrimoine.', () => import('../middleware/patrimoine-test').then(m => m.PatrimoineTest)),
  view('utilisateurs/nouveau', '/utilisateurs', 'users-new', 'Créer un utilisateur', 'Créez le profil et sa composition Budget/Patrimoine dans un même parcours.', () => import('../bpm/onboarding').then(m => m.BpmOnboarding)),
  view('admin/parametres', '/admin', 'admin-parameters', 'Paramètres effectifs', 'Choisissez un paramètre, relisez sa valeur et enregistrez un réglage.', () => import('../admin/admin').then(m => m.AdminPage)),
  view('admin/journal', '/admin', 'admin-journal', 'Journal d’activité', 'Retrouvez les commandes exécutées et leur résultat.', () => import('../admin/admin').then(m => m.AdminPage)),
  view('admin/controles', '/admin', 'admin-errors', 'Erreurs et contrôles', 'Examinez les erreurs récentes et les contrôles d’administration.', () => import('../admin/admin').then(m => m.AdminPage)),
  view('admin/calculs/references', '/admin/calculs', 'metric-references', 'Références des calculs', 'Retrouvez les variables et les métriques disponibles pour préparer une formule.', () => import('../admin/metrics').then(m => m.AdminMetrics)),
  view('object-management/relations', '/object-management', 'objects-relations', 'Relations entre objets', 'Parcourez les références entrantes et sortantes des objets du périmètre choisi.', () => import('../object-management/object-management').then(m => m.ObjectManagement)),
  view('object-management/controles', '/object-management', 'objects-checks', 'Contrôles des objets', 'Examinez les références et les contrôles d’intégrité sans modifier les objets.', () => import('../object-management/object-management').then(m => m.ObjectManagement)),
  view('object-management/journal', '/object-management', 'objects-journal', 'Journal des objets', 'Retracez les commandes et les révisions des objets du périmètre choisi.', () => import('../object-management/object-management').then(m => m.ObjectManagement)),
  ...[
    ['calendrier-budget', 'budgetPatrimoine', 'Calendrier Budget/Patrimoine'],
    ['calendrier', 'noyau', 'Calendrier du travail'],
    ['patrimoine/calendrier', 'patrimoine', 'Calendrier du patrimoine'],
  ].flatMap(([path, calendar]) => [
    view(`${path}/agenda`, `/${path}`, 'calendar-agenda', 'Agenda des événements', 'Parcourez les repères datés, ouvrez leur détail et replanifiez ceux qui le permettent.', loadCalendarPage),
    // Le calendrier BPM porte ses sources dans le dépliant « Sources et affichage » de sa page (`/calendrier-budget#sources-et-affichage`).
    ...(calendar === 'budgetPatrimoine' ? [] : [
      view(`${path}/sources`, `/${path}`, 'calendar-sources', 'Sources et affichage', 'Choisissez les sources et les informations utiles dans ce calendrier.', loadCalendarPage),
    ]),
  ]),
];

export function matchWorkspace(path: string): { workspace: WorkspaceDestination; params: Record<string, string> } | null {
  const segments = path.split(/[?#]/)[0].split('/').filter(Boolean);
  for (const workspace of PAGE_WORKSPACES) {
    const pattern = workspace.path.split('/');
    if (segments.length !== pattern.length) continue;
    const params: Record<string, string> = {};
    if (pattern.every((part, index) => {
      if (!part.startsWith(':')) return segments[index] === part;
      try { params[part.slice(1)] = decodeURIComponent(segments[index]); return true; } catch { return false; }
    })) return { workspace, params };
  }
  return null;
}
