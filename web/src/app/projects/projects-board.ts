import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, toApiError } from '../core/api.service';
import { COLUMNS, PRIORITY_LABEL, ProjectSummary, TaskStatus } from '../core/models';
import { HoursPipe, PlannedTotalPipe } from '../core/format';
import {
  displayDate,
  dueTitle,
  dueUrgency,
  FilterOption,
  ItemBoardToolsComponent,
  ItemSummaryComponent,
  normalizeSearch,
} from './workspace-parts';

/**
 * Projets du noyau, ventilés par statut sur le gabarit de la référence (`section-home.page.ts`,
 * `item-summary`, `item-board-tools`, `project-filter`, `item-board`, styles `_workspace.scss`).
 * L'état d'un projet est calculé depuis ses tâches : les cartes ne se déplacent pas.
 * Le filtre projet (`project`) et la recherche (`q`) sont gardés dans l'URL.
 */
@Component({
  selector: 'app-projects-board',
  imports: [RouterLink, HoursPipe, PlannedTotalPipe, ItemSummaryComponent, ItemBoardToolsComponent],
  template: `
    <div class="page page-wide landing-page section-home">
      <div class="section-home-top">
        <header class="section-home-hero">
          <div class="section-home-banner" data-ui-pattern="heading">
            <p class="eyebrow"><span class="eyebrow-line"></span>Projets</p>
            <h1 class="display">Projets</h1>
            <p class="page-intro">
              Créez un projet, puis suivez ses tâches, ses échéances et son budget. L'état d'un projet est calculé
              depuis toutes ses tâches : seul le changement d'état d'une tâche le fait évoluer.
            </p>
          </div>
          <rjs-item-summary kind="project" [remaining]="remaining()" [counts]="counts()" [progress]="progress()" />
          <rjs-item-board-tools
            kind="project"
            createLink="/projects/new"
            createLabel="Nouveau projet"
            [filterOptions]="filterOptions()"
            [filter]="filter()"
            (filterChange)="setParams({ project: $event === 'all' ? null : $event })"
            [search]="search()"
            (searchChange)="setParams({ q: $event || null })"
          />
        </header>
      </div>

      <div class="section-home-board">
        @if (error()) {
          <div class="empty-state" role="alert">
            <h2>Projets indisponibles</h2>
            <p>{{ error() }}</p>
            <button class="btn btn-secondary" type="button" (click)="load()">Réessayer</button>
          </div>
        } @else if (loading()) {
          <div class="empty-state" role="status"><h2>Chargement des projets…</h2></div>
        } @else {
          @if (search().trim()) {
            <p class="board-result-count" role="status">
              {{ visible().length }} résultat(s) pour « {{ search().trim() }} » dans le filtre courant.
            </p>
          }
          <section class="board" aria-label="Tableau des projets">
            @for (col of columns; track col.id) {
              <div class="board-column" [attr.data-column]="col.id">
                <div class="board-column-head">
                  <div>
                    <span class="status-dot" [attr.data-status]="col.id"></span>
                    <h3 class="status-heading">{{ col.label }}</h3>
                  </div>
                  @if (col.id !== 'done') {
                    <span class="count-badge">{{ byColumn()[col.id].length }}</span>
                  }
                </div>
                <div class="board-column-content">
                  @for (p of byColumn()[col.id]; track p.project.id) {
                    @let done = p.view.column === 'done';
                    <article class="card task-card" [attr.data-urgency]="urgency(p.project.dueDate, done)">
                      <h4>
                        <a
                          class="task-title-link"
                          [routerLink]="['/projects', p.project.id]"
                          [queryParams]="{ project: filter() === 'all' ? null : filter(), q: search() || null }"
                          [attr.title]="p.project.title"
                          >{{ p.project.title }}</a
                        >
                      </h4>
                      <p class="task-card-description" [attr.title]="p.project.description || null">
                        {{ p.project.description }}
                      </p>
                      <div class="task-card-follow-up">
                        @if (p.project.startDate) {
                          <span [attr.title]="'Début prévu · ' + date(p.project.startDate)"
                            >Début prévu · {{ date(p.project.startDate) }}</span
                          >
                        }
                        <p [attr.title]="'État ' + p.view.explanation"><strong>État</strong> {{ p.view.explanation }}</p>
                        <p>
                          <strong>Tâches</strong> {{ p.view.doneCount }}/{{ p.view.time.taskCount }} terminées ·
                          {{ p.view.completionPercent }} %
                        </p>
                        <p>
                          <strong>Temps</strong> {{ p.view.time | plannedTotal }} prévu ·
                          {{ p.view.time.spentHoursTotal | hours }} consommé
                        </p>
                      </div>
                      <div class="task-card-meta">
                        <span>{{ 'Priorité ' + priority[p.project.priority].toLowerCase() }}</span
                        ><span
                          class="due-date"
                          [attr.data-urgency]="urgency(p.project.dueDate, done)"
                          [attr.title]="dueTitle(p.project.dueDate, done)"
                          >{{ p.project.dueDate ? date(p.project.dueDate) : 'Sans échéance' }}</span
                        >
                        @if (p.enrichment) {
                          <span class="task-card-badge" [attr.title]="p.enrichment.label">{{ p.enrichment.label }}</span>
                        }
                      </div>
                      <!-- Le statut d'un projet est calculé : il se lit ici, au même endroit que le sélecteur d'une tâche. -->
                      <p class="status-change">
                        Statut
                        <span class="status-value" [attr.data-status]="p.view.status"
                          ><span class="status-dot" [attr.data-status]="p.view.status"></span>{{ p.view.statusLabel }}</span
                        >
                      </p>
                      <div class="task-card-links">
                        @if (p.pathways.canAddTask) {
                          <a class="text-link task-card-edit" routerLink="/tasks/new" [queryParams]="{ projectId: p.project.id }"
                            >Ajouter une tâche</a
                          >
                        }
                        <a class="text-link task-card-edit" [routerLink]="['/projects', p.project.id, 'edit']">Modifier le projet</a>
                      </div>
                    </article>
                  } @empty {
                    <div class="board-empty">Aucun projet ici</div>
                  }
                </div>
              </div>
            }
          </section>
        }
        <nav class="board-nav" aria-label="Changer de section">
          <a routerLink="/tasks" class="text-link">Parcourir les tâches <span aria-hidden="true">↗</span></a>
        </nav>
      </div>
    </div>
  `,
  styles: `
    .task-card-links { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--ecart-8); margin-top: var(--ecart-12); }
    .task-card-links .task-card-edit { margin: 0; }
  `,
})
export class ProjectsBoard implements OnInit {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  protected columns = COLUMNS;
  protected priority = PRIORITY_LABEL;
  protected readonly date = displayDate;
  protected readonly urgency = dueUrgency;
  protected readonly dueTitle = dueTitle;
  protected projects = signal<ProjectSummary[]>([]);
  protected loading = signal(true);
  protected error = signal<string | null>(null);
  private params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  protected search = computed(() => this.params().get('q') ?? '');
  protected filter = computed(() => this.params().get('project') || 'all');

