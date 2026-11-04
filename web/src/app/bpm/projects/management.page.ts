import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api, newRequestKey, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import {
  BpmProjectCard,
  BpmProjectsOverview,
  BpmTaskCard,
  BpmTasksOverview,
  ProjectOverrun,
  TaskBudgetRequest,
} from '../../core/bpm-projects.models';
import { CoreProject, PRIORITY_LABEL, TaskStatus } from '../../core/models';
import { CentsPipe, parseAmount, ShortDatePipe } from '../../core/format';
import { BpmOverrunRequestComponent, BpmTaskRequestsComponent } from './project-parts';
import { BpmProjectEditor, BpmTaskEditor } from './project-editors';
import { BpmProjectMetricsComponent } from './project-metrics';
import { BpmManagedTaskComponent, TaskFundingSubmission } from './managed-task';

@Component({
  selector: 'app-bpm-project-management',
  imports: [
    RouterLink,
    CentsPipe,
    ShortDatePipe,
    BpmProjectMetricsComponent,
    BpmManagedTaskComponent,
    BpmOverrunRequestComponent,
    BpmTaskRequestsComponent,
    BpmProjectEditor,
    BpmTaskEditor,
  ],
  template: `
    <div class="page page-wide bpm-projects bpm-project-page bpm-management">
      <header class="bpm-project-head">
        <p class="eyebrow">
          <span class="eyebrow-line"></span>Budget/Patrimoine · Mes projets de la vie
        </p>
        <h1>Gestion de projet</h1>
        <p class="page-intro">
          Donnez un cadre à chaque projet de la vie : préparez ses tâches, attribuez son budget,
          puis validez les montants dont les tâches ont besoin.
        </p>
        <div class="bpm-actions">
          <button
            class="btn btn-primary"
            type="button"
            [disabled]="!data()"
            (click)="openProject()"
          >
            Créer un projet de la vie
          </button>
          <button class="btn btn-secondary" type="button" [disabled]="!data()" (click)="openTask()">
            Créer une tâche
          </button>
          <a class="text-link" routerLink="/app/projets">Tableau des projets ↗</a>
          <a class="text-link" routerLink="/app/taches">Tableau des tâches ↗</a>
        </div>
      </header>
      @if (notice(); as n) {
        <p
          class="bpm-feedback"
          [class.is-error]="n.error"
          [attr.role]="n.error ? 'alert' : 'status'"
        >
          {{ n.text }}
        </p>
      }
      @if (error()) {
        <div class="empty-state" role="alert">
          <h2>Gestion de projet indisponible</h2>
          <p>{{ error() }}</p>
          <button class="btn btn-secondary" type="button" (click)="load()">Réessayer</button>
        </div>
      } @else if (!data()) {
        <p role="status">Chargement des projets et des tâches…</p>
      }
      @if (data(); as d) {
        <section class="bpm-panel bpm-management-summary" aria-labelledby="life-context-title">
          <div class="bpm-section">
            <header>
              <h2 id="life-context-title">Le budget de votre projet de vie</h2>
              <a
                class="text-link"
                [routerLink]="['/app/projets', d.context.lifeBudget.coreProjectId]"
                >Voir le projet de vie ↗</a
              >
            </header>
            <p class="bpm-note">
              {{ d.context.user.label }} · Un projet de vie unique finance
              {{ d.life.projectCount }} projet(s) de la vie. Les sommes ci-dessous concernent les
              projets ayant un budget attribué.
            </p>
            <dl class="bpm-kpis">
              <div>
                <dt>Attribué aux projets</dt>
                <dd>{{ d.life.allocatedCents | cents }}</dd>
              </div>
              <div>
                <dt>Ventilé aux tâches</dt>
                <dd>{{ d.life.sharesCents | cents }}</dd>
              </div>
              <div>
                <dt>Encore à ventiler</dt>
                <dd>{{ d.life.availableCents | cents }}</dd>
              </div>
              <div>
                <dt>Consommé toutes périodes</dt>
                <dd>{{ d.life.paidCents | cents }}</dd>
              </div>
              <div>
                <dt>Reste à consommer</dt>
                <dd>{{ d.life.remainingCents | cents }}</dd>
              </div>
              <div>
                <dt>Remonté dans le cycle actuel</dt>
                <dd>{{ d.life.periodPaidCents | cents }}</dd>
                <small>{{ d.context.period?.label ?? 'Cycle à configurer' }}</small>
              </div>
            </dl>
            @if (d.context.cycleState === 'to_configure') {
              <p class="bpm-note">
                Configurez le cycle pour dater les remontées et la facturation de fin de cycle.
                <a routerLink="/app/reglages">Configurer le cycle</a>
              </p>
            }
          </div>
        </section>

        <section class="bpm-section" aria-labelledby="management-projects-title">
          <header>
            <h2 id="management-projects-title">Vos projets de la vie</h2>
            <span class="bpm-note"
              >{{ d.life.fundedCount }} financé(s) sur {{ d.life.projectCount }}</span
            >
          </header>
          <div class="bpm-inline-form bpm-management-filters">
            <label
              >Rechercher un projet<input
                type="search"
                [value]="search()"
                (input)="search.set($any($event.target).value)"
                placeholder="Nom ou description"
            /></label>
            <label
              >Suivi<select [value]="filter()" (change)="filter.set($any($event.target).value)">
                <option value="all">Tous les projets</option>
                <option value="open">À poursuivre</option>
                <option value="unfunded">Budget à attribuer</option>
                <option value="done">Terminés</option>
                <option value="deficit">En dépassement</option>
              </select></label
            >
          </div>
          <div class="bpm-management-grid">
            @for (p of visibleProjects(); track p.project.id) {
              <article
                class="bpm-panel bpm-management-card"
                [class.is-expanded]="expandedProjects().has(p.project.id)"
                [attr.data-budget-state]="p.budget?.state"
                [attr.aria-label]="'Projet ' + p.project.title"
              >
                <div class="bpm-project-row-summary">
                  <div class="bpm-project-links">
                    <span
                      class="status-value pm-project-status"
                      [attr.data-status]="p.view.status"
                      >{{ p.view.statusLabel }}</span
                    ><span class="pm-project-priority" [attr.data-priority]="p.project.priority"
                      >Priorité {{ priority[p.project.priority].toLowerCase() }}</span
                    >
                  </div>
                  <h3>
                    <a [routerLink]="['/app/gestion-projet', p.project.id]">{{
                      p.project.title
                    }}</a>
                  </h3>
                  <p class="pm-project-description" [class.is-empty]="!p.project.description">
                    <span>{{ p.project.description || 'Description non renseignée.' }}</span>
                  </p>
                  <dl class="pm-project-facts">
                    <div>
                      <dt>Tâches terminées</dt>
                      <dd>
                        {{ p.view.doneCount }} <small>/ {{ p.view.time.taskCount }}</small>
                      </dd>
                      <small>{{ p.view.completionPercent }} % du projet</small>
                    </div>
                    <div>
                      <dt>Début</dt>
                      <dd>
                        {{ p.project.startDate ? (p.project.startDate | shortDate) : 'À définir' }}
                      </dd>
                    </div>
                    <div>
                      <dt>Échéance</dt>
                      <dd>
                        {{ p.project.dueDate ? (p.project.dueDate | shortDate) : 'À définir' }}
                      </dd>
                    </div>
                  </dl>
                </div>
                @if (p.budget; as b) {
                  <div class="bpm-project-row-budget">
                    <bpm-project-metrics [budget]="b" [time]="p.view.time" />
                  </div>
                  @if (b.pendingOverrun) {
                    <p class="pm-project-alert">
                      Autorisation du projet de vie attendue :
                      {{ b.pendingOverrun.amountCents | cents }}.
                    </p>
                  }
                }
                <div
                  class="bpm-actions bpm-project-row-actions"
                  [attr.aria-label]="'Actions du projet ' + p.project.title"
                >
                  <a class="btn btn-primary" [routerLink]="['/app/gestion-projet', p.project.id]"
                    >Piloter ce projet</a
                  >
                  <button
                    class="btn btn-secondary"
                    type="button"
                    [disabled]="busy()"
                    (click)="openProject(p.project)"
                  >
                    Modifier le projet
                  </button>
                  <button
                    class="btn btn-secondary"
                    type="button"
                    [disabled]="busy()"
                    (click)="openTask(p.project.id)"
                  >
                    Ajouter une tâche
                  </button>
                  <button
                    class="btn btn-secondary"
                    type="button"
                    [disabled]="busy() || !availableTasks().length"
                    [attr.aria-expanded]="attachProjectId() === p.project.id"
                    (click)="
                      attachProjectId.set(attachProjectId() === p.project.id ? '' : p.project.id)
                    "
                  >
                    Rattacher une tâche
                  </button>
                  <button
                    class="btn btn-secondary"
                    type="button"
                    [disabled]="busy()"
                    [attr.aria-expanded]="allocationProjectId() === p.project.id"
                    (click)="
                      allocationProjectId.set(
                        allocationProjectId() === p.project.id ? '' : p.project.id
                      )
                    "
                  >
                    {{ p.budget?.regime ? 'Modifier le budget' : 'Attribuer un budget' }}
                  </button>
                </div>
                @if (allocationProjectId() === p.project.id && p.budget; as b) {
                  <form
                    class="bpm-inline-form bpm-project-row-editor"
                    (submit)="
                      $event.preventDefault();
                      allocate(p, $any($event.target).elements.amount.value)
                    "
                  >
                    <label
                      >Montant total attribué au projet (€)<input
                        name="amount"
                        inputmode="decimal"
                        required
                        [value]="
                          b.allocationCents === null
                            ? ''
                            : (b.allocationCents / 100).toString().replace('.', ',')
                        "
                    /></label>
                    <button class="btn btn-primary" type="submit" [disabled]="busy()">
                      Enregistrer le budget
                    </button>
                    <button
                      class="btn btn-secondary"
                      type="button"
                      (click)="allocationProjectId.set('')"
                    >
                      Annuler
                    </button>
                    <p class="bpm-note">
                      L’attribution ne crée aucune dépense ; les règlements validés seront remontés
                      au budget du projet de vie.
                    </p>
                  </form>
                }
                @if (attachProjectId() === p.project.id) {
                  <form
                    class="bpm-inline-form bpm-project-row-editor"
                    (submit)="
                      $event.preventDefault();
                      attachById($any($event.target).elements.taskId.value, p.project.id)
                    "
                  >
                    <label
                      >Tâche à rattacher<select name="taskId" required>
                        <option value="">Choisir une tâche</option>
                        @for (t of availableTasks(); track t.task.id) {
                          <option [value]="t.task.id">
                            {{ t.task.title }}
                          </option>
                        }
                      </select></label
                    >
                    <button class="btn btn-primary" type="submit" [disabled]="busy()">
                      Rattacher au projet
                    </button>
                    <button
                      class="btn btn-secondary"
                      type="button"
                      (click)="attachProjectId.set('')"
                    >
                      Annuler
                    </button>
                  </form>
                }
                <button
                  type="button"
                  class="pm-project-disclosure"
                  [attr.aria-expanded]="expandedProjects().has(p.project.id)"
                  [attr.aria-controls]="'project-tasks-' + p.project.id"
                  (click)="toggleTasks(p.project.id)"
                >
                  <span
                    ><strong>Détail du projet & tâches</strong
                    ><span
                      >{{ p.view.time.taskCount }} tâche(s)
                      @if (requestCount(p.project.id)) {
                        · {{ requestCount(p.project.id) }} demande(s) en attente
                      }
                    </span></span
                  >
                  <span class="pm-disclosure-sign" aria-hidden="true">{{
                    expandedProjects().has(p.project.id) ? '−' : '+'
                  }}</span>
                </button>
                @if (expandedProjects().has(p.project.id)) {
                  <div
                    class="pm-project-tasks"
                    [id]="'project-tasks-' + p.project.id"
                    [attr.aria-label]="'Tâches de ' + p.project.title"
                  >
                    @if (p.budget; as b) {
                      <div class="pm-project-detail">
                        <div class="pm-project-finance">
                          <p class="pm-detail-eyebrow">Du budget du projet aux tâches</p>
                          <dl class="pm-finance-summary">
                            <div>
                              <dt>Ventilé aux tâches</dt>
                              <dd>{{ b.sharesCents | cents }}</dd>
                            </div>
                            <div>
                              <dt>Encore à ventiler</dt>
                              <dd>{{ b.availableCents | cents }}</dd>
                            </div>
                            <div>
                              <dt>Réglé dans le cycle</dt>
                              <dd>{{ b.periodPaidCents | cents }}</dd>
                              <small>{{ d.context.period?.label ?? 'Cycle à configurer' }}</small>
                            </div>
                          </dl>
                          <details class="pm-finance-details">
                            <summary>Tous les chiffres du projet</summary>
                            <dl class="bpm-row-figures">
                              <div>
                                <dt>Budget attribué</dt>
                                <dd>{{ b.allocationCents | cents }}</dd>
                              </div>
                              <div>
                                <dt>Dépassement autorisé</dt>
                                <dd>{{ b.approvedOverrunCents | cents }}</dd>
                              </div>
                              <div>
                                <dt>Engagé en dépenses</dt>
                                <dd>{{ b.engagedCents | cents }}</dd>
                              </div>
                              <div>
                                <dt>Consommé / réglé</dt>
                                <dd>{{ b.paidCents | cents }}</dd>
                              </div>
                              <div>
                                <dt>Reste à consommer</dt>
                                <dd>{{ b.remainingCents | cents }}</dd>
                              </div>
                              <div>
                                <dt>Encore à régler</dt>
                                <dd>{{ b.toPayCents | cents }}</dd>
                              </div>
                              <div>
                                <dt>Supplément demandé</dt>
                                <dd>{{ b.pendingRequestsCents | cents }}</dd>
                              </div>
                            </dl>
                            @if (b.nextBillingDate) {
                              <p class="bpm-note">
                                Facturation de fin de cycle : {{ b.nextBillingDate | shortDate }}.
                              </p>
                            }
                          </details>
                        </div>
                        <aside
                          class="pm-side-panel"
                          [attr.aria-label]="'Suivi du projet ' + p.project.title"
                        >
                          <p class="pm-detail-eyebrow">Suivi du projet</p>
                          <a
                            class="btn btn-secondary"
                            [routerLink]="['/app/gestion-projet', p.project.id]"
                            fragment="charges-title"
                            aria-label="Dépenses et règlements du projet"
                            >Dépenses ↗</a
                          >
                          <a
                            class="btn btn-secondary"
                            [routerLink]="['/app/gestion-projet', p.project.id]"
                            fragment="cycle-title"
                            aria-label="Contrôles de fin de cycle"
                            >Fin de cycle ↗</a
                          >
                        </aside>
                      </div>
                    }
                    <header class="pm-task-list-head">
                      <div>
                        <h4>Les tâches du projet</h4>
                        <p class="bpm-note">
                          Chaque tâche demande sa part du budget et suit sa consommation.
                        </p>
                      </div>
                      <button
                        type="button"
                        class="btn btn-secondary"
                        [disabled]="busy()"
                        (click)="openTask(p.project.id)"
                      >
                        + Ajouter une tâche
                      </button>
                    </header>
                    <ol class="pm-task-list">
                      @for (
                        t of tasksByProject().get(p.project.id) ?? [];
                        track t.task.id;
                        let index = $index
                      ) {
                        <li>
                          <span class="pm-task-index" aria-hidden="true">{{ index + 1 }}</span>
                          <bpm-managed-task
                            [task]="t"
                            [funded]="p.budget?.regime ?? false"
                            [busy]="busy()"
                            [overrun]="taskOverrun(t)"
                            (edit)="
                              editingTask.set($event);
                              taskProjectId.set(p.project.id);
                              taskEditor.set(true)
                            "
                            (detach)="detach($event)"
                            (status)="changeTaskStatus($event)"
                            (request)="requestTaskBudget($event)"
                            (decide)="decideRequest($event)"
                            (decideOverrun)="decideOverrun($event.overrun, $event.decision)"
                          />
                        </li>
                      } @empty {
                        <li class="pm-tasks-empty">
                          <p>
                            Ce projet n’a pas encore de tâche. Créez-en une ou rattachez une tâche
                            préparée séparément avec les boutons du projet.
                          </p>
                          <button
                            class="btn btn-primary"
                            type="button"
                            (click)="openTask(p.project.id)"
                          >
                            Créer la première tâche
                          </button>
                        </li>
                      }
                    </ol>
                  </div>
                }
              </article>
            } @empty {
              <div class="bpm-panel">
                <h3>
                  {{
                    d.projects.length
                      ? 'Aucun projet pour ce filtre'
                      : 'Votre premier projet de la vie'
                  }}
                </h3>
                <p>
                  Créez un projet maintenant ; ses tâches et son financement peuvent être définis
                  ensuite.
                </p>
                <button class="btn btn-primary" type="button" (click)="openProject()">
                  Créer un projet de la vie
                </button>
              </div>
            }
          </div>
          @if (d.candidates.length) {
            <details class="bpm-panel">
              <summary>
                Rattacher un projet déjà créé dans le noyau ({{ d.candidates.length }})
              </summary>
              <form class="bpm-inline-form" (submit)="$event.preventDefault(); adopt()">
                <label
                  >Projet à budgéter<select
                    [value]="candidate()"
                    (change)="candidate.set($any($event.target).value)"
                  >
                    <option value="">Choisir un projet</option>
                    @for (p of d.candidates; track p.projectId) {
                      <option [value]="p.projectId">
                        {{ p.title }} · {{ p.taskCount }} tâche(s)
                      </option>
                    }
                  </select></label
                >
                <button type="submit" class="btn btn-secondary" [disabled]="busy() || !candidate()">
                  Créer son budget de projet
                </button>
              </form>
            </details>
          }
        </section>

        <section class="bpm-section" aria-labelledby="task-inbox-title">
          <header>
            <h2 id="task-inbox-title">Demandes de montant des tâches</h2>
            <span class="count-badge">{{ d.life.taskRequests.length }}</span>
          </header>
          <p class="bpm-note">
            Validez le montant total demandé. Le budget du projet accorde la part disponible ; s’il
            manque de fonds, une autorisation de dépassement est demandée au budget du projet de
            vie.
          </p>
          <bpm-task-requests
            [requests]="d.life.taskRequests"
            [busy]="busy()"
            (decide)="decideRequest($event)"
          />
        </section>

        <section class="bpm-section" aria-labelledby="life-decisions-title">
          <header><h2 id="life-decisions-title">Décisions du budget du projet de vie</h2></header>
          @for (o of d.life.pendingRequests; track o.id) {
            <bpm-overrun-request
              [overrun]="o"
              [busy]="busy()"
              (decide)="decideOverrun(o, $event)"
            />
          }
          @if (!d.life.pendingRequests.length) {
            <p class="bpm-note">Aucune autorisation de dépassement en attente.</p>
          }
          @if (d.life.approvedOverrunCents) {
            <p class="bpm-note">
              {{ d.life.approvedOverrunCents | cents }} autorisés, à facturer en fin de cycle.
              {{
                d.life.nextBillingDate
                  ? 'Prochaine date : ' + (d.life.nextBillingDate | shortDate)
                  : ''
              }}
            </p>
          }
          @if (d.life.billable.length) {
            <div class="bpm-actions">
              <button class="btn btn-primary" type="button" [disabled]="busy()" (click)="bill()">
                Facturer les dépassements au projet de vie ({{ d.life.billableCents | cents }})
              </button>
            </div>
          }
        </section>

        <section class="bpm-section" aria-labelledby="unlinked-tasks-title">
          <header>
            <h2 id="unlinked-tasks-title">Tâches à rattacher</h2>
            <button type="button" class="btn btn-secondary" (click)="openTask()">
              Créer une tâche sans projet
            </button>
          </header>
          <p class="bpm-note">
            Retrouvez uniquement les tâches sans projet disponibles pour le rattachement. Elles
            conservent leur identité et leur temps lorsqu’elles rejoignent un projet.
          </p>
          <div class="bpm-table-wrap">
            <table class="bpm-table">
              <thead>
                <tr>
                  <th>Tâche</th>
                  <th>Actuellement</th>
                  <th>Temps prévu / consommé</th>
                  <th>Rattacher à un projet de la vie</th>
                </tr>
              </thead>
              <tbody>
                @for (t of availableTasks(); track t.task.id) {
                  <tr>
                    <th>
                      <button
                        type="button"
                        class="text-link"
                        (click)="editingTask.set(t); taskEditor.set(true)"
                      >
                        {{ t.task.title }}
                      </button>
                    </th>
                    <td>{{ t.projectTitle || 'Sans projet' }}</td>
                    <td>{{ t.task.plannedHours ?? 'Non estimé' }} h / {{ t.task.spentHours }} h</td>
                    <td>
                      <form
                        class="bpm-inline-form"
                        (submit)="
                          $event.preventDefault();
                          attach(t, $any($event.target).elements.projectId.value)
                        "
                      >
                        <label
                          ><span class="visually-hidden">Projet de {{ t.task.title }}</span
                          ><select name="projectId" required>
                            <option value="">Choisir un projet</option>
                            @for (p of projectOptions(); track p.projectId) {
                              <option [value]="p.projectId">{{ p.title }}</option>
                            }
                          </select></label
                        ><button
                          type="submit"
                          class="btn btn-secondary"
                          [disabled]="busy() || !d.projects.length || !t.pathways.canChangeProject"
                        >
                          Rattacher
                        </button>
                      </form>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="4">Aucune tâche en attente de rattachement.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    </div>
    @if (projectEditor()) {
      <bpm-project-editor
        [project]="editingProject()"
        (closed)="projectEditor.set(false)"
        (saved)="created($event.projectId)"
      />
    }
    @if (taskEditor()) {
      <bpm-task-editor
        [task]="editingTask()"
        [projects]="projectOptions()"
        [defaultProjectId]="taskProjectId()"
        (closed)="closeTask()"
        (saved)="taskSaved($event)"
      />
    }
  `,
})
export class BpmProjectManagementPage implements OnInit {
  private bpm = inject(BpmApi);
  private api = inject(Api);
  private router = inject(Router);
  private sequence = 0;
  protected data = signal<BpmProjectsOverview | null>(null);
  protected tasks = signal<BpmTasksOverview | null>(null);
  protected availableTasks = computed(() =>
    (this.tasks()?.attachable ?? []).filter(
      (t) => !t.task.projectId && t.pathways.canChangeProject,
    ),
  );
  protected error = signal('');
  protected busy = signal(false);
  protected notice = signal<{ text: string; error: boolean } | null>(null);
  protected projectEditor = signal(false);
  protected taskEditor = signal(false);
  protected editingTask = signal<BpmTaskCard | null>(null);
  protected search = signal('');
  protected filter = signal('all');
  protected candidate = signal('');
  protected editingProject = signal<CoreProject | null>(null);
  protected taskProjectId = signal('');
  protected allocationProjectId = signal('');
  protected attachProjectId = signal('');
  protected expandedProjects = signal(new Set<string>());
  protected tasksByProject = computed(() => {
    const groups = new Map<string, BpmTaskCard[]>();
    for (const task of this.tasks()?.tasks ?? []) {
      const id = task.task.projectId;
      if (id) {
        const group = groups.get(id) ?? [];
        group.push(task);
        groups.set(id, group);
      }
    }
    return groups;
  });
  protected priority = PRIORITY_LABEL;
  protected projectOptions = computed(() =>
    (this.data()?.projects ?? []).map((p) => ({ projectId: p.project.id, title: p.project.title })),
  );
  protected visibleProjects = computed(() => {
    const q = this.search().trim().toLocaleLowerCase('fr');
    return (this.data()?.projects ?? []).filter(
      (p) =>
        (!q || `${p.project.title} ${p.project.description}`.toLocaleLowerCase('fr').includes(q)) &&
        (this.filter() === 'all' ||
          (this.filter() === 'open' && p.view.column !== 'done') ||
          (this.filter() === 'done' && p.view.column === 'done') ||
          (this.filter() === 'unfunded' && !p.budget?.regime) ||
          (this.filter() === 'deficit' && p.budget?.deficit)),
    );
  });
  ngOnInit() {
    this.load();
  }
  async load() {
    const sequence = ++this.sequence;
    try {
      const [data, tasks] = await Promise.all([
        this.bpm.projectsOverview(),
        this.bpm.tasksOverview(),
      ]);
      if (sequence !== this.sequence) return;
      this.data.set(data);
      this.tasks.set(tasks);
      this.error.set('');
    } catch (err) {
      if (sequence === this.sequence) this.error.set(toApiError(err).message);
    }
  }
  private async run(action: () => Promise<unknown>, success: string) {
    if (this.busy()) return;
    this.busy.set(true);
    this.notice.set(null);
    try {
      await action();
      await this.load();
      this.notice.set({ text: success, error: false });
    } catch (err) {
      await this.load();
      this.notice.set({ text: toApiError(err).message, error: true });
    } finally {
      this.busy.set(false);
    }
  }
  protected openProject(project: CoreProject | null = null) {
    this.editingProject.set(project);
    this.projectEditor.set(true);
  }
  protected openTask(projectId = '') {
    this.editingTask.set(null);
    this.taskProjectId.set(projectId);
    this.taskEditor.set(true);
  }
  protected created(projectId: string) {
    this.projectEditor.set(false);
    if (this.editingProject()) {
      this.load();
      this.notice.set({ text: 'Projet enregistré.', error: false });
    } else this.router.navigate(['/app/gestion-projet', projectId]);
  }
  protected closeTask() {
    this.taskEditor.set(false);
    this.editingTask.set(null);
  }
  protected taskSaved(text: string) {
    const projectId = this.taskProjectId();
    if (projectId && !this.editingTask()) {
      this.expandedProjects.update((current) => new Set([...current, projectId]));
    }
    this.closeTask();
    this.load();
    this.notice.set({ text, error: false });
  }
  protected async attach(t: BpmTaskCard, projectId: string): Promise<void> {
    if (projectId)
      await this.run(
        () => this.api.attachTask(t.task.id, projectId, t.task.revision),
        `Tâche « ${t.task.title} » rattachée au projet.`,
      );
  }
  protected async attachById(taskId: string, projectId: string) {
    const t = this.availableTasks().find((t) => t.task.id === taskId);
    if (t) {
      await this.attach(t, projectId);
      this.attachProjectId.set('');
    }
  }
  protected async allocate(p: BpmProjectCard, raw: string) {
    const amount = parseAmount(raw);
    if (!p.budget || amount === null || amount === 'invalid' || amount < 0) {
      this.notice.set({
        text: 'Indiquez un montant positif ou nul, en euros avec deux décimales au plus.',
        error: true,
      });
      return;
    }
    await this.run(
      () => this.bpm.allocate(p.budget!.budgetId, amount, p.budget!.revision),
      'Budget du projet enregistré.',
    );
  }
  protected requestCount(projectId: string) {
    return this.data()?.life.taskRequests.filter((r) => r.coreProjectId === projectId).length ?? 0;
  }
  protected toggleTasks(projectId: string) {
    this.expandedProjects.update((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }
  protected taskOverrun(task: BpmTaskCard) {
    return (
      this.data()?.life.pendingRequests.find((o) => o.id === task.budget?.request?.overrunId) ??
      null
    );
  }
  protected requestTaskBudget(input: TaskFundingSubmission) {
    const budgetId = input.task.budgetId;
    if (!budgetId) return;
    return this.run(async () => {
      await this.bpm.requestTaskBudget(budgetId, input.task.task.id, {
        requestKey: input.requestKey,
        amount: input.amount,
        note: input.note,
      });
      input.onAccepted?.();
    }, `Demande de « ${input.task.task.title} » envoyée au budget du projet. Validez-la dans la tâche.`);
  }
  protected detach(task: BpmTaskCard) {
    return this.run(
      () => this.api.detachTask(task.task.id, task.task.revision),
      `Tâche « ${task.task.title} » détachée du projet.`,
    );
  }
  protected changeTaskStatus(input: { task: BpmTaskCard; status: TaskStatus }) {
    return this.run(
      () => this.api.changeTaskStatus(input.task.task.id, input.status, input.task.task.revision),
      'État de la tâche enregistré ; l’avancement du projet a été recalculé.',
    );
  }
  protected adopt() {
    return this.run(
      () => this.bpm.adoptProject({ coreProjectId: this.candidate(), requestKey: newRequestKey() }),
      'Le projet dispose maintenant de son budget. Ouvrez sa fiche pour lui attribuer un montant.',
    );
  }
  protected decideRequest(e: {
    request: TaskBudgetRequest;
    decision: 'approve' | 'refuse' | 'cancel';
  }) {
    const revision = this.data()?.projects.find((p) => p.budget?.budgetId === e.request.budgetId)
      ?.budget?.revision;
    return this.run(
      () => this.bpm.decideTaskBudget(e.request.id, e.decision, e.request.revision, revision),
      e.decision === 'approve'
        ? 'Décision enregistrée : part accordée, ou autorisation transmise au budget du projet de vie si le budget est insuffisant.'
        : 'Demande traitée.',
    );
  }
  protected decideOverrun(o: ProjectOverrun, decision: 'approve' | 'refuse') {
    return this.run(
      () => this.bpm.decideOverrun(o.id, decision, o.revision),
      decision === 'approve'
        ? 'Dépassement autorisé ; la demande de la tâche a été réexaminée et sa part accordée si les fonds sont disponibles.'
        : 'Dépassement refusé ; la demande associée est refusée.',
    );
  }
  protected bill() {
    return this.run(
      () => this.bpm.billOverruns(),
      'Dépassements intégrés aux budgets attribués, sans compter une seconde fois les dépenses réglées. Les contrôles sont disponibles dans chaque projet.',
    );
  }
}
