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
