import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CalendarSpaceComponent } from './calendar-space.component';
import { CalendarData, CalendarEvent, CalendarPeriod } from './calendar.models';
import { formatAmount, groupsOf, periodSummary } from './calendar-model';
import { inPeriod, monthLabel, periodBounds } from './calendar-dates';

/** Textes d'une page de calendrier, donnés par la route : le code de la page est le même pour tous les modules. */
export interface CalendarPageData {
  calendar: string;
  eyebrow: string;
  title: string;
  emphasis: string;
  intro: string;
  groupsTitle: string;
  groupKicker: string;
}

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * Page « Calendrier » d'un module (gabarit Calendrier 360 de la référence) : synthèse de la période, dates de la
 * période par mois, calendrier, puis repères par regroupement (projet, Budget, patrimoine…). Elle ne connaît
 * que le calendrier nommé par sa route ; ses chiffres viennent des repères que la configuration a produits.
 */
@Component({
  selector: 'app-calendar-page',
  imports: [CalendarSpaceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page page-wide calendar-360-page calendar-module-page">
      <div class="calendar-360-top">
        <header class="page-head">
          <div>
            <div class="page-hero-title">
              <h1 class="display">
                {{ page.title }} <em>{{ page.emphasis }}</em>
              </h1>
              <p class="eyebrow"><span class="eyebrow-line"></span>{{ page.eyebrow }}</p>
            </div>
          </div>
          <p class="lead calendar-360-intro">{{ page.intro }}</p>
        </header>

        <section class="calendar-360-overview" aria-label="Synthèse de la période">
          <div class="calendar-360-overview-body">
            <section class="summary-band calendar-360-stats" aria-label="Chiffres de la période">
              <h3 class="eyebrow calendar-360-stats-title">
                {{
                  isBpm
                    ? 'Montants des sources affichées'
                    : (data()?.calendar?.label ?? 'Calendrier')
                }}
              </h3>
              <div class="summary-band-total">
                <strong>{{ summary().markers }}</strong>
                <span>{{
                  isBpm
                    ? 'événements affichés'
                    : summary().markers === 1
                      ? 'repère daté'
                      : 'repères datés'
                }}</span>
              </div>
              @if (summary().hasAmounts) {
                <div class="summary-band-stat calendar-stat-amount" data-direction="entree">
                  <strong>{{ money(summary().inCents, 'entree') }}</strong
                  ><span>{{ isBpm ? 'entrées affichées' : 'entrées' }}</span>
                </div>
                <div class="summary-band-stat calendar-stat-amount" data-direction="sortie">
                  <strong>{{ money(summary().outCents, 'sortie') }}</strong
                  ><span>{{ isBpm ? 'sorties affichées' : 'sorties' }}</span>
                </div>
                <div
                  class="summary-band-stat calendar-stat-amount"
                  [attr.data-direction]="summary().netCents < 0 ? 'sortie' : 'entree'"
                >
                  <strong>{{
                    money(summary().netCents, summary().netCents < 0 ? 'sortie' : 'entree')
                  }}</strong
                  ><span>{{ isBpm ? 'écart des flux affichés' : 'solde de la période' }}</span>
                </div>
              } @else {
                @for (n of naturesShown(); track n.nature) {
                  <div class="summary-band-stat">
                    <strong>{{ n.count }}</strong
                    ><span>{{ n.label }}</span>
                  </div>
                }
                <div class="summary-band-stat">
                  <strong>{{ summary().toFollow }}</strong
                  ><span>à suivre</span>
                </div>
              }
            </section>

            <div class="calendar-360-heading">
              <p class="eyebrow">Période affichée</p>
              <h2>Du {{ date(bounds().start) }} au {{ date(bounds().end) }}</h2>
              <small
                >{{ summary().markers }}
                {{ summary().markers === 1 ? 'repère daté' : 'repères datés' }}</small
              >
            </div>

            <details class="calendar-360-timeline">
              <summary>
                <span class="calendar-360-timeline-copy">
                  <strong>{{
                    isBpm ? 'Chronologie des événements' : 'Dates de la période'
                  }}</strong>
                  <small>Tous les repères de la période, classés par mois</small>
                </span>
                <span class="calendar-360-timeline-controls">
                  <span class="calendar-360-timeline-count"
                    >{{ summary().markers }} {{ isBpm ? 'événements' : 'dates' }}</span
                  >
                  <span class="calendar-360-timeline-closed">Afficher</span>
                  <span class="calendar-360-timeline-open">Masquer</span>
                  <span class="calendar-360-timeline-chevron" aria-hidden="true"></span>
                </span>
              </summary>
              <div class="calendar-360-timeline-body">
                @for (m of months(); track m.month) {
                  <section>
                    <h3>{{ monthName(m.month) }}</h3>
                    @for (event of m.events; track event.key) {
                      <div class="calendar-360-milestone" [attr.data-kind]="markerOf(event)">
                        <span>{{ date(event.date) }}</span>
                        <span>{{ elementLabel(event) }}</span>
                        <button
                          class="task-title-link"
                          type="button"
                          [disabled]="!event.link"
                          (click)="open(event)"
                        >
                          {{ event.title }}
                        </button>
                        <span class="status-pill" [attr.data-status]="event.status">{{
                          event.amountCents !== null
                            ? money(event.amountCents, event.direction)
                            : event.statusLabel
                        }}</span>
                      </div>
                    }
                  </section>
                } @empty {
                  <p>Aucun repère dans cette période.</p>
                }
              </div>
            </details>
          </div>
        </section>

        <rjs-calendar-space
          [calendar]="page.calendar"
          (loaded)="onLoaded($event.data, $event.period)"
          (displayedEventsChange)="displayedEvents.set($event)"
        >
          <section class="calendar-360-content" [attr.aria-label]="page.groupsTitle">
            <div class="calendar-360-section-title">
              <h2>{{ page.groupsTitle }}</h2>
              <span>{{ groups().length }}</span>
            </div>
            <div class="calendar-360-projects">
              @for (g of groups(); track g.label) {
                <article class="calendar-360-project">
                  <div class="calendar-360-project-head">
                    <div>
                      <span class="calendar-360-kicker">{{ page.groupKicker }}</span>
                      <h3>{{ g.label }}</h3>
                    </div>
                    <span class="status-pill"
                      >{{ g.events.length }}
                      {{ g.events.length === 1 ? 'repère' : 'repères' }}</span
                    >
                  </div>
                  <div class="calendar-360-meta">
                    <span
                      >Premier repère <strong>{{ date(g.events[0].date) }}</strong></span
                    >
                    <span
                      >Dernier repère
                      <strong>{{ date(g.events[g.events.length - 1].date) }}</strong></span
                    >
                    <span
                      >À suivre <strong>{{ open_(g.events) }}</strong></span
                    >
                    @if (groupNet(g.events); as net) {
                      <span
                        >{{ isBpm ? 'Écart des flux' : 'Solde' }}
                        <strong class="calendar-amount" [attr.data-direction]="net.direction">{{
                          net.text
                        }}</strong></span
                      >
                    }
                  </div>
                  <div class="calendar-360-task-list">
                    @for (event of g.events; track event.key) {
                      <div
                        class="calendar-360-task calendar-module-task"
                        [class.is-done]="event.done"
                      >
                        <div>
                          <button
                            type="button"
                            class="task-title-link"
                            [disabled]="!event.link"
                            (click)="open(event)"
                          >
                            {{ event.title }}
                          </button>
                          @if (event.details.length) {
                            <p>{{ detailLine(event) }}</p>
                          }
                        </div>
                        <span class="status-pill" [attr.data-status]="event.status">{{
                          event.statusLabel ?? (event.done ? 'Terminé' : 'À suivre')
                        }}</span>
                        <span>{{ date(event.date) }}</span>
                        <span>{{ elementLabel(event) }}</span>
                        <span class="calendar-amount" [attr.data-direction]="event.direction">{{
                          event.amountCents !== null
                            ? money(event.amountCents, event.direction)
                            : ''
                        }}</span>
                      </div>
                    }
                  </div>
                </article>
              } @empty {
                <div class="empty-state">
                  <h3>Aucun repère sur cette période</h3>
                  <p>
                    Avancez dans le calendrier, choisissez une autre vue, ou affichez d’autres
                    éléments.
                  </p>
                </div>
              }
            </div>
          </section>
        </rjs-calendar-space>
      </div>
    </div>
  `,
})
export class CalendarPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly page = this.route.snapshot.data as CalendarPageData;
  protected readonly isBpm = this.page.calendar === 'budgetPatrimoine';
  protected readonly displayedEvents = signal<CalendarEvent[] | null>(null);
  protected readonly data = signal<CalendarData | null>(null);
  protected readonly period = signal<CalendarPeriod | null>(null);

  protected readonly bounds = computed(() => {
    const p = this.period();
    return p ? periodBounds(p.day, p.view) : { start: '', end: '' };
  });
  /** Repères de la période affichée (la fenêtre lue peut déborder sur les mois voisins). */
  private readonly events = computed(() => {
    const p = this.period();
    const source = this.isBpm ? (this.displayedEvents() ?? []) : (this.data()?.events ?? []);
    return p ? source.filter((e) => inPeriod(e.date, p.day, p.view)) : [];
  });
  protected readonly summary = computed(() =>
    periodSummary(this.events(), this.data()?.elements ?? []),
  );
  protected readonly naturesShown = computed(() => this.summary().natures.slice(0, 3));
  protected readonly groups = computed(() => groupsOf(this.events()));
  protected readonly months = computed(() => {
    const out = new Map<string, CalendarEvent[]>();
    for (const e of this.events()) {
      const m = e.date.slice(0, 7);
      if (!out.has(m)) out.set(m, []);
      out.get(m)!.push(e);
    }
    return [...out].map(([month, events]) => ({ month, events }));
  });
  private readonly elementsById = computed(
    () => new Map((this.data()?.elements ?? []).map((el) => [el.id, el])),
  );

  protected onLoaded(data: CalendarData, period: CalendarPeriod) {
    this.data.set(data);
    this.period.set(period);
  }
  protected date(day: string) {
    return day ? DATE_FORMAT.format(new Date(day + 'T12:00:00Z')) : '';
  }
  protected monthName(month: string) {
    return monthLabel(month);
  }
  protected money(cents: number, direction: CalendarEvent['direction']) {
    return formatAmount(cents, direction);
  }
  protected elementLabel(event: CalendarEvent) {
    return this.elementsById().get(event.element)?.label ?? '';
  }
  protected markerOf(event: CalendarEvent) {
    return this.elementsById().get(event.element)?.marker ?? 'point';
  }
  protected open_(events: CalendarEvent[]) {
    return events.filter((e) => !e.done).length;
  }
  protected groupNet(events: CalendarEvent[]) {
    const flows = events.filter((e) => e.direction && e.amountCents !== null);
    if (!flows.length) return null;
    const net = flows.reduce(
      (s, e) => s + (e.direction === 'entree' ? 1 : -1) * (e.amountCents ?? 0),
      0,
    );
    const direction = net < 0 ? 'sortie' : 'entree';
    return { text: formatAmount(net, direction), direction };
  }
  protected detailLine(event: CalendarEvent) {
    return event.details.map((d) => `${d.label} : ${d.value}`).join(' · ');
  }
  protected open(event: CalendarEvent) {
    if (event.link) void this.router.navigateByUrl(event.link);
  }
}
