import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { Router } from '@angular/router';
import { RecetteContext, toApiError } from '../core/api.service';
import { DataChanges } from '../core/data-changes';
import { CalendarComponent } from './calendar.component';
import { CalendarData, CalendarDisplayChoice, CalendarEvent, CalendarFormat, CalendarPeriod } from './calendar.models';
import { CalendarService } from './calendar.service';
import { formatAmount } from './calendar-model';
import { CalendarView, validDate } from './calendar-dates';

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * Le calendrier comme service, prêt à poser dans n'importe quelle page : il charge un calendrier nommé
 * (`calendar="noyau"`, paramètre `calendrier.noyau`) ou une configuration fournie (`[configuration]`), pour
 * la fenêtre affichée et le user actif. La page hôte décide des sources proposées (`offer` : calendriers dont
 * les sources peuvent être branchées) ; la personne choisit les siennes et son affichage dans le volet
 * « Sources et affichage » du module, enregistrés sur le serveur pour son profil. Il ouvre un repère par son
 * lien (ou le confie à la page avec `openInPlace`), replanifie par la commande que la configuration désigne,
 * et se relit de lui-même après toute écriture (de cet onglet ou annoncée par le serveur) ou au retour sur l'onglet.
 */
@Component({
  selector: 'rjs-calendar-space',
  imports: [CalendarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Habillage de la page du calendrier, chargé avec le calendrier plutôt que dans la feuille globale : sans
  // encapsulation, ses sélecteurs restent ceux de la feuille globale (voir calendar-site.scss).
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['./calendar-site.scss', './calendar-site-controls.scss', './calendar-site-module.scss'],
  template: `
    <rjs-calendar
      [data]="data()"
      [compact]="compact()"
      [externalTools]="externalTools()"
      [showSourceSummary]="showSourceSummary()"
      [presentation]="presentation()"
      [loading]="loading()"
      [busy]="busy()"
      [error]="error()"
      [feedback]="feedback()"
      (periodChange)="load($event)"
      (open)="openEvent($event)"
      (reschedule)="move($event.event, $event.date)"
      (displayedEventsChange)="displayedEventsChange.emit($event)"
      (sourcesChange)="plug($event)"
      (preferencesChange)="keepPreferences($event)"
      (formatsChange)="keepFormats($event)"
    >
      <ng-content />
    </rjs-calendar>
  `,
})
export class CalendarSpaceComponent {
  /** Identifiant d'un calendrier paramétré (`calendrier.<id>`). */
  readonly calendar = input<string | null>(null);
  /** Configuration fournie à l'appel (même vocabulaire que le paramètre), à la place d'un calendrier nommé. */
  readonly configuration = input<unknown>(null);
  /** La page ouvre elle-même les repères (sinon : navigation vers leur lien). */
  readonly openInPlace = input(false);
  readonly externalTools = input(false);
  readonly showSourceSummary = input(true);
  readonly presentation = input<'calendar' | 'agenda' | 'sources'>('calendar');
  /** Calendriers dont la page hôte propose les sources au branchement (aucun par défaut). */
  readonly offer = input<readonly string[]>([]);
  /** Présentation resserrée demandée par la page hôte. */
  readonly compact = input(false);
  private readonly calendarView = viewChild(CalendarComponent);
  readonly toolbarState = computed(() => {
    const state = this.calendarView()?.toolbarState();
    return state
      ? {
          ...state,
          loading: this.loading(),
          busy: this.busy(),
          error: this.error(),
          feedback: this.feedback(),
        }
      : undefined;
  });
  readonly loaded = output<{ data: CalendarData; period: CalendarPeriod }>();
  readonly opened = output<CalendarEvent>();
  readonly displayedEventsChange = output<CalendarEvent[]>();

  private readonly service = inject(CalendarService);
  private readonly router = inject(Router);
  private readonly context = inject(RecetteContext);
  private readonly changes = inject(DataChanges);
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDisplay: { display: CalendarDisplayChoice | null } | null = null;
  protected readonly data = signal<CalendarData | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly feedback = signal('');
  private readonly periodShown = signal<CalendarPeriod | null>(null);
  private request = 0;

  constructor() {
    // Lecture dès que la période affichée et le calendrier (ou sa configuration) sont connus, puis à chaque
    // changement : période, profil, sources proposées, ou écriture faite ici ou ailleurs.
    effect(() => {
      const period = this.periodShown();
      this.context.userId();
      this.offer();
      this.changes.version();
      const ready = this.calendar() !== null || this.configuration() !== null;
      if (period && ready) untracked(() => void this.fetch(period));
    });
    // Revenir sur l'onglet relit la période : une autre fenêtre a pu changer les données.
    if (typeof document !== 'undefined') {
      const visible = () => { if (document.visibilityState === 'visible' && this.period) void this.fetch(this.period); };
      document.addEventListener('visibilitychange', visible);
      inject(DestroyRef).onDestroy(() => {
        document.removeEventListener('visibilitychange', visible);
        void this.flushPreferences();
      });
    }
  }

  private get period() {
    return this.periodShown();
  }

  movePeriod(step: number) {
    this.calendarView()?.movePeriod(step);
  }
  goToday() {
    this.calendarView()?.goToday();
  }
  selectDay(day: string) {
    if (validDate(day)) this.calendarView()?.selectDay(day);
  }
  selectView(view: string) {
    if (view === 'month' || view === 'week' || view === 'year')
      this.calendarView()?.setView(view as CalendarView);
  }
  selectGroup(group: string) {
    this.calendarView()?.selectGroup(group);
  }
  setIncludeDone(value: boolean) {
    this.calendarView()?.setIncludeDone(value);
  }
  /** Volet « Sources et affichage » du module : la page hôte peut l'ouvrir depuis son propre bouton. */
  readonly settingsOpen = computed(() => this.calendarView()?.settingsOpen() ?? false);
  readonly settingsAvailable = computed(() => this.calendarView()?.settingsAvailable() ?? false);
  toggleSettings(open?: boolean) {
    this.calendarView()?.toggleSettings(open);
  }
  focusEvent(event: CalendarEvent) {
    this.calendarView()?.focusEvent(event);
  }

  /** La personne branche ou débranche des sources (nul : revenir à celles de la configuration) : enregistré, puis relu. */
  protected async plug(ids: readonly string[] | null) {
    const id = this.calendar();
    if (!id) return;
    await this.persist(() => this.service.savePreferences(id, { plugged: ids }));
    if (this.period) await this.fetch(this.period);
  }

  /** Préférences d'affichage : déjà à l'écran, enregistrées un instant plus tard (plusieurs choix d'affilée, une écriture). */
  protected keepPreferences(display: CalendarDisplayChoice | null) {
    if (!this.calendar()) return;
    this.pendingDisplay = { display };
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flushPreferences(), 300);
  }
  private async flushPreferences() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const pending = this.pendingDisplay;
    const id = this.calendar();
    this.pendingDisplay = null;
    if (pending && id) await this.persist(() => this.service.savePreferences(id, pending));
  }

  /** Formats créés par la personne : enregistrés pour son profil, valables dans tous ses calendriers. */
  protected keepFormats(formats: CalendarFormat[]) {
    void this.persist(() => this.service.saveFormats(formats));
  }

  private async persist(write: () => Promise<unknown>) {
    try {
      await write();
    } catch (err) {
      this.error.set(`Vos préférences n’ont pas pu être enregistrées : ${toApiError(err).message}`);
    }
  }

  /** Période affichée par le calendrier : sa fenêtre sera lue. */
  load(period: CalendarPeriod) {
    this.periodShown.set(period);
  }

  /** Lit la fenêtre de la période affichée ; une réponse devenue ancienne est ignorée. */
  private async fetch(period: CalendarPeriod) {
    const ticket = ++this.request;
    // Un autre calendrier ne montre pas, même un instant, les repères du précédent.
    if (this.data() && this.data()!.calendar.id !== this.calendar()) this.data.set(null);
    this.loading.set(true);
    this.error.set(null);
    try {
      const id = this.calendar();
      const data = id
        ? await this.service.read(id, period.from, period.to, this.offer())
        : await this.service.preview(this.configuration(), period.from, period.to);
      if (ticket !== this.request) return;
      this.data.set(data);
      this.loaded.emit({ data, period });
    } catch (err) {
      if (ticket === this.request) this.error.set(toApiError(err).message);
    } finally {
      if (ticket === this.request) this.loading.set(false);
    }
  }

  protected openEvent(event: CalendarEvent) {
    if (this.openInPlace()) this.opened.emit(event);
    else if (event.link) void this.router.navigateByUrl(event.link);
  }

  /** Replanifie par la commande du module propriétaire (version lue), puis relit la période. */
  protected async move(event: CalendarEvent, date: string) {
    if (this.busy()) return;
    this.busy.set(true);
    this.feedback.set('');
    this.error.set(null);
    try {
      await this.service.reschedule(event, date);
      const amount =
        event.amountCents === null ? '' : ` (${formatAmount(event.amountCents, event.direction)})`;
      this.feedback.set(
        `« ${event.title} »${amount} est maintenant daté du ${DATE_FORMAT.format(new Date(date + 'T12:00:00Z'))}.`,
      );
      if (this.period) await this.fetch(this.period);
      this.calendarView()?.finishPlan();
    } catch (err) {
      const e = toApiError(err);
      // La période est relue d'abord : le refus reste affiché ensuite (la relecture efface les messages).
      if (this.period) await this.fetch(this.period);
      this.error.set(
        e.isConflict
          ? 'Ce repère a changé entre-temps : la période a été relue, recommencez si besoin.'
          : e.message,
      );
    } finally {
      this.busy.set(false);
    }
  }
}
