// Fiche projet : la phrase de tête (focus) et le libellé de la prochaine action, tirés de la lecture du projet.
// Fonctions pures : la page leur passe ce qu'elle a déjà calculé (sélection, décisions, prochain règlement, tâche).
import { cents, shortDate } from '../../core/format';
import { BpmPageFocus } from '../ui';
import { BpmProjectDetail, BpmTaskCard, ProjectChargeLine } from '../data/bpm-projects.models';
import { displayDate } from '../../projects/workspace-parts';

export interface ProjectFocusInput {
  data: BpmProjectDetail | null;
  error: string | null;
  hasSelection: boolean;
  visibleCount: number;
  pendingCount: number;
  nextCharge: ProjectChargeLine | null;
  nextTask: BpmTaskCard | null;
  isLate: (t: BpmTaskCard) => boolean;
  doneCount: number;
}

/** Libellé de l'action principale de la fiche (« Attribuer l’enveloppe », « Préparer le prochain règlement »…). */
export function projectNextActionLabel(s: ProjectFocusInput): string {
  const d = s.data;
  if (d?.budget?.abandoned) return 'Reprendre le projet';
  if (!d?.budget?.regime) return 'Attribuer l’enveloppe';
  if (s.pendingCount)
    return 'Accorder ou refuser les financements';
  if (s.nextCharge) return 'Préparer le prochain règlement';
  if (s.hasSelection && !s.visibleCount) return 'Réinitialiser la sélection';
  const t = s.nextTask;
  if (t?.task.status === 'blocked') return 'Revoir une tâche bloquée';
  if (t && s.isLate(t)) return 'Revoir une tâche en retard';
  if (t?.task.status === 'done') return 'Libérer une part non consommée';
  if (t) return 'Poursuivre une tâche';
  return d?.tasks.length ? 'Vérifier la fin de cycle' : 'Créer la première tâche';
  }

/** Phrase de tête de la fiche : la situation la plus urgente du projet, sinon son avancement. */
export function projectPageFocus(s: ProjectFocusInput): BpmPageFocus {
  const d = s.data;
  if (!d) return { title: 'Lecture du projet…', tone: 'info' };
  if (s.error)
    return { title: 'L’actualisation du projet a échoué', detail: s.error, tone: 'danger' };
  const gone = d.budget?.abandoned;
  if (gone)
    return {
      title: `Projet abandonné le ${shortDate(gone.at)}${gone.reason ? ` · ${gone.reason}` : ''}`,
      detail: gone.releasedCents
        ? `${cents(gone.releasedCents)} sont revenus au budget de vie ; l’enveloppe garde ${cents(gone.allocationAfterCents ?? 0)}, ce qui a été réglé. Reprenez le projet pour y saisir de nouveau.`
        : 'Ses dépenses réglées restent dans son historique. Reprenez le projet pour y saisir de nouveau.',
      tone: 'info',
    };
  if (d.role === 'standard' && !d.budget?.regime)
    return {
      title: 'L’enveloppe de ce projet reste à attribuer',
      detail:
        'Attribuez un budget avant d’accorder les demandes des tâches. Les règlements sans enveloppe restent hors budget du projet de vie.',
      tone: 'warning',
    };
  if (d.role === 'standard' && s.hasSelection && !s.visibleCount)
    return { title: 'Aucune tâche ne correspond à cette sélection', detail: 'Adaptez la recherche et la priorité de suivi pour retrouver les tâches du projet.', tone: 'info' };
  const decisions = s.pendingCount;
  if (decisions)
    return {
      title: `${decisions} décision(s) de financement en attente`,
      detail:
        'Accordez les montants des tâches et les autorisations nécessaires avant de poursuivre.',
      tone: 'warning',
    };
  if (d.role === 'life')
    return {
      title: `${d.life?.fundedCount ?? 0} projet(s) avec une enveloppe`,
      detail:
        'Gérez les ressources, les échéances et le financement des projets dans la vision du projet de vie.',
      tone: 'info',
    };
  const charge = s.nextCharge;
  if (charge)
    return {
      title: `Règlement à préparer : ${charge.label}`,
      detail: `${cents(charge.plannedCents)} prévus le ${displayDate(charge.plannedDate)}. Validez seulement après le paiement réel.`,
      tone: 'warning',
    };
  const task = s.nextTask;
  if (task?.task.status === 'blocked')
    return {
      title: `Tâche bloquée : ${task.task.title}`,
      detail: 'Ouvrez la tâche pour revoir sa planification, son budget et son statut.',
      tone: 'warning',
    };
  if (task && s.isLate(task))
    return {
      title: `Échéance dépassée : ${task.task.title}`,
      detail: 'Vérifiez son avancement ou ajustez sa date depuis la tâche.',
      tone: 'warning',
    };
  if (task?.task.status === 'done')
    return {
      title: `${cents(task.budget?.unusedCents ?? 0)} peuvent revenir à l’enveloppe`,
      detail: `« ${task.task.title} » est terminée ; vérifiez les règlements puis libérez sa part inutilisée.`,
      tone: 'info',
    };
  if (!d.tasks.length)
    return {
      title: 'L’enveloppe est attribuée ; préparez la première tâche',
      detail: 'Créez une tâche ou rattachez-en une depuis les outils.',
      tone: 'info',
    };
  return {
    title: `${s.doneCount} / ${d.tasks.length} tâches terminées · ${d.project.view.statusLabel}`,
    detail: task
      ? `À poursuivre : ${task.task.title}. Les montants portent sur toute la durée du projet.`
      : 'Toutes les tâches sont terminées. Vérifiez les parts restantes et les contrôles de fin de cycle.',
    tone: 'success',
  };
  }
