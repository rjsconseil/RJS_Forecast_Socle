import { BpmTaskShareDialog } from './funding-dialogs';
import { BpmAmount } from '../ui/amount';
import { BpmProjectFlowsPanel } from '../ui/project-flows';
import { BpmCompass } from '../ui/compass';
import { injectPageWorkspace } from '../../plan/page-workspace';
import { projectBudgetTiles } from './project-budget-tiles';
import { chargeState, defaultDate, timeTone } from './project-labels';
import { PageObjectLabels } from '../../plan/plan-context';
import { projectLink } from '../bpm.screens';
import { BpmPageContext } from '../ui/page-context';
import { bpmQueryState } from '../ui/query-state';
import type { BpmFormDraft } from '../ui/form-draft';
import { BpmPageBanner, BpmPageFocus } from '../ui';
import {
  afterNextRender,
  Component,
  computed,
  forwardRef,
  HostListener,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { BPM_CORE_LINKS, BPM_PAGE_PATH, BPM_PROJECT_DETAIL_PANELS } from '../ui/bpm-page-path';
import { BpmRouterLink } from '../ui/bpm-router-link';
import { Api, newRequestKey, toApiError } from '../../core/api.service';
import { BpmApi } from '../data/bpm-api.service';
import { BpmBudgetRef, RegisterLine } from '../data/bpm-models';
import {
  BpmProjectDetail,
  BpmTaskCard,
  FundingSource,
  FUNDING_SOURCE_LABEL,
  ProjectChargeLine,
  ProjectOverrun,
  ReturnCadence,
  TaskBudgetRequest,
} from '../data/bpm-projects.models';
import { COLUMNS, TASK_STATUS_LABEL, TaskStatus } from '../../core/models';
import { cents, CentsPipe, parseAmount, ShortDatePipe } from '../../core/format';
import { FUNDING, FUNDING_ACTIONS, ProjectFunding } from '../ui/project-funding';
import { BpmEntryFlow } from '../ui/entry-flow';
import { BpmLineDetail } from '../ui/line-detail';
import { BpmOverflowDirective } from '../ui/overflow';
import { BpmModal } from '../ui/modal';
import { BpmLifeProjectCockpit } from './life-project-cockpit';
import { BpmProjectChargeList } from './project-charge-list';
import { PROJECT_PAGE } from './project-page-host';
import { BpmProjectTaskPanel } from './project-task-panel';
import { BpmOverrunRequestComponent, BpmTaskRequestsComponent } from './project-parts';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  CdkDropListGroup,
} from '@angular/cdk/drag-drop';
import { MetricTile } from '../../shared/metric-tiles.component';
import { displayDate, dueUrgency, dueTitle, normalizeSearch } from '../../projects/workspace-parts';
import { BpmProjectEditor, BpmTaskEditor } from './project-editors';
import { ProjectWriteFlow, Write } from './project-write-flow';
import { ProjectTaskFunding } from './project-task-funding';
import { ProjectFocusInput, projectNextActionLabel, projectPageFocus } from './project-focus';

const today = () => new Date().toISOString().slice(0, 10);
const RETURN_CADENCES: { id: ReturnCadence; label: string }[] = [
  { id: 'once', label: 'Ponctuel' },
  { id: 'weekly', label: 'Hebdomadaire' },
  { id: 'monthly', label: 'Mensuel' },
  { id: 'yearly', label: 'Annuel' },
];


/**
 * Fiche BPM d'un projet de la vie. Projet standard : budget attribué par le budget de vie (charge non récurrente
 * spéciale du budget de vie), ventilation sur les tâches, dépenses du projet et validation de leur règlement,
 * dépassements autorisés par le budget de vie, retours de revenus à la complétion des tâches, contrôles de fin de
 * cycle. Projet de vie : les projets qu'il finance et les décisions qui lui reviennent. Le projet et ses tâches
 * restent ceux du noyau (création, édition) ; leur état et leur rattachement passent par les commandes du noyau.
 */
