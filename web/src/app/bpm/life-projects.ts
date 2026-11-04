import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, ApiError, newRequestKey, toApiError } from '../core/api.service';
import { BpmApi } from '../core/bpm-api.service';
import { LifeProject } from '../core/models';
import { HoursPipe, parseHours, PlannedTotalPipe, ShortDatePipe } from '../core/format';
import { BpmPageFrame, bpmLoader } from './ui';

interface DraftTask {
  uid: number;
  title: string;
  hours: string;
}

/**
 * Projets de la vie, sur la présentation des projets de la référence (`rjs-bpm-project-costs`) :
 * bandeau commun, puis une carte repliable par projet (résumé : nom, tâches, avancement, temps ;
 * détail : faits, tâches par état, explication, liens), et la création sur la scène de saisie de « Démarrer ».
 */
@Component({
  selector: 'app-bpm-life-projects',
  imports: [RouterLink, HoursPipe, PlannedTotalPipe, ShortDatePipe, BpmPageFrame],
  styleUrls: ['./ref-styles/bpm-pages.scss', './ref-styles/bpm-create.page.scss', './ref-styles/bpm-expenses.page.scss'],
  template: `
    <bpm-page
      kicker="Démarrer un projet"
      title="Projets de la vie"
      lead="Un voyage, un déménagement, des travaux… Chaque projet de la vie est une branche de votre Projet de vie : un Budget standard qui lui est propre, rattaché au Budget « Projet de vie », avec son projet dans le noyau et au moins une tâche."
      [context]="summary.data()?.context"
    >
      <div actions>
        @if (!formOpen()) {
          <button type="button" class="btn btn-primary app-hero-action" (click)="openForm()" aria-controls="lp-form">Nouveau projet</button>
        }
      </div>

      <div class="lp-page">
        @if (notice(); as n) {
          <div class="bpm-missing lp-inline" role="status">
            <span>{{ n.text }}</span>
            @if (n.projectId) {
              <a class="bpm-link" [routerLink]="['/projects', n.projectId]">Ouvrir dans le noyau →</a>
            }
            <button type="button" class="btn btn-secondary" (click)="notice.set(null)" aria-label="Masquer le message">✕</button>
          </div>
        }

        @if (formOpen()) {
          <section id="lp-form" class="bs-stage" data-bpm-frame="form" data-ui-pattern="detail" aria-labelledby="lp-form-title" (keydown.escape)="closeForm()">
            <header class="bs-stage-head">
              <p class="bs-stage-count">Nouveau projet de la vie</p>
              <h2 id="lp-form-title">Le projet</h2>
              <p class="bs-stage-help">Un nom parlant, une échéance si vous en avez une, et au moins une première tâche. Rien n'est enregistré avant « Créer le projet ».</p>
            </header>
            <form class="lp-form" (submit)="$event.preventDefault(); submit()" novalidate>
              <div class="bs-vision">
                <label class="bs-field">
                  <span>Nom du projet</span>
                  <input id="lp-name" maxlength="200" autocomplete="off" placeholder="Ex. Voyage au Japon" [value]="name()" (input)="name.set($any($event.target).value)" />
                </label>
                <label class="bs-field">
                  <span>Échéance, facultative</span>
                  <input type="date" [value]="dueDate()" (input)="dueDate.set($any($event.target).value)" />
                </label>
              </div>
              <label class="bs-field">
                <span>Description, facultative</span>
                <textarea rows="3" [value]="description()" (input)="description.set($any($event.target).value)" placeholder="Pourquoi ce projet, ce qu'il doit permettre…"></textarea>
              </label>

              <fieldset class="bs-options lp-tasks">
                <legend>Premières tâches · au moins une</legend>
                <ol class="lp-task-list">
                  @for (t of tasks(); track t.uid; let i = $index) {
                    <li class="lp-task">
                      <span class="lp-task-num" aria-hidden="true">{{ i + 1 }}</span>
                      <label class="bs-field">
                        <span class="visually-hidden">Titre de la tâche {{ i + 1 }}</span>
                        <input [id]="'lp-task-' + t.uid" maxlength="200" autocomplete="off" placeholder="Titre de la tâche" [value]="t.title" (input)="setTask(t.uid, 'title', $any($event.target).value)" />
                      </label>
                      <label class="bs-field lp-hours">
                        <span class="visually-hidden">Heures prévues pour la tâche {{ i + 1 }}</span>
                        <input inputmode="decimal" autocomplete="off" placeholder="h prévues" [value]="t.hours" (input)="setTask(t.uid, 'hours', $any($event.target).value)" />
                      </label>
                      <button type="button" class="btn btn-secondary" (click)="removeTask(t.uid)" [disabled]="tasks().length === 1" [attr.aria-label]="'Retirer la tâche ' + (i + 1)">✕</button>
                    </li>
                  }
                </ol>
                <button type="button" class="btn btn-secondary lp-add" (click)="addTask()">Ajouter une tâche</button>
              </fieldset>
              <p class="bs-note">Heures prévues facultatives : laissées vides, l'estimation reste « non renseignée » (distinct de 0).</p>

              @if (error(); as e) {
                <p class="bpm-error" role="alert">{{ e.message }}</p>
              }
              <div class="bs-actions">
                <button type="submit" class="btn btn-primary" [disabled]="saving()">{{ saving() ? 'Enregistrement en cours…' : 'Créer le projet' }}</button>
                <button type="button" class="btn btn-secondary" (click)="closeForm()">Annuler</button>
              </div>
            </form>
          </section>
        }

        @if (loadError()) {
          <div class="bpm-error lp-inline" role="alert">
            <span>{{ loadError() }}</span>
            <button type="button" class="btn btn-secondary" (click)="load()">Réessayer</button>
          </div>
        }

        @if (loading() && !projects().length) {
          <p class="bpm-help" role="status">Lecture de vos projets…</p>
        } @else if (!loadError()) {
          <section class="expense-group" aria-labelledby="lp-projects-title">
            <header data-ui-pattern="section-heading">
              <h2 id="lp-projects-title">Vos projets de la vie</h2>
              <p>Ouvrez un projet pour retrouver ses détails, ses tâches et son avancement.</p>
              <small>{{ projects().length }} projet(s) de la vie</small>
            </header>
            @if (!projects().length) {
              <div class="bs-note lp-inline">
                <span>Aucun projet de la vie pour l'instant. Créez-en un pour suivre ses tâches et, à terme, son budget propre.</span>
                @if (!formOpen()) {
                  <button type="button" class="btn btn-primary" (click)="openForm()">Créer mon premier projet</button>
                }
              </div>
            } @else {
              <div class="expense-projects">
                @for (p of projects(); track p.budgetId) {
                  <details class="expense-row expense-project" data-ui-pattern="panel">
                    <summary class="expense-project-summary">
                      <span class="expense-main"
                        ><strong>{{ p.name }}</strong
                        ><small>{{ p.view.time.taskCount }} tâche(s) · {{ p.view.statusLabel }}</small></span
                      >
                      <span class="expense-amount"
                        ><small>Avancement</small><strong>{{ p.view.time.taskCount ? p.view.completionPercent + ' %' : '—' }}</strong></span
                      >
                      <span class="expense-project-totals"
                        ><span>Temps prévu <strong>{{ p.view.time | plannedTotal }}</strong></span
                        ><span>Temps passé <strong>{{ p.view.time.spentHoursTotal | hours }}</strong></span></span
                      >
                      <span class="expense-project-cue">Détails du projet</span>
                    </summary>
                    <div class="expense-body record-details">
                      <h3>{{ p.project.title || p.name }} <span class="status-pill" [attr.data-status]="p.view.status">{{ p.view.statusLabel }}</span></h3>
                      @if (p.project.description) {
                        <p class="expense-prose">{{ p.project.description }}</p>
                      }
                      <dl class="expense-facts record-facts">
                        <div>
                          <dt>Échéance</dt>
                          <dd>{{ p.project.dueDate ? (p.project.dueDate | shortDate) : 'Non renseignée' }}</dd>
                        </div>
                        <div>
                          <dt>Avancement</dt>
                          <dd>{{ p.view.doneCount }} tâche(s) terminée(s) sur {{ p.view.time.taskCount }}</dd>
                        </div>
                        <div>
                          <dt>Temps prévu</dt>
                          <dd>{{ p.view.time | plannedTotal }}</dd>
                        </div>
                        <div>
                          <dt>Temps passé</dt>
                          <dd>{{ p.view.time.spentHoursTotal | hours }}</dd>
                        </div>
                      </dl>
                      <section>
                        <h3>Tâches par état</h3>
                        <ul class="expense-project-list expense-definition-list" aria-label="Tâches par état">
                          <li><strong>À faire · {{ p.view.countsByStatus.todo }}</strong></li>
                          <li><strong>À prioriser · {{ p.view.countsByStatus.blocked }}</strong></li>
                          <li><strong>En cours · {{ p.view.countsByStatus.doing }}</strong></li>
                          <li><strong>Terminées · {{ p.view.countsByStatus.done }}</strong></li>
                        </ul>
                      </section>
                      <p class="bpm-help">{{ p.view.explanation }}</p>
                      <footer>
                        <a class="btn btn-secondary" [routerLink]="['/projects', p.coreProjectId]">Ouvrir dans le noyau →</a>
                        <a class="bpm-link" [routerLink]="['/object-management']" [queryParams]="{ inspect: p.budgetId }">Inspecter le budget</a>
                      </footer>
                    </div>
                  </details>
                }
              </div>
            }
          </section>
        }
      </div>
    </bpm-page>
  `,
  styles: `
    /* Compléments absents des feuilles source (jetons source uniquement). */
    :host { display: block; }
    .lp-page { display: grid; gap: var(--ecart-24); min-width: 0; }
    .lp-inline { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ecart-8) var(--ecart-12); }
    .lp-inline > span { flex: 1 1 16rem; min-width: 0; }
    .lp-form { display: grid; gap: var(--ecart-20); min-width: 0; }
    .bs-options.lp-tasks { grid-template-columns: minmax(0, 1fr); }
    .lp-task-list { display: grid; gap: var(--ecart-8); margin: 0; padding: 0; list-style: none; }
    .lp-task { display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(0, 8rem) auto; align-items: center; gap: var(--ecart-8); padding: var(--ecart-10) var(--ecart-14); border: var(--trait-1) solid var(--line); border-radius: var(--card-radius); background: var(--raised-surface); }
    .lp-task:focus-within { border-color: var(--app-accent); }
    .lp-task .bs-field { max-width: none; }
    .lp-task .bs-field :is(input) { min-height: var(--dim-48); font-size: var(--fs-md); }
    .lp-task-num { display: grid; place-items: center; width: var(--dim-24); height: var(--dim-24); border-radius: var(--rayon-999); background: var(--app-accent-soft); color: var(--app-accent); font-size: var(--fs-xs); font-weight: var(--fw-bold); }
    .lp-add { justify-self: start; }
    .expense-body h3 .status-pill { margin-inline-start: var(--ecart-8); vertical-align: middle; }
    .expense-body > footer { grid-column: 1 / -1; }
    .expense-body > .bpm-help { grid-column: 1 / -1; margin: 0; }
    @media (max-width: 480px) {
      .lp-task { grid-template-columns: minmax(0, 1fr) minmax(0, 6rem) auto; }
      .lp-task-num { display: none; }
    }
  `,
})
export class BpmLifeProjects implements OnInit {
  private api = inject(Api);
  private bpmApi = inject(BpmApi);
  /** Contexte du bandeau commun (user, périmètre, période, date de calcul), en lecture seule. */
  protected summary = bpmLoader(
    () => 0,
    () => this.bpmApi.summary(),
  );

