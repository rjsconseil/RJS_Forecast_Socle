import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatMoney } from '../shared/amount';
import { pageText, registerPageTexts } from '../shared/page-text';
import type { BpmExpenseRegister, ExpenseRow } from './bpm-expenses.model';
const P = 'content.pages.bpm.bpm-income-list.component.';
export const BPM_INCOME_LIST_TEXTS: Record<string, string> = {
  help: 'Entrées par poste puis par jour prévu, avec le montant réellement reçu.',
  typeHelp:
    'Entrées par type, du plus gros au plus petit, puis par jour prévu, avec leur projet d’origine.',
  received: 'Reçue',
  pending: 'En attente',
  unrealized: 'Non reçue · période clôturée',
  expectedDate: 'Date de réception prévue',
  actualDate: 'Réception réelle',
  expected: 'Montant prévu',
  actual: 'Montant reçu',
  noPost: 'Poste non renseigné',
  count: 'entrée(s)',
  groupTotal: 'Total des entrées listées',
  cadence: 'Récurrence',
  once: 'Ponctuelle',
  weekly: 'Hebdomadaire',
  monthly: 'Mensuelle',
  yearly: 'Annuelle',
  note: 'Note',
  task: 'Tâche',
  person: 'Personne rattachée',
  type: 'Type d’entrée',
  operation: 'Consulter l’opération budgétaire',
  outside: 'Réception hors de la période affichée',
  empty: 'Aucune entrée reçue ou attendue à une date prévue dans cette période.',
};
registerPageTexts(
  Object.fromEntries(Object.entries(BPM_INCOME_LIST_TEXTS).map(([k, v]) => [P + k, v])),
);
@Component({
  selector: 'rjs-bpm-income-list',
  imports: [RouterLink, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./bpm-expenses.page.scss'],
  template: `
    <p class="bpm-help">{{ t(groupByType() ? 'typeHelp' : 'help') }}</p>
    @for (group of groups(); track group.id) {
      <ng-template #heading>
        <div>
          @if (nested()) {
            <h4>{{ group.name }}</h4>
          } @else {
            <h3>{{ group.name }}</h3>
          }
          <p>{{ group.rows.length }} {{ t('count') }}</p>
        </div>
        <div class="expense-center-total">
          <small>{{ t('groupTotal') }}</small
          ><strong><span aria-hidden="true">↑</span> {{ money(group.total) }}</strong>
        </div>
        <p class="expense-center-breakdown">
          {{ t('received') }} · {{ money(group.received) }} · {{ t('pending') }} ·
          {{ money(group.pending) }}
          @if (group.unrealized) {
            · {{ t('unrealized') }} · {{ money(group.unrealized) }}
          }
        </p>
      </ng-template>
      <ng-template #entries>
        @for (row of group.rows; track row.operationId + row.occurrenceDate + row.actualDate) {
          @let op = operations().get(row.operationId);
          <article class="expense-row" [attr.data-status]="row.status">
            <div class="expense-charge-summary">
              <span class="expense-date"
                ><small>{{ t('expectedDate') }}</small
                >{{ date(row.occurrenceDate) }}
                @if (row.actualDate && row.actualDate !== row.occurrenceDate) {
                  <small>{{ t('actualDate') }} · {{ date(row.actualDate) }}</small>
                }
              </span>
              <span class="expense-main"
                ><a [routerLink]="['/budget-management/manager/operations', row.operationId]"
                  ><strong>{{ row.title }}</strong></a
                ><small
                  >{{ op?.budgetTitle }} · {{ op?.center?.name || t('noPost') }}
                  @if (op?.task; as task) {
                    · {{ task.title }}
                  }
                </small></span
              >
              <span class="expense-amount"
                ><strong
                  ><span class="expense-flow-sign" aria-hidden="true">↑</span>
                  {{ money(row.amountCents) }}</strong
                >
                @if (row.plannedCents !== null && row.plannedCents !== row.amountCents) {
                  <small>{{ t('expected') }} · {{ money(row.plannedCents) }}</small>
                }
              </span>
              <span class="expense-state">{{
                t(row.status === 'recorded' ? 'received' : row.status)
              }}</span>
            </div>
            @if (detailed()) {
              <div class="expense-body">
                <dl class="expense-facts">
                  <div>
                    <dt>{{ t('expected') }}</dt>
                    <dd>{{ row.plannedCents === null ? '—' : money(row.plannedCents) }}</dd>
                  </div>
                  @if (row.actualDate) {
                    <div>
                      <dt>{{ t('actual') }}</dt>
                      <dd>{{ money(row.amountCents) }}</dd>
                    </div>
                    <div>
                      <dt>{{ t('actualDate') }}</dt>
                      <dd>
                        {{ date(row.actualDate) }}
                        @if (row.actualDate < start() || row.actualDate >= end()) {
                          <small> · {{ t('outside') }}</small>
                        }
                      </dd>
                    </div>
                  }
                  <div>
                    <dt>{{ t('cadence') }}</dt>
                    <dd>{{ t(op?.cadence || 'once') }}</dd>
                  </div>
                  @if (op?.incomeType) {
                    <div>
                      <dt>{{ t('type') }}</dt>
                      <dd>{{ op?.incomeType }}</dd>
                    </div>
                  }
                  @if (op?.beneficiary; as person) {
                    <div>
                      <dt>{{ t('person') }}</dt>
                      <dd>{{ person.name }}</dd>
                    </div>
                  }
                </dl>
                @if (row.note) {
                  <p class="expense-note expense-prose">{{ row.note }}</p>
                }
                <footer>
                  <a [routerLink]="['/budget-management/manager/operations', row.operationId]"
                    >{{ t('operation') }} →</a
                  >
                </footer>
              </div>
            }
          </article>
        }
      </ng-template>
      @if (collapsible()) {
        <details class="expense-group expense-category" data-flow="income">
          <summary class="expense-center-heading" data-ui-pattern="section-heading">
            <ng-container *ngTemplateOutlet="heading" />
          </summary>
          <div class="expense-category-body"><ng-container *ngTemplateOutlet="entries" /></div>
        </details>
      } @else {
        <section class="expense-group" data-flow="income">
          <header class="expense-center-heading" data-ui-pattern="section-heading">
            <ng-container *ngTemplateOutlet="heading" />
          </header>
          <ng-container *ngTemplateOutlet="entries" />
        </section>
      }
    } @empty {
      <p class="bv-empty">{{ t('empty') }}</p>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--ecart-16);
      min-width: 0;
    }
    .expense-charge-summary {
      cursor: default;
    }
  `,
})
export class BpmIncomeListComponent {
  readonly data = input<Pick<BpmExpenseRegister, 'rows' | 'operations'> | null>(null);
  readonly detailed = input(true);
  readonly groupByType = input(false);
  readonly nested = input(false);
  readonly collapsible = input(false);
  readonly start = input.required<string>();
  readonly end = input.required<string>();
  protected readonly money = formatMoney;
  protected readonly operations = computed(
    () => new Map((this.data()?.operations ?? []).map((op) => [op.id, op])),
  );
  protected readonly groups = computed(() => {
    const groups = new Map<
      string,
      {
        id: string;
        name: string;
        rows: ExpenseRow[];
        total: number;
        received: number;
        pending: number;
        unrealized: number;
      }
    >();
    for (const row of this.data()?.rows ?? []) {
      const op = this.operations().get(row.operationId);
      const name =
        (this.groupByType() && op?.cadence === 'once' ? op.incomeType : '') ||
        op?.center?.name ||
        this.t('noPost');
      const id = this.groupByType()
        ? name.trim().normalize('NFKC').toLocaleLowerCase('fr')
        : row.centerId || '';
      const group = groups.get(id) ?? {
        id,
        name,
        rows: [],
        total: 0,
        received: 0,
        pending: 0,
        unrealized: 0,
      };
      group.rows.push(row);
      group.total += row.amountCents;
      group[row.status === 'recorded' ? 'received' : row.status] += row.amountCents;
      groups.set(id, group);
    }
    return [...groups.values()]
      .map((g) => ({
        ...g,
        rows: [...g.rows].sort(
          (a, b) =>
            a.occurrenceDate.localeCompare(b.occurrenceDate) ||
            a.title.localeCompare(b.title, 'fr'),
        ),
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'fr'));
  });
  protected t(key: string): string {
    return pageText(P + key);
  }
  protected date(value: string): string {
    return new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(value + 'T12:00:00Z'));
  }
}
