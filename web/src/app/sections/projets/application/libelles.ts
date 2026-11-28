import type { Priority, ProjectStatus, TaskStatus } from '../../../platform/grand-noyau';
import type { Health } from '../fonctionnalites/portfolio';

/**
 * Libellés anglais de l'application autonome Mes projets (PRINCE2 est né en anglais). Les fonctionnalités partagées avec
 * la page Pilotage de BPM-Astra gardent leurs libellés français ; l'application lit leurs codes et les nomme ici.
 */
export const PROJECT_STATUS: Record<ProjectStatus, string> = {
  planned: 'To do', active: 'In progress', paused: 'To prioritize', onHold: 'On hold', toResume: 'To resume', toFinish: 'To finish', done: 'Done',
};
export const TASK_STATUS: Record<TaskStatus, string> = { todo: 'To do', doing: 'In progress', blocked: 'To prioritize', done: 'Done' };
export const HEALTH: Record<Health, string> = { done: 'Done', late: 'Late', watch: 'Watch', ok: 'On track', idle: 'Not started' };
export const PRIORITY: Record<Priority, string> = { high: 'High', medium: 'Medium', low: 'Low' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** « 27 Nov 2026 » pour une date ISO (AAAA-MM-JJ…). */
export function dateEn(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
}
/** « 4.5 h » ; un tiret sans valeur. */
export const hoursEn = (h: number | null | undefined) => (h === null || h === undefined ? '—' : `${Math.round(h * 10) / 10} h`);
/** « 3 tasks », « 1 task ». */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
