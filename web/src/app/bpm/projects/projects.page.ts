import { BpmEnvelopeDialog } from './funding-dialogs';
import { BpmAmount } from '../ui/amount';
import { BPM_CORE_LINKS } from '../ui/bpm-page-path';
import { BpmCompass } from '../ui/compass';
import { injectPageWorkspace } from '../../plan/page-workspace';
import { BpmPageBanner, BpmPageContext, BpmPageFocus, bpmQueryState } from '../ui';
import { BpmProjectEditor, BpmTaskEditor } from './project-editors';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { BpmRouterLink } from '../ui/bpm-router-link';
import { newRequestKey, toApiError } from '../../core/api.service';
import { BpmApi } from '../data/bpm-api.service';
import { ProjectFunding } from '../ui/project-funding';
import {
  BpmProjectCard,
  BpmProjectsOverview,
  ProjectBudget,
  ProjectOverrun,
} from '../data/bpm-projects.models';
import { COLUMNS, PRIORITY_LABEL, TaskStatus } from '../../core/models';
import { CentsPipe } from '../../core/format';
import {
  displayDate,
  dueTitle,
  dueUrgency,
  FilterOption,
  normalizeSearch,
} from '../../projects/workspace-parts';
import { BpmProjectOverviewSummaryComponent } from './project-overview-summary';
import { BpmModal } from '../ui/modal';
import { BpmBudgetMeterComponent, BpmOverrunRequestComponent } from './project-parts';

/**
 * Projets de la vie : réimplémentation, dans Budget/Patrimoine, du tableau des projets du noyau (mêmes colonnes,
 * mêmes cartes, état calculé depuis les tâches), limitée au projet de vie et aux projets de la vie du user, et
 * enrichie du budget que le budget de vie attribue à chacun. Les projets viennent du noyau : la création y reste.
 */
