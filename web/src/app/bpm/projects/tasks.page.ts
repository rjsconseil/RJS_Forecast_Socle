import { Component, computed, HostListener, inject, OnInit, signal } from '@angular/core';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmTaskCard, BpmTasksOverview } from '../../core/bpm-projects.models';
import { COLUMNS, TASK_STATUS_LABEL, TaskMutationResult, TaskStatus } from '../../core/models';
import { CentsPipe } from '../../core/format';
import { displayDate, dueTitle, dueUrgency, FilterOption, ItemBoardToolsComponent, ItemSummaryComponent, normalizeSearch } from '../../projects/workspace-parts';

/**
 * Tâches des projets de la vie : réimplémentation, dans Budget/Patrimoine, du tableau des tâches du noyau. Glisser
 * une carte ou « Déplacer vers » appelle la commande du noyau `changeTaskStatus` (l'état du projet suit) ;
 * « Projet » rattache ou détache par les commandes du noyau `attachTask` / `detachTask`. Chaque carte montre la part
 * de budget de la tâche, ses dépenses réglées et son retour éventuel au budget de vie. La création reste dans le noyau.
 */
@Component({
  selector: 'app-bpm-tasks',
  imports: [RouterLink, CentsPipe, CdkDropListGroup, CdkDropList, CdkDrag, CdkDragHandle, ItemSummaryComponent, ItemBoardToolsComponent],
  template: `
    <div class="page page-wide landing-page section-home bpm-projects">
      <div class="section-home-top section-home-top-task">
        <header class="section-home-hero">
          <div class="section-home-banner" data-ui-pattern="heading">
            <p class="eyebrow"><span class="eyebrow-line"></span>Budget/Patrimoine · Projets de la vie</p>
            <h1 class="display">Tâches des projets</h1>
          </div>
        </header>
        <aside class="section-home-task-intro">
          <p class="page-intro">
            Les tâches de votre projet de vie et de ses projets standards, avec leur part de budget. Changer l’état d’une
            tâche fait évoluer celui de son projet ; une tâche se crée dans le noyau.
          </p>
        </aside>
        <rjs-item-summary class="section-home-task-summary" kind="task" [remaining]="remaining()" [counts]="counts()" [progress]="progress()" />
        <rjs-item-board-tools
          class="section-home-task-tools"
          kind="task"
          createLink="/tasks/new"
          [createQuery]="selectedProjectId() ? { projectId: selectedProjectId()! } : null"
          [createLabel]="selectedProjectId() ? 'Créer une tâche de ce projet dans le noyau' : 'Créer une tâche dans le noyau'"
          [filterOptions]="filterOptions()"
          [filter]="filter()"
          (filterChange)="setFilter({ project: $event === 'all' ? null : $event })"
          [search]="query()"
          (searchChange)="setFilter({ q: $event || null })"
        />
      </div>

      <div class="section-home-board">
        @if (loading()) {
          <div class="empty-state" role="status"><h2>Chargement des tâches…</h2></div>
        } @else if (loadError() && !data()) {
          <div class="empty-state" role="alert">
            <h2>Tâches indisponibles</h2>
            <p>{{ loadError() }}</p>
            <button class="btn btn-secondary" type="button" (click)="load()">Réessayer</button>
          </div>
        } @else {
          @if (query().trim()) {
            <p class="board-result-count" role="status">{{ visible().length }} résultat(s) pour « {{ query().trim() }} » dans le filtre courant.</p>
          }
          <p class="board-move-help" id="bpm-tasks-move-help">
            Glissez une tâche par sa poignée ⠿ jusqu’au statut choisi, ou utilisez « Déplacer vers » : même commande du
            noyau, mêmes contrôles. Échap annule un glissement en cours.
          </p>
          <p class="board-move-feedback" [class.is-error]="notice()?.error" [attr.role]="notice()?.error ? 'alert' : 'status'" aria-live="polite">{{ notice()?.text }}</p>
          <section
            class="board"
            cdkDropListGroup
            aria-label="Tableau des tâches des projets de la vie"
            aria-describedby="bpm-tasks-move-help"
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
                      [attr.data-budget-state]="t.budget?.over ? 'deficit' : null"
                      [class.is-moving]="pending().has(t.task.id)"
                      cdkDrag
                      [cdkDragData]="t"
                      [cdkDragStartDelay]="{ touch: 300, mouse: 0 }"
                      [cdkDragDisabled]="pending().has(t.task.id)"
                      (cdkDragStarted)="started()"
                    >
                      <h4>
                        <span class="grip" cdkDragHandle title="Glisser pour changer de statut" aria-hidden="true">⠿</span>
                        <a class="task-title-link" [routerLink]="['/app/projets', t.task.projectId]" [attr.title]="t.task.title">{{ t.task.title }}</a>
                      </h4>
                      <p class="task-card-description" [attr.title]="t.task.description || null">{{ t.task.description }}</p>
                      @if (t.budget; as b) {
                        <div class="bpm-task-budget">
                          @if (b.shareCents !== null) {
                            <span>Part <strong>{{ b.shareCents | cents }}</strong></span>
                          } @else {
                            <span>Sans part de budget</span>
                          }
                          <span [class.is-over]="b.over">Réglé <strong>{{ b.paidCents | cents }}</strong></span>
                          @if (b.engagedCents !== b.paidCents) {
                            <span>Engagé {{ b.engagedCents | cents }}</span>
                          }
                          @if (b.return; as r) {
                            <span [attr.title]="r.label">Retour {{ r.amountCents | cents }} · {{ r.entryId ? 'enregistré' : 'à la complétion' }}</span>
                          }
                        </div>
                      }
                      <div class="task-card-meta">
                        <a class="task-card-badge" [routerLink]="['/app/projets', t.task.projectId]" [attr.title]="'Projet ' + t.projectTitle">{{ t.projectTitle }} ↗</a>
                        <span class="due-date" [attr.data-urgency]="urgency(t.task.dueDate, done)" [attr.title]="dueTitle(t.task.dueDate, done)">{{
                          t.task.dueDate ? date(t.task.dueDate) : 'Sans échéance'
                        }}</span>
                      </div>
                      <label class="status-change"
                        >Déplacer vers
                        <select [disabled]="pending().has(t.task.id)" (change)="changeStatus(t, $any($event.target).value, $any($event.target))">
                          @for (c of columns; track c.id) {
                            <option [value]="c.id" [selected]="c.id === t.task.status">{{ c.label }}</option>
                          }
                        </select>
                      </label>
                      <details class="bpm-card-move">
                        <summary>Changer de projet</summary>
                        <label>
                          <span class="visually-hidden">Projet de {{ t.task.title }}</span>
                          <select [disabled]="pending().has(t.task.id)" (change)="move(t, $any($event.target).value, $any($event.target))">
                            @for (p of destinations(t); track p.projectId) {
                              <option [value]="p.projectId" [selected]="p.projectId === t.task.projectId">{{ p.title }}</option>
                            }
                            <option value="">Sans projet (détacher)</option>
                          </select>
                        </label>
                      </details>
                      <a class="text-link task-card-edit" [routerLink]="['/tasks', t.task.id, 'edit']">Modifier dans le noyau</a>
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

          @if (data()?.attachable?.length) {
            <section class="bpm-section" aria-labelledby="bpm-attach-title" style="margin-top: var(--ecart-32)">
              <header>
                <h2 id="bpm-attach-title">Tâches du noyau à rattacher</h2>
                <p>Tâches sans projet ou d’un projet non financé : rattachez-les à un projet de la vie.</p>
              </header>
              <ul class="bpm-attachable">
                @for (t of data()!.attachable; track t.task.id) {
                  <li>
                    <span>
                      <strong>{{ t.task.title }}</strong>
                      <small> · {{ t.projectTitle ?? 'Sans projet' }} · {{ statusLabel[t.task.status] }}</small>
                    </span>
                    <label class="bpm-inline-form">
                      Rattacher à
                      <select [disabled]="pending().has(t.task.id)" (change)="move(t, $any($event.target).value, $any($event.target))">
                        <option value="" selected>Choisir un projet…</option>
                        @for (p of standardProjects(); track p.projectId) {
                          <option [value]="p.projectId">{{ p.title }}</option>
                        }
                      </select>
                    </label>
                  </li>
                }
              </ul>
            </section>
          }
        }
        <nav class="board-nav" aria-label="Changer de section">
          <a routerLink="/app/projets" class="text-link">Parcourir les projets de la vie <span aria-hidden="true">↗</span></a>
          <a routerLink="/tasks" class="text-link">Tâches du noyau <span aria-hidden="true">↗</span></a>
        </nav>
      </div>
    </div>
  `,
})
export class BpmTasksPage implements OnInit {
  private api = inject(Api);
  private bpm = inject(BpmApi);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  protected columns = COLUMNS;
  protected statusLabel = TASK_STATUS_LABEL;
  protected readonly date = displayDate;
  protected readonly urgency = dueUrgency;
  protected readonly dueTitle = dueTitle;
  protected data = signal<BpmTasksOverview | null>(null);
  protected loading = signal(true);
  protected loadError = signal<string | null>(null);
  protected pending = signal(new Set<string>());
  protected notice = signal<{ text: string; error: boolean } | null>(null);
  protected dragActive = signal(false);
  protected dropTarget = signal<TaskStatus | null>(null);
  private params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  protected query = computed(() => this.params().get('q') ?? '');
  protected filter = computed(() => this.params().get('project') || 'all');
  protected selectedProjectId = computed(() => (this.filter() === 'all' ? null : this.filter()));
  private dragCancelled = false;
  private dragging = false;

