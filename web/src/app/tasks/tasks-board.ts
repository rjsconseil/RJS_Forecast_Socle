import { injectPageWorkspace } from '../plan/page-workspace';
import { PageHeroDirective } from '../shared/page-hero.directive';
import { Component, computed, HostListener, inject, OnInit, signal } from '@angular/core';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDragStart, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, toApiError } from '../core/api.service';
import { COLUMNS, TASK_STATUS_LABEL, TaskStatus, TaskView } from '../core/models';
import { HoursPipe } from '../core/format';
import {
  displayDate,
  dueTitle,
  dueUrgency,
  FilterOption,
  ItemBoardToolsComponent,
  ItemSummaryComponent,
  normalizeSearch,
} from '../projects/workspace-parts';

/**
 * Tâches du noyau sur le gabarit de la référence (`section-home.page.ts` en mode tâche, `item-board`).
 * Le déplacement passe par la poignée ⠿ (CDK) ou par le sélecteur « Déplacer vers » : un seul chemin
 * d'écriture, `changeTaskStatus`, avec la version lue au moment du geste.
 * Filtres gardés dans l'URL : `project` (identifiant, ou `unassigned` pour les tâches sans projet) et `q`.
 */
@Component({
  selector: 'app-tasks-board',
  imports: [PageHeroDirective, RouterLink, HoursPipe, CdkDropListGroup, CdkDropList, CdkDrag, CdkDragHandle, ItemSummaryComponent, ItemBoardToolsComponent],
  template: `
    <div class="page page-wide landing-page section-home">
      <div class="section-home-top section-home-top-task" rjsPageHero #pageHero="pageHero" data-ui-pattern="heading">
        <header class="section-home-hero">
          <div class="section-home-banner">
            <p class="eyebrow"><span class="eyebrow-line"></span>Tâches</p>
            <h1 class="display">{{ workspace()?.title || 'Tâches' }}</h1>
          </div>
        </header>
        <aside class="section-home-task-intro">
          <p class="page-intro">{{ workspace()?.lead || 'Organisez le travail par projet. Les tâches sans projet peuvent être rattachées plus tard.' }}</p>
        </aside>
        <rjs-item-summary
          class="section-home-task-summary"
          kind="task"
          [remaining]="remaining()"
          [counts]="counts()"
          [progress]="progress()"
        />
        <rjs-item-board-tools
          class="section-home-task-tools"
          kind="task"
          [compact]="pageHero.compact()"
          [scope]="toolbarScope()"
          [result]="toolbarResult()"
          createLink="/tasks/new"
          [createQuery]="selectedProjectId() ? { projectId: selectedProjectId()! } : null"
          [createLabel]="selectedProjectId() ? 'Nouvelle tâche dans ce projet' : 'Nouvelle tâche'"
          [filterOptions]="filterOptions()"
          [showFilter]="workspace()?.key !== 'core-unassigned'"
          [filter]="filter()"
          (filterChange)="setFilter({ project: $event === 'all' ? null : $event })"
          [search]="query()"
          (searchChange)="setFilter({ q: $event || null })"
        />
      </div>

      @if (filter() !== 'all' && !loading()) {
        <aside class="task-filter-context" role="status">
          @if (filter() === 'unassigned') {
            <p>
              <strong>Tâches sans projet, toutes dates confondues.</strong>
              Ouvrez « Modifier et rattacher » sur une carte pour choisir un projet existant. Pour créer un nouveau cadre,
              commencez dans Projets puis revenez rattacher vos tâches ici.
            </p>
            <a class="text-link" routerLink="/projects">Créer un projet dans Projets ↗</a>
          } @else if (selectedProjectTitle(); as title) {
            <p>
              <strong>{{ title }}</strong>
              · toutes ses tâches sont affichées. La création d’une tâche utilisera ce projet. Les tâches masquées par le
              filtre comptent toujours dans l'état de leur projet.
            </p>
            <a class="text-link" [routerLink]="['/projects', filter()]">Voir la fiche du projet ↗</a>
          } @else {
            <p>Ce projet n’est plus disponible. Choisissez un autre filtre pour retrouver les tâches.</p>
          }
          @if (workspace()?.key === 'core-unassigned') {
            <a class="text-link" routerLink="/tasks" [queryParams]="{ q: query() || null }">Afficher toutes les tâches →</a>
          } @else {
            <button class="text-link" type="button" (click)="setFilter({ project: null })">
              {{ filter() === 'unassigned' || selectedProjectTitle() ? 'Effacer le filtre' : 'Afficher toutes les tâches' }}
            </button>
          }
        </aside>
      }

      <div class="section-home-board">
        @if (loading()) {
          <div class="empty-state" role="status"><h2>Chargement des tâches…</h2></div>
        } @else if (loadError() && !tasks().length) {
          <div class="empty-state" role="alert">
            <h2>Tâches indisponibles</h2>
            <p>{{ loadError() }}</p>
            <button class="btn btn-secondary" type="button" (click)="load()">Réessayer</button>
          </div>
        } @else {
          @if (query().trim()) {
            <p class="board-result-count" role="status">
              {{ visible().length }} résultat(s) pour « {{ query().trim() }} » dans le filtre courant.
            </p>
          }
          <p class="board-move-help" id="tasks-board-move-help">
            Glissez une tâche par sa poignée ⠿ jusqu’au statut choisi, ou utilisez « Déplacer vers » : même commande,
            mêmes contrôles. Échap annule un glissement en cours.
          </p>
          <p
            class="board-move-feedback"
            [class.is-error]="notice()?.error"
            [attr.role]="notice()?.error ? 'alert' : 'status'"
            aria-live="polite"
          >{{ notice()?.text }}</p>
          <section
            class="board"
            cdkDropListGroup
            aria-label="Tableau des tâches"
            aria-describedby="tasks-board-move-help"
            [class.has-task-move]="dragActive()"
            [attr.aria-busy]="pending().size > 0"
          >
            @for (col of columns; track col.id) {
              <div
                class="board-column"
                [attr.data-column]="col.id"
                [attr.data-task-drop]="col.id"
                [class.is-drop-target]="dropTarget() === col.id"
                cdkDropList
                [cdkDropListData]="col.id"
                (cdkDropListEntered)="dropTarget.set(col.id)"
                (cdkDropListExited)="dropTarget.set(null)"
                (cdkDropListDropped)="dropped($event)"
              >
                <div class="board-column-head">
                  <div>
                    <span class="status-dot" [attr.data-status]="col.id"></span>
                    <h3 class="status-heading">{{ col.label }}</h3>
                  </div>
                  @if (col.id !== 'done') {
                    <span class="count-badge">{{ byColumn()[col.id].length }}</span>
                  }
                </div>
                <div class="board-column-content">
                  @for (t of byColumn()[col.id]; track t.task.id) {
                    @let done = t.task.status === 'done';
                    <article
                      class="card task-card"
                      [attr.data-urgency]="urgency(t.task.dueDate, done)"
                      [class.is-moving]="pending().has(t.task.id)"
                      cdkDrag
                      [cdkDragData]="t"
                      [cdkDragStartDelay]="{ touch: 300, mouse: 0 }"
                      [cdkDragDisabled]="pending().has(t.task.id)"
                      (cdkDragStarted)="started($event)"
                    >
                      <h4>
                        <span class="grip" cdkDragHandle title="Glisser pour changer de statut" aria-hidden="true">⠿</span>
                        <a class="task-title-link" [routerLink]="['/tasks', t.task.id, 'edit']" [attr.title]="t.task.title">{{
                          t.task.title
                        }}</a>
                      </h4>
                      <p class="task-card-description" [attr.title]="t.task.description || null">{{ t.task.description }}</p>
                      <div class="task-card-follow-up">
                        @if (t.task.startDate) {
                          <span [attr.title]="'Date prévue · ' + date(t.task.startDate)">Date prévue · {{ date(t.task.startDate) }}</span>
                        }
                        <p><strong>Prévu</strong> {{ t.task.plannedHours | hours }}</p>
                        <p><strong>Consommé</strong> {{ t.task.spentHours | hours }}</p>
                      </div>
                      <div class="task-card-meta">
                        @if (t.task.projectId) {
                          <a
                            class="task-card-badge"
                            [routerLink]="['/projects', t.task.projectId]"
                            [attr.title]="'Projet ' + t.projectTitle"
                            [attr.aria-label]="'Projet ' + t.projectTitle"
                            >{{ t.projectTitle }} ↗</a
                          >
                        } @else {
                          <span>Sans projet</span>
                        }
                        <span
                          class="due-date"
                          [attr.data-urgency]="urgency(t.task.dueDate, done)"
                          [attr.title]="dueTitle(t.task.dueDate, done)"
                          >{{ t.task.dueDate ? date(t.task.dueDate) : 'Sans échéance' }}</span
                        >
                        @if (t.qualification.code === 'budgetedProjectTask') {
                          <span class="task-card-badge" [attr.title]="t.qualification.label">{{ t.qualification.label }}</span>
                        }
                      </div>
                      <label class="status-change"
                        >Déplacer vers
                        <select [disabled]="pending().has(t.task.id)" (change)="changeStatus(t, $any($event.target).value)">
                          @for (c of columns; track c.id) {
                            <option [value]="c.id" [selected]="c.id === t.task.status">{{ c.label }}</option>
                          }
                        </select>
                      </label>
                      <a class="text-link task-card-edit" [routerLink]="['/tasks', t.task.id, 'edit']">{{
                        t.task.projectId ? 'Modifier la tâche' : 'Modifier et rattacher'
                      }}</a>
                      @if (pending().has(t.task.id)) {
                        <small class="field-hint" role="status">Enregistrement…</small>
                      }
                    </article>
                  } @empty {
                    <div class="board-empty">Aucune tâche ici</div>
                  }
                </div>
              </div>
            }
          </section>
        }
        <nav class="board-nav" aria-label="Changer de section">
          <a routerLink="/projects" class="text-link">Parcourir les projets <span aria-hidden="true">↗</span></a>
        </nav>
      </div>
    </div>
  `,
})
export class TasksBoard implements OnInit {
  protected readonly workspace = injectPageWorkspace();
  private api = inject(Api);
  protected columns = COLUMNS;
  protected readonly date = displayDate;
  protected readonly urgency = dueUrgency;
  protected readonly dueTitle = dueTitle;
  protected tasks = signal<TaskView[]>([]);
  protected loading = signal(true);
  protected loadError = signal<string | null>(null);
  protected pending = signal(new Set<string>());
  protected notice = signal<{ text: string; error: boolean } | null>(null);
  protected dragActive = signal(false);
  /** Colonne survolée pendant un glissement : même halo que la cible de la référence (`is-drop-target`). */
  protected dropTarget = signal<TaskStatus | null>(null);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  /** Filtres gardés dans l'URL (`project`, `q`) comme dans la référence. `__none` reste accepté (anciens liens). */
  protected query = computed(() => this.params().get('q') ?? '');
  protected filter = computed(() => {
    if (this.workspace()?.key === 'core-unassigned') return 'unassigned';
    const value = this.params().get('project');
    return !value ? 'all' : value === '__none' ? 'unassigned' : value;
  });
  protected selectedProjectId = computed(() => (this.filter() === 'all' || this.filter() === 'unassigned' ? null : this.filter()));
  private dragCancelled = false;
  private dragging = false;

