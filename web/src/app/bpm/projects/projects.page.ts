import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { newRequestKey, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmProjectCard, BpmProjectsOverview, ProjectOverrun } from '../../core/bpm-projects.models';
import { COLUMNS, PRIORITY_LABEL, TaskStatus } from '../../core/models';
import { CentsPipe, ShortDatePipe } from '../../core/format';
import { displayDate, dueTitle, dueUrgency, FilterOption, ItemBoardToolsComponent, ItemSummaryComponent, normalizeSearch } from '../../projects/workspace-parts';
import { BpmBudgetMeterComponent, BpmOverrunRequestComponent } from './project-parts';

/**
 * Projets de la vie : réimplémentation, dans Budget/Patrimoine, du tableau des projets du noyau (mêmes colonnes,
 * mêmes cartes, état calculé depuis les tâches), limitée au projet de vie et aux projets standards du user, et
 * enrichie du budget que le budget de vie attribue à chacun. Les projets viennent du noyau : la création y reste.
 */
@Component({
  selector: 'app-bpm-projects',
  imports: [RouterLink, CentsPipe, ShortDatePipe, ItemSummaryComponent, ItemBoardToolsComponent, BpmBudgetMeterComponent, BpmOverrunRequestComponent],
  template: `
    <div class="page page-wide landing-page section-home bpm-projects">
      <div class="section-home-top">
        <header class="section-home-hero">
          <div class="section-home-banner" data-ui-pattern="heading">
            <p class="eyebrow"><span class="eyebrow-line"></span>Budget/Patrimoine · Projets de la vie</p>
            <h1 class="display">Projets de la vie</h1>
            <p class="page-intro">
              Votre projet de vie et ses projets standards. Le budget de vie attribue un montant à chaque projet, qui le
              ventile sur ses tâches. Les projets et les tâches viennent du noyau : créez-les dans le noyau, financez-les ici.
            </p>
          </div>
          <rjs-item-summary kind="project" [remaining]="remaining()" [counts]="counts()" [progress]="progress()" />
          <rjs-item-board-tools
            kind="project"
            createLink="/projects/new"
            createLabel="Créer un projet dans le noyau"
            [filterOptions]="filterOptions()"
            [filter]="filter()"
            (filterChange)="setParams({ project: $event === 'all' ? null : $event })"
            [search]="search()"
            (searchChange)="setParams({ q: $event || null })"
          />
        </header>

        <aside class="bpm-life-panel" aria-labelledby="bpm-life-title">
          <h2 id="bpm-life-title">Budget de vie</h2>
          @if (data(); as d) {
            <p>
              Le budget attribué figure dans le budget de vie comme une charge non récurrente ; il n’entre dans ses dépenses
              qu’à la validation des dépenses réglées de chaque projet.
            </p>
            <dl class="bpm-life-figures">
              <div><dt>Attribué aux projets</dt><dd>{{ d.life.allocatedCents | cents }}</dd></div>
              <div><dt>Réglé validé</dt><dd>{{ d.life.paidCents | cents }}</dd></div>
              <div [class.is-danger]="d.life.approvedOverrunCents > 0">
                <dt>Dépassements autorisés</dt><dd>{{ d.life.approvedOverrunCents | cents }}</dd>
              </div>
              <div><dt>Projets financés</dt><dd>{{ d.life.fundedCount }} / {{ d.life.projectCount }}</dd></div>
            </dl>
            @for (o of d.life.pendingRequests; track o.id) {
              <bpm-overrun-request [overrun]="o" [busy]="busy()" (decide)="decide(o, $event)" />
            }
            @if (d.life.billable.length) {
              <div class="bpm-overrun">
                <p>
                  <strong>Fin de cycle :</strong> {{ d.life.billableCents | cents }} de dépassement(s) autorisé(s) à facturer
                  au budget de vie.
                </p>
                <div class="bpm-actions">
                  <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="bill()">Facturer au budget de vie</button>
                </div>
              </div>
            } @else if (d.life.nextBillingDate) {
              <p>Prochaine facturation des dépassements : fin du cycle, le {{ d.life.nextBillingDate | shortDate }}.</p>
            }
            @if (d.candidates.length) {
              <form class="bpm-adopt" (submit)="$event.preventDefault(); adopt()">
                <label>
                  Financer un projet du noyau
                  <select [value]="candidate()" (change)="candidate.set($any($event.target).value)">
                    <option value="">Choisir un projet…</option>
                    @for (c of d.candidates; track c.projectId) {
                      <option [value]="c.projectId">{{ c.title }} ({{ c.taskCount }} tâche{{ c.taskCount > 1 ? 's' : '' }})</option>
                    }
                  </select>
                </label>
                <button type="submit" class="btn btn-secondary" [disabled]="busy() || !candidate()">Budgéter</button>
              </form>
            }
          } @else {
            <p>Lecture du budget de vie…</p>
          }
        </aside>
      </div>

      <div class="section-home-board">
        @if (notice(); as n) {
          <p class="bpm-feedback" [class.is-error]="n.error" [attr.role]="n.error ? 'alert' : 'status'">{{ n.text }}</p>
        }
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
            <p class="board-result-count" role="status">{{ visible().length }} résultat(s) pour « {{ search().trim() }} » dans le filtre courant.</p>
          }
          <section class="board" aria-label="Tableau des projets de la vie">
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
                    <article class="card task-card" [attr.data-urgency]="urgency(p.project.dueDate, done)" [attr.data-budget-state]="p.budget?.state ?? null">
                      <h4>
                        <a class="task-title-link" [routerLink]="['/app/projets', p.project.id]" [attr.title]="p.project.title">{{ p.project.title }}</a>
                      </h4>
                      <p class="task-card-description" [attr.title]="p.project.description || null">{{ p.project.description }}</p>
                      @if (p.budget) {
                        <bpm-budget-meter [budget]="p.budget" [compact]="true" [showState]="true" />
                      } @else if (data(); as d) {
                        <div class="bpm-task-budget">
                          <span>Budget de vie · <strong>{{ d.life.allocatedCents | cents }}</strong> attribués aux projets</span>
                        </div>
                      }
                      <div class="task-card-meta">
                        <span>{{ 'Priorité ' + priority[p.project.priority].toLowerCase() }}</span
                        ><span class="due-date" [attr.data-urgency]="urgency(p.project.dueDate, done)" [attr.title]="dueTitle(p.project.dueDate, done)">{{
                          p.project.dueDate ? date(p.project.dueDate) : 'Sans échéance'
                        }}</span
                        ><span [attr.title]="progressTitle(p)">{{ progressLabel(p) }}</span>
                        @if (p.role === 'life') {
                          <span class="task-card-badge" title="Racine du Budget « Projet de vie » et du Patrimoine">Projet de vie</span>
                        }
                      </div>
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
        <nav class="board-nav" aria-label="Changer de section">
          <a routerLink="/app/taches" class="text-link">Parcourir les tâches des projets <span aria-hidden="true">↗</span></a>
          <a routerLink="/projects" class="text-link">Projets du noyau <span aria-hidden="true">↗</span></a>
        </nav>
      </div>
    </div>
  `,
})
export class BpmProjectsPage implements OnInit {
  private bpm = inject(BpmApi);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  protected columns = COLUMNS;
  protected priority = PRIORITY_LABEL;
  protected readonly date = displayDate;
  protected readonly urgency = dueUrgency;
  protected readonly dueTitle = dueTitle;
  protected data = signal<BpmProjectsOverview | null>(null);
  protected loading = signal(true);
  protected error = signal<string | null>(null);
  protected busy = signal(false);
  protected notice = signal<{ text: string; error: boolean } | null>(null);
  protected candidate = signal('');
  private params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  protected search = computed(() => this.params().get('q') ?? '');
  protected filter = computed(() => this.params().get('project') || 'all');

