// État de la fenêtre d'une tâche sur la fiche projet : quelle tâche est ouverte, et ce que la fenêtre montre ouvert
// (demande de part, retour, règlement en cours). Tout tient dans l'adresse (`?task=…&demande=…&retour=…&reglement=…`)
// pour que l'arrière, l'avant et le rechargement rouvrent la même fenêtre. Sorti de project.page.ts (rapport v6) :
// la page garde les écritures, cette classe garde l'état et ses lectures.
import { computed, Signal } from '@angular/core';
import { BpmProjectDetail, BpmTaskCard } from '../data/bpm-projects.models';
import { bpmQueryState } from '../ui/query-state';

export interface TaskWindowSources {
  data: Signal<BpmProjectDetail | null>;
  /** Demandes déjà décidées, toutes tâches confondues. */
  history: Signal<BpmProjectDetail['requests']>;
  /** Demande de dépassement que la page est en train de traiter (elle n'est pas listée deux fois). */
  handledRequestId: () => string | undefined;
}

/** À construire dans un contexte d'injection (champ d'un composant) : `bpmQueryState` lit la route. */
export class ProjectTaskWindow {
  readonly id = bpmQueryState<string | null>('task', null, { overlay: true });
  /** Tâche dont le formulaire de demande de part est ouvert. */
  readonly fundingTask = bpmQueryState<string | null>('demande', null, { overlay: true });
  /** Tâche dont la saisie d'un retour est ouverte. */
  readonly returnEditor = bpmQueryState<string | null>('retour', null, { overlay: true });
  /** Dépense en cours de règlement (fenêtre de la tâche ou liste des dépenses sans tâche). */
  readonly settling = bpmQueryState<string | null>('reglement', null, { overlay: true });

  readonly task = computed<BpmTaskCard | null>(() => {
    const id = this.id();
    return id ? ((this.sources.data()?.tasks ?? []).find((t) => t.task.id === id) ?? null) : null;
  });

  constructor(private readonly sources: TaskWindowSources) {}

  /** Ouvre la fenêtre de `t`, au besoin sur le formulaire de sa demande de part. */
  open(t: BpmTaskCard, funding: boolean) {
    this.fundingTask.set(funding && !t.budget?.request ? t.task.id : null);
    this.returnEditor.set(null);
    this.settling.set(null);
    this.id.set(t.task.id);
  }

  close() {
    this.id.set(null);
    this.fundingTask.set(null);
    this.returnEditor.set(null);
    this.settling.set(null);
  }

  /** Relit l'adresse après un changement de route (autre projet, arrière, avant). */
  sync() {
    this.fundingTask.sync();
    this.id.sync();
    this.returnEditor.sync();
    this.settling.sync();
  }

  charges(id: string) {
    return (this.sources.data()?.charges ?? []).filter((c) => c.taskId === id);
  }
  history(id: string) {
    return this.sources.history().filter((r) => r.taskId === id);
  }
  overruns(id: string) {
    return (this.sources.data()?.overruns ?? []).filter(
      (o) => o.taskId === id && o.status === 'pending' && o.id !== this.sources.handledRequestId(),
    );
  }
}
