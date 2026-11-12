import { injectPageWorkspace } from '../plan/page-workspace';
import { PageHeroDirective } from '../shared/page-hero.directive';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, toApiError } from '../core/api.service';
import { COLUMNS, PRIORITY_LABEL, ProjectSummary, TaskStatus } from '../core/models';
import { HoursPipe, PlannedTotalPipe } from '../core/format';
import { CalendarRange, inRange, rangeFrom } from '../calendar/calendar-dates';
import { MiniCalendarComponent } from '../calendar/mini-calendar';
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
 * `item-summary`, `item-board-tools`, `project-filter`, `mini-calendar`, `item-board`, styles `_workspace.scss`).
 * L'état d'un projet est calculé depuis ses tâches : les cartes ne se déplacent pas.
 * Le filtre projet (`project`), la recherche (`q`) et le créneau de lecture du calendrier (`du`, `au`) sont gardés
 * dans l'URL. Le créneau suit la règle de la référence : seuls les projets dont la date de début est comprise
 * entre ses bornes sont affichés et comptés ; il ne réécrit aucune date.
 */
@Component({
  selector: 'app-projects-board',
  imports: [PageHeroDirective, RouterLink, HoursPipe, PlannedTotalPipe, ItemSummaryComponent, ItemBoardToolsComponent, MiniCalendarComponent],
  template: `
    <div class="page page-wide landing-page section-home">
      <div class="section-home-top" rjsPageHero #pageHero="pageHero" data-ui-pattern="heading">
        <header class="section-home-hero">
          <div class="section-home-banner">
            <p class="eyebrow"><span class="eyebrow-line"></span>Projets</p>
            <h1 class="display">{{ workspace()?.title || 'Projets' }}</h1>
            <p class="page-intro">
              {{ workspace()?.lead || "Créez un projet, puis suivez ses tâches, ses échéances et son budget. L’état d’un projet se calcule depuis ses tâches." }}
            </p>
          </div>
          <rjs-item-summary kind="project" [remaining]="remaining()" [counts]="counts()" [progress]="progress()" />
          <rjs-item-board-tools
            kind="project"
            [compact]="pageHero.compact()"
            [scope]="toolbarScope()"
            createLink="/projects/new"
            createLabel="Nouveau projet"
            [filterOptions]="filterOptions()"
            [filter]="filter()"
            (filterChange)="setParams({ project: $event === 'all' ? null : $event })"
            [search]="search()"
            (searchChange)="setParams({ q: $event || null })"
          >
            <details boardExtra class="board-period-tools">
              <summary>Choisir les dates de début des projets</summary>
        <rjs-mini-calendar
          class="landing-manifesto section-home-calendar"
          kind="project"
          [selectedRange]="range()"
          (rangeChange)="setRange($event)"
        />
            </details>
          </rjs-item-board-tools>
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
          @if (workspace()?.key === 'project-planning') {
            <section aria-label="Planification des projets">
              <div class="bpm-table-wrap"><table class="bpm-table"><thead><tr><th scope="col">Projet</th><th scope="col">Début prévu</th><th scope="col">Échéance</th><th scope="col">Avancement</th><th scope="col">Suite</th></tr></thead><tbody>
                @for (p of planningRows(); track p.project.id) {
                  <tr><td><a [routerLink]="['/projects', p.project.id]">{{ p.project.title }}</a><br /><small>Priorité {{ priority[p.project.priority].toLowerCase() }} · {{ p.view.statusLabel }}</small></td>
                  <td>{{ p.project.startDate ? date(p.project.startDate) : 'À planifier' }}</td><td [attr.data-urgency]="urgency(p.project.dueDate, p.view.column === 'done')">{{ p.project.dueDate ? date(p.project.dueDate) : 'À définir' }}</td>
                  <td>{{ p.view.doneCount }} / {{ p.view.time.taskCount }} tâches · {{ p.view.completionPercent }} %</td>
                  <td><a class="btn btn-secondary" [routerLink]="['/projects', p.project.id, 'edit']">Ajuster les dates</a> <a class="text-link" routerLink="/tasks/new" [queryParams]="{ projectId: p.project.id }">Préparer une tâche →</a></td></tr>
                } @empty { <tr><td colspan="5">Aucun projet dans ce périmètre. Adaptez les dates ou la recherche dans le bandeau.</td></tr> }
              </tbody></table></div>
            </section>
          } @else {
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
                        ><span [attr.title]="progressTitle(p)">{{ progressLabel(p) }}</span>
                        <!-- Pastille de l'application rattachée (référence : badges des satellites), libellé complet au survol. -->
                        @if (p.enrichment) {
                          <span class="task-card-badge" [attr.title]="p.enrichment.label">{{
                            p.enrichment.kind === 'life' ? 'Racine principale' : 'Racine de branche'
                          }}</span>
                        }
                      </div>
                      <!-- Le statut d'un projet est calculé : il se lit ici, au même endroit que le sélecteur d'une tâche ;
                           son explication (tâches qui le déterminent) reste lisible au survol et dans la fiche du projet. -->
                      <p class="status-change">
                        Statut
                        <span class="status-value" [attr.data-status]="p.view.status" [attr.title]="p.view.explanation"
                          ><span class="status-dot" [attr.data-status]="p.view.status"></span>{{ p.view.statusLabel }}</span
                        >
                      </p>
                    </article>
                  } @empty {
                    <div class="board-empty">Aucun projet ici</div>
                  }
                </div>
              </div>
            }
          </section>
          }
        }
        <nav class="board-nav" aria-label="Changer de section">
          <a routerLink="/tasks" class="text-link">Parcourir les tâches <span aria-hidden="true">↗</span></a>
        </nav>
      </div>
    </div>
  `,
})
export class ProjectsBoard implements OnInit {
  protected readonly workspace = injectPageWorkspace();
  protected readonly planningRows = computed(() => [...this.visible()].sort((a, b) =>
    (a.project.dueDate ?? '9999-12-31').localeCompare(b.project.dueDate ?? '9999-12-31') ||
    (a.project.startDate ?? '9999-12-31').localeCompare(b.project.startDate ?? '9999-12-31') ||
    a.project.title.localeCompare(b.project.title, 'fr'),
  ));
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
  /** Créneau de lecture du calendrier miniature (`du`, `au` dans l'URL) ; invalide ou absent : aucun créneau. */
  protected range = computed(() => rangeFrom(this.params().get('du'), this.params().get('au')));
  /** Projets du créneau : base du résumé et du tableau, comme `visibleProjects` dans la référence. */
  private inWindow = computed(() => this.projects().filter((p) => inRange(p.project.startDate, this.range())));

