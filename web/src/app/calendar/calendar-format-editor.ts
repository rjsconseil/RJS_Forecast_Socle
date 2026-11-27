// Calendrier : formats d'affichage créés par la personne (création, modification, ordre des champs, suppression).
// Le composant garde le choix du format en cours ; cette classe porte les formats à soi et le brouillon en cours.
import { signal } from '@angular/core';
import {
  type CalendarFormatDraft,
  formatDraftOf,
  moveDraftField,
  saveDraftInto,
  toggleDraftField,
} from './calendar-day-summary';
import { newFormatId } from './calendar-formats';
import { CalendarFormat, CalendarFormatField, CalendarLayout } from './calendar.models';

/** Ce que l'éditeur de formats lit du composant. */
export interface FormatEditorHost {
  /** Tous les formats proposés (livrés, de la configuration, à soi). */
  formats(): CalendarFormat[];
  /** Format en cours : point de départ d'un nouveau format. */
  current(): CalendarFormat;
  /** La configuration permet-elle de changer les champs montrés ? */
  allowed(): boolean;
  /** Format choisi dans les préférences (pour revenir au format d'ouverture si on le supprime). */
  chosen(): string | undefined;
  choose(id: string): void;
  /** Revient au format d'ouverture du calendrier. */
  resetChoice(): void;
  /** Les formats à soi ont changé : à enregistrer. */
  changed(next: CalendarFormat[]): void;
}

export class CalendarFormatEditor {
  /** Formats créés par la personne (tous ses calendriers). */
  readonly own = signal<CalendarFormat[]>([]);
  /** Format en cours de création ou de modification. */
  readonly draft = signal<CalendarFormatDraft | null>(null);

  constructor(private readonly host: FormatEditorHost) {}

  /** Nouveau format, à partir de celui en cours ; ou modification d'un format créé par la personne. */
  edit(format: CalendarFormat | null = null) {
    if (!this.host.allowed()) return;
    this.draft.set(formatDraftOf(format, this.host.current()));
  }
  update(change: Partial<{ label: string; layout: CalendarLayout; perCell: number | null }>) {
    this.draft.update((d) => (d ? { ...d, ...change } : d));
  }
  toggleField(field: CalendarFormatField) {
    this.draft.update((d) => d && toggleDraftField(d, field));
  }
  /** Change l'ordre d'un champ dans le format (−1 : plus tôt, +1 : plus tard). */
  moveField(field: CalendarFormatField, step: number) {
    this.draft.update((d) => d && moveDraftField(d, field, step));
  }
  save() {
    const draft = this.draft();
    const label = draft?.label.trim();
    if (!draft || !label) return;
    const id = draft.id ?? newFormatId(label, this.host.formats());
    this.store(saveDraftInto(this.own(), draft, id));
    this.draft.set(null);
    this.host.choose(id);
  }
  remove(id: string) {
    this.store(this.own().filter((f) => f.id !== id));
    if (this.host.chosen() === id) this.host.resetChoice();
  }
  private store(next: CalendarFormat[]) {
    this.own.set(next);
    this.host.changed(next);
  }
}
