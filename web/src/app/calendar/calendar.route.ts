/**
 * La page calendrier et sa feuille de style arrivent ensemble. Les styles du calendrier ne servent
 * qu'à ses pages : ils forment une feuille à part (`calendar.css`), hors du chargement initial du site.
 */
let styles: Promise<void> | null = null;

/** Insère `calendar.css` à sa place dans la cascade : après la base du site, avant ses habillages. */
export function loadCalendarStyles(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  return (styles ??= new Promise<void>((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'calendar.css';
    // Une feuille indisponible ne bloque pas la page : elle s'affiche, et un prochain passage réessaiera.
    link.onload = () => resolve();
    link.onerror = () => { styles = null; link.remove(); resolve(); };
    const rest = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href*="styles-rest"]');
    if (rest) rest.before(link);
    else document.head.append(link);
  }));
}

export const loadCalendarPage = () =>
  Promise.all([import('./calendar.page'), loadCalendarStyles()]).then(([module]) => module.CalendarPage);