@Component({
  selector: 'app-bpm-projects',
  providers: [BpmPageContext],
  imports: [BpmAmount, BpmCompass,
    BpmProjectEditor, BpmTaskEditor,
    BpmPageBanner,
    BpmProjectOverviewSummaryComponent,
    BpmRouterLink,
    CentsPipe,
    BpmModal,
    BpmBudgetMeterComponent,
    BpmEnvelopeDialog,
    BpmOverrunRequestComponent,
  ],
  styleUrls: ['./projects.page.scss', './projects-cockpit.scss'],
  templateUrl: './projects.page.html',
})
export class BpmProjectsPage implements OnInit {
  /** Enveloppe ouverte en fenêtre depuis la carte d'un projet (montant ou « À attribuer »). */
  protected readonly envelopeFor = signal<ProjectBudget | null>(null);
  protected async envelopeSaved(message: string) {
    this.envelopeFor.set(null);
    await this.load();
    this.notice.set({ text: message, error: false });
  }
  protected readonly workspace = injectPageWorkspace();
  protected readonly steeringProject = signal('');
  protected readonly steeredProject = computed(() => this.data()?.projects.find(p => p.project.id === this.steeringProject()) ?? this.data()?.projects[0] ?? null);
  protected readonly envelopeScale = signal(0);
  protected readonly envelopeDraft = signal<{ projectId: string; budgetId: string; revision: number; amount: number } | null>(null);
  protected readonly envelopeValue = computed(() => this.envelopeDraft()?.projectId === this.steeredProject()?.project.id ? this.envelopeDraft()!.amount : (this.steeredProject()?.budget?.allocationCents ?? 0) / 100);
  protected readonly envelopeMaximum = computed(() => Math.max(1000, this.envelopeScale(), (this.steeredProject()?.budget?.allocationCents ?? 0) / 50, this.envelopeValue()));
  protected selectSteeringProject(id: string) { this.steeringProject.set(id); this.envelopeDraft.set(null); this.envelopeScale.set(0); }
  protected prepareEnvelope(amount: number) {
    const project = this.steeredProject();
    if (!project?.budget || project.budget.abandoned || this.busy() || this.loading() || this.error()) return;
    const draft = this.envelopeDraft();
    this.envelopeDraft.set(draft?.projectId === project.project.id ? { ...draft, amount } : { projectId: project.project.id, budgetId: project.budget.budgetId, revision: project.budget.revision, amount });
  }
  protected async applyEnvelope() {
    const draft = this.envelopeDraft();
    if (!draft || draft.projectId !== this.steeredProject()?.project.id || this.steeredProject()?.budget?.abandoned || this.busy() || this.loading() || this.error() || !Number.isFinite(draft.amount) || draft.amount <= 0) return;
    await this.run(async () => {
      await this.bpm.allocate(draft.budgetId, draft.amount, draft.revision);
      this.envelopeDraft.set(null);
    }, 'Enveloppe enregistrée. Aucun débit du cycle ou du patrimoine.');
  }
  protected readonly reviewProjects = computed(() => this.visible().filter((p) => p.role === 'standard').sort((a, b) => this.reviewPriority(b) - this.reviewPriority(a)));
  private reviewPriority(p: BpmProjectCard) {
    return (p.budget?.pendingOverrun ? 100 : 0) + (!p.budget?.regime ? 80 : 0) +
      (p.budget?.deficit ? 60 : 0) + (p.project.dueDate && p.project.dueDate < (this.data()?.context.calculationDate ?? '') && p.view.column !== 'done' ? 40 : 0) +
      (p.view.time.taskCount === 0 ? 20 : 0);
  }
  protected reviewStep(p: BpmProjectCard): { page: string; label: string } {
    if (p.budget?.abandoned) return { page: 'budget', label: 'Ouvrir le bilan du projet' };
    if (!p.budget?.regime) return { page: 'budget', label: 'Attribuer l’enveloppe' };
    if (p.budget.pendingOverrun || (this.data()?.life.taskRequests.some((r) => r.coreProjectId === p.project.id))) return { page: 'budget', label: 'Accorder ou refuser le financement' };
    if (p.budget.deficit) return { page: 'budget', label: 'Revoir le budget' };
    if (p.view.column === 'done') return { page: 'budget', label: 'Contrôler la fin du projet' };
    return { page: 'taches', label: p.view.time.taskCount ? 'Poursuivre les tâches' : 'Préparer la première tâche' };
  }
  protected readonly coreLinks = inject(BPM_CORE_LINKS);
  private bpm = inject(BpmApi);
  /** Décisions de financement communes à toutes les pages (mêmes gestes, mêmes messages). */
  private funding = inject(ProjectFunding);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  protected columns = COLUMNS;
  protected priority = PRIORITY_LABEL;
  protected readonly date = displayDate;
  protected readonly urgency = dueUrgency;
  protected readonly dueTitle = dueTitle;
  protected data = signal<BpmProjectsOverview | null>(null);
  protected loading = signal(true);
  protected error = signal<string | null>(null);
  protected busy = signal(false);
  protected notice = signal<{ text: string; error: boolean } | null>(null);
  protected toolbarResult = computed(() => {
    const notice = this.notice();
    return notice ? { message: notice.text, tone: notice.error ? 'danger' as const : 'success' as const } : null;
  });
  protected candidate = signal('');
  /** « Autorisations et fin de cycle » : s'ouvre aussi depuis un lien (`?cycle=open`). */
  protected cycleOpen = signal(this.route.snapshot.queryParamMap.get('cycle') === 'open');
  /** Éditeur de projet par-dessus le tableau : `editProject=new` ou l'identifiant du projet. */
  protected projectEditor = bpmQueryState('editProject', '', { overlay: true });
  protected readonly taskEditor = bpmQueryState('editTask', '', { overlay: true });
  private readonly taskProject = bpmQueryState('taskProject', '');
  protected readonly taskProjectOptions = computed(() => (this.data()?.projects ?? []).filter(p => !p.budget?.abandoned).map(p => ({ projectId: p.project.id, title: p.project.title })));
  protected readonly taskProjectId = computed(() => this.taskProjectOptions().some(p => p.projectId === this.taskProject()) ? this.taskProject() : '');
  protected openTask(projectId = '') {
    this.taskProject.set(projectId);
    this.taskEditor.set('new');
  }
  protected async taskSaved(message: string) {
    this.taskEditor.set('');
    await this.load();
    this.notice.set({ text: message, error: false });
  }
  protected readonly cockpitPriorities = computed(() => {
    const projects = this.data()?.projects ?? [];
    const today = this.data()?.context.calculationDate ?? '';
    return [
      { key: 'open', label: 'Projets à poursuivre', count: projects.filter(p => !p.budget?.abandoned && p.view.column !== 'done').length, hint: 'Organiser les prochaines tâches' },
      { key: 'unfunded', label: 'Sans enveloppe', count: this.unfundedCount(), hint: 'Préparer leurs moyens' },
      { key: 'requests', label: 'Projets avec demandes', count: projects.filter(p => this.hasRequest(p.project.id)).length, hint: 'Accorder ou refuser' },
      { key: 'late', label: 'Échéances dépassées', count: projects.filter(p => !p.budget?.abandoned && p.view.column !== 'done' && p.project.dueDate && p.project.dueDate < today).length, hint: 'Revoir les dates et les tâches' },
    ];
  });
  private hasRequest(projectId: string) { return !!this.data()?.life.taskRequests.some(r => r.coreProjectId === projectId) || !!this.data()?.life.pendingRequests.some(r => r.coreProjectId === projectId); }
  protected focusProjects(attention: string) { this.setParams({ attention, project: null, q: null }); }
  protected editingProject = computed(() => this.data()?.projects.find((p) => p.project.id === this.projectEditor())?.project ?? null);
  protected projectSaved(project: { projectId: string; title: string }) {
    const created = !this.editingProject();
    this.projectEditor.set('');
    void this.load();
    this.notice.set({ text: created ? `Projet « ${project.title} » créé : attribuez-lui une enveloppe ou créez sa première tâche.` : 'Projet enregistré.', error: false });
  }
  private params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected search = computed(() => this.params().get('q') ?? '');
  protected filter = computed(() => this.params().get('project') || 'all');
  protected attention = computed(() => this.params().get('attention') || 'all');
  protected unfundedCount = computed(
    () => (this.data()?.projects ?? []).filter((p) => !p.budget?.abandoned && !p.budget?.regime).length,
  );
  protected hasPriorityAction = computed(() => {
    const data = this.data();
    return !!data && !!(data.life.pendingRequests.length || data.life.billable.length || data.life.taskRequests.length || this.unfundedCount());
  });
  protected toolbarScope = computed(() => `Section · tous les projets de la vie · Vue : ${this.visible().length} / ${this.cards().length} projet(s)`);
  protected pageFocus = computed<BpmPageFocus>(() => {
    const d = this.data();
    if (this.error())
      return {
        title: 'Les projets n’ont pas pu être actualisés',
        detail: this.error()!,
        tone: 'danger',
      };
    if (!d) return { title: 'Lecture des projets et de leur financement…', tone: 'info' };
    if (d.life.pendingRequests.length)
      return {
        title: `${d.life.pendingRequests.length} autorisation(s) de dépassement attendent votre décision`,
        detail: 'Examinez les montants avant de poursuivre les opérations des projets.',
        tone: 'warning',
      };
    if (d.life.taskRequests.length)
      return {
        title: `${d.life.taskRequests.length} demande(s) de tâche à décider`,
        detail:
          'La gestion de projet permet d’accorder les parts disponibles ou de traiter le financement manquant.',
        tone: 'warning',
      };
    if (this.unfundedCount())
      return {
        title: `${this.unfundedCount()} projet(s) attendent leur enveloppe`,
        detail: 'Attribuez un budget avant de faire remonter leurs règlements au projet de vie.',
        tone: 'warning',
      };
    if (!d.projects.length)
      return {
        title: 'Préparez votre premier projet de la vie',
        detail: 'Créez le projet, puis ses tâches ; le budget peut être attribué ensuite.',
        tone: 'info',
      };
    return {
      title: `${this.visible().length} projet(s) dans cette vue · ${d.life.fundedCount} avec enveloppe`,
      detail:
        'Choisissez une priorité de suivi pour retrouver les projets qui demandent une action.',
      tone: 'success',
    };
  });