  protected filterOptions = computed<FilterOption[]>(() => [
    { value: 'all', label: 'Tous les projets' },
    ...this.projects().map((p) => ({ value: p.project.id, label: p.project.title })),
  ]);
  protected visible = computed(() => {
    const q = normalizeSearch(this.search().trim());
    const f = this.filter();
    return this.projects().filter(
      (p) =>
        (f === 'all' || p.project.id === f) &&
        (!q || normalizeSearch(`${p.project.title} ${p.project.description} ${p.project.id}`).includes(q)),
    );
  });
  protected byColumn = computed(() => {
    const groups = Object.fromEntries(COLUMNS.map((c) => [c.id, [] as ProjectSummary[]])) as Record<TaskStatus, ProjectSummary[]>;
    for (const p of this.visible()) groups[p.view.column].push(p);
    return groups;
  });
  protected counts = computed(() => {
    const counts: Partial<Record<TaskStatus, number>> = {};
    for (const p of this.projects()) counts[p.view.column] = (counts[p.view.column] ?? 0) + 1;
    return counts;
  });
  protected remaining = computed(() => this.projects().filter((p) => p.view.column !== 'done').length);
  protected progress = computed(() => {
    const all = this.projects();
    return all.length ? Math.round((100 * all.filter((p) => p.view.column === 'done').length) / all.length) : 0;
  });

  ngOnInit() {
    this.load();
  }

  async load() {
    this.error.set(null);
    try {
      this.projects.set(await this.api.projects());
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected setParams(patch: { project?: string | null; q?: string | null }) {
    this.router.navigate([], { queryParams: patch, queryParamsHandling: 'merge', replaceUrl: true });
  }
}
