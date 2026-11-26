import { BpmAmount } from '../ui/amount';
import { BPM_CORE_LINKS } from '../ui/bpm-page-path';
import { BpmCompass } from '../ui/compass';
import { BpmPageBanner, BpmPageContext, BpmPageFocus, bpmQueryState } from '../ui';
import { BpmTaskEditor } from './project-editors';
import { Component, computed, HostListener, inject, OnInit, signal } from '@angular/core';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  CdkDropListGroup,
} from '@angular/cdk/drag-drop';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { BpmRouterLink } from '../ui/bpm-router-link';
import { Api, newRequestKey, toApiError } from '../../core/api.service';
import { BpmApi } from '../data/bpm-api.service';
import { BpmTaskCard, BpmTasksOverview } from '../data/bpm-projects.models';
import { COLUMNS, TASK_STATUS_LABEL, TaskMutationResult, TaskStatus } from '../../core/models';
import { CentsPipe } from '../../core/format';
import {
  displayDate,
  dueTitle,
  dueUrgency,
  FilterOption,
  ItemSummaryComponent,
  normalizeSearch,
} from '../../projects/workspace-parts';

/**
 * Tâches des projets de la vie : réimplémentation, dans Budget/Patrimoine, du tableau des tâches du noyau. Glisser
 * une carte ou « Déplacer vers » appelle la commande du noyau `changeTaskStatus` (l'état du projet suit) ;
 * « Projet » rattache ou détache par les commandes du noyau `attachTask` / `detachTask`. Chaque carte montre la part
 * de budget de la tâche, ses dépenses réglées et son retour éventuel au budget de vie. La création reste dans le noyau.
 */
@Component({
  selector: 'app-bpm-tasks',
  providers: [BpmPageContext],
  imports: [BpmAmount, BpmCompass,
    BpmPageBanner,
    BpmTaskEditor,
    BpmRouterLink,
    CentsPipe,
    CdkDropListGroup,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    ItemSummaryComponent,
  ],
  styleUrl: './projects.page.scss',
  templateUrl: './tasks.page.html',
})
export class BpmTasksPage implements OnInit {
  protected readonly coreLinks = inject(BPM_CORE_LINKS);
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
  protected toolbarResult = computed(() => {
    const notice = this.notice();
    return notice ? { message: notice.text, tone: notice.error ? 'danger' as const : 'success' as const } : null;
  });
  protected dragActive = signal(false);
  protected dropTarget = signal<TaskStatus | null>(null);
  private params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected query = computed(() => this.params().get('q') ?? '');
  protected filter = computed(() => this.params().get('project') || 'all');
  /** Le projet dont on regarde les tâches, quand la page est ouverte depuis sa carte. */
  protected projectFilterLabel = computed(() => (this.filter() === 'all' ? null : this.data()?.projects.find((p) => p.projectId === this.filter())?.title ?? null));
  protected selectedProjectId = computed(() =>
    this.data()?.projects.find((p) => p.projectId === this.filter())?.projectId ?? null,
  );
  protected attention = computed(() => this.params().get('attention') || 'all');
  protected selectedStandardProject = computed(
    () =>
      this.standardProjects().find((p) => p.projectId === this.selectedProjectId())?.projectId ??
      '',
  );
  protected taskEditor = bpmQueryState('editTask', '', { overlay: true });
  protected taskProject = bpmQueryState('taskProject', '');
  protected taskProjectOptions = computed(() =>
    (this.data()?.projects ?? []).map((p) => ({ projectId: p.projectId, title: p.title })),
  );
  private availableTasks = computed(() =>
    (this.data()?.attachable ?? []).filter((t) => t.pathways.canChangeProject),
  );
  protected attachableTasks = computed(() =>
    this.availableTasks().filter((t) => this.matchesQuery(t) && this.matchesAttention(t)),
  );
  protected editingTask = computed(
    () =>
      [...this.tasks(), ...(this.data()?.attachable ?? [])].find(
        (t) => t.task.id === this.taskEditor(),
      ) ?? null,
  );
  protected nextTask = computed(() => {
    const tasks = this.visible();
    const blocked = tasks.find((t) => t.task.status === 'blocked');
    if (blocked) return { kind: 'blocked', task: blocked };
    const late = tasks.find((t) => this.isLate(t));
    if (late) return { kind: 'late', task: late };
    const funding = tasks.find((t) => this.needsFunding(t));
    if (funding) return { kind: 'funding', task: funding };
    const active = tasks.find((t) => t.task.status !== 'done');
    return active ? { kind: 'active', task: active } : null;
  });
  protected toolbarScope = computed(() => {
    const project = this.filter() === 'none' ? 'Sans projet' : this.projectFilterLabel() ?? 'Tous les projets';
    return `Sélection · ${project} · ${this.visible().length} / ${this.allTasks().length} tâche(s)`;
  });
  protected pageFocus = computed<BpmPageFocus>(() => {
    if (this.loadError())
      return {
        title: 'Les tâches n’ont pas pu être actualisées',
        detail: this.loadError()!,
        tone: 'danger',
      };
    if (!this.data()) return { title: 'Lecture des tâches et de leur financement…', tone: 'info' };
    const tasks = this.visible();
    const blocked = tasks.filter((t) => t.task.status === 'blocked').length;
    if (blocked)
      return {
        title: `${blocked} tâche(s) bloquée(s) dans cette sélection`,
        detail:
          'Revoyez la description, le temps prévu ou le statut pour préparer la suite du projet.',
        tone: 'warning',
      };
    const late = tasks.filter((t) => this.isLate(t)).length;
    if (late)
      return {
        title: `${late} tâche(s) ont dépassé leur échéance`,
        detail: 'Ouvrez une tâche pour ajuster sa planification ou constater son avancement.',
        tone: 'warning',
      };
    const funding = tasks.filter((t) => this.needsFunding(t)).length;
    if (funding)
      return {
        title: `${funding} tâche(s) ont un financement à traiter`,
        detail: 'Leur fiche projet regroupe les demandes, les parts et les dépassements.',
        tone: 'warning',
      };
    if (this.attachableTasks().length)
      return {
        title: `${this.attachableTasks().length} tâche(s) disponible(s) pour rattachement`,
        detail: 'Choisissez « Sans projet » puis rattachez chaque tâche à son projet depuis sa carte.',
        tone: 'info',
      };
    if (
      !tasks.length &&
      (this.query().trim() || this.attention() !== 'all' || this.selectedProjectId())
    )
      return {
        title: 'Aucune tâche ne correspond à cette sélection',
        detail: 'Réinitialisez la vue ou adaptez les filtres pour retrouver les tâches du projet.',
        tone: 'info',
      };
    return {
      title: `${this.visible().length} tâche(s) dans cette vue · ${tasks.filter((t) => t.task.status !== 'done').length} à poursuivre`,
      detail: tasks.length
        ? 'Changez un statut dans le tableau ou créez la prochaine tâche du projet sélectionné.'
        : 'Créez une tâche ; son projet peut être choisi maintenant ou plus tard.',
      tone: 'success',
    };
  });
  private dragCancelled = false;
  private dragging = false;

