import { BpmAmount } from '../ui/amount';
import { cycleReadingText } from './life-cycle-summary';
import { BpmCompass } from '../ui/compass';
import { injectPageWorkspace } from '../../plan/page-workspace';
import { BpmLifeTopicSummary } from './life-topic-summary';
import { LIFE_TOPICS } from './life-topics';
import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { BpmRouterLink } from '../ui/bpm-router-link';
import { RecetteContext, toApiError } from '../../core/api.service';
import { BpmApi } from '../data/bpm-api.service';
import { BpmLifeManagement, LifeLine } from '../data/bpm-life.models';
import { CHARGE_NATURE_LABEL, ChargeNature, EntryInput, RegisterLine } from '../data/bpm-models';
import { ProjectOverrun } from '../data/bpm-projects.models';
import { CentsPipe, ShortDatePipe, SignedCentsPipe } from '../../core/format';
import { BpmOverrunRequestComponent } from '../projects/project-parts';
import { BpmPageBanner, BpmPageFocus, BpmPageResult, BpmPageContext, BpmEntryFlow, bpmQueryState, BpmLineDetail, BpmRefresh, FUNDING, ProjectFunding, BpmQuickSettle } from '../ui';
import { BpmActBudgetType } from '../pages/act-budget-type';
import { BpmFragmentNavigation } from '../ui/fragment-navigation';
import { BpmLifeFundingComponent } from './life-funding';
import { lifeVolet } from './life-volets';

@Component({
  selector: 'app-bpm-life-management',
  providers: [BpmPageContext],
  styleUrls: ['../projects/projects.page.scss', './life-management.page.scss', './life-cockpit.scss'],
  imports: [BpmAmount, BpmCompass, BpmLifeTopicSummary, BpmQuickSettle, BpmEntryFlow, BpmPageBanner, BpmRouterLink, NgTemplateOutlet, CentsPipe, SignedCentsPipe, ShortDatePipe, BpmOverrunRequestComponent, BpmLineDetail, BpmLifeFundingComponent, BpmActBudgetType, BpmFragmentNavigation],
  templateUrl: './life-management.page.html',
})
export class BpmLifeManagementPage {
  protected ctx = inject(BpmPageContext);
  private bpm = inject(BpmApi);
  private funding = inject(ProjectFunding);
  protected readonly L = FUNDING;
  private route = inject(ActivatedRoute);
  protected readonly workspace = injectPageWorkspace();
  protected budgetType = viewChild(BpmActBudgetType);
  private refresh = inject(BpmRefresh);
  private context = inject(RecetteContext);
  private sequence = 0;
  private readingOwner = this.context.userId();
  /** Période consultée (`?period=AAAA-MM`) ; absente = période en cours. */
  private periodKey = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  protected period = computed(() => this.periodKey().get('period') || undefined);
  protected data = signal<BpmLifeManagement | null>(null);
  protected loading = signal(false);
  protected error = signal('');
  protected busy = signal(false);
  protected mutationBlocked = computed(() => this.busy() || this.loading() || !!this.error());
  protected notice = signal<{ text: string; error: boolean } | null>(null);
  protected dueFilter = bpmQueryState<'all' | 'late' | 'income' | 'charge'>('due', 'all', { parse: value => value === 'late' || value === 'income' || value === 'charge' ? value : 'all' });
  protected dueSearch = signal('');
  protected lineId = bpmQueryState<string | null>('ligne', null, { overlay: true });
  protected entryDefaults = computed<Partial<EntryInput>>(() => ({ direction: this.ctx.query().get('entryDirection') === 'income' ? 'income' : 'charge' }));