  private tasks = computed(() => this.data()?.tasks ?? []);
  protected standardProjects = computed(() => (this.data()?.projects ?? []).filter((p) => p.role === 'standard'));
  protected filterOptions = computed<FilterOption[]>(() => [
    { value: 'all', label: `Toutes les tâches des projets (${this.tasks().length})` },
    ...(this.data()?.projects ?? []).map((p) => ({ value: p.projectId, label: `${p.title} (${this.tasks().filter((t) => t.task.projectId === p.projectId).length})` })),
  ]);
  protected visible = computed(() => {
    const q = normalizeSearch(this.query().trim());
    const f = this.filter();
    return this.tasks().filter((t) => (!q || normalizeSearch(`${t.task.title} ${t.task.description} ${t.task.id}`).includes(q)) && (f === 'all' || t.task.projectId === f));
  });
  protected byColumn = computed(() => {
    const groups = Object.fromEntries(COLUMNS.map((c) => [c.id, [] as BpmTaskCard[]])) as Record<TaskStatus, BpmTaskCard[]>;
    for (const t of this.visible()) groups[t.task.status].push(t);
    return groups;
  });
  protected remaining = computed(() => this.tasks().filter((t) => t.task.status !== 'done').length);
  protected progress = computed(() => (this.tasks().length ? Math.round((100 * this.tasks().filter((t) => t.task.status === 'done').length) / this.tasks().length) : 0));
  protected counts = computed(() => Object.fromEntries(COLUMNS.map((c) => [c.id, this.tasks().filter((t) => t.task.status === c.id).length])) as Record<TaskStatus, number>);

