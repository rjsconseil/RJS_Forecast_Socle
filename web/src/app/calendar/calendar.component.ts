import { TopLayerDirective } from './top-layer.directive';
import { MonthPeek, PeekHost, YearPeek } from './calendar-peeks';
import {
  ChangeDetectionStrategy,
  afterNextRender,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  Injector,
  input,
  output,
  signal,
  TemplateRef,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  CalendarView,
  gridWindow,
  inPeriod,
  localToday,
  monthDays,
  periodBounds,
  monthTitle,
  periodLabel,
  shiftDate,
  shiftPeriod,
  validDate,
  weekDays,
  yearMonths,
} from './calendar-dates';
import {
  CalendarData,
  CalendarDisplayChoice,
  CalendarElement,
  CalendarEvent,
  CalendarFormat,
  CalendarFormatField,
  CalendarIndicatorKey,
  CalendarLayout,
  CalendarPeriod,
  CalendarSourceOffer,
} from './calendar.models';
import {
  FORMAT_FIELDS,
  LAYOUTS,
  LAYOUT_LABELS,
  availableFormats,
  describeFormat,
  newFormatId,
} from './calendar-formats';
import {
  DayStat,
  MARKER_LABEL,
  MARKER_SYMBOL,
  dayStats,
  detailRows,
  formatAmount,
  groupByDay,
  toneColor,
} from './calendar-model';
import { RecetteContext } from '../core/api.service';
import {
  CalendarEffectParameter,
  EFFECT_PARAMETERS,
  designStyle,
  effectStyle,
  effectValues,
  injectCalendarPresentation,
} from './presentation/calendar-presentation';
import {
  CalendarDisplayPreferences,
  displayDefaults,
  resolveDisplayPreferences,
} from './calendar-display-preferences';

const VIEW_PARAM: Record<CalendarView, string> = { week: 'semaine', month: 'mois', year: 'annee' };
const PARAM_VIEW: Record<string, CalendarView> = { semaine: 'week', mois: 'month', annee: 'year' };
const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const FULL_DATE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'UTC' });

/**
 * Calendrier du module Calendrier, repris du Calendrier 360 de la référence (`calendar.component.ts`) et rendu
 * générique : il présente les éléments et repères d'une configuration, sans connaître leur domaine.
 * Trois vues (Semaine, Mois, Année) ; aperçu d'une journée au survol avec les indicateurs et les entrées de
 * survol paramétrés ; agenda de la période avec mise en évidence ; déplacement d'un repère (glisser-déposer
 * ou « Replanifier ») quand sa configuration nomme une commande. La vue et le jour sont gardés dans l'URL.
 */
