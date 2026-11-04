import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { RouterLink } from '@angular/router';
import { COLUMNS, TaskStatus } from '../core/models';

/**
 * Pièces de présentation des espaces Projets et Tâches, reprises de la référence
 * (`item-summary`, `item-board-tools`, `project-filter`, `form-status` de rjsconseil/rjs-forecast).
 * Mêmes éléments hôtes et mêmes classes : les feuilles globales `_workspace.scss` et `_forms.scss`
 * les habillent comme dans la référence. Aucune donnée n'est lue ici : les pages fournissent les chiffres.
 */

export type BoardKind = 'project' | 'task';

const SECTION: Record<BoardKind, { singular: string; plural: string }> = {
  project: { singular: 'projet', plural: 'projets' },
  task: { singular: 'tâche', plural: 'tâches' },
};

export interface FilterOption {
  value: string;
  label: string;
}

/** Date AAAA-MM-JJ → « 3 nov. 2026 » ; vide → « Non définie » (comme `displayDate` de la référence). */
export function displayDate(value: string | null | undefined): string {
  if (!value) return 'Non définie';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(year, month - 1, day, 12),
  );
}

/** Horodatage ISO → « 3 nov. 2026, 14:05 ». */
export function displayTimestamp(value: string | null | undefined): string {
  const timestamp = new Date(value ?? '');
  if (!value || !Number.isFinite(timestamp.getTime())) return 'Non définie';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}

const DUE_SOON_DAYS = 7;

/** Échéance dépassée ou proche (7 jours) d'un élément non terminé. */
export function dueUrgency(value: string | null | undefined, done: boolean): 'overdue' | 'soon' | null {
  if (!value || done) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (value < today) return 'overdue';
  const limit = new Date(today + 'T12:00:00Z');
  limit.setUTCDate(limit.getUTCDate() + DUE_SOON_DAYS);
  return value <= limit.toISOString().slice(0, 10) ? 'soon' : null;
}

/** Libellé d'une échéance complété par son urgence : infobulle des dates signalées. */
export function dueTitle(value: string | null | undefined, done: boolean): string {
  const urgency = dueUrgency(value, done);
  const date = value ? displayDate(value) : 'Sans échéance';
  if (!urgency) return date;
  return `${date} · ${urgency === 'overdue' ? 'En retard' : `Échéance sous ${DUE_SOON_DAYS} jours`}`;
}

/** Recherche insensible à la casse et aux accents. */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('fr');
}

@Component({
  selector: 'rjs-item-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [':host { display: block; }'],
  template: `
    <section
      class="summary-band"
      [class.summary-band-compact]="kind() === 'project'"
      [attr.aria-label]="'Résumé des ' + section().plural"
    >
      <div class="summary-band-total">
        <span class="eyebrow">{{ kind() === 'project' ? 'Projets non terminés' : 'Tâches non terminées' }}</span>
        <strong>{{ remaining() }}</strong><span>{{ remaining() === 1 ? section().singular : section().plural }}</span>
      </div>
      @for (status of statuses; track status.id) {
        @if (status.id !== 'done') {
          <div class="summary-band-stat">
            <span class="status-dot" [attr.data-status]="status.id"></span>
            <strong>{{ counts()[status.id] ?? 0 }}</strong><span class="status-heading">{{ status.label }}</span>
          </div>
        }
      }
      <div class="summary-band-meter">
        <span>Progression</span><strong>{{ progress() }} %</strong>
        <div
          class="progress-track"
          role="progressbar"
          [attr.aria-valuenow]="progress()"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-label="Progression globale"
        >
          <span [style.width.%]="progress()"></span>
        </div>
      </div>
    </section>
  `,
})
export class ItemSummaryComponent {
  readonly kind = input.required<BoardKind>();
  readonly remaining = input(0);
  readonly counts = input<Partial<Record<TaskStatus, number>>>({});
  readonly progress = input(0);
  protected readonly statuses = COLUMNS;
  protected readonly section = computed(() => SECTION[this.kind()]);
}

@Component({
  selector: 'rjs-project-filter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="project-select">
      {{ label() }}
      <select (change)="value.set($any($event.target).value)">
        @for (option of options(); track option.value) {
          <option [value]="option.value" [selected]="option.value === value()">{{ option.label }}</option>
        }
      </select>
    </label>
  `,
})
export class ProjectFilterComponent {
  readonly kind = input.required<BoardKind>();
  readonly options = input<FilterOption[]>([]);
  readonly value = model('all');
  protected readonly label = computed(() => (this.kind() === 'task' ? 'Afficher les tâches' : 'Projet'));
}

@Component({
  selector: 'rjs-item-board-tools',
  imports: [RouterLink, ProjectFilterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [':host { display: block; }'],
  template: `
    <div class="section-home-board-tools" data-ui-pattern="panel">
      <div class="board-tools-title" data-ui-pattern="section-heading">
        <h2 class="section-title">Tableau des {{ section().plural }}</h2>
        <a class="btn btn-primary" [routerLink]="createLink()" [queryParams]="createQuery()"
          ><span class="btn-plus">+</span>{{ createLabel() }}</a
        >
      </div>
      <div class="board-tools-filters">
        <rjs-project-filter [kind]="kind()" [options]="filterOptions()" [(value)]="filter" />
        <label class="board-search">
          Rechercher dans les {{ section().plural }}
          <input
            type="search"
            placeholder="Nom, description ou référence…"
            [value]="search()"
            (input)="search.set($any($event.target).value)"
          />
        </label>
        @if (search()) {
          <button class="btn btn-secondary" type="button" (click)="search.set('')">Effacer la recherche</button>
        }
      </div>
    </div>
  `,
})
export class ItemBoardToolsComponent {
  readonly kind = input.required<BoardKind>();
  readonly filterOptions = input<FilterOption[]>([]);
  readonly createLink = input.required<string>();
  readonly createQuery = input<Record<string, string> | null>(null);
  readonly createLabel = input.required<string>();
  readonly filter = model('all');
  readonly search = model('');
  protected readonly section = computed(() => SECTION[this.kind()]);
}

/** Retour d'état commun des formulaires (référence `shared/form-status.component.ts`). */
@Component({
  selector: 'rjs-form-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (busy()) {
      <p class="form-feedback" data-state="busy" role="status">Enregistrement en cours…</p>
    } @else if (error()) {
      <p class="form-feedback" data-state="error" role="alert">{{ error() }}</p>
    } @else if (invalid() && touched()) {
      <p class="form-feedback" data-state="error" role="status">
        Complétez les champs obligatoires et vérifiez les champs signalés.
      </p>
    } @else if (dirty()) {
      <p class="form-feedback" data-state="draft" role="status">Modifications en cours · enregistrez pour les conserver.</p>
    } @else {
      <p class="form-feedback">Les changements sont appliqués à l’enregistrement.</p>
    }
  `,
})
export class FormStatusComponent {
  readonly busy = input(false);
  readonly dirty = input<boolean | null>(false);
  readonly touched = input<boolean | null>(false);
  readonly invalid = input<boolean | null>(false);
  readonly error = input('');
}
