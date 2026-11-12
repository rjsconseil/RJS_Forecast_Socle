import { redirectLegacyView } from '../ui/legacy-view';
import { injectPageWorkspace } from '../../plan/page-workspace';
import { NgTemplateOutlet } from '@angular/common';
import { BpmPageContext } from '../ui/page-context';
import { BpmDrafts } from '../ui/drafts';
import { bpmQueryState } from '../ui/query-state';
import { Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { RecetteContext, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { Cadence, LifeGoal, Vision } from '../../core/bpm-models';
import { cents, CentsPipe, parseAmount, ShortDatePipe, SignedCentsPipe } from '../../core/format';
import { BpmModal } from '../ui/modal';
import { BpmActSimulation, SimulationAdoption } from '../pages/act-simulation';
import { BpmActDirectives, BpmActSurplus } from '../pages/act-guidance';
import { BpmGoalEditor } from '../pages/vision-goal-editor';
import { BpmVisionObjectives, euroText, num } from '../pages/vision-objectives';
import { BpmPageFocus, BpmPageResult, BpmPageFrame, BpmRefresh, BpmSeriesChart, BpmState, ChartSeries, bpmLoader } from '../ui';
import { normalizedSearch, objectiveRows, objectivesView } from './objectives-model';

const CADENCES = { weekly: 'semaine', monthly: 'mois', yearly: 'an' };

/** Objectifs du projet de vie : réglages existants réunis, sans créer de flux financier. */
@Component({
  selector: 'bpm-objectives-page',
  providers: [BpmPageContext],
  imports: [
    BpmActSimulation, BpmActDirectives, BpmActSurplus,
    FormsModule,
    NgTemplateOutlet,
    RouterLink,
    BpmPageFrame,
    CentsPipe,
    SignedCentsPipe,
    ShortDatePipe,
    BpmVisionObjectives,
    BpmGoalEditor,
    BpmSeriesChart,
    BpmState,
    BpmModal,
  ],
  styleUrl: './objectives.page.scss',
  templateUrl: './objectives.page.html',
})
export class BpmObjectivesPage {
  private ctx = inject(BpmPageContext);
  private bpm = inject(BpmApi);
  private refresh = inject(BpmRefresh);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  protected workspace = injectPageWorkspace();
  protected carry = computed(() => Object.fromEntries(this.ctx.query().keys.filter(key => key !== 'view').map(key => [key, this.ctx.query().get(key)!])));
  private user = inject(RecetteContext).userId;
  protected fragment = toSignal(this.route.fragment, { initialValue: this.route.snapshot.fragment });
  protected params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  protected view = computed(() => this.workspace()?.key === 'vision-projection' ? 'projection' : this.workspace()?.key === 'vision-landmarks' ? 'reperes' : objectivesView(this.params().get('view'), this.fragment()));
  private readonly legacyView = redirectLegacyView(() => this.view(), 'suivi', { reperes: '/vision/reperes', projection: '/vision/projection' }, () => !!this.workspace());
  protected tabs = [
    { key: 'suivi', label: 'Mes objectifs datés', note: 'Suivre et ajuster' },
    { key: 'reperes', label: 'Épargne et patrimoine', note: 'Fixer mes repères' },
    { key: 'projection', label: 'Projection et hypothèses', note: 'Préparer l’avenir' },
  ];
  protected search = bpmQueryState('q', '', { replace: true });
  protected typeFilter = bpmQueryState('type', 'all', { replace: false });
  protected statusFilter = bpmQueryState('status', 'all', { replace: false });
  protected sort = bpmQueryState('sort', 'date', { replace: false });
  protected profile = bpmLoader(
    () => 0,
    () => this.bpm.setupProfile(),
  );
  protected summary = bpmLoader(
    () => 0,
    () => this.bpm.summary(),
  );
  protected directives = bpmLoader(
    () => 0,
    () => this.bpm.directives(),
  );
  protected goals = bpmLoader(
    () => 0,
    () => this.bpm.goals(),
  );
  protected projection = bpmLoader(
    () => 0,
    () => this.bpm.projection(),
  );
  protected message = signal('');
  protected editing = computed(() => {
    const id = this.ctx.query().get('goal');
    if (!id) return null;
    const goal = this.goals.data()?.find(g => g.id === id);
    return id === 'new' ? { goal: null } : goal ? { goal } : null;
  });
  protected editGoal(goal: LifeGoal | null) { void this.ctx.setQuery({ goal: goal?.id ?? 'new' }); }
  protected closeGoal() { void this.ctx.setQuery({ goal: null }, { replace: true }); }
  protected confirmGoal = signal<LifeGoal | null>(null);
  protected removing = signal(false);
  protected removeError = signal('');
  protected wealthTarget = signal('');
  protected wealthDirty = signal(false);
  protected wealthBusy = signal(false);
  protected wealthError = signal('');
  protected savingsTarget = signal('');
  protected savingsDirty = signal(false);
  protected savingsBusy = signal(false);
  protected savingsError = signal('');
  protected hypOpen = signal(true);
  protected hypDirty = signal(false);
  protected hypBusy = signal(false);
  protected hypError = signal('');
  protected horizon = signal('');
  protected rate = signal('');
  protected inflation = signal('');
  protected inflationSource = signal('');
  protected contribution = signal('');
  protected cadence = signal<Exclude<Cadence, 'once'>>('monthly');
  protected contributionLabel = computed(() => {
    const v = this.profile.data()?.principal.vision;
    return !v || v.contributionCents === null
      ? 'Moyenne du budget type'
      : `${cents(v.contributionCents)} / ${CADENCES[v.contributionCadence]}`;
  });
  protected adoptSimulation(value: SimulationAdoption) {
    this.contribution.set(String(value.contributionCents / 100).replace('.', ','));
    this.cadence.set(value.cadence);
    this.hypDirty.set(true);
    this.openSetting('projection');
  }
  protected today = computed(() => this.summary.data()?.context.calculationDate ?? '');
  protected goalRows = computed(() => objectiveRows(this.goals.data() ?? [],
    this.projection.loading() || this.projection.error() ? null : this.projection.data(), this.today()));
  protected filteredGoals = computed(() => {
    const q = normalizedSearch(this.search());
    return this.goalRows().filter(g => (!q || normalizedSearch(`${g.goal.label} ${g.goal.typeLabel ?? g.goal.type}`).includes(q))
      && (this.typeFilter() === 'all' || g.goal.type === this.typeFilter())
      && (this.statusFilter() === 'all' || (this.statusFilter() === 'overdue' ? g.overdue : g.status === this.statusFilter())))
      .sort((a, b) => (this.sort() === 'amount' ? b.goal.targetTodayCents - a.goal.targetTodayCents
        : this.sort() === 'gap' ? (b.gapCents ?? -1) - (a.gapCents ?? -1)
        : a.goal.date.localeCompare(b.goal.date)) || a.goal.label.localeCompare(b.goal.label, 'fr'));
  });
  protected targetTotal = computed(() => this.goals.data() === null ? null : this.goalRows().reduce((n, g) => n + g.goal.targetTodayCents, 0));
  protected coveredCount = computed(() => this.goalRows().filter(g => g.status === 'funded').length);
  protected coverageAvailable = computed(() => this.projection.data()?.status === 'estimate' && !this.projection.loading() && !this.projection.error() && !!this.goals.data());
  protected attentionCount = computed(() => this.goalRows().filter(g => g.overdue || g.status !== 'funded').length);
  protected nextGoal = computed(() => this.goalRows().filter(g => !g.overdue).sort((a,b) => a.goal.date.localeCompare(b.goal.date))[0] ?? null);
  protected priorityGoal = computed(() => [...this.filteredGoals()].filter(g => g.overdue || g.status !== 'funded')
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.goal.date.localeCompare(b.goal.date))[0] ?? null);
  protected settingEditor = bpmQueryState<'savings' | 'wealth' | 'projection' | null>('reglage', null, {
    parse: value => value === 'savings' || value === 'wealth' || value === 'projection' ? value : null,
  });
  protected settingChoice = signal<'savings' | 'wealth'>('savings');
  protected settingTitle = computed(() => this.settingEditor() === 'wealth' ? 'Préparer mon cap patrimonial' : this.settingEditor() === 'projection' ? 'Ajuster mon scénario' : 'Préparer mon épargne par période');
  protected openSetting(setting: 'savings' | 'wealth' | 'projection') {
    if (setting !== 'projection') this.settingChoice.set(setting);
    const view = setting === 'projection' ? 'projection' : 'reperes';
    // Chaque réglage vit dans sa sous-page : on l'y ouvre, ou on l'ouvre sur place si l'on y est déjà.
    if (this.workspace() && this.view() === view) void this.ctx.setQuery({ reglage: setting });
    else void this.router.navigate([view === 'projection' ? '/vision/projection' : '/vision/reperes'], { queryParams: { ...this.carry(), reglage: setting } });
  }
  protected closeSetting() { void this.ctx.setQuery({ reglage: null }, { replace: true }); }
  protected reviewAttention() {
    if (this.workspace()) {
      void this.router.navigate(['/vision'], { queryParams: { ...this.carry(), status: 'all', q: null, type: 'all', sort: 'date', goal: this.priorityGoal()?.goal.id ?? null } });
      return;
    }
    void this.ctx.setQuery({ status: 'all', q: null, type: 'all', sort: 'date' });
    if (this.priorityGoal()) this.editGoal(this.priorityGoal()!.goal);
  }
  private lastWrite = signal<'savings' | 'wealth' | 'projection' | 'remove' | null>(null);
  protected commandBusy = computed(() => this.savingsBusy() || this.wealthBusy() || this.hypBusy() || this.removing());
  protected pendingSetting = computed(() => {
    if (this.view() === 'projection' && this.hypDirty()) return 'projection';
    if (this.view() === 'reperes' && this.settingChoice() === 'wealth' && this.wealthDirty()) return 'wealth';
    if (this.savingsDirty()) return 'savings';
    if (this.wealthDirty()) return 'wealth';
    return this.hypDirty() ? 'projection' : null;
  });
  protected primaryKind = computed(() => {
    if (this.pendingSetting()) return 'save';
    if (this.view() === 'projection') return 'projection';
    if (this.view() === 'reperes') return 'setting';
    if (!this.goalRows().length) return 'create';
    if (!this.filteredGoals().length) return 'reset';
    if (this.priorityGoal()?.overdue) return 'goal';
    if (!this.coverageAvailable()) return 'projection';
    return this.priorityGoal() ? 'goal' : 'create';
  });
  protected primaryLabel = computed(() => {
    if (this.commandBusy()) return 'Enregistrement…';
    switch (this.primaryKind()) {
      case 'save': return this.pendingSetting() === 'wealth' ? 'Enregistrer le cap saisi' : this.pendingSetting() === 'projection' ? 'Enregistrer le scénario saisi' : 'Enregistrer l’épargne saisie';
      case 'goal': return `Revoir ${this.priorityGoal()!.goal.label}`;
      case 'projection': return this.view() === 'projection' ? 'Ajuster les hypothèses' : 'Calculer la couverture des objectifs';
      case 'setting': return this.settingChoice() === 'wealth' ? 'Régler mon cap patrimonial' : 'Régler mon épargne visée';
      case 'reset': return 'Afficher tous les objectifs';
      default: return '＋ Créer un objectif daté';
    }
  });
  protected runPrimary() {
    switch (this.primaryKind()) {
      case 'save':
        if (this.pendingSetting() === 'wealth') void this.saveWealth();
        else if (this.pendingSetting() === 'projection') void this.saveHypotheses();
        else void this.saveSavings();
        break;
      case 'goal': this.editGoal(this.priorityGoal()!.goal); break;
      case 'projection': this.openSetting('projection'); break;
      case 'setting': this.openSetting(this.settingChoice()); break;
      case 'reset': this.resetFilters(); break;
      default: this.editGoal(null);
    }
  }
  protected pageScope = computed(() => {
    const profile = `${this.summary.data()?.context.user.label ?? 'Profil actif'} · `;
    if (this.pendingSetting()) return profile + `${this.pendingSetting() === 'wealth' ? 'Cap patrimonial' : this.pendingSetting() === 'projection' ? 'Hypothèses du scénario' : 'Épargne visée'} · saisie du profil à enregistrer`;
    if (this.view() === 'projection') return profile + `Simulation sur ${this.profile.data()?.principal.vision.horizonYears ?? '—'} ans · tous les objectifs du profil · aucun argent réservé`;
    if (this.view() === 'reperes') return profile + `Repères du profil · sélection : ${this.settingChoice() === 'wealth' ? 'cap patrimonial' : 'épargne par période'}`;
    return profile + `${this.hasFilters() ? 'Sélection filtrée' : 'Tous les objectifs'} · ${this.filteredGoals().length} affiché(s) sur ${this.goalRows().length}${this.priorityGoal() ? ` · priorité : ${this.priorityGoal()!.goal.label}` : ''}`;
  });
  protected pageResult = computed<BpmPageResult | null>(() => {
    const error = this.lastWrite() === 'wealth' ? this.wealthError() : this.lastWrite() === 'savings' ? this.savingsError() : this.lastWrite() === 'projection' ? this.hypError() : this.lastWrite() === 'remove' ? this.removeError() : '';
    if (error) return { message: error, tone: 'danger' };
    if (this.commandBusy()) return { message: 'Enregistrement de votre modification…', tone: 'info' };
    if (!this.message() || this.pendingSetting()) return null;
    if (this.profile.loading() || this.goals.loading() || this.projection.loading()) return { message: `${this.message()} Actualisation des résultats…`, tone: 'info' };
    if (this.profile.error() || this.projection.error()) return { message: `${this.message()} Le résultat actualisé reste indisponible : ${(this.profile.error() ?? this.projection.error())!.message}`, tone: 'warning' };
    return { message: this.message(), tone: 'success' };
  });
  protected pageFocus = computed<BpmPageFocus | null>(() => {
    const p = this.profile.data();
    if (!p) return null;
    if (this.pendingSetting()) return { title: this.pendingSetting() === 'projection' ? 'Vos hypothèses modifiées attendent leur enregistrement' : 'Vous avez un repère non enregistré', detail: this.pendingSetting() === 'projection' ? 'Enregistrez vos hypothèses pour recalculer le scénario.' : 'Enregistrez le repère saisi ; les autres réglages sont conservés.', tone: 'warning' };
    if (this.view() === 'projection') {
      if (this.projection.error()) return { title: 'La projection est indisponible', detail: this.projection.error()!.message, tone: 'warning' };
      return this.coverageAvailable()
        ? { title: `Scénario calculé sur ${p.principal.vision.horizonYears} ans`, detail: `${this.coveredCount()} objectif(s) couvert(s) sur ${this.goalRows().length} selon vos hypothèses.`, tone: 'info' }
        : { title: 'La couverture des objectifs reste à calculer', detail: this.projection.data()?.reason ?? 'Vérifiez le patrimoine initial et les hypothèses du scénario.', tone: 'warning' };
    }
    if (this.view() === 'reperes') {
      if (p.principal.vision.savingsTargetCents === null) return { title: 'Quelle épargne viser à chaque période ?', detail: 'Fixez d’abord ce repère pour savoir ce que le budget de vie doit laisser disponible.', tone: 'info' };
      if (p.principal.patrimoine.objectiveCents === null) return { title: 'Votre cap patrimonial reste à définir', detail: 'Donnez une cible au stock que vous souhaitez construire dans la durée.', tone: 'info' };
      return { title: 'Vos repères d’épargne et de patrimoine sont renseignés', detail: 'Vous pouvez ajuster chaque cible depuis le panneau de réglage, sans modifier les montants enregistrés.', tone: 'success' };
    }
    if (!this.goals.data()) return null;
    if (!this.goalRows().length) return { title: 'Préparez votre premier objectif', detail: 'Un montant et une date suffisent pour l’intégrer à votre scénario.', tone: 'info' };
    if (!this.filteredGoals().length && this.hasFilters()) return { title: 'Aucun objectif dans cette sélection', detail: 'Élargissez les filtres pour retrouver les objectifs du profil.', tone: 'info' };
    const priority = this.priorityGoal();
    if (priority?.overdue) return { title: `Échéance passée : ${priority.goal.label}`, detail: 'Vérifiez sa date ou retirez cette intention si vous n’avez plus à la préparer.', tone: 'warning' };
    if (!this.coverageAvailable()) return { title: 'Le financement de vos objectifs reste à estimer', detail: 'Complétez le scénario pour comparer vos objectifs au patrimoine projeté.', tone: 'info' };
    if (priority) return { title: `${this.filteredGoals().filter(goal => goal.overdue || goal.status !== 'funded').length} objectif(s) à examiner dans cette sélection`, detail: `Commencez par « ${priority.goal.label} » : ${priority.statusLabel.toLowerCase()}.`, tone: 'warning' };
    return { title: this.hasFilters() ? 'Les objectifs affichés sont couverts dans ce scénario' : 'Tous vos objectifs sont couverts dans ce scénario', detail: 'Cette estimation prépare vos décisions ; elle ne réserve aucun argent.', tone: 'success' };
  });
  protected hasFilters = computed(() => !!this.search() || this.typeFilter() !== 'all' || this.statusFilter() !== 'all');
  protected resetFilters() { this.search.set(''); this.typeFilter.set('all'); this.statusFilter.set('all'); }
  protected requestRemoval(goal: LifeGoal) { this.removeError.set(''); this.confirmGoal.set(goal); }
  protected refreshAll() { this.refresh.bump(); }
  protected goalEffect(goal: LifeGoal) {
    const type = this.profile.data()?.goalTypes.find(t => t.key === goal.type);
    return type?.consumes === false ? 'Réserve une part du capital dans le scénario.' : 'Consomme du capital à l’échéance dans le scénario.';
  }
  protected contributionCadenceLabel = computed(() => {
    const cadence = this.projection.data()?.hypotheses?.cadence;
    return cadence ? `par ${CADENCES[cadence]}` : '';
  });
  protected projectionYears = computed(() =>
    (this.projection.data()?.rows ?? []).map((r) => String(r.year)),
  );
  protected projectionSeries = computed<ChartSeries[]>(() => [
    {
      key: 'nominal',
      label: 'Valeur nominale',
      color: 'var(--s-nominal)',
      kind: 'line',
      values: (this.projection.data()?.rows ?? []).map((r) => r.nominalCents),
    },
    {
      key: 'real',
      label: 'Euros d’aujourd’hui',
      color: 'var(--s-real)',
      kind: 'line',
      dashed: true,
      values: (this.projection.data()?.rows ?? []).map((r) => r.realCents),
    },
  ]);
  private lastUser = this.user();
  constructor() {
    inject(BpmDrafts).fields('vision-workspace', this, [
      'wealthTarget', 'wealthDirty', 'savingsTarget', 'savingsDirty', 'hypDirty',
      'horizon', 'rate', 'inflation', 'inflationSource', 'contribution', 'cadence', 'settingChoice',
    ], inject(DestroyRef));
    effect(() => {
      const user = this.user();
      untracked(() => {
        if (user !== this.lastUser) {
          this.resetFilters(); this.closeGoal();
          this.wealthDirty.set(false); this.savingsDirty.set(false); this.hypDirty.set(false);
        }
        this.lastUser = user;
        this.confirmGoal.set(null); this.message.set('');
      });
    });
    effect(() => {
      const p = this.profile.data();
      if (!p) return;
      untracked(() => {
        if (!this.wealthDirty()) this.resetWealth();
        if (!this.savingsDirty()) this.resetSavings();
        if (!this.hypDirty()) this.fillHypotheses(p.principal.vision);
      });
    });
    effect(() => {
      const f = this.fragment();
      if (f === 'hypotheses') this.hypOpen.set(true);
      if (f === 'cap-patrimonial') this.settingChoice.set('wealth');
      if (f === 'epargne') this.settingChoice.set('savings');
    });
  }
  protected resetWealth() {
    this.wealthTarget.set(
      euroText(this.profile.data()?.principal.patrimoine.objectiveCents ?? null),
    );
    this.wealthDirty.set(false);
    this.wealthError.set('');
  }
  protected resetSavings() {
    this.savingsTarget.set(
      euroText(this.profile.data()?.principal.vision.savingsTargetCents ?? null),
    );
    this.savingsDirty.set(false);
    this.savingsError.set('');
  }
  protected async saveWealth() {
    this.lastWrite.set('wealth');
    this.message.set('');
    const p = this.profile.data();
    if (!p || this.wealthBusy()) return;
    const objective = parseAmount(this.wealthTarget());
    if (objective === 'invalid' || (objective !== null && objective < 0))
      return this.wealthError.set('Saisissez un montant positif ou laissez vide.');
    this.wealthBusy.set(true);
    this.wealthError.set('');
    try {
      await this.bpm.updatePatrimoine({
        expectedRevision: p.principal.patrimoine.revision,
        objective,
      });
      this.wealthDirty.set(false);
      this.message.set('Cap patrimonial enregistré.');
      if (this.settingEditor() === 'wealth') this.closeSetting();
      this.refresh.bump();
    } catch (e) {
      this.wealthError.set(toApiError(e).message);
    } finally {
      this.wealthBusy.set(false);
    }
  }
  protected async saveSavings() {
    this.lastWrite.set('savings');
    this.message.set('');
    const p = this.profile.data();
    if (!p || this.savingsBusy()) return;
    const savingsTarget = parseAmount(this.savingsTarget());
    if (savingsTarget === 'invalid' || (savingsTarget !== null && savingsTarget < 0))
      return this.savingsError.set('Saisissez un montant positif ou laissez vide.');
    this.savingsBusy.set(true);
    this.savingsError.set('');
    try {
      await this.bpm.updateVision({ expectedRevision: p.principal.revision, savingsTarget });
      this.savingsDirty.set(false);
      this.message.set('Épargne visée enregistrée.');
      if (this.settingEditor() === 'savings') this.closeSetting();
      this.refresh.bump();
    } catch (e) {
      this.savingsError.set(toApiError(e).message);
    } finally {
      this.savingsBusy.set(false);
    }
  }
  protected recordResult(text: string) { this.lastWrite.set(null); this.message.set(text); }
  protected goalSaved(text: string) {
    this.closeGoal();
    this.recordResult(text);
  }
  protected async removeGoal() {
    this.lastWrite.set('remove');
    this.message.set('');
    const g = this.confirmGoal();
    if (!g || this.removing()) return;
    this.removing.set(true);
    this.removeError.set('');
    try {
      await this.bpm.removeGoal(g.id, g.revision);
      this.confirmGoal.set(null);
      this.message.set(`Objectif « ${g.label} » retiré.`);
      this.refresh.bump();
    } catch (e) {
      this.removeError.set(toApiError(e).message);
    } finally {
      this.removing.set(false);
    }
  }
  private fillHypotheses(v: Vision) {
    this.horizon.set(String(v.horizonYears));
    this.rate.set(v.annualReturnPct === null ? '' : String(v.annualReturnPct));
    this.inflation.set(String(v.inflationPct));
    this.inflationSource.set(v.inflationSource);
    this.contribution.set(euroText(v.contributionCents));
    this.cadence.set(v.contributionCadence);
  }
  protected resetHypotheses() {
    const p = this.profile.data();
    if (p) this.fillHypotheses(p.principal.vision);
    this.hypDirty.set(false);
    this.hypError.set('');
  }
  protected async saveHypotheses() {
    this.lastWrite.set('projection');
    this.message.set('');
    const p = this.profile.data();
    if (!p || this.hypBusy()) return;
    const horizonYears = num(this.horizon());
    const annualReturnPct = num(this.rate());
    const inflationPct = num(this.inflation());
    const contribution = parseAmount(this.contribution());
    if (
      horizonYears === null ||
      !Number.isInteger(horizonYears) ||
      horizonYears < 1 ||
      horizonYears > 80
    )
      return this.hypError.set('Choisissez un horizon de 1 à 80 années entières.');
    if (
      annualReturnPct !== null &&
      (!Number.isFinite(annualReturnPct) || annualReturnPct < -50 || annualReturnPct > 50)
    )
      return this.hypError.set('Le rendement doit être compris entre −50 % et 50 %.');
    if (
      inflationPct === null ||
      !Number.isFinite(inflationPct) ||
      inflationPct < -20 ||
      inflationPct > 50
    )
      return this.hypError.set('L’inflation doit être comprise entre −20 % et 50 %.');
    if (contribution === 'invalid')
      return this.hypError.set('Saisissez un apport en euros ou laissez vide.');
    this.hypBusy.set(true);
    this.hypError.set('');
    try {
      await this.bpm.updateVision({
        expectedRevision: p.principal.revision,
        horizonYears,
        annualReturnPct,
        inflationPct,
        inflationSource: this.inflationSource().trim(),
        contribution,
        contributionCadence: this.cadence(),
      });
      this.hypDirty.set(false);
      this.hypOpen.set(false);
      this.message.set('Hypothèses enregistrées.');
      void this.ctx.setQuery({ reglage: null, effort: null }, { replace: true });
      this.refresh.bump();
    } catch (e) {
      this.hypError.set(toApiError(e).message);
    } finally {
      this.hypBusy.set(false);
    }
  }
}