  protected visible = computed(() => {
    const q = normalizeSearch(this.query().trim());
    const f = this.filter();
    return this.tasks().filter(
      (t) =>
        (!q || normalizeSearch(`${t.task.title} ${t.task.description} ${t.task.id}`).includes(q)) &&
        (f === 'all' || (f === 'unassigned' ? t.task.projectId === null : t.task.projectId === f)),
    );
  });
  private readonly summaryTasks = computed(() => this.workspace()?.key === 'core-unassigned'
    ? this.tasks().filter((t) => !t.task.projectId) : this.tasks());
  protected remaining = computed(() => this.summaryTasks().filter((t) => t.task.status !== 'done').length);
  protected progress = computed(() => (this.summaryTasks().length ? Math.round((100 * this.countAll('done')) / this.summaryTasks().length) : 0));
  protected counts = computed(() => Object.fromEntries(COLUMNS.map((c) => [c.id, this.countAll(c.id)])) as Record<TaskStatus, number>);
  protected countAll(status: TaskStatus) {
    return this.summaryTasks().filter((t) => t.task.status === status).length;
  }
  protected setFilter(patch: { project?: string | null; q?: string | null }) {
    this.router.navigate([], { queryParams: patch, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected byColumn = computed(() => {
    const groups = Object.fromEntries(COLUMNS.map((c) => [c.id, [] as TaskView[]])) as Record<TaskStatus, TaskView[]>;
    for (const t of this.visible()) groups[t.task.status].push(t);
    return groups;
  });

  /** Titres des projets connus (liste des projets, complétée par les tâches lues). */
  private projectTitles = signal(new Map<string, string>());
  /** Projets du sélecteur « Afficher les tâches », avec leur nombre de tâches. */
  private projectCounts = computed(() => {
    const seen = new Map<string, { title: string; count: number }>();
    for (const [id, title] of this.projectTitles()) seen.set(id, { title, count: 0 });
    for (const t of this.tasks()) {
      if (!t.task.projectId) continue;
      const entry = seen.get(t.task.projectId) ?? { title: t.projectTitle ?? t.task.projectId, count: 0 };
      entry.count += 1;
      seen.set(t.task.projectId, entry);
    }
    return seen;
  });
  protected toolbarScope = computed(() => {
    const project = this.filter() === 'unassigned' ? 'Tâches sans projet' : this.selectedProjectTitle() || 'Tous les projets';
    return `Sélection · ${project} · ${this.visible().length} / ${this.summaryTasks().length} tâche(s)`;
  });
  protected toolbarResult = computed(() => {
    const notice = this.notice();
    return notice ? { message: notice.text, tone: notice.error ? 'danger' as const : 'success' as const } : null;
  });
  protected selectedProjectTitle = computed(() => {
    const id = this.selectedProjectId();
    return id ? (this.projectCounts().get(id)?.title ?? null) : null;
  });
  protected filterOptions = computed<FilterOption[]>(() => [
    { value: 'all', label: `Toutes les tâches (${this.tasks().length})` },
    { value: 'unassigned', label: `Toutes les tâches sans projet (${this.tasks().filter((t) => !t.task.projectId).length})` },
    ...[...this.projectCounts()].map(([id, p]) => ({ value: id, label: `${p.title} (${p.count})` })),
  ]);

  ngOnInit() {
    this.load();
    this.loadProjectTitles();
  }

  /** Lecture complémentaire : un projet sans tâche reste proposé dans le filtre. Un échec n'empêche pas le tableau. */
  private async loadProjectTitles() {
    try {
      const projects = await this.api.projects();
      this.projectTitles.set(new Map(projects.map((p) => [p.project.id, p.project.title])));
    } catch {
      // Le filtre se replie sur les projets présents dans les tâches lues.
    }
  }

  async load() {
    try {
      this.tasks.set(await this.api.tasks());
      this.loadError.set(null);
    } catch (err) {
      const message = toApiError(err).message;
      this.loadError.set(message);
      this.notice.set({ text: message, error: true });
    } finally {
      this.loading.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  cancelDrag() {
    if (!this.dragging) return;
    this.dragCancelled = true;
    this.notice.set({ text: 'Déplacement annulé : la tâche ne sera pas modifiée.', error: false });
  }

  started(_: CdkDragStart) {
    this.dragging = true;
    this.dragActive.set(true);
    this.dragCancelled = false;
  }

  dropped(e: CdkDragDrop<TaskStatus, TaskStatus, TaskView>) {
    this.dragging = false;
    this.dragActive.set(false);
    this.dropTarget.set(null);
    const cancelled = this.dragCancelled;
    this.dragCancelled = false;
    // Même colonne, annulation ou sortie des cibles : aucune écriture métier.
    if (cancelled || e.previousContainer === e.container || !e.isPointerOverContainer) return;
    this.changeStatus(e.item.data, e.container.data);
  }

  /** Seul chemin d'écriture : changeTaskStatus, avec la version lue au moment du geste. */
  async changeStatus(t: TaskView, status: TaskStatus) {
    if (t.task.status === status || this.pending().has(t.task.id)) return;
    this.setPending(t.task.id, true);
    try {
      const r = await this.api.changeTaskStatus(t.task.id, status, t.task.revision);
      this.tasks.update((list) => list.map((x) => (x.task.id === r.task.id ? { task: r.task, projectTitle: r.projectTitle, qualification: r.qualification, pathways: r.pathways } : x)));
      const project = r.affectedProjects?.[0];
      this.notice.set({
        text: `« ${r.task.title} » enregistrée en ${TASK_STATUS_LABEL[r.task.status]}.` + (project ? ` Projet « ${project.project.title} » : ${project.view.statusLabel}.` : ' Tâche autonome : aucun projet modifié.'),
        error: false,
      });
    } catch (err) {
      const e = toApiError(err);
      const text = e.isConflict
        ? 'Conflit : la tâche a été modifiée ailleurs. Le tableau a été relu ; réessayer si besoin.'
        : `Changement d'état non enregistré : ${e.message}`;
      await this.load();
      this.notice.set({ text, error: true });
    } finally {
      this.setPending(t.task.id, false);
    }
  }

  private setPending(id: string, on: boolean) {
    this.pending.update((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
}
