import { Route } from '@angular/router';
import { PageWorkspace } from './page-workspace';
import { loadCalendarPage } from '../calendar/calendar.route';
import { subpage } from '../platform/application';
import { APPLICATIONS, loadUserCreation } from '../platform/applications';

export interface WorkspaceDestination extends PageWorkspace {
  path: string;
  label: string;
  existing?: boolean;
  /** Hors du menu et des onglets : la vue s'ouvre par un bouton ou un geste, pas comme une destination à part. */
  menu?: false;
  /** Navigation system v2 : la route est une page du plan (niveau 2), pas une sous-page de `parent`. */
  page?: true;
  /** Libellé court de l'onglet quand le bandeau rappelle déjà l'objet ouvert. */
  tabLabel?: string;
  loadComponent?: Route['loadComponent'];
}
const view = subpage;

/** Un seul catalogue pour les routes, la profondeur du menu et le contexte des bandeaux. */
export const PAGE_WORKSPACES: WorkspaceDestination[] = [
  ...APPLICATIONS.flatMap((application) => application.workspaces ?? []),
  view('projects/new', '/projects', 'core-project-create', 'Créer un projet', 'Définissez le but et les dates du nouveau projet.', undefined, true),
  view('projects/planning', '/projects', 'project-planning', 'Planifier les projets', 'Examinez les projets dans le créneau de dates qui vous intéresse.', () => import('../projects/projects-board').then(m => m.ProjectsBoard)),
  view('tasks/new', '/tasks', 'core-task-create', 'Créer une tâche', 'Précisez le travail et son rattachement au projet.', undefined, true),
  view('tasks/sans-projet', '/tasks', 'core-unassigned', 'Tâches sans projet', 'Retrouvez les tâches préparées séparément puis rattachez-les à un projet.', () => import('../tasks/tasks-board').then(m => m.TasksBoard)),
  view('socle/budget/operations', '/socle/budget', 'budget-operations', 'Opérations du budget', 'Éprouvez la création, le règlement et la lecture des opérations du budget choisi.', () => import('../middleware/budget-test').then(m => m.BudgetTest)),
  view('socle/budget/centres', '/socle/budget', 'budget-centers', 'Centres de coûts', 'Examinez et préparez les centres de coûts du budget choisi.', () => import('../middleware/budget-test').then(m => m.BudgetTest)),
  view('socle/patrimoine/reglages', '/socle/patrimoine', 'patrimoine-settings', 'Régler le patrimoine', 'Éprouvez le stock d’ouverture, sa date et l’objectif du patrimoine.', () => import('../middleware/patrimoine-test').then(m => m.PatrimoineTest)),
  view('socle/patrimoine/capitalisations', '/socle/patrimoine', 'patrimoine-capitalizations', 'Capitalisations enregistrées', 'Relisez les résultats de clôture qui ont alimenté le patrimoine.', () => import('../middleware/patrimoine-test').then(m => m.PatrimoineTest)),
  view('utilisateurs/nouveau', '/utilisateurs', 'users-new', 'Créer un utilisateur', 'Créez le profil et sa composition Budget/Patrimoine dans un même parcours.', loadUserCreation),
  view('admin/calendriers', '/admin', 'admin-calendars', 'Calendriers · Sources et affichage', 'Configurez les sources et les commandes de chaque instance du calendrier partagé.', () => import('../admin/admin').then(m => m.AdminPage)),
  view('admin/parametres', '/admin', 'admin-parameters', 'Paramètres effectifs', 'Choisissez un paramètre, relisez sa valeur et enregistrez un réglage.', () => import('../admin/admin').then(m => m.AdminPage)),
  view('admin/journal', '/admin', 'admin-journal', 'Journal d’activité', 'Retrouvez les commandes exécutées et leur résultat.', () => import('../admin/admin').then(m => m.AdminPage)),
  view('admin/controles', '/admin', 'admin-errors', 'Erreurs et contrôles', 'Examinez les erreurs récentes et les contrôles d’administration.', () => import('../admin/admin').then(m => m.AdminPage)),
  view('admin/calculs/references', '/admin/calculs', 'metric-references', 'Références des calculs', 'Retrouvez les variables et les métriques disponibles pour préparer une formule.', () => import('../admin/metrics').then(m => m.AdminMetrics)),
  view('object-management/relations', '/object-management', 'objects-relations', 'Relations entre objets', 'Parcourez les références entrantes et sortantes des objets du périmètre choisi.', () => import('../object-management/object-management').then(m => m.ObjectManagement)),
  view('object-management/controles', '/object-management', 'objects-checks', 'Contrôles des objets', 'Examinez les références et les contrôles d’intégrité sans modifier les objets.', () => import('../object-management/object-management').then(m => m.ObjectManagement)),
  view('object-management/journal', '/object-management', 'objects-journal', 'Journal des objets', 'Retracez les commandes et les révisions des objets du périmètre choisi.', () => import('../object-management/object-management').then(m => m.ObjectManagement)),
  ...[
    ['calendrier', 'noyau', 'Calendrier du travail'],
    ['patrimoine/calendrier', 'patrimoine', 'Calendrier du patrimoine'],
  ].flatMap(([path]) => [
    view(`${path}/agenda`, `/${path}`, 'calendar-agenda', 'Agenda des événements', 'Parcourez les repères datés, ouvrez leur détail et replanifiez ceux qui le permettent.', loadCalendarPage),
    view(`${path}/sources`, `/${path}`, 'calendar-sources', 'Sources et affichage', 'Choisissez les sources et les informations utiles dans ce calendrier.', loadCalendarPage),
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
