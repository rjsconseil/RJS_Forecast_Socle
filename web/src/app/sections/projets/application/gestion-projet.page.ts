import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  Api, toApiError, sourceLink,
  type Priority, type ProjectSummary, type TaskStatus, type TaskView,
} from '../../../platform/grand-noyau';
import { BpmPageContext, BpmRefresh, bpmLoader, astraUrl } from '../../../astra/cadre';
import { BOARD_COLUMNS, board, isWorkProject, localToday, portfolio, totals, type Health } from '../fonctionnalites/portfolio';
import { APPLICATION, COLLECTIONS, dossiersParProjet } from '../fonctionnalites/dossiers';
import { registreDuTheme, registresDepuis, type ModeleCollections } from '../fonctionnalites/registres';
import donnees from './donnees.json';

/** Les registres PRINCE2, un par thème, d'après le modèle de données de l'application. */
const REGISTRES = registresDepuis(donnees.collections as unknown as ModeleCollections);
import { ProjetsRegistre } from './registre-projet';
import { HEALTH, PRIORITY, PROJECT_STATUS, TASK_STATUS, dateEn, hoursEn, plural } from './libelles';
import { commandeProjet, commandeTache, erreurSaisie, projetsParStatut, tachesDuProjet, tachesSansProjet } from '../fonctionnalites/gestion';
import {
  PRINCE2_THEMES, SEQUENCE, livrable, livrablesDuTheme, processusDuTheme, processusPrince2, reperePrince2, themePrince2,
  type Livrable, type LivrableId,
} from '../fonctionnalites/prince2';

type Panneau = 'projet' | 'tache' | null;

/**
 * Application autonome Mes projets · gestion de projet selon PRINCE2 (premier jet).
 * Un accueil de gestion de projet (état des lieux des projets et de leurs tâches, vues par état, création de projets et
 * de tâches seules, rattachement d'une ou plusieurs tâches à un projet), puis une page par thème PRINCE2 (but,
 * processus associés, livrables, séquence). Tout passe par le grand noyau : mêmes commandes, mêmes règles ; l'état
 * d'un projet suit toujours celui de ses tâches. Le référentiel PRINCE2 vit dans les fonctionnalités de la section.
 */
@Component({
  selector: 'projets-gestion-projet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ProjetsRegistre],
  providers: [BpmPageContext],
  templateUrl: './gestion-projet.page.html',
  styleUrl: './gestion-projet.page.scss',
})
export class ProjetsGestionProjetPage {
  protected readonly ctx = inject(BpmPageContext);
  private readonly api = inject(Api);
  private readonly refresh = inject(BpmRefresh);

  protected readonly today = localToday();
  protected readonly hours = hoursEn;
  protected readonly date = dateEn;
  protected readonly plural = plural;
  protected readonly projectStatus = PROJECT_STATUS;
  protected readonly taskStatus = TASK_STATUS;
  protected readonly healthLabel = HEALTH;
  protected readonly priorityLabel = PRIORITY;
  protected readonly themes = PRINCE2_THEMES;
  protected readonly sequence = SEQUENCE.filter((id) => id !== 'DP').map(processusPrince2);
  protected readonly diriger = processusPrince2('DP');
  protected readonly columns = BOARD_COLUMNS.map((c) => ({ id: c.id, label: TASK_STATUS[c.id] }));
  protected readonly priorities: { id: Priority; label: string }[] = (['high', 'medium', 'low'] as const).map((id) => ({ id, label: PRIORITY[id] }));

  protected readonly data = bpmLoader(() => 0, async () => {
    const [projects, tasks, dossiers, livrables] = await Promise.all([
      this.api.projects(), this.api.tasks(),
      // Données propres à l'application (tables AA_MP_…) : dossiers PRINCE2 et produits de management.
      this.api.aaList(APPLICATION, COLLECTIONS.dossiers), this.api.aaList(APPLICATION, COLLECTIONS.livrables),
    ]);
    return { projects, tasks, dossiers: dossiersParProjet(dossiers.items, livrables.items) };
  });