  /** Projet de vie et projets standards : seuls projets du user présentés ici. */
  private cards = computed<BpmProjectCard[]>(() => {
    const d = this.data();
    return d ? [d.lifeProject, ...d.projects] : [];
  });
  protected filterOptions = computed<FilterOption[]>(() => [
    { value: 'all', label: 'Tous les projets de la vie' },
    ...this.cards().map((p) => ({ value: p.project.id, label: p.project.title })),
  ]);
  protected visible = computed(() => {
    const q = normalizeSearch(this.search().trim());
    const f = this.filter();
    return this.cards().filter((p) => (f === 'all' || p.project.id === f) && (!q || normalizeSearch(`${p.project.title} ${p.project.description} ${p.project.id}`).includes(q)));
  });
  protected byColumn = computed(() => {
    const groups = Object.fromEntries(COLUMNS.map((c) => [c.id, [] as BpmProjectCard[]])) as Record<TaskStatus, BpmProjectCard[]>;
    for (const p of this.visible()) groups[p.view.column].push(p);
    return groups;
  });
  protected counts = computed(() => {
    const counts: Partial<Record<TaskStatus, number>> = {};
    for (const p of this.cards()) counts[p.view.column] = (counts[p.view.column] ?? 0) + 1;
    return counts;
  });
  protected remaining = computed(() => this.cards().filter((p) => p.view.column !== 'done').length);
  protected progress = computed(() => {
    const all = this.cards();
    return all.length ? Math.round((100 * all.filter((p) => p.view.column === 'done').length) / all.length) : 0;
  });

