/** La page calendrier : ses styles font partie de la feuille globale du site (`styles.scss`). */
export const loadCalendarPage = () => import('./calendar.page').then((module) => module.CalendarPage);
