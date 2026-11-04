/**
 * Dates du calendrier miniature, reprises de la référence (`shared/calendar.ts` de rjsconseil/rjs-forecast).
 * Toutes les dates sont des chaînes AAAA-MM-JJ calculées à midi UTC : aucun décalage de fuseau ne change le jour.
 */

export type CalendarView = 'year' | 'month' | 'week';

/** Créneau de lecture : bornes incluses, sans effet sur les dates source. */
export interface CalendarRange {
  start: string;
  end: string;
}

/** Le jour local de l'utilisateur (comme `today()` de la référence). */
export function localToday(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function validDate(value: string | null | undefined): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T12:00:00Z')) &&
    new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value
  );
}

export function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function shiftDate(value: string, days: number): string {
  const date = new Date(value + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

export function shiftMonth(month: string, step: number): string {
  const date = new Date(month + '-01T12:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + step);
  return date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999 ? month : dateKey(date).slice(0, 7);
}

/** Les 42 jours (6 semaines, du lundi au dimanche) qui couvrent le mois. */
export function monthDays(month: string): string[] {
  const first = month + '-01';
  const offset = (new Date(first + 'T12:00:00Z').getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => shiftDate(first, i - offset));
}

/** Les 7 jours de la semaine (lundi → dimanche) qui contient le jour. */
export function weekDays(day: string): string[] {
  const offset = (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => shiftDate(day, i - offset));
}

export function yearMonths(day: string): { key: string; days: string[] }[] {
  const year = day.slice(0, 4);
  return Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
    return { key, days: monthDays(key) };
  });
}

export function shiftPeriod(day: string, view: CalendarView, step: number): string {
  if (view === 'week') {
    const shifted = shiftDate(weekDays(day)[0], step * 7);
    return validDate(shifted) ? shifted : day;
  }
  if (view === 'year') {
    const year = Number(day.slice(0, 4)) + step;
    return year >= 1 && year <= 9999 ? `${String(year).padStart(4, '0')}-01-01` : day;
  }
  const month = shiftMonth(day.slice(0, 7), step);
  return month === day.slice(0, 7) && step !== 0 ? day : `${month}-01`;
}

/** « Nov. 2026 », « 2026 » ou « Semaine du 2 nov. au 8 nov. ». */
export function periodLabel(day: string, view: CalendarView): string {
  if (view === 'year') return day.slice(0, 4);
  if (view === 'month') {
    const label = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(day.slice(0, 7) + '-01T12:00:00Z'),
    );
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  const days = weekDays(day);
  const formatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `Semaine du ${formatter.format(new Date(days[0] + 'T12:00:00Z'))} au ${formatter.format(new Date(days[6] + 'T12:00:00Z'))}`;
}

export function monthTitle(month: string): string {
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', timeZone: 'UTC' }).format(new Date(month + '-01T12:00:00Z'));
}

/** Un créneau lu dans l'URL : deux dates valides et ordonnées, sinon aucun créneau. */
export function rangeFrom(start: string | null, end: string | null): CalendarRange | null {
  return validDate(start) && validDate(end) && start <= end ? { start, end } : null;
}

/**
 * Règle de la référence (`inPlanningRange`) : sans créneau tout est visible ; avec un créneau, seul un élément
 * dont la date de démarrage est comprise entre les bornes (incluses) l'est. Un élément sans date est masqué.
 */
export function inRange(date: string | null | undefined, range: CalendarRange | null): boolean {
  return !range || Boolean(date && date >= range.start && date <= range.end);
}

/** Premier et dernier jour de la période affichée (semaine, mois civil, année civile). */
export function periodBounds(day: string, view: CalendarView): CalendarRange {
  if (view === 'year') return { start: `${day.slice(0, 4)}-01-01`, end: `${day.slice(0, 4)}-12-31` };
  if (view === 'week') {
    const days = weekDays(day);
    return { start: days[0], end: days[6] };
  }
  const month = day.slice(0, 7);
  const last = new Date(`${month}-01T12:00:00Z`);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  return { start: `${month}-01`, end: dateKey(last) };
}

/** Jours dessinés par la vue : la semaine, les six semaines de la grille du mois, ou l'année. */
export function gridWindow(day: string, view: CalendarView): CalendarRange {
  if (view === 'month') {
    const days = monthDays(day.slice(0, 7));
    return { start: days[0], end: days[days.length - 1] };
  }
  return periodBounds(day, view);
}

export function inPeriod(date: string, day: string, view: CalendarView): boolean {
  const { start, end } = periodBounds(day, view);
  return date >= start && date <= end;
}

/** « Novembre 2026 ». */
export function monthLabel(month: string): string {
  const label = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(month + '-01T12:00:00Z'));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export interface DayPeekGeometry {
  day: { left: number; top: number; bottom: number; width: number };
  calendarTop: number;
  viewportWidth: number;
  viewportHeight: number;
  textScale: number;
  side: -1 | 1;
  topGap: number;
  lateralShiftRatio: number;
}

export interface DayPeekPosition {
  x: number | null;
  top: number | null;
  maxHeight: number | null;
  bridgeHeight: number | null;
}

/** Place l'aperçu d'une journée sans déplacer sa case (référence `positionDayPeek`). */
export function positionDayPeek({ day, calendarTop, viewportWidth, viewportHeight, textScale, side, topGap, lateralShiftRatio }: DayPeekGeometry): DayPeekPosition {
  const margin = 12;
  const overlap = 10;
  const halfWidth = Math.min((420 * textScale) / 2, (viewportWidth - 2 * margin) / 2);
  const x = Math.min(viewportWidth - margin - halfWidth, Math.max(margin + halfWidth, day.left + day.width / 2 + side * Math.min(28, day.width * lateralShiftRatio)));
  const standardHeight = Math.min(360 * textScale, viewportHeight - 2 * margin);
  const preferredTop = day.top - topGap - standardHeight;
  const top = preferredTop >= Math.max(margin, calendarTop) ? preferredTop : day.bottom - overlap;
  const maxHeight = Math.max(80, viewportHeight - top - margin);
  const bridgeHeight = Math.min(maxHeight, standardHeight + (topGap > 0 && top === preferredTop ? topGap + overlap : 0));
  return { x, top, maxHeight, bridgeHeight };
}
