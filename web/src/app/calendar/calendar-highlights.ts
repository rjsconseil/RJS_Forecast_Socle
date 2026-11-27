// Calendrier : mise en évidence des repères. Un repère survolé dans l'agenda est souligné le temps du survol ;
// un repère choisi (clic) reste en évidence dans la grille et dans l'agenda jusqu'à ce qu'on le retire.
import { computed, signal } from '@angular/core';
import { CalendarEvent } from './calendar.models';

export class CalendarHighlights {
  readonly hovered = signal<string | null>(null);
  readonly pinned = signal<ReadonlySet<string>>(new Set());
  private readonly keys = computed(() => {
    const keys = new Set(this.pinned());
    const hovered = this.hovered();
    if (hovered) keys.add(hovered);
    return keys;
  });

  /** `eventsOf` donne les repères d'un jour (ceux de la période affichée). */
  constructor(private readonly eventsOf: (day: string) => readonly CalendarEvent[]) {}

  isPinned(key: string) {
    return this.pinned().has(key);
  }
  isHighlighted(key: string) {
    return this.keys().has(key);
  }
  isDayHighlighted(day: string) {
    return this.eventsOf(day).some((e) => this.isHighlighted(e.key));
  }
  /** Nombre de repères du jour en évidence. */
  countIn(day: string) {
    return this.eventsOf(day).filter((e) => this.isHighlighted(e.key)).length;
  }
  toggle(key: string) {
    this.pinned.update((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    this.hovered.set(null);
  }
  only(key: string) {
    this.pinned.set(new Set([key]));
  }
  clear() {
    this.pinned.set(new Set());
    this.hovered.set(null);
  }
  /** Suit le repère survolé dans l'agenda : il est souligné, sans déplacer la liste en cours de lecture. */
  hover(key: string | null) {
    this.hovered.set(key);
  }
}
