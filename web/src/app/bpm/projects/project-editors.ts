import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, newRequestKey, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmTaskCard } from '../../core/bpm-projects.models';
import { CoreProject, COLUMNS, Priority, TaskStatus } from '../../core/models';
import { parseAmount } from '../../core/format';
import { ModalComponent } from '../../shared/modal.component';

@Component({
  selector: 'bpm-project-editor',
  imports: [FormsModule, ModalComponent],
  template: `
    <rjs-modal
      [open]="true"
      [headed]="true"
      [title]="project() ? 'Modifier le projet de la vie' : 'Créer un projet de la vie'"
      [busy]="busy()"
      (closed)="closed.emit()"
    >
      <form class="bpm-management-form" (ngSubmit)="save()">
        <p class="bpm-note">
          Un projet de la vie dispose de son propre budget, enfant du budget de votre projet de vie
          unique.
        </p>
        @if (error()) {
          <p class="bpm-feedback is-error" role="alert">{{ error() }}</p>
        }
        <label
          >Nom du projet<input name="title" [(ngModel)]="title" required maxlength="200" autofocus
        /></label>
        <label
          >Objectif et description<textarea
            name="description"
            [(ngModel)]="description"
            rows="3"
            maxlength="20000"
          ></textarea>
        </label>
        <div class="bpm-form-grid">
          <label
            >Priorité<select name="priority" [(ngModel)]="priority">
              <option value="low">Basse</option>
              <option value="medium">Moyenne</option>
              <option value="high">Élevée</option>
            </select></label
          >
          @if (!project()) {
            <label
              >Budget attribué (€), facultatif<input
                name="amount"
                inputmode="decimal"
                [(ngModel)]="amount"
                placeholder="À définir plus tard"
            /></label>
          }
          <label>Date de début<input name="startDate" type="date" [(ngModel)]="startDate" /></label>
          <label
            >Échéance<input name="dueDate" type="date" [(ngModel)]="dueDate" [min]="startDate"
          /></label>
        </div>
        @if (!project()) {
          <p class="bpm-note">
            Vous pourrez ajouter les tâches et attribuer le budget plus tard. Attribuer un montant
            ne crée aucune dépense : seuls les règlements validés seront comptés dans le budget du
            projet de vie.
          </p>
        }
        <div class="bpm-actions">
          <button class="btn btn-primary" type="submit" [disabled]="busy() || !title.trim()">
            {{
              busy() ? 'Enregistrement…' : project() ? 'Enregistrer le projet' : 'Créer le projet'
            }}
          </button>
          <button
            class="btn btn-secondary"
            type="button"
            [disabled]="busy()"
            (click)="closed.emit()"
          >
            Annuler
          </button>
        </div>
      </form>
    </rjs-modal>
  `,
})
export class BpmProjectEditor implements OnInit {
  readonly project = input<CoreProject | null>(null);
  readonly closed = output<void>();
  readonly saved = output<{ projectId: string; title: string }>();
  private bpm = inject(BpmApi);
  private api = inject(Api);
  private requestKey = newRequestKey();
  protected busy = signal(false);
  protected error = signal('');
  protected title = '';
  protected description = '';
  protected priority: Priority = 'medium';
  protected startDate = '';
  protected dueDate = '';
  protected amount = '';

  ngOnInit() {
    const p = this.project();
    if (p) {
      this.title = p.title;
      this.description = p.description;
      this.priority = p.priority;
      this.startDate = p.startDate ?? '';
      this.dueDate = p.dueDate ?? '';
    }
  }

