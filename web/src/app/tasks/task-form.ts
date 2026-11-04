import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Api, ApiError, newRequestKey, toApiError } from '../core/api.service';
import { COLUMNS, ProjectSummary, TaskStatus, TaskView } from '../core/models';
import { parseHours } from '../core/format';
import { FormStatusComponent } from '../projects/workspace-parts';

/**
 * Création et modification d'une tâche, sur le gabarit de la fenêtre d'édition de la référence
 * (`entity-editor.component.ts` : projet en tête, sections « 01 · Définir » / « 02 · Organiser et planifier »,
 * champs `.field`, barre `.form-actions` avec `rjs-form-status`), dans une page routée précédée de
 * l'en-tête de page compact.
 */
@Component({
  selector: 'app-task-form',
  imports: [ReactiveFormsModule, FormStatusComponent],
  styleUrl: '../projects/entity-editor.page.scss',
  template: `
    <div class="page">
      <header class="page-head page-head-compact">
        <div>
          <div class="page-hero-title">
            <h1 class="display">{{ title() }}</h1>
            <p class="eyebrow"><span class="eyebrow-line"></span>Tâche</p>
          </div>
          <p class="lead">Une action concrète, son projet éventuel, son temps et ses dates.</p>
        </div>
        <nav class="site-page-tools" aria-label="Retour">
          <button class="btn btn-secondary" type="button" (click)="cancel()">← Retour</button>
        </nav>
      </header>

      @if (loadError()) {
        <div class="empty-state" role="alert">
          <div class="empty-mark">!</div>
          <h2>Tâche indisponible</h2>
          <p>{{ loadError() }}</p>
          <button class="btn btn-secondary" type="button" (click)="cancel()">← Retour</button>
        </div>
      } @else {
        <section class="entity-editor-panel" [attr.aria-label]="title()">
          <div class="modal-head">
            <div>
              <p class="eyebrow">Informations de la tâche</p>
              <h2>{{ title() }}</h2>
              @if (id()) {
                <p class="entity-id">Identifiant : <code>{{ id() }}</code></p>
              }
            </div>
          </div>
          <form class="editor-form" [formGroup]="form" [attr.aria-busy]="saving()" (ngSubmit)="submit()">
            <fieldset class="editor-fields" [disabled]="saving()">
              <label class="field field-full"
                >Projet (facultatif)
                <select formControlName="projectId" aria-describedby="task-hint-project">
                  <option value="">Sans projet (tâche autonome)</option>
                  @for (p of destinations(); track p.project.id) {
                    <option [value]="p.project.id">{{ p.project.title }} · {{ p.view.statusLabel }} · {{ p.project.id.slice(4, 12) }}</option>
                  }
                </select>
                <small class="field-hint" id="task-hint-project">
                  @if (projectLocked()) {
                    {{ lockReason() }}
                  } @else {
                    {{
                      projectValue()
                        ? 'Cette tâche participe au plan du projet. Les projets homonymes sont distingués par leur identifiant.'
                        : 'Vous pourrez rattacher cette tâche à un projet plus tard.'
                    }}
                  }
                </small>
              </label>
              @if (planningHint()) {
                <p class="field field-full editor-planning-hint" role="status">{{ planningHint() }}</p>
              }

              <h3 class="editor-section-title">01 · Définir la tâche</h3>
              <label class="field field-full"
                >Intitulé de la tâche <span class="field-requirement">Obligatoire</span>
                <input formControlName="title" maxlength="200" required aria-describedby="task-hint-title" />
                <small class="field-hint" id="task-hint-title"
                  >Commencez par une action concrète, par exemple « Réserver les billets ».</small
                >
              </label>
              <label class="field field-full"
                >Détails
                <textarea formControlName="description" rows="4" placeholder="Contexte, étapes et informations utiles."></textarea>
              </label>

              <h3 class="editor-section-title">02 · Organiser et planifier</h3>
              <label class="field"
                >Statut
                <select formControlName="status">
                  @for (c of columns; track c.id) {
                    <option [value]="c.id">{{ c.label }}</option>
                  }
                </select>
              </label>
              <label class="field"
                >Date prévue
                <input type="date" formControlName="startDate" />
              </label>
              <label class="field"
                >Échéance
                <input type="date" formControlName="dueDate" />
              </label>
              <label class="field"
                >Estimation (heures)
                <input
                  formControlName="plannedHours"
                  inputmode="decimal"
                  placeholder="Non renseigné"
                  aria-describedby="task-hint-planned"
                />
                <small class="field-hint" id="task-hint-planned"
                  >Temps total prévu, facultatif. Laissez vide si l'estimation n'est pas connue (distinct de 0).</small
                >
              </label>
              <label class="field"
                >Temps consommé (heures)
                <input formControlName="spentHours" inputmode="decimal" aria-describedby="task-hint-spent" />
                <small class="field-hint" id="task-hint-spent"
                  >Total cumulé déjà consacré à cette tâche ; il peut dépasser le prévu sans changer l'état.</small
                >
              </label>
            </fieldset>

            @if (error()?.isConflict) {
              <div class="editor-conflict" role="alert">
                <p>Votre saisie est conservée. Vous pouvez relire la version actuelle ou réappliquer votre saisie sur celle-ci.</p>
                <div class="editor-conflict-actions">
                  <button type="button" class="btn btn-secondary" (click)="reloadCurrent()">Relire la version actuelle</button>
                  <button type="button" class="btn btn-secondary" (click)="rebase()">Réappliquer ma saisie</button>
                </div>
              </div>
            }

            <div class="form-actions">
              <rjs-form-status
                [busy]="saving()"
                [dirty]="form.dirty"
                [touched]="form.touched"
                [invalid]="form.invalid"
                [error]="errorText()"
              />
              <span class="form-spacer"></span>
              <button class="btn btn-secondary" type="button" (click)="cancel()">Annuler</button>
              <button class="btn btn-primary" type="submit" [disabled]="saving()">
                {{ saving() ? 'Enregistrement…' : id() ? 'Enregistrer' : 'Ajouter la tâche' }}
              </button>
            </div>
          </form>
        </section>
      }
    </div>
  `,
})
export class TaskForm implements OnInit {
  readonly id = input<string>();
  readonly projectId = input<string>();
  private api = inject(Api);
  private router = inject(Router);
  private location = inject(Location);

