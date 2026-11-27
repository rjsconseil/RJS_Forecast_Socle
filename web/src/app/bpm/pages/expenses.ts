import { injectPageWorkspace } from '../../plan/page-workspace';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { BpmRouterLink } from '../ui/bpm-router-link';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Api } from '../../core/api.service';
import { BpmApi } from '../data/bpm-api.service';
import { CHARGE_NATURE_LABEL, ChargeNature, Direction, EntryInput, LineStatus, RegisterLine, RegisterQuery, RegisterScope } from '../data/bpm-models';
import { SignedCentsPipe, cents, CentsPipe, ShortDatePipe, shortDate, tone } from '../../core/format';
import { BpmCapGauge, BpmLineDetail, bpmLoader, BpmEntryFlow, BpmPageContext, BpmPageFrame, BpmPageFocus, nextOpenLine, BpmState, overCapsOf, BpmQuickSettle } from '../ui';
import { settlementOutsideWindow } from './period-presentation';
import { BpmAmount } from '../ui/amount';

const STATUS_LABEL: Record<LineStatus, string> = { late: 'En retard', due: 'Du jour', pending: 'À venir', settled: 'Réglé', unrealized: 'Non réalisé' };
const GROUP_LABEL: Record<string, string> = { center: 'Par poste', nature: 'Par nature', project: 'Par projet', date: 'Par date prévue' };
/** Filtres du panneau Affiner (la recherche et le sens restent à part). */
const REFINE_KEYS = ['status', 'nature', 'center', 'taskId', 'budgetId', 'scope', 'from', 'to'] as const;
const NATURES: ChargeNature[] = ['indispensable', 'courante', 'projet'];
type GroupFlowSummary = { plannedCents: number; settledCents: number | null; openCents: number };

/**
 * Dépenses de la période : registre sélectionné par date prévue, totaux qui suivent les filtres,
 * recherche visible, liste groupée et panneau Affiner. Tous les filtres et la ligne ouverte sont
 * dans l'URL (lien profond `?operation=…&occurrence=…`). Aucun filtre ni ouverture n'écrit.
 */
@Component({
  selector: 'bpm-page-expenses',
  imports: [BpmAmount, BpmQuickSettle, FormsModule, BpmRouterLink, BpmPageFrame, BpmState, BpmLineDetail, BpmEntryFlow, BpmCapGauge, SignedCentsPipe, CentsPipe, ShortDatePipe],
  providers: [BpmPageContext],
  styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-money.scss', '../ref-styles/bpm-expenses.page.scss', './bpm-money-page.scss', './vision-workspace.scss'],
  templateUrl: './expenses.html',
  styles: `
    :host { display: block; }
    .expense-direction { display: grid; gap: var(--ecart-8); align-content: start; }
    .expense-search-help { grid-column: 1 / -1; color: var(--muted); }
    .expense-active-filters { display: flex; flex-wrap: wrap; gap: var(--ecart-6); align-items: center; margin: 0; }
    .expense-active-filters .x { border: 0; background: none; padding: 0 0 0 4px; cursor: pointer; font: inherit; color: inherit; min-height: 0; }
    .expense-group h2 a { color: inherit; text-decoration: none; }
    .expense-group h2 a:hover { text-decoration: underline; }
    .expense-center-heading bpm-cap-gauge { margin-top: var(--ecart-6); }
    .expense-caps-alert { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ecart-6) var(--ecart-12); padding: var(--ecart-10) var(--ecart-16); border: 1px solid color-mix(in srgb, var(--status-danger) 40%, var(--line)); border-radius: var(--radius-sm); background: var(--status-danger-surface); color: var(--status-danger); }
    .expense-caps-alert a { margin-left: auto; font-weight: var(--fw-semibold); }
    .expense-caps-item { color: var(--ink); }
  `,
})
export class BpmExpensesPage {
  protected readonly flowSides = [{key:'income',label:'Entrées'}, {key:'charge',label:'Sorties'}] as const;
  protected workspace = injectPageWorkspace();
  protected queryCarry = computed(() => Object.fromEntries(this.ctx.query().keys.map(key => [key, this.ctx.query().get(key)!])));
  private bpm = inject(BpmApi);
  private api = inject(Api);
  protected ctx = inject(BpmPageContext);
  protected readonly showsLifeProjects = inject(ActivatedRoute).snapshot?.data?.['registerScope'] === 'life-with-projects';
  protected readonly scope = computed<RegisterScope>(() => {
    const scope = this.ctx.q('scope')();
    if (scope === 'consolidated' || scope === 'life-with-projects' || scope === 'principal') return scope;
    return this.showsLifeProjects ? 'life-with-projects' : 'principal';
  });

