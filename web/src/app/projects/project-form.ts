import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, ApiError, newRequestKey, toApiError } from '../core/api.service';
import { CoreProject, PRIORITY_LABEL, Priority } from '../core/models';
import { FormStatusComponent } from './workspace-parts';

/**
 * Création et modification d'un projet, sur le gabarit de la fenêtre d'édition de la référence
 * (`entity-editor.component.ts` : en-tête, sections « 01 · Définir » / « 02 · Organiser et planifier »,
 * champs `.field`, barre `.form-actions` avec `rjs-form-status`). Ici la fenêtre est une page routée,
 * précédée de l'en-tête de page compact de la fiche projet.
 */
@Component({
  selector: 'app-project-form',
  imports: [ReactiveFormsModule, RouterLink, FormStatusComponent],
  styleUrl: './entity-editor.page.scss',
  template: `
    <div class="page">
      <header class="page-head page-head-compact">
        <div>
          <div class="page-hero-title">
            <h1 class="display">{{ title() }}</h1>
            <p class="eyebrow"><span class="eyebrow-line"></span>Projet</p>
          </div>
          <p class="lead">Posez le cadre du projet ; son état et ses chiffres se calculent ensuite depuis ses tâches.</p>
        </div>
        <nav class="site-page-tools" aria-label="Retour">
          <a class="btn btn-secondary" [routerLink]="cancelLink()">← {{ id() ? 'Retour au projet' : 'Retour aux projets' }}</a>
        </nav>
      </header>

      @if (loadError()) {
        <div class="empty-state" role="alert">
          <div class="empty-mark">!</div>
          <h2>Projet indisponible</h2>
          <p>{{ loadError() }}</p>
          <a class="btn btn-secondary" routerLink="/projects">← Retour aux projets</a>
        </div>
      } @else {
        <section class="entity-editor-panel" [attr.aria-label]="title()">
          <div class="modal-head">
            <div>
              <p class="eyebrow">Informations du projet</p>
              <h2>{{ title() }}</h2>
              @if (id()) {
                <p class="entity-id">Identifiant : <code>{{ id() }}</code></p>
              }
            </div>
          </div>
          <form class="editor-form" [formGroup]="form" [attr.aria-busy]="saving()" (ngSubmit)="submit()">
            <fieldset class="editor-fields" [disabled]="saving()">
              <h3 class="editor-section-title">01 · Définir le projet</h3>
              <label class="field field-full"
                >Nom du projet <span class="field-requirement">Obligatoire</span>
                <input
                  formControlName="title"
                  maxlength="200"
                  required
                  placeholder="Ex. Préparer mon installation"
                  aria-describedby="project-hint-title"
                />
                <small class="field-hint" id="project-hint-title"
                  >Un nom court qui décrit le résultat à atteindre. Il exprime la raison d'être du projet ; ce n'est pas une
                  clé d'identité.</small
                >
              </label>
              <label class="field field-full"
                >Résumé et périmètre
                <textarea
                  formControlName="description"
                  rows="6"
                  placeholder="Résultat attendu, contexte, ce que le projet couvre et ce qui reste en dehors…"
                ></textarea>
              </label>

              <h3 class="editor-section-title">02 · Organiser et planifier</h3>
              <label class="field"
                >Priorité
                <select formControlName="priority">
                  @for (p of priorities; track p[0]) {
                    <option [value]="p[0]">{{ p[1] }}</option>
                  }
                </select>
              </label>
              <label class="field"
                >Date de début prévue
                <input type="date" formControlName="startDate" />
              </label>
              <label class="field"
                >Échéance cible
                <input type="date" formControlName="dueDate" />
              </label>
              @if (planningHint()) {
                <p class="field field-full editor-planning-hint" role="status">{{ planningHint() }}</p>
              }
              <p class="field-hint field-full">
                L'état et les chiffres agrégés sont calculés depuis les tâches : ils ne se saisissent pas ici.
              </p>
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
              <a class="btn btn-secondary" [routerLink]="cancelLink()">Annuler</a>
              <button class="btn btn-primary" type="submit" [disabled]="saving()">
                {{ saving() ? 'Enregistrement…' : id() ? 'Enregistrer' : 'Créer le projet' }}
              </button>
            </div>
          </form>
        </section>
      }
    </div>
  `,
})
export class ProjectForm implements OnInit {
  readonly id = input<string>();
  private api = inject(Api);
  private router = inject(Router);

  protected priorities = Object.entries(PRIORITY_LABEL) as [Priority, string][];
  protected saving = signal(false);
  protected error = signal<ApiError | null>(null);
  protected loadError = signal<string | null>(null);
  private revision = 0;
  // Une seule demande logique par formulaire de création : une nouvelle tentative réutilise la même clé.
  private requestKey = newRequestKey();

  protected form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    description: new FormControl('', { nonNullable: true }),
    priority: new FormControl<Priority>('medium', { nonNullable: true }),
    startDate: new FormControl('', { nonNullable: true }),
    dueDate: new FormControl('', { nonNullable: true }),
  });

  protected title = computed(() => (this.id() ? 'Modifier le projet' : 'Nouveau projet'));
  protected cancelLink = computed(() => (this.id() ? ['/projects', this.id()!] : ['/projects']));
  protected errorText = computed(() => {
    const e = this.error();
    return e ? `${e.body.action ?? 'Action'} refusée : ${e.message}` : '';
  });

  private values = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  /** Simple repère de lecture (référence `planningHint`) : aucune règle n'empêche l'enregistrement. */
  protected planningHint = computed(() => {
    const { startDate, dueDate } = this.values();
    return startDate && dueDate && startDate > dueDate
      ? 'À vérifier : la date de début dépasse l’échéance. Vous pouvez conserver ce décalage pour le suivre.'
      : '';
  });

  async ngOnInit() {
    if (!this.id()) return;
    try {
      this.fill((await this.api.project(this.id()!)).project);
    } catch (err) {
      this.loadError.set(toApiError(err).message);
    }
  }

  private fill(p: CoreProject) {
    this.revision = p.revision;
    this.form.setValue({
      title: p.title,
      description: p.description,
      priority: p.priority,
      startDate: p.startDate ?? '',
      dueDate: p.dueDate ?? '',
    });
  }

  async submit() {
    const v = this.form.getRawValue();
    if (!v.title.trim()) {
      this.form.markAllAsTouched();
      this.error.set(new ApiError(400, { code: 'VALIDATION', action: null, message: 'Le nom est obligatoire.' }));
      return;
    }
    const body = { ...v, startDate: v.startDate || null, dueDate: v.dueDate || null };
    this.saving.set(true);
    this.error.set(null);
    try {
      const r = this.id()
        ? await this.api.updateProject(this.id()!, { ...body, expectedRevision: this.revision })
        : await this.api.createProject({ ...body, requestKey: this.requestKey });
      await this.router.navigate(['/projects', r.project.id]);
    } catch (err) {
      this.error.set(toApiError(err));
    } finally {
      this.saving.set(false);
    }
  }

  async reloadCurrent() {
    this.fill((await this.api.project(this.id()!)).project);
    this.error.set(null);
  }

  async rebase() {
    this.revision = (await this.api.project(this.id()!)).project.revision;
    this.error.set(null);
  }
}