  /** Projets proposés pour une tâche : les projets standards, et son projet actuel s'il est la racine du budget de vie. */
  protected destinations(t: BpmTaskCard) {
    return (this.data()?.projects ?? []).filter((p) => p.role === 'standard' || p.projectId === t.task.projectId);
  }

  ngOnInit() {
    this.load();
  }

  async load() {
    try {
      this.data.set(await this.bpm.tasksOverview());
      this.loadError.set(null);
    } catch (err) {
      const message = toApiError(err).message;
      this.loadError.set(message);
      this.notice.set({ text: message, error: true });
    } finally {
      this.loading.set(false);
    }
  }

  protected setFilter(patch: { project?: string | null; q?: string | null }) {
    this.router.navigate([], { queryParams: patch, queryParamsHandling: 'merge', replaceUrl: true });
  }

  @HostListener('document:keydown.escape')
  cancelDrag() {
    if (!this.dragging) return;
    this.dragCancelled = true;
    this.notice.set({ text: 'Déplacement annulé : la tâche ne sera pas modifiée.', error: false });
  }

  started() {
    this.dragging = true;
    this.dragActive.set(true);
    this.dragCancelled = false;
  }

  dropped(e: CdkDragDrop<TaskStatus, TaskStatus, BpmTaskCard>) {
    this.dragging = false;
    this.dragActive.set(false);
    this.dropTarget.set(null);
    const cancelled = this.dragCancelled;
    this.dragCancelled = false;
    if (cancelled || e.previousContainer === e.container || !e.isPointerOverContainer) return;
    this.changeStatus(e.item.data, e.container.data);
  }