  protected budgets = computed(() => this.data()?.context.budgets ?? []);
  protected readonly prioritizeFundedProjects = this.route.snapshot.data['astraSlug'] === 'financement/enveloppes';
  protected readonly topic = computed(() => {
    const key = LIFE_TOPICS.find(topic => this.workspace()?.key === 'life-' + topic.key)?.key;
    const data = this.data();
    return data && key && key !== 'echeances' && key !== 'financement' ? lifeVolet(key, data) : null;
  });
  protected readonly fundedProjects = computed(() => this.data()?.projects.projects.filter(project => project.regime) ?? []);
  protected readonly detailTitle = computed(() => {
    switch (this.topic()?.key) {
      case 'cycle': return 'Entrées et écarts au budget';
      case 'indispensable':
      case 'courante': return 'Postes et échéances du cycle';
      case 'projets': return 'Enveloppes par projet';
      default: return 'Origine du patrimoine';
    }
  });
  protected dueQueue = computed(() => [...(this.data()?.dueSoon.lines ?? [])]
    .sort((a, b) => Number(b.status === 'late') - Number(a.status === 'late') || a.plannedDate.localeCompare(b.plannedDate) || a.id.localeCompare(b.id)));
  protected nextDue = computed(() => this.dueQueue()[0] ?? null);
  protected dueStats = computed(() => this.dueQueue().reduce((s, line) => {
    if (line.status === 'late') s.late++;
    if (line.direction === 'income') { s.incomeCount++; s.incomeCents += line.plannedCents; }
    else { s.chargeCount++; s.chargeCents += line.plannedCents; }
    return s;
  }, { late: 0, incomeCount: 0, incomeCents: 0, chargeCount: 0, chargeCents: 0 }));
  protected filteredDue = computed(() => {
    const filter = this.dueFilter();
    const search = this.dueSearch().trim().toLocaleLowerCase('fr');
    return this.dueQueue().filter(line => (filter === 'all' || (filter === 'late' ? line.status === 'late' : line.direction === filter))
      && (!search || [line.label, line.project?.name, line.project?.taskTitle, line.costCenterLabel].filter(Boolean).join(' ').toLocaleLowerCase('fr').includes(search)));
  });
  protected fundingActions = computed(() => (this.data()?.projects.projects ?? [])
    .filter(project => project.state !== 'ok')
    .sort((a, b) => ({ deficit: 0, 'at-risk': 1, unallocated: 2, ok: 3 }[a.state] - { deficit: 0, 'at-risk': 1, unallocated: 2, ok: 3 }[b.state]) || a.name.localeCompare(b.name)));
  protected clearDueFilters() { this.dueFilter.set('all'); this.dueSearch.set(''); }
  protected settlementDone(line: LifeLine) {
    this.notice.set({ text: `« ${line.label} » : règlement enregistré.`, error: false });
  }
  protected pageScope = computed(() => {
    const d = this.data();
    return d ? [d.context.user.label, d.context.period?.label ?? 'Cycle à configurer'].join(' · ') : '';
  });
  protected pageResult = computed<BpmPageResult | null>(() => {
    const notice = this.notice();
    if (this.workspace()?.key === 'life-budget') {
      const budget = this.budgetType();
      if (budget?.saving()) return { message: 'Enregistrement du budget type…', tone: 'info' };
      if (budget?.feedback()) return { message: budget.feedback()!, tone: budget.feedback()!.includes('non enregistrée') ? 'warning' : 'success' };
    }
    if (notice?.error) return { message: notice.text, tone: 'danger' };
    if (this.busy()) return { message: 'Enregistrement et vérification du projet de vie…', tone: 'info' };
    if (this.error()) return { message: `${notice ? notice.text + ' ' : ''}Lecture non actualisée : ${this.error()}`, tone: notice ? 'warning' : 'danger' };
    return notice ? { message: notice.text, tone: 'success' } : null;
  });
  protected pageFocus = computed<BpmPageFocus | null>(() => {
    const d = this.data();
    if (!d) return null;
    if (this.workspace()?.key === 'life-funding') return {title: `${d.projects.pendingRequests.length + d.projects.taskRequestCount} demande(s) à examiner`, detail: 'Enveloppes, dépassements et parts demandées par les tâches : toutes les décisions de financement.', tone: 'info'};
    if (this.workspace()?.key === 'life-due') return {title: `${d.dueSoon.lateCount} échéance(s) en retard`, detail: 'Les échéances ouvertes à ce jour, indépendamment de la période consultée.', tone: d.dueSoon.lateCount ? 'warning' : 'info'};
    if (this.workspace()?.key === 'life-budget') return {
      title: this.budgetType()?.pendingChanges() ? `${this.budgetType()!.pendingChanges()} modification(s) du budget type` : this.budgetType()?.editing() ? 'Budget récurrent en modification' : 'Budget récurrent figé',
      detail: this.budgetType()?.editing()
        ? 'Enregistrez chaque ligne avec son bouton, ou toutes ensemble en bas. Les montants déjà réglés restent conservés.'
        : 'Les lignes sont celles enregistrées. « Modifier » ouvre l’édition ; rien ne change avant l’enregistrement.',
      tone: this.budgetType()?.pendingChanges() ? 'warning' : 'info',
    };
    return null;
  });
  protected priorityLabel = computed(() => this.budgetType()?.pendingChanges() ? `Enregistrer tout · ${this.budgetType()!.pendingChanges()} modification(s)` : '＋ Ajouter une dépense récurrente');
  protected runPriority() {
    if (this.workspace()?.key === 'life-budget') {
      if (this.budgetType()?.pendingChanges()) void this.budgetType()?.saveAll();
      else this.budgetType()?.addRecurring('charge');
      return;
    }
  }

