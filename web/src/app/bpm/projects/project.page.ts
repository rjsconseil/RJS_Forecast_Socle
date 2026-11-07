import { injectPageWorkspace } from '../../shared/page-workspace';
import { PageObjectLabels } from '../../shared/plan-context';
import { projectLink } from '../../shared/site-plan';
import { BpmPageContext } from '../ui/page-context';
import { bpmQueryState } from '../ui/query-state';
import { BpmFormDraft } from '../ui/form-draft';
import { BpmPageBanner, BpmPageFocus } from '../ui';
import {
  afterNextRender,
  Component,
  computed,
  HostListener,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, newRequestKey, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmBudgetRef, RegisterLine } from '../../core/bpm-models';
import {
  BpmProjectDetail,
  BpmTaskCard,
  OverrunRefusal,
  ProjectChargeLine,
  ProjectOverrun,
  ReturnCadence,
  TaskBudgetRequest,
} from '../../core/bpm-projects.models';
import { COLUMNS, TASK_STATUS_LABEL, TaskStatus } from '../../core/models';
import { cents, CentsPipe, parseAmount, ShortDatePipe } from '../../core/format';
import { FUNDING, FUNDING_ACTIONS, FUNDING_RESULTS, ProjectFunding } from '../ui/project-funding';
import { BpmEntryFlow } from '../ui/entry-flow';
import { BpmLineDetail } from '../ui/line-detail';
import { BpmOverflowDirective } from '../ui/overflow';
import { BpmModal } from '../ui/modal';
import { BpmLifeFundingComponent } from '../life/life-funding';
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

const today = () => new Date().toISOString().slice(0, 10);
const RETURN_CADENCES: { id: ReturnCadence; label: string }[] = [
  { id: 'once', label: 'Ponctuel' },
  { id: 'weekly', label: 'Hebdomadaire' },
  { id: 'monthly', label: 'Mensuel' },
  { id: 'yearly', label: 'Annuel' },
];

/** Action refusée faute de budget, en attente de la décision du budget de vie. */
const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Écriture de la page. `fund` : rejouée après un refus de financement, elle demande au middleware Budget d'accorder
 * dans la même écriture la part et le dépassement nécessaires (règlement financé, part avec dépassement autorisé).
 */
type Write<T> = (fund?: boolean) => Promise<T>;

/** Règlement refusé faute de part suffisante (projet en mode strict) : la part est accordée avec le règlement. */
interface ShareFlow {
  gap: {
    budgetId: string;
    taskId: string;
    taskTitle: string;
    shareCents: number | null;
    neededCents: number;
    availableCents: number;
    grantOverrunCents: number;
  };
  message: string;
  label: string;
  retry: Write<unknown>;
}

interface OverrunFlow {
  refusal: OverrunRefusal;
  message: string;
  label: string;
  retry: Write<unknown>;
  request: ProjectOverrun | null;
}

/**
 * Fiche BPM d'un projet de la vie. Projet standard : budget attribué par le budget de vie (charge non récurrente
 * spéciale du budget de vie), ventilation sur les tâches, dépenses du projet et validation de leur règlement,
 * dépassements autorisés par le budget de vie, retours de revenus à la complétion des tâches, contrôles de fin de
 * cycle. Projet de vie : les projets qu'il finance et les décisions qui lui reviennent. Le projet et ses tâches
 * restent ceux du noyau (création, édition) ; leur état et leur rattachement passent par les commandes du noyau.
 */