  private tasks = computed(() => this.data()?.tasks ?? []);
  protected standardProjects = computed(() =>
    (this.data()?.projects ?? []).filter((p) => p.role === 'standard'),
  );
  /** Toutes les tâches de la vie : celles des projets de la vie, puis celles sans projet (pense-bête). */
  private allTasks = computed(() => {
    const seen = new Set(this.tasks().map((t) => t.task.id));
    return [...this.tasks(), ...this.availableTasks().filter((t) => !seen.has(t.task.id))];
  });
  protected filterOptions = computed<FilterOption[]>(() => [
    { value: 'all', label: `Toutes les tâches de la vie (${this.allTasks().length})` },
    { value: 'none', label: `Sans projet · pense-bête (${this.availableTasks().length})` },
    ...(this.data()?.projects ?? []).map((p) => ({
      value: p.projectId,
      label: `${p.title} (${this.tasks().filter((t) => t.task.projectId === p.projectId).length})`,
    })),
  ]);
  protected visible = computed(() => {
    const f = this.filter();
    if (f === 'none') return this.attachableTasks();
    return this.allTasks().filter(
      (t) =>
        this.matchesQuery(t) && (f === 'all' || t.task.projectId === f) && this.matchesAttention(t),
    );
  });
  protected byColumn = computed(() => {
    const groups = Object.fromEntries(COLUMNS.map((c) => [c.id, [] as BpmTaskCard[]])) as Record<
      TaskStatus,
      BpmTaskCard[]
    >;
    for (const t of this.visible()) groups[t.task.status].push(t);
    return groups;
  });
  protected remaining = computed(() => this.allTasks().filter((t) => t.task.status !== 'done').length);
  protected progress = computed(() =>
    this.allTasks().length
      ? Math.round(
          (100 * this.allTasks().filter((t) => t.task.status === 'done').length) / this.allTasks().length,
        )
      : 0,
  );
  protected counts = computed(
    () =>
      Object.fromEntries(
        COLUMNS.map((c) => [c.id, this.allTasks().filter((t) => t.task.status === c.id).length]),
      ) as Record<TaskStatus, number>,
  );