  protected readonly statuses: LineStatus[] = ['late', 'due', 'pending', 'settled', 'unrealized'];
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly groupKeys = ['center', 'nature', 'project', 'date'] as const;
  protected readonly natures = NATURES;
  protected readonly natureLabel = CHARGE_NATURE_LABEL;
  protected readonly groupLabel = GROUP_LABEL;
  protected date = shortDate;

  // ---------- paramètres d'URL ----------
  protected dateBasis = computed<'planned' | 'realized'>(() => this.ctx.q('dateBasis')() === 'realized' ? 'realized' : 'planned');
  protected setDateBasis(value: string) {
    this.ctx.setQuery({ dateBasis: value === 'realized' ? value : null, status: null });
  }

  /** Sens : absent = charges (défaut), `income`, `all`. */
  protected direction = computed<'charge' | 'income' | 'all'>(() => {
    const d = this.ctx.query().get('direction');
    return d === 'income' || d === 'charge' ? d : 'all';
  });
  protected groupBy = computed<'center' | 'nature' | 'project' | 'date'>(() => {
    const g = this.ctx.query().get('groupBy');
    return g === 'nature' || g === 'project' || g === 'date' ? g : 'center';
  });
  /** Nature de charge filtrée (indispensable, courante, projet) — lien direct depuis « Gestion du projet de vie ». */
  protected nature = computed<ChargeNature | null>(() => {
    const n = this.ctx.query().get('nature') as ChargeNature | null;
    return n && NATURES.includes(n) ? n : null;
  });
  protected customWindow = computed(() => !!(this.ctx.q('from')() && this.ctx.q('to')()));
  protected windowError = computed(() => {
    const from = this.ctx.q('from')();
    const to = this.ctx.q('to')();
    if ((from && !to) || (!from && to)) return 'Fenêtre incomplète : renseignez les deux dates (la période reste lue en attendant).';
    if (from && to && to < from) return 'La fin de la fenêtre précède son début.';
    return null;
  });
  protected budgetSel = computed(() => this.ctx.q('budgetId')() || this.scope());
  protected selectedId = computed(() => this.ctx.q('occurrence')() || this.ctx.q('operation')() || this.ctx.q('ligne')() || null);

  private query = computed<RegisterQuery>(() => {
    const q = this.ctx.query();
    const get = (k: string) => q.get(k) || undefined;
    const dir = this.direction();
    const windowOk = this.customWindow() && !this.windowError();
    return {
      period: this.ctx.period(),
      dateBasis: this.dateBasis(),
      q: get('q'),
      direction: dir === 'all' ? '' : dir,
      status: get('status') as LineStatus | undefined,
      nature: this.nature() ?? undefined,
      center: get('center'),
      taskId: get('taskId'),
      budgetId: get('budgetId'),
      scope: this.scope() === 'principal' ? undefined : this.scope(),
      groupBy: this.groupBy(),
      ...(windowOk ? { from: get('from'), to: get('to') } : {}),
    };
  });

  // ---------- lectures ----------

  protected reg = bpmLoader(() => this.query(), (q) => this.bpm.register(q));
  private centersRead = bpmLoader(() => 0, () => this.bpm.costCenters());
  private tasksRead = bpmLoader(() => 0, () => this.api.tasks().catch(() => []));

