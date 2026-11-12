import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, toApiError } from '../core/api.service';
import { COLUMNS, PRIORITY_LABEL, ProjectDetail, TASK_STATUS_LABEL } from '../core/models';
import { HoursPipe, PlannedTotalPipe } from '../core/format';
import { displayDate, displayTimestamp, dueTitle, dueUrgency } from './workspace-parts';

/**
 * Fiche projet sur le gabarit de la référence (`projects.page.ts`, vue détail) : en-tête de page compact
 * fixé sous la barre du site, puis la fiche — cadre, plan (tâches), budget — et son pied d'audit.
 * Tous les chiffres viennent de la projection API ; la page ne recalcule pas l'état du projet.
 */
import { publishObjectLabel } from '../plan/plan-context';
@Component({
  selector: 'app-project-detail',
  imports: [RouterLink, HoursPipe, PlannedTotalPipe],
  template: `
    <div class="page">
      <header class="page-head page-head-compact">
        <div>
          <div class="page-hero-title">
            <h1 class="display">{{ d()?.project?.title || 'Projets' }}</h1>
            <p class="eyebrow"><span class="eyebrow-line"></span>Projet</p>
          </div>
          <p class="lead">Retrouvez l’objectif, les tâches, les dates et le budget de chaque projet.</p>
        </div>
        <div class="site-page-tools">
          <a class="btn btn-secondary" routerLink="/projects" [queryParams]="listQueryParams()">← Retour aux projets</a>
          @if (d(); as d) {
            <div class="project-detail-actions">
              <a class="text-link" [routerLink]="['/projects', d.project.id, 'edit']">Modifier le projet</a>
              @if (d.pathways.canAddTask) {
                <a class="text-link" routerLink="/tasks/new" [queryParams]="{ projectId: d.project.id }">Ajouter une tâche à ce projet</a>
              }
              <!-- Le noyau porte la racine ; l'application qui l'enrichit s'ouvre d'un clic. -->
              @if (d.enrichment; as e) {
                <a class="text-link" [routerLink]="e.kind === 'life' ? ['/projet-de-vie'] : ['/app/gestion-projet', d.project.id]">Ouvrir dans Budget/Patrimoine ↗</a>
              }
            </div>
          }
        </div>
        @if (d(); as d) {
          <nav class="detail-section-nav site-page-tools" aria-label="Dans ce projet">
            <a
              [routerLink]="[]"
              queryParamsHandling="preserve"
              fragment="project-overview"
              [attr.aria-current]="activeSection() === 'project-overview' ? 'location' : null"
              ><span>01</span> Le cadre du projet</a
            >
            <a
              [routerLink]="[]"
              queryParamsHandling="preserve"
              fragment="project-plan"
              [attr.aria-current]="activeSection() === 'project-plan' ? 'location' : null"
              ><span>02</span> Le plan · {{ d.tasks.length }} {{ d.tasks.length === 1 ? 'tâche' : 'tâches' }}</a
            >
            @if (d.enrichment) {
              <a
                [routerLink]="[]"
                queryParamsHandling="preserve"
                fragment="project-budgets"
                [attr.aria-current]="activeSection() === 'project-budgets' ? 'location' : null"
                ><span>03</span> Le budget du projet</a
              >
            }
          </nav>
        }
      </header>

      @if (error()) {
        <div class="empty-state" role="alert">
          <div class="empty-mark">!</div>
          <h2>Projet indisponible</h2>
          <p>{{ error() }}</p>
          <button class="btn btn-secondary" type="button" (click)="load()">Réessayer</button>
          <a class="btn btn-secondary" routerLink="/projects">Retour aux projets</a>
        </div>
      } @else if (d(); as d) {
        @let done = d.view.column === 'done';
        <article class="project-detail project-detail-shell entity-detail">
          <div class="detail-head">
            <span class="project-code">{{ d.project.id }}</span>
            <div class="detail-badges">
              <span class="status-pill" [attr.data-status]="d.view.status">{{ d.view.statusLabel }}</span>
              <span class="priority-pill">Priorité {{ priority[d.project.priority].toLowerCase() }}</span>
              @if (d.enrichment) {
                <span class="priority-pill" [attr.title]="d.enrichment.label">{{ d.enrichment.label }}</span>
              }
            </div>
          </div>

          <h2 id="project-overview">Le cadre du projet</h2>

          <p class="detail-flow-hint">{{ d.view.explanation }}</p>

          @if (d.view.time.taskCount === 0) {
            <p class="detail-estimate-note"><strong>Aucune tâche</strong> — aucune réalisation n'est annoncée.</p>
          } @else {
            <div class="detail-progress">
              <div>
                <strong>Progression · {{ d.view.completionPercent }} %</strong>
                <span>
                  {{ d.view.doneCount }} sur {{ d.view.time.taskCount }}
                  {{ d.view.time.taskCount === 1 ? 'tâche terminée' : 'tâches terminées' }} ·
                  {{ d.view.time.taskCount - d.view.doneCount }} à suivre — non pondéré par la durée
                </span>
              </div>
              <div
                class="progress-track"
                role="progressbar"
                [attr.aria-label]="'Progression du projet ' + d.project.title"
                aria-valuemin="0"
                aria-valuemax="100"
                [attr.aria-valuenow]="d.view.completionPercent"
              >
                <span [style.width.%]="d.view.completionPercent"></span>
              </div>
            </div>
          }

          <div class="detail-meta">
            <div><span>Début prévu</span><strong>{{ date(d.project.startDate) }}</strong></div>
            <div>
              <span>Échéance cible</span>
              <strong
                class="due-date"
                [attr.data-urgency]="urgency(d.project.dueDate, done)"
                [attr.title]="dueTitle(d.project.dueDate, done)"
                >{{ date(d.project.dueDate) }}</strong
              >
            </div>
            <div><span>Colonne</span><strong>{{ d.view.columnLabel }}</strong></div>
            <div><span>Dernière modification</span><strong>{{ timestamp(d.project.updatedAt) }}</strong></div>
          </div>

          <div class="detail-content-grid">
            <section class="detail-panel detail-panel-wide">
              <p class="eyebrow">Résumé et périmètre</p>
              <p class="detail-copy" [class.is-empty]="!d.project.description">
                {{ d.project.description || 'Non renseigné' }}
              </p>
            </section>
            <section class="detail-panel">
              <p class="eyebrow">État expliqué</p>
              <div class="detail-task-facts">
                @for (c of columns; track c.id) {
                  <span><small>{{ c.label }}</small><strong>{{ d.view.countsByStatus[c.id] }}</strong></span>
                }
              </div>
              <p class="field-hint detail-panel-note">Calcul sur toutes les tâches rattachées, sans effet des filtres de lecture.</p>
            </section>
            <section class="detail-panel">
              <p class="eyebrow">Temps</p>
              <div class="detail-task-facts">
                <span><small>Prévu</small><strong>{{ d.view.time | plannedTotal }}</strong></span>
                <span
                  ><small>Couverture des estimations</small
                  ><strong>{{ d.view.time.estimatedTaskCount }}/{{ d.view.time.taskCount }} tâche(s)</strong></span
                >
                <span><small>Consommé</small><strong>{{ d.view.time.spentHoursTotal | hours }}</strong></span>
                @if (d.view.time.spentToPlannedPercent !== null) {
                  <span><small>Usage du temps prévu</small><strong>{{ d.view.time.spentToPlannedPercent }} %</strong></span>
                }
              </div>
              <p class="field-hint detail-panel-note">L'usage du temps prévu est une information ; il ne remplace pas la complétude.</p>
            </section>
          </div>

          <div id="project-plan" class="section-heading detail-section-heading">
            <div>
              <p class="eyebrow">Plan du projet</p>
              <h3>Tâches <span class="task-count">· {{ d.tasks.length }}</span></h3>
            </div>
            <a routerLink="/tasks" [queryParams]="{ project: d.project.id }" class="text-link"
              >Ouvrir les tâches <span aria-hidden="true">↗</span></a
            >
          </div>

          @if (!d.tasks.length) {
            <div class="detail-empty">
              Aucune tâche pour le moment.
              @if (d.pathways.canAddTask) {
                <a class="text-link" routerLink="/tasks/new" [queryParams]="{ projectId: d.project.id }">Ajouter la première tâche à ce projet</a>
              }
            </div>
          } @else {
            <div class="detail-task-list">
              @for (t of d.tasks; track t.task.id) {
                @let taskDone = t.task.status === 'done';
                <article class="detail-task">
                  <span class="task-check" [class.checked]="taskDone">{{ taskDone ? '✓' : '' }}</span>
                  <div class="detail-task-body">
                    <span class="project-code">{{ t.task.id }}</span>
                    <strong>
                      <a class="task-title-link" [routerLink]="['/tasks', t.task.id, 'edit']" [attr.aria-label]="'Modifier la tâche ' + t.task.title">{{
                        t.task.title
                      }}</a>
                    </strong>
                    @if (t.task.description) {
                      <p class="detail-task-description">{{ t.task.description }}</p>
                    }
                    @if (t.qualification.code === 'budgetedProjectTask') {
                      <p class="detail-task-follow-up"><b>Qualification ·</b> {{ t.qualification.label }}</p>
                    }
                  </div>
                  <div class="detail-task-side">
                    <div class="detail-task-facts">
                      <span><small>Date prévue</small><strong>{{ date(t.task.startDate) }}</strong></span>
                      <span
                        ><small>Échéance</small
                        ><strong
                          class="due-date"
                          [attr.data-urgency]="urgency(t.task.dueDate, taskDone)"
                          [attr.title]="dueTitle(t.task.dueDate, taskDone)"
                          >{{ date(t.task.dueDate) }}</strong
                        ></span
                      >
                      <span><small>Prévu</small><strong>{{ t.task.plannedHours | hours }}</strong></span>
                      <span><small>Consommé</small><strong>{{ t.task.spentHours | hours }}</strong></span>
                    </div>
                    <div class="detail-task-controls">
                      <span class="status-pill" [attr.data-status]="t.task.status">{{ taskLabel[t.task.status] }}</span>
                      <a
                        class="btn btn-secondary detail-task-open"
                        [routerLink]="['/tasks', t.task.id, 'edit']"
                        [attr.aria-label]="'Modifier la tâche ' + t.task.title"
                        >Modifier ↗</a
                      >
                    </div>
                  </div>
                </article>
              }
            </div>
          }

          @if (d.enrichment; as e) {
            <div id="project-budgets" class="detail-anchor-section">
              <div class="section-heading detail-section-heading">
                <div>
                  <p class="eyebrow">Contexte d'enrichissement</p>
                  <h3>Le budget du projet</h3>
                </div>
              </div>
              <section class="detail-project-context" aria-labelledby="project-budget-title">
                <div>
                  <p class="eyebrow">{{ e.kind === 'life' ? 'Budget principal (projet de vie)' : 'Budget standard (projet de la vie)' }}</p>
                  <h3 id="project-budget-title">{{ e.budgetName }}</h3>
                  <p><code>{{ e.budgetId }}</code></p>
                </div>
                <div class="detail-project-facts">
                  <span><small>Nature</small><strong>{{ e.label }}</strong></span>
                  @if (e.parentBudgetId) {
                    <span
                      ><small>Budget père</small><strong>{{ e.parentBudgetName }} <code>{{ e.parentBudgetId }}</code></strong></span
                    >
                  }
                  @if (e.patrimoineId) {
                    <span><small>Patrimoine</small><strong><code>{{ e.patrimoineId }}</code> (même racine noyau)</strong></span>
                  }
                </div>
              </section>
              <div class="detail-content-grid">
                @if (d.pathways.note) {
                  <section class="detail-panel detail-panel-wide">
                    <p class="eyebrow">Parcours</p>
                    <p class="detail-copy">{{ d.pathways.note }}</p>
                  </section>
                }
                @if (e.kind === 'life') {
                  <section class="detail-panel detail-panel-wide">
                    <p class="eyebrow">Branches (projets de la vie)</p>
                    <p class="detail-copy">
                      La racine principale peut n'avoir aucune tâche directe : cela ne signifie ni un cycle inactif ni un projet
                      de vie terminé.
                    </p>
                    @if (d.branches.length) {
                      <ul class="detail-branches">
                        @for (b of d.branches; track b.budgetId) {
                          <li>
                            <a class="text-link" [routerLink]="['/projects', b.coreProjectId]">{{ b.projectTitle }}</a> — Budget
                            {{ b.budgetName }}
                          </li>
                        }
                      </ul>
                    }
                  </section>
                }
                <section class="detail-panel detail-panel-wide">
                  <p class="eyebrow">Montants</p>
                  <p class="detail-copy is-empty">
                    Montants provisionnés, consommés et revenus : non implémentés dans J1 (décisions A-FIN ouvertes).
                  </p>
                </section>
              </div>
            </div>
          }

          <nav class="detail-footer-nav" aria-label="Revenir dans le projet">
            <a class="text-link" [routerLink]="[]" queryParamsHandling="preserve" fragment="project-plan">↑ Revenir au plan du projet</a>
            <a class="text-link" [routerLink]="[]" queryParamsHandling="preserve" fragment="project-overview">↑ Haut de la fiche</a>
          </nav>

          <footer class="detail-audit">
            <span>Créé le {{ timestamp(d.project.createdAt) }}</span>
            <span>Mis à jour le {{ timestamp(d.project.updatedAt) }}</span>
          </footer>
        </article>
      } @else {
        <div class="empty-state" role="status">
          <div class="empty-mark">R</div>
          <h2>Chargement du projet…</h2>
        </div>
      }
    </div>
  `,
  styles: `
    .detail-panel-note { margin-top: var(--ecart-12); }
    .detail-branches { margin: var(--ecart-12) 0 0; padding-left: var(--ecart-20); display: grid; gap: var(--ecart-6); }
    .detail-empty .text-link { margin-left: var(--ecart-8); }
  `,
})
export class ProjectDetailPage implements OnInit {
  readonly id = input.required<string>();
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  protected columns = COLUMNS;
  protected priority = PRIORITY_LABEL;
  protected taskLabel = TASK_STATUS_LABEL;
  protected readonly date = displayDate;
  protected readonly timestamp = displayTimestamp;
  protected readonly urgency = dueUrgency;
  protected readonly dueTitle = dueTitle;
  protected d = signal<ProjectDetail | null>(null);
  /** Le parcours, le fil d'Ariane et l'onglet nomment le projet ouvert, comme les fiches BPM. */
  private readonly framed = publishObjectLabel(() => '/projects/' + this.id(), () => this.d()?.project.title);
  protected error = signal<string | null>(null);
  private queryParams = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  private fragment = toSignal(this.route.fragment);
  /** Le retour au tableau conserve le filtre et la recherche d'où l'on vient. */
  protected listQueryParams = computed(() => ({
    project: this.queryParams().get('project'),
    q: this.queryParams().get('q'),
  }));
  protected activeSection = computed(() => this.fragment() || 'project-overview');

  ngOnInit() {
    this.load();
  }

  async load() {
    this.error.set(null);
    try {
      this.d.set(await this.api.project(this.id()));
    } catch (err) {
      this.error.set(toApiError(err).message);
    }
  }
}
