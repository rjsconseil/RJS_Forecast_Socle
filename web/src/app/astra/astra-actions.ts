import { Injectable, signal } from '@angular/core';

export type AstraCreateKind = 'income' | 'charge' | 'project' | 'task' | 'goal';

export interface AstraToast { text: string; link?: string; linkLabel?: string }

/** Les créations d'Astra : une seule entrée, ouverte en fenêtre depuis n'importe quelle page de la partie. */
export const ASTRA_CREATE_MENU: { kind: AstraCreateKind; label: string; icon: string; key: string; part: string }[] = [
  { kind: 'charge', label: 'Dépense', icon: 'depense', key: 'D', part: 'quotidien' },
  { kind: 'income', label: 'Entrée d’argent', icon: 'entree', key: 'E', part: 'quotidien' },
  { kind: 'project', label: 'Projet de la vie', icon: 'projets', key: 'P', part: 'projets' },
  { kind: 'task', label: 'Tâche', icon: 'taches', key: 'T', part: 'projets' },
  { kind: 'goal', label: 'Objectif daté', icon: 'objectifs', key: 'O', part: 'patrimoine' },
];

/**
 * Fourni par le cadre de partie : l'écran présenté (accueil, pages propres) demande une création
 * sans quitter la page ; le cadre ouvre la fenêtre et confirme d'un message.
 */
@Injectable()
export class AstraActions {
  readonly creating = signal<{ kind: AstraCreateKind; projectId?: string } | null>(null);
  readonly toast = signal<AstraToast | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  create(kind: AstraCreateKind, opts: { projectId?: string } = {}): void {
    this.creating.set({ kind, ...opts });
  }

  close(): void {
    this.creating.set(null);
  }

  notify(toast: AstraToast): void {
    clearTimeout(this.timer);
    this.toast.set(toast);
    this.timer = setTimeout(() => this.toast.set(null), 6000);
  }
}
