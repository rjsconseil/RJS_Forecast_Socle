import { Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { toApiError } from '../../core/api.service';
import { DataChanges } from '../../core/data-changes';
import { cents, CentsPipe, ShortDatePipe, SignedCentsPipe, signedCents } from '../../core/format';
import { localToday } from '../../calendar/calendar-dates';
import { BpmApi } from '../data/bpm-api.service';
import { ClosingGroup, ClosingJourney, ClosingPoint } from '../data/bpm-closing.models';
import { Bilan } from '../data/bpm-bilans.models';
import { BpmAmount } from '../ui/amount';
import { BpmRouterLink } from '../ui/bpm-router-link';
import { bpmLoader, bpmQueryState, BpmEntryFlow, BpmLineDetail, BpmPageContext, BpmPageFocus, BpmPageFrame, BpmPageResult, BpmRefresh, BpmState, newRequestKey } from '../ui';
import { EntryInput, RegisterLine } from '../data/bpm-models';
import { AlertTone, BpmClosingBoxes, BpmClosingTable, worst } from './closing-kit';
import { BpmClosingJournal, whenOf } from './closing-journal';
import { BpmClosingResolution, ChecksBaseline, checkTone, ClosingFix } from './closing-resolution';
import { BpmClosingCap, BpmClosingDecision } from './closing-dialogs';
import { BlockingPoint, checkBoxes, checkColumns, closeBoxes, closeConditions, closeTone, isUrgent, nextBoxes, pathBoxes, pathColumns, pct, plural, resultBoxes, resultTone } from './closing-boxes';

const STEP_TEXT: Record<ClosingGroup, string> = {
  income: 'Chaque entrée prévue du cycle est reçue, écartée parce qu’elle n’aura pas lieu, ou revue dans un cycle à venir.',
  charges: 'Chaque charge prévue du cycle est payée, écartée parce qu’elle n’aura pas lieu, ou revue dans un cycle à venir.',
  projects: 'Les dépenses et les gains prévus des projets financés par le cycle sont validés dans leur projet, écartés ou revus plus tard, selon l’avancement du projet.',
  decisions: 'Les parts de budget demandées et les dépassements à autoriser reçoivent leur décision, ou se revoient au cycle suivant.',
};
/** Un point clos depuis moins de deux minutes est signalé « à l'instant ». */
const FRESH_MS = 120_000;

/**
 * Clôture du cycle : quatre sections du plus important au moins crucial (1 à valider, 2 cohérence, 3 synthèse du résultat
 * et du cycle suivant, 4 clôturer, dont le bouton reste grisé tant que la clôture n'est pas débloquée) et, en ligne dépliable, les actions du cycle (consultatives). La page
 * s'ouvre repliée : chaque section montre ses encadrés de chiffres clés et son tableau, le détail se déplie.
 * Un même code couleur d'alerte partout : vert pour ce qui est bon, puis bleu, jaune, orange et rouge selon la gravité.
 * Tant que le cycle court, la page suit les points ; chacun se règle sur sa page, ou en fenêtre quand le site a son
 * formulaire (« Régler le problème » : fiche de l'échéance, carte de décision du projet, vérification du compte). À la fin
 * de son dernier jour, elle donne accès aux points encore ouverts, puis à la clôture qui fige le cycle et lance le suivant.
 * Le serveur calcule ; la page présente.
 */
@Component({
  selector: 'app-bpm-closing-page',
  providers: [BpmPageContext],
  imports: [BpmPageFrame, BpmState, BpmRouterLink, BpmAmount, BpmLineDetail, BpmEntryFlow, BpmClosingBoxes, BpmClosingTable, BpmClosingResolution, BpmClosingJournal, BpmClosingDecision, BpmClosingCap, CentsPipe, SignedCentsPipe, ShortDatePipe],
  templateUrl: './closing.page.html',
  styleUrls: ['./closing.page.scss'],
})
export class BpmClosingPage {
  private readonly bpm = inject(BpmApi);
  protected readonly ctx = inject(BpmPageContext);
  private readonly refresh = inject(BpmRefresh);
  private readonly changes = inject(DataChanges);

  /** Relue à chaque écriture, de cette page, d'une autre page ou d'un autre onglet : tout se compte en temps réel. */
  protected readonly read = bpmLoader(() => this.changes.version(), () => this.bpm.closingJourney());
  protected readonly j = computed<ClosingJourney | null>(() => this.read.data());
  /** Bilan du cycle concerné : provisoire tant qu'il n'est pas clos. */
  protected readonly bilanRead = bpmLoader(() => this.j()?.period?.key ?? null, (key) => (key ? this.bpm.bilan(key) : Promise.resolve(null)));
  protected readonly bilan = computed(() => this.bilanRead.data()?.bilan ?? null);

  /** Date du jour du serveur (celle qui fixe la phase), celle du navigateur en attendant la lecture. */
  protected readonly today = computed(() => this.j()?.context?.calculationDate ?? localToday());
  protected readonly phase = computed(() => this.j()?.phase ?? null);
  protected readonly closing = computed(() => this.phase() === 'to_close');
  protected readonly budgets = computed(() => this.j()?.context?.budgets ?? []);
  protected readonly criteria = computed(() => this.j()?.criteria ?? []);
  protected readonly preview = computed(() => this.j()?.closing?.preview ?? null);
  protected readonly firstTodo = computed(() => this.criteria().find((c) => c.state === 'todo')?.key ?? null);
  protected readonly actions = computed(() => this.j()?.actions ?? null);
  protected readonly checks = computed(() => this.j()?.checks ?? null);
  protected readonly stepText = STEP_TEXT;

  // ---------- anneau de complétude ----------

  // ---------- points ----------
  /** Points encore à traiter d'une étape (ouverts, reportés, ou pas encore ouverts), dans l'ordre du serveur. */
  protected pending(group: ClosingGroup) {
    return (this.j()?.points ?? []).filter((p) => p.group === group && p.state !== 'closed');
  }
  /** Points à valider (hors vérification du compte, qui est un point bloquant). */
  protected readonly openPoints = computed(() => (this.j()?.points ?? []).filter((p) => p.state === 'open'));
  /** Points urgents : en retard ou du jour. */
  protected readonly urgentCount = computed(() => this.openPoints().filter(isUrgent).length);
  /** Points clos du cycle, les plus récents d'abord. */
  protected readonly closedPoints = computed(() =>
    (this.j()?.points ?? [])
      .filter((p) => p.state === 'closed')
      .sort((a, b) => (b.closedAt ?? b.closedOn ?? '').localeCompare(a.closedAt ?? a.closedOn ?? '') || a.label.localeCompare(b.label, 'fr')),
  );
  /**
   * Niveau d'alerte du nombre de points à valider : vert s'il n'en reste aucun ; neutre tant qu'aucun n'est en retard
   * (ils sont à venir) ; jaune, orange puis rouge selon les retards ; en clôture, tout point ouvert est à traiter.
   */
  protected readonly openTone = computed<AlertTone>(() => {
    const j = this.j();
    const open = this.openPoints().length;
    const urgent = this.urgentCount();
    if (!j?.counts) return 'neutral';
    if (!open) return 'ok';
    if (j.phase === 'to_close') return open > 2 ? 'n4' : 'n3';
    return urgent === 0 ? 'neutral' : urgent <= 2 ? 'n2' : urgent <= 5 ? 'n3' : 'n4';
  });
  protected readonly openVerdict = computed(() => {
    const t = this.openTone();
    const urgent = this.urgentCount();
    if (this.closing()) return 'en clôture : chacun est à valider ou à reporter';
    if (t === 'ok') return 'tout est validé';
    if (t === 'neutral') return 'dans la normale : aucun en retard';
    const late = this.plural(urgent, 'en retard ou du jour', 'en retard ou du jour');
    return t === 'n2' ? `à surveiller : ${late}` : t === 'n3' ? `à traiter : ${late}` : `inquiétant : ${late}`;
  });
  /** Points bloquants : les contrôles bloquants en échec. */
  protected readonly blockingPoints = computed(() => {
    const j = this.j();
    if (!j?.period) return [];
    const list: BlockingPoint[] = [];
    for (const c of j.checks?.items ?? []) {
      if (c.level === 'blocking' && c.state === 'fail' && c.key !== 'points') list.push({ label: c.label, detail: c.value, tone: 'n4' });
    }
    return list;
  });
  /** Points clos à l'instant : vus ouverts à la lecture précédente, ou clos depuis moins de deux minutes. */
  protected readonly fresh = signal<ReadonlySet<string>>(new Set());
  private seen: { period: string; open: Set<string> } | null = null;
  protected isFresh(p: ClosingPoint) {
    return this.fresh().has(p.id) || (!!p.closedAt && Date.now() - Date.parse(p.closedAt) < FRESH_MS);
  }
  /** Heure de clôture, quand l'horloge du serveur est celle du jour (en recette, une date fixée la masque). */
  protected timeOf(p: ClosingPoint) {
    if (!p.closedAt || !p.closedOn) return null;
    const at = new Date(p.closedAt);
    const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    return day === p.closedOn ? `${at.getHours()} h ${String(at.getMinutes()).padStart(2, '0')}` : null;
  }
  /** La page où le point se traite sur le site (pour qui préfère y faire ses mises à jour). */
  protected whereTo(p: ClosingPoint): { path: string; query: Record<string, string | null>; label: string } | null {
    if (p.kind === 'decision') return { path: '/projet-de-vie/projets-finances', query: {}, label: 'Accorder ou refuser dans les règlements des projets' };
    if (p.group === 'projects' && p.project) return { path: `/app/gestion-projet/${p.project.coreProjectId}`, query: { ligne: p.lineId }, label: 'Valider dans le projet' };
    return { path: '/projet-de-vie/echeances', query: { ligne: p.lineId }, label: p.direction === 'income' ? 'Recevoir dans les échéances' : 'Régler dans les échéances' };
  }
  /** Cycles où revoir un point : le suivant pour une décision ; un cycle à venir, au choix, pour une échéance. */
  protected targetsOf(p: ClosingPoint) {
    const v = this.j();
    if (!v) return [];
    return p.kind === 'decision' ? v.targets.slice(0, 1) : v.targets;
  }

  // ---------- dernier passage sur la page : ce que les actions ont changé ----------
  /** État au dernier passage (points ouverts, contrôles), gardé pour la durée de la session du navigateur. */
  protected readonly baseline = signal<(ChecksBaseline & { open: string[] }) | null>(null);
  private baselineRead = false;
  private readonly visitKey = computed(() => {
    const key = this.j()?.period?.key;
    return key ? `bpm.closing.visit.${this.ctx.userId() ?? 'anonyme'}.${key}` : null;
  });
  protected readonly baselineTime = computed(() => {
    const at = this.baseline()?.at;
    if (!at) return null;
    const d = new Date(at);
    return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
  });
  /** Points clos depuis le dernier passage. */
  protected readonly closedSinceVisit = computed(() => {
    const was = new Set(this.baseline()?.open ?? []);
    return was.size ? this.closedPoints().filter((p) => was.has(p.id)).length : 0;
  });
  private saveVisit() {
    const j = this.j();
    const key = this.visitKey();
    if (!j?.period || !key) return;
    const snapshot = {
      at: new Date().toISOString(),
      open: this.openPoints().map((p) => p.id),
      checks: Object.fromEntries((j.checks?.items ?? []).map((c) => [c.key, { state: c.state, count: c.items.length + (c.more ?? 0), done: c.resolution?.progress?.done ?? null }])),
    };
    try { sessionStorage.setItem(key, JSON.stringify(snapshot)); } catch { /* stockage indisponible : pas de comparaison au prochain passage */ }
  }

  // ---------- chiffres clés des sections (closing-boxes.ts) ----------
  protected readonly pathBoxes = computed(() => pathBoxes({
    j: this.j(), open: this.openPoints(), closed: this.closedPoints(), blocking: this.blockingPoints(), openTone: this.openTone(),
    openVerdict: this.openVerdict(), closing: this.closing(), since: this.closedSinceVisit(), baselineTime: this.baselineTime(),
  }));
  protected readonly pathColumns = computed(() => pathColumns(this.j(), this.openPoints(), this.closing()));
  protected readonly resultTone = computed(() => resultTone(this.bilan(), this.j()));
  protected readonly resultBoxes = computed(() => resultBoxes(this.bilan(), this.j()));
  /** Le fait qui résume le cycle (excédent ou déficit), en tête de la synthèse ; le détail reste dans le bilan. */
  protected readonly verdict = computed(() => this.bilan()?.highlights[0] ?? null);
  protected natureSummary(natures: Bilan['natures']): string {
    return 'Dépenses par nature : ' + natures.map((n) => `${n.label} ${pct(n.sharePct ?? 0)} %`).join(', ');
  }
  protected readonly nextBoxes = computed(() => nextBoxes(this.j()));
  protected readonly checkBoxes = computed(() => checkBoxes(this.checks()));
  protected readonly checkColumns = computed(() => checkColumns(this.checks()));
  protected readonly checksTone = computed<AlertTone>(() => worst(...(this.checks()?.items ?? []).map(checkTone)));
  /** Ce qui manque encore pour clôturer : points à valider, points bloquants. */
  protected readonly conditions = computed(() => closeConditions(this.j(), this.openPoints().length, this.closing(), this.openTone(), this.blockingPoints()));
  protected readonly closeTone = computed(() => closeTone(this.j(), this.conditions()));
  protected readonly closeBoxes = computed(() => closeBoxes(this.j(), this.conditions()));

  // ---------- synthèse : une tuile par section ----------
  /** Aller à un endroit de la page (étape de résolution) : la section qui le porte se déplie. */
  protected goTo(id: string) {
    if (id.startsWith('closing-step') || id === 'closing-path-title') this.unfold('path');
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  // ---------- sections repliées : la page s'ouvre repliée ----------
  // Le compte rendu (section 3) est toujours déplié ; la clôture (section 4) ne s'ouvre que débloquée.
  protected readonly folded = signal<Record<SectionKey, boolean>>(allSections(true));
  private readonly foldable = computed<SectionKey[]>(() => SECTIONS.filter((k) => k !== 'close' || !!this.j()?.canClose));
  protected readonly allOpen = computed(() => this.foldable().every((k) => !this.folded()[k]));
  protected readonly allFolded = computed(() => this.foldable().every((k) => this.folded()[k]));
  protected toggle(key: SectionKey) {
    if (key === 'close' && !this.j()?.canClose) return;
    this.folded.update((f) => ({ ...f, [key]: !f[key] }));
  }
  protected foldAll(value: boolean) { this.folded.update((f) => ({ ...f, ...Object.fromEntries(this.foldable().map((k) => [k, value])) })); }
  private unfold(key: SectionKey) { if (this.folded()[key]) this.folded.update((f) => ({ ...f, [key]: false })); }

  // ---------- actions (mode clôture seulement) ----------
  protected readonly busy = signal<string | null>(null);
  private readonly notice = signal<{ text: string; tone: 'success' | 'danger' | 'info' } | null>(null);
  private closeKey = newRequestKey('closing');
  protected readonly lineId = bpmQueryState<string | null>('ligne', null, { overlay: true });

  constructor() {
    effect(() => {
      const j = this.j();
      if (!j?.period) return;
      // Dernier passage : lu une fois, à la première lecture de la page.
      if (!this.baselineRead) {
        this.baselineRead = true;
        const key = untracked(this.visitKey);
        try {
          const raw = key ? sessionStorage.getItem(key) : null;
          if (raw) untracked(() => this.baseline.set(JSON.parse(raw)));
        } catch { /* rien à comparer */ }
      }
      // Un point qui se clôt pendant que la page est ouverte (ici ou ailleurs) est signalé à l'instant.
      const seen = this.seen;
      const open = new Set(j.points.filter((p) => p.state !== 'closed').map((p) => p.id));
      this.seen = { period: j.period.key, open };
      if (!seen || seen.period !== j.period.key) return;
      const closed = j.points.filter((p) => p.state === 'closed' && seen.open.has(p.id));
      if (!closed.length) return;
      untracked(() => {
        this.fresh.update((s) => new Set([...s, ...closed.map((p) => p.id)]));
        if (!this.busy() && !this.notice()) {
          const what = closed.length === 1 ? `« ${closed[0].label} » est clos` : `${closed.length} points sont clos`;
          this.notice.set({ text: `${what} à l’instant · ${j.period!.label} complété à ${j.percent} %.`, tone: 'info' });
        }
      });
    });
    // Au départ de la page, l'état est gardé : au retour, elle dit ce que les actions faites ailleurs ont changé.
    const leave = () => this.saveVisit();
    window.addEventListener('pagehide', leave);
    inject(DestroyRef).onDestroy(() => {
      leave();
      window.removeEventListener('pagehide', leave);
    });
  }

  private async act(id: string, run: () => Promise<unknown>, success: string | null) {
    if (this.busy()) return;
    this.busy.set(id);
    this.notice.set(null);
    try {
      await run();
      if (success) this.notice.set({ text: success, tone: 'success' });
    } catch (err) {
      this.notice.set({ text: toApiError(err).message, tone: 'danger' });
    } finally {
      this.busy.set(null);
      this.refresh.bump();
    }
  }

  /** Validé comme prévu : à sa date et à son montant prévus (l'écart se saisit depuis le détail de la ligne). */
  protected settle(p: ClosingPoint) {
    if (!this.closing() || p.kind !== 'line' || !p.plannedDate) return;
    const done = `« ${p.label} » : ${p.direction === 'income' ? 'reçue' : 'payée'} le ${dateText(p.plannedDate)}.`;
    return this.act(p.id, () => p.lineKind === 'occurrence'
      ? this.bpm.settleOccurrence(p.recurrenceId!, { requestKey: newRequestKey('closing-settle'), occurrenceDate: p.occurrenceDate!, realizedDate: p.plannedDate! })
      : this.bpm.realizeOperation(p.operationId!, { expectedRevision: p.revision!, realizedDate: p.plannedDate! }), done);
  }
  /** Non validé dans ce cycle : le point garde sa marque et se revoit dans le cycle choisi (null : retirer le report). */
  protected defer(p: ClosingPoint, toPeriodKey: string | null) {
    const j = this.j()!;
    const target = j.targets.find((t) => t.key === toPeriodKey);
    return this.act(p.id, () => this.bpm.closingDecision({ periodKey: j.period!.key, defer: { pointId: p.id, toPeriodKey } }),
      target ? `« ${p.label} » n’est pas validé dans ${j.period!.label} : il se reverra en ${target.label}.` : `« ${p.label} » reste à traiter dans ${j.period!.label}.`);
  }
  protected finalize() {
    const j = this.j();
    const pv = this.preview();
    if (!j?.canClose || !pv || !j.period) return;
    return this.act('finalize', async () => {
      const r = await this.bpm.finalizeClosing({ requestKey: this.closeKey, periodKey: j.period!.key, expectedResultCents: pv.resultCents });
      this.closeKey = newRequestKey('closing');
      const deferred = r.deferredCount ? ` ${r.deferredCount} point${r.deferredCount > 1 ? 's' : ''} non validé${r.deferredCount > 1 ? 's' : ''} ici se reverr${r.deferredCount > 1 ? 'ont' : 'a'} dans leur cycle.` : '';
      this.notice.set({ text: `${r.closure.periodLabel} est clôturé : ${signedCents(Math.round(r.closure.result * 100))} capitalisés dans le patrimoine. ${j.next!.label} est lancé.${deferred}`, tone: 'success' });
    }, null);
  }
  /** Action principale de la barre : clôturer quand tout est prêt, sinon déplier et montrer le premier point à traiter. */
  protected runPrimary() {
    if (this.j()?.canClose) return void this.finalize();
    this.goTo(this.firstTodo() ? `closing-step-${this.firstTodo()}` : 'closing-path-title');
  }
  protected readonly primaryLabel = computed(() => {
    const j = this.j();
    if (!j?.period) return 'Régler le cycle';
    if (j.canClose) return `Clôturer ${j.period.label}`;
    return j.phase === 'to_close' ? `Finaliser les points · ${j.percent} %` : `Suivre les points · ${j.percent} %`;
  });

  protected openLine(id: string | null) { if (id) this.lineId.set(id); }

  // ---------- « Régler le problème » : le formulaire du site, en fenêtre ----------
  /** La décision ouverte en fenêtre (l'échéance, elle, passe par `lineId`, comme sur ses pages). */
  protected readonly decisionPoint = signal<ClosingPoint | null>(null);
  /** Un point se règle en fenêtre quand le site a son formulaire : la fiche de l'échéance, la carte de décision du projet. */
  protected fixable(p: ClosingPoint) {
    return p.kind === 'line' ? !!p.lineId : p.kind === 'decision' && !!p.project?.coreProjectId && !!p.decisionId;
  }
  protected fix(p: ClosingPoint) {
    if (!this.fixable(p)) return;
    if (p.kind === 'line') this.openLine(p.lineId);
    else this.decisionPoint.set(p);
  }
  /** Décision prise dans sa fenêtre : son message, puis la page se relit (le point se clôt « à l'instant »). */
  protected decided(text: string) {
    this.decisionPoint.set(null);
    this.notice.set({ text, tone: 'success' });
    this.refresh.bump();
  }
  /** Postes au-delà de leur plafond ouverts dans la fenêtre du plafond. */
  protected readonly capRefs = signal<string[] | null>(null);
  protected capSaved(text: string) {
    this.capRefs.set(null);
    this.saved(text);
  }
  /** Saisir un mouvement manquant, déjà réglé : la fenêtre de saisie du site, sur cette page. */
  protected newEntry(direction: 'income' | 'charge', paid = false) { void this.ctx.setQuery({ entry: 'new', entryDirection: direction, entryPaid: paid ? '1' : null }); }
  protected readonly entryDefaults = computed<Partial<EntryInput>>(() => {
    const q = this.ctx.query();
    return { direction: q.get('entryDirection') === 'income' ? 'income' : 'charge', ...(q.get('entryPaid') === '1' ? { status: 'realized' as const } : {}) };
  });
  private pointOf(id: string | undefined) { return id ? this.j()?.points.find((p) => p.id === id) ?? null : null; }
  /** Étape générale des points (« réglez chaque échéance », « les décisions… ») : le premier point ouvert de ce genre. */
  private firstOpen(kind: ClosingPoint['kind']) { return this.openPoints().find((p) => p.kind === kind && this.fixable(p)) ?? null; }
  private pointFor(f: ClosingFix) {
    const t = f.target;
    if (t.kind === 'decisions') return f.itemId ? this.pointOf(f.itemId) : this.firstOpen('decision');
    if (t.kind === 'page' && t.path === 'echeances' && f.check.key === 'points') return this.firstOpen('line');
    if (t.kind === 'page' && t.path === 'echeances' && f.check.key === 'caps') {
      // « Écartez ou reportez une échéance de ce poste qui n'a pas encore eu lieu » : la première à venir des postes en cause.
      const centers = new Set(f.check.items.map((i) => i.label));
      return this.openPoints().find((p) => p.kind === 'line' && p.status === 'pending' && !!p.costCenterLabel && centers.has(p.costCenterLabel) && this.fixable(p)) ?? null;
    }
    return null;
  }
  private capRefsOf(f: ClosingFix) {
    return f.target.kind === 'center' ? [f.target.ref] : f.check.items.flatMap((i) => (i.target?.kind === 'center' ? [i.target.ref] : []));
  }
  /**
   * Section 3 : une étape ou un élément d'un contrôle se règle en fenêtre, sur cette page, quand le site a le formulaire :
   * fiche de l'échéance, carte de décision, plafond du poste.
   */
  protected readonly canFixCheck = (f: ClosingFix): boolean => {
    const t = f.target;
    switch (t.kind) {
      case 'line': return !!t.id;
      case 'decisions': { const p = this.pointFor(f); return !!p && this.fixable(p); }
      case 'center': return !!t.ref;
      case 'page':
        return (t.path === 'plafonds' && this.capRefsOf(f).length > 0) || !!this.pointFor(f);
      default: return false;
    }
  };
  protected fixCheck(f: ClosingFix) {
    if (!this.canFixCheck(f)) return;
    const t = f.target;
    const p = this.pointFor(f);
    if (p) this.fix(p);
    else if (t.kind === 'line') this.openLine(t.id);
    else if (t.kind === 'center' || (t.kind === 'page' && t.path === 'plafonds')) this.capRefs.set(this.capRefsOf(f));
  }
  protected closeLine() { this.lineId.set(null); this.refresh.bump(); }
  protected editLine(line: RegisterLine) { this.lineId.set(null); void this.ctx.setQuery({ entry: line.id }); }
  protected saved(text: string) { this.notice.set({ text, tone: 'success' }); this.refresh.bump(); }

  // ---------- barre et panneau ----------
  protected readonly focus = computed<BpmPageFocus | null>(() => {
    const j = this.j();
    if (!j?.period) return null;
    const open = this.openPoints().length;
    if (j.phase === 'running') {
      return { title: `${j.period.label} : ${this.plural(open, 'point', 'points')} à valider`, detail: `Dont ${this.plural(this.urgentCount(), 'urgent')}. Clore les points au plus tôt laisse moins à revoir le ${dateText(j.opensOn!)}, quand le cycle entrera en clôture.`, tone: 'info' };
    }
    if (j.canClose) return { title: `${j.period.label} est prêt à clôturer`, detail: `La clôture lance ${j.next!.label}.`, tone: 'success' };
    return { title: `${j.period.label} en clôture : ${j.percent} %`, detail: `Reste : ${(j.remaining ?? []).join(', ')}.`, tone: 'warning' };
  });
  protected readonly result = computed<BpmPageResult | null>(() => {
    const n = this.notice();
    if (n) return { message: n.text, tone: n.tone };
    if (this.busy() === 'finalize') return { message: 'Clôture en cours : bilan figé, résultat capitalisé, cycle suivant lancé…', tone: 'info' };
    return null;
  });

  protected readonly cents = cents;
  protected readonly dateText = dateText;
  protected readonly whenOf = whenOf;
  protected readonly pct = pct;
  protected readonly plural = plural;
}

function dateText(ymd: string) {
  return new Date(`${ymd}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Sections de la page, du plus important au moins crucial. */
type SectionKey = 'path' | 'checks' | 'close';
const SECTIONS: SectionKey[] = ['path', 'checks', 'close'];
const allSections = (value: boolean) => Object.fromEntries(SECTIONS.map((k) => [k, value])) as Record<SectionKey, boolean>;

/** Tuile de la synthèse : une section de la page, son niveau d'alerte, son chiffre, sa légende. */