@Component({
  selector: 'rjs-calendar',
  imports: [FormsModule, NgTemplateOutlet, TopLayerDirective],
  styleUrls: ['./calendar-skin.scss', './calendar-skin-views.scss', './calendar-skin-compact.scss', './calendar-skin-design.scss', './calendar-skin-effects.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './calendar.component.html',
})
export class CalendarComponent {
  readonly data = input<CalendarData | null>(null);
  /** La page hôte porte les commandes du calendrier dans son propre bandeau (ou sa barre d'outils). */
  readonly externalTools = input(false);
  readonly showSourceSummary = input(true);
  readonly presentation = input<'calendar' | 'agenda' | 'sources'>('calendar');
  /** L’encadré de personnalisation (sources, format, lecture, indicateurs) : contenu du volet du module. */
  readonly personalization = viewChild.required<TemplateRef<unknown>>('personalization');
  readonly loading = input(false);
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  readonly feedback = input('');
  readonly periodChange = output<CalendarPeriod>();
  readonly open = output<CalendarEvent>();
  readonly reschedule = output<{ event: CalendarEvent; date: string }>();
  readonly displayedEventsChange = output<CalendarEvent[]>();
  /** Sources branchées choisies par la personne (nul : revenir à celles de la configuration). */
  readonly sourcesChange = output<string[] | null>();
  /** Préférences d'affichage choisies (nul : revenir à celles du calendrier) ; l'espace les enregistre. */
  readonly preferencesChange = output<CalendarDisplayChoice | null>();
  /** Formats créés par la personne, après création, modification ou suppression ; l'espace les enregistre. */
  readonly formatsChange = output<CalendarFormat[]>();
  /** Présentation resserrée, quand la page hôte porte déjà titre et commandes. */
  readonly compact = input(false);

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly context = inject(RecetteContext);
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly today = localToday();
  protected readonly markerText = MARKER_LABEL;
  protected readonly weekdays = ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.', 'Dim.'];
  protected readonly valid = validDate;

  private readonly requestedView =
    PARAM_VIEW[this.route.snapshot.queryParamMap.get('vue') ?? ''] ?? null;
  private readonly requestedDay = this.route.snapshot.queryParamMap.get('jour');
  protected readonly view = signal<CalendarView>(this.requestedView ?? 'month');
  protected readonly selectedDay = signal(
    validDate(this.requestedDay) ? this.requestedDay : this.today,
  );
  /** Vue choisie par la personne (URL ou bouton) : la vue d'ouverture paramétrée ne s'applique plus. */
  private viewChosen = this.requestedView !== null;
  private initialized = false;

  protected readonly hidden = signal<ReadonlySet<string>>(new Set());
  protected readonly includeDone = signal(true);
  protected readonly group = signal(this.route.snapshot.queryParamMap.get('calGroup') || 'all');
  protected readonly formatFields = FORMAT_FIELDS;
  protected readonly layouts = LAYOUTS;
  protected readonly layoutLabels = LAYOUT_LABELS;
  protected readonly describeFormat = describeFormat;
  /** Formats créés par la personne (tous ses calendriers). */
  private readonly ownFormats = signal<CalendarFormat[]>([]);
  /** Formats proposés : livrés, de la configuration, puis ceux de la personne ; tous s'appellent par leur id. */
  protected readonly formats = computed(() => availableFormats(this.data(), this.ownFormats()));
  /** Format en cours : celui choisi, sinon celui d'ouverture de la configuration, sinon le premier. */
  protected readonly format = computed<CalendarFormat>(() => {
    const all = this.formats();
    return all.find((f) => f.id === this.preferences()?.format) ?? all.find((f) => f.id === this.data()?.display.format) ?? all[0];
  });
  /** Champs montrés sur chaque événement, dans l'ordre du format (le total est celui du jour, dans la case). */
  protected readonly eventFields = computed(() => this.format().fields.filter((f) => f !== 'total'));
  /** Format en cours de création ou de modification. */
  protected readonly formatDraft = signal<{ id: string | null; label: string; layout: CalendarLayout; fields: CalendarFormatField[]; perCell: number | null } | null>(null);
  /** Sources proposées au branchement, rangées par provenance. */
  protected readonly library = computed(() => {
    const groups = new Map<string, { label: string; sources: CalendarSourceOffer[] }>();
    for (const offer of this.data()?.library ?? []) {
      const key = offer.origin?.calendar ?? '';
      if (!groups.has(key)) groups.set(key, { label: offer.origin ? offer.origin.label : 'Ce calendrier', sources: [] });
      groups.get(key)!.sources.push(offer);
    }
    return [...groups.values()];
  });
  private readonly preferences = signal<CalendarDisplayPreferences | null>(null);
  private preferenceProfile: string | undefined;
  protected readonly visibleSourceCount = computed(
    () => this.elements().filter((el) => !this.hidden().has(el.id)).length,
  );

  protected readonly month = computed(() => this.selectedDay().slice(0, 7));
  /** Bornes de la période affichée (jour, semaine, mois ou année). */
  protected readonly periodRange = computed(() => periodBounds(this.selectedDay(), this.view()));

  // ---------- couche de présentation : design (apparence) et effets d'affichage (mouvement) ----------
  /** Designs et effets proposés : ceux du module, puis ceux que le site a fournis. */
  private readonly presentationCatalog = injectCalendarPresentation();
  protected readonly designs = this.presentationCatalog.designs;
  protected readonly effects = this.presentationCatalog.effects;
  /** Design en cours : celui choisi, sinon celui d'ouverture du calendrier, sinon le standard. */
  protected readonly design = computed(() =>
    this.designs.find((d) => d.id === this.preferences()?.design) ?? this.designs.find((d) => d.id === this.data()?.display.design) ?? this.designs[0]);
  /** Effet en cours, avec ses réglages (ceux de la personne, sinon ceux de l'effet). */
  protected readonly effect = computed(() =>
    this.effects.find((e) => e.id === this.preferences()?.effect) ?? this.effects.find((e) => e.id === this.data()?.display.effect) ?? this.effects[0]);
  protected readonly effectSettings = computed(() => effectValues(this.effect(), this.preferences()?.effectParams));
  protected readonly effectParameters = computed(() =>
    (Object.keys(this.effect().defaults) as CalendarEffectParameter[]).map((key) => ({ key, ...EFFECT_PARAMETERS[key], value: this.effectSettings()[key] })));
  /** Variables posées sur le calendrier : jetons du design, puis réglages de l'effet. */
  protected readonly presentationStyle = computed(() => ({ ...designStyle(this.design()), ...effectStyle(this.effect(), this.effectSettings()) }));
  protected readonly presentationClass = computed(() => [this.design().className, this.effect().className].filter(Boolean).join(' '));
  /** Classe de sortie (fondu) posée sur un élément retiré, le temps de sa disparition. */
  protected readonly fxLeave = computed(() => (this.effect().motion.leave !== 'none' && this.effectSettings().leaveMs > 0 ? 'cal-fx-leaving' : ''));
  /** Fondu enchaîné : la période affichée s'efface avant que la suivante n'apparaisse. */
  protected readonly periodLeaving = signal(false);
  private periodTimer: ReturnType<typeof setTimeout> | null = null;
  private periodFadeMs() {
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    return this.effect().motion.period === 'crossfade' && !reduced ? this.effectSettings().leaveMs : 0;
  }
  private fadePeriod(change: () => void) {
    const ms = this.periodFadeMs();
    if (this.periodTimer) clearTimeout(this.periodTimer);
    if (!ms) { this.periodLeaving.set(false); change(); return; }
    this.periodLeaving.set(true);
    this.periodTimer = setTimeout(() => { this.periodTimer = null; change(); this.periodLeaving.set(false); }, ms);
  }
  protected chooseDesign(id: string) {
    if (!this.controlAllowed('appearance') || !this.designs.some((d) => d.id === id)) return;
    this.savePreferences({ design: id });
  }
  protected chooseEffect(id: string) {
    if (!this.controlAllowed('appearance') || !this.effects.some((e) => e.id === id)) return;
    this.savePreferences({ effect: id, effectParams: {} });
  }
  protected setEffectParam(key: CalendarEffectParameter, value: number) {
    if (!this.controlAllowed('appearance') || !Number.isFinite(value)) return;
    this.savePreferences({ effectParams: { ...this.preferences()?.effectParams, [key]: value } });
  }
  protected resetEffectParams() {
    if (this.controlAllowed('appearance')) this.savePreferences({ effectParams: {} });
  }

  // ---------- volet « Sources et affichage » ----------
  /** Ancre du volet : un lien `#sources-et-affichage` l'ouvre et l'amène à l'écran. */
  protected readonly settingsAnchor = 'sources-et-affichage';
  readonly settingsOpen = signal(false);
  readonly settingsAvailable = computed(() => !!this.data() && this.data()!.interaction?.access !== 'hidden');
  private readonly settingsRef = viewChild<ElementRef<HTMLDetailsElement>>('settings');
  private settingsIdentity = '';
  private handledFragment: string | null | undefined = undefined;
  private readonly fragment = toSignal(this.route.fragment, { initialValue: this.route.snapshot.fragment });
  /** Ouvre ou referme le volet (bouton de la page hôte), et l'amène à l'écran à l'ouverture. */
  toggleSettings(open = !this.settingsOpen()) {
    this.settingsOpen.set(open);
    if (open) afterNextRender(() => {
      const settings = this.settingsRef()?.nativeElement;
      settings?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      settings?.querySelector('summary')?.focus({ preventScroll: true });
    }, { injector: this.injector });
  }
  protected readonly periodName = computed(() => periodLabel(this.selectedDay(), this.view()));
  protected readonly monthButtonLabel = computed(() =>
    new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(this.month() + '-01T12:00:00Z'),
    ),
  );
  protected readonly previousLabel = computed(
    () =>
      ({ month: 'Mois précédent', year: 'Année précédente', week: 'Semaine précédente' })[
        this.view()
      ],
  );
  protected readonly nextLabel = computed(
    () =>
      ({ month: 'Mois suivant', year: 'Année suivante', week: 'Semaine suivante' })[this.view()],
  );
  protected readonly days = computed(() =>
    this.view() === 'week' ? weekDays(this.selectedDay()) : monthDays(this.month()),
  );
  protected readonly months = computed(() => yearMonths(this.selectedDay()));

  protected readonly elements = computed(() => this.data()?.elements ?? []);
  protected readonly indicators = computed(() =>
    (this.data()?.indicators ?? []).filter(
      (indicator) => this.indicatorShown(indicator.key),
    ),
  );
  private readonly elementsById = computed(() => new Map(this.elements().map((el) => [el.id, el])));
  protected readonly perCell = computed(
    () => this.preferences()?.perCell ?? this.format()?.perCell ?? this.data()?.display.perCell ?? 2,
  );
  protected readonly perPeek = computed(() => this.data()?.display.perPeek ?? 4);
  private readonly closeDelay = computed(() => this.data()?.display.peekCloseDelayMs ?? 260);

  /** Regroupements présents (projets, Budgets…), pour le filtre. */
  protected readonly groups = computed(() => {
    const out = new Map<string, string>();
    for (const e of this.data()?.events ?? [])
      out.set(e.groupId ?? `__${e.groupLabel ?? ''}`, e.groupLabel ?? 'Sans regroupement');
    return [...out]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  });
  /** Repères affichés : éléments visibles, terminés selon le choix, regroupement choisi. */
  protected readonly events = computed(() => {
    const hidden = this.hidden();
    const g = this.group();
    return (this.data()?.events ?? []).filter(
      (e) =>
        !hidden.has(e.element) &&
        (this.includeDone() || !e.done) &&
        (g === 'all' || (e.groupId ?? `__${e.groupLabel ?? ''}`) === g),
    );
  });
  protected readonly periodEvents = computed(() =>
    this.events().filter((e) => inPeriod(e.date, this.selectedDay(), this.view())),
  );
  protected readonly byDay = computed(() => groupByDay(this.periodEvents()));
  protected readonly periodDays = computed(() =>
    [...this.byDay()]
      .map(([day, events]) => ({ day, events }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  );
  /** Repères de la période par élément, tous éléments confondus (compteurs de la légende). */
  private readonly periodCounts = computed(() => {
    const counts = new Map<string, number>();
    for (const e of this.data()?.events ?? [])
      if (inPeriod(e.date, this.selectedDay(), this.view()))
        counts.set(e.element, (counts.get(e.element) ?? 0) + 1);
    return counts;
  });
  protected readonly reschedulingAvailable = computed(() => this.elements().some((el) => el.reschedulable));
  protected readonly gridHint = computed(() =>
    this.reschedulingAvailable()
      ? 'Déplacez un repère pour replanifier sa date.'
      : 'Survolez un jour pour lire ses repères.',
  );

  // ---------- mise en évidence ----------
  protected readonly hoveredEventKey = signal<string | null>(null);
  protected readonly pinnedEventKeys = signal<ReadonlySet<string>>(new Set());
  private readonly highlightedKeys = computed(() => {
    const keys = new Set(this.pinnedEventKeys());
    const hovered = this.hoveredEventKey();
    if (hovered) keys.add(hovered);
    return keys;
  });

  // ---------- aperçus (mois / semaine, année) ----------
  // ---------- aperçus (mois / semaine, année) : voir calendar-peeks.ts ----------
  private readonly pointer: PeekHost['pointer'] = { at: null };
  private readonly peekHost: PeekHost = {
    hasDay: (day) => this.byDay().has(day),
    selectDay: (day) => this.selectDay(day),
    closeDelay: () => this.closeDelay(),
    view: () => this.view(),
    closeDetails: () => this.closePeekDetails(),
    pointer: this.pointer,
  };
  private readonly monthPeek = new MonthPeek(this.peekHost);
  private readonly yearPeek = new YearPeek(this.peekHost);
  protected readonly expandedDay = this.monthPeek.expandedDay;
  protected readonly hoveredMonthDay = this.monthPeek.hoveredMonthDay;
  protected readonly focusedMonthDay = this.monthPeek.focusedMonthDay;
  protected readonly pinnedMonthDay = this.monthPeek.pinnedMonthDay;
  protected readonly monthPeekPosition = this.monthPeek.monthPeekPosition;
  protected readonly visibleMonthDay = this.monthPeek.visibleMonthDay;
  protected readonly hoveredYearDay = this.yearPeek.hoveredYearDay;
  protected readonly focusedYearDay = this.yearPeek.focusedYearDay;
  protected readonly pinnedYearDay = this.yearPeek.pinnedYearDay;
  protected readonly expandedYearPeekDay = this.yearPeek.expandedYearPeekDay;
  protected readonly yearPeekPosition = this.yearPeek.yearPeekPosition;
  protected readonly visibleYearDay = this.yearPeek.visibleYearDay;
  protected toggleDayExpansion(day: string, event: MouseEvent) { this.monthPeek.toggleDayExpansion(day, event); }
  protected enterMonthDay(day: string, event: PointerEvent) { this.monthPeek.enterMonthDay(day, event); }
  protected orientMonthPeek(day: string, event: PointerEvent) { this.monthPeek.orientMonthPeek(day, event); }
  protected leaveMonthDay(day: string) { this.monthPeek.leaveMonthDay(day); }
  protected toggleMonthPeekPin(day: string, event: MouseEvent) { this.monthPeek.toggleMonthPeekPin(day, event); }
  protected cancelMonthPeekClose() { this.monthPeek.cancelMonthPeekClose(); }
  protected scheduleMonthPeekClose(day: string) { this.monthPeek.scheduleMonthPeekClose(day); }
  protected focusMonthDay(day: string, event: FocusEvent) { this.monthPeek.focusMonthDay(day, event); }
  protected clearMonthDayFocus(event: FocusEvent) { this.monthPeek.clearMonthDayFocus(event); }
  protected toggleYearDay(day: string, event: MouseEvent) { this.yearPeek.toggleYearDay(day, event); }
  protected enterYearDay(day: string, event: PointerEvent) { this.yearPeek.enterYearDay(day, event); }
  protected orientYearPeek(day: string, event: PointerEvent) { this.yearPeek.orientYearPeek(day, event); }
  protected leaveYearDay(day: string) { this.yearPeek.leaveYearDay(day); }
  protected positionYearPeekOnFocus(event: FocusEvent) { this.yearPeek.positionYearPeekOnFocus(event); }
  protected clearYearDayFocus(event: FocusEvent) { this.yearPeek.clearYearDayFocus(event); }
  protected cancelYearPeekClose() { this.yearPeek.cancelYearPeekClose(); }
  protected scheduleYearPeekClose(day = this.visibleYearDay()) { this.yearPeek.scheduleYearPeekClose(day); }

  protected readonly activePeekDay = signal<string | null>(null);
  protected readonly activePeekStat = signal<CalendarIndicatorKey | null>(null);
  protected readonly peekDetailsPosition = signal({ left: 0, top: 0, maxHeight: 0 });

  // ---------- replanification ----------
  protected readonly planning = signal<CalendarEvent | null>(null);
  protected plannedDate = '';
  protected dragged: CalendarEvent | null = null;

  constructor() {
    effect(() => {
      const params = this.params();
      const data = this.data();
      const key = params.get('calPlan');
      untracked(() => {
        if (!key) { this.planning.set(null); return; }
        const event = data?.events.find(event => event.key === key);
        if (event) this.planning.set(event);
        if (params.has('calDate')) this.plannedDate = params.get('calDate')!;
      });
    });
    this.destroyRef.onDestroy(() => {
      if (this.periodTimer) clearTimeout(this.periodTimer);
      this.cancelYearPeekClose();
      this.cancelMonthPeekClose();
    });
    // Volet : ouvert à l'arrivée si le calendrier le demande, ou si l'adresse vise son ancre.
    effect(() => {
      const data = this.data();
      const fragment = this.fragment();
      if (!data) return;
      const identity = JSON.stringify([data.calendar.id, data.parameter?.revision]);
      untracked(() => {
        if (identity !== this.settingsIdentity) {
          this.settingsIdentity = identity;
          this.settingsOpen.set(data.interaction?.access === 'expanded');
        }
        if (fragment !== this.handledFragment) {
          this.handledFragment = fragment;
          if (fragment === this.settingsAnchor && data.interaction?.access !== 'hidden') this.toggleSettings(true);
        }
      });
    });
    // Première lecture : la vue d'ouverture et les éléments masqués viennent du paramétrage du calendrier.
    effect(() => {
      const data = this.data();
      if (!data || this.initialized) return;
      this.initialized = true;
      untracked(() => {
        this.hidden.set(new Set(data.elements.filter((el) => !el.visible).map((el) => el.id)));
        if (!this.viewChosen && data.display.view !== this.view())
          this.setView(data.display.view, { chosen: false });
      });
    });
    effect(() => {
      const data = this.data(),
        profile = this.context.userId();
      if (!data) return;
      // Les préférences enregistrées (`data.preferences`, `formats` à soi) sont reprises quand elles changent
      // ailleurs (autre onglet, autre appareil) ; un choix fait ici est déjà à l'écran.
      const identity = JSON.stringify([profile, data.calendar.id, data.parameter?.revision, data.interaction, data.elements, data.display, data.preferences, (data.formats ?? []).filter((x) => x.own)]);
      if (this.preferenceProfile === identity) return;
      const previousIdentity = this.preferenceProfile;
      this.preferenceProfile = identity;
      untracked(() => {
        if (previousIdentity !== undefined && data.display.view !== this.view()) this.setView(data.display.view, { chosen: false });
        const preferences = resolveDisplayPreferences(data);
        this.preferences.set(preferences);
        this.ownFormats.set((data.formats ?? []).filter((x) => x.own));
        this.hidden.set(
          new Set(data.elements.filter((el) => !preferences.sources[el.id]).map((el) => el.id)),
        );
        this.includeDone.set(preferences.includeDone);
        this.group.set(this.params().get('calGroup') || 'all');
      });
    });
    effect(() => {
      this.displayedEventsChange.emit(this.events());
    });
    effect(() => {
      const params = this.params();
      untracked(() => this.group.set(params.get('calGroup') || 'all'));
    });
    // Un lien vers un autre jour (`?jour=`) déplace la période affichée.
    effect(() => {
      const requested = this.params().get('jour');
      if (requested && validDate(requested) && requested !== untracked(this.selectedDay)) {
        untracked(() => {
          this.selectedDay.set(requested);
          this.emitPeriod();
        });
      }
    });
    queueMicrotask(() => this.emitPeriod());
  }

  /** État unique des commandes : le bandeau et la grille lisent les mêmes signaux. */
  readonly toolbarState = computed(() => ({
    day: this.selectedDay(),
    view: this.view(),
    period: this.periodName(),
    previous: this.previousLabel(),
    next: this.nextLabel(),
    groups: this.groups(),
    group: this.group(),
    includeDone: this.includeDone(),
    sourceSummary: {
      visible: this.visibleSourceCount(),
      total: this.elements().length,
      events: this.periodEvents().length,
    },
  }));

  goToday() {
    this.selectDay(this.today);
  }

  /** Retrouve dans la grille et dans l’agenda le repère choisi depuis le bandeau fixe. */
  focusEvent(event: CalendarEvent) {
    if (!this.events().some((item) => item.key === event.key)) return;
    this.selectDay(event.date);
    this.pinnedEventKeys.set(new Set([event.key]));
    setTimeout(() => {
      const entry = Array.from(
        this.host.nativeElement.querySelectorAll<HTMLElement>('.calendar-agenda-item'),
      ).find((item) => item.dataset['eventKey'] === event.key);
      entry?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      entry
        ?.querySelector<HTMLButtonElement>('.calendar-agenda-select')
        ?.focus({ preventScroll: true });
    });
  }

  selectGroup(group: string) {
    if (group === 'all' || this.groups().some((item) => item.key === group)) {
      this.group.set(group);
      this.syncFilters();
    }
  }

  // ---------- lecture ----------
  protected element(event: CalendarEvent): CalendarElement | undefined {
    return this.elementsById().get(event.element);
  }
  protected marker(event: CalendarEvent) {
    return this.element(event)?.marker ?? 'point';
  }
  protected symbol(el: CalendarElement | undefined) {
    return MARKER_SYMBOL[el?.marker ?? 'point'];
  }
  protected markerLabel(el: CalendarElement) {
    return MARKER_LABEL[el.marker];
  }
  protected tone(name: string | undefined) {
    return toneColor(name);
  }
  protected amount(event: CalendarEvent) {
    return event.amountCents === null ? '' : formatAmount(event.amountCents, event.direction);
  }
  protected date(day: string) {
    return DATE_FORMAT.format(new Date(day + 'T12:00:00Z'));
  }
  protected monthName(month: string) {
    return monthTitle(month);
  }
  protected countInPeriod(elementId: string) {
    return this.periodCounts().get(elementId) ?? 0;
  }
  protected statsOf(events: CalendarEvent[]): DayStat[] {
    return dayStats(events, this.elements(), this.indicators());
  }
  protected statRows(events: CalendarEvent[], stat: CalendarIndicatorKey) {
    return detailRows(events, this.elements(), stat);
  }
  protected statLabel(stat: CalendarIndicatorKey) {
    return this.indicators().find((i) => i.key === stat)?.label ?? stat;
  }
  /** Total signé des flux du jour (montants avec un sens), affiché dans la case. */
  protected dayAmount(events: CalendarEvent[]): { text: string; sign: string } | null {
    if (!this.showField('total')) return null;
    const flows = events.filter((e) => e.direction && e.amountCents !== null);
    if (!flows.length) return null;
    const net = flows.reduce(
      (s, e) => s + (e.direction === 'entree' ? 1 : -1) * (e.amountCents ?? 0),
      0,
    );
    return {
      text: formatAmount(net, net < 0 ? 'sortie' : 'entree'),
      sign: net < 0 ? 'negative' : net > 0 ? 'positive' : 'zero',
    };
  }
  protected hasAttention(events: CalendarEvent[]) {
    return (
      events.filter((e) => !e.done && e.urgent === 'overdue').length >= 1 ||
      events.filter((e) => !e.done).length >= 5
    );
  }
  protected hasProgress(events: CalendarEvent[]) {
    const done = events.filter((e) => e.done).length;
    return done > 0 && done >= events.length - done;
  }
  /** Couleur dominante d'une journée (vue annuelle) : celle de l'élément le plus présent. */
  protected dominantTone(events: CalendarEvent[]) {
    const counts = new Map<string, number>();
    for (const e of events) counts.set(e.element, (counts.get(e.element) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    return this.tone(top ? this.elementsById().get(top)?.tone : undefined);
  }
  protected yearDayLabel(day: string, count: number) {
    const highlighted = (this.byDay().get(day) ?? []).filter((e) =>
      this.isHighlighted(e.key),
    ).length;
    return `Voir les repères du ${this.date(day)} · ${count} ${count === 1 ? 'repère' : 'repères'}${highlighted ? ` · ${highlighted} mis en évidence` : ''}`;
  }

  protected controlAllowed(key: keyof NonNullable<CalendarData['interaction']>['controls']) {
    return this.data()?.interaction?.access !== 'hidden' && this.data()?.interaction?.controls[key] !== false;
  }

  // ---------- éléments et filtres ----------
  protected toggleElement(id: string) {
    if (!this.controlAllowed('sources')) return;
    this.hidden.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    this.savePreferences({
      sources: Object.fromEntries(this.elements().map((el) => [el.id, !this.hidden().has(el.id)])),
    });
    this.releasePeek();
  }

  protected showField(field: CalendarFormatField) {
    return this.format().fields.includes(field);
  }
  protected indicatorShown(key: CalendarIndicatorKey) {
    return this.preferences()?.indicators.includes(key) ?? true;
  }
  // ---------- formats d'affichage ----------
  protected fieldLabel(field: CalendarFormatField) {
    return FORMAT_FIELDS.find((f) => f.key === field)?.label ?? field;
  }
  protected chooseFormat(id: string) {
    if (!this.controlAllowed('fields') || !this.formats().some((f) => f.id === id)) return;
    // Le format apporte sa densité : un choix de densité antérieur ne la masque plus.
    this.savePreferences({ format: id, perCell: null });
    this.releasePeek();
  }
  /** Nouveau format, à partir de celui en cours ; ou modification d'un format créé par la personne. */
  protected editFormat(format: CalendarFormat | null = null) {
    if (!this.controlAllowed('fields')) return;
    const base = format ?? this.format();
    this.formatDraft.set({
      id: format?.own ? format.id : null,
      label: format?.own ? format.label : `Mon format`,
      layout: base.layout,
      fields: [...base.fields],
      perCell: base.perCell,
    });
  }
  protected updateDraft(change: Partial<{ label: string; layout: CalendarLayout; perCell: number | null }>) {
    this.formatDraft.update((d) => (d ? { ...d, ...change } : d));
  }
  protected toggleDraftField(field: CalendarFormatField) {
    this.formatDraft.update((d) => d && { ...d, fields: d.fields.includes(field) ? d.fields.filter((f) => f !== field) : [...d.fields, field] });
  }
  /** Change l'ordre d'un champ dans le format (−1 : plus tôt, +1 : plus tard). */
  protected moveDraftField(field: CalendarFormatField, step: number) {
    this.formatDraft.update((d) => {
      if (!d) return d;
      const fields = [...d.fields];
      const at = fields.indexOf(field);
      const to = at + step;
      if (at < 0 || to < 0 || to >= fields.length) return d;
      [fields[at], fields[to]] = [fields[to], fields[at]];
      return { ...d, fields };
    });
  }
  protected saveFormat() {
    const draft = this.formatDraft();
    const label = draft?.label.trim();
    if (!draft || !label) return;
    const own = this.ownFormats();
    const id = draft.id ?? newFormatId(label, this.formats());
    const format: CalendarFormat = { id, label, layout: draft.layout, fields: draft.fields, perCell: draft.perCell, builtIn: false, own: true };
    const next = draft.id ? own.map((f) => (f.id === id ? format : f)) : [...own, format];
    this.ownFormats.set(next);
    this.formatsChange.emit(next);
    this.formatDraft.set(null);
    this.chooseFormat(id);
  }
  protected deleteFormat(id: string) {
    const next = this.ownFormats().filter((f) => f.id !== id);
    this.ownFormats.set(next);
    this.formatsChange.emit(next);
    if (this.preferences()?.format === id) this.savePreferences({ format: this.data()?.display.format ?? 'standard' });
  }

  // ---------- branchement des sources ----------
  protected plugSource(id: string) {
    if (!this.controlAllowed('sources')) return;
    this.sourcesChange.emit([...this.elements().map((el) => el.id), id]);
  }
  protected unplugSource(id: string) {
    if (!this.controlAllowed('sources')) return;
    this.sourcesChange.emit(this.elements().map((el) => el.id).filter((x) => x !== id));
  }

  protected toggleIndicator(key: CalendarIndicatorKey) {
    if (!this.controlAllowed('indicators')) return;
    const current = this.preferences();
    if (!current) return;
    const keys = current.indicators.includes(key)
      ? current.indicators.filter((value) => value !== key)
      : [...current.indicators, key];
    this.savePreferences({ indicators: keys });
    this.releasePeek();
  }
  protected setDensity(perCell: number) {
    if (!this.controlAllowed('density')) return;
    if (Number.isInteger(perCell) && perCell >= 0 && perCell <= 8)
      this.savePreferences({ perCell });
  }
  setIncludeDone(includeDone: boolean) {
    if (!this.controlAllowed('completed')) return;
    this.includeDone.set(includeDone);
    this.savePreferences({ includeDone });
  }
  protected showAllSources() {
    if (!this.controlAllowed('sources')) return;
    this.hidden.set(new Set());
    this.savePreferences({
      sources: Object.fromEntries(this.elements().map((el) => [el.id, true])),
    });
  }
  protected resetDisplay() {
    const data = this.data();
    if (!data) return;
    const defaults = displayDefaults(data);
    this.hidden.set(new Set(data.elements.filter((el) => !el.visible).map((el) => el.id)));
    this.includeDone.set(defaults.includeDone);
    this.group.set('all');
    this.preferences.set(defaults);
    this.preferencesChange.emit(null);
    if (data.plugged) this.sourcesChange.emit(null);
    this.formatDraft.set(null);
    this.releasePeek();
  }
  private savePreferences(change: Partial<CalendarDisplayPreferences>) {
    const current = this.preferences();
    const data = this.data();
    if (!current || !data) return;
    const next = { ...current, ...change };
    this.preferences.set(next);
    this.preferencesChange.emit({ ...next });
  }

  // ---------- mise en évidence ----------
  protected isPinned(key: string) {
    return this.pinnedEventKeys().has(key);
  }
  protected isHighlighted(key: string) {
    return this.highlightedKeys().has(key);
  }
  protected isDayHighlighted(day: string) {
    return (this.byDay().get(day) ?? []).some((e) => this.isHighlighted(e.key));
  }
  protected isDayPinned(day: string, year: boolean) {
    return (year ? this.pinnedYearDay() : this.pinnedMonthDay()) === day;
  }
  protected toggleHighlight(key: string) {
    this.pinnedEventKeys.update((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    this.hoveredEventKey.set(null);
  }
  protected clearHighlights() {
    this.pinnedEventKeys.set(new Set());
    this.hoveredEventKey.set(null);
  }
  protected togglePeekHighlight(event: CalendarEvent, click: MouseEvent, year: boolean) {
    const wasPinned = this.isPinned(event.key);
    this.toggleHighlight(event.key);
    if (year) {
      this.pinnedYearDay.set(wasPinned && this.pinnedYearDay() === event.date ? null : event.date);
      return;
    }
    const target = click.currentTarget;
    const day = target instanceof Element ? target.closest<HTMLElement>('.calendar-day') : null;
    if (!wasPinned && day) this.monthPeek.setGridDayPin(event.date, day);
    else if (wasPinned && this.pinnedMonthDay() === event.date) {
      this.pinnedMonthDay.set(null);
      this.expandedDay.set(null);
    }
  }
  /** Suit le repère survolé dans l'agenda : il est souligné, sans déplacer la liste en cours de lecture. */
  protected hoverCalendarEvent(key: string) {
    this.hoveredEventKey.set(key);
  }

  // ---------- détail d'un indicateur ----------
  protected openPeekDetails(event: Event, day: string, stat: CalendarIndicatorKey) {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const peek = target.closest('.calendar-day-peek');
    if (!(peek instanceof HTMLElement)) return;
    const rect = peek.getBoundingClientRect();
    const margin = 12;
    const gap = 10;
    // La fenêtre suit l'échelle du texte : sa largeur réelle sert au placement, pour ne pas mordre sur l'aperçu.
    const scale = Number.parseFloat(getComputedStyle(peek).getPropertyValue('--text-scale')) || 1;
    const width = Math.min(340 * scale, window.innerWidth - 2 * margin);
    const left =
      rect.right + gap + width + margin <= window.innerWidth
        ? rect.right + gap
        : Math.max(margin, rect.left - gap - width);
    const top = Math.max(margin, Math.min(rect.top, window.innerHeight - 220));
    this.peekDetailsPosition.set({ left, top, maxHeight: window.innerHeight - top - margin });
    this.activePeekDay.set(day);
    this.activePeekStat.set(stat);
  }
  protected closePeekDetails() {
    this.activePeekDay.set(null);
    this.activePeekStat.set(null);
  }

  // ---------- aperçus : mois et semaine ----------
  protected toggleExpansion(day: string, year: boolean) {
    if (year) {
      this.cancelYearPeekClose();
      this.expandedYearPeekDay.update((current) => (current === day ? null : day));
    } else this.expandedDay.update((current) => (current === day ? null : day));
  }

  // ---------- aperçus : année ----------


  @HostListener('window:scroll')
  @HostListener('window:resize')
  protected repositionVisiblePeek() {
    this.closePeekDetails();
    const day = this.visibleMonthDay();
    if (day) {
      const target = this.host.nativeElement.querySelector<HTMLElement>(
        `.calendar-grid .calendar-day[data-day="${day}"]`,
      );
      if (target) this.monthPeek.positionMonthPeek(target, this.monthPeek.monthPeekSide);
    }
    const yearDay = this.visibleYearDay();
    if (yearDay) {
      const target = this.host.nativeElement.querySelector<HTMLElement>(
        `.calendar-year-day[data-day="${yearDay}"]`,
      );
      if (target) this.yearPeek.setYearPeekPosition(target);
    }
  }
  @HostListener('window:pointermove', ['$event'])
  protected trackPointer(event: PointerEvent) {
    this.pointer.at = { x: event.clientX, y: event.clientY };
  }
  protected releasePeek() {
    this.pinnedMonthDay.set(null);
    this.pinnedYearDay.set(null);
    this.expandedDay.set(null);
    this.expandedYearPeekDay.set(null);
    this.hoveredMonthDay.set(null);
    this.hoveredYearDay.set(null);
    this.focusedMonthDay.set(null);
    this.focusedYearDay.set(null);
    this.closePeekDetails();
  }

  // ---------- navigation ----------
  /**
   * Un jour sans repère est une case inactive. Elle ne se choisit pas au clic et sort
   * de l'ordre de tabulation ; les flèches la traversent encore et elle reçoit toujours un repère déposé.
   */
  protected idleDay(events: number) {
    return events === 0;
  }
  protected focusCalendarGrid() {
    const day = this.selectedDay();
    const year = this.view() === 'year';
    const exact = year
      ? `.calendar-year-day[data-day="${day}"]`
      : `.calendar-day[data-day="${day}"] .calendar-day-number`;
    const fallback = year ? '.calendar-year-day.has-events' : '.calendar-day-number';
    const target =
      this.host.nativeElement.querySelector<HTMLElement>(exact) ??
      this.host.nativeElement.querySelector<HTMLElement>(fallback);
    (target ?? this.host.nativeElement.querySelector<HTMLElement>('.calendar-month-wrap'))?.focus();
  }
  protected onDayKeydown(event: KeyboardEvent, day: string) {
    if (event.key === 'Escape') {
      this.releasePeek();
      event.preventDefault();
      return;
    }
    const step = (
      { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>
    )[event.key];
    if (!step) return;
    event.preventDefault();
    let next: string | undefined;
    if (this.view() === 'year') {
      const dates = [...this.byDay().keys()].sort();
      const threshold = shiftDate(day, step);
      next =
        step > 0 ? dates.find((d) => d >= threshold) : dates.reverse().find((d) => d <= threshold);
    } else next = shiftDate(day, step);
    if (!next || !validDate(next)) return;
    this.selectDay(next);
    requestAnimationFrame(() => {
      const selector =
        this.view() === 'year'
          ? `.calendar-year-day[data-day="${next}"]`
          : `.calendar-day[data-day="${next}"] .calendar-day-number`;
      this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
    });
  }
  selectDay(day: string) {
    if (!validDate(day)) return;
    const now = gridWindow(this.selectedDay(), this.view());
    const next = gridWindow(day, this.view());
    if ((now.start !== next.start || now.end !== next.end) && this.periodFadeMs()) {
      this.fadePeriod(() => this.applyDay(day));
      return;
    }
    this.applyDay(day);
  }
  private applyDay(day: string) {
    const before = gridWindow(this.selectedDay(), this.view());
    if (this.view() === 'month' && day.slice(0, 7) !== this.month()) this.pinnedMonthDay.set(null);
    if (this.view() === 'year' && day.slice(0, 4) !== this.selectedDay().slice(0, 4))
      this.pinnedYearDay.set(null);
    this.hoveredEventKey.set(null);
    this.selectedDay.set(day);
    const after = gridWindow(day, this.view());
    if (after.start !== before.start || after.end !== before.end) this.emitPeriod();
    this.syncUrl();
  }
  movePeriod(step: number) {
    this.selectDay(shiftPeriod(this.selectedDay(), this.view(), step));
  }
  protected chooseMonth(month: string) {
    if (validDate(month + '-01')) {
      this.setView('month');
      this.selectDay(month + '-01');
    }
  }
  protected openMonthPicker(input: HTMLInputElement) {
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  }
  setView(view: CalendarView, { chosen = true } = {}) {
    if (chosen && view !== this.view() && this.periodFadeMs()) {
      this.fadePeriod(() => this.applyView(view, chosen));
      return;
    }
    this.applyView(view, chosen);
  }
  private applyView(view: CalendarView, chosen: boolean) {
    if (chosen) this.viewChosen = true;
    this.releasePeek();
    this.cancelYearPeekClose();
    this.cancelMonthPeekClose();
    this.monthPeek.resetGesture();
    this.yearPeek.resetGesture();
    this.view.set(view);
    this.emitPeriod();
    if (chosen) this.syncUrl();
  }
  private emitPeriod() {
    const day = this.selectedDay();
    const view = this.view();
    const { start, end } = gridWindow(day, view);
    this.periodChange.emit({ day, view, from: start, to: end });
  }
  private syncFilters() {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { calGroup: this.group() === 'all' ? null : this.group() },
      queryParamsHandling: 'merge', replaceUrl: true,
    });
  }
  private syncUrl() {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { jour: this.selectedDay(), vue: VIEW_PARAM[this.view()] },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ---------- replanification ----------
  protected plan(event: CalendarEvent) {
    this.planning.set(event);
    this.plannedDate = event.date;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { calPlan: event.key, calDate: event.date }, queryParamsHandling: 'merge' });
    afterNextRender(() => {
      const field = this.host.nativeElement.querySelector<HTMLInputElement>('.calendar-plan input');
      field?.closest('form')?.scrollIntoView?.({ block: 'center' });
      field?.focus({ preventScroll: true });
    }, { injector: this.injector });
  }
  protected changePlanDate(date: string) {
    this.plannedDate = date;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { calDate: date }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  /** La saisie quitte le parcours après la réussite, ou sur annulation explicite. */
  finishPlan() {
    this.planning.set(null);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { calPlan: null, calDate: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  protected savePlan() {
    const event = this.planning();
    if (this.busy() || !event || !validDate(this.plannedDate) || this.plannedDate === event.date) return;
    this.reschedule.emit({ event, date: this.plannedDate });
  }
  protected drag(event: DragEvent, entry: CalendarEvent) {
    if (!entry.reschedule || this.busy()) {
      event.preventDefault();
      return;
    }
    this.dragged = entry;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', entry.key);
    }
  }
  protected allowDrop(event: DragEvent) {
    if (this.dragged && !this.busy()) event.preventDefault();
  }
  protected drop(event: DragEvent, day: string) {
    event.preventDefault();
    const entry = this.dragged;
    this.dragged = null;
    if (entry && !this.busy() && entry.date !== day)
      this.reschedule.emit({ event: entry, date: day });
  }

  /** Libellé complet d'un jour, pour les lecteurs d'écran. */
  protected fullDate(day: string) {
    return FULL_DATE.format(new Date(day + 'T12:00:00Z'));
  }
}