  protected nextLine = computed(() => nextOpenLine(this.reg.data()?.lines ?? []));
  protected pageFocus = computed<BpmPageFocus | null>(() => {
    const r = this.reg.data();
    if (!r) return null;
    if (this.reg.error()) return { title: 'Dernière lecture à actualiser', detail: 'Les données de la sélection peuvent avoir changé.', tone: 'warning' };
    const line = this.nextLine();
    return { title: `${r.totals.lineCount} ligne(s) dans cette sélection`, detail: line ? `${line.statusLabel} : ${line.label} · ${cents(line.plannedCents)}. Ouvrez la fiche pour vérifier le règlement.` : r.totals.lineCount ? 'Aucune échéance ouverte dans la sélection. Affinez la recherche ou ajoutez un flux.' : r.totals.unfilteredCount ? 'Des lignes existent dans la période : élargissez les filtres pour les retrouver.' : 'Commencez par saisir une entrée ou une charge.', tone: line?.status === 'late' ? 'warning' : 'info' };
  });
  protected reviewNext() {
    const line = this.nextLine();
    if (line) void this.ctx.setQuery(this.lineQuery(line));
  }

  protected budgets = computed(() => this.reg.data()?.context.budgets ?? []);
  protected readonly scopeLabel = computed(() => this.reg.data()?.context.scopeLabel ?? 'Quotidien et projets de la vie');
  protected byId = computed(() => new Map((this.reg.data()?.lines ?? []).map((l) => [l.id, l] as const)));
  protected expandedGroups = linkedSignal(() => {
    this.ctx.userId();
    this.ctx.period();
    this.groupBy();
    return new Set<string>();
  });
  protected openGroupCount = computed(() => this.reg.data()?.groups.filter(g => this.expandedGroups().has(g.key)).length ?? 0);
  protected setGroupExpanded(key: string, open: boolean) {
    if (!this.showsLifeProjects || this.expandedGroups().has(key) === open) return;
    const next = new Set(this.expandedGroups());
    if (open) next.add(key);
    else next.delete(key);
    this.expandedGroups.set(next);
  }
  protected expandAllGroups(open: boolean) {
    this.expandedGroups.set(new Set(open ? this.reg.data()?.groups.map(g => g.key) : []));
  }
  protected groupSummaries = computed(() => {
    const lines = this.byId();
    const realized = this.dateBasis() === 'realized';
    return new Map((this.reg.data()?.groups ?? []).map(group => {
      const totals: Record<Direction, GroupFlowSummary> = {
        income: { plannedCents: 0, settledCents: 0, openCents: 0 },
        charge: { plannedCents: 0, settledCents: 0, openCents: 0 },
      };
      for (const id of group.lineIds) {
        const line = lines.get(id);
        if (!line || line.special) continue;
        const flow = totals[line.direction];
        flow.plannedCents += line.plannedCents;
        if (line.settled) {
          flow.settledCents = flow.settledCents === null || line.realizedCents === null
            ? null : flow.settledCents + line.realizedCents;
        }
        if (line.status === 'late' || line.status === 'due' || line.status === 'pending') flow.openCents += line.plannedCents;
      }
      const balanceCents = realized
        ? totals.income.settledCents === null || totals.charge.settledCents === null
          ? null : totals.income.settledCents - totals.charge.settledCents
        : totals.income.plannedCents - totals.charge.plannedCents;
      return [group.key, { ...totals, balanceCents, tone: tone(balanceCents) }] as const;
    }));
  });
  protected centerOptions = computed(() => {
    const dir = this.direction();
    return (this.centersRead.data() ?? []).filter((c) => dir === 'all' || c.direction === dir);
  });
  /** Plafond d'un poste quand le registre lit une période du budget de vie, regroupé par poste. */
  protected groupCap(key: string) {
    const caps = this.reg.data()?.caps;
    if (!caps || this.direction() === 'income') return null;
    const m = this.groupBy() === 'center' ? caps.centers[key] : null;
    return m && m.capCents !== null ? m : null;
  }
  /** Postes dépassés de la période. */
  protected overCaps = computed(() =>
    this.direction() === 'income' ? [] : overCapsOf(this.reg.data()?.caps, (ref) => (this.centersRead.data() ?? []).find((c) => c.ref === ref)?.label),
  );
  protected taskOptions = computed(() => {
    const projects = new Set(this.budgets().filter((b) => b.role === 'standard').map((b) => b.coreProjectId));
    return (this.tasksRead.data() ?? []).filter((t) => t.task.projectId && projects.has(t.task.projectId)).map((t) => ({ id: t.task.id, title: t.task.title }));
  });