  protected projects = signal<LifeProject[]>([]);
  protected loading = signal(true);
  protected loadError = signal<string | null>(null);
  protected notice = signal<{ text: string; projectId?: string } | null>(null);

  protected formOpen = signal(false);
  protected name = signal('');
  protected description = signal('');
  protected dueDate = signal('');
  protected tasks = signal<DraftTask[]>([]);
  protected saving = signal(false);
  protected error = signal<ApiError | null>(null);
  private requestKey = newRequestKey();
  private nextUid = 1;

  constructor() {
    this.resetForm();
  }

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.projects.set(await this.api.lifeProjects());
    } catch (err) {
      this.loadError.set(toApiError(err).message);
    } finally {
      this.loading.set(false);
    }
  }

  private blankTask(): DraftTask {
    return { uid: this.nextUid++, title: '', hours: '' };
  }

  private resetForm() {
    this.name.set('');
    this.description.set('');
    this.dueDate.set('');
    this.tasks.set([this.blankTask()]);
    this.error.set(null);
  }

  openForm() {
    this.formOpen.set(true);
    setTimeout(() => document.getElementById('lp-name')?.focus());
  }

  /** La saisie est conservée : rouvrir le formulaire la retrouve, avec la même clé de demande. */
  closeForm() {
    this.formOpen.set(false);
    this.error.set(null);
  }

  addTask() {
    const t = this.blankTask();
    this.tasks.update((list) => [...list, t]);
    setTimeout(() => document.getElementById('lp-task-' + t.uid)?.focus());
  }

  removeTask(uid: number) {
    this.tasks.update((list) => (list.length > 1 ? list.filter((t) => t.uid !== uid) : list));
  }

  setTask(uid: number, field: 'title' | 'hours', value: string) {
    this.tasks.update((list) => list.map((t) => (t.uid === uid ? { ...t, [field]: value } : t)));
  }

  private invalid(message: string, field: string) {
    this.error.set(new ApiError(400, { code: 'VALIDATION', action: null, message, details: { field } }));
  }

  async submit() {
    const name = this.name().trim();
    if (!name) return this.invalid('Donnez un nom au projet.', 'name');

    const rows = this.tasks().filter((t) => t.title.trim() || t.hours.trim());
    const tasks: { title: string; plannedHours: number | null }[] = [];
    for (const [i, t] of rows.entries()) {
      if (!t.title.trim()) return this.invalid(`La tâche ${i + 1} a des heures prévues mais pas de titre.`, `tasks[${i}].title`);
      const h = parseHours(t.hours);
      if (h === 'invalid') return this.invalid(`Heures prévues de « ${t.title.trim()} » : un nombre positif, ou vide.`, `tasks[${i}].plannedHours`);
      tasks.push({ title: t.title.trim(), plannedHours: h });
    }
    if (!tasks.length) return this.invalid('Un projet de la vie se crée avec au moins une tâche.', 'tasks');

    const description = this.description().trim();
    this.saving.set(true);
    this.error.set(null);
    try {
      const r = await this.api.createLifeProject({
        requestKey: this.requestKey,
        name,
        project: { title: name, description, dueDate: this.dueDate() || null },
        tasks,
      });
      this.requestKey = newRequestKey();
      this.resetForm();
      this.formOpen.set(false);
      this.notice.set({ text: `Projet « ${name} » créé avec ${tasks.length} tâche(s)${r.replayed ? ' (déjà reçu)' : ''}.`, projectId: r.coreProjectId });
      await this.load();
    } catch (err) {
      this.error.set(toApiError(err));
    } finally {
      this.saving.set(false);
    }
  }
}
