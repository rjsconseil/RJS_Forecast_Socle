import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { injectPageWorkspace } from '../plan/page-workspace';
import { injectPlanContext } from '../plan/plan-context';
import { FormsModule } from '@angular/forms';
import { PageBanner } from '../shared/page-banner.component';
import type { PageFocus } from '../shared/page-toolbar.component';
import { CalendarSpaceComponent } from './calendar-space.component';
import { CalendarData, CalendarEvent, CalendarPeriod } from './calendar.models';
import { formatAmount, groupsOf, periodSummary } from './calendar-model';
import { inPeriod, periodBounds } from './calendar-dates';

/** Textes d'une page de calendrier, donnés par la route : le code de la page est le même pour tous les modules. */
export interface CalendarPageData {
  calendar: string;
  eyebrow: string;
  title: string;
  emphasis: string;
  intro: string;
  groupsTitle: string;
  groupKicker: string;
  /** Présentation resserrée, quand l'application hôte porte déjà titre et commandes. */
  compactCalendar?: boolean;
  /** Calendriers dont la page propose les sources au branchement (la page décide, la personne choisit). */
  offer?: string[];
  /** Habillage choisi par l'hôte : classe ajoutée à la page et teinte (`data-tone`). */
  pageClass?: string;
  tone?: string;
}

/**
 * Événement DOM émis par la page quand la hauteur de son bloc « outils + grille » change : l'hôte peut
 * aligner ses propres colonnes dessus, sans que le calendrier connaisse l'hôte.
 */
export const CALENDAR_LAYOUT_EVENT = 'calendarlayout';
export interface CalendarLayoutDetail { toolsHeight: number | null }