  /** Commande du noyau `changeTaskStatus`, avec la version lue ; l'état du projet et les effets BPM sont annoncés. */
  async changeStatus(t: BpmTaskCard, status: TaskStatus, select?: HTMLSelectElement) {
    if (t.task.status === status || this.pending().has(t.task.id)) return;
    await this.write(t, () => this.api.changeTaskStatus(t.task.id, status, t.task.revision), (r) => `« ${r.task.title} » enregistrée en ${TASK_STATUS_LABEL[r.task.status]}.`, () => select && (select.value = t.task.status));
  }

  /** Rattachement (ou détachement) par les commandes du noyau ; une tâche porteuse de données budgétaires est retenue. */
  async move(t: BpmTaskCard, projectId: string, select?: HTMLSelectElement) {
    if ((projectId || null) === t.task.projectId || this.pending().has(t.task.id)) return;
    const restore = () => select && (select.value = this.isAttachable(t) ? '' : (t.task.projectId ?? ''));
    const title = this.data()?.projects.find((p) => p.projectId === projectId)?.title;
    await this.write(
      t,
      () => (projectId ? this.api.attachTask(t.task.id, projectId, t.task.revision) : this.api.detachTask(t.task.id, t.task.revision)),
      (r) => (projectId ? `« ${r.task.title} » rattachée à « ${title} ».` : `« ${r.task.title} » détachée : elle reste dans le noyau, sans projet.`),
      restore,
    );
  }

  private isAttachable(t: BpmTaskCard) {
    return !!this.data()?.attachable.some((x) => x.task.id === t.task.id);
  }

  /** Écriture par une commande du noyau ; en cas de refus, le sélecteur reprend la valeur enregistrée. */
  private async write(t: BpmTaskCard, call: () => Promise<TaskMutationResult>, message: (r: TaskMutationResult) => string, restore: () => unknown = () => undefined) {
    this.setPending(t.task.id, true);
    try {
      const r = await call();
      const projects = (r.affectedProjects ?? []).map((p) => `« ${p.project.title} » : ${p.view.statusLabel}`).join(' · ');
      const effects = (r.effects ?? []).map((x) => x.message).join(' ');
      await this.load();
      this.notice.set({ text: [message(r), projects ? `Projet ${projects}.` : '', effects].filter(Boolean).join(' '), error: false });
    } catch (err) {
      const e = toApiError(err);
      restore();
      await this.load();
      this.notice.set({ text: e.isConflict ? 'Conflit : la tâche a été modifiée ailleurs. Le tableau a été relu ; réessayer si besoin.' : `Non enregistré : ${e.message}`, error: true });
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