  protected columns = COLUMNS;
  protected projects = signal<ProjectSummary[]>([]);
  protected current = signal<TaskView | null>(null);
  protected saving = signal(false);
  protected error = signal<ApiError | null>(null);
  protected loadError = signal<string | null>(null);
  private requestKey = newRequestKey();

  protected form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    description: new FormControl('', { nonNullable: true }),
    projectId: new FormControl('', { nonNullable: true }),
    status: new FormControl<TaskStatus>('todo', { nonNullable: true }),
    plannedHours: new FormControl('', { nonNullable: true }),
    spentHours: new FormControl('0', { nonNullable: true }),
    startDate: new FormControl('', { nonNullable: true }),
    dueDate: new FormControl('', { nonNullable: true }),
  });

  protected title = computed(() => (this.id() ? 'Modifier la tâche' : 'Nouvelle tâche'));
  protected errorText = computed(() => {
    const e = this.error();
    return e ? `${e.body.action ?? 'Action'} refusée : ${e.message}` : '';
  });
  private values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  protected projectValue = computed(() => this.values().projectId ?? this.form.controls.projectId.value);
  /** Repères de lecture (référence `planningHint`) : aucune règle n'empêche l'enregistrement. */
  protected planningHint = computed(() => {
    const { startDate, dueDate } = this.values();
    if (startDate && dueDate && startDate > dueDate)
      return 'À vérifier : la date prévue dépasse l’échéance. Vous pouvez conserver ce décalage pour le suivre.';
    const project = this.projects().find((p) => p.project.id === this.projectValue());
    if (
      project &&
      ((startDate && project.project.startDate && startDate < project.project.startDate) ||
        (dueDate && project.project.dueDate && dueDate > project.project.dueDate))
    )
      return 'Ces dates dépassent la période du projet. Vérifiez ce décalage avant d’enregistrer.';
    return '';
  });

  /** Destinations du parcours normal : projets génériques et branches, jamais la racine principale. */
  protected destinations = computed(() => {
    const currentProject = this.current()?.task.projectId;
    return this.projects().filter((p) => p.pathways.isTaskDestination || p.project.id === currentProject);
  });

  protected projectLocked = computed(() => !!this.current() && !this.current()!.pathways.canChangeProject);
  protected lockReason = computed(() => {
    const pid = this.current()?.task.projectId;
    return this.projects().find((p) => p.project.id === pid)?.pathways.note ?? 'Rattachement non modifiable dans ce parcours.';
  });

  async ngOnInit() {
    try {
      this.projects.set(await this.api.projects());
      if (this.id()) {
        this.fill(await this.api.task(this.id()!));
      } else if (this.projectId()) {
        const target = this.projects().find((p) => p.project.id === this.projectId());
        if (target?.pathways.isTaskDestination) this.form.controls.projectId.setValue(target.project.id);
      }
    } catch (err) {
      this.loadError.set(toApiError(err).message);
    }
  }

  private fill(v: TaskView) {
    this.current.set(v);
    const t = v.task;
    this.form.setValue({
      title: t.title,
      description: t.description,
      projectId: t.projectId ?? '',
      status: t.status,
      plannedHours: t.plannedHours === null ? '' : String(t.plannedHours),
      spentHours: String(t.spentHours),
      startDate: t.startDate ?? '',
      dueDate: t.dueDate ?? '',
    });
    if (!v.pathways.canChangeProject) this.form.controls.projectId.disable();
    else this.form.controls.projectId.enable();
  }

  private invalid(message: string, field: string) {
    this.error.set(new ApiError(400, { code: 'VALIDATION', action: null, message, details: { field } }));
  }

  async submit() {
    const v = this.form.getRawValue();
    const planned = parseHours(v.plannedHours);
    const spent = parseHours(v.spentHours);
    if (!v.title.trim()) {
      this.form.markAllAsTouched();
      return this.invalid('Le nom est obligatoire.', 'title');
    }
    if (planned === 'invalid') return this.invalid('Le temps prévu doit être un nombre d’heures positif ou vide.', 'plannedHours');
    if (spent === 'invalid' || spent === null) return this.invalid('Le temps consommé doit être un nombre d’heures positif.', 'spentHours');

    const body: Record<string, unknown> = {
      title: v.title,
      description: v.description,
      status: v.status,
      plannedHours: planned,
      spentHours: spent,
      startDate: v.startDate || null,
      dueDate: v.dueDate || null,
    };
    if (!this.form.controls.projectId.disabled) body['projectId'] = v.projectId || null;

    this.saving.set(true);
    this.error.set(null);
    try {
      const r = this.id()
        ? await this.api.updateTask(this.id()!, { ...body, expectedRevision: this.current()!.task.revision })
        : await this.api.createTask({ ...body, requestKey: this.requestKey });
      await this.router.navigate(r.task.projectId ? ['/projects', r.task.projectId] : ['/tasks']);
    } catch (err) {
      this.error.set(toApiError(err));
    } finally {
      this.saving.set(false);
    }
  }

  async reloadCurrent() {
    this.fill(await this.api.task(this.id()!));
    this.error.set(null);
  }

  /** Conserve la saisie et adopte seulement la nouvelle version comme base. */
  async rebase() {
    const fresh = await this.api.task(this.id()!);
    this.current.set(fresh);
    this.error.set(null);
  }

  cancel() {
    this.location.back();
  }
}