  protected labels = computed(() => {
    const d = this.direction();
    return d === 'income' ? { paid: 'Reçu', toPay: 'À recevoir' } : d === 'all' ? { paid: 'Réglé', toPay: 'À régler' } : { paid: 'Payé', toPay: 'À payer' };
  });
  protected outsideWindow = (line: RegisterLine) => settlementOutsideWindow(line, this.reg.data()?.window);

  /** Phrase du bandeau (source : « Vos charges, payées et à venir. »), selon le sens lu. */
  protected lead = computed(() => {
    const d = this.direction();
    if (this.dateBasis() === 'realized') return 'Vos règlements, classés selon leur date réelle.';
    return d === 'income' ? 'Vos entrées, reçues et à venir.' : d === 'all' ? 'Vos entrées et charges, réglées et à venir.' : 'Vos charges, payées et à venir.';
  });
  protected notes = computed(() => {
    const d = this.direction();
    if (this.dateBasis() === 'realized') return { paid: 'Montants réellement réglés dans la fenêtre lue, quelle que soit leur date prévue.', toPay: '', unrealized: '' };
    if (d === 'income') return { paid: 'Montants reçus des entrées prévues sur cette période.', toPay: 'Entrées prévues, pas encore reçues.', unrealized: 'Entrées restées sans réception à la clôture.' };
    if (d === 'all') return { paid: 'Règlements des échéances prévues sur cette période.', toPay: 'Échéances prévues, sans règlement enregistré.', unrealized: 'Échéances restées sans règlement à la clôture.' };
    return { paid: 'Règlements des charges prévues sur cette période.', toPay: 'Charges prévues, sans paiement enregistré.', unrealized: 'Charges restées sans paiement à la clôture.' };
  });
  protected listTitle = computed(() => {
    const g = this.groupBy();
    if (g === 'project') return 'Par projet';
    if (g === 'nature') return 'Par nature : indispensables, courantes et projets';
    if (g === 'date') return this.dateBasis() === 'realized' ? 'Par date de règlement' : 'Par date prévue';
    const d = this.direction();
    return d === 'income' ? 'Entrées par poste' : d === 'all' ? 'Échéances par poste' : 'Dépenses par poste';
  });
  /** Montant d'une échéance : réel une fois réglée, sinon prévu. */
  protected amountOf(l: RegisterLine) {
    return l.settled && l.realizedCents !== null ? l.realizedCents : l.plannedCents;
  }
  /** Prévu des échéances non réalisées d'un groupe (0 = rien à afficher). */
  protected groupUnrealized(ids: string[]) {
    const map = this.byId();
    return ids.reduce((sum, id) => {
      const l = map.get(id);
      return l && l.status === 'unrealized' ? sum + l.plannedCents : sum;
    }, 0);
  }

  /** Filtres actifs du panneau Affiner, avec un libellé lisible. */
  protected activeRefine = computed(() => {
    const q = this.ctx.query();
    const out: { key: string; label: string }[] = [];
    const status = q.get('status') as LineStatus | null;
    if (status) out.push({ key: 'status', label: `État : ${STATUS_LABEL[status] ?? status}` });
    const nature = this.nature();
    if (nature) out.push({ key: 'nature', label: `Nature : ${CHARGE_NATURE_LABEL[nature]}` });
    const center = q.get('center');
    if (center) out.push({ key: 'center', label: center === '__none__' ? 'Poste à préciser' : `Poste : ${(this.centersRead.data() ?? []).find((c) => c.ref === center)?.label ?? center}` });
    const task = q.get('taskId');
    if (task) out.push({ key: 'taskId', label: `Tâche : ${this.taskOptions().find((t) => t.id === task)?.title ?? task}` });
    const budgetId = q.get('budgetId');
    if (budgetId) out.push({ key: 'budgetId', label: `Budget : ${this.budgets().find((b) => b.id === budgetId)?.name ?? budgetId}` });
    else if (q.get('scope')) out.push({ key: 'scope', label: this.scopeLabel() });
    if (q.get('from') || q.get('to')) out.push({ key: 'from', label: `Fenêtre ${shortDate(q.get('from'))} → ${shortDate(q.get('to'))}` });
    return out;
  });
  protected refineOpen = signal(REFINE_KEYS.some((k) => !!this.ctx.query().get(k)));

