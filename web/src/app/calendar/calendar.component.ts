import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  CalendarView,
  DayPeekPosition,
  gridWindow,
  inPeriod,
  localToday,
  monthDays,
  monthTitle,
  periodLabel,
  positionDayPeek,
  shiftDate,
  shiftPeriod,
  validDate,
  weekDays,
  yearMonths,
} from './calendar-dates';
import {
  CalendarData,
  CalendarElement,
  CalendarEvent,
  CalendarIndicatorKey,
  CalendarPeriod,
} from './calendar.models';
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
  BPM_DAY_FIELDS,
  BpmCalendarPreferences,
  BpmDayField,
  displayDefaults,
  readDisplayPreferences,
  writeDisplayPreferences,
} from './bpm-calendar-preferences';

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
  imports: [FormsModule, NgTemplateOutlet],
  styleUrl: './bpm-calendar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="calendar is-360 calendar-module"
      [class.is-bpm-calendar]="bpm()"
      [attr.aria-label]="data()?.calendar?.label ?? 'Calendrier'"
      [attr.aria-busy]="loading() || busy()"
    >
      <div
        class="calendar-layout is-compact"
        [class.is-year]="view() === 'year'"
        [class.is-week]="view() === 'week'"
      >
        <div class="calendar-right-rail">
          <div class="calendar-control-row">
            <div class="calendar-options">
              <select
                class="calendar-date-filter"
                aria-label="Regroupement affiché"
                [ngModel]="group()"
                (ngModelChange)="group.set($event)"
              >
                <option value="all">Tous les regroupements</option>
                @for (g of groups(); track g.key) {
                  <option [value]="g.key">{{ g.label }}</option>
                }
              </select>
              <label class="calendar-completed-control">
                <input
                  type="checkbox"
                  aria-label="Afficher les éléments terminés"
                  [ngModel]="includeDone()"
                  (ngModelChange)="setIncludeDone($event)"
                />
                <span>Terminés inclus</span>
                <span class="calendar-help">
                  <button
                    type="button"
                    class="calendar-help-trigger"
                    aria-label="Aide : afficher les éléments terminés"
                    aria-describedby="calendar-completed-help"
                  >
                    i
                  </button>
                  <span id="calendar-completed-help" class="calendar-help-tooltip" role="tooltip"
                    >Afficher les éléments terminés ou réglés ; ils restent atténués.</span
                  >
                </span>
              </label>
            </div>
            <div class="calendar-toolbar">
              <div class="calendar-period-control">
                <div class="calendar-view-switch" role="group" aria-label="Vue du calendrier">
                  <button
                    type="button"
                    [attr.aria-pressed]="view() === 'year'"
                    aria-label="Vue annuelle"
                    title="Année"
                    (click)="setView('year')"
                  >
                    Année
                  </button>
                  <button
                    type="button"
                    [attr.aria-pressed]="view() === 'month'"
                    aria-label="Vue mensuelle"
                    title="Mois"
                    (click)="setView('month')"
                  >
                    Mois
                  </button>
                  <button
                    type="button"
                    [attr.aria-pressed]="view() === 'week'"
                    aria-label="Vue hebdomadaire"
                    title="Semaine"
                    (click)="setView('week')"
                  >
                    Semaine
                  </button>
                </div>
                <div
                  class="calendar-paging"
                  [attr.aria-label]="'Changer la période : ' + periodName()"
                >
                  <button
                    class="btn btn-secondary"
                    type="button"
                    [attr.aria-label]="previousLabel()"
                    (click)="movePeriod(-1)"
                  >
                    ←
                  </button>
                  <h2 aria-live="polite" class="visually-hidden" [title]="periodName()">
                    {{ periodName() }}
                  </h2>
                  <button
                    class="btn btn-secondary"
                    type="button"
                    [attr.aria-label]="nextLabel()"
                    (click)="movePeriod(1)"
                  >
                    →
                  </button>
                </div>
                <div class="calendar-actions">
                  <button class="btn btn-secondary" type="button" (click)="selectDay(today)">
                    Aujourd’hui
                  </button>
                  <span class="calendar-month-picker">
                    <button
                      class="btn btn-secondary calendar-month-trigger"
                      type="button"
                      [attr.aria-label]="'Choisir un mois : ' + monthButtonLabel()"
                      (click)="openMonthPicker(monthPicker)"
                    >
                      {{ monthButtonLabel() }}
                    </button>
                    <input
                      #monthPicker
                      class="calendar-month-input"
                      type="month"
                      tabindex="-1"
                      aria-hidden="true"
                      [ngModel]="month()"
                      (ngModelChange)="chooseMonth($event)"
                    />
                  </span>
                </div>
                @if (bpm()) {
                  <button
                    type="button"
                    class="btn btn-secondary bpm-calendar-customize"
                    [attr.aria-expanded]="customizing()"
                    aria-controls="bpm-calendar-personalization"
                    (click)="customizing.set(!customizing())"
                  >
                    Personnaliser l’affichage
                    <span aria-hidden="true">{{ customizing() ? '−' : '+' }}</span>
                  </button>
                }
              </div>
            </div>
            @if (bpm()) {
              @if (customizing()) {
                <section
                  id="bpm-calendar-personalization"
                  class="bpm-calendar-personalization"
                  aria-label="Personnaliser le calendrier"
                >
                  <div class="bpm-calendar-preference-head">
                    <div>
                      <h3>Votre calendrier, vos repères</h3>
                      <p>
                        Mémorisé pour ce profil sur ce navigateur. Les données financières restent
                        inchangées.
                      </p>
                    </div>
                    <button class="text-link" type="button" (click)="resetDisplay()">
                      Réinitialiser
                    </button>
                  </div>
                  <div class="bpm-calendar-preference-grid">
                    <fieldset>
                      <legend>Sources affichées</legend>
                      <p>Les sources disponibles proviennent de votre calendrier BPM.</p>
                      @for (el of elements(); track el.id) {
                        <label class="bpm-calendar-choice" [style.--event-tone]="tone(el.tone)"
                          ><input
                            type="checkbox"
                            [checked]="!hidden().has(el.id)"
                            (change)="toggleElement(el.id)"
                          /><i aria-hidden="true"></i><span>{{ el.label }}</span
                          ><small>{{ countInPeriod(el.id) }}</small></label
                        >
                      }
                      <button type="button" class="text-link" (click)="showAllSources()">
                        Tout afficher
                      </button>
                    </fieldset>
                    <fieldset>
                      <legend>Informations par événement</legend>
                      <p>Dans les cases et la liste des événements.</p>
                      @for (field of dayFields; track field.key) {
                        <label class="bpm-calendar-choice"
                          ><input
                            type="checkbox"
                            [checked]="showField(field.key)"
                            (change)="toggleField(field.key)"
                          /><span>{{ field.label }}</span></label
                        >
                      }
                      <label class="bpm-calendar-density"
                        >Événements par case<select
                          aria-label="Événements par case"
                          [ngModel]="perCell()"
                          (ngModelChange)="setDensity($event)"
                        >
                          @for (n of [1, 2, 3, 4, 5, 6]; track n) {
                            <option [ngValue]="n">{{ n }}</option>
                          }
                        </select></label
                      >
                    </fieldset>
                    <fieldset>
                      <legend>Bilan au survol d’un jour</legend>
                      <p>Choisissez les indicateurs de l’aperçu.</p>
                      @for (indicator of data()?.indicators ?? []; track indicator.key) {
                        <label class="bpm-calendar-choice"
                          ><input
                            type="checkbox"
                            [checked]="indicatorShown(indicator.key)"
                            (change)="toggleIndicator(indicator.key)"
                          /><span>{{ indicator.label }}</span></label
                        >
                      }
                    </fieldset>
                  </div>
                </section>
              }
              <p class="bpm-calendar-source-summary" role="status">
                {{ visibleSourceCount() }} / {{ elements().length }} sources ·
                {{ periodEvents().length }} événements affichés
              </p>
            } @else if (elements().length) {
              <div class="calendar-elements" role="group" aria-label="Éléments affichés">
                @for (el of elements(); track el.id) {
                  <label
                    class="calendar-element-toggle"
                    [class.is-off]="hidden().has(el.id)"
                    [style.--event-tone]="tone(el.tone)"
                    [title]="markerLabel(el) + ' · ' + el.label"
                  >
                    <input
                      type="checkbox"
                      [checked]="!hidden().has(el.id)"
                      (change)="toggleElement(el.id)"
                    />
                    <span class="calendar-element-mark" aria-hidden="true">{{ symbol(el) }}</span>
                    <span class="calendar-element-label">{{ el.label }}</span>
                    <span
                      class="calendar-element-count"
                      [attr.aria-label]="countInPeriod(el.id) + ' sur la période'"
                      >{{ countInPeriod(el.id) }}</span
                    >
                  </label>
                }
              </div>
            }
          </div>
          <button class="calendar-grid-shortcut" type="button" (click)="focusCalendarGrid()">
            Aller aux jours du calendrier
          </button>
          <aside class="calendar-agenda" aria-label="Repères de la période">
            <div class="calendar-agenda-heading">
              <div>
                <p class="eyebrow">
                  {{ bpm() ? 'Événements de la période' : 'Journées de la période' }}
                </p>
                <h3>{{ periodName() }}</h3>
              </div>
              <span
                >{{ periodDays().length }} {{ periodDays().length === 1 ? 'jour' : 'jours' }}</span
              >
            </div>
            @if (bpm() || pinnedEventKeys().size) {
              <button
                class="text-link calendar-clear-highlights"
                type="button"
                [disabled]="!pinnedEventKeys().size"
                (click)="clearHighlights()"
              >
                {{ bpm() ? 'Effacer la sélection' : 'Tout désélectionner' }} ({{
                  pinnedEventKeys().size
                }})
              </button>
            }
            <div
              class="calendar-agenda-list"
              [attr.tabindex]="bpm() ? 0 : null"
              [attr.aria-label]="bpm() ? 'Liste des événements de la période' : null"
            >
              @for (group of periodDays(); track group.day) {
                <section
                  class="calendar-agenda-day"
                  [class.is-selected]="group.day === selectedDay()"
                >
                  <h4>{{ date(group.day) }}</h4>
                  @for (event of group.events; track event.key) {
                    <article
                      class="calendar-agenda-item"
                      [attr.data-event-key]="event.key"
                      [attr.data-kind]="marker(event)"
                      [style.--event-tone]="tone(element(event)?.tone)"
                      [class.is-linked]="isHighlighted(event.key)"
                      [class.is-pinned]="isPinned(event.key)"
                      (mouseenter)="hoveredEventKey.set(event.key)"
                      (mouseleave)="hoveredEventKey.set(null)"
                      (focusin)="hoveredEventKey.set(event.key)"
                      (focusout)="hoveredEventKey.set(null)"
                    >
                      <button
                        class="calendar-agenda-select"
                        type="button"
                        [attr.aria-pressed]="isPinned(event.key)"
                        [attr.aria-label]="
                          (isPinned(event.key) ? 'Désélectionner ' : 'Mettre en évidence ') +
                          event.title +
                          ' dans le calendrier'
                        "
                        (click)="toggleHighlight(event.key)"
                      >
                        <span class="calendar-agenda-select-mark" aria-hidden="true">{{
                          isPinned(event.key) ? '●' : '○'
                        }}</span>
                        <span class="calendar-agenda-select-content">
                          @if (showField('type') || (showField('status') && event.statusLabel)) {
                            <small
                              >{{ showField('type') ? element(event)?.label : ''
                              }}{{
                                showField('status') && event.statusLabel
                                  ? (showField('type') ? ' · ' : '') + event.statusLabel
                                  : ''
                              }}</small
                            >
                          }
                          <span class="calendar-agenda-title">{{ event.title }}</span>
                          <small>
                            @if (showField('amount') && event.amountCents !== null) {
                              <span
                                class="calendar-amount"
                                [attr.data-direction]="event.direction"
                                >{{ amount(event) }}</span
                              >
                              @if (showField('group') && event.groupLabel) {
                                ·
                              }
                            }
                            {{ showField('group') ? event.groupLabel : '' }}
                          </small>
                        </span>
                      </button>
                      <div class="calendar-agenda-actions">
                        @if (event.link) {
                          <button class="text-link" type="button" (click)="open.emit(event)">
                            Ouvrir
                          </button>
                        }
                        @if (event.reschedule) {
                          <button class="text-link" type="button" (click)="plan(event)">
                            Replanifier
                          </button>
                        }
                      </div>
                    </article>
                  }
                </section>
              } @empty {
                <p class="muted">
                  {{
                    bpm()
                      ? !visibleSourceCount()
                        ? 'Aucune source sélectionnée. Affichez au moins une source pour retrouver vos événements.'
                        : 'Aucun repère pour cette période avec ces choix d’affichage.'
                      : 'Aucun repère pour cette période.'
                  }}
                </p>
                @if (bpm() && !visibleSourceCount()) {
                  <button class="text-link" type="button" (click)="showAllSources()">
                    Afficher toutes les sources
                  </button>
                }
              }
            </div>
            @if (planning(); as item) {
              <form class="calendar-plan" (ngSubmit)="savePlan()">
                <h4>{{ item.title }}</h4>
                <p class="calendar-plan-note">
                  {{ element(item)?.label }} · actuellement le {{ date(item.date) }}
                </p>
                <label class="field"
                  >Nouvelle date<input
                    name="newDate"
                    type="date"
                    required
                    [(ngModel)]="plannedDate"
                /></label>
                <button
                  class="btn btn-primary"
                  type="submit"
                  [disabled]="busy() || !valid(plannedDate)"
                >
                  Enregistrer la date
                </button>
                <button class="text-link" type="button" (click)="planning.set(null)">
                  Annuler
                </button>
              </form>
            }
          </aside>
        </div>

        <div
          class="calendar-month-wrap"
          tabindex="-1"
          [attr.aria-label]="'Jours du calendrier · ' + periodName()"
          (scroll)="repositionVisiblePeek()"
        >
          <div class="calendar-grid-head">
            <h3>{{ periodName() }}</h3>
            <span>{{ gridHint() }}</span>
          </div>

          <!-- Aperçu d'une journée au survol : indicateurs paramétrés, puis repères et leurs entrées de survol. -->
          <ng-template
            #peekBody
            let-day
            let-events="events"
            let-expanded="expanded"
            let-year="year"
          >
            <div class="calendar-day-peek-head">
              <strong>{{ date(day) }}</strong>
              @if (isDayPinned(day, year)) {
                <span>Fixé</span>
              }
              <span>{{ events.length }} {{ events.length === 1 ? 'repère' : 'repères' }}</span>
            </div>
            @if (indicators().length) {
              <div
                class="calendar-day-peek-stats"
                aria-label="Bilan de la journée"
                [style.grid-template-columns]="
                  'repeat(' + indicators().length + ', minmax(0, 1fr))'
                "
              >
                @for (stat of statsOf(events); track stat.key) {
                  <button
                    type="button"
                    [attr.aria-label]="stat.aria"
                    [attr.aria-expanded]="activePeekDay() === day && activePeekStat() === stat.key"
                    [class.is-detail-active]="
                      activePeekDay() === day && activePeekStat() === stat.key
                    "
                    (pointerenter)="openPeekDetails($event, day, stat.key)"
                    (pointerleave)="closePeekDetails()"
                    (focus)="openPeekDetails($event, day, stat.key)"
                    (blur)="closePeekDetails()"
                    (click)="openPeekDetails($event, day, stat.key)"
                  >
                    <span>{{ stat.label }}</span>
                    @for (line of stat.lines; track $index) {
                      <strong
                        [class.is-alert]="line.tone === 'alert'"
                        [class.is-success]="line.tone === 'success'"
                        [class.is-zero]="line.tone === 'zero'"
                        >{{ line.text }}</strong
                      >
                    }
                  </button>
                }
              </div>
            }
            @if (activePeekDay() === day && activePeekStat(); as stat) {
              @let rows = statRows(events, stat);
              <aside
                class="calendar-peek-details"
                [style.left.px]="peekDetailsPosition().left"
                [style.top.px]="peekDetailsPosition().top"
                [style.max-height.px]="peekDetailsPosition().maxHeight"
                [attr.aria-label]="statLabel(stat) + ' du ' + date(day)"
              >
                <h4 class="calendar-peek-details-title">{{ statLabel(stat) }}</h4>
                <div class="calendar-peek-details-content">
                  @for (row of rows.slice(0, 8); track $index) {
                    <p>
                      <strong>{{ row.label }}</strong> {{ row.title }}
                    </p>
                  } @empty {
                    <p>Aucun élément pour cette rubrique.</p>
                  }
                  @if (rows.length > 8) {
                    <p>+ {{ rows.length - 8 }} autres repères</p>
                  }
                </div>
              </aside>
            }
            <div class="calendar-day-peek-list">
              @for (
                event of events.slice(0, expanded ? events.length : perPeek());
                track event.key
              ) {
                <article
                  class="calendar-peek-card"
                  [attr.data-kind]="marker(event)"
                  [style.--event-tone]="tone(element(event)?.tone)"
                  [class.completed]="event.done"
                  [class.is-linked]="isHighlighted(event.key)"
                  [class.is-pinned]="isPinned(event.key)"
                  [attr.draggable]="!!event.reschedule && !busy()"
                  (dragstart)="drag($event, event)"
                  (dragend)="dragged = null"
                  (pointerenter)="hoverCalendarEvent(event.key)"
                  (pointerleave)="hoveredEventKey.set(null)"
                >
                  <header class="calendar-peek-card-head">
                    <button
                      type="button"
                      class="calendar-peek-card-pin"
                      [attr.aria-pressed]="isPinned(event.key)"
                      [attr.aria-label]="
                        (isPinned(event.key)
                          ? 'Ne plus mettre en évidence '
                          : 'Mettre en évidence ') + event.title
                      "
                      (click)="togglePeekHighlight(event, $event, year)"
                    >
                      <span aria-hidden="true">{{ symbol(element(event)) }}</span>
                    </button>
                    <button
                      type="button"
                      class="calendar-peek-card-title"
                      [title]="event.link ? 'Ouvrir ' + event.title : event.title"
                      [disabled]="!event.link"
                      (click)="open.emit(event)"
                    >
                      {{ event.title }}
                    </button>
                    @if (event.amountCents !== null) {
                      <span class="calendar-amount" [attr.data-direction]="event.direction">{{
                        amount(event)
                      }}</span>
                    }
                  </header>
                  <p class="calendar-peek-card-kind">
                    <span>{{ element(event)?.label }}</span>
                    @if (event.urgent === 'overdue') {
                      <span class="calendar-urgency" data-urgency="overdue">En retard</span>
                    } @else if (event.urgent === 'soon') {
                      <span class="calendar-urgency" data-urgency="soon">Bientôt</span>
                    }
                  </p>
                  @if (event.details.length) {
                    <dl class="calendar-peek-card-details">
                      @for (d of event.details; track $index) {
                        <div>
                          <dt>{{ d.label }}</dt>
                          <dd>{{ d.value }}</dd>
                        </div>
                      }
                    </dl>
                  }
                </article>
              }
              @if (events.length > perPeek()) {
                <button
                  type="button"
                  class="calendar-more calendar-peek-more"
                  [attr.aria-expanded]="expanded"
                  (click)="toggleExpansion(day, year)"
                >
                  @if (expanded) {
                    Réduire
                  } @else {
                    + {{ events.length - perPeek() }} autres
                  }
                </button>
              }
            </div>
          </ng-template>

          <!-- Cadre commun aux trois vues : même largeur et même hauteur (proportions du nombre d'or). -->
          <div
            class="calendar-frame"
            [attr.data-view]="view()"
            [attr.tabindex]="bpm() && view() === 'year' ? 0 : null"
            [attr.role]="bpm() && view() === 'year' ? 'region' : null"
            [attr.aria-label]="
              bpm() && view() === 'year'
                ? 'Calendrier annuel, défilement horizontal sur petit écran'
                : null
            "
          >
            @if (view() === 'year') {
              <div class="calendar-year-grid" (scroll)="repositionVisiblePeek()">
                @for (yearMonth of months(); track yearMonth.key) {
                  <section
                    class="calendar-year-month"
                    [class.is-open]="visibleYearDay()?.slice(0, 7) === yearMonth.key"
                    [attr.aria-label]="monthName(yearMonth.key)"
                    (mouseleave)="scheduleYearPeekClose()"
                    (focusout)="clearYearDayFocus($event)"
                  >
                    <h3>{{ monthName(yearMonth.key) }}</h3>
                    <div class="calendar-year-weekdays" aria-hidden="true">
                      @for (weekday of weekdays; track $index) {
                        <span>{{ weekday.slice(0, 1) }}</span>
                      }
                    </div>
                    <div class="calendar-year-days">
                      @for (day of yearMonth.days; track day) {
                        @let dayEvents = byDay().get(day) ?? [];
                        @if (day.startsWith(yearMonth.key) && dayEvents.length) {
                          <button
                            type="button"
                            class="calendar-year-day has-events"
                            [attr.data-day]="day"
                            [class.is-today]="day === today"
                            [class.is-selected]="day === pinnedYearDay()"
                            [class.has-highlighted-events]="isDayHighlighted(day)"
                            [class.is-busy]="dayEvents.length >= 4"
                            [class.is-heavy]="dayEvents.length >= 8"
                            [class.has-attention]="hasAttention(dayEvents)"
                            [class.has-progress]="hasProgress(dayEvents)"
                            [style.--day-tone]="dominantTone(dayEvents)"
                            [attr.aria-label]="yearDayLabel(day, dayEvents.length)"
                            [attr.aria-expanded]="day === visibleYearDay()"
                            (pointerenter)="enterYearDay(day, $event)"
                            (pointermove)="orientYearPeek(day, $event)"
                            (pointerleave)="leaveYearDay(day)"
                            (focus)="
                              cancelYearPeekClose();
                              focusedYearDay.set(day);
                              positionYearPeekOnFocus($event)
                            "
                            (click)="toggleYearDay(day, $event)"
                            (keydown)="onDayKeydown($event, day)"
                            (dragover)="allowDrop($event)"
                            (drop)="drop($event, day)"
                          >
                            <span class="calendar-year-number">
                              {{ day.slice(-2) }}
                              <span class="calendar-year-load" aria-hidden="true">{{
                                dayEvents.length
                              }}</span>
                            </span>
                          </button>
                        } @else if (day.startsWith(yearMonth.key)) {
                          <span
                            class="calendar-year-empty-day"
                            [class.is-today]="day === today"
                            (dragover)="allowDrop($event)"
                            (drop)="drop($event, day)"
                            ><span class="calendar-year-number">{{ day.slice(-2) }}</span></span
                          >
                        } @else {
                          <span class="calendar-year-outside-day" aria-hidden="true"
                            ><span class="calendar-year-number">{{ day.slice(-2) }}</span></span
                          >
                        }
                      }
                    </div>
                    @if (visibleYearDay(); as openDay) {
                      @if (openDay.startsWith(yearMonth.key)) {
                        @let openEvents = byDay().get(openDay) ?? [];
                        <div
                          class="calendar-day-peek calendar-year-peek"
                          [class.is-expanded]="expandedYearPeekDay() === openDay"
                          role="region"
                          [attr.aria-label]="'Repères du ' + date(openDay)"
                          [attr.data-day]="openDay"
                          [style.left.px]="yearPeekPosition().x"
                          [style.top.px]="yearPeekPosition().top"
                          [style.max-height.px]="yearPeekPosition().maxHeight"
                          [style.min-height.px]="
                            pinnedYearDay() === openDay ? yearPeekPosition().bridgeHeight : null
                          "
                          (pointerenter)="cancelYearPeekClose()"
                          (pointerleave)="scheduleYearPeekClose(openDay)"
                          (keydown.escape)="releasePeek()"
                        >
                          <ng-container
                            *ngTemplateOutlet="
                              peekBody;
                              context: {
                                $implicit: openDay,
                                events: openEvents,
                                expanded: expandedYearPeekDay() === openDay,
                                year: true,
                              }
                            "
                          />
                        </div>
                      }
                    }
                    <div class="calendar-year-band" aria-live="polite">
                      @if (visibleYearDay(); as openDay) {
                        @if (openDay.startsWith(yearMonth.key)) {
                          <strong>{{ date(openDay) }}</strong>
                          <span>{{ (byDay().get(openDay) ?? []).length }} repères</span>
                        }
                      }
                    </div>
                  </section>
                }
              </div>
            } @else {
              <p class="calendar-scroll-hint">
                Faites défiler la grille horizontalement pour voir les autres jours.
              </p>
              <div
                class="calendar-grid-scroll"
                [class.is-week]="view() === 'week'"
                role="region"
                [attr.aria-label]="'Jours de ' + periodName() + ', défilement horizontal'"
                tabindex="0"
                (scroll)="repositionVisiblePeek()"
              >
                <div class="calendar-grid-content">
                  <div class="calendar-weekdays" aria-hidden="true">
                    @for (weekday of weekdays; track $index) {
                      <span>{{ view() === 'week' ? weekday : weekday.slice(0, 1) }}</span>
                    }
                  </div>
                  <div class="calendar-grid" [class.is-week]="view() === 'week'">
                    @for (day of days(); track day) {
                      @let dayEvents = byDay().get(day) ?? [];
                      @let shown =
                        view() === 'week' && !bpm() ? dayEvents : dayEvents.slice(0, perCell());
                      <section
                        class="calendar-day"
                        [attr.data-day]="day"
                        [class.has-events]="dayEvents.length > 0"
                        [class.has-attention]="hasAttention(dayEvents)"
                        [class.has-progress]="hasProgress(dayEvents)"
                        [class.is-lit]="isDayHighlighted(day)"
                        [class.outside-month]="view() === 'month' && day.slice(0, 7) !== month()"
                        [class.selected-day]="day === selectedDay()"
                        [class.is-peek-pinned]="pinnedMonthDay() === day"
                        [class.today]="day === today"
                        (click)="toggleMonthPeekPin(day, $event)"
                        (pointerenter)="enterMonthDay(day, $event)"
                        (pointermove)="orientMonthPeek(day, $event)"
                        (pointerleave)="leaveMonthDay(day)"
                        (focusin)="focusMonthDay(day, $event)"
                        (focusout)="clearMonthDayFocus($event)"
                        (dragover)="allowDrop($event)"
                        (drop)="drop($event, day)"
                      >
                        <div class="calendar-day-head">
                          <button
                            class="calendar-day-number"
                            type="button"
                            [attr.aria-label]="
                              'Voir le ' +
                              date(day) +
                              (dayEvents.length ? ' · ' + dayEvents.length + ' repères' : '')
                            "
                            [attr.aria-pressed]="day === selectedDay()"
                            [attr.aria-expanded]="day === visibleMonthDay() && dayEvents.length > 0"
                            (click)="selectDay(day)"
                            (keydown)="onDayKeydown($event, day)"
                          >
                            {{ day.slice(-2) }}
                          </button>
                          @if (dayAmount(dayEvents); as total) {
                            <span class="calendar-day-total" [attr.data-sign]="total.sign">{{
                              total.text
                            }}</span>
                          }
                          @if (dayEvents.length > shown.length) {
                            <button
                              type="button"
                              class="calendar-more calendar-day-more"
                              [attr.aria-expanded]="expandedDay() === day"
                              [attr.aria-label]="
                                'Voir les ' + dayEvents.length + ' repères du ' + date(day)
                              "
                              (click)="toggleDayExpansion(day, $event)"
                            >
                              +{{ dayEvents.length - shown.length }}
                            </button>
                          }
                        </div>
                        @for (event of shown; track event.key) {
                          <button
                            type="button"
                            class="calendar-event"
                            [attr.data-kind]="marker(event)"
                            [attr.data-tone]="element(event)?.tone"
                            [style.--event-tone]="tone(element(event)?.tone)"
                            [attr.aria-pressed]="isPinned(event.key)"
                            [class.completed]="event.done"
                            [class.is-linked]="isHighlighted(event.key)"
                            [class.is-pinned]="isPinned(event.key)"
                            [class.is-movable]="!!event.reschedule"
                            [attr.draggable]="!!event.reschedule && !busy()"
                            (dragstart)="drag($event, event)"
                            (dragend)="dragged = null"
                            [title]="
                              event.title +
                              ' · ' +
                              (element(event)?.label ?? '') +
                              ' — clic : garder en évidence, double-clic : ouvrir'
                            "
                            (pointerenter)="hoverCalendarEvent(event.key)"
                            (pointerleave)="hoveredEventKey.set(null)"
                            (focus)="hoverCalendarEvent(event.key)"
                            (blur)="hoveredEventKey.set(null)"
                            (click)="toggleHighlight(event.key)"
                            (dblclick)="open.emit(event)"
                          >
                            <span aria-hidden="true">{{ symbol(element(event)) }}</span>
                            <span class="calendar-event-title">{{ event.title }}</span>
                            @if (showField('amount') && event.amountCents !== null) {
                              <small
                                class="calendar-amount"
                                [attr.data-direction]="event.direction"
                                >{{ amount(event) }}</small
                              >
                            }
                            @if (
                              (bpm() && showField('type')) || (!bpm() && event.amountCents === null)
                            ) {
                              <small>{{ element(event)?.label }}</small>
                            }
                            @if (bpm() && showField('status') && event.statusLabel) {
                              <small class="bpm-calendar-event-status">{{
                                event.statusLabel
                              }}</small>
                            }
                            @if (bpm() && showField('group') && event.groupLabel) {
                              <small class="bpm-calendar-event-group">{{ event.groupLabel }}</small>
                            }
                          </button>
                        }
                        @if (dayEvents.length && visibleMonthDay() === day) {
                          <div
                            class="calendar-day-peek"
                            [class.is-expanded]="expandedDay() === day"
                            role="region"
                            [attr.aria-label]="'Repères du ' + date(day)"
                            (pointerenter)="cancelMonthPeekClose()"
                            (pointerleave)="scheduleMonthPeekClose(day)"
                            (keydown.escape)="releasePeek()"
                            [style.left.px]="monthPeekPosition().x"
                            [style.top.px]="monthPeekPosition().top"
                            [style.max-height.px]="monthPeekPosition().maxHeight"
                            [style.min-height.px]="
                              pinnedMonthDay() === day ? monthPeekPosition().bridgeHeight : null
                            "
                          >
                            <ng-container
                              *ngTemplateOutlet="
                                peekBody;
                                context: {
                                  $implicit: day,
                                  events: dayEvents,
                                  expanded: expandedDay() === day,
                                  year: false,
                                }
                              "
                            />
                          </div>
                        }
                      </section>
                    }
                  </div>
                </div>
              </div>
            }
          </div>
          <p class="calendar-legend calendar-legend-inset">
            <span><i data-kind="start"></i> {{ markerText.start }}</span>
            <span><i data-kind="due"></i> {{ markerText.due }}</span>
            <span><i data-kind="point"></i> {{ markerText.point }}</span>
            <span><i data-kind="done"></i> Élément terminé ou réglé</span>
            <span>Survolez un jour pour lire ses repères ; cliquez pour fixer l’aperçu.</span>
          </p>
        </div>
        <ng-content />
      </div>
      @if (loading()) {
        <p class="calendar-feedback calendar-loading" role="status">Chargement des repères…</p>
      }
      @if (feedback()) {
        <p class="calendar-feedback" role="status">{{ feedback() }}</p>
      }
      @if (error()) {
        <p class="import-issues" role="alert">{{ error() }}</p>
      }
    </section>
  `,
})
export class CalendarComponent {
  readonly data = input<CalendarData | null>(null);
  /** Personnalisation visuelle réservée au calendrier de l’application BPM. */
  readonly bpm = input(false);
  readonly loading = input(false);
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  readonly feedback = input('');
  readonly periodChange = output<CalendarPeriod>();
  readonly open = output<CalendarEvent>();
  readonly reschedule = output<{ event: CalendarEvent; date: string }>();
  readonly displayedEventsChange = output<CalendarEvent[]>();

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
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
  protected readonly group = signal('all');
  protected readonly customizing = signal(false);
  protected readonly dayFields = BPM_DAY_FIELDS;
  private readonly preferences = signal<BpmCalendarPreferences | null>(null);
  private preferenceProfile: string | null | undefined;
  protected readonly visibleSourceCount = computed(
    () => this.elements().filter((el) => !this.hidden().has(el.id)).length,
  );

  protected readonly month = computed(() => this.selectedDay().slice(0, 7));
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
      (indicator) => !this.bpm() || this.indicatorShown(indicator.key),
    ),
  );
  private readonly elementsById = computed(() => new Map(this.elements().map((el) => [el.id, el])));
  protected readonly perCell = computed(
    () => (this.bpm() ? this.preferences()?.perCell : null) ?? this.data()?.display.perCell ?? 2,
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
  protected readonly gridHint = computed(() =>
    this.elements().some((el) => el.reschedulable)
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
  protected readonly expandedDay = signal<string | null>(null);
  protected readonly hoveredMonthDay = signal<string | null>(null);
  protected readonly focusedMonthDay = signal<string | null>(null);
  protected readonly pinnedMonthDay = signal<string | null>(null);
  protected readonly monthPeekPosition = signal<DayPeekPosition>({
    x: 0,
    top: 0,
    maxHeight: 0,
    bridgeHeight: 0,
  });
  protected readonly visibleMonthDay = computed(
    () => this.pinnedMonthDay() ?? this.hoveredMonthDay() ?? this.focusedMonthDay(),
  );
  private monthPointerStart: { day: string; x: number; y: number } | null = null;
  private monthPeekSide: -1 | 1 = 1;
  private monthPeekSideLocked = false;
  private monthPeekCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private pointerPosition: { x: number; y: number } | null = null;

  protected readonly hoveredYearDay = signal<string | null>(null);
  protected readonly focusedYearDay = signal<string | null>(null);
  protected readonly pinnedYearDay = signal<string | null>(null);
  protected readonly expandedYearPeekDay = signal<string | null>(null);
  protected readonly yearPeekPosition = signal<DayPeekPosition>({
    x: 0,
    top: 0,
    maxHeight: 0,
    bridgeHeight: 0,
  });
  private yearPeekCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private yearPointerStart: { day: string; x: number; y: number } | null = null;
  private yearPeekSide: -1 | 1 = 1;
  private yearPeekSideLocked = false;
  protected readonly visibleYearDay = computed(() => {
    const day = this.pinnedYearDay() ?? this.hoveredYearDay() ?? this.focusedYearDay();
    return day && this.byDay().has(day) ? day : null;
  });

  protected readonly activePeekDay = signal<string | null>(null);
  protected readonly activePeekStat = signal<CalendarIndicatorKey | null>(null);
  protected readonly peekDetailsPosition = signal({ left: 0, top: 0, maxHeight: 0 });

  // ---------- replanification ----------
  protected readonly planning = signal<CalendarEvent | null>(null);
  protected plannedDate = '';
  protected dragged: CalendarEvent | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.cancelYearPeekClose();
      this.cancelMonthPeekClose();
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
        bpm = this.bpm(),
        profile = this.context.userId();
      if (!bpm || !data || this.preferenceProfile === profile) return;
      this.preferenceProfile = profile;
      untracked(() => {
        const preferences = readDisplayPreferences(profile, data);
        this.preferences.set(preferences);
        this.hidden.set(
          new Set(data.elements.filter((el) => !preferences.sources[el.id]).map((el) => el.id)),
        );
        this.includeDone.set(preferences.includeDone);
        this.group.set('all');
      });
    });
    effect(() => {
      if (this.bpm()) this.displayedEventsChange.emit(this.events());
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

  // ---------- éléments et filtres ----------
  protected toggleElement(id: string) {
    this.hidden.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (this.bpm())
      this.savePreferences({
        sources: Object.fromEntries(
          this.elements().map((el) => [el.id, !this.hidden().has(el.id)]),
        ),
      });
    this.releasePeek();
  }

  protected showField(field: BpmDayField) {
    return !this.bpm() || (this.preferences()?.fields[field] ?? true);
  }
  protected indicatorShown(key: CalendarIndicatorKey) {
    return this.preferences()?.indicators.includes(key) ?? true;
  }
  protected toggleField(field: BpmDayField) {
    const current = this.preferences();
    if (current)
      this.savePreferences({ fields: { ...current.fields, [field]: !current.fields[field] } });
  }
  protected toggleIndicator(key: CalendarIndicatorKey) {
    const current = this.preferences();
    if (!current) return;
    const keys = current.indicators.includes(key)
      ? current.indicators.filter((value) => value !== key)
      : [...current.indicators, key];
    this.savePreferences({ indicators: keys });
    this.releasePeek();
  }
  protected setDensity(perCell: number) {
    if (Number.isInteger(perCell) && perCell >= 1 && perCell <= 6)
      this.savePreferences({ perCell });
  }
  protected setIncludeDone(includeDone: boolean) {
    this.includeDone.set(includeDone);
    if (this.bpm()) this.savePreferences({ includeDone });
  }
  protected showAllSources() {
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
    this.savePreferences(defaults);
    this.releasePeek();
  }
  private savePreferences(change: Partial<BpmCalendarPreferences>) {
    const current = this.preferences();
    if (!this.bpm() || !current) return;
    const next = { ...current, ...change };
    this.preferences.set(next);
    writeDisplayPreferences(this.context.userId(), next);
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
    if (!wasPinned && day) this.setGridDayPin(event.date, day);
    else if (wasPinned && this.pinnedMonthDay() === event.date) {
      this.pinnedMonthDay.set(null);
      this.expandedDay.set(null);
    }
  }
  /** Suit le repère survolé dans l'agenda, sans déplacer la page ni le focus. */
  protected hoverCalendarEvent(key: string) {
    this.hoveredEventKey.set(key);
    // En BPM, le survol souligne le repère sans déplacer la liste en cours de lecture.
    if (this.bpm()) return;
    const list = this.host.nativeElement.querySelector<HTMLElement>('.calendar-agenda-list');
    const entry = Array.from(list?.querySelectorAll<HTMLElement>('[data-event-key]') ?? []).find(
      (el) => el.dataset['eventKey'] === key,
    );
    if (!list || !entry) return;
    const bounds = list.getBoundingClientRect();
    const rect = entry.getBoundingClientRect();
    if (rect.top < bounds.top || rect.bottom > bounds.bottom)
      list.scrollTo({ top: list.scrollTop + rect.top - bounds.top - 8, behavior: 'auto' });
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
    const width = Math.min(340, window.innerWidth - 2 * margin);
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
  protected toggleDayExpansion(day: string, event: MouseEvent) {
    event.stopPropagation();
    const target = event.currentTarget;
    if (target instanceof HTMLElement)
      this.setGridDayPin(day, target.closest('.calendar-day') as HTMLElement, true);
    this.expandedDay.set(day);
  }
  protected enterMonthDay(day: string, event: PointerEvent) {
    if (!this.byDay().has(day)) return;
    this.pointerPosition = { x: event.clientX, y: event.clientY };
    this.cancelMonthPeekClose();
    if (this.pinnedMonthDay()) {
      this.hoveredMonthDay.set(day);
      return;
    }
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const bounds = target.getBoundingClientRect();
    this.monthPointerStart = { day, x: event.clientX, y: event.clientY };
    this.monthPeekSide = event.clientX < bounds.left + bounds.width / 2 ? -1 : 1;
    this.monthPeekSideLocked = false;
    this.hoveredMonthDay.set(day);
    this.positionMonthPeek(target, this.monthPeekSide);
  }
  protected orientMonthPeek(day: string, event: PointerEvent) {
    if (
      this.pinnedMonthDay() ||
      this.hoveredMonthDay() !== day ||
      this.monthPointerStart?.day !== day ||
      this.monthPeekSideLocked
    )
      return;
    if (event.target instanceof Element && event.target.closest('.calendar-day-peek')) {
      this.monthPeekSideLocked = true;
      return;
    }
    if (Math.abs(event.clientY - this.monthPointerStart.y) > 20) {
      this.monthPeekSideLocked = true;
      return;
    }
    const movement = event.clientX - this.monthPointerStart.x;
    if (Math.abs(movement) < 10) return;
    const side = movement < 0 ? -1 : 1;
    this.monthPeekSideLocked = true;
    if (side !== this.monthPeekSide) {
      this.monthPeekSide = side;
      this.positionMonthPeek(event.currentTarget, side);
    }
  }
  protected leaveMonthDay(day: string) {
    this.scheduleMonthPeekClose(day);
  }
  protected toggleMonthPeekPin(day: string, event: MouseEvent) {
    if (!this.byDay().has(day)) return;
    const target = event.target;
    if (
      !(target instanceof Element) ||
      target.closest('.calendar-day-peek, .calendar-more, .calendar-event, .calendar-day-number')
    )
      return;
    if (event.currentTarget instanceof HTMLElement) this.setGridDayPin(day, event.currentTarget);
  }
  private setGridDayPin(day: string, target: HTMLElement | null, keep = false) {
    const previous = this.pinnedMonthDay();
    this.cancelMonthPeekClose();
    if (previous === day && !keep) {
      this.pinnedMonthDay.set(null);
      this.expandedDay.set(null);
      return;
    }
    this.expandedDay.set(null);
    if (target) this.positionMonthPeek(target, this.monthPeekSide);
    this.pinnedMonthDay.set(day);
  }
  protected cancelMonthPeekClose() {
    if (this.monthPeekCloseTimer !== null) clearTimeout(this.monthPeekCloseTimer);
    this.monthPeekCloseTimer = null;
  }
  protected scheduleMonthPeekClose(day: string) {
    this.cancelMonthPeekClose();
    this.monthPeekCloseTimer = setTimeout(() => this.closeMonthDay(day), this.closeDelay());
  }
  private closeMonthDay(day: string) {
    this.cancelMonthPeekClose();
    const point = this.pointerPosition;
    const under = point ? document.elementFromPoint(point.x, point.y) : null;
    if (under?.closest('.calendar-day')?.getAttribute('data-day') === day) return;
    if (this.hoveredMonthDay() === day) this.hoveredMonthDay.set(null);
    if (this.focusedMonthDay() === day) this.focusedMonthDay.set(null);
    if (this.expandedDay() === day && this.pinnedMonthDay() !== day) this.expandedDay.set(null);
    if (this.monthPointerStart?.day === day) this.monthPointerStart = null;
    this.monthPeekSideLocked = false;
    this.closePeekDetails();
  }
  protected focusMonthDay(day: string, event: FocusEvent) {
    if (!this.byDay().has(day)) return;
    this.focusedMonthDay.set(day);
    if (this.pinnedMonthDay()) return;
    this.positionMonthPeek(event.currentTarget, this.monthPeekSide);
  }
  protected clearMonthDayFocus(event: FocusEvent) {
    const current = event.currentTarget;
    if (
      current instanceof Element &&
      event.relatedTarget instanceof Node &&
      current.contains(event.relatedTarget)
    )
      return;
    this.focusedMonthDay.set(null);
  }
  private positionMonthPeek(target: EventTarget | null, side: -1 | 1) {
    if (!(target instanceof HTMLElement)) return;
    if (window.innerWidth <= 900) {
      this.monthPeekPosition.set({ x: null, top: null, maxHeight: null, bridgeHeight: null });
      return;
    }
    const scale = Number.parseFloat(getComputedStyle(target).getPropertyValue('--text-scale')) || 1;
    this.monthPeekPosition.set(
      positionDayPeek({
        day: target.getBoundingClientRect(),
        calendarTop: this.safeTop(target),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        textScale: scale,
        side,
        topGap: this.view() === 'month' ? 16 : -10,
        lateralShiftRatio: 0.2,
      }),
    );
  }

  // ---------- aperçus : année ----------
  protected toggleYearDay(day: string, event: MouseEvent) {
    if (!this.byDay().has(day)) return;
    this.cancelYearPeekClose();
    const wasPinned = this.pinnedYearDay() === day;
    if (event.currentTarget instanceof HTMLElement) this.setYearPeekPosition(event.currentTarget);
    this.selectDay(day);
    this.pinnedYearDay.set(wasPinned ? null : day);
    this.expandedYearPeekDay.set(null);
    this.focusedYearDay.set(day);
  }
  protected enterYearDay(day: string, event: PointerEvent) {
    this.cancelYearPeekClose();
    this.hoveredYearDay.set(day);
    if (this.pinnedYearDay()) return;
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const bounds = target.getBoundingClientRect();
    this.yearPointerStart = { day, x: event.clientX, y: event.clientY };
    this.yearPeekSide = event.clientX < bounds.left + bounds.width / 2 ? -1 : 1;
    this.yearPeekSideLocked = false;
    this.setYearPeekPosition(target);
  }
  protected orientYearPeek(day: string, event: PointerEvent) {
    if (this.pinnedYearDay() || this.yearPointerStart?.day !== day || this.yearPeekSideLocked)
      return;
    if (Math.abs(event.clientY - this.yearPointerStart.y) > 12) {
      this.yearPeekSideLocked = true;
      return;
    }
    const movement = event.clientX - this.yearPointerStart.x;
    if (Math.abs(movement) < 4) return;
    const side = movement < 0 ? -1 : 1;
    this.yearPeekSideLocked = true;
    if (side !== this.yearPeekSide) {
      this.yearPeekSide = side;
      if (event.currentTarget instanceof HTMLElement) this.setYearPeekPosition(event.currentTarget);
    }
  }
  protected leaveYearDay(day: string) {
    if (this.hoveredYearDay() === day) this.scheduleYearPeekClose();
  }
  protected positionYearPeekOnFocus(event: FocusEvent) {
    if (event.currentTarget instanceof HTMLElement && !this.pinnedYearDay())
      this.setYearPeekPosition(event.currentTarget);
  }
  private setYearPeekPosition(target: HTMLElement) {
    if (window.innerWidth <= 900) {
      this.yearPeekPosition.set({ x: null, top: null, maxHeight: null, bridgeHeight: null });
      return;
    }
    const scale = Number.parseFloat(getComputedStyle(target).getPropertyValue('--text-scale')) || 1;
    this.yearPeekPosition.set(
      positionDayPeek({
        day: target.getBoundingClientRect(),
        calendarTop: this.safeTop(target),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        textScale: scale,
        side: this.yearPeekSide,
        topGap: 16,
        lateralShiftRatio: 0.7,
      }),
    );
  }
  protected clearYearDayFocus(event: FocusEvent) {
    const current = event.currentTarget;
    if (
      current instanceof Element &&
      event.relatedTarget instanceof Node &&
      current.contains(event.relatedTarget)
    )
      return;
    this.focusedYearDay.set(null);
    this.scheduleYearPeekClose();
  }
  protected cancelYearPeekClose() {
    if (this.yearPeekCloseTimer !== null) clearTimeout(this.yearPeekCloseTimer);
    this.yearPeekCloseTimer = null;
  }
  protected scheduleYearPeekClose(day = this.visibleYearDay()) {
    this.cancelYearPeekClose();
    this.yearPeekCloseTimer = setTimeout(() => this.closeYearDay(day), this.closeDelay());
  }
  private closeYearDay(day: string | null) {
    this.cancelYearPeekClose();
    if (!day) return;
    const point = this.pointerPosition;
    const under = point ? document.elementFromPoint(point.x, point.y) : null;
    if (
      under?.closest(
        `.calendar-year-day[data-day="${day}"], .calendar-year-peek[data-day="${day}"]`,
      )
    )
      return;
    if (this.pinnedYearDay() !== day && this.expandedYearPeekDay() === day)
      this.expandedYearPeekDay.set(null);
    if (this.hoveredYearDay() === day) this.hoveredYearDay.set(null);
    if (this.focusedYearDay() === day) this.focusedYearDay.set(null);
    this.yearPointerStart = null;
    this.yearPeekSideLocked = false;
    this.closePeekDetails();
  }

  /**
   * Haut utilisable pour un aperçu : sous le haut de la grille et sous tout bandeau resté fixé en haut de
   * l'écran (bandeau de page figé, barre du site), pour qu'un aperçu ne passe jamais dessous.
   */
  private safeTop(target: HTMLElement): number {
    let top = target.closest('.calendar-month-wrap')?.getBoundingClientRect().top ?? 12;
    const page = target.closest('.page') ?? document.body;
    for (const el of Array.from(
      page.querySelectorAll<HTMLElement>('.page-head, [data-sticky-hero]'),
    )) {
      const position = getComputedStyle(el).position;
      if (position !== 'sticky' && position !== 'fixed') continue;
      // Un bandeau figé qui recouvre le haut de la grille repousse la zone permise sous lui.
      const rect = el.getBoundingClientRect();
      if (rect.bottom > top) top = rect.bottom + 8;
    }
    return top;
  }

  @HostListener('window:scroll')
  @HostListener('window:resize')
  protected repositionVisiblePeek() {
    this.closePeekDetails();
    const day = this.visibleMonthDay();
    if (day) {
      const target = this.host.nativeElement.querySelector<HTMLElement>(
        `.calendar-grid .calendar-day[data-day="${day}"]`,
      );
      if (target) this.positionMonthPeek(target, this.monthPeekSide);
    }
    const yearDay = this.visibleYearDay();
    if (yearDay) {
      const target = this.host.nativeElement.querySelector<HTMLElement>(
        `.calendar-year-day[data-day="${yearDay}"]`,
      );
      if (target) this.setYearPeekPosition(target);
    }
  }
  @HostListener('window:pointermove', ['$event'])
  protected trackPointer(event: PointerEvent) {
    this.pointerPosition = { x: event.clientX, y: event.clientY };
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
  protected selectDay(day: string) {
    if (!validDate(day)) return;
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
  protected movePeriod(step: number) {
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
  protected setView(view: CalendarView, { chosen = true } = {}) {
    if (chosen) this.viewChosen = true;
    this.releasePeek();
    this.cancelYearPeekClose();
    this.cancelMonthPeekClose();
    this.monthPointerStart = null;
    this.yearPointerStart = null;
    this.monthPeekSideLocked = false;
    this.yearPeekSideLocked = false;
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
  }
  protected savePlan() {
    const event = this.planning();
    if (!event || !validDate(this.plannedDate) || this.plannedDate === event.date) return;
    this.reschedule.emit({ event, date: this.plannedDate });
    this.planning.set(null);
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