@Component({
  selector: 'app-bpm-project',
  providers: [BpmPageContext],
  imports: [
    BpmPageBanner,
    NgTemplateOutlet,
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    CdkDropListGroup,
    RouterLink,
    CentsPipe,
    ShortDatePipe,
    BpmOverrunRequestComponent,
    BpmEntryFlow,
    BpmFormDraft,
    BpmLineDetail,
    BpmTaskRequestsComponent,
    BpmLifeFundingComponent,
    BpmProjectEditor,
    BpmTaskEditor,
    BpmOverflowDirective,
    BpmModal,
  ],
  templateUrl: './project.page.html',
  styleUrls: ['./projects.page.scss', './project.page.scss'],
})
export class BpmProjectPage {
  protected readonly workspace = injectPageWorkspace();
  protected readonly workspaceKey = computed(() => this.workspace()?.key);
  protected ctx = inject(BpmPageContext);
  private api = inject(Api);
  private bpm = inject(BpmApi);
  /** Gestes de financement partagés avec la fiche d'échéance et la page projet de vie. */
  private funding = inject(ProjectFunding);
  protected readonly L = FUNDING;
  protected readonly act = FUNDING_ACTIONS;
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private injector = inject(Injector);
  private document = inject(DOCUMENT);
  private objectLabels = inject(PageObjectLabels);
  private pendingSection: string | null = null;
  private loadSequence = 0;
  protected columns = COLUMNS;
  protected cadences = RETURN_CADENCES;
  protected readonly today = today();
  protected data = signal<BpmProjectDetail | null>(null);
  protected availableTasks = computed(() =>
    (this.data()?.attachable ?? []).filter((t) => !t.task.projectId && t.pathways.canChangeProject),
  );
  protected error = signal<string | null>(null);
  protected busy = signal(false);
  protected notice = signal<{ text: string; error: boolean } | null>(null);
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
  protected flow = signal<OverrunFlow | null>(null);
  protected shareFlow = signal<ShareFlow | null>(null);
  protected allocation = signal('');
  protected returnEditor = bpmQueryState<string | null>('retour', null, { overlay: true });
  protected settling = bpmQueryState<string | null>('reglement', null, { overlay: true });
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
  private requestKeys = new Map<string, string>();
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
  protected nextActionLabel = computed(() => {
    const d = this.data();
    if (!d?.budget?.regime) return 'Attribuer l’enveloppe';
    if (this.pendingDecisions().length || this.pendingTaskRequests().length)
      return 'Traiter les décisions de financement';
    if (this.nextCharge()) return 'Préparer le prochain règlement';
    if (this.hasTaskSelection() && !this.visibleTasks().length) return 'Réinitialiser la sélection';
    const t = this.nextTask();
    if (t?.task.status === 'blocked') return 'Revoir une tâche bloquée';
    if (t && this.isLate(t)) return 'Revoir une tâche en retard';
    if (t?.task.status === 'done') return 'Libérer une part non consommée';
    if (t) return 'Poursuivre une tâche';
    return d?.tasks.length ? 'Vérifier la fin de cycle' : 'Créer la première tâche';
  });
  protected pageFocus = computed<BpmPageFocus>(() => {
    const d = this.data();
    if (!d) return { title: 'Lecture du projet…', tone: 'info' };
    if (this.error())
      return { title: 'L’actualisation du projet a échoué', detail: this.error()!, tone: 'danger' };
    if (d.role === 'standard' && !d.budget?.regime)
      return {
        title: 'L’enveloppe de ce projet reste à attribuer',
        detail:
          'Attribuez un budget avant d’accorder les demandes des tâches. Les règlements sans enveloppe restent hors budget du projet de vie.',
        tone: 'warning',
      };
    if (d.role === 'standard' && this.hasTaskSelection() && !this.visibleTasks().length)
      return { title: 'Aucune tâche ne correspond à cette sélection', detail: 'Adaptez la recherche et la priorité de suivi pour retrouver les tâches du projet.', tone: 'info' };
    const decisions = this.pendingDecisions().length + this.pendingTaskRequests().length;
    if (decisions)
      return {
        title: `${decisions} décision(s) de financement en attente`,
        detail:
          'Accordez les montants des tâches et les autorisations nécessaires avant de poursuivre.',
        tone: 'warning',
      };
    if (d.role === 'life')
      return {
        title: `${d.life?.fundedCount ?? 0} projet(s) financé(s) par le projet de vie`,
        detail:
          'Gérez les ressources, les échéances et le financement des projets dans la vision du projet de vie.',
        tone: 'info',
      };
    const charge = this.nextCharge();
    if (charge)
      return {
        title: `Règlement à préparer : ${charge.label}`,
        detail: `${cents(charge.plannedCents)} prévus le ${displayDate(charge.plannedDate)}. Validez seulement après le paiement réel.`,
        tone: 'warning',
      };
    const task = this.nextTask();
    if (task?.task.status === 'blocked')
      return {
        title: `Tâche bloquée : ${task.task.title}`,
        detail: 'Ouvrez la tâche pour revoir sa planification, son budget et son statut.',
        tone: 'warning',
      };
    if (task && this.isLate(task))
      return {
        title: `Échéance dépassée : ${task.task.title}`,
        detail: 'Vérifiez son avancement ou ajustez sa date depuis la tâche.',
        tone: 'warning',
      };
    if (task?.task.status === 'done')
      return {
        title: `${cents(task.budget?.unusedCents ?? 0)} peuvent revenir à l’enveloppe`,
        detail: `« ${task.task.title} » est terminée ; vérifiez les règlements puis libérez sa part inutilisée.`,
        tone: 'info',
      };
    if (!d.tasks.length)
      return {
        title: 'Le projet est financé ; préparez sa première tâche',
        detail: 'Créez une tâche ou rattachez-en une depuis les outils.',
        tone: 'info',
      };
    return {
      title: `${this.doneCount()} / ${d.tasks.length} tâches terminées · ${d.project.view.statusLabel}`,
      detail: task
        ? `À poursuivre : ${task.task.title}. Les montants portent sur toute la durée du projet.`
        : 'Toutes les tâches sont terminées. Vérifiez les parts restantes et les contrôles de fin de cycle.',
      tone: 'success',
    };
  });
  /** Contexte de retour uniquement : la fiche du projet reste lue sur toute sa durée. */
  protected lifePeriod = signal<string | null>(null);
  protected allocationEditing = signal(false);
  protected allocationRevision = signal(0);
  protected allocationError = signal<string | null>(null);
  protected query = bpmQueryState('q', '', { replace: true });
  protected fundingTask = bpmQueryState<string | null>('demande', null, { overlay: true });
  /** Tâche ouverte dans sa fenêtre : la carte du tableau garde une taille fixe. */
  protected openTaskId = bpmQueryState<string | null>('task', null, { overlay: true });
  protected openTask = computed(() => {
    const id = this.openTaskId();
    return id ? ((this.data()?.tasks ?? []).find((t) => t.task.id === id) ?? null) : null;
  });
  protected expenseTaskId = bpmQueryState<string | null>('expenseTask', null, { overlay: true });
  /** Sens de la saisie ouverte : dépense, ou remboursement reçu (déduit du réglé de la tâche et du projet). */
  protected expenseDirection = bpmQueryState<'charge' | 'income'>('expenseDirection', 'charge', { overlay: true });
  protected dragActive = signal(false);
  protected dropTarget = signal<TaskStatus | null>(null);
  private dragCancelled = false;
  protected readonly date = displayDate;
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
  protected budgetTiles = computed<MetricTile[]>(() => {
    const b = this.data()?.budget;
    if (!b) return [];
    // Variante non standard (projet de vie) : mêmes tuiles, lues sur les ressources du cycle en cours.
    if (b.kind === 'life') {
      return [
        {
          id: 'envelope',
          label: 'Entrées prévues du cycle',
          value: b.regime ? cents(b.allocationCents) : 'Cycle à configurer',
          tone: 'accent',
          note: b.life?.period
            ? `Ressources du budget du projet de vie · ${b.life.period.label}`
            : 'Ressources du budget du projet de vie',
        },
        {
          id: 'paid',
          label: 'Dépensé du cycle',
          value: cents(b.paidCents),
          tone: 'danger',
          note: `dont ${cents(b.life?.projectsPaidCents ?? 0)} remontés par ses projets`,
        },
        {
          id: 'remaining',
          label: 'Reste sur les entrées',
          value: cents(b.remainingCents),
          tone: b.remainingCents === null ? null : b.remainingCents < 0 ? 'danger' : 'success',
          note: 'Entrées prévues − Dépensé',
        },
        {
          id: 'toPay',
          label: 'Encore à régler',
          value: cents(b.toPayCents),
          tone: 'warning',
          note: 'Charges prévues du cycle non réglées',
        },
      ];
    }
    return [
      {
        id: 'envelope',
        label: FUNDING.envelope,
        value: b.regime ? cents(b.allocationCents) : 'À attribuer',
        tone: 'accent',
        note: !b.regime
          ? 'Sans enveloppe, ses dépenses restent hors budget de vie'
          : b.approvedOverrunCents
            ? `Depuis le ${displayDate(b.allocationDate!)} · + ${cents(b.approvedOverrunCents)} de dépassement autorisé`
            : `Par le projet de vie, le ${displayDate(b.allocationDate!)}`,
      },
      {
        id: 'paid',
        label: b.regime ? FUNDING.paidOnEnvelope : FUNDING.paidOutside,
        value: cents(b.paidCents),
        tone: 'danger',
        note: !b.regime
          ? 'Règlements validés, non comptés dans le projet de vie'
          : b.paidBeforeAllocationCents
            ? `Depuis l’attribution · ${cents(b.paidBeforeAllocationCents)} réglés avant, hors enveloppe`
            : 'Règlements validés depuis l’attribution',
      },
      {
        id: 'remaining',
        label: FUNDING.remaining,
        value: b.regime ? cents(b.remainingCents) : '—',
        tone: b.remainingCents === null ? null : b.remainingCents < 0 ? 'danger' : 'success',
        note: b.regime
          ? 'Enveloppe − réglé sur l’enveloppe'
          : 'Attribuez une enveloppe pour suivre le reste',
      },
      {
        id: 'toPay',
        label: FUNDING.toPay,
        value: cents(b.toPayCents),
        tone: 'warning',
        note: 'Dépenses engagées non réglées',
      },
    ];
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
          this.router.navigate(['/app/gestion-projet', this.projectId, 'budget'], { queryParamsHandling: 'preserve', fragment: 'charges-title' });
          return;
        }
        this.revealSection('charges-title');
      }
      this.settling.set(charge.id);
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
      this.showTask(task, task.task.status === 'done' ? 'funding' : null);
      return;
    }
    if (d.tasks.length && this.workspaceKey() === 'project-tasks')
      this.router.navigate(['/app/gestion-projet', this.projectId, 'budget'], { queryParamsHandling: 'preserve', fragment: 'cycle-title' });
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

  protected statusLabel(s: TaskStatus) {
    return TASK_STATUS_LABEL[s];
  }
  /** Ouvre la fenêtre de la tâche, au besoin sur sa part (demande) ou ses dépenses. */
  protected showTask(t: BpmTaskCard, section: 'funding' | 'charges' | null = null) {
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
  protected closeTaskPanel() {
    this.openTaskId.set(null);
    this.fundingTask.set(null);
    this.returnEditor.set(null);
    this.settling.set(null);
  }

  protected taskCharges(id: string) {
    return (this.data()?.charges ?? []).filter((c) => c.taskId === id);
  }
  protected taskHistory(id: string) {
    return this.requestHistory().filter((r) => r.taskId === id);
  }
  protected taskOverruns(id: string) {
    return (this.data()?.overruns ?? []).filter(
      (o) => o.taskId === id && o.status === 'pending' && o.id !== this.flow()?.request?.id,
    );
  }
  protected timeWidth(t: BpmTaskCard) {
    const p = t.budget?.timeConsumptionPercent;
    return p === null || p === undefined ? null : Math.min(100, Math.max(0, p));
  }
  protected timeTone(t: BpmTaskCard) {
    const p = t.budget?.timeConsumptionPercent;
    return p === null || p === undefined
      ? 'unknown'
      : p >= 100
        ? 'green'
        : p >= 50
          ? 'yellow'
          : 'blue';
  }
  protected createTask() {
    this.taskEditorId.set('new');
  }
  protected editTask(t: BpmTaskCard) {
    this.taskEditorId.set(t.task.id);
  }
  protected addExpense(taskId: string | null) {
    this.expenseTaskId.set(taskId);
    this.expenseDirection.set('charge');
    this.entryId.set('new');
  }
  protected addRefund(taskId: string) {
    this.expenseTaskId.set(taskId);
    this.expenseDirection.set('income');
    this.entryId.set('new');
  }
  protected openCharge(c: ProjectChargeLine) {
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
  protected editAllocation() {
    if (this.workspaceKey() === 'project-tasks') {
      this.router.navigate(['/app/gestion-projet', this.projectId, 'budget'], {
        queryParams: { task: null }, queryParamsHandling: 'merge', fragment: 'enveloppe',
      });
      return;
    }
    const b = this.data()?.budget;
    if (!b) return;
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
      this.requestKeys.clear();
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
        for (const signature of this.requestKeys.keys()) {
          const [budgetId, taskId] = JSON.parse(signature);
          if (budgetId === request.budgetId && taskId === request.taskId)
            this.requestKeys.delete(signature);
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

  protected cadenceLabel(c: ReturnCadence) {
    return RETURN_CADENCES.find((x) => x.id === c)?.label.toLowerCase() ?? c;
  }

  protected chargeState(c: ProjectChargeLine) {
    if (c.refund)
      return c.validated
        ? 'Remboursement · déduit du projet de vie'
        : c.settled
          ? 'Remboursement · hors budget de vie'
          : 'Remboursement attendu';
    if (c.validated) return 'Réglée · remontée au projet de vie';
    if (c.beforeAllocation) return 'Réglée · avant l’enveloppe';
    if (c.settled) return 'Réglée · hors budget de vie';
    return c.kind === 'occurrence' ? 'Échéance à régler' : 'À régler';
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

  protected defaultDate(c: ProjectChargeLine) {
    return c.plannedDate <= today() ? c.plannedDate : today();
  }

  /**
   * Écriture avec relecture. Un refus « autorisation de dépassement requise » ouvre la demande au budget de vie ;
   * une fois le dépassement autorisé, la même écriture est rejouée.
   */
  private async run<T>(action: Write<T>, success: string | ((result: T) => string), label = '') {
    if (this.busy()) return false;
    this.busy.set(true);
    this.notice.set(null);
    try {
      const result = await action();
      this.flow.set(null);
      this.shareFlow.set(null);
      await this.load();
      this.notice.set({
        text: typeof success === 'function' ? success(result) : success,
        error: false,
      });
      return true;
    } catch (err) {
      const e = toApiError(err);
      const gap = e.body.details as unknown as (ShareFlow['gap'] & { reason?: string }) | undefined;
      if (e.body.code === 'FORBIDDEN_BY_RULE' && gap?.reason === 'task-share' && label) {
        this.shareFlow.set({ gap, message: e.message, label, retry: action });
        this.revealControl('project-share-flow');
        return false;
      }
      if (e.body.code === 'OVERRUN_AUTHORIZATION_REQUIRED') {
        this.flow.set({
          refusal: e.body.details as unknown as OverrunRefusal,
          message: e.message,
          label,
          retry: action,
          request: null,
        });
        this.revealControl('project-overrun-flow');
        return false;
      }
      await this.load();
      this.notice.set({
        text: e.isConflict
          ? 'Conflit : la donnée a changé ailleurs. La fiche a été relue ; recommencez si besoin.'
          : e.message,
        error: true,
      });
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /** Rejoue l'écriture refusée en la finançant : la part (et son dépassement éventuel) est accordée dans la même écriture. */
  protected grantShareFlow() {
    const sf = this.shareFlow();
    if (!sf) return;
    this.shareFlow.set(null);
    const granted = FUNDING_RESULTS.granted(
      sf.gap.taskTitle,
      sf.gap.neededCents,
      sf.gap.grantOverrunCents,
    );
    return this.run(
      () => sf.retry(true),
      `${granted} ${capitalize(sf.label)} est enregistré.`,
      sf.label,
    );
  }

  /** Geste nominal : vous pilotez aussi le projet de vie, l'écriture refusée est rejouée avec son dépassement autorisé. */
  protected authorizeFlow() {
    const f = this.flow();
    if (!f) return;
    return this.run(
      () => f.retry(true),
      `${FUNDING_RESULTS.approved} ${capitalize(f.label || 'l’écriture')} est enregistrée.`,
      f.label,
    );
  }

  /** Variante : déposer la demande sans décider ; elle attend dans les décisions du projet de vie. */
  protected async requestAuthorization() {
    const f = this.flow();
    if (!f) return;
    this.busy.set(true);
    try {
      const r = await this.funding.request(f.refusal.budgetId, {
        taskId: f.refusal.taskId,
        reason: f.refusal.reason,
        overrunCents: f.refusal.overrunCents,
      });
      this.flow.set({ ...f, request: r.overrun });
    } catch (err) {
      this.notice.set({ text: toApiError(err).message, error: true });
    } finally {
      this.busy.set(false);
    }
  }

  /** Décision du budget de vie sur la demande ouverte par une écriture refusée ; autoriser rejoue l'écriture. */
  protected async decideFlow(decision: 'approve' | 'refuse') {
    const f = this.flow();
    if (!f?.request) return;
    this.busy.set(true);
    let decided: { message: string };
    try {
      decided = await this.funding.decide(f.request, decision);
    } catch (err) {
      this.busy.set(false);
      this.notice.set({ text: toApiError(err).message, error: true });
      return;
    }
    this.busy.set(false);
    if (decision === 'refuse') {
      this.flow.set(null);
      await this.load();
      this.notice.set({ text: `${decided.message} Rien n’a été enregistré.`, error: false });
      return;
    }
    await this.run(
      () => f.retry(),
      `${decided.message} ${capitalize(f.label || 'l’écriture')} est enregistrée.`,
      f.label,
    );
  }

  protected decide(o: ProjectOverrun, decision: 'approve' | 'refuse') {
    return this.run(
      () => this.funding.decide(o, decision),
      (r) => r.message,
    );
  }

  /** Exécute le geste proposé par un contrôle : l'enveloppe ramenée à ce qui a servi (règle et refus côté API). */
  protected async applyCheck(budgetId: string, amountCents: number, label: string) {
    if (this.busy()) return;
    this.busy.set(true);
    this.notice.set(null);
    try {
      await this.bpm.allocate(budgetId, amountCents / 100, this.allocationRevision());
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
    const amount = parseAmount(this.allocation());
    if (amount === null || amount === 'invalid' || amount < 0) {
      this.allocationError.set(
        'Indiquez un montant positif ou nul en euros, avec deux décimales au plus.',
      );
      return;
    }
    this.busy.set(true);
    this.allocationError.set(null);
    this.notice.set(null);
    try {
      await this.bpm.allocate(budgetId, amount, revision);
      this.allocationEditing.set(false);
      await this.load();
      this.notice.set({ text: 'Enveloppe budgétaire enregistrée.', error: false });
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

  protected saveShare(budgetId: string, t: BpmTaskCard, raw: string, revision: number) {
    const amount = parseAmount(raw);
    if (amount === 'invalid' || (amount !== null && amount < 0)) {
      this.notice.set({
        text: 'Indiquez une part en euros (deux décimales au plus), ou laissez vide pour la retirer.',
        error: true,
      });
      return;
    }
    return this.run(
      (fund) =>
        this.bpm.setTaskShare(budgetId, t.task.id, amount, revision, { authorizeOverrun: fund }),
      amount === null
        ? `Part de « ${t.task.title} » retirée.`
        : `Part de « ${t.task.title} » enregistrée.`,
      `la part de « ${t.task.title} »`,
    );
  }

  /** Tâche terminée : la part non consommée revient à l'enveloppe (part ramenée au réglé, par le middleware). */
  protected releaseShare(budgetId: string, t: BpmTaskCard, revision: number) {
    return this.run(
      () => this.funding.releaseShare({ budgetId, taskId: t.task.id, revision }),
      (r) => r.message,
    );
  }

  protected async requestBudget(
    budgetId: string,
    t: BpmTaskCard,
    controls: HTMLFormControlsCollection,
    draft?: BpmFormDraft,
  ) {
    const get = (name: string) => (controls.namedItem(name) as HTMLInputElement).value;
    const amount = parseAmount(get('amount'));
    if (amount === null || amount === 'invalid' || amount <= 0) {
      this.notice.set({
        text: 'Indiquez le montant total souhaité en euros, avec deux décimales au plus.',
        error: true,
      });
      return;
    }
    const note = get('note');
    const signature = JSON.stringify([budgetId, t.task.id, amount, note]);
    const requestKey = this.requestKeys.get(signature) ?? newRequestKey();
    this.requestKeys.set(signature, requestKey);
    const ok = await this.run(async () => {
      await this.bpm.requestTaskBudget(budgetId, t.task.id, { requestKey, amount, note });
      this.requestKeys.delete(signature);
    }, `Demande de « ${t.task.title} » enregistrée. Validez-la dans sa carte.`);
    if (ok) { draft?.clear(); this.fundingTask.set(null); }
    return ok;
  }

  protected decideRequest(e: {
    request: TaskBudgetRequest;
    decision: 'approve' | 'refuse' | 'cancel';
  }) {
    const revision = this.data()?.budget?.revision;
    return this.run(
      () => this.funding.decideTaskRequest(e.request, e.decision, revision),
      (r) => r.message,
    );
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

  protected async saveReturn(
    budgetId: string,
    t: BpmTaskCard,
    f: HTMLFormControlsCollection,
    revision: number,
    draft?: BpmFormDraft,
  ) {
    const get = (n: string) =>
      (f.namedItem(n) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
    const amount = parseAmount(get('amount'));
    if (amount === null || amount === 'invalid' || amount <= 0) {
      this.notice.set({ text: 'Indiquez le montant du retour en euros.', error: true });
      return;
    }
    const ok = await this.run(
      () =>
        this.bpm.setTaskReturn(budgetId, t.task.id, {
          label: get('label'),
          amount,
          cadence: get('cadence') as ReturnCadence,
          expectedRevision: revision,
        }),
      t.task.status === 'done'
        ? `Retour enregistré dans le budget du projet de vie : « ${t.task.title} » est déjà terminée.`
        : `Retour prévu : il sera enregistré dans le budget du projet de vie quand « ${t.task.title} » sera terminée.`,
    );
    if (ok) { draft?.clear(); this.returnEditor.set(null); }
  }

  protected removeReturn(budgetId: string, t: BpmTaskCard, revision: number) {
    return this.run(
      () =>
        this.bpm.setTaskReturn(budgetId, t.task.id, { amount: null, expectedRevision: revision }),
      `Retour de « ${t.task.title} » retiré.`,
    );
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

  protected detach(t: BpmTaskCard) {
    return this.run(
      () => this.api.detachTask(t.task.id, t.task.revision),
      `« ${t.task.title} » détachée du projet. Elle reste disponible pour un autre rattachement.`,
    );
  }

  protected settle(c: ProjectChargeLine, f: HTMLFormControlsCollection, draft?: BpmFormDraft) {
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
      'Dépassements facturés au budget du projet de vie : l’enveloppe budgétaire les intègre. Consultez les contrôles de fin de cycle.',
    );
  }

  protected async onSaved(message: string) {
    this.closeExpense();
    await this.load();
    this.notice.set({ text: message, error: false });
  }
}