@Component({
  selector: 'app-bpm-project',
  providers: [BpmPageContext, { provide: PROJECT_PAGE, useExisting: forwardRef(() => BpmProjectPage) }],
  imports: [BpmAmount, BpmProjectFlowsPanel, BpmCompass, BpmTaskShareDialog,
    BpmPageBanner,
    NgTemplateOutlet,
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    CdkDropListGroup,
    BpmRouterLink,
    CentsPipe,
    ShortDatePipe,
    BpmOverrunRequestComponent,
    BpmEntryFlow,
    BpmLineDetail,
    BpmTaskRequestsComponent,
    BpmLifeProjectCockpit,
    BpmProjectChargeList,
    BpmProjectEditor,
    BpmTaskEditor,
    BpmOverflowDirective,
    BpmModal,
    BpmProjectTaskPanel,
  ],
  templateUrl: './project.page.html',
  styleUrls: ['./projects.page.scss', './project.page.scss', './project-task-status.scss'],
})
export class BpmProjectPage {
  protected readonly modulePath = inject(BPM_PAGE_PATH);
  protected readonly coreLinks = inject(BPM_CORE_LINKS);
  protected readonly detailPanels = inject(BPM_PROJECT_DETAIL_PANELS);
  protected readonly workspace = injectPageWorkspace();
  protected readonly workspaceKey = computed(() => this.workspace()?.key);
  protected ctx = inject(BpmPageContext);
  private api = inject(Api);
  private bpm = inject(BpmApi);
  /** Gestes de financement partagés avec la fiche d'échéance et la page projet de vie. */
  private funding = inject(ProjectFunding);
  protected readonly L = FUNDING;
  readonly act = FUNDING_ACTIONS;
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private injector = inject(Injector);
  private document = inject(DOCUMENT);
  private objectLabels = inject(PageObjectLabels);
  private pendingSection: string | null = null;
  private loadSequence = 0;
  protected columns = COLUMNS;
  cadences = RETURN_CADENCES;
  readonly today = today();
  data = signal<BpmProjectDetail | null>(null);
  protected availableTasks = computed(() =>
    (this.data()?.attachable ?? []).filter((t) => !t.task.projectId && t.pathways.canChangeProject),
  );
  protected error = signal<string | null>(null);
  private writes = new ProjectWriteFlow({ load: () => this.load(), reveal: (id) => this.revealControl(id), funding: this.funding });
  private taskFunding = new ProjectTaskFunding({
    run: (action, success, label) => this.writes.run(action, success, label),
    notice: this.writes.notice,
    bpm: this.bpm,
    funding: this.funding,
    budgetRevision: () => this.data()?.budget?.revision,
    requestSent: () => this.fundingTask.set(null),
    returnSaved: () => this.returnEditor.set(null),
  });
  busy = this.writes.busy;
  notice = this.writes.notice;
  protected toolbarResult = computed(() => {
    const notice = this.notice();
    return notice ? { message: notice.text, tone: notice.error ? 'danger' as const : 'success' as const } : null;
  });
  protected toolbarScope = computed(() => {
    const d = this.data();
    return d?.role === 'standard'
      ? `Projet · ${d.project.project.title} · Sélection : ${this.visibleTasks().length} / ${d.tasks.length} tâche(s) · Budget sur toute sa durée`
      : 'Section · projet de vie et financement de tous ses projets';
  });
  private hasTaskSelection = computed(() => !!this.query().trim() || this.taskAttention() !== 'all');
  protected flow = this.writes.flow;
  protected shareFlow = this.writes.shareFlow;
  /** Part d'une tâche ouverte en fenêtre depuis son chiffre (« À demander » ou le montant). */
  protected readonly shareFor = signal<BpmTaskCard | null>(null);
  protected async shareSaved(message: string) {
    this.shareFor.set(null);
    await this.load();
    this.notice.set({ text: message, error: false });
  }
  protected allocation = signal('');
  protected readonly allocationSource = signal<FundingSource>('cycle');
  protected readonly fundingSourceLabel = FUNDING_SOURCE_LABEL;
  protected readonly allocationMode = signal<'total' | 'add'>('total');
  protected readonly allocationBase = signal(0);
  protected readonly increasedEnvelope = computed(() => {
    const amount = parseAmount(this.allocation());
    return typeof amount === 'number' && amount > 0 ? this.allocationBase() + Math.round(amount * 100) : null;
  });