  private matchesQuery(t: BpmTaskCard): boolean {
    const query = normalizeSearch(this.query().trim());
    return (
      !query ||
      normalizeSearch(`${t.task.title} ${t.task.description} ${t.task.id}`).includes(query)
    );
  }
  private isLate(t: BpmTaskCard): boolean {
    return (
      t.task.status !== 'done' &&
      !!t.task.dueDate &&
      t.task.dueDate < (this.data()?.context.calculationDate ?? '')
    );
  }
  private needsFunding(t: BpmTaskCard): boolean {
    return (
      !!t.budget?.over || ['pending', 'awaiting-life'].includes(t.budget?.request?.status ?? '')
    );
  }
  private matchesAttention(t: BpmTaskCard): boolean {
    const mode = this.attention();
    if (mode === 'active') return t.task.status !== 'done';
    if (mode === 'blocked') return t.task.status === 'blocked';
    if (mode === 'late') return this.isLate(t);
    if (mode === 'funding') return this.needsFunding(t);
    if (mode === 'done') return t.task.status === 'done';
    return true;
  }
  protected openEditor(task: BpmTaskCard | null = null) {
    this.taskProject.set(task ? '' : this.selectedStandardProject());
    this.taskEditor.set(task?.task.id ?? 'new');
  }
  protected async taskSaved(message: string) {
    this.taskEditor.set('');
    await this.load();
    this.notice.set({ text: message, error: false });
  }
  protected capturing = signal(false);
  /** Le projet affiché, s'il en est un : une tâche notée ici y est créée directement. */
  protected captureProjectTitle = computed(() => this.standardProjects().find((p) => p.projectId === this.filter())?.title ?? null);
  protected async capture(input: HTMLInputElement) {
    const title = input.value.trim();
    if (!title || this.capturing()) return;
    this.capturing.set(true);
    const projectId = this.standardProjects().some((p) => p.projectId === this.filter()) ? this.filter() : null;
    try {
      await this.bpm.createTask({ requestKey: newRequestKey(), title, projectId, status: 'todo' });
      input.value = '';
      await this.load();
      this.notice.set({ text: projectId ? `« ${title} » créée dans « ${this.captureProjectTitle()} ».` : `« ${title} » notée sans projet : rattachez-la quand vous saurez où elle va.`, error: false });
    } catch (err) {
      this.notice.set({ text: `Non enregistré : ${toApiError(err).message}`, error: true });
    } finally {
      this.capturing.set(false);
      input.focus();
    }
  }
  protected quickAttach(taskId: string, projectId: string) {
    const task = this.attachableTasks().find((t) => t.task.id === taskId);
    if (!task || !this.standardProjects().some((p) => p.projectId === projectId)) return;
    return this.move(task, projectId);
  }

  /** Projets proposés pour une tâche : les projets de la vie, et son projet actuel s'il est la racine du budget de vie. */
  protected destinations(t: BpmTaskCard) {
    return (this.data()?.projects ?? []).filter(
      (p) => p.role === 'standard' || p.projectId === t.task.projectId,
    );
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

  protected setFilter(patch: {
    project?: string | null;
    q?: string | null;
    attention?: string | null;
  }) {
    this.router.navigate([], {
      queryParams: patch,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
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
    await this.write(
      t,
      () => this.api.changeTaskStatus(t.task.id, status, t.task.revision),
      (r) => `« ${r.task.title} » enregistrée en ${TASK_STATUS_LABEL[r.task.status]}.`,
      () => select && (select.value = t.task.status),
    );
  }

  /** Rattachement (ou détachement) par les commandes du noyau ; une tâche porteuse de données budgétaires est retenue. */
  async move(t: BpmTaskCard, projectId: string, select?: HTMLSelectElement) {
    if ((projectId || null) === t.task.projectId || this.pending().has(t.task.id)) return;
    const restore = () =>
      select && (select.value = this.isAttachable(t) ? '' : (t.task.projectId ?? ''));
    const title = this.data()?.projects.find((p) => p.projectId === projectId)?.title;
    await this.write(
      t,
      () =>
        projectId
          ? this.api.attachTask(t.task.id, projectId, t.task.revision)
          : this.api.detachTask(t.task.id, t.task.revision),
      (r) =>
        projectId
          ? `« ${r.task.title} » rattachée à « ${title} ».`
          : `« ${r.task.title} » détachée : elle reste dans le noyau, sans projet.`,
      restore,
    );
  }

  protected isAttachable(t: BpmTaskCard) {
    return !!this.data()?.attachable.some((x) => x.task.id === t.task.id);
  }

  /** Écriture par une commande du noyau ; en cas de refus, le sélecteur reprend la valeur enregistrée. */
  private async write(
    t: BpmTaskCard,
    call: () => Promise<TaskMutationResult>,
    message: (r: TaskMutationResult) => string,
    restore: () => unknown = () => undefined,
  ) {
    this.setPending(t.task.id, true);
    try {
      const r = await call();
      const projects = (r.affectedProjects ?? [])
        .map((p) => `« ${p.project.title} » : ${p.view.statusLabel}`)
        .join(' · ');
      const effects = (r.effects ?? []).map((x) => x.message).join(' ');
      await this.load();
      this.notice.set({
        text: [message(r), projects ? `Projet ${projects}.` : '', effects]
          .filter(Boolean)
          .join(' '),
        error: false,
      });
    } catch (err) {
      const e = toApiError(err);
      restore();
      await this.load();
      this.notice.set({
        text: e.isConflict
          ? 'Conflit : la tâche a été modifiée ailleurs. Le tableau a été relu ; réessayer si besoin.'
          : `Non enregistré : ${e.message}`,
        error: true,
      });
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
