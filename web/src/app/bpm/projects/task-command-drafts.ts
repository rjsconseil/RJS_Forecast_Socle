import { computed, signal } from '@angular/core';
import type { BpmTaskCard } from '../data/bpm-projects.models';

/** Réglage des temps d'une tâche, gardé tant qu'il n'est pas appliqué. */
export interface CommandTimeDraft {
  revision: number;
  plannedHours: number | null;
  spentHours: number;
}
/** Réglage de la part d'enveloppe d'une tâche, gardé tant qu'il n'est pas appliqué. */
export interface CommandShareDraft {
  revision: number;
  envelopeCents: number;
  amountCents: number;
  percent: number;
}
/** Ce que les brouillons lisent de l'enveloppe du projet. */
export interface CommandEnvelope {
  revision: number;
  allocationCents: number | null;
  regime?: unknown;
  /** Projet abandonné (présent et non nul) : plus de réglage. */
  abandoned?: unknown;
}

const MAX_HOURS = 100000;

/**
 * Brouillons du centre de commande d'une fiche projet (cadrans des temps et de la part d'enveloppe) : un brouillon
 * par tâche, périmé dès que la tâche ou l'enveloppe change ailleurs. Aucune écriture ici : la page applique.
 * Sorti de la fiche projet pour être lu et testé seul.
 */
export class TaskCommandDrafts {
  private readonly times = signal<Record<string, CommandTimeDraft>>({});
  private readonly shares = signal<Record<string, CommandShareDraft>>({});
  /** Plage des cadrans de temps (heures), élargie à la demande. */
  readonly timeRange = signal(40);

  constructor(
    private readonly task: () => BpmTaskCard | null,
    private readonly envelope: () => CommandEnvelope | null | undefined,
  ) {}

  readonly timeDraft = computed(() => this.times()[this.task()?.task.id ?? ''] ?? null);
  readonly shareDraft = computed(() => this.shares()[this.task()?.task.id ?? ''] ?? null);
  readonly timeValues = computed(() => {
    const task = this.task()?.task;
    return this.timeDraft() ?? { plannedHours: task?.plannedHours ?? null, spentHours: task?.spentHours ?? 0 };
  });
  readonly timeMax = computed(() => Math.min(MAX_HOURS, Math.max(this.timeRange(), this.timeValues().plannedHours ?? 0, this.timeValues().spentHours)));
  readonly timeStale = computed(() => !!this.timeDraft() && this.timeDraft()!.revision !== this.task()?.task.revision);
  readonly shareStale = computed(() => {
    const d = this.shareDraft(), e = this.envelope();
    return !!d && (d.revision !== e?.revision || d.envelopeCents !== e?.allocationCents);
  });
  readonly sharePercent = computed(() => {
    const total = this.envelope()?.allocationCents ?? 0;
    return this.shareDraft()?.percent ?? (total > 0 ? Math.round(10000 * (this.task()?.budget?.shareCents ?? 0) / total) / 100 : 0);
  });
  readonly shareAmount = computed(() => this.shareDraft()?.amountCents ?? this.task()?.budget?.shareCents ?? 0);
  readonly shareMax = computed(() => Math.max(200, Math.ceil(this.sharePercent() / 25) * 25));

  /** Règle un temps de la tâche ouverte (valeur hors bornes ignorée). */
  changeTime(field: 'plannedHours' | 'spentHours', value: number): void {
    const t = this.task();
    if (!t || !Number.isFinite(value) || value < 0 || value > MAX_HOURS) return;
    const draft = this.timeDraft() ?? { revision: t.task.revision, plannedHours: t.task.plannedHours ?? null, spentHours: t.task.spentHours };
    this.times.update(all => ({ ...all, [t.task.id]: { ...draft, [field]: Math.round(value * 100) / 100 } }));
  }

  /** Règle la part de la tâche ouverte, en pourcentage de l'enveloppe attribuée. */
  changeShare(percent: number): void {
    const t = this.task(), e = this.envelope();
    if (!t || !e?.regime || e.abandoned || !Number.isFinite(percent) || percent < 0 || !((e.allocationCents ?? 0) > 0)) return;
    const draft = this.shareDraft() ?? { revision: e.revision, envelopeCents: e.allocationCents! };
    this.shares.update(all => ({ ...all, [t.task.id]: { ...draft, percent, amountCents: Math.round(draft.envelopeCents * percent / 100) } }));
  }

  resetTime(taskId = this.task()?.task.id): void {
    if (taskId) this.times.update(all => { const { [taskId]: _removed, ...rest } = all; return rest; });
  }

  resetShare(taskId = this.task()?.task.id): void {
    if (taskId) this.shares.update(all => { const { [taskId]: _removed, ...rest } = all; return rest; });
  }

  /** Le projet est relu (autre projet, autre profil) : les brouillons tombent. */
  clear(): void {
    this.times.set({});
    this.shares.set({});
  }
}
