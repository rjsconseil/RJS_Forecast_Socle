import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, toApiError } from '../../../core/api.service';
import { hours, shortDate } from '../../../core/format';
import type { TaskStatus, TaskView } from '../../../core/models';
import { BpmPageContext, BpmRefresh, bpmLoader } from '../../../bpm/ui';
import { astraSectionHome, astraUrl } from '../../../astra/astra-parts';
import { SectionHome, type SectionAlone, type SectionIndicator } from '../../../platform/section-home';
import type { SectionKey } from '../../../platform/sections';
import { sourceLink } from '../../../platform/source-link';
import { BOARD_COLUMNS, board, localToday, portfolio, PRIORITY_LABEL, timeline, totals, type Health } from '../fonctions/portfolio';

type View = 'portefeuille' | 'tableau' | 'planning';
const VIEWS: { id: View; label: string }[] = [
  { id: 'portefeuille', label: 'Portefeuille' },
  { id: 'tableau', label: 'Tableau des tâches' },
  { id: 'planning', label: 'Planning' },
];

/**
 * Mes projets · Pilotage : l'accueil autonome de la section, utilisable par quelqu'un qui ne se sert de
 * rien d'autre dans le site. Trois vues sur les mêmes données du noyau (projets et tâches) : portefeuille (santé de
 * chaque projet), tableau des tâches par état, planning dans le temps. Aucune donnée nouvelle, aucun impact socle :
 * les gestes appellent les commandes existantes du noyau ; le financement reste dans la fiche du projet.
 */
@Component({
  selector: 'projets-pilotage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, SectionHome],
  providers: [BpmPageContext],
  templateUrl: './pilotage.page.html',
  styleUrl: './pilotage.page.scss',
})
export class ProjetsPilotagePage {
  protected readonly ctx = inject(BpmPageContext);
  private readonly api = inject(Api);
  private readonly refresh = inject(BpmRefresh);

  protected readonly today = localToday();
  protected readonly views = VIEWS;
  protected readonly columns = BOARD_COLUMNS;
  protected readonly priorityLabel = PRIORITY_LABEL;
  protected readonly hours = hours;
  protected readonly shortDate = shortDate;
  protected readonly sectionLink = (key: SectionKey) => astraSectionHome(key);
  protected readonly newProject = { link: astraUrl('projets'), query: { editProject: 'new' } };
  protected readonly newTask = { link: astraUrl('taches'), query: { editTask: 'new' } };

  protected readonly data = bpmLoader(() => 0, async () => {
    const [projects, tasks] = await Promise.all([this.api.projects(), this.api.tasks()]);
    return { projects, tasks };
  });

  protected readonly view = computed<View>(() => {
    const v = this.ctx.query().get('vue');
    return VIEWS.some((x) => x.id === v) ? (v as View) : 'portefeuille';
  });
  protected readonly projectFilter = this.ctx.q('projet');
  protected readonly search = this.ctx.q('q');
  protected readonly onlyLate = computed(() => this.ctx.query().get('retard') === '1');

  protected readonly rows = computed(() => {
    const d = this.data.data();
    return d ? portfolio(d.projects, d.tasks, this.today) : [];
  });
  private readonly workIds = computed(() => new Set(this.rows().map((r) => r.id)));
  protected readonly totals = computed(() => totals(this.rows(), this.data.data()?.tasks ?? [], this.today));
  protected readonly board = computed(() => board(this.data.data()?.tasks ?? [], this.workIds(),
    { projectId: this.projectFilter() || null, query: this.search(), onlyLate: this.onlyLate() }, this.today));
  protected readonly plan = computed(() => timeline(this.rows(), this.data.data()?.tasks ?? [], this.today));

  protected readonly indicators = computed<SectionIndicator[]>(() => {
    const t = this.totals();
    return [
      { label: 'Projets en cours', value: String(t.activeCount), note: t.doneCount ? `${t.doneCount} terminé${t.doneCount > 1 ? 's' : ''}` : undefined },
      { label: 'Projets en retard', value: String(t.lateCount), tone: t.lateCount ? 'danger' : 'success', note: t.watchCount ? `${t.watchCount} à surveiller` : undefined },
      { label: 'Tâches ouvertes', value: String(t.openTaskCount), note: `${t.dueThisWeek} à échéance sous 7 jours`, tone: t.lateTaskCount ? 'warning' : 'neutral' },
      { label: 'Avancement moyen', value: t.averageCompletion === null ? '—' : t.averageCompletion + ' %', note: 'des projets en cours' },
      { label: 'Temps passé', value: hours(t.spentHours), note: `sur ${hours(t.plannedHours)} prévues` },
    ];
  });

  /** Section seule : sans projet, on commence ici ; sans financement, tout fonctionne quand même. */
  protected readonly alone = computed<SectionAlone | null>(() => {
    if (!this.data.data()) return null;
    const t = this.totals();
    if (!t.projectCount) return { title: 'Aucun projet pour l’instant.', detail: 'Créez votre premier projet : ses tâches, ses dates et son suivi se gèrent ici, sans budget ni cycle.', action: { label: 'Créer un projet', ...this.newProject } };
    return null;
  });

  protected readonly projectOptions = computed(() => this.rows().map((r) => ({ id: r.id, title: r.title })));
  protected readonly busy = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  protected setView(v: View) { this.ctx.setQuery({ vue: v === 'portefeuille' ? null : v }); }
  protected setProject(id: string) { this.ctx.setQuery({ projet: id || null }); }
  protected setSearch(q: string) { this.ctx.setQuery({ q: q || null }, { replace: true }); }
  protected toggleLate() { this.ctx.setQuery({ retard: this.onlyLate() ? null : '1' }); }

  protected projectLink(id: string) { return sourceLink('coreProject', id)?.link ?? astraUrl('projets'); }
  protected taskLink(t: TaskView) { return sourceLink('task', { id: t.task.id, projectId: t.task.projectId })?.link ?? astraUrl('taches'); }
  protected healthTone(h: Health) { return h === 'late' ? 'danger' : h === 'watch' ? 'warning' : h === 'done' || h === 'ok' ? 'success' : 'neutral'; }
  protected neighbours(status: TaskStatus) { return BOARD_COLUMNS.filter((c) => c.id !== status); }

  /** Changer l'état d'une tâche : la commande du noyau, avec la révision lue (mêmes règles, mêmes refus). */
  protected async move(t: TaskView, status: TaskStatus) {
    if (this.busy()) return;
    this.busy.set(t.task.id);
    this.failure.set(null);
    try {
      await this.api.changeTaskStatus(t.task.id, status, t.task.revision);
      this.refresh.bump();
    } catch (err) {
      this.failure.set(toApiError(err).message);
    } finally {
      this.busy.set(null);
    }
  }
}
