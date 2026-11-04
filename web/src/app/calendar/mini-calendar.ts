import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../shared/modal.component';
import {
  CalendarRange,
  CalendarView,
  localToday,
  monthDays,
  monthTitle,
  periodLabel,
  shiftPeriod,
  validDate,
  weekDays,
  yearMonths,
} from './calendar-dates';
import { BoardKind, displayDate } from '../projects/workspace-parts';

const SECTION: Record<BoardKind, { name: string; plural: string }> = {
  project: { name: 'Projets', plural: 'projets' },
  task: { name: 'Tâches', plural: 'tâches' },
};

/**
 * Calendrier miniature de la référence (`mini-calendar.component.ts`) : vues année / mois / semaine,
 * retour au jour courant, et choix d'un créneau de lecture depuis un jour. Le créneau n'est qu'un
 * paramètre de consultation : le composant l'émet, la page le garde dans son URL ; aucune date source
 * n'est réécrite. Mêmes classes que la référence (`_workspace.scss`, `_calendar.scss`).
 */
@Component({
  selector: 'rjs-mini-calendar',
  imports: [FormsModule, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-year]': "view() === 'year'" },
  template: `
    <section class="mini-calendar" [attr.aria-label]="'Calendrier · ' + section().name">
      <div class="mini-calendar-frame">
        <div class="calendar-view-switch" role="group" aria-label="Vue du calendrier">
          <button type="button" [attr.aria-pressed]="view() === 'year'" aria-label="Vue annuelle" title="Année" (click)="view.set('year')">
            A
          </button>
          <button type="button" [attr.aria-pressed]="view() === 'month'" aria-label="Vue mensuelle" title="Mois" (click)="view.set('month')">
            M
          </button>
          <button type="button" [attr.aria-pressed]="view() === 'week'" aria-label="Vue hebdomadaire" title="Semaine" (click)="view.set('week')">
            S
          </button>
        </div>
        <div class="mini-calendar-content">
          <div class="mini-calendar-heading">
            <h2 aria-live="polite">{{ periodName() }}</h2>
            <div class="mini-calendar-controls">
              <button type="button" [attr.aria-label]="previousLabel()" (click)="move(-1)">‹</button>
              <button type="button" [attr.aria-label]="nextLabel()" (click)="move(1)">›</button>
            </div>
          </div>
          @if (view() === 'year') {
            <div class="calendar-year-grid mini-calendar-year-grid">
              @for (yearMonth of months(); track yearMonth.key) {
                <section class="calendar-year-month" [attr.aria-label]="monthName(yearMonth.key)">
                  <h3>{{ monthName(yearMonth.key) }}</h3>
                  <div class="calendar-year-weekdays" aria-hidden="true">
                    @for (label of weekdays; track $index) {
                      <span>{{ label }}</span>
                    }
                  </div>
                  <div class="calendar-year-days">
                    @for (day of yearMonth.days; track day) {
                      @if (day.startsWith(yearMonth.key)) {
                        <button
                          type="button"
                          [class.is-today]="day === currentDay"
                          [attr.aria-current]="day === currentDay ? 'date' : null"
                          [attr.aria-label]="dayLabel(day)"
                          (click)="openRangeEditor(day)"
                        >
                          {{ +day.slice(-2) }}
                        </button>
                      } @else {
                        <span aria-hidden="true"></span>
                      }
                    }
                  </div>
                </section>
              }
            </div>
          } @else {
            <div class="mini-calendar-weekdays" aria-hidden="true">
              @for (label of weekdays; track $index) {
                <span>{{ label }}</span>
              }
            </div>
            <div class="mini-calendar-days">
              @for (day of days(); track day) {
                <button
                  type="button"
                  [class.outside-month]="view() === 'month' && !day.startsWith(month())"
                  [class.is-today]="day === currentDay"
                  [attr.aria-current]="day === currentDay ? 'date' : null"
                  [attr.aria-label]="dayLabel(day)"
                  (click)="openRangeEditor(day)"
                >
                  {{ +day.slice(-2) }}
                </button>
              }
            </div>
          }
          <div class="mini-calendar-footer">
            <button type="button" (click)="reset()">Aujourd’hui</button>
            @if (selectedRange(); as range) {
              <span class="mini-calendar-range" role="status">Créneau : {{ date(range.start) }} – {{ date(range.end) }}</span>
              <button type="button" (click)="rangeChange.emit(null)">Effacer le créneau</button>
            }
          </div>
        </div>
      </div>
    </section>
    <rjs-modal [open]="rangeEditorOpen()" title="Définir le créneau" (closed)="closeRangeEditor()">
      <form class="editor-form calendar-range-editor" (ngSubmit)="saveRange()">
        <div class="modal-head">
          <div>
            <p class="eyebrow">Filtrer les {{ section().plural }}</p>
            <h2>Définir le créneau</h2>
          </div>
          <button class="modal-close" type="button" aria-label="Fermer" (click)="closeRangeEditor()">×</button>
        </div>
        <p>Seuls les éléments dont la date de démarrage est comprise dans ce créneau seront affichés.</p>
        <label class="field">
          Début
          <input type="date" name="rangeStart" required [(ngModel)]="rangeStart" />
        </label>
        <label class="field">
          Fin
          <input type="date" name="rangeEnd" required [(ngModel)]="rangeEnd" />
        </label>
        @if (rangeError()) {
          <p class="import-issues" role="alert">{{ rangeError() }}</p>
        }
        <div class="form-actions">
          <button class="btn btn-secondary" type="button" (click)="closeRangeEditor()">Annuler</button>
          <button class="btn btn-primary" type="submit" [disabled]="!valid(rangeStart) || !valid(rangeEnd)">
            Appliquer le créneau
          </button>
        </div>
      </form>
    </rjs-modal>
  `,
})
export class MiniCalendarComponent {
  readonly kind = input.required<BoardKind>();
  readonly selectedRange = input<CalendarRange | null>(null);
  readonly rangeChange = output<CalendarRange | null>();
  protected readonly section = computed(() => SECTION[this.kind()]);
  protected readonly currentDay = localToday();
  protected readonly anchor = signal(this.currentDay);
  protected readonly view = signal<CalendarView>('month');
  protected readonly month = computed(() => this.anchor().slice(0, 7));
  protected readonly periodName = computed(() => periodLabel(this.anchor(), this.view()));
  protected readonly previousLabel = computed(() =>
    this.view() === 'month' ? 'Mois précédent' : this.view() === 'year' ? 'Année précédente' : 'Semaine précédente',
  );
  protected readonly nextLabel = computed(() =>
    this.view() === 'month' ? 'Mois suivant' : this.view() === 'year' ? 'Année suivante' : 'Semaine suivante',
  );
  protected readonly days = computed(() => (this.view() === 'week' ? weekDays(this.anchor()) : monthDays(this.month())));
  protected readonly months = computed(() => yearMonths(this.anchor()));
  protected readonly weekdays = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  protected readonly rangeEditorOpen = signal(false);
  protected readonly rangeError = signal('');
  protected readonly date = displayDate;
  protected readonly valid = validDate;
  protected rangeStart = this.currentDay;
  protected rangeEnd = this.currentDay;
  private readonly formatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'UTC' });

  protected dayLabel(day: string): string {
    return this.formatter.format(new Date(day + 'T12:00:00Z'));
  }
  protected monthName(month: string): string {
    return monthTitle(month);
  }
  protected move(step: number): void {
    this.anchor.update((day) => shiftPeriod(day, this.view(), step));
  }
  protected reset(): void {
    this.anchor.set(this.currentDay);
  }
  /** Un jour choisi propose un créneau de ce seul jour, que l'utilisateur étend avant de l'appliquer. */
  protected openRangeEditor(day: string): void {
    if (!validDate(day)) return;
    this.rangeStart = day;
    this.rangeEnd = day;
    this.rangeError.set('');
    this.rangeEditorOpen.set(true);
  }
  protected closeRangeEditor(): void {
    this.rangeEditorOpen.set(false);
    this.rangeError.set('');
  }
  protected saveRange(): void {
    if (!validDate(this.rangeStart) || !validDate(this.rangeEnd)) return;
    if (this.rangeEnd < this.rangeStart) {
      this.rangeError.set('La date de fin doit être égale ou postérieure à la date de début.');
      return;
    }
    this.rangeChange.emit({ start: this.rangeStart, end: this.rangeEnd });
    this.closeRangeEditor();
  }
}