  ngOnInit() {
    this.load();
  }

  async load() {
    this.error.set(null);
    try {
      this.data.set(await this.bpm.projectsOverview());
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected setParams(patch: { project?: string | null; q?: string | null }) {
    this.router.navigate([], { queryParams: patch, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected progressLabel(p: BpmProjectCard): string {
    const open = p.view.time.taskCount - p.view.doneCount;
    return `${open} ${open === 1 ? 'tâche' : 'tâches'} à suivre`;
  }
  protected progressTitle(p: BpmProjectCard): string {
    return `${p.view.doneCount}/${p.view.time.taskCount} tâches terminées · ${p.view.completionPercent} %`;
  }

  private async run(action: () => Promise<unknown>, success: string) {
    this.busy.set(true);
    this.notice.set(null);
    try {
      await action();
      await this.load();
      this.notice.set({ text: success, error: false });
    } catch (err) {
      const e = toApiError(err);
      await this.load();
      this.notice.set({ text: e.isConflict ? 'Conflit : la donnée a changé ailleurs. La page a été relue ; recommencez si besoin.' : e.message, error: true });
    } finally {
      this.busy.set(false);
    }
  }

  protected decide(o: ProjectOverrun, decision: 'approve' | 'refuse') {
    return this.run(
      () => this.bpm.decideOverrun(o.id, decision, o.revision),
      decision === 'approve' ? `Dépassement autorisé pour « ${o.budgetName} » : le projet passe en dépassement jusqu’à la facturation de fin de cycle.` : `Demande refusée pour « ${o.budgetName} ».`,
    );
  }

  protected bill() {
    return this.run(() => this.bpm.billOverruns(), 'Dépassements facturés au budget de vie : les budgets attribués les intègrent. Ouvrez chaque projet pour relire ses contrôles de fin de cycle.');
  }

  protected adopt() {
    const id = this.candidate();
    const title = this.data()?.candidates.find((c) => c.projectId === id)?.title ?? '';
    return this.run(async () => {
      await this.bpm.adoptProject({ requestKey: newRequestKey(), coreProjectId: id });
      this.candidate.set('');
    }, `« ${title} » est maintenant un projet standard du budget de vie : attribuez-lui un montant depuis sa fiche.`);
  }
}
