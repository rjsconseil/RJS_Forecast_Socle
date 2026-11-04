import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatMoney } from '../shared/amount';
import { pageText, registerPageTexts } from '../shared/page-text';
import type { BpmExpenseRegister, ExpenseRow } from './bpm-expenses.model';
const P = 'content.pages.bpm.bpm-period-expenses.component.';
export const BPM_PERIOD_EXPENSES_TEXTS = {
  help: 'Les postes les plus lourds d’abord. Ouvrez un poste, puis une charge pour voir son détail.',
  empty: 'Aucune charge prévue dans cette période.',
  noType: 'Poste non renseigné',
  count: 'échéance(s)',
  total: 'Total des échéances',
  recorded: 'Payé',
  pending: 'À payer',
  unrealized: 'Non réalisé · période close',
  date: 'Date prévue',
  actual: 'Date de paiement',
  expected: 'Montant prévu',
  definition: 'Définition de la charge',
  cadence: 'Rythme',
  once: 'Ponctuelle',
  weekly: 'Hebdomadaire',
  monthly: 'Mensuelle',
  yearly: 'Annuelle',
  project: 'Projet d’origine',
  task: 'Tâche',
  noTask: 'Sans tâche',
  post: 'Poste de dépense',
  native: 'Modifier la dépense dans Budget',
  detail: 'Détail de cette dépense',
  outside: 'Règlement réalisé hors de la période affichée',
};
registerPageTexts(
  Object.fromEntries(Object.entries(BPM_PERIOD_EXPENSES_TEXTS).map(([k, v]) => [P + k, v])),
);
@Component({
  selector: 'rjs-bpm-period-expenses',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./bpm-expenses.page.scss'],
  template: `
    <p class="bpm-help">{{ t('help') }}</p>
    @for (group of groups(); track group.id) {
      <details class="expense-group expense-category" data-flow="expense">
        <summary class="expense-center-heading" data-ui-pattern="section-heading">
          <div>
            <h4>{{ group.name }}</h4>
            <p>{{ group.rows.length }} {{ t('count') }}</p>
          </div>
          <div class="expense-center-total">
            <small>{{ t('total') }}</small
            ><strong><span aria-hidden="true">↓</span> {{ money(group.total) }}</strong>
          </div>
          <p class="expense-center-breakdown">
            <span
              >{{ t('recorded') }} <strong>{{ money(group.recorded) }}</strong></span
            >
            <span class="expense-pending-total"
              >{{ t('pending') }} <strong>{{ money(group.pending) }}</strong></span
            >
            @if (group.unrealized) {
              <span
                >{{ t('unrealized') }} <strong>{{ money(group.unrealized) }}</strong></span
              >
            }
          </p>
        </summary>
        <div class="expense-category-body">
          @for (row of group.rows; track row.operationId + row.occurrenceDate + row.actualDate) {
            @let op = operations().get(row.operationId);
            <details class="expense-row" [attr.data-status]="row.status">
              <summary>
                <span class="expense-date"
                  ><small>{{ t('date') }}</small
                  >{{ date(row.occurrenceDate) }}
                  @if (row.actualDate && row.actualDate !== row.occurrenceDate) {
                    <small>{{ t('actual') }} · {{ date(row.actualDate) }}</small>
                  }
                </span>
                <span class="expense-main"
                  ><strong>{{ row.title }}</strong
                  ><small
                    >{{ op?.budgetTitle }}
                    @if (op?.task?.title) {
                      · {{ op.task.title }}
                    }
                  </small></span
                >
                <span class="expense-amount"
                  ><strong
                    ><span class="expense-flow-sign" aria-hidden="true">↓</span>
                    {{ money(row.amountCents) }}</strong
                  >
                  @if (row.plannedCents !== null && row.plannedCents !== row.amountCents) {
                    <small>{{ t('expected') }} · {{ money(row.plannedCents) }}</small>
                  }
                </span>
                <span class="expense-state">{{ t(row.status) }}</span>
              </summary>
              <div class="expense-body record-details">
                <h4>{{ t('definition') }}</h4>
                <dl class="expense-facts record-facts">
                  <div>
                    <dt>{{ t('project') }}</dt>
                    <dd>{{ op?.budgetTitle }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('post') }}</dt>
                    <dd>{{ group.name }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('cadence') }}</dt>
                    <dd>{{ t(op?.cadence || 'once') }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('expected') }}</dt>
                    <dd>{{ money(row.plannedCents ?? row.amountCents) }}</dd>
                  </div>
                  @if (row.actualDate) {
                    <div>
                      <dt>{{ t('actual') }}</dt>
                      <dd>
                        {{ date(row.actualDate) }}
                        @if (row.actualDate < start() || row.actualDate >= end()) {
                          <small>{{ t('outside') }}</small>
                        }
                      </dd>
                    </div>
                  }
                </dl>
                @if (row.note) {
                  <p class="expense-prose">{{ row.note }}</p>
                }
                <footer>
                  <a
                    routerLink="/budget-patrimoine-management/depenses"
                    [queryParams]="{
                      projet: projectId(),
                      du: start(),
                      au: end(),
                      budget: row.budgetProjectId,
                      operation: row.operationId,
                      occurrence: row.occurrenceDate,
                    }"
                    >{{ t('detail') }} →</a
                  >
                  <a [routerLink]="['/budget-management/manager/operations', row.operationId]"
                    >{{ t('native') }} ↗</a
                  >
                </footer>
              </div>
            </details>
          }
        </div>
      </details>
    } @empty {
      <p class="bpm-help">{{ t('empty') }}</p>
    }
  `,
  styles: ':host {display:grid;gap:var(--ecart-20);min-width:0;} h4,p {margin:0;}',
})
export class BpmPeriodExpensesComponent {
  readonly data = input<Pick<BpmExpenseRegister, 'rows' | 'operations'> | null>(null);
  readonly projectId = input.required<string>();
  readonly start = input.required<string>();
  readonly end = input.required<string>();
  protected readonly money = formatMoney;
  protected readonly operations = computed(
    () => new Map((this.data()?.operations ?? []).map((o) => [o.id, o])),
  );
  protected readonly groups = computed(() => {
    const groups = new Map<
      string,
      {
        id: string;
        name: string;
        rows: ExpenseRow[];
        total: number;
        recorded: number;
        pending: number;
        unrealized: number;
      }
    >();
    for (const row of this.data()?.rows ?? []) {
      const name = this.operations().get(row.operationId)?.center?.name || this.t('noType');
      const id = name.trim().normalize('NFKC').toLocaleLowerCase('fr');
      const group = groups.get(id) ?? {
        id,
        name,
        rows: [],
        total: 0,
        recorded: 0,
        pending: 0,
        unrealized: 0,
      };
      group.rows.push(row);
      group.total += row.amountCents;
      group[row.status] += row.amountCents;
      groups.set(id, group);
    }
    return [...groups.values()]
      .map((g) => ({
        ...g,
        rows: g.rows.sort(
          (a, b) =>
            a.occurrenceDate.localeCompare(b.occurrenceDate) ||
            a.title.localeCompare(b.title, 'fr'),
        ),
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'fr'));
  });
  protected t(key: string) {
    return pageText(P + key);
  }
  protected date(day: string) {
    return new Date(day + 'T12:00:00Z').toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
}