  protected filterOptions = computed<FilterOption[]>(() => [
    { value: 'all', label: 'Tous les projets' },
    ...this.projects().map((p) => ({ value: p.project.id, label: p.project.title })),
  ]);
  protected visible = computed(() => {
    const q = normalizeSearch(this.search().trim());
    const f = this.filter();
    return this.inWindow().filter(
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
  protected toolbarScope = computed(() => {
    const project = this.filterOptions().find((option) => option.value === this.filter())?.label ?? 'Tous les projets';
    const range = this.range();
    return `Sélection · ${project} · ${this.visible().length} / ${this.inWindow().length} projet(s)${range ? ` · Du ${displayDate(range.start)} au ${displayDate(range.end)}` : ''}`;
  });
  protected counts = computed(() => {
    const counts: Partial<Record<TaskStatus, number>> = {};
    for (const p of this.inWindow()) counts[p.view.column] = (counts[p.view.column] ?? 0) + 1;
    return counts;
  });
  protected remaining = computed(() => this.inWindow().filter((p) => p.view.column !== 'done').length);
  protected progress = computed(() => {
    const all = this.inWindow();
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

  protected setParams(patch: { project?: string | null; q?: string | null; du?: string | null; au?: string | null }) {
    this.router.navigate([], { queryParams: patch, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected setRange(range: CalendarRange | null) {
    this.setParams({ du: range?.start ?? null, au: range?.end ?? null });
  }

  /** Repère de la référence (« 3 tâches à suivre ») : tâches non terminées du projet. */
  protected progressLabel(p: ProjectSummary): string {
    const open = p.view.time.taskCount - p.view.doneCount;
    return `${open} ${open === 1 ? 'tâche' : 'tâches'} à suivre`;
  }

  /** Détail au survol du repère : avancement complet du projet. */
  protected progressTitle(p: ProjectSummary): string {
    return `${p.view.doneCount}/${p.view.time.taskCount} tâches terminées · ${p.view.completionPercent} %`;
  }
}