  protected async save() {
    if (this.busy()) return;
    const amount = parseAmount(this.amount);
    if (amount === 'invalid' || (amount !== null && amount < 0)) {
      this.error.set('Indiquez un budget positif ou nul, en euros avec deux décimales au plus.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const input = {
        title: this.title.trim(),
        description: this.description,
        priority: this.priority,
        startDate: this.startDate || null,
        dueDate: this.dueDate || null,
      };
      const p = this.project();
      const projectId = p
        ? (await this.api.updateProject(p.id, { ...input, expectedRevision: p.revision })).project
            .id
        : (await this.bpm.createProject({ ...input, amount, requestKey: this.requestKey }))
            .coreProjectId;
      this.saved.emit({ projectId, title: input.title });
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}

export interface TaskProjectOption {
  projectId: string;
  title: string;
}

@Component({
  selector: 'bpm-task-editor',
  imports: [FormsModule, ModalComponent],
  template: `
    <rjs-modal
      [open]="true"
      [headed]="true"
      [title]="task() ? 'Modifier la tâche' : 'Créer une tâche'"
      [busy]="busy()"
      (closed)="closed.emit()"
    >
      <form class="bpm-management-form" (ngSubmit)="save()">
        @if (error()) {
          <p class="bpm-feedback is-error" role="alert">{{ error() }}</p>
        }
        <label
          >Nom de la tâche<input
            name="title"
            [(ngModel)]="title"
            required
            maxlength="200"
            autofocus
        /></label>
        <label
          >Description<textarea
            name="description"
            [(ngModel)]="description"
            rows="2"
            maxlength="20000"
          ></textarea>
        </label>
        <label
          >Projet de la vie
          <select
            name="projectId"
            [(ngModel)]="projectId"
            [disabled]="!!task() || !!defaultProjectId()"
          >
            <option value="">Sans projet · rattacher plus tard</option>
            @for (p of projects(); track p.projectId) {
              <option [value]="p.projectId">{{ p.title }}</option>
            }
          </select>
        </label>
        <p class="bpm-note">
          @if (defaultProjectId() && !task()) {
            Cette tâche sera créée directement dans ce projet. Vous pourrez ensuite demander sa part
            du budget.
          } @else {
            Une tâche peut être préparée seule. Son montant se demande après son rattachement à un
            projet de la vie.
          }
        </p>
        <div class="bpm-form-grid">
          <label
            >État<select name="status" [(ngModel)]="status">
              @for (c of columns; track c.id) {
                <option [value]="c.id">{{ c.label }}</option>
              }
            </select></label
          >
          <label
            >Temps prévu (h)<input
              name="plannedHours"
              type="number"
              min="0"
              max="100000"
              step="0.01"
              [(ngModel)]="plannedHours"
              placeholder="Non estimé"
          /></label>
          <label
            >Temps consommé (h)<input
              name="spentHours"
              type="number"
              min="0"
              max="100000"
              step="0.01"
              [(ngModel)]="spentHours"
              required
          /></label>
          <label>Date prévue<input name="startDate" type="date" [(ngModel)]="startDate" /></label>
          <label
            >Échéance<input name="dueDate" type="date" [(ngModel)]="dueDate" [min]="startDate"
          /></label>
        </div>
        <div class="bpm-actions">
          <button type="submit" class="btn btn-primary" [disabled]="busy() || !title.trim()">
            {{ busy() ? 'Enregistrement…' : task() ? 'Enregistrer la tâche' : 'Créer la tâche' }}
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            [disabled]="busy()"
            (click)="closed.emit()"
          >
            Annuler
          </button>
        </div>
      </form>
    </rjs-modal>
  `,
})
export class BpmTaskEditor implements OnInit {
  readonly task = input<BpmTaskCard | null>(null);
  readonly projects = input<TaskProjectOption[]>([]);
  readonly defaultProjectId = input('');
  readonly closed = output<void>();
  readonly saved = output<string>();
  private bpm = inject(BpmApi);
  private api = inject(Api);
  private requestKey = newRequestKey();
  protected columns = COLUMNS;
  protected busy = signal(false);
  protected error = signal('');
  protected title = '';
  protected description = '';
  protected projectId = '';
  protected status: TaskStatus = 'todo';
  protected plannedHours: number | null = null;
  protected spentHours = 0;
  protected startDate = '';
  protected dueDate = '';

  ngOnInit() {
    this.projectId = this.defaultProjectId();
    const t = this.task()?.task;
    if (t) {
      this.title = t.title;
      this.description = t.description;
      this.projectId = t.projectId ?? '';
      this.status = t.status;
      this.plannedHours = t.plannedHours;
      this.spentHours = t.spentHours;
      this.startDate = t.startDate ?? '';
      this.dueDate = t.dueDate ?? '';
    }
  }

  protected async save() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const input = {
        title: this.title.trim(),
        description: this.description,
        status: this.status,
        plannedHours: this.plannedHours,
        spentHours: this.spentHours,
        startDate: this.startDate || null,
        dueDate: this.dueDate || null,
      };
      const t = this.task()?.task;
      if (t) await this.api.updateTask(t.id, { ...input, expectedRevision: t.revision });
      else
        await this.bpm.createTask({
          ...input,
          projectId: this.projectId || null,
          requestKey: this.requestKey,
        });
      this.saved.emit(
        `Tâche « ${input.title} » enregistrée${!t && !this.projectId ? ' ; vous pourrez la rattacher à un projet plus tard' : ''}.`,
      );
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
