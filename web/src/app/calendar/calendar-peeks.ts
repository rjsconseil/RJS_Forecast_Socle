// Calendrier : aperçus d'un jour au survol, au focus ou épinglés — grille du mois et de la semaine (`MonthPeek`),
// vue annuelle (`YearPeek`). Le composant garde les mêmes noms pour son gabarit ; ces classes portent l'état
// (jour survolé, focalisé, épinglé, déplié), le côté d'ouverture suivant le geste et le placement à l'écran.
import { computed, signal } from '@angular/core';
import { CalendarView, DayPeekPosition, positionDayPeek } from './calendar-dates';

/** Ce que les aperçus lisent du composant. */
export interface PeekHost {
  hasDay(day: string): boolean;
  selectDay(day: string): void;
  closeDelay(): number;
  view(): CalendarView;
  closeDetails(): void;
  /** Dernière position connue du pointeur (partagée par les deux aperçus). */
  pointer: { at: { x: number; y: number } | null };
}

/**
 * Haut utilisable pour un aperçu : sous le haut de la grille et sous tout bandeau resté fixé en haut de
 * l'écran (bandeau de page figé, barre du site), pour qu'un aperçu ne passe jamais dessous.
 */
export function safeTop(target: HTMLElement): number {
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

export class MonthPeek {
  constructor(private host: PeekHost) {}

  /** Oublie le geste en cours (changement de vue). */
  resetGesture() {
    this.monthPointerStart = null;
    this.monthPeekSideLocked = false;
  }

  readonly expandedDay = signal<string | null>(null);
  readonly hoveredMonthDay = signal<string | null>(null);
  readonly focusedMonthDay = signal<string | null>(null);
  readonly pinnedMonthDay = signal<string | null>(null);
  readonly monthPeekPosition = signal<DayPeekPosition>({
    x: 0,
    top: 0,
    maxHeight: 0,
    bridgeHeight: 0,
  });
  readonly visibleMonthDay = computed(
    () => this.pinnedMonthDay() ?? this.hoveredMonthDay() ?? this.focusedMonthDay(),
  );
  private monthPointerStart: { day: string; x: number; y: number } | null = null;
  monthPeekSide: -1 | 1 = 1;
  private monthPeekSideLocked = false;
  private monthPeekCloseTimer: ReturnType<typeof setTimeout> | null = null;

  toggleDayExpansion(day: string, event: MouseEvent) {
    event.stopPropagation();
    const target = event.currentTarget;
    if (target instanceof HTMLElement)
      this.setGridDayPin(day, target.closest('.calendar-day') as HTMLElement, true);
    this.expandedDay.set(day);
  }
  enterMonthDay(day: string, event: PointerEvent) {
    if (!this.host.hasDay(day)) return;
    this.host.pointer.at = { x: event.clientX, y: event.clientY };
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
  orientMonthPeek(day: string, event: PointerEvent) {
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
  leaveMonthDay(day: string) {
    this.scheduleMonthPeekClose(day);
  }
  toggleMonthPeekPin(day: string, event: MouseEvent) {
    if (!this.host.hasDay(day)) return;
    const target = event.target;
    if (
      !(target instanceof Element) ||
      target.closest('.calendar-day-peek, .calendar-more, .calendar-event, .calendar-day-number')
    )
      return;
    if (event.currentTarget instanceof HTMLElement) this.setGridDayPin(day, event.currentTarget);
  }
  setGridDayPin(day: string, target: HTMLElement | null, keep = false) {
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
  cancelMonthPeekClose() {
    if (this.monthPeekCloseTimer !== null) clearTimeout(this.monthPeekCloseTimer);
    this.monthPeekCloseTimer = null;
  }
  scheduleMonthPeekClose(day: string) {
    this.cancelMonthPeekClose();
    this.monthPeekCloseTimer = setTimeout(() => this.closeMonthDay(day), this.host.closeDelay());
  }
  private closeMonthDay(day: string) {
    this.cancelMonthPeekClose();
    const point = this.host.pointer.at;
    const under = point ? document.elementFromPoint(point.x, point.y) : null;
    if (under?.closest('.calendar-day')?.getAttribute('data-day') === day) return;
    if (this.hoveredMonthDay() === day) this.hoveredMonthDay.set(null);
    if (this.focusedMonthDay() === day) this.focusedMonthDay.set(null);
    if (this.expandedDay() === day && this.pinnedMonthDay() !== day) this.expandedDay.set(null);
    if (this.monthPointerStart?.day === day) this.monthPointerStart = null;
    this.monthPeekSideLocked = false;
    this.host.closeDetails();
  }
  focusMonthDay(day: string, event: FocusEvent) {
    if (!this.host.hasDay(day)) return;
    this.focusedMonthDay.set(day);
    if (this.pinnedMonthDay()) return;
    this.positionMonthPeek(event.currentTarget, this.monthPeekSide);
  }
  clearMonthDayFocus(event: FocusEvent) {
    const current = event.currentTarget;
    if (
      current instanceof Element &&
      event.relatedTarget instanceof Node &&
      current.contains(event.relatedTarget)
    )
      return;
    this.focusedMonthDay.set(null);
  }
  positionMonthPeek(target: EventTarget | null, side: -1 | 1) {
    if (!(target instanceof HTMLElement)) return;
    if (window.innerWidth <= 900) {
      this.monthPeekPosition.set({ x: null, top: null, maxHeight: null, bridgeHeight: null });
      return;
    }
    const scale = Number.parseFloat(getComputedStyle(target).getPropertyValue('--text-scale')) || 1;
    this.monthPeekPosition.set(
      positionDayPeek({
        day: target.getBoundingClientRect(),
        calendarTop: safeTop(target),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        textScale: scale,
        side,
        topGap: this.host.view() === 'month' ? 16 : -10,
        lateralShiftRatio: 0.2,
      }),
    );
  }
}

export class YearPeek {
  constructor(private host: PeekHost) {}

  /** Oublie le geste en cours (changement de vue). */
  resetGesture() {
    this.yearPointerStart = null;
    this.yearPeekSideLocked = false;
  }

  readonly hoveredYearDay = signal<string | null>(null);
  readonly focusedYearDay = signal<string | null>(null);
  readonly pinnedYearDay = signal<string | null>(null);
  readonly expandedYearPeekDay = signal<string | null>(null);
  readonly yearPeekPosition = signal<DayPeekPosition>({
    x: 0,
    top: 0,
    maxHeight: 0,
    bridgeHeight: 0,
  });
  private yearPeekCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private yearPointerStart: { day: string; x: number; y: number } | null = null;
  private yearPeekSide: -1 | 1 = 1;
  private yearPeekSideLocked = false;
  readonly visibleYearDay = computed(() => {
    const day = this.pinnedYearDay() ?? this.hoveredYearDay() ?? this.focusedYearDay();
    return day && this.host.hasDay(day) ? day : null;
  });

  toggleYearDay(day: string, event: MouseEvent) {
    if (!this.host.hasDay(day)) return;
    this.cancelYearPeekClose();
    const wasPinned = this.pinnedYearDay() === day;
    if (event.currentTarget instanceof HTMLElement) this.setYearPeekPosition(event.currentTarget);
    this.host.selectDay(day);
    this.pinnedYearDay.set(wasPinned ? null : day);
    this.expandedYearPeekDay.set(null);
    this.focusedYearDay.set(day);
  }
  enterYearDay(day: string, event: PointerEvent) {
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
  orientYearPeek(day: string, event: PointerEvent) {
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
  leaveYearDay(day: string) {
    if (this.hoveredYearDay() === day) this.scheduleYearPeekClose();
  }
  positionYearPeekOnFocus(event: FocusEvent) {
    if (event.currentTarget instanceof HTMLElement && !this.pinnedYearDay())
      this.setYearPeekPosition(event.currentTarget);
  }
  setYearPeekPosition(target: HTMLElement) {
    if (window.innerWidth <= 900) {
      this.yearPeekPosition.set({ x: null, top: null, maxHeight: null, bridgeHeight: null });
      return;
    }
    const scale = Number.parseFloat(getComputedStyle(target).getPropertyValue('--text-scale')) || 1;
    this.yearPeekPosition.set(
      positionDayPeek({
        day: target.getBoundingClientRect(),
        calendarTop: safeTop(target),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        textScale: scale,
        side: this.yearPeekSide,
        topGap: 16,
        lateralShiftRatio: 0.7,
      }),
    );
  }
  clearYearDayFocus(event: FocusEvent) {
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
  cancelYearPeekClose() {
    if (this.yearPeekCloseTimer !== null) clearTimeout(this.yearPeekCloseTimer);
    this.yearPeekCloseTimer = null;
  }
  scheduleYearPeekClose(day = this.visibleYearDay()) {
    this.cancelYearPeekClose();
    this.yearPeekCloseTimer = setTimeout(() => this.closeYearDay(day), this.host.closeDelay());
  }
  private closeYearDay(day: string | null) {
    this.cancelYearPeekClose();
    if (!day) return;
    const point = this.host.pointer.at;
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
    this.host.closeDetails();
  }
}
