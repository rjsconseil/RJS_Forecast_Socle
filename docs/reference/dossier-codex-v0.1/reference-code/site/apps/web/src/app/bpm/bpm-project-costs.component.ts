import { BpmStore } from './bpm.store';
import { UserSession } from '../utilisateurs/utilisateurs.contract';
import { expensePeriodQuery } from './bpm-expense-links';
import { ChangeDetectionStrategy, Component, computed, input, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { formatMoney } from '../shared/amount';
import { pageText, registerPageTexts } from '../shared/page-text';
import { BpmBudgetCost, BpmProject } from './bpm.model';
/** Déclinaison commune du nom du propriétaire dans les titres de projets. */
export function bpmOwnerReference(project: BpmProject): string {
  const label = (project.ownerLabel || project.ownerUserId).trim();
  if (/^famille\s/i.test(label)) return 'de la famille ' + label.replace(/^famille\s+/i, '');
  if (/^association\s/i.test(label))
    return 'de l’association ' + label.replace(/^association\s+/i, '');
  if (/^les\s/i.test(label)) return 'des ' + label.replace(/^les\s+/i, '');
  if (/^le\s/i.test(label)) return 'du ' + label.replace(/^le\s+/i, '');
  if (/^(la\s|l[’'])/i.test(label)) return 'de ' + label;
  if (/^(SASU?|SARL)\s/i.test(label)) return 'de la ' + label;
  if (/^EURL\s/i.test(label)) return 'de l’' + label;
  if (project.entityType === 'famille' && !label.includes('·')) return 'de la famille ' + label;
  if (project.entityType === 'association') return 'de l’association ' + label;
  return /^[aàâeéèêëiîïoôuùûüyhœ]/i.test(label) ? 'd’' + label : 'de ' + label;
}

const P = 'content.pages.bpm.bpm-project-costs.component.';
export const BPM_PROJECT_COSTS_TEXTS: Record<string, string> = {
  remove: 'Supprimer',
  removing: 'Suppression…',
  removeHelp:
    'Supprimer le rattachement dans BPM. Le projet, ses opérations et ses tâches restent disponibles dans les modules de base.',
  removed:
    'Projet retiré de BPM. Ses fiches restent dans Budget, Patrimoine et le Noyau ; l’atelier peut le rattacher à nouveau.',
  tasksCount: 'tâche(s)',
  chargesCount: 'charge(s)',
  title: 'Charges de la période',
  allCharges: 'Toutes les charges du projet',
  allChargesHelp:
    'Toutes les dates. Une charge récurrente apparaît une fois, avec sa prochaine échéance.',
  periodCharges: 'Charges prévues dans la période',
  periodHelp:
    'Les échéances prévues dans cette période.',
  forecastDate: 'Date de dépense prévisionnelle',
  firstForecast: 'Première date prévisionnelle',
  nextForecast: 'Prochaine échéance prévue',
  actualDate: 'Prise en compte réelle',
  forecastTotal: 'Charges prévues de la période',
  forecastAmount: 'Prévu',
  once: 'Ponctuelle',
  weekly: 'Hebdomadaire',
  monthly: 'Mensuelle',
  yearly: 'Annuelle',
  approved: 'Retenue',
  idea: 'Hypothèse',
  rejected: 'Non retenue',
  unrealizedStatus: 'Non réalisée · période clôturée',
  noCharges: 'Aucune charge enregistrée pour ce projet.',

  lead: 'Les charges prévues dans la période : celles du projet de vie, puis celles des autres projets.',
  projectsTitle: 'Projets {owner}',
  noOtherProjects: 'Aucun autre projet pour cet utilisateur.',
  projectsLead:
    'Ouvrez un projet pour retrouver ses détails, ses tâches et toutes ses dépenses, quelle que soit leur date.',
  lifeProjectsCharges: 'Projets dans la vie {owner} · Charges de la période',
  structureProjectsCharges: 'Projets {owner} · Charges de la période',
  lifeProjectsHelp:
    'Les charges des projets sont regroupées par projet, puis par date prévisionnelle. Le projet d’origine figure sous chaque dépense.',
  projectPeriodTotal: 'Charges prévues des projets dans la période',
  professionalLead:
    'Les échéances des projets de la structure dont la date prévisionnelle appartient à la période.',
  life: 'Projet de vie · Charges de la période',
  lifeHelp: 'Votre cadre permanent se lit ici à travers les charges prévues dans la période.',
  details: 'Détails du projet',
  allocated: 'Budget affecté à la tâche',
  todo: 'À faire',
  doing: 'En cours',
  blocked: 'Bloquée',
  done: 'Terminée',
  projects: 'autre(s) projet(s)',
  professionalProjects: 'projet(s) de structure',
  task: 'Tâches et coûts',
  expenses: 'Dépenses de ce projet',
  noExpenses: 'Aucune dépense effectuée ou attendue sur cette période.',
  noTasks: 'Aucune tâche rattachée à ce projet.',
  planned: 'Enveloppe prévue',
  dates: 'Dates du projet',
  native: 'Ouvrir le projet dans Budget',
  absent: 'Non renseigné',
  standard: 'Budget standard',
  pendingStatus: 'En attente',
  recordedStatus: 'Effectuée',
  actual: 'Dépenses effectuées',
  pending: 'Encore attendu',
  noTask: 'Coûts sans tâche',
  detail: 'Voir les dépenses',
  all: 'Toutes les dépenses de la période',
  help: 'Les coûts de ces budgets distincts ne s’ajoutent pas au budget de la période.',
};
registerPageTexts(
  Object.fromEntries(
    Object.entries(BPM_PROJECT_COSTS_TEXTS).map(([key, value]) => [P + key, value]),
  ),
);
@Component({
  selector: 'rjs-bpm-project-costs',
  imports: [RouterLink, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./bpm-expenses.page.scss'],
  template: `@if (costs().length) {
    <div class="expense-cost-sections">
      <ng-template #chargeDetails let-row let-budget="budget" let-origin="origin" let-task="task">
        <a
          class="expense-row expense-charge-summary"
          [routerLink]="expenseRoute()"
          [queryParams]="chargeQuery(budget.id, row.operationId, row.occurrenceDate)"
          [attr.data-status]="row.status"
        >
          <span class="expense-date"
            ><small>{{ t('forecastDate') }}</small
            >{{ date(row.occurrenceDate) }}
            @if (row.actualDate && row.actualDate !== row.occurrenceDate) {
              <small>{{ t('actualDate') }} · {{ date(row.actualDate) }}</small>
            }
          </span>
          <span class="expense-main"
            ><strong>{{ row.title }}</strong>
            <small
              >{{ budget.title }} · {{ row.centerName }} · {{ row.taskTitle || t('noTask') }}</small
            >
          </span>
          <span class="expense-amount" data-flow="expense"
            ><strong
              ><span class="expense-flow-sign" aria-hidden="true">↓</span>
              {{ money(row.actualCents ?? row.amountCents) }}</strong
            >
            @if (row.actualCents !== null && row.actualCents !== row.amountCents) {
              <small>{{ t('forecastAmount') }} · {{ money(row.amountCents) }}</small>
            }
          </span>
          <span class="expense-state">{{ t(row.status + 'Status') }}</span>
        </a>
      </ng-template>
      <ng-template #periodRows let-budget let-life="life">
        <section>
          <h3>{{ t(life ? 'life' : 'periodCharges') }}</h3>
          <p class="bpm-help">{{ t(life ? 'lifeHelp' : 'periodHelp') }}</p>
          <ul
            class="expense-project-list"
            [class.expense-period-scroll]="life"
            tabindex="0"
            [attr.aria-label]="t(life ? 'life' : 'periodCharges')"
          >
            @for (row of budget.periodCharges; track row.operationId + row.occurrenceDate) {
              <li>
                <ng-container
                  *ngTemplateOutlet="
                    chargeDetails;
                    context: { $implicit: row, budget: budget, origin: false, task: !life }
                  "
                />
              </li>
            } @empty {
              <li>{{ t('noExpenses') }}</li>
            }
          </ul>
        </section>
      </ng-template>

      @if (showPeriod()) {
        <section class="expense-group" aria-labelledby="project-costs-title">
          <header data-ui-pattern="section-heading">
            <h2 id="project-costs-title">{{ t('title') }}</h2>
            <p>{{ t(professional() ? 'professionalLead' : 'lead') }}</p>
            <small>{{ date(start()) }} → {{ dateEnd(end()) }}</small>
          </header>
          @for (budget of lifeProjects(); track budget.id) {
            <div class="expense-row expense-body" data-ui-pattern="panel" data-project-life>
              <ng-container
                *ngTemplateOutlet="periodRows; context: { $implicit: budget, life: true }"
              />
              <p>
                <strong>{{ t('forecastTotal') }} · {{ money(budget.forecastExpenseCents) }}</strong>
              </p>
              <a
                class="bpm-link"
                [routerLink]="expenseRoute()"
                [queryParams]="periodQuery(budget.id)"
                >{{ t('detail') }} →</a
              >
            </div>
          }
          <div class="expense-row expense-body" data-ui-pattern="panel" data-project-period-charges>
            <section>
              <h3>{{ projectsChargesTitle() }}</h3>
              <p class="bpm-help">{{ t('lifeProjectsHelp') }}</p>
              <ul
                class="expense-project-list expense-period-scroll"
                tabindex="0"
                [attr.aria-label]="projectsChargesTitle()"
              >
                @for (
                  entry of projectPeriodCharges();
                  track entry.budget.id + entry.row.operationId + entry.row.occurrenceDate
                ) {
                  <li [attr.data-charge-project]="entry.budget.id">
                    <ng-container
                      *ngTemplateOutlet="
                        chargeDetails;
                        context: {
                          $implicit: entry.row,
                          budget: entry.budget,
                          origin: true,
                          task: true,
                        }
                      "
                    />
                  </li>
                } @empty {
                  <li>{{ t('noExpenses') }}</li>
                }
              </ul>
            </section>
            <p>
              <strong>{{ t('projectPeriodTotal') }} · {{ money(projectPeriodTotal()) }}</strong>
            </p>
          </div>
          <a class="btn btn-secondary" [routerLink]="expenseRoute()" [queryParams]="periodQuery()"
            >{{ t('all') }} →</a
          >
        </section>
      }
      @if (showProjects()) {
        <section
          class="expense-group"
          [class.expense-projects-prominent]="prominent()"
          [attr.aria-labelledby]="showHeading() ? 'user-projects-title' : null"
          [attr.aria-label]="showHeading() ? null : projectsTitle()"
        >
          @if (showHeading()) {
            <header data-ui-pattern="section-heading">
              @if (prominent()) {
                <h3 id="user-projects-title">
                  <span class="expense-project-mark" aria-hidden="true">◇</span>
                  {{ projectsTitle() }}
                </h3>
              } @else {
                <h2 id="user-projects-title">{{ projectsTitle() }}</h2>
              }
              <p>{{ t('projectsLead') }}</p>
              <small
                >{{ otherProjects().length }}
                {{ t(professional() ? 'professionalProjects' : 'projects') }}</small
              >
            </header>
          }
          @if (detachMessage()) {
            <p role="status" class="bpm-help">{{ detachMessage() }}</p>
          }
          @if (detachError()) {
            <p role="alert" class="bpm-error">{{ detachError() }}</p>
          }
          <div class="expense-projects">
            @for (budget of otherProjects(); track budget.id) {
              <details class="expense-row expense-project" data-ui-pattern="panel">
                <summary
                  class="expense-project-summary"
                  [class.expense-project-removable]="canDetach()"
                >
                  <span class="expense-main"
                    ><strong>{{ budget.title }}</strong
                    ><small
                      >{{ budget.tasks.length }} {{ t('tasksCount') }} · {{ budget.charges.length }}
                      {{ t('chargesCount') }}</small
                    ></span
                  >
                  <span class="expense-amount"
                    ><small>{{ t('forecastTotal') }}</small
                    ><strong>{{ money(budget.forecastExpenseCents) }}</strong></span
                  >
                  <span class="expense-project-totals"
                    ><span
                      >{{ t('actual') }} <strong>{{ money(budget.expenseCents) }}</strong></span
                    ><span
                      >{{ t('pending') }}
                      <strong>{{ money(budget.pendingExpenseCents) }}</strong></span
                    ></span
                  >
                  <span class="expense-project-cue">{{ t('details') }}</span>
                  @if (canDetach()) {
                    <button
                      type="button"
                      class="expense-project-remove"
                      [disabled]="store.saving()"
                      [attr.aria-label]="t('remove') + ' · ' + budget.title"
                      [title]="t('removeHelp')"
                      (click)="detach($event, budget)"
                    >
                      {{ t(store.saving() ? 'removing' : 'remove') }}
                    </button>
                  }
                </summary>
                <div class="expense-body record-details">
                  <h3>{{ budget.coreTitle }}</h3>
                  <p>
                    <strong
                      >{{ t('forecastTotal') }} · {{ money(budget.forecastExpenseCents) }}</strong
                    >
                  </p>
                  @if (budget.description || budget.summary) {
                    <p class="expense-prose">{{ budget.description || budget.summary }}</p>
                  }
                  <dl class="expense-facts record-facts">
                    <div>
                      <dt>{{ t('planned') }}</dt>
                      <dd>
                        {{
                          budget.plannedBudgetCents === null
                            ? t('absent')
                            : money(budget.plannedBudgetCents)
                        }}
                      </dd>
                    </div>
                    <div>
                      <dt>{{ t('dates') }}</dt>
                      <dd>
                        {{ budget.startDate ? date(budget.startDate) : '—' }} →
                        {{ budget.dueDate ? date(budget.dueDate) : '—' }}
                      </dd>
                    </div>
                    @if (budget.withoutTaskCents) {
                      <div>
                        <dt>{{ t('noTask') }}</dt>
                        <dd>{{ money(budget.withoutTaskCents) }}</dd>
                      </div>
                    }
                  </dl>
                  <ng-container
                    *ngTemplateOutlet="periodRows; context: { $implicit: budget, life: false }"
                  />
                  <section>
                    <h3>{{ t('task') }}</h3>
                    <ul class="expense-project-list expense-definition-list">
                      @for (task of budget.tasks; track task.id) {
                        <li>
                          <strong>{{ task.title }} · {{ t(task.status) }}</strong>
                          @if (task.description) {
                            <p class="expense-prose">{{ task.description }}</p>
                          }
                          @if (task.allocatedCents !== null) {
                            <span>{{ t('allocated') }} · {{ money(task.allocatedCents) }}</span>
                          }
                          <span
                            >{{ t('actual') }} · {{ money(task.expenseCents) }} ·
                            {{ t('pending') }} · {{ money(task.pendingExpenseCents) }}</span
                          >
                          @if (task.startDate || task.dueDate) {
                            <small
                              >{{ task.startDate ? date(task.startDate) : '—' }} →
                              {{ task.dueDate ? date(task.dueDate) : '—' }}</small
                            >
                          }
                        </li>
                      } @empty {
                        <li>{{ t('noTasks') }}</li>
                      }
                    </ul>
                  </section>
                  <section>
                    <h3>{{ t('allCharges') }}</h3>
                    <p class="bpm-help">{{ t('allChargesHelp') }}</p>
                    <ul class="expense-project-list expense-definition-list">
                      @for (charge of budget.charges; track charge.operationId) {
                        <li>
                          <a
                            class="expense-charge-summary"
                            [routerLink]="
                              charge.decision === 'approved'
                                ? expenseRoute()
                                : ['/budget-management/manager/operations', charge.operationId]
                            "
                            [queryParams]="
                              charge.decision === 'approved'
                                ? chargeQuery(
                                    budget.id,
                                    charge.operationId,
                                    charge.detailOccurrence || charge.firstDate,
                                    charge.detailDate
                                  )
                                : { budget: budget.id, core: budget.coreProjectId }
                            "
                          >
                            <span class="expense-date"
                              ><small>{{
                                t(charge.cadence === 'once' ? 'forecastDate' : 'firstForecast')
                              }}</small
                              >{{ date(charge.firstDate) }}</span
                            >
                            <span class="expense-main"
                              ><strong>{{ charge.title }}</strong
                              ><small
                                >{{ charge.centerName }} ·
                                {{ charge.taskTitle || t('noTask') }}</small
                              ></span
                            >
                            <span class="expense-amount" data-flow="expense"
                              ><strong
                                ><span class="expense-flow-sign" aria-hidden="true">↓</span>
                                {{ money(charge.amountCents) }}</strong
                              ><small>{{ t(charge.cadence) }}</small></span
                            >
                            <span class="expense-state">{{ t(charge.decision) }}</span>
                          </a>
                          @if (charge.cadence !== 'once' && charge.nextDate) {
                            <small>{{ t('nextForecast') }} · {{ date(charge.nextDate) }}</small>
                          }
                          @if (charge.note) {
                            <p class="expense-prose">{{ charge.note }}</p>
                          }
                        </li>
                      } @empty {
                        <li>{{ t('noCharges') }}</li>
                      }
                    </ul>
                  </section>

                  <a
                    class="bpm-link"
                    [routerLink]="expenseRoute()"
                    [queryParams]="periodQuery(budget.id)"
                    >{{ t('detail') }} →</a
                  >
                  <a
                    class="bpm-link"
                    [routerLink]="['/budget-management/manager/projets', budget.id]"
                    [queryParams]="{ budget: budget.id, core: budget.coreProjectId }"
                    >{{ t('native') }} ↗</a
                  >
                </div>
              </details>
            } @empty {
              <p class="bpm-help">{{ t('noOtherProjects') }}</p>
            }
          </div>
          <p class="bpm-help">{{ t('help') }}</p>
        </section>
      }
    </div>
  }`,
})
export class BpmProjectCostsComponent {
  readonly project = input.required<BpmProject>();
  readonly allowDetach = input(false);
  protected readonly store = inject(BpmStore);
  private readonly session = inject(UserSession);
  protected readonly canDetach = computed(
    () =>
      this.allowDetach() &&
      !this.professional() &&
      this.project().defaultForEntity === true &&
      this.session.profile()?.id === this.project().ownerUserId,
  );
  protected readonly detachMessage = signal('');
  protected readonly detachError = signal('');
  protected async detach(event: Event, budget: BpmBudgetCost) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.canDetach() || budget.standard || this.store.saving()) return;
    this.detachMessage.set('');
    this.detachError.set('');
    const ok = await this.store.detachProject(this.project().id, budget.id);
    if (ok) this.detachMessage.set(this.t('removed'));
    else this.detachError.set(this.store.error());
  }
  readonly professional = input(false);
  readonly showPeriod = input(true);
  readonly showProjects = input(true);
  readonly prominent = input(false);
  readonly showHeading = input(true);
  readonly expenseList = input(true);
  readonly entreprise = input<string | null>(null);
  protected readonly expenseRoute = computed(
    () =>
      '/budget-patrimoine-management/' + (this.professional() ? 'entreprise/' : '') + 'depenses',
  );
  protected readonly lifeProjects = computed(() =>
    this.professional() ? [] : this.costs().filter((b) => b.standard),
  );
  protected readonly otherProjects = computed(() =>
    this.professional() ? this.costs() : this.costs().filter((b) => !b.standard),
  );
  /** Une seule liste, groupée par projet et ordonnée par date à l’intérieur du projet. */
  protected readonly projectPeriodCharges = computed(() =>
    this.otherProjects().flatMap((budget) =>
      [...budget.periodCharges]
        .sort(
          (a, b) =>
            a.occurrenceDate.localeCompare(b.occurrenceDate) ||
            a.title.localeCompare(b.title, 'fr'),
        )
        .map((row) => ({ budget, row })),
    ),
  );
  protected readonly projectPeriodTotal = computed(() =>
    this.projectPeriodCharges().reduce((sum, entry) => sum + entry.row.amountCents, 0),
  );
  protected readonly ownerReference = computed(() => bpmOwnerReference(this.project()));
  protected readonly projectsTitle = computed(() =>
    this.t('projectsTitle').replace('{owner}', this.ownerReference()),
  );
  protected readonly projectsChargesTitle = computed(() =>
    this.t(this.professional() ? 'structureProjectsCharges' : 'lifeProjectsCharges').replace(
      '{owner}',
      this.ownerReference(),
    ),
  );
  protected periodQuery(budget?: string) {
    return {
      projet: this.project().id,
      du: this.start(),
      au: this.end(),
      ...(budget ? { budget } : {}),
      ...(this.professional() ? { entreprise: this.entreprise() } : {}),
    };
  }
  readonly costs = input<readonly BpmBudgetCost[]>([]);
  readonly start = input.required<string>();
  readonly end = input.required<string>();
  protected readonly money = formatMoney;
  protected chargeQuery(budget: string, operation: string, occurrence: string, date?: string) {
    return {
      ...expensePeriodQuery(this.project(), {
        start: this.start(),
        end: this.end(),
        operation,
        occurrence,
        date: occurrence,
      }),
      budget,
      ...(this.professional() ? { entreprise: this.entreprise() } : {}),
    };
  }

  protected date(value: string) {
    return new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(value + 'T12:00:00Z'));
  }
  protected dateEnd(value: string) {
    const d = new Date(value + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return this.date(d.toISOString().slice(0, 10));
  }
  protected t(key: string) {
    return pageText(P + key);
  }
}