  // ---------- navigation de l'application : l'accueil, puis un thème ----------
  protected readonly theme = computed(() => themePrince2(this.ctx.q('theme')()));
  protected readonly themeIndex = computed(() => PRINCE2_THEMES.findIndex((t) => t.id === this.theme()?.id));
  protected readonly previous = computed(() => PRINCE2_THEMES[this.themeIndex() - 1] ?? null);
  protected readonly next = computed(() => PRINCE2_THEMES[this.themeIndex() + 1] ?? null);
  protected readonly themeProcessus = computed(() => (this.theme() ? processusDuTheme(this.theme()!.id) : []));
  protected readonly themeLivrables = computed(() => (this.theme() ? livrablesDuTheme(this.theme()!.id) : []));
  protected readonly themeProcessusIds = computed(() => new Set(this.themeProcessus().map((p) => p.processus.id)));
  /** Le registre PRINCE2 du thème ouvert, et les projets qui ont leur dossier (ceux qui ont des registres). */
  protected readonly registre = computed(() => registreDuTheme(REGISTRES, this.theme()?.id));
  protected readonly projetsAvecDossier = computed(() => this.rows().filter((r) => r.dossier).map((r) => ({ id: r.id, title: r.title })));
  protected livrableNom(id: LivrableId) { return livrable(id).nom; }
  protected isThemeLivrable(list: Livrable[], id: LivrableId) { return list.some((l) => l.id === id); }

  // ---------- état des lieux ----------
  private readonly work = computed(() => (this.data.data()?.projects ?? []).filter(isWorkProject));
  protected readonly rows = computed(() => {
    const d = this.data.data();
    if (!d) return [];
    const byId = new Map(this.work().map((p) => [p.project.id, p]));
    return portfolio(d.projects, d.tasks, this.today).map((r) => {
      const p = byId.get(r.id)!;
      return { ...r, status: p.view.status, repere: reperePrince2({ status: p.view.status, taskCount: r.taskCount }), dossier: d.dossiers.get(r.id) ?? null };
    });
  });
  protected readonly totals = computed(() => totals(this.rows(), this.data.data()?.tasks ?? [], this.today));
  protected readonly orphans = computed(() => tachesSansProjet(this.data.data()?.tasks ?? []));
  protected readonly byStatus = computed(() => projetsParStatut(this.data.data()?.projects ?? []));
  protected readonly board = computed(() => board(this.data.data()?.tasks ?? [], new Set(this.rows().map((r) => r.id)), {}, this.today));
  /** Combien de projets se trouvent à chaque étape de la séquence (repère indicatif). */
  protected readonly atStep = computed(() => {
    const count = new Map<string, number>();
    for (const r of this.rows()) if (r.repere.processus) count.set(r.repere.processus, (count.get(r.repere.processus) ?? 0) + 1);
    return count;
  });
  protected readonly closedCount = computed(() => this.rows().filter((r) => !r.repere.processus).length);

  // ---------- création et rattachement ----------
  /** Saisie ouverte ; `?saisie=projet` ou `?saisie=tache` l'ouvre à l'arrivée (gestes de la palette et des onglets). */
  protected readonly panneau = signal<Panneau>(((s) => (s === 'projet' || s === 'tache' ? s : null))(this.ctx.query().get('saisie')));
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly target = signal('');
  protected readonly picked = signal<ReadonlySet<string>>(new Set());
  protected readonly targetTasks = computed(() => (this.target() ? tachesDuProjet(this.data.data()?.tasks ?? [], this.target()) : []));
  protected readonly targetTitle = computed(() => this.rows().find((r) => r.id === this.target())?.title ?? '');

  /** Ouvrir ou fermer une saisie ; depuis un thème, elle s'ouvre sur l'accueil. */
  protected toggle(p: Exclude<Panneau, null>) {
    const open = this.panneau() !== p || !!this.theme();
    if (this.theme()) this.ctx.setQuery({ theme: null });
    this.panneau.set(open ? p : null);
    this.failure.set(null);
  }
  protected pick(id: string, on: boolean) {
    const next = new Set(this.picked());
    if (on) next.add(id); else next.delete(id);
    this.picked.set(next);
  }

