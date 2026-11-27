// Calendrier : règles pures de la grille (déplacement au clavier, cible du focus, placement du détail d'un
// indicateur). Le composant applique ces règles au DOM ; elles se testent sans lui.
import { CalendarView, shiftDate, validDate } from './calendar-dates';

/** Pas de déplacement d'une flèche du clavier, en jours (une ligne de la grille = 7 jours). */
export const ARROW_STEPS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/**
 * Jour atteint par une flèche depuis `day`. Dans la vue annuelle, seuls les jours qui portent des repères
 * (`eventDays`) sont des étapes : la flèche saute au prochain dans son sens. `undefined` : rien à faire.
 */
export function arrowTarget(key: string, day: string, view: CalendarView, eventDays: () => Iterable<string>): string | undefined {
  const step = ARROW_STEPS[key];
  if (!step) return undefined;
  let next: string | undefined;
  if (view === 'year') {
    const dates = [...eventDays()].sort();
    const threshold = shiftDate(day, step);
    next = step > 0 ? dates.find((d) => d >= threshold) : dates.reverse().find((d) => d <= threshold);
  } else next = shiftDate(day, step);
  return next && validDate(next) ? next : undefined;
}

/** Élément qui reçoit le focus pour un jour : la case de l'année, ou le numéro du jour dans la grille. */
export function daySelector(view: CalendarView, day: string) {
  return view === 'year' ? `.calendar-year-day[data-day="${day}"]` : `.calendar-day[data-day="${day}"] .calendar-day-number`;
}

/** Case de repli quand le jour choisi n'est pas affiché. */
export function fallbackDaySelector(view: CalendarView) {
  return view === 'year' ? '.calendar-year-day.has-events' : '.calendar-day-number';
}

/**
 * Placement de la fenêtre de détail d'un indicateur, à côté de l'aperçu du jour : à droite s'il y a la
 * place, sinon à gauche ; jamais hors de l'écran. La largeur suit l'échelle du texte (`scale`).
 */
export function peekDetailsPlacement(
  peek: { left: number; right: number; top: number },
  scale: number,
  viewport: { width: number; height: number },
) {
  const margin = 12;
  const gap = 10;
  const width = Math.min(340 * scale, viewport.width - 2 * margin);
  const left = peek.right + gap + width + margin <= viewport.width ? peek.right + gap : Math.max(margin, peek.left - gap - width);
  const top = Math.max(margin, Math.min(peek.top, viewport.height - 220));
  return { left, top, maxHeight: viewport.height - top - margin };
}
