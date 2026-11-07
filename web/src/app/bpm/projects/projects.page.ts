import { injectPageWorkspace } from '../../shared/page-workspace';
import { BpmPageBanner, BpmPageFocus } from '../ui';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { newRequestKey, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { ProjectFunding } from '../ui/project-funding';
import {
  BpmProjectCard,
  BpmProjectsOverview,
  ProjectOverrun,
} from '../../core/bpm-projects.models';
import { COLUMNS, PRIORITY_LABEL, TaskStatus } from '../../core/models';
import { CentsPipe, ShortDatePipe } from '../../core/format';
import {
  displayDate,
  dueTitle,
  dueUrgency,
  FilterOption,
  normalizeSearch,
} from '../../projects/workspace-parts';
import { BpmProjectOverviewSummaryComponent } from './project-overview-summary';
import { BpmModal } from '../ui/modal';
import { BpmBudgetMeterComponent, BpmOverrunRequestComponent } from './project-parts';

/**
 * Projets de la vie : réimplémentation, dans Budget/Patrimoine, du tableau des projets du noyau (mêmes colonnes,
 * mêmes cartes, état calculé depuis les tâches), limitée au projet de vie et aux projets de la vie du user, et
 * enrichie du budget que le budget de vie attribue à chacun. Les projets viennent du noyau : la création y reste.
 */
@Component({
  selector: 'app-bpm-projects',
  imports: [
    BpmPageBanner,
    BpmProjectOverviewSummaryComponent,
    RouterLink,
    CentsPipe,
    ShortDatePipe,
    BpmModal,
    BpmBudgetMeterComponent,
    BpmOverrunRequestComponent,
  ],
  styleUrl: './projects.page.scss',
  template: `
    <div class="page page-wide landing-page section-home bpm-projects">
      <bpm-page-banner
        class="life-projects-banner"
        title="Projets de la vie"
        lead="Votre projet de vie finance vos projets de la vie. Repérez les projets à préparer, financer ou poursuivre, puis agissez sur leur budget et leurs tâches."
        [focus]="pageFocus()"
        [scope]="toolbarScope()"
        [result]="toolbarResult()"
        toolsLabel="Organiser les projets de la vie"
      >
        <div primary>
          @if (data(); as d) {
            @if (d.life.pendingRequests.length || d.life.billable.length) {
              <button type="button" class="btn btn-primary" (click)="cycleOpen.set(true)">Traiter les autorisations et le cycle</button>
            } @else if (d.life.taskRequests.length) {
              <a class="btn btn-primary" routerLink="/app/gestion-projet" [queryParams]="{ decisions: 'tasks' }">Décider {{ d.life.taskRequests.length }} demande(s)</a>
            } @else if (unfundedCount()) {
              <a class="btn btn-primary" routerLink="/app/gestion-projet" [queryParams]="{ filter: 'unfunded' }">Attribuer {{ unfundedCount() }} enveloppe(s)</a>
            } @else {
              <a class="btn btn-primary" routerLink="/app/gestion-projet/nouveau">＋ Créer un projet de la vie</a>
            }
          } @else { <button type="button" class="btn btn-primary" disabled>Chargement des projets…</button> }
        </div>
        <div actions>
          @if (hasPriorityAction()) {
            <a class="btn btn-secondary life-create" routerLink="/app/gestion-projet/nouveau">＋ Créer un projet de la vie</a>
          }
          @if (data(); as d) {
            @if (!d.life.pendingRequests.length && !d.life.billable.length) {
              <button type="button" class="btn btn-secondary" (click)="cycleOpen.set(true)">Autorisations et cycle</button>
            }
          }
          @if (filter() !== 'all' && visible().length === 1) {
            <a class="btn btn-secondary" [routerLink]="['/app/gestion-projet', visible()[0].project.id]">Piloter ce projet</a>
          }
        </div>
        <div tools class="life-banner-tools">
          <label class="life-filter">
            Afficher les projets
            <select
              [value]="filter()"
              (change)="
                setParams({
                  project: $any($event.target).value === 'all' ? null : $any($event.target).value,
                })
              "
            >
              @for (option of filterOptions(); track option.value) {
                <option [value]="option.value">{{ option.label }}</option>
              }
            </select>
          </label>
          <label class="life-filter">
            Priorité de suivi
            <select
              [value]="attention()"
              (change)="
                setParams({
                  attention: $any($event.target).value === 'all' ? null : $any($event.target).value,
                })
              "
            >
              <option value="all">Tout le suivi</option>
              <option value="open">Projets à poursuivre</option>
              <option value="unfunded">Enveloppe à attribuer ({{ unfundedCount() }})</option>
              <option value="requests">
                Demandes à décider ({{ data()?.life?.taskRequests?.length ?? 0 }})
              </option>
              <option value="deficit">
                En dépassement ({{ data()?.life?.deficitCount ?? 0 }})
              </option>
              <option value="late">Échéance dépassée</option>
            </select>
          </label>
          <label class="life-search">
            Rechercher un projet
            <span class="life-search-field">
              <input
                type="search"
                aria-label="Rechercher un projet"
                placeholder="Nom, description ou référence…"
                [value]="search()"
                (input)="setParams({ q: $any($event.target).value || null })"
              />
              @if (search()) {
                <button
                  type="button"
                  aria-label="Effacer la recherche"
                  title="Effacer la recherche"
                  (click)="setParams({ q: null })"
                >
                  ×
                </button>
              }
            </span>
          </label>
          @if (search() || filter() !== 'all' || attention() !== 'all') {
            <button
              type="button"
              class="btn btn-secondary"
              (click)="setParams({ project: null, q: null, attention: null })"
            >
              Réinitialiser la vue ({{ visible().length }})
            </button>
          }
          <form class="life-budget-project" (submit)="$event.preventDefault(); adopt()">
            <label>
              Projet à budgéter
              <select
                [value]="candidate()"
                [disabled]="busy() || !data()?.candidates?.length"
                (change)="candidate.set($any($event.target).value)"
              >
                <option value="">
                  {{
                    loading()
                      ? 'Chargement…'
                      : data()?.candidates?.length
                        ? 'Choisir un projet…'
                        : 'Aucun projet à budgéter'
                  }}
                </option>
                @for (c of data()?.candidates ?? []; track c.projectId) {
                  <option [value]="c.projectId">
                    {{ c.title }} ({{ c.taskCount }} tâche{{ c.taskCount > 1 ? 's' : '' }})
                  </option>
                }
              </select>
            </label>
            <button type="submit" class="btn btn-secondary" [disabled]="busy() || !candidate()">
              Budgéter
            </button>
          </form>
        </div>
      </bpm-page-banner>

      <bpm-project-overview-summary [data]="data()" [includeLifeProject]="true" />

      @if (cycleOpen()) {
        <bpm-modal
          [open]="cycleOpen()"
          [headed]="true"
          title="Autorisations et fin de cycle"
          [busy]="busy()"
          (closed)="cycleOpen.set(false)"
        >
          @if (data(); as d) {
            <p>
              Le budget du projet de vie autorise les dépassements des projets, puis les intègre en
              fin de cycle.
            </p>
            <p>
              Dépassements autorisés : <strong>{{ d.life.approvedOverrunCents | cents }}</strong>
            </p>
            @if (notice(); as n) {
              <p
                class="bpm-feedback"
                [class.is-error]="n.error"
                [attr.role]="n.error ? 'alert' : 'status'"
              >
                {{ n.text }}
              </p>
            }
            @for (o of d.life.pendingRequests; track o.id) {
              <bpm-overrun-request [overrun]="o" [busy]="busy()" (decide)="decide(o, $event)" />
            }
            @if (d.life.billable.length) {
              <div class="bpm-overrun">
                <p>
                  <strong>Fin de cycle :</strong> {{ d.life.billableCents | cents }} de
                  dépassement(s) autorisé(s) à facturer au budget du projet de vie.
                </p>
                <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="bill()">
                  Facturer au budget du projet de vie
                </button>
              </div>
            } @else if (d.life.nextBillingDate) {
              <p>
                Prochaine facturation des dépassements : fin du cycle, le
                {{ d.life.nextBillingDate | shortDate }}.
              </p>
            } @else if (!d.life.pendingRequests.length) {
              <p>Aucune autorisation ni facturation en attente.</p>
            }
          }
          <div class="bpm-actions">
            <button
              type="button"
              class="btn btn-secondary"
              [disabled]="busy()"
              (click)="cycleOpen.set(false)"
            >
              Fermer
            </button>
          </div>
        </bpm-modal>
      }

      <div class="section-home-board">
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
            <h2>Projets indisponibles</h2>
            <p>{{ error() }}</p>
            <button class="btn btn-secondary" type="button" (click)="load()">Réessayer</button>
          </div>
        } @else if (loading()) {
          <div class="empty-state" role="status"><h2>Chargement des projets…</h2></div>
        } @else {
          @if (search().trim()) {
            <p class="board-result-count" role="status">
              {{ visible().length }} résultat(s) pour « {{ search().trim() }} » dans le filtre
              courant.
            </p>
          }
          @if (workspace()?.key === 'projects-review') {
            <section class="bpm-section" aria-label="Revue des projets">
              <header><h2>Prochaine étape par projet</h2><span>{{ reviewProjects().length }} projet(s)</span></header>
              <div class="bpm-table-wrap"><table class="bpm-table"><thead><tr><th scope="col">Projet</th><th scope="col">Travail</th><th scope="col">Enveloppe</th><th scope="col">Reste à consommer</th><th scope="col">Suite utile</th></tr></thead><tbody>
                @for (p of reviewProjects(); track p.project.id) {
                  <tr><td><a [routerLink]="['/app/gestion-projet', p.project.id]">{{ p.project.title }}</a><br /><small>{{ p.project.dueDate ? 'Échéance · ' + date(p.project.dueDate) : 'Échéance à définir' }}</small></td>
                  <td>{{ p.view.doneCount }} / {{ p.view.time.taskCount }} tâches<br /><small>{{ p.view.statusLabel }}</small></td>
                  <td>{{ p.budget?.allocationCents | cents }}</td><td>{{ p.budget?.remainingCents | cents }}</td>
                  <td><a class="btn btn-secondary" [routerLink]="['/app/gestion-projet', p.project.id, reviewStep(p).page]" queryParamsHandling="preserve">{{ reviewStep(p).label }}</a></td></tr>
                } @empty { <tr><td colspan="5">Aucun projet de la vie dans cette sélection.</td></tr> }
              </tbody></table></div>
            </section>
          } @else {
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
                    <article
                      class="card task-card"
                      [attr.data-urgency]="urgency(p.project.dueDate, done)"
                      [attr.data-budget-state]="p.budget?.state ?? null"
                    >
                      <h4>
                        <a
                          class="task-title-link"
                          [routerLink]="['/app/gestion-projet', p.project.id]"
                          [attr.title]="p.project.title"
                          >{{ p.project.title }}</a
                        >
                      </h4>
                      <p class="task-card-description" [attr.title]="p.project.description || null">
                        {{ p.project.description }}
                      </p>
                      @if (p.budget) {
                        <bpm-budget-meter [budget]="p.budget" [compact]="true" [showState]="true" />
                      } @else if (data(); as d) {
                        <div class="bpm-task-budget">
                          <span
                            >Budget du projet de vie ·
                            <strong>{{ d.life.allocatedCents | cents }}</strong> attribués aux
                            projets</span
                          >
                        </div>
                      }
                      <div class="task-card-meta">
                        <span>{{ 'Priorité ' + priority[p.project.priority].toLowerCase() }}</span
                        ><span
                          class="due-date"
                          [attr.data-urgency]="urgency(p.project.dueDate, done)"
                          [attr.title]="dueTitle(p.project.dueDate, done)"
                          >{{ p.project.dueDate ? date(p.project.dueDate) : 'Sans échéance' }}</span
                        ><span [attr.title]="progressTitle(p)">{{ progressLabel(p) }}</span>
                        @if (p.role === 'life') {
                          <span
                            class="task-card-badge"
                            title="Racine du Budget « Projet de vie » et du Patrimoine"
                            >Projet de vie</span
                          >
                        }
                      </div>
                      <p class="status-change">
                        Statut
                        <span
                          class="status-value"
                          [attr.data-status]="p.view.status"
                          [attr.title]="p.view.explanation"
                          ><span class="status-dot" [attr.data-status]="p.view.status"></span
                          >{{ p.view.statusLabel }}</span
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
          <a routerLink="/app/taches" class="text-link"
            >Parcourir les tâches des projets <span aria-hidden="true">↗</span></a
          >
          <a routerLink="/projects" class="text-link"
            >Projets du noyau <span aria-hidden="true">↗</span></a
          >
        </nav>
      </div>
    </div>
  `,
})
export class BpmProjectsPage implements OnInit {
  protected readonly workspace = injectPageWorkspace();
  protected readonly reviewProjects = computed(() => this.visible().filter((p) => p.role === 'standard').sort((a, b) => this.reviewPriority(b) - this.reviewPriority(a)));
  private reviewPriority(p: BpmProjectCard) {
    return (p.budget?.pendingOverrun ? 100 : 0) + (!p.budget?.regime ? 80 : 0) +
      (p.budget?.deficit ? 60 : 0) + (p.project.dueDate && p.project.dueDate < (this.data()?.context.calculationDate ?? '') && p.view.column !== 'done' ? 40 : 0) +
      (p.view.time.taskCount === 0 ? 20 : 0);
  }
  protected reviewStep(p: BpmProjectCard): { page: string; label: string } {
    if (!p.budget?.regime) return { page: 'budget', label: 'Attribuer l’enveloppe' };
    if (p.budget.pendingOverrun || (this.data()?.life.taskRequests.some((r) => r.coreProjectId === p.project.id))) return { page: 'budget', label: 'Décider le financement' };
    if (p.budget.deficit) return { page: 'budget', label: 'Revoir le budget' };
    if (p.view.column === 'done') return { page: 'budget', label: 'Contrôler la fin du projet' };
    return { page: 'taches', label: p.view.time.taskCount ? 'Poursuivre les tâches' : 'Préparer la première tâche' };
  }
  private bpm = inject(BpmApi);
  /** Décisions de financement communes à toutes les pages (mêmes gestes, mêmes messages). */
  private funding = inject(ProjectFunding);
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
  protected toolbarResult = computed(() => {
    const notice = this.notice();
    return notice ? { message: notice.text, tone: notice.error ? 'danger' as const : 'success' as const } : null;
  });
  protected candidate = signal('');
  protected cycleOpen = signal(false);
  private params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected search = computed(() => this.params().get('q') ?? '');
  protected filter = computed(() => this.params().get('project') || 'all');
  protected attention = computed(() => this.params().get('attention') || 'all');
  protected unfundedCount = computed(
    () => (this.data()?.projects ?? []).filter((p) => !p.budget?.regime).length,
  );
  protected hasPriorityAction = computed(() => {
    const data = this.data();
    return !!data && !!(data.life.pendingRequests.length || data.life.billable.length || data.life.taskRequests.length || this.unfundedCount());
  });
  protected toolbarScope = computed(() => `Section · tous les projets de la vie · Vue : ${this.visible().length} / ${this.cards().length} projet(s)`);
  protected pageFocus = computed<BpmPageFocus>(() => {
    const d = this.data();
    if (this.error())
      return {
        title: 'Les projets n’ont pas pu être actualisés',
        detail: this.error()!,
        tone: 'danger',
      };
    if (!d) return { title: 'Lecture des projets et de leur financement…', tone: 'info' };
    if (d.life.pendingRequests.length)
      return {
        title: `${d.life.pendingRequests.length} autorisation(s) de dépassement attendent votre décision`,
        detail: 'Examinez les montants avant de poursuivre les opérations des projets.',
        tone: 'warning',
      };
    if (d.life.taskRequests.length)
      return {
        title: `${d.life.taskRequests.length} demande(s) de tâche à décider`,
        detail:
          'La gestion de projet permet d’accorder les parts disponibles ou de traiter le financement manquant.',
        tone: 'warning',
      };
    if (d.life.billable.length)
      return {
        title: `${d.life.billable.length} dépassement(s) autorisé(s) à intégrer en fin de cycle`,
        detail: 'Ouvrez les autorisations et le cycle pour valider leur facturation.',
        tone: 'warning',
      };
    if (this.unfundedCount())
      return {
        title: `${this.unfundedCount()} projet(s) attendent leur enveloppe`,
        detail: 'Attribuez un budget avant de faire remonter leurs règlements au projet de vie.',
        tone: 'warning',
      };
    if (!d.projects.length)
      return {
        title: 'Préparez votre premier projet de la vie',
        detail: 'Créez le projet, puis ses tâches ; le budget peut être attribué ensuite.',
        tone: 'info',
      };
    return {
      title: `${this.visible().length} projet(s) dans cette vue · ${d.life.fundedCount} financé(s)`,
      detail:
        'Choisissez une priorité de suivi pour retrouver les projets qui demandent une action.',
      tone: 'success',
    };
  });

  /** Projet de vie et projets de la vie : seuls projets du user présentés ici. */
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
    return this.cards().filter(
      (p) =>
        (f === 'all' || p.project.id === f) &&
        this.matchesAttention(p) &&
        (!q ||
          normalizeSearch(`${p.project.title} ${p.project.description} ${p.project.id}`).includes(
            q,
          )),
    );
  });
  protected byColumn = computed(() => {
    const groups = Object.fromEntries(COLUMNS.map((c) => [c.id, [] as BpmProjectCard[]])) as Record<
      TaskStatus,
      BpmProjectCard[]
    >;
    for (const p of this.visible()) groups[p.view.column].push(p);
    return groups;
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

  protected setParams(patch: {
    project?: string | null;
    q?: string | null;
    attention?: string | null;
  }) {
    this.router.navigate([], {
      queryParams: patch,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private matchesAttention(p: BpmProjectCard): boolean {
    const mode = this.attention();
    if (mode === 'open') return p.view.column !== 'done';
    if (mode === 'unfunded') return p.role === 'standard' && !p.budget?.regime;
    if (mode === 'deficit') return !!p.budget?.deficit;
    if (mode === 'requests')
      return !!this.data()?.life.taskRequests.some((r) => r.coreProjectId === p.project.id);
    if (mode === 'late')
      return (
        p.view.column !== 'done' &&
        !!p.project.dueDate &&
        p.project.dueDate < (this.data()?.context.calculationDate ?? '')
      );
    return true;
  }

  protected progressLabel(p: BpmProjectCard): string {
    const open = p.view.time.taskCount - p.view.doneCount;
    return `${open} ${open === 1 ? 'tâche' : 'tâches'} à suivre`;
  }
  protected progressTitle(p: BpmProjectCard): string {
    return `${p.view.doneCount}/${p.view.time.taskCount} tâches terminées · ${p.view.completionPercent} %`;
  }

  private async run<T>(action: () => Promise<T>, success: string | ((result: T) => string)) {
    if (this.busy()) return;
    this.busy.set(true);
    this.notice.set(null);
    try {
      const result = await action();
      await this.load();
      this.notice.set({
        text: typeof success === 'function' ? success(result) : success,
        error: false,
      });
    } catch (err) {
      const e = toApiError(err);
      await this.load();
      this.notice.set({
        text: e.isConflict
          ? 'Conflit : la donnée a changé ailleurs. La page a été relue ; recommencez si besoin.'
          : e.message,
        error: true,
      });
    } finally {
      this.busy.set(false);
    }
  }

  protected decide(o: ProjectOverrun, decision: 'approve' | 'refuse') {
    return this.run(
      () => this.funding.decide(o, decision),
      (r) => `« ${o.budgetName} » · ${r.message}`,
    );
  }

  protected bill() {
    return this.run(
      () => this.bpm.billOverruns(),
      'Dépassements facturés au budget du projet de vie : les budgets attribués les intègrent. Ouvrez chaque projet pour relire ses contrôles de fin de cycle.',
    );
  }

  protected adopt() {
    const id = this.candidate();
    if (!id || !this.data()?.candidates.some((c) => c.projectId === id)) return;
    const title = this.data()?.candidates.find((c) => c.projectId === id)?.title ?? '';
    return this.run(async () => {
      await this.bpm.adoptProject({ requestKey: newRequestKey(), coreProjectId: id });
      this.candidate.set('');
    }, `« ${title} » est maintenant rattaché au budget du projet de vie. Attribuez-lui une enveloppe depuis sa fiche.`);
  }
}
