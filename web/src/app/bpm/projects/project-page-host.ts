// Contrat entre la fiche projet et les morceaux de son gabarit sortis dans leurs propres composants : la page se fournit
// elle-même sous PROJECT_PAGE, et ces composants lisent son état et appellent ses gestes. Seuls les membres publics de
// la page leur sont accessibles (vérifié par strictTemplates).
import { InjectionToken } from '@angular/core';
import type { BpmProjectPage } from './project.page';

export const PROJECT_PAGE = new InjectionToken<BpmProjectPage>('Fiche projet');

/** Une tâche telle que la fiche projet l'affiche (carte, fenêtre de la tâche). */
export type ProjectTaskView = NonNullable<ReturnType<BpmProjectPage['openTask']>>;