  /** Mêmes volets pour la période choisie : chaque changement de période relit la page. */
  private reader = effect(() => {
    this.period();
    this.refresh.version();
    const owner = this.context.userId();
    untracked(() => {
      if (owner !== this.readingOwner) {
        this.data.set(null); this.notice.set(null);
        this.readingOwner = owner;
      }
      void this.load();
    });
  });
  protected reading = computed(() => this.data()?.cycle.reading ?? null);
  protected readingText = computed(() => cycleReadingText(this.reading()));
  protected shownKey = computed(() => this.data()?.context.period?.key ?? null);

  async load() {
    const sequence = ++this.sequence;
    this.loading.set(true);
    try {
      const data = await this.bpm.lifeManagement(this.period());
      if (sequence !== this.sequence) return;
      this.data.set(data);
      this.error.set('');
    } catch (err) {
      if (sequence === this.sequence) this.error.set(toApiError(err).message);
    } finally {
      if (sequence === this.sequence) this.loading.set(false);
    }
  }

  private async run<T>(action: () => Promise<T>, success: string | ((result: T) => string)) {
    if (this.mutationBlocked()) return;
    this.busy.set(true);
    this.notice.set(null);
    try {
      const result = await action();
      await this.load();
      this.notice.set({ text: typeof success === 'function' ? success(result) : success, error: false });
    } catch (err) {
      await this.load();
      this.notice.set({ text: toApiError(err).message, error: true });
    } finally {
      this.busy.set(false);
    }
  }

  protected openEntry(direction: 'income' | 'charge' = 'charge') {
    void this.ctx.setQuery({ entry: 'new', entryDirection: direction });
  }
  protected closeEntry() {
    void this.ctx.setQuery({ entry: null, entryDirection: null }, { replace: true });
  }
  protected saved(text: string) {
    this.closeEntry();
    this.notice.set({ text, error: false });
    this.load();
  }
  protected openLine(id: string) {
    if (id) this.lineId.set(id);
  }
  protected closeLine() {
    this.lineId.set(null);
    this.load();
  }
  protected editLine(line: RegisterLine) {
    this.lineId.set(null);
    void this.ctx.setQuery({ entry: line.id });
  }

  protected natureLabel(l: LifeLine) {
    return l.direction === 'income' ? 'Entrée' : l.nature ? CHARGE_NATURE_LABEL[l.nature as ChargeNature] : '—';
  }
  protected amountOf(l: LifeLine) {
    return l.settled && l.realizedCents !== null ? l.realizedCents : l.plannedCents;
  }
  protected centerKey(ref: string) {
    return ref.replace(/^std:/, '');
  }

  protected decideOverrun(o: ProjectOverrun, decision: 'approve' | 'refuse') {
    return this.run(
      () => this.funding.decide(o, decision),
      (r) => r.message,
    );
  }
  protected bill() {
    return this.run(() => this.bpm.billOverruns(), 'Autorisations consolidées dans les enveloppes, sans effet sur le cycle ni le patrimoine.');
  }
}
