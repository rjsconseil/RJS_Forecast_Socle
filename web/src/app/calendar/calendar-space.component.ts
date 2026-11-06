import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { RecetteContext, toApiError } from '../core/api.service';
import { CalendarComponent } from './calendar.component';
import { CalendarData, CalendarEvent, CalendarPeriod } from './calendar.models';
import { CalendarService } from './calendar.service';
import { formatAmount } from './calendar-model';

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * Le calendrier comme service, prêt à poser dans n'importe quelle page : il charge un calendrier nommé
 * (`calendar="noyau"`, paramètre `calendrier.noyau`) ou une configuration fournie (`[configuration]`), pour
 * la fenêtre affichée et le user actif. Il ouvre un repère par son lien (ou le confie à la page avec
 * `openInPlace`) et replanifie par la commande que la configuration désigne, puis relit la période.
 */
@Component({
  selector: 'rjs-calendar-space',
  imports: [CalendarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <rjs-calendar
      [data]="data()"
      [bpm]="calendar() === 'budgetPatrimoine'"
      [loading]="loading()"
      [busy]="busy()"
      [error]="error()"
      [feedback]="feedback()"
      (periodChange)="load($event)"
      (open)="openEvent($event)"
      (reschedule)="move($event.event, $event.date)"
      (displayedEventsChange)="displayedEventsChange.emit($event)"
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
  readonly loaded = output<{ data: CalendarData; period: CalendarPeriod }>();
  readonly opened = output<CalendarEvent>();
  readonly displayedEventsChange = output<CalendarEvent[]>();

  private readonly service = inject(CalendarService);
  private readonly router = inject(Router);
  private readonly context = inject(RecetteContext);
  protected readonly data = signal<CalendarData | null>(null);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly feedback = signal('');
  private readonly periodShown = signal<CalendarPeriod | null>(null);
  private request = 0;

  constructor() {
    // Lecture dès que la période affichée et le calendrier (ou sa configuration) sont connus, puis à chaque changement.
    effect(() => {
      const period = this.periodShown();
      if (this.calendar() === 'budgetPatrimoine') this.context.userId();
      const ready = this.calendar() !== null || this.configuration() !== null;
      if (period && ready) untracked(() => void this.fetch(period));
    });
  }

  private get period() {
    return this.periodShown();
  }

  /** Période affichée par le calendrier : sa fenêtre sera lue. */
  load(period: CalendarPeriod) {
    this.periodShown.set(period);
  }

  /** Lit la fenêtre de la période affichée ; une réponse devenue ancienne est ignorée. */
  private async fetch(period: CalendarPeriod) {
    const ticket = ++this.request;
    if (this.calendar() === 'budgetPatrimoine') this.data.set(null);
    this.loading.set(true);
    this.error.set(null);
    try {
      const id = this.calendar();
      const data = id
        ? await this.service.read(id, period.from, period.to)
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