  protected emptyText = computed(() => {
    const r = this.reg.data();
    if (r && r.totals.unfilteredCount > 0) return `Aucune ligne ne correspond aux filtres (${r.totals.unfilteredCount} ligne(s) dans la fenêtre).`;
    if (this.dateBasis() === 'realized') return 'Aucun règlement enregistré à une date réelle comprise dans cette fenêtre.';
    return this.direction() === 'income' ? 'Aucune entrée prévue dans cette fenêtre. Les zéros affichés sont connus.' : 'Aucune charge prévue dans cette fenêtre. Les zéros affichés sont connus.';
  });

  // ---------- lien profond vers une ligne ----------

  protected isSelected = (l: RegisterLine) => {
    const id = this.selectedId();
    return !!id && (l.id === id || l.occurrenceKey === id || l.operationId === id);
  };
  protected missing = computed(() => {
    const id = this.selectedId();
    const r = this.reg.data();
    if (!id || !r || this.reg.loading()) return false;
    return !r.lines.some((l) => this.isSelected(l));
  });
  protected missingLine = bpmLoader(
    () => (this.missing() ? { id: this.selectedId()!, period: this.ctx.period() } : null),
    (k) => (k ? this.bpm.line(k.id, k.period) : Promise.resolve(null)),
  );
  /** Raisons factuelles de l'absence, déduites des filtres actifs et de la ligne lue. */
  protected missingReasons = computed(() => {
    const d = this.missingLine.data();
    const r = this.reg.data();
    if (!d || !r) return [];
    const l = d.line;
    const q = this.query();
    const out: string[] = [];
    const selectedDate = this.dateBasis() === 'realized'
      ? (r.context.scope === 'principal' ? l.accountingDate ?? l.realizedDate : l.realizedDate)
      : l.plannedDate;
    if (!selectedDate) out.push('aucun règlement n’est enregistré : passez en lecture par dates prévues pour retrouver cette échéance ;');
    else if (selectedDate < r.window.from || selectedDate > r.window.to) out.push(`sa date ${this.dateBasis() === 'realized' ? 'réelle' : 'prévue'} est hors de la fenêtre lue (${shortDate(r.window.from)} – ${shortDate(r.window.to)}) ;`);
    if (q.direction && l.direction !== q.direction) out.push(`le sens affiché est « ${q.direction === 'income' ? 'Entrées' : 'Charges'} » ;`);
    if (q.status && l.status !== q.status) out.push(`le filtre d'état est « ${STATUS_LABEL[q.status as LineStatus]} » ;`);
    if (q.nature && l.nature !== q.nature) out.push(l.nature ? `sa nature est « ${CHARGE_NATURE_LABEL[l.nature]} », le filtre lit « ${CHARGE_NATURE_LABEL[q.nature]} » ;` : 'le filtre de nature ne retient que des charges ;');
    if (q.center && (q.center === '__none__' ? l.centerKnown : l.costCenterRef !== q.center)) out.push('le filtre de centre l’exclut ;');
    if (q.taskId && l.taskId !== q.taskId) out.push('le filtre de tâche l’exclut ;');
    if (q.budgetId && l.budgetId !== q.budgetId) out.push('elle appartient à un autre budget que celui sélectionné ;');
    else if (r.context.scope === 'principal' && l.budgetRole !== 'life' && (l.projectPosting !== 'validated' || l.fundingSource !== 'cycle')) out.push('l’imputation de ce mouvement ne figure pas dans le résultat du cycle ;');
    if (q.q) out.push(`la recherche « ${q.q} » est active ;`);
    return out;
  });

  protected lineQuery(l: RegisterLine) {
    return { operation: l.operationId ?? (l.occurrenceKey ? null : l.id), occurrence: l.occurrenceKey ?? null };
  }
  protected centerQuery() {
    return { ...this.ctx.carry(), from: 'depenses' };
  }
  protected isNoneGroup(key: string) {
    const l = this.reg.data()?.lines.find((x) => x.costCenterRef === key);
    return !!l && !l.centerKnown;
  }

  // ---------- recherche (debounce, remplace l'entrée d'historique) ----------