  protected setAllocationMode(mode: 'total' | 'add') {
    this.allocationMode.set(mode);
    this.allocation.set(mode === 'add' ? '' : String(this.allocationBase() / 100).replace('.', ','));
    this.allocationError.set(null);
  }
  returnEditor = bpmQueryState<string | null>('retour', null, { overlay: true });
  settling = bpmQueryState<string | null>('reglement', null, { overlay: true });
  protected entryId = bpmQueryState('entry', '', { overlay: true });
  protected editorOpen = computed(() => !!this.entryId());
  protected lineId = bpmQueryState<string | null>('ligne', null, { overlay: true });
  protected projectEditor = bpmQueryState('editProject', false, {
    parse: value => value !== 'false', format: () => this.projectId || 'current', overlay: true,
  });
  protected taskEditorId = bpmQueryState('editTask', '', { overlay: true });
  protected taskEditor = computed(() => !!this.taskEditorId());
  protected editingTask = computed(() => this.data()?.tasks.find(t => t.task.id === this.taskEditorId()) ?? null);
  protected taskProjectOptions = computed(() => {
    const d = this.data();
    return d?.role === 'standard'
      ? [{ projectId: d.project.project.id, title: d.project.project.title }]
      : [];
  });
  protected requestHistory = computed(() =>
    (this.data()?.requests ?? []).filter(
      (x) => x.status !== 'pending' && x.status !== 'awaiting-life',
    ),
  );
  private projectId = '';
  protected decisionsOpen = bpmQueryState('decisions', false, { parse: value => value !== 'false', format: () => 'open', overlay: true });
  protected taskAttention = bpmQueryState('attention', 'all');
  protected projectLead = computed(() => {
    const d = this.data();
    const description = d?.project.project.description?.trim();
    if (!description)
      return 'Précisez le but de ce projet, préparez ses tâches puis suivez leur financement et leurs règlements.';
    return description.length > 240 ? `${description.slice(0, 237).trimEnd()}…` : description;
  });
  protected pendingTaskRequests = computed(() =>
    (this.data()?.role === 'life' ? [] : (this.data()?.requests ?? [])).filter(
      (r) => (r.status === 'pending' || r.status === 'awaiting-life') && this.matchesTaskSelection(r.taskId),
    ),
  );
  protected pendingDecisions = computed(() =>
    (this.data()?.role === 'life'
      ? (this.data()?.life?.pendingRequests ?? [])
      : (this.data()?.overruns ?? [])
    ).filter((o) => o.status === 'pending' && this.matchesTaskSelection(o.taskId)),
  );
  protected nextCharge = computed(
    () =>
      (this.data()?.charges ?? [])
        .filter(
          (c) => !c.settled && this.matchesTaskSelection(c.taskId) && c.plannedDate <= (this.data()?.context.calculationDate ?? today()),
        )
        .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate))[0] ?? null,
  );
  protected nextTask = computed(() => {
    const tasks = this.visibleTasks();
    return (
      tasks.find((t) => t.task.status === 'blocked') ??
      tasks.find((t) => this.isLate(t)) ??
      tasks.find((t) => t.task.status === 'done' && (t.budget?.unusedCents ?? 0) > 0) ??
      tasks.find((t) => t.task.status !== 'done') ??
      null
    );
  });
  private focusInput(): ProjectFocusInput {
    return {
      data: this.data(),
      error: this.error(),
      hasSelection: this.hasTaskSelection(),
      visibleCount: this.visibleTasks().length,
      pendingCount: this.pendingDecisions().length + this.pendingTaskRequests().length,
      nextCharge: this.nextCharge(),
      nextTask: this.nextTask(),
      isLate: (t) => this.isLate(t),
      doneCount: this.doneCount(),
    };
  }
  protected nextActionLabel = computed(() => projectNextActionLabel(this.focusInput()));
  protected pageFocus = computed<BpmPageFocus>(() => projectPageFocus(this.focusInput()));
  /** Contexte de retour uniquement : la fiche du projet reste lue sur toute sa durée. */
  protected lifePeriod = signal<string | null>(null);
  protected allocationEditing = signal(false);
  protected allocationRevision = signal(0);
  protected allocationError = signal<string | null>(null);
  protected query = bpmQueryState('q', '', { replace: true });
  fundingTask = bpmQueryState<string | null>('demande', null, { overlay: true });
  /** Tâche ouverte dans sa fenêtre : la carte du tableau garde une taille fixe. */
  protected openTaskId = bpmQueryState<string | null>('task', null, { overlay: true });
  openTask = computed(() => {
    const id = this.openTaskId();
    return id ? ((this.data()?.tasks ?? []).find((t) => t.task.id === id) ?? null) : null;
  });
  protected expenseTaskId = bpmQueryState<string | null>('expenseTask', null, { overlay: true });
  /** Sens de la saisie ouverte : dépense, ou remboursement reçu (déduit du réglé de la tâche et du projet). */
  protected expenseDirection = bpmQueryState<'charge' | 'income'>('expenseDirection', 'charge', { overlay: true });
  protected dragActive = signal(false);
  protected dropTarget = signal<TaskStatus | null>(null);
  private dragCancelled = false;
  readonly date = displayDate;
  protected readonly urgency = dueUrgency;
  protected readonly dueTitle = dueTitle;
  protected doneCount = computed(
    () => (this.data()?.tasks ?? []).filter((t) => t.task.status === 'done').length,
  );
  protected progress = computed(() =>
    this.data()?.tasks.length
      ? Math.round((100 * this.doneCount()) / this.data()!.tasks.length)
      : 0,
  );
  protected visibleTasks = computed(() => {
    const q = normalizeSearch(this.query().trim());
    return (this.data()?.tasks ?? []).filter(
      (t) =>
        (!q || normalizeSearch(`${t.task.title} ${t.task.description} ${t.task.id}`).includes(q)) &&
        this.matchesAttention(t),
    );
  });
  protected byColumn = computed(
    () =>
      Object.fromEntries(
        COLUMNS.map((c) => [c.id, this.visibleTasks().filter((t) => t.task.status === c.id)]),
      ) as Record<TaskStatus, BpmTaskCard[]>,
  );
  protected unassignedCharges = computed(() =>
    (this.data()?.charges ?? []).filter((c) => !c.taskId),
  );
  protected readonly timeTone = timeTone;
  protected readonly chargeState = chargeState;
  protected readonly defaultDate = defaultDate;
  protected budgetTiles = computed<MetricTile[]>(() => {
    const b = this.data()?.budget;
    return b ? projectBudgetTiles(b) : [];
  });


  private matchesTaskSelection(taskId: string | null): boolean {
    return !this.hasTaskSelection() || (!!taskId && this.visibleTasks().some((t) => t.task.id === taskId));
  }
  private isLate(t: BpmTaskCard): boolean {
    return (
      t.task.status !== 'done' &&
      !!t.task.dueDate &&
      t.task.dueDate < (this.data()?.context.calculationDate ?? today())
    );
  }
  private matchesAttention(t: BpmTaskCard): boolean {
    const mode = this.taskAttention();
    if (mode === 'active') return t.task.status !== 'done';
    if (mode === 'blocked') return t.task.status === 'blocked';
    if (mode === 'late') return this.isLate(t);
    if (mode === 'funding')
      return (
        !!t.budget?.over || ['pending', 'awaiting-life'].includes(t.budget?.request?.status ?? '')
      );
    if (mode === 'release') return t.task.status === 'done' && (t.budget?.unusedCents ?? 0) > 0;
    if (mode === 'done') return t.task.status === 'done';
    return true;
  }
  protected runNextAction() {
    if (this.data()?.budget?.abandoned) {
      void this.resumeProject();
      return;
    }
    if (this.busy()) return;
    const d = this.data();
    if (!d) return;
    if (!d.budget?.regime) {
      this.editAllocation();
      return;
    }
    if (this.pendingDecisions().length || this.pendingTaskRequests().length) {
      this.decisionsOpen.set(true);
      return;
    }
    const charge = this.nextCharge();
    if (charge) {
      const task = d.tasks.find((t) => t.task.id === charge.taskId);
      if (task) this.showTask(task, 'charges');
      else {
        this.closeTaskPanel();
        if (this.workspaceKey() === 'project-tasks') {
          this.router.navigate([this.modulePath('/app/gestion-projet'), this.projectId, 'budget'], { queryParamsHandling: 'preserve', fragment: 'charges-title' });
          return;
        }
        this.revealSection('charges-title');
      }
      this.openCharge(charge);
      this.revealControl(`charge-${charge.id}`);
      return;
    }
    if (this.hasTaskSelection() && !this.visibleTasks().length) {
      this.query.set('');
      this.taskAttention.set('all');
      return;
    }
    const task = this.nextTask();
    if (task) {
      this.showTask(task);
      return;
    }
    if (d.tasks.length && this.workspaceKey() === 'project-tasks')
      this.router.navigate([this.modulePath('/app/gestion-projet'), this.projectId, 'budget'], { queryParamsHandling: 'preserve', fragment: 'cycle-title' });
    else if (d.tasks.length) this.revealSection('cycle-title');
    else this.createTask();
  }
  private revealSection(id: string) {
    afterNextRender(
      () => {
        const section = this.document.getElementById(id);
        if (section?.tagName === 'DETAILS') (section as HTMLDetailsElement).open = true;
        section?.scrollIntoView?.({ block: 'start' });
      },
      { injector: this.injector },
    );
  }

  statusLabel(s: TaskStatus) {
    return TASK_STATUS_LABEL[s];
  }
  /** Ouvre la fenêtre de la tâche, au besoin sur sa part (demande) ou ses dépenses. */
  protected showTask(t: BpmTaskCard, section: 'funding' | 'charges' | null = null) {
    // La vue Budget ne monte pas la fenêtre de tâche : la tâche s'ouvre dans la sous-page Tâches (audit A05).
    if (this.workspaceKey() === 'project-budget') {
      void this.router.navigate([this.modulePath('/app/gestion-projet'), this.projectId, 'taches'], { queryParams: { task: t.task.id }, queryParamsHandling: 'merge' });
      return;
    }
    this.fundingTask.set(section === 'funding' && !t.budget?.request ? t.task.id : null);
    this.returnEditor.set(null);
    this.settling.set(null);
    this.openTaskId.set(t.task.id);
    if (section)
      afterNextRender(
        () =>
          this.document.getElementById(`task-panel-${section}`)?.scrollIntoView({ block: 'start' }),
        { injector: this.injector },
      );
  }
  closeTaskPanel() {
    this.openTaskId.set(null);
    this.fundingTask.set(null);
    this.returnEditor.set(null);
    this.settling.set(null);
  }

  taskCharges(id: string) {
    return (this.data()?.charges ?? []).filter((c) => c.taskId === id);
  }
  taskHistory(id: string) {
    return this.requestHistory().filter((r) => r.taskId === id);
  }
  taskOverruns(id: string) {
    return (this.data()?.overruns ?? []).filter(
      (o) => o.taskId === id && o.status === 'pending' && o.id !== this.flow()?.request?.id,
    );
  }
  protected timeWidth(t: BpmTaskCard) {
    const p = t.budget?.timeConsumptionPercent;
    return p === null || p === undefined ? null : Math.min(100, Math.max(0, p));
  }
  protected createTask() {
    this.taskEditorId.set('new');
  }
  editTask(t: BpmTaskCard) {
    this.taskEditorId.set(t.task.id);
  }
  addExpense(taskId: string | null) {
    if (!taskId) { this.notice.set({ text: 'Choisissez une tâche pour saisir sa dépense.', error: true }); return; }
    this.expenseTaskId.set(taskId);
    this.expenseDirection.set('charge');
    this.entryId.set('new');
  }
  addRefund(taskId: string) {
    this.expenseTaskId.set(taskId);
    this.expenseDirection.set('income');
    this.entryId.set('new');
  }
  openCharge(c: ProjectChargeLine) {
    this.lineId.set(c.id);
  }
  protected async closeCharge() {
    this.lineId.set(null);
    await this.load();
  }
  protected editCharge(line: RegisterLine) {
    this.lineId.set(null);
    this.entryId.set(line.id);
  }
  /** Refermer la saisie rend la fenêtre de la tâche telle qu'elle était : son contexte de saisie quitte l'adresse. */
  protected closeExpense() {
    this.expenseTaskId.set(null);
    this.expenseDirection.set('charge');
    this.entryId.set('');
  }
  editAllocation() {
    if (this.workspaceKey() === 'project-tasks') {
      this.router.navigate([this.modulePath('/app/gestion-projet'), this.projectId, 'budget'], {
        queryParams: { task: null }, queryParamsHandling: 'merge', fragment: 'enveloppe',
      });
      return;
    }
    const b = this.data()?.budget;
    if (!b) return;
    this.allocationMode.set('total');
    this.allocationBase.set(b.allocationCents ?? 0);
    this.allocationSource.set(b.fundingSource ?? 'cycle');
    this.allocation.set(
      b.allocationCents === null ? '' : (b.allocationCents / 100).toString().replace('.', ','),
    );
    this.allocationRevision.set(b.revision);
    this.allocationError.set(null);
    this.allocationEditing.set(true);
    this.revealControl('project-envelope');
  }

  private revealControl(id: string) {
    afterNextRender(
      () => {
        const control = this.document.getElementById(id);
        control?.scrollIntoView?.({ block: 'center' });
        control?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  @HostListener('document:keydown.escape')
  cancelDrag() {
    if (!this.dragActive()) return;
    this.dragCancelled = true;
    this.notice.set({ text: 'Déplacement annulé : la tâche ne sera pas modifiée.', error: false });
  }
  protected started() {
    this.dragCancelled = false;
    this.dragActive.set(true);
  }
  protected dropped(e: CdkDragDrop<TaskStatus, TaskStatus, BpmTaskCard>) {
    this.dragActive.set(false);
    this.dropTarget.set(null);
    const cancelled = this.dragCancelled;
    this.dragCancelled = false;
    if (
      cancelled ||
      this.busy() ||
      e.previousContainer === e.container ||
      !e.isPointerOverContainer
    )
      return;
    return this.changeStatus(e.item.data, e.container.data);
  }

  protected budgetRef = computed<BpmBudgetRef | null>(() => {
    const b = this.data()?.budget;
    return b
      ? {
          id: b.budgetId,
          name: b.name,
          role: 'standard',
          fundingSource: b.fundingSource,
          coreProjectId: b.coreProjectId,
          capsCents: {},
          revision: b.revision,
        }
      : null;
  });
  protected billable = computed(() =>
    (this.data()?.overruns ?? []).some(
      (o) => o.status === 'approved' && (!o.billingDate || o.billingDate <= today()),
    ),
  );

  constructor() {
    this.route.queryParamMap?.pipe(takeUntilDestroyed()).subscribe((p) => {
      const key = p.get('lifePeriod') ?? p.get('period');
      this.lifePeriod.set(key && /^\d{4}-\d{2}$/.test(key) ? key : null);
    });
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((p) => {
      this.projectId = p.get('id') ?? '';
      this.query.sync();
      this.taskAttention.sync();
      this.decisionsOpen.sync();
      this.data.set(null);
      this.flow.set(null);
      this.notice.set(null);
      this.allocationEditing.set(false);
      this.allocationError.set(null);
      this.taskEditorId.sync();
      this.projectEditor.sync();
      this.entryId.sync();
      this.lineId.sync();
      this.fundingTask.sync();
      this.openTaskId.sync();
      this.returnEditor.sync();
      this.settling.sync();
      this.taskFunding.requestKeys.clear();
      this.load();
    });
    this.route.fragment.pipe(takeUntilDestroyed()).subscribe((fragment) => {
      this.pendingSection = fragment;
      if (this.data()) this.scrollToSection();
    });
  }

  async load() {
    const sequence = ++this.loadSequence;
    try {
      const d = await this.bpm.projectDetail(this.projectId);
      if (sequence !== this.loadSequence) return;
      this.data.set(d);
      // Le cadre (fil d'Ariane, menu, parcours) nomme la fiche ouverte par son titre ; sans titre, il garde « Fiche du projet ».
      const title = d.project?.project?.title;
      if (title) this.objectLabels.set(projectLink(this.projectId), title);
      for (const request of d.requests ?? []) {
        if (request.status !== 'pending' && request.status !== 'awaiting-life') continue;
        for (const signature of this.taskFunding.requestKeys.keys()) {
          const [budgetId, taskId] = JSON.parse(signature);
          if (budgetId === request.budgetId && taskId === request.taskId)
            this.taskFunding.requestKeys.delete(signature);
        }
      }
      if (!this.allocationEditing())
        this.allocation.set(
          d.budget?.allocationCents === null || d.budget?.allocationCents === undefined
            ? ''
            : (d.budget.allocationCents / 100).toString().replace('.', ','),
        );
      this.error.set(null);
      this.scrollToSection();
    } catch (err) {
      if (sequence === this.loadSequence) this.error.set(toApiError(err).message);
    }
  }

  private scrollToSection() {
    const section = this.pendingSection;
    this.pendingSection = null;
    // Raccourci depuis le projet de vie : #enveloppe ouvre directement l'attribution du budget du projet.
    if (section === 'enveloppe') {
      this.closeTaskPanel();
      if (this.data()?.role === 'standard' && !this.allocationEditing()) this.editAllocation();
      return;
    }
    if (
      section &&
      ['requests-title', 'budget-title', 'shares-title', 'charges-title', 'cycle-title'].includes(
        section,
      )
    ) {
      afterNextRender(
        () => {
          const target = this.document.getElementById(
            section === 'requests-title' ? 'shares-title' : section,
          );
          if (target?.tagName === 'DETAILS') (target as HTMLDetailsElement).open = true;
          target?.scrollIntoView({ block: 'start' });
        },
        { injector: this.injector },
      );
    }
  }

  cadenceLabel(c: ReturnCadence) {
    return RETURN_CADENCES.find((x) => x.id === c)?.label.toLowerCase() ?? c;
  }


  /** La lecture du middleware fait foi, y compris pour un règlement antidaté. */
  protected settlementResult(c: ProjectChargeLine) {
    const read = this.data()?.charges.find((line) => line.id === c.id);
    const saved = `Règlement de « ${c.label} » enregistré.`;
    if (read?.validated)
      return `${saved} Il est remonté au budget du projet de vie à sa date réelle, le ${displayDate(read.realizedDate!)}.`;
    if (read?.beforeAllocation)
      return `${saved} Sa date réelle précède l’attribution de l’enveloppe : il reste dans l’historique du projet, hors budget de vie.`;
    if (read?.settled)
      return `${saved} Ce projet n’a pas d’enveloppe : le règlement reste hors budget de vie.`;
    return `${saved} Le projet a été actualisé ; sa date réelle détermine la période du règlement.`;
  }


  /** Écritures de la page : voir `ProjectWriteFlow`. */
  private run<T>(action: Write<T>, success: string | ((result: T) => string), label = '') {
    return this.writes.run(action, success, label);
  }
  protected grantShareFlow() { return this.writes.grantShareFlow(); }
  protected authorizeFlow() { return this.writes.authorizeFlow(); }
  protected requestAuthorization() { return this.writes.requestAuthorization(); }
  protected decideFlow(decision: 'approve' | 'refuse') { return this.writes.decideFlow(decision); }

  decide(o: ProjectOverrun, decision: 'approve' | 'refuse') {
    return this.run(
      () => this.funding.decide(o, decision),
      (r) => r.message,
    );
  }

  /** Abandon en deux temps : l'aperçu dit ce qui revient au budget de vie et ce qui s'arrête, puis confirmation. */
  protected abandonOpen = signal(false);
  protected abandonReason = signal('');
  protected abandonProject() {
    const d = this.data();
    if (!d?.budget) return;
    const { budgetId, revision } = d.budget;
    return this.run(
      () => this.bpm.abandonProject(budgetId, { expectedRevision: revision, reason: this.abandonReason().trim() || undefined }),
      (r) => {
        this.abandonOpen.set(false);
        this.abandonReason.set('');
        return r.abandonment.releasedCents
          ? `Projet abandonné : ${cents(r.abandonment.releasedCents)} reviennent au budget de vie.`
          : 'Projet abandonné : ses dépenses réglées restent dans son historique.';
      },
    );
  }
  protected resumeProject() {
    const d = this.data();
    if (!d?.budget) return;
    return this.run(() => this.bpm.resumeProject(d.budget!.budgetId, d.budget!.revision), 'Projet repris : il reçoit de nouveau des dépenses ; réattribuez son enveloppe au besoin.');
  }

  /** Exécute le geste proposé par un contrôle : l'enveloppe ramenée à ce qui a servi (règle et refus côté API). */
  protected async applyCheck(budgetId: string, amountCents: number, label: string) {
    if (this.busy()) return;
    this.busy.set(true);
    this.notice.set(null);
    try {
      await this.bpm.allocate(budgetId, amountCents / 100, this.data()!.budget!.revision);
      await this.load();
      this.notice.set({
        text: `${label} : enveloppe ramenée à ${cents(amountCents)}.`,
        error: false,
      });
    } catch (err) {
      this.notice.set({ text: toApiError(err).message, error: true });
      await this.load();
    } finally {
      this.busy.set(false);
    }
  }

  protected async allocate(budgetId: string, revision: number) {
    if (this.busy()) return;
    const adding = this.allocationMode() === 'add';
    const increased = this.increasedEnvelope();
    const amount = adding ? increased === null ? null : increased / 100 : parseAmount(this.allocation());
    if (amount === null || amount === 'invalid' || amount < 0) {
      this.allocationError.set(
        adding ? 'Indiquez le montant à ajouter, en euros, avec deux décimales au plus.' : 'Indiquez le montant total en euros, avec deux décimales au plus.',
      );
      return;
    }
    this.busy.set(true);
    this.allocationError.set(null);
    this.notice.set(null);
    try {
      const source = this.allocationSource();
      if (source !== (this.data()?.budget?.fundingSource ?? 'cycle')) await this.bpm.allocate(budgetId, amount, revision, source);
      else await this.bpm.allocate(budgetId, amount, revision);
      this.allocationEditing.set(false);
      await this.load();
      this.notice.set({ text: adding ? `Moyens ajoutés. L’enveloppe atteint ${cents(Math.round(amount * 100))}.` : 'Enveloppe budgétaire enregistrée.', error: false });
    } catch (err) {
      const e = toApiError(err);
      this.allocationError.set(
        e.isConflict
          ? 'Le budget a changé ailleurs. Votre saisie est conservée. Annulez puis rouvrez la modification pour relire le montant actuel.'
          : e.message,
      );
      await this.load();
    } finally {
      this.busy.set(false);
    }
  }

  /** Gestes de financement d'une tâche : voir `ProjectTaskFunding`. */
  saveShare(budgetId: string, t: BpmTaskCard, raw: string, revision: number, onSaved?: () => void) {
    return this.taskFunding.saveShare(budgetId, t, raw, revision, onSaved);
  }
  releaseShare(budgetId: string, t: BpmTaskCard, revision: number) {
    return this.taskFunding.releaseShare(budgetId, t, revision);
  }
  requestBudget(budgetId: string, t: BpmTaskCard, controls: HTMLFormControlsCollection, draft?: BpmFormDraft) {
    return this.taskFunding.requestBudget(budgetId, t, controls, draft);
  }
  decideRequest(e: { request: TaskBudgetRequest; decision: 'approve' | 'refuse' | 'cancel' }) {
    return this.taskFunding.decideRequest(e);
  }

  protected closeTask() {
    this.taskEditorId.set('');
  }
  protected async taskSaved(text: string) {
    this.closeTask();
    await this.load();
    this.notice.set({ text, error: false });
  }
  protected async projectSaved() {
    this.projectEditor.set(false);
    await this.load();
    this.notice.set({ text: 'Projet enregistré.', error: false });
  }

  saveReturn(budgetId: string, t: BpmTaskCard, f: HTMLFormControlsCollection, revision: number, draft?: BpmFormDraft) {
    return this.taskFunding.saveReturn(budgetId, t, f, revision, draft);
  }
  removeReturn(budgetId: string, t: BpmTaskCard, revision: number) {
    return this.taskFunding.removeReturn(budgetId, t, revision);
  }

  protected async changeStatus(t: BpmTaskCard, status: TaskStatus, select?: HTMLSelectElement) {
    if (status === t.task.status || this.busy() || t.task.projectId !== this.projectId) return;
    this.busy.set(true);
    try {
      const r = await this.api.changeTaskStatus(t.task.id, status, t.task.revision);
      const project = r.affectedProjects?.[0];
      await this.load();
      this.notice.set({
        text: [
          `« ${r.task.title} » enregistrée en ${TASK_STATUS_LABEL[r.task.status]}.`,
          project ? `Projet : ${project.view.statusLabel}.` : '',
          ...(r.effects ?? []).map((x) => x.message),
        ]
          .filter(Boolean)
          .join(' '),
        error: false,
      });
    } catch (err) {
      if (select) select.value = t.task.status;
      const e = toApiError(err);
      await this.load();
      this.notice.set({
        text: e.isConflict
          ? 'Conflit : la tâche a changé ailleurs. La fiche a été relue.'
          : e.message,
        error: true,
      });
    } finally {
      this.busy.set(false);
    }
  }

  protected attach(taskId: string) {
    const t = this.availableTasks().find((x) => x.task.id === taskId);
    if (!t) return;
    return this.run(
      () => this.api.attachTask(t.task.id, this.projectId, t.task.revision),
      `« ${t.task.title} » rattachée au projet.`,
    );
  }

  detach(t: BpmTaskCard) {
    return this.run(
      () => this.api.detachTask(t.task.id, t.task.revision),
      `« ${t.task.title} » détachée du projet. Elle reste disponible pour un autre rattachement.`,
    );
  }

  settle(c: ProjectChargeLine, f: HTMLFormControlsCollection, draft?: BpmFormDraft) {
    const get = (n: string) => (f.namedItem(n) as HTMLInputElement | null)?.value ?? '';
    const amount = parseAmount(get('amount'));
    const realizedDate = get('date');
    if (amount === null || amount === 'invalid' || amount <= 0 || !realizedDate) {
      this.notice.set({ text: 'Indiquez la date et le montant réellement réglés.', error: true });
      return;
    }
    const requestKey = newRequestKey();
    const action = (fund?: boolean) =>
      c.kind === 'occurrence' && c.recurrenceId && c.occurrenceDate
        ? this.bpm.settleOccurrence(c.recurrenceId, {
            requestKey,
            occurrenceDate: c.occurrenceDate,
            realizedAmount: amount,
            realizedDate,
            fund,
          })
        : this.bpm.realizeOperation(c.operationId!, {
            expectedRevision: c.revision ?? 0,
            realizedAmount: amount,
            realizedDate,
            fund,
          });
    return this.run(
      async (fund) => {
        await action(fund);
        draft?.clear();
        this.settling.set(null);
      },
      () => this.settlementResult(c),
      `le règlement de « ${c.label} »`,
    );
  }

  protected bill(budgetId?: string) {
    return this.run(
      () => this.bpm.billOverruns(budgetId),
      'Moyens supplémentaires intégrés à l’enveloppe, sans nouvelle charge.',
    );
  }

  protected async onSaved(message: string) {
    this.closeExpense();
    await this.load();
    this.notice.set({ text: message, error: false });
  }
}