  /** Le projet de vie porte l'accueil ; ce tableau rassemble ses projets de la vie. */
  private cards = computed<BpmProjectCard[]>(() => {
    const d = this.data();
    return d?.projects ?? [];
  });
  protected filterOptions = computed<FilterOption[]>(() => [
    { value: 'all', label: 'Tous les projets de la vie' },
    ...this.cards().map((p) => ({ value: p.project.id, label: p.project.title })),
  ]);
  protected visible = computed(() => {
    const q = normalizeSearch(this.search().trim());
    const f = this.filter();
    return this.cards().filter(
      (p) =>
        (f === 'all' || p.project.id === f) &&
        this.matchesAttention(p) &&
        (!q ||
          normalizeSearch(`${p.project.title} ${p.project.description} ${p.project.id}`).includes(
            q,
          )),
    );
  });
  protected byColumn = computed(() => {
    const groups = Object.fromEntries(COLUMNS.map((c) => [c.id, [] as BpmProjectCard[]])) as Record<
      TaskStatus,
      BpmProjectCard[]
    >;
    for (const p of this.visible()) groups[p.view.column].push(p);
    return groups;
  });
  ngOnInit() {
    this.load();
  }

  async load() {
    this.error.set(null);
    try {
      this.data.set(await this.bpm.projectsOverview());
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected setParams(patch: {
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

  private matchesAttention(p: BpmProjectCard): boolean {
    const mode = this.attention();
    if (mode === 'open') return p.role === 'standard' && !p.budget?.abandoned && p.view.column !== 'done';
    if (mode === 'unfunded') return p.role === 'standard' && !p.budget?.abandoned && !p.budget?.regime;
    if (mode === 'deficit') return !!p.budget?.deficit;
    if (mode === 'requests')
      return this.hasRequest(p.project.id);
    if (mode === 'late')
      return (
        p.role === 'standard' && !p.budget?.abandoned && p.view.column !== 'done' &&
        !!p.project.dueDate &&
        p.project.dueDate < (this.data()?.context.calculationDate ?? '')
      );
    return true;
  }

  protected progressLabel(p: BpmProjectCard): string {
    const open = p.view.time.taskCount - p.view.doneCount;
    return `${open} ${open === 1 ? 'tâche' : 'tâches'} à suivre`;
  }
  protected progressTitle(p: BpmProjectCard): string {
    return `${p.view.doneCount}/${p.view.time.taskCount} tâches terminées · ${p.view.completionPercent} %`;
  }

  private async run<T>(action: () => Promise<T>, success: string | ((result: T) => string)) {
    if (this.busy()) return;
    this.busy.set(true);
    this.notice.set(null);
    try {
      const result = await action();
      await this.load();
      this.notice.set({
        text: typeof success === 'function' ? success(result) : success,
        error: false,
      });
    } catch (err) {
      const e = toApiError(err);
      await this.load();
      this.notice.set({
        text: e.isConflict
          ? 'Conflit : la donnée a changé ailleurs. La page a été relue ; recommencez si besoin.'
          : e.message,
        error: true,
      });
    } finally {
      this.busy.set(false);
    }
  }

  protected decide(o: ProjectOverrun, decision: 'approve' | 'refuse') {
    return this.run(
      () => this.funding.decide(o, decision),
      (r) => `« ${o.budgetName} » · ${r.message}`,
    );
  }

  protected bill() {
    return this.run(
      () => this.bpm.billOverruns(),
      'Moyens supplémentaires intégrés aux enveloppes, sans nouvelle charge.',
    );
  }

  protected adopt() {
    const id = this.candidate();
    if (!id || !this.data()?.candidates.some((c) => c.projectId === id)) return;
    const title = this.data()?.candidates.find((c) => c.projectId === id)?.title ?? '';
    return this.run(async () => {
      await this.bpm.adoptProject({ requestKey: newRequestKey(), coreProjectId: id });
      this.candidate.set('');
    }, `« ${title} » est maintenant rattaché au budget du projet de vie. Attribuez-lui une enveloppe depuis sa fiche.`);
  }
}