  protected search = linkedSignal(() => this.ctx.q('q')());
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  protected onSearch(value: string) {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.ctx.setQuery({ q: value.trim() ? value : null }, { replace: true }), 300);
  }

  // ---------- filtres ----------

  protected setDirection(d: 'charge' | 'income' | 'all') {
    // Le centre filtré dépend du sens : il est retiré s'il n'existe pas dans le nouveau sens.
    const center = this.ctx.q('center')();
    const keep = !center || center === '__none__' || d === 'all' || (this.centersRead.data() ?? []).some((c) => c.ref === center && c.direction === d);
    this.ctx.setQuery({ direction: d, ...(keep ? {} : { center: null }) });
  }
  /** Une nature ne classe que des charges : la choisir ramène le sens sur « Charges ». */
  protected setNature(n: string) {
    this.ctx.setQuery(n ? { nature: n, direction: 'charge' } : { nature: null });
  }
  protected setGroup(g: string) {
    this.ctx.setQuery({ groupBy: g === 'center' ? null : g });
  }
  /** Teinte du groupe : entrées en vert, charges en rouge, vue « Tout » neutre. */
  protected groupFlow = computed(() => (this.direction() === 'income' ? 'income' : this.direction() === 'charge' ? 'expense' : null));
  /** État source de la ligne : réglée = « recorded », ouverte = « pending », sinon non réalisée. */
  protected rowStatus(l: RegisterLine) {
    return l.status === 'settled' ? 'recorded' : l.status === 'unrealized' || l.status === 'project' ? 'unrealized' : 'pending';
  }
  protected setBudget(v: string) {
    const defaultScope = this.showsLifeProjects ? 'life-with-projects' : 'principal';
    if (v === 'life-with-projects' || v === 'principal' || v === 'consolidated') {
      this.ctx.setQuery({ budgetId: null, scope: v === defaultScope ? null : v, taskId: null });
    } else {
      this.ctx.setQuery({ budgetId: v, scope: null, taskId: null });
    }
  }
  protected setWindow(k: 'from' | 'to', v: string) {
    this.ctx.setQuery({ [k]: v || null });
  }
  protected clearOne(key: string) {
    return key === 'from' ? { from: null, to: null } : { [key]: null };
  }
  protected clearRefine() {
    this.ctx.setQuery(Object.fromEntries(REFINE_KEYS.map((k) => [k, null])));
  }
  protected clearAll() {
    clearTimeout(this.searchTimer);
    this.ctx.setQuery({ ...Object.fromEntries(REFINE_KEYS.map((k) => [k, null])), q: null, direction: 'all' });
  }
  /** Lecture libre centrée sur la date prévue de la ligne demandée (sans changer le cycle). */
  protected showDate(d: string) {
    this.ctx.setQuery({ ...Object.fromEntries(REFINE_KEYS.map((k) => [k, null])), q: null, direction: 'all', dateBasis: null, from: d, to: d });
  }

  // ---------- détail et éditeur ----------

  protected message = signal<string | null>(null);

  protected createDefaults = computed<Partial<EntryInput>>(() => {
    const center = this.ctx.q('center')();
    const budgetId = this.ctx.q('budgetId')();
    // Un lien de saisie dit son sens (« Saisir une entrée d’argent ») ; sinon, celui du filtre de la page.
    const asked = this.ctx.q('entryDirection')();
    const dir: Direction = (asked ?? this.direction()) === 'income' ? 'income' : 'charge';
    return {
      direction: dir,
      ...(center && center !== '__none__' ? { costCenterRef: center } : {}),
      ...(budgetId ? { budgetId } : {}),
    };
  });

  protected openCreate() {
    void this.ctx.setQuery({ entry: 'new' });
  }
  protected openEdit(l: RegisterLine) {
    void this.ctx.setQuery({ entry: l.id });
  }
  protected closeEditor() {
    void this.ctx.setQuery({ entry: null }, { replace: true });
  }
  protected onSaved(msg: string) {
    this.message.set(msg);
    this.closeEditor();
  }
  protected closeDetail() {
    this.ctx.setQuery({ operation: null, occurrence: null, ligne: null }, { replace: true });
  }

  protected readonly fmt = cents;
}
