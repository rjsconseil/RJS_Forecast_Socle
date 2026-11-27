// Calendrier : replanification d'un repère, par la saisie « Replanifier » ou par glisser-déposer sur un jour.
// La saisie en cours est gardée dans l'adresse (`calPlan`, `calDate`) : elle survit au retour arrière et au
// rechargement. À créer dans un contexte d'injection (champ du composant) : la lecture de l'adresse est un effet.
import { afterNextRender, effect, Injector, Signal, signal, untracked } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { validDate } from './calendar-dates';
import { CalendarData, CalendarEvent } from './calendar.models';

/** Ce que la replanification lit du composant. */
export interface PlannerHost {
  readonly router: Router;
  readonly route: ActivatedRoute;
  readonly injector: Injector;
  readonly element: HTMLElement;
  readonly params: Signal<ParamMap>;
  data(): CalendarData | null;
  busy(): boolean;
  reschedule(event: CalendarEvent, date: string): void;
}

export class CalendarPlanner {
  /** Repère en cours de replanification. */
  readonly planning = signal<CalendarEvent | null>(null);
  plannedDate = '';
  /** Repère en cours de glisser-déposer. */
  dragged: CalendarEvent | null = null;

  constructor(private readonly host: PlannerHost) {
    effect(() => {
      const params = host.params();
      const data = host.data();
      const key = params.get('calPlan');
      untracked(() => {
        if (!key) { this.planning.set(null); return; }
        const event = data?.events.find(event => event.key === key);
        if (event) this.planning.set(event);
        if (params.has('calDate')) this.plannedDate = params.get('calDate')!;
      });
    });
  }

  plan(event: CalendarEvent) {
    this.planning.set(event);
    this.plannedDate = event.date;
    void this.host.router.navigate([], { relativeTo: this.host.route, queryParams: { calPlan: event.key, calDate: event.date }, queryParamsHandling: 'merge' });
    afterNextRender(() => {
      const field = this.host.element.querySelector<HTMLInputElement>('.calendar-plan input');
      field?.closest('form')?.scrollIntoView?.({ block: 'center' });
      field?.focus({ preventScroll: true });
    }, { injector: this.host.injector });
  }
  changeDate(date: string) {
    this.plannedDate = date;
    void this.host.router.navigate([], { relativeTo: this.host.route, queryParams: { calDate: date }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  /** La saisie quitte le parcours après la réussite, ou sur annulation explicite. */
  finish() {
    this.planning.set(null);
    void this.host.router.navigate([], { relativeTo: this.host.route, queryParams: { calPlan: null, calDate: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  save() {
    const event = this.planning();
    if (this.host.busy() || !event || !validDate(this.plannedDate) || this.plannedDate === event.date) return;
    this.host.reschedule(event, this.plannedDate);
  }
  drag(event: DragEvent, entry: CalendarEvent) {
    if (!entry.reschedule || this.host.busy()) {
      event.preventDefault();
      return;
    }
    this.dragged = entry;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', entry.key);
    }
  }
  allowDrop(event: DragEvent) {
    if (this.dragged && !this.host.busy()) event.preventDefault();
  }
  drop(event: DragEvent, day: string) {
    event.preventDefault();
    const entry = this.dragged;
    this.dragged = null;
    if (entry && !this.host.busy() && entry.date !== day) this.host.reschedule(entry, day);
  }
}
