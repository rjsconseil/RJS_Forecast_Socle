/**
 * Fonctionnalités Mes projets · gestion de base des projets et des tâches, sur les lectures et commandes du grand noyau
 * (projets, tâches, rattachement, états). Calculs purs et préparation des commandes, sans écran : une brique
 * réutilisable par l'application autonome Mes projets comme par une application hybride.
 * L'état d'un projet se déduit toujours de ses tâches, dans le grand noyau : rien n'est recalculé ici.
 */
import { newRequestKey, type Priority, type ProjectStatus, type ProjectSummary, type TaskView } from '../../../platform/grand-noyau';
import { isWorkProject } from './portfolio';

/** Les états d'un projet, dans l'ordre de lecture (du prévu au terminé). */
export const PROJECT_STATUS_ORDER: ProjectStatus[] = ['planned', 'active', 'toResume', 'paused', 'onHold', 'toFinish', 'done'];

/** Les projets à mener (le projet de vie, racine du budget, est écarté), regroupés par état. */
export function projetsParStatut(projects: ProjectSummary[]) {
  const work = projects.filter(isWorkProject);
  return PROJECT_STATUS_ORDER
    .map((status) => {
      const list = work.filter((p) => p.view.status === status);
      return { status, label: list[0]?.view.statusLabel ?? status, projets: list.sort((a, b) => a.project.title.localeCompare(b.project.title)) };
    })
    .filter((g) => g.projets.length);
}

/** Les tâches qui ne sont rattachées à aucun projet, les plus récentes d'abord. */
export const tachesSansProjet = (tasks: TaskView[]) =>
  tasks.filter((t) => !t.task.projectId).sort((a, b) => b.task.createdAt.localeCompare(a.task.createdAt) || a.task.title.localeCompare(b.task.title));

/** Les tâches d'un projet, par titre. */
export const tachesDuProjet = (tasks: TaskView[], projectId: string) =>
  tasks.filter((t) => t.task.projectId === projectId).sort((a, b) => a.task.title.localeCompare(b.task.title));

export interface SaisieProjet { title: string; description?: string; priority?: Priority; startDate?: string; dueDate?: string }
export interface SaisieTache { title: string; projectId?: string; plannedHours?: string | number | null; dueDate?: string }

const empty = (v: string | undefined | null) => !v || !String(v).trim();

/** Ce qui empêche d'envoyer la saisie, avant même le grand noyau (qui garde ses propres règles et refus). */
export function erreurSaisie(s: { title: string; startDate?: string; dueDate?: string }): string | null {
  if (empty(s.title)) return 'Enter a title.';
  if (!empty(s.startDate) && !empty(s.dueDate) && s.startDate! > s.dueDate!) return 'The due date must come after the start date.';
  return null;
}

/** Corps de la commande « créer un projet » du grand noyau. */
export function commandeProjet(s: SaisieProjet, requestKey = newRequestKey()) {
  return {
    requestKey,
    title: s.title.trim(),
    description: s.description?.trim() ?? '',
    priority: s.priority ?? 'medium',
    startDate: empty(s.startDate) ? null : s.startDate,
    dueDate: empty(s.dueDate) ? null : s.dueDate,
  };
}

/** Corps de la commande « créer une tâche » du grand noyau, seule ou déjà rattachée à un projet. */
export function commandeTache(s: SaisieTache, requestKey = newRequestKey()) {
  const hours = s.plannedHours === null || s.plannedHours === undefined || String(s.plannedHours).trim() === '' ? null : Number(String(s.plannedHours).replace(',', '.'));
  return {
    requestKey,
    title: s.title.trim(),
    projectId: empty(s.projectId) ? null : s.projectId,
    plannedHours: hours !== null && Number.isFinite(hours) ? hours : null,
    dueDate: empty(s.dueDate) ? null : s.dueDate,
  };
}