  private async run(action: () => Promise<unknown>, done: string) {
    if (this.busy()) return false;
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      await action();
      this.notice.set(done);
      this.refresh.bump();
      return true;
    } catch (err) {
      this.failure.set(toApiError(err).message);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async createProject(form: HTMLFormElement) {
    const f = new FormData(form);
    const saisie = { title: String(f.get('title') ?? ''), description: String(f.get('description') ?? ''), priority: (f.get('priority') || 'medium') as Priority, startDate: String(f.get('startDate') ?? ''), dueDate: String(f.get('dueDate') ?? '') };
    const error = erreurSaisie(saisie);
    if (error) { this.failure.set(error); return; }
    if (await this.run(() => this.api.createProject(commandeProjet(saisie)), `Project “${saisie.title.trim()}” created.`)) { form.reset(); this.panneau.set(null); }
  }

  protected async createTask(form: HTMLFormElement) {
    const f = new FormData(form);
    const saisie = { title: String(f.get('title') ?? ''), projectId: String(f.get('projectId') ?? ''), plannedHours: String(f.get('plannedHours') ?? ''), dueDate: String(f.get('dueDate') ?? '') };
    const error = erreurSaisie(saisie);
    if (error) { this.failure.set(error); return; }
    if (await this.run(() => this.api.createTask(commandeTache(saisie)), `Task “${saisie.title.trim()}” created${saisie.projectId ? ' and linked to its project' : ' without a project'}.`)) { form.reset(); this.panneau.set(null); }
  }

  /** Rattacher les tâches cochées au projet choisi : une commande du grand noyau par tâche. */
  protected async attachPicked() {
    const projectId = this.target();
    const chosen = this.orphans().filter((t) => this.picked().has(t.task.id));
    if (!projectId || !chosen.length) return;
    const ok = await this.run(async () => {
      for (const t of chosen) await this.api.attachTask(t.task.id, projectId, t.task.revision);
    }, `${plural(chosen.length, 'task')} linked to “${this.targetTitle()}”.`);
    if (ok) this.picked.set(new Set());
  }

  /**
   * Ouvrir le dossier PRINCE2 d'un projet du noyau : le dossier, puis les lignes prévues par le catalogue à sa création
   * (rôles attendus, séquence d'initialisation, produits de management du démarrage et de l'initialisation).
   */
  protected openDossier(projectId: string, title: string, processus: string | null) {
    return this.run(async () => {
      await this.api.aaCreate(APPLICATION, COLLECTIONS.dossiers, { projectId, processusCourant: processus ?? 'SU' });
      await this.api.aaInstancier(APPLICATION, { declencheur: 'creation-dossier', projectId });
    }, `PRINCE2 project file opened for “${title}”: roles, initiation stage and management products are set up.`);
  }

  protected detach(t: TaskView) {
    return this.run(() => this.api.detachTask(t.task.id, t.task.revision), `“${t.task.title}” is no longer linked to a project.`);
  }

  protected move(t: TaskView, status: TaskStatus) {
    return this.run(() => this.api.changeTaskStatus(t.task.id, status, t.task.revision), `“${t.task.title}” moved to ${TASK_STATUS[status].toLowerCase()}.`);
  }

  // ---------- liens vers les fiches du grand noyau ----------
  protected projectLink(id: string) { return sourceLink('coreProject', id)?.link ?? astraUrl('projets'); }
  protected taskLink(t: TaskView) { return sourceLink('task', { id: t.task.id, projectId: t.task.projectId })?.link ?? astraUrl('taches'); }
  protected projectStatusLink(p: ProjectSummary) { return this.projectLink(p.project.id); }
  protected healthTone(h: Health) { return h === 'late' ? 'danger' : h === 'watch' ? 'warning' : h === 'done' || h === 'ok' ? 'success' : 'neutral'; }
  protected neighbours(status: TaskStatus) { return BOARD_COLUMNS.filter((c) => c.id !== status).map((c) => ({ id: c.id, label: TASK_STATUS[c.id] })); }
  protected daysLabel(days: number) { return days < 0 ? `${plural(-days, 'day')} overdue` : days === 0 ? 'due today' : `in ${plural(days, 'day')}`; }
}