const SETTINGS_ANCHOR = 'sources-et-affichage';

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
  imports: [CalendarSpaceComponent, FormsModule, PageBanner, RouterLink, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      /* Présentation resserrée : la page n'arrange que ses propres éléments ; le module arrange les siens. */
      .calendar-module-compact .calendar-360-top {
        container: calendar-compact / inline-size;
        gap: var(--host-gap, 10px);
        padding-block-start: 0;
      }
      .calendar-module-compact .calendar-360-section-title,
      .calendar-module-compact .calendar-360-section-title * {
        font-size: var(--section-title-size, 16px) !important;
      }
      rjs-page-banner, rjs-app-hero {
        min-width: 0;
        width: 100%;
        grid-column: 1 / -1;
      }
      .cal-header-filters {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: 12px 18px;
      }
      .cal-header-filters > label {
        display: flex;
        flex-direction: column;
        gap: 5px;
        min-width: 0;
        font-size: 12px;
        font-weight: 600;
      }
      .cal-header-filters :is(input[type='date'], select) {
        width: auto;
        max-width: 260px;
        min-width: 100px;
        padding: 9px 10px;
        border-radius: 7px;
        border: 1px solid #dbe4ed;
        color: #24364b;
        background: #fff;
        font: inherit;
      }
      .cal-header-paging {
        display: flex;
        align-items: center;
        gap: 6px;
        align-self: end;
        min-height: 42px;
      }
      .cal-header-paging > span {
        min-width: 100px;
        text-align: center;
        font-weight: 650;
      }
      .cal-header-filters > .cal-header-completed {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 8px;
        align-self: end;
        min-height: 42px;
      }
      .cal-header-completed input {
        width: 20px;
        min-height: 20px;
        height: 20px;
      }
      /* Présentation compacte (calendrier dans une application) : commandes resserrées. */
      .cal-header-paging.is-compact { align-self: center; min-height: 0; }
      .cal-header-paging.is-compact > span { min-width: 72px; font-size: 13px; }
      .cal-header-filters > .cal-header-completed.is-compact { align-self: auto; min-height: 28px; }
      .cal-header-completed.is-compact > input[type='checkbox'] { width: 16px; height: 16px; min-height: 0; max-width: 16px; margin: 0; accent-color: var(--host-accent, currentColor); }
    `,
  ],
  templateUrl: './calendar.page.html',
})
export class CalendarPage {
  /** Vues du calendrier, choisies d’un clic (mois par défaut). */
  protected readonly viewChoices = [
    { value: 'month', label: 'Mois' },
    { value: 'year', label: 'Année' },
    { value: 'week', label: 'Semaine' },
  ] as const;
  protected readonly workspace = injectPageWorkspace();
  protected readonly presentation = computed<'calendar' | 'agenda' | 'sources'>(() => this.workspace()?.key === 'calendar-agenda' ? 'agenda' : this.workspace()?.key === 'calendar-sources' ? 'sources' : 'calendar');
  protected readonly space = viewChild(CalendarSpaceComponent);
  protected readonly tools = computed(() => this.space()?.toolbarState());
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly page = this.route.snapshot.data as CalendarPageData;
  protected readonly compactCalendar = this.page.compactCalendar === true;
  /** Ancre du dépliant « Sources et affichage » : l'agenda y renvoie (`/calendrier-budget#sources-et-affichage`). */
  protected readonly settingsAnchor = SETTINGS_ANCHOR;
  /** Le volet « Sources et affichage » appartient au module : la page l'ouvre depuis son bandeau. */
  protected readonly settingsAvailable = computed(() => this.data()?.interaction?.access !== 'hidden');
  protected readonly completedAllowed = computed(() => this.settingsAvailable() && this.data()?.interaction?.controls.completed !== false);
  private readonly calendarTop = viewChild.required<ElementRef<HTMLElement>>('calendarTop');

  constructor() {
    if (this.compactCalendar && this.presentation() === 'calendar') {
      const destroy = inject(DestroyRef);
      afterNextRender(() => {
        const top = this.calendarTop().nativeElement;
        const frame = top.querySelector<HTMLElement>('.calendar-month-wrap');
        if (!frame || typeof ResizeObserver === 'undefined') return;
        const announce = (toolsHeight: number | null) =>
          top.dispatchEvent(new CustomEvent<CalendarLayoutDetail>(CALENDAR_LAYOUT_EVENT, { bubbles: true, detail: { toolsHeight } }));
        // En semaine, la grille suit ses événements : aucune hauteur à partager.
        const observer = new ResizeObserver(() => announce(top.querySelector('.calendar-layout.is-week') ? null : frame.getBoundingClientRect().bottom - top.getBoundingClientRect().top));
        observer.observe(top);
        observer.observe(frame);
        destroy.onDestroy(() => {
          observer.disconnect();
          announce(null);
        });
      });
    }
  }

  /** Le titre suit le menu : la page porte le nom sous lequel on l'a choisie. */
  private readonly plan = injectPlanContext();
  protected readonly planLabel = computed(() => this.plan().label);
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
    const source = this.displayedEvents() ?? [];
    return p ? source.filter((e) => inPeriod(e.date, p.day, p.view)) : [];
  });
  protected readonly readingScope = computed(() => {
    const tools = this.tools();
    const group =
      tools?.group === 'all'
        ? 'Tous les regroupements'
        : (tools?.groups.find((item) => item.key === tools.group)?.label ?? 'Regroupement courant');
    return `${group} · ${this.summary().markers} repère(s) · ${tools?.includeDone ? 'avec terminés' : 'à suivre'}`;
  });
  protected readonly priorityKey = signal<string | null>(null);
  /** Les priorités respectent les sources, le regroupement et la période réellement affichés. */
  protected readonly priorities = computed(() =>
    this.events()
      .filter((event) => !event.done && !!event.link)
      .sort(
        (a, b) =>
          Number(b.urgent === 'overdue') - Number(a.urgent === 'overdue') ||
          a.date.localeCompare(b.date) ||
          a.title.localeCompare(b.title, 'fr'),
      ),
  );
  protected readonly priority = computed(
    () =>
      this.priorities().find((event) => event.key === this.priorityKey()) ??
      this.priorities().at(0) ??
      null,
  );
  protected readonly focus = computed<PageFocus | null>(() => {
    if (this.tools()?.loading)
      return { title: 'Lecture de la période…', detail: this.tools()?.period, tone: 'info' };
    if (this.tools()?.error)
      return {
        title: 'Le calendrier n’a pas pu être actualisé',
        detail: this.tools()?.error ?? undefined,
        tone: 'warning',
      };
    if (this.presentation() === 'sources') return {
      title: 'Choisissez les sources et les informations utiles à votre lecture.',
      detail: 'Vos choix sont enregistrés pour votre profil et valent pour le calendrier comme pour l’agenda.',
      tone: 'info',
    };
    if (!this.data()) return null;
    const event = this.priority();
    if (!event)
      return {
        title: 'Aucun repère à suivre dans la sélection',
        detail: 'Changez de période, de sources ou de regroupement pour élargir votre lecture.',
        tone: 'info',
      };
    return {
      title: `${this.priorities().length} repère(s) à suivre · ${event.title}`,
      detail: `${this.date(event.date)}${event.groupLabel ? ' · ' + event.groupLabel : ''}${event.amountCents !== null ? ' · ' + this.money(event.amountCents, event.direction) : ''}`,
      tone: event.urgent === 'overdue' ? 'warning' : 'info',
    };
  });
  protected locatePriority() {
    const event = this.priority();
    if (event) this.space()?.focusEvent(event);
  }
  protected readonly summary = computed(() =>
    periodSummary(this.events(), this.data()?.elements ?? []),
  );
  protected readonly naturesShown = computed(() => this.summary().natures.slice(0, 3));
  protected readonly groups = computed(() => groupsOf(this.events()));
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
  protected money(cents: number, direction: CalendarEvent['direction']) {
    return formatAmount(cents, direction);
  }
  protected elementLabel(event: CalendarEvent) {
    return this.elementsById().get(event.element)?.label ?? '';
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
