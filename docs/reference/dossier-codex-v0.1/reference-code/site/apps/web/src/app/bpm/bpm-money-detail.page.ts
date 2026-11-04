import { PeriodNavigationComponent } from '../shared/period-navigation.component';
import { ParameterChoiceComponent } from '../shared/parameter-choice.component';
import { expensePeriodQuery } from './bpm-expense-links';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { formatMoney, parseAmount, parseSignedAmount } from '../shared/amount';
import { AppHeroComponent, HeroChip } from '../shared/app-hero.component';
import { MetricTile, MetricTilesComponent } from '../shared/metric-tiles.component';
import { pageText, registerPageTexts } from '../shared/page-text';
import { BpmContextComponent } from './bpm-context.component';
import { BpmGateComponent } from './bpm-gate.component';
import { BpmRoutineMemory } from './bpm-routine-memory';
import { lastDayOf, lensWords } from './bpm-lens.model';
import { BpmMoneyContext } from './bpm-money-context';
import {
  MONEY_NATURES,
  MoneyNature,
  cadenceOfWindow,
  entriesOf,
  moneyLines,
  pendingOf,
  shareBasis,
  subSums,
  unexplainedGap,
} from './bpm-money.model';
import { BpmStatementEntry, periodLabel } from './bpm.model';

const P = 'content.pages.bpm.bpm-money-detail.page.';
/** Textes des pages dédiées du parcours ; ils se personnalisent dans Configuration → Contenus. */
export const BPM_MONEY_DETAIL_TEXTS: Record<string, string> = {
  incomeType: 'Type d’entrée financière',
  incomeTypeHint: 'Don, gain ponctuel, prime exceptionnelle…',
  back: 'Retour au tableau de bord',
  kicker: 'Tableau de bord',
  loading: 'Lecture du relevé…',
  unknown: 'Cette ligne n’existe pas dans le relevé de la période.',
  previous: 'Période précédente',
  next: 'Période suivante',
  current: 'Revenir à la période en cours',
  currentCompact: 'Revenir',
  closedBadge: 'Clôturée',
  periodNav: 'Changer de période',
  closed:
    'Période clôturée : les montants ne changent plus. Postes et notes restent modifiables ; un oubli se note dans la période ouverte.',
  future: 'Période à venir : rien n’a encore été reçu ni payé.',
  readOnly: 'Lecture seule : seul l’utilisateur à qui appartient le projet précise ses dépenses.',
  'title-poste': 'Le poste {name}',
  'title-entrees': 'D’où vient l’argent',
  'title-a-preciser': 'Les dépenses à préciser',
  'title-reste': 'Le solde de la période',
  'lead-poste': '{amount} payés sur la période en {count} montant(s).',
  'lead-entrees': '{amount} reçus sur la période en {count} montant(s).',
  'lead-a-preciser':
    '{amount} dépensés sans poste : dites où est allé cet argent pour qu’il rejoigne son poste.',
  'lead-a-preciserNone': 'Rien à préciser : chaque dépense de la période a son poste.',
  'lead-reste': 'Le solde rejoint le patrimoine.',
  tiles: 'Chiffres de la ligne',
  tileSpent: 'Payé',
  tileReceived: 'Reçu',
  tilePlannedOut: 'Encore prévu',
  tilePlannedIn: 'Encore attendu',
  tileShare: 'Part des entrées',
  tileShareSpent: 'Part des dépenses',
  tileLimitOver: 'Dépassé de {amount} avec le prévu',
  tileLimitLeft: 'Reste {amount} avec le prévu',
  tileLimit: 'Plafond du poste',
  tileLimitNone: 'Aucun plafond',
  tileCount: 'Montants',
  sumsTitle: 'Sommes détaillées',
  sumsHelp:
    'Les montants d’un même libellé additionnés : ce que le tableau de bord rappelle en une ligne.',
  sumsTitleCol: 'Libellé',
  sumsCountCol: 'Fois',
  sumsTotalCol: 'Total',
  entriesTitle: 'Chaque montant de la période',
  entriesNone: 'Aucun montant réel sur cette période.',
  pendingTitle: 'Encore prévu d’ici la fin de la période',
  pendingHelp: 'Ces échéances futures seront prises en compte automatiquement à leur date.',
  pendingLate: 'en retard',
  pendingToday: 'aujourd’hui',
  settleExpense: 'Payé',
  settleIncome: 'Reçu',
  settled: 'Échéance enregistrée : elle compte désormais dans la période.',
  sourcesTitle: 'Les sources',
  sourceReceived: 'reçus',
  sourcePlanned: 'attendus',
  precise: 'Préciser',
  preciseTitle: 'Préciser « {title} »',
  center: 'Poste du flux',
  centerNone: '— Choisir un poste',
  centerNew: 'Nouveau poste…',
  centerName: 'Nom du nouveau poste',
  note: 'Note',
  notePlaceholder: 'Ce que vous avez fait de cet argent',
  preciseScope:
    'La précision s’applique à l’opération « {title} » : pour une dépense récurrente, à toutes ses échéances. Montants et dates ne changent pas.',
  save: 'Enregistrer',
  cancel: 'Annuler',
  saved: 'Précision enregistrée.',
  added: 'Montant enregistré dans la période.',
  addTitle: 'Noter un montant oublié',
  'addHelp-poste': 'Une dépense déjà payée qui manque dans ce poste.',
  'addHelp-entrees': 'Une entrée déjà reçue qui manque (remboursement, vente, don…).',
  'addHelp-a-preciser': 'Une dépense dont vous préciserez le poste plus tard.',
  addLabel: 'Libellé',
  addAmount: 'Montant (€)',
  addDate: 'Date',
  addSubmit: 'Ajouter',
  addInvalid: 'Indiquez un libellé, un montant positif et le type d’une entrée ponctuelle.',
  restRows: 'Le calcul du reste',
  restIncome: 'Entrées reçues',
  restExpense: 'Sorties payées',
  restTotal: 'Reste de la période',
  restClosure: 'Clôture enregistrée : patrimoine après la clôture {amount}.',
  restOpen: 'La période se termine le {date} : attendu {expected} si tout le prévu se réalise.',
  restLines: 'Où est allée chaque part',
  checkTitle: 'Vérifier avec mon compte',
  checkHelp:
    'Saisissez le solde de votre compte au début de la période et aujourd’hui. L’écart avec le calcul montre ce qui manque. Rien n’est enregistré sans votre choix.',
  checkStart: 'Solde au {date} (€)',
  checkEnd: 'Solde aujourd’hui (€)',
  checkActual: 'Reste réel d’après le compte : {amount} · reste calculé : {computed}.',
  checkMissing: 'Il manque {amount} : une ou plusieurs dépenses n’ont pas été notées.',
  checkExtra: 'Vous avez {amount} de plus que le calcul : une entrée manque peut-être.',
  checkBalanced: 'Tout est expliqué, au centime près.',
  checkMark: 'Noter mon compte comme vérifié aujourd’hui',
  checkMarked: 'Compte vérifié aujourd’hui : la routine du jour est à jour pour ce geste.',
  gapCenter: 'Poste de la dépense manquante',
  checkAddExpense: 'Enregistrer la dépense de {amount}',
  checkAddIncome: 'Noter {amount} comme entrée à identifier',
  checkExpenseTitle: 'Dépense non identifiée',
  checkIncomeTitle: 'Entrée non identifiée',
  checkInvalid: 'Montant invalide.',
  entryNote: 'Note',
};
registerPageTexts(
  Object.fromEntries(
    Object.entries(BPM_MONEY_DETAIL_TEXTS).map(([key, value]) => [P + key, value]),
  ),
);

const short = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const long = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const at = (value: string) => new Date(`${value}T12:00:00Z`);

/**
 * La page dédiée d'une ligne du parcours de l'argent : un poste, les entrées, les
 * dépenses à préciser ou le reste. Elle ne sert qu'à creuser et préciser : sommes
 * détaillées, chaque montant, ce qui est encore prévu, et les gestes pour rendre
 * compte du moindre centime, puis le retour à la page du parcours.
 */
@Component({
  selector: 'rjs-bpm-money-detail-page',
  imports: [
    PeriodNavigationComponent,
    ParameterChoiceComponent,
    BpmContextComponent,
    AppHeroComponent,
    BpmGateComponent,
    FormsModule,
    MetricTilesComponent,
    RouterLink,
  ],
  providers: [BpmMoneyContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./bpm-pages.scss', './bpm-money.scss', './bpm-money-detail.page.scss'],
  template: `
    <div class="page bpm-reading bpm-app bpm-money bpm-money-detail" data-tone="budget">
      <rjs-bpm-gate suite="/budget-patrimoine-management/tableau-de-bord" />
      @if (ctx.project(); as p) {
        <rjs-app-hero
          toolsLabel="Actions"
          tone="lagoon"
          headingId="bmd-title"
          [kicker]="t('kicker')"
          [title]="title()"
          [lead]="lead()"
          [chips]="chips()"
          ><rjs-bpm-context heroMetaWide [scopeOnly]="true" [compact]="true" [embedded]="true" />
          <a
            heroActions
            class="app-hero-action"
            routerLink="/budget-patrimoine-management/tableau-de-bord"
            [queryParams]="ctx.query()"
            >← {{ t('back') }}</a
          >
          <a
            heroActions
            class="bpm-link"
            routerLink="/budget-patrimoine-management/depenses"
            [queryParams]="ctx.query()"
            >Dépenses de la période →</a
          >
          <div heroFooter>
            @if (ctx.window(); as w) {
              <rjs-period-navigation
                [start]="w.start"
                [end]="w.end"
                [label]="t('periodNav')"
                [previousLabel]="t('previous')"
                [nextLabel]="t('next')"
                [currentLabel]="t('current')"
                [compactCurrentLabel]="t('currentCompact')"
                [previousQuery]="ctx.shifted(-1)"
                [nextQuery]="ctx.shifted(1)"
                [currentQuery]="ctx.current()"
                [status]="ctx.statement()?.closed ? t('closedBadge') : ''"
              />
            }</div
        ></rjs-app-hero>
        @if (ctx.statement()) {
          <section data-bpm-frame="metrics" [attr.aria-label]="t('tiles')">
            <rjs-metric-tiles variant="instrument" [label]="t('tiles')" [tiles]="tiles()" />
          </section>
        }

        @if (message()) {
          <p class="bmd-message" role="status">{{ message() }}</p>
        }
        @if (ctx.store.error() && failed()) {
          <p class="bmd-message" data-state="danger" role="alert">{{ ctx.store.error() }}</p>
        }
        @if (ctx.statement(); as s) {
          @if (s.closed) {
            <p class="bmd-note-banner">{{ t('closed') }}</p>
          } @else if (future()) {
            <p class="bmd-note-banner">{{ t('future') }}</p>
          }
          @if (!ctx.manages()) {
            <p class="bmd-note-banner">{{ t('readOnly') }}</p>
          }
          @if (!known()) {
            <p class="bm-empty">{{ t('unknown') }}</p>
          } @else {
            @if (nature() === 'reste') {
              <section
                class="bm-statement"
                aria-labelledby="bmd-rest-title"
                data-ui-pattern="panel"
              >
                <h2 id="bmd-rest-title">{{ t('restRows') }}</h2>
                <table class="bmd-rest">
                  <tbody>
                    <tr>
                      <th scope="row"><span aria-hidden="true">+</span> {{ t('restIncome') }}</th>
                      <td>{{ money(s.incomeCents) }}</td>
                    </tr>
                    <tr>
                      <th scope="row"><span aria-hidden="true">−</span> {{ t('restExpense') }}</th>
                      <td>
                        <a
                          routerLink="/budget-patrimoine-management/depenses"
                          [queryParams]="expenseQuery()"
                          >{{ money(s.expenseCents) }}</a
                        >
                      </td>
                    </tr>
                    <tr class="is-total">
                      <th scope="row"><span aria-hidden="true">=</span> {{ t('restTotal') }}</th>
                      <td>{{ signed(s.netCents) }}</td>
                    </tr>
                  </tbody>
                </table>
                <p class="bpm-help">{{ restNote() }}</p>
                <h3>{{ t('restLines') }}</h3>
                <ul class="bmd-rest-lines">
                  @for (line of outflows(); track line.nature + line.id) {
                    <li>
                      <a
                        [routerLink]="
                          line.nature === 'poste'
                            ? '/budget-patrimoine-management/argent/postes/' + line.id
                            : '/budget-patrimoine-management/argent/' + line.nature
                        "
                        [queryParams]="ctx.query()"
                        >{{ line.nature === 'poste' ? line.name : t('title-a-preciser') }}</a
                      >
                      <span>{{ money(line.cents) }}</span>
                    </li>
                  }
                </ul>
              </section>
              <section
                class="bm-statement"
                id="verifier"
                aria-labelledby="bmd-check-title"
                data-ui-pattern="panel"
              >
                <h2 id="bmd-check-title">{{ t('checkTitle') }}</h2>
                <p class="bpm-help">{{ t('checkHelp') }}</p>
                <div class="bmd-check-fields">
                  <label class="bmd-field">
                    <span>{{ fill('checkStart', { date: longDate(s.start) }) }}</span>
                    <input
                      type="text"
                      inputmode="decimal"
                      name="balanceStart"
                      [ngModel]="startText()"
                      (ngModelChange)="startText.set($event)"
                    />
                  </label>
                  <label class="bmd-field">
                    <span>{{ t('checkEnd') }}</span>
                    <input
                      type="text"
                      inputmode="decimal"
                      name="balanceEnd"
                      [ngModel]="endText()"
                      (ngModelChange)="endText.set($event)"
                    />
                  </label>
                </div>
                @if (startText().trim() && endText().trim()) {
                  @let gap = gapCents();
                  @if (actualCents() !== null) {
                    <p class="bpm-help">
                      {{
                        fill('checkActual', {
                          amount: signed(actualCents()!),
                          computed: signed(s.netCents),
                        })
                      }}
                    </p>
                  }
                  @if (gap === null) {
                    <p class="bmd-message" data-state="danger">{{ t('checkInvalid') }}</p>
                  } @else if (gap === 0) {
                    <p class="bmd-message" data-state="success">{{ t('checkBalanced') }}</p>
                    @if (checkedToday()) {
                      <p class="bpm-help">{{ t('checkMarked') }}</p>
                    } @else {
                      <button type="button" class="bmd-primary" (click)="markChecked()">
                        {{ t('checkMark') }}
                      </button>
                    }
                  } @else {
                    <p class="bmd-message" data-state="warning">
                      {{
                        fill(gap > 0 ? 'checkMissing' : 'checkExtra', {
                          amount: money(Math.abs(gap)),
                        })
                      }}
                    </p>
                    @if (ctx.manages() && canAdd()) {
                      @if (gap > 0) {
                        <label
                          >{{ t('gapCenter')
                          }}<select
                            name="gapCenter"
                            [ngModel]="gapCenter()"
                            (ngModelChange)="gapCenter.set($event)"
                            required
                          >
                            <option value="">—</option>
                            @for (center of s.centers; track center.id) {
                              @if (center.id) {
                                <option [value]="center.id">{{ center.name }}</option>
                              }
                            }
                          </select></label
                        >
                      }
                      @if (gap < 0) {
                        <label
                          >{{ t('incomeType')
                          }}<input
                            name="gapIncomeType"
                            [ngModel]="incomeType()"
                            (ngModelChange)="incomeType.set($event)"
                            maxlength="100"
                            [placeholder]="t('incomeTypeHint')"
                            required
                        /></label>
                      }
                      <button
                        type="button"
                        class="bmd-primary"
                        [disabled]="
                          ctx.store.saving() ||
                          (gap > 0 && !gapCenter()) ||
                          (gap < 0 && !incomeType().trim())
                        "
                        (click)="explainGap(gap)"
                      >
                        {{
                          fill(gap > 0 ? 'checkAddExpense' : 'checkAddIncome', {
                            amount: money(Math.abs(gap)),
                          })
                        }}
                      </button>
                    }
                  }
                }
              </section>
            } @else {
              @if (nature() === 'entrees' && s.incomes.length) {
                <details
                  class="bpm-disclosure bm-statement"
                  aria-labelledby="bmd-sources-title"
                  data-ui-pattern="panel"
                >
                  <summary>
                    <h2 id="bmd-sources-title">{{ t('sourcesTitle') }}</h2>
                  </summary>
                  <div class="bpm-disclosure-body">
                    <ul class="bmd-rest-lines">
                      @for (source of s.incomes; track source.title) {
                        <li>
                          <span>{{ source.title }}</span>
                          <span
                            >{{ money(source.receivedCents) }} {{ t('sourceReceived') }}
                            @if (source.plannedCents) {
                              · {{ money(source.plannedCents) }} {{ t('sourcePlanned') }}
                            }
                          </span>
                        </li>
                      }
                    </ul>
                  </div>
                </details>
              }
              @if (sums().length) {
                <details
                  class="bpm-disclosure bm-statement"
                  aria-labelledby="bmd-sums-title"
                  data-ui-pattern="panel"
                >
                  <summary>
                    <h2 id="bmd-sums-title">{{ t('sumsTitle') }}</h2>
                  </summary>
                  <div class="bpm-disclosure-body">
                    <p class="bpm-help">{{ t('sumsHelp') }}</p>
                    <table class="bmd-sums">
                      <thead>
                        <tr>
                          <th scope="col">{{ t('sumsTitleCol') }}</th>
                          <th scope="col">{{ t('sumsCountCol') }}</th>
                          <th scope="col">{{ t('sumsTotalCol') }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (sum of sums(); track sum.title) {
                          <tr>
                            <th scope="row">{{ sum.title }}</th>
                            <td>{{ sum.count }}</td>
                            <td>{{ money(sum.cents) }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </details>
              }
              <section
                class="bm-statement"
                aria-labelledby="bmd-entries-title"
                data-ui-pattern="panel"
              >
                <h2 id="bmd-entries-title">{{ t('entriesTitle') }}</h2>
                @if (!entries().length) {
                  <p class="bm-empty">{{ t('entriesNone') }}</p>
                } @else {
                  <ul class="bmd-entries">
                    @for (entry of entries(); track keyOf(entry)) {
                      <li class="bmd-entry" [class.is-editing]="editing() === keyOf(entry)">
                        <div class="bmd-entry-main">
                          <time [attr.datetime]="entry.actualDate">{{
                            shortDate(entry.actualDate)
                          }}</time>
                          @if (entry.kind === 'expense') {
                            <a
                              routerLink="/budget-patrimoine-management/depenses"
                              [queryParams]="
                                expenseQuery(
                                  entry.operationId,
                                  entry.occurrenceDate,
                                  entry.occurrenceDate
                                )
                              "
                              ><strong>{{ entry.title }}</strong></a
                            >
                          } @else {
                            <strong>{{ entry.title }}</strong
                            ><small>{{ ctx.centerName(entry.centerId) || entry.incomeType }}</small>
                          }
                          <span class="bmd-entry-amount">{{ money(entry.amountCents) }}</span>
                          @if (ctx.manages() && editing() !== keyOf(entry)) {
                            <button type="button" class="bmd-precise-open" (click)="edit(entry)">
                              {{ t('precise') }}
                            </button>
                          }
                        </div>
                        @if (entry.note) {
                          <p class="bmd-entry-note">
                            <span>{{ t('entryNote') }} ·</span> {{ entry.note }}
                          </p>
                        }
                        @if (editing() === keyOf(entry)) {
                          <form class="bmd-precise" (submit)="save(entry, $event)">
                            <p class="bmd-precise-title">
                              {{ fill('preciseTitle', { title: entry.title }) }}
                            </p>
                            <div class="bmd-field">
                              <span>{{ t('center') }}</span>
                              <rjs-parameter-choice
                                [value]="draftName() || ctx.centerName(draftCenter())"
                                (valueChange)="draftName.set($event); draftCenter.set('__new')"
                                [label]="t('center')"
                                [catalog]="
                                  ctx.store.workspace()?.proposals?.[entry.kind] ?? {
                                    standard: [],
                                    custom: [],
                                  }
                                "
                              />
                            </div>
                            <label class="bmd-field">
                              <span>{{ t('note') }}</span>
                              <input
                                name="note"
                                maxlength="500"
                                [placeholder]="t('notePlaceholder')"
                                [ngModel]="draftNote()"
                                (ngModelChange)="draftNote.set($event)"
                              />
                            </label>
                            <p class="bpm-help">
                              {{ fill('preciseScope', { title: entry.title }) }}
                            </p>
                            <div class="bmd-actions">
                              <button
                                type="submit"
                                class="bmd-primary"
                                [disabled]="ctx.store.saving()"
                              >
                                {{ t('save') }}
                              </button>
                              <button type="button" (click)="editing.set(null)">
                                {{ t('cancel') }}
                              </button>
                            </div>
                          </form>
                        }
                      </li>
                    }
                  </ul>
                }
              </section>
              @if (pending().length) {
                <section
                  class="bm-statement"
                  aria-labelledby="bmd-pending-title"
                  data-ui-pattern="panel"
                >
                  <h2 id="bmd-pending-title">{{ t('pendingTitle') }}</h2>
                  <p class="bpm-help">{{ t('pendingHelp') }}</p>
                  <ul class="bmd-rest-lines">
                    @for (item of pending(); track item.operationId + item.occurrenceDate) {
                      @let due = item.occurrenceDate <= s.today;
                      <li [attr.data-due]="due || null">
                        <span
                          >{{ shortDate(item.occurrenceDate) }} ·
                          @if (item.kind === 'expense') {
                            <a
                              routerLink="/budget-patrimoine-management/depenses"
                              [queryParams]="
                                expenseQuery(
                                  item.operationId,
                                  item.occurrenceDate,
                                  item.occurrenceDate
                                )
                              "
                              >{{ item.title }}</a
                            >
                          } @else {
                            {{ item.title }}
                          }
                          @if (due) {
                            <em class="bmd-late">{{
                              item.occurrenceDate < s.today ? t('pendingLate') : t('pendingToday')
                            }}</em>
                          }
                        </span>
                        <span class="bmd-pending-end">{{ money(item.amountCents) }} </span>
                      </li>
                    }
                  </ul>
                </section>
              }
              @if (ctx.manages() && canAdd()) {
                <section
                  class="bm-statement"
                  aria-labelledby="bmd-add-title"
                  data-ui-pattern="panel"
                >
                  <h2 id="bmd-add-title">{{ t('addTitle') }}</h2>
                  <p class="bpm-help">{{ t('addHelp-' + nature()) }}</p>
                  <form class="bmd-add" (submit)="add($event)">
                    @if (nature() === 'entrees') {
                      <label class="bmd-field"
                        >{{ t('incomeType')
                        }}<input
                          name="incomeType"
                          [ngModel]="incomeType()"
                          (ngModelChange)="incomeType.set($event)"
                          [placeholder]="t('incomeTypeHint')"
                          maxlength="100"
                          required
                      /></label>
                    }
                    <label class="bmd-field">
                      <span>{{ t('addLabel') }}</span>
                      <input
                        name="title"
                        maxlength="120"
                        [ngModel]="addTitle()"
                        (ngModelChange)="addTitle.set($event)"
                      />
                    </label>
                    <label class="bmd-field">
                      <span>{{ t('addAmount') }}</span>
                      <input
                        name="amount"
                        inputmode="decimal"
                        [ngModel]="addAmount()"
                        (ngModelChange)="addAmount.set($event)"
                      />
                    </label>
                    <label class="bmd-field">
                      <span>{{ t('addDate') }}</span>
                      <input
                        type="date"
                        name="date"
                        [min]="dateBounds().min"
                        [max]="dateBounds().max"
                        [ngModel]="addDate() || dateBounds().max"
                        (ngModelChange)="addDate.set($event)"
                      />
                    </label>
                    <button type="submit" class="bmd-primary" [disabled]="ctx.store.saving()">
                      {{ t('addSubmit') }}
                    </button>
                  </form>
                  @if (addError()) {
                    <p class="bmd-message" data-state="danger" role="alert">{{ addError() }}</p>
                  }
                </section>
              }
            }
          }
        } @else {
          <p class="bm-empty" role="status">{{ t('loading') }}</p>
        }
      }
    </div>
  `,
})
export class BpmMoneyDetailPage {
  protected expenseQuery(operation?: string, occurrence?: string, date?: string) {
    const p = this.ctx.project()!,
      w = this.ctx.window();
    return {
      ...expensePeriodQuery(p, { start: w?.start, end: w?.end, operation, occurrence, date }),
      budget: p.budgetProjectId,
    };
  }

  protected readonly ctx = inject(BpmMoneyContext);
  private readonly route = inject(ActivatedRoute);
  private readonly params = toSignal(this.route.paramMap);
  protected readonly Math = Math;
  protected readonly money = formatMoney;

  /** La nature creusée : un poste (route dédiée) ou l'une des trois autres lignes. */
  protected readonly nature = computed<MoneyNature | null>(() => {
    if (this.route.snapshot.data['nature'] === 'poste') return 'poste';
    const value = this.params()?.get('nature') ?? '';
    return (MONEY_NATURES as readonly string[]).includes(value) && value !== 'poste'
      ? (value as MoneyNature)
      : null;
  });
  protected readonly posteId = computed(() => this.params()?.get('poste') ?? '');
  protected readonly known = computed(() => {
    const nature = this.nature();
    if (!nature) return false;
    if (nature !== 'poste') return true;
    return !!this.ctx.statement()?.centers.some((center) => center.id === this.posteId());
  });
  protected readonly entries = computed(() => {
    const s = this.ctx.statement();
    const nature = this.nature();
    return s && nature ? [...entriesOf(s, nature, this.posteId())].reverse() : [];
  });
  protected readonly pending = computed(() => {
    const s = this.ctx.statement();
    const nature = this.nature();
    return s && nature ? pendingOf(s, nature, this.posteId()) : [];
  });
  protected readonly sums = computed(() => subSums(this.entries()));
  protected readonly outflows = computed(() => {
    const s = this.ctx.statement();
    return s ? moneyLines(s).outflows : [];
  });
  protected readonly centers = computed(() =>
    (this.ctx.statement()?.centers ?? []).filter((center) => center.id),
  );
  protected readonly label = computed(() => {
    const w = this.ctx.window();
    if (!w) return '';
    // « Octobre 2026 », « Semaine du 19 octobre » : seule la première lettre prend la capitale.
    const text = periodLabel(w.start, cadenceOfWindow(w.start, w.end), lensWords());
    return text.charAt(0).toLocaleUpperCase('fr') + text.slice(1);
  });
  protected readonly future = computed(() => {
    const s = this.ctx.statement();
    return !!s && s.start > s.today;
  });
  /** Un montant oublié se note seulement dans une fenêtre ouverte, déjà commencée. */
  protected readonly canAdd = computed(() => {
    const s = this.ctx.statement();
    return (
      !!s &&
      !s.closed &&
      !this.future() &&
      (this.nature() === 'poste' || this.nature() === 'entrees')
    );
  });
  protected readonly dateBounds = computed(() => {
    const s = this.ctx.statement();
    if (!s) return { min: '', max: '' };
    const last = lastDayOf(s.end);
    return { min: s.start, max: s.today < last ? s.today : last };
  });
  protected readonly title = computed(() => {
    const nature = this.nature();
    if (!nature) return this.t('unknown');
    return nature === 'poste'
      ? this.fill('title-poste', { name: this.ctx.centerName(this.posteId()) || '—' })
      : this.t('title-' + nature);
  });
  protected readonly total = computed(() =>
    this.entries().reduce((sum, entry) => sum + entry.amountCents, 0),
  );
  protected readonly lead = computed(() => {
    const nature = this.nature();
    const s = this.ctx.statement();
    if (!nature || !s) return this.t('loading');
    if (nature === 'reste') return this.t('lead-reste');
    if (nature === 'a-preciser' && !this.entries().length) return this.t('lead-a-preciserNone');
    return this.fill('lead-' + nature, {
      amount: formatMoney(this.total()),
      count: String(this.entries().length),
    });
  });
  protected readonly chips = computed<HeroChip[]>(() => {
    const s = this.ctx.statement();
    if (!s) return [];
    return [
      { label: this.t('restIncome'), value: formatMoney(s.incomeCents) },
      { label: this.t('restExpense'), value: formatMoney(s.expenseCents) },
      { label: this.t('restTotal'), value: this.signed(s.netCents) },
    ];
  });
  protected readonly tiles = computed<MetricTile[]>(() => {
    const s = this.ctx.statement();
    const nature = this.nature();
    if (!s || !nature) return [];
    const planned = this.pending().reduce((sum, item) => sum + item.amountCents, 0);
    if (nature === 'reste')
      return [
        {
          id: 'in',
          label: this.t('restIncome'),
          value: formatMoney(s.incomeCents),
          tone: 'success',
        },
        {
          id: 'out',
          link: '/budget-patrimoine-management/depenses',
          query: this.expenseQuery(),
          label: this.t('restExpense'),
          value: formatMoney(s.expenseCents),
          tone: 'danger',
        },
        {
          id: 'rest',
          label: this.t('restTotal'),
          value: this.signed(s.netCents),
          tone: s.netCents < 0 ? 'danger' : 'success',
          emphasis: true,
        },
      ];
    const income = nature === 'entrees';
    const tiles: MetricTile[] = [
      {
        id: 'total',
        label: this.t(income ? 'tileReceived' : 'tileSpent'),
        value: formatMoney(this.total()),
        tone: income ? 'success' : nature === 'a-preciser' && this.total() ? 'warning' : null,
        emphasis: true,
      },
      {
        id: 'planned',
        label: this.t(income ? 'tilePlannedIn' : 'tilePlannedOut'),
        value: formatMoney(planned),
      },
      { id: 'count', label: this.t('tileCount'), value: String(this.entries().length) },
    ];
    const basis = shareBasis(s);
    const base = basis === 'income' ? s.incomeCents : s.expenseCents;
    if (!income && base > 0 && this.total() > 0)
      tiles.push({
        id: 'share',
        label: this.t(basis === 'income' ? 'tileShare' : 'tileShareSpent'),
        value: `${String(Math.round((this.total() / base) * 1000) / 10).replace('.', ',')} %`,
      });
    if (nature === 'poste') {
      const limit = s.centers.find((center) => center.id === this.posteId())?.limitCents ?? null;
      const margin = limit === null ? null : limit - this.total() - planned;
      tiles.push({
        id: 'limit',
        label: this.t('tileLimit'),
        value: limit === null ? this.t('tileLimitNone') : formatMoney(limit),
        tone: margin !== null && margin < 0 ? 'danger' : null,
        ...(margin === null
          ? {}
          : {
              note: this.fill(margin < 0 ? 'tileLimitOver' : 'tileLimitLeft', {
                amount: formatMoney(Math.abs(margin)),
              }),
            }),
      });
    }
    return tiles;
  });
  protected readonly restNote = computed(() => {
    const s = this.ctx.statement();
    if (!s) return '';
    if (s.closure?.patrimoineAfterCents != null)
      return this.fill('restClosure', { amount: formatMoney(s.closure.patrimoineAfterCents) });
    return this.fill('restOpen', {
      date: long.format(at(lastDayOf(s.end))),
      expected: this.signed(s.netCents + s.remainingIncomeCents - s.remainingExpenseCents),
    });
  });

  // Préciser une ligne : une seule à la fois, brouillon local jusqu'à l'enregistrement.
  protected readonly editing = signal<string | null>(null);
  protected readonly gapCenter = signal('');
  protected readonly draftCenter = signal('');
  protected readonly draftName = signal('');
  protected readonly draftNote = signal('');
  protected readonly message = signal('');
  protected readonly failed = signal(false);
  // Noter un montant oublié.
  protected readonly incomeType = signal('');
  protected readonly addTitle = signal('');
  protected readonly addAmount = signal('');
  protected readonly addDate = signal('');
  protected readonly addError = signal('');
  // Vérifier avec le compte : deux soldes, rien n'est enregistré par la saisie.
  protected readonly startText = signal('');
  protected readonly endText = signal('');
  private readonly amountOf = (text: string) =>
    parseSignedAmount(text.trim().replace(/\s/g, '').replace('−', '-'));
  /** Le reste réel d'après le compte : solde d'aujourd'hui moins solde du début. */
  protected readonly actualCents = computed(() => {
    const start = this.amountOf(this.startText());
    const end = this.amountOf(this.endText());
    return start === null || end === null ? null : end - start;
  });
  protected readonly gapCents = computed(() => {
    const s = this.ctx.statement();
    return s ? unexplainedGap(s, this.actualCents()) : null;
  });

  protected t(key: string): string {
    return pageText(P + key);
  }
  protected fill(key: string, values: Record<string, string>): string {
    return Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, value),
      this.t(key),
    );
  }
  protected keyOf(entry: BpmStatementEntry): string {
    return `${entry.operationId}|${entry.occurrenceDate}|${entry.actualDate}`;
  }
  protected shortDate(value: string): string {
    return short.format(at(value));
  }
  protected longDate(value: string): string {
    return long.format(at(value));
  }
  protected signed(cents: number): string {
    return (cents > 0 ? '+' : cents < 0 ? '−' : '') + formatMoney(Math.abs(cents));
  }
  protected edit(entry: BpmStatementEntry): void {
    this.editing.set(this.keyOf(entry));
    this.draftCenter.set(entry.centerId ?? '');
    this.draftName.set('');
    this.draftNote.set(entry.note);
    this.message.set('');
  }
  protected async save(entry: BpmStatementEntry, event: Event): Promise<void> {
    event.preventDefault();
    const p = this.ctx.project();
    if (!p) return;
    const detail: {
      operationId: string;
      centerId?: string | null;
      centerName?: string;
      note?: string;
    } = {
      operationId: entry.operationId,
      note: this.draftNote(),
    };
    {
      if (this.draftCenter() === '__new') {
        if (!this.draftName().trim()) return;
        detail.centerName = this.draftName().trim();
      } else {
        if (!this.draftCenter()) return;
        detail.centerId = this.draftCenter();
      }
    }
    const ok = await this.ctx.store.precise(p.id, detail);
    this.failed.set(!ok);
    if (ok) {
      this.editing.set(null);
      this.message.set(this.t('saved'));
    }
  }
  protected async add(event: Event): Promise<void> {
    event.preventDefault();
    const p = this.ctx.project();
    const nature = this.nature();
    const cents = parseAmount(this.addAmount());
    const title = this.addTitle().trim();
    if (
      !p ||
      !nature ||
      !title ||
      !cents ||
      (nature === 'entrees' && !this.incomeType().trim()) ||
      (nature !== 'entrees' && (nature !== 'poste' || !this.posteId()))
    ) {
      this.addError.set(this.t('addInvalid'));
      return;
    }
    this.addError.set('');
    const income = nature === 'entrees';
    const ids = await this.ctx.store.addFlow(p.id, {
      kind: income ? 'income' : 'expense',
      title,
      amountCents: cents,
      date: this.addDate() || this.dateBounds().max,
      cadence: 'once',
      settled: true,
      ...(income ? { incomeType: this.incomeType().trim() } : { centerId: this.posteId() }),
    });
    this.failed.set(!ids);
    if (ids) {
      this.addTitle.set('');
      this.addAmount.set('');
      this.message.set(this.t('added'));
    }
  }
  private readonly routine = inject(BpmRoutineMemory);
  /** Vrai quand la vérification avec le compte est déjà notée aujourd'hui pour ce projet. */
  protected readonly checkedToday = computed(() => {
    const p = this.ctx.project();
    const s = this.ctx.statement();
    return !!p && !!s && this.routine.of(p.id).checked === s.today;
  });
  /** Un écart nul : le gestionnaire note que son compte est vérifié (mémoire de ce navigateur). */
  protected markChecked(): void {
    const p = this.ctx.project();
    const s = this.ctx.statement();
    if (p && s) this.routine.markChecked(p.id, s.today);
  }
  /** Noter l'écart trouvé avec le compte : une dépense affectée à son poste, ou une entrée identifiée. */
  protected async explainGap(gap: number): Promise<void> {
    const p = this.ctx.project();
    if (!p || !gap) return;
    const missing = gap > 0;
    if ((missing && !this.gapCenter()) || (!missing && !this.incomeType().trim())) return;
    const ids = await this.ctx.store.addFlow(p.id, {
      kind: missing ? 'expense' : 'income',
      title: this.t(missing ? 'checkExpenseTitle' : 'checkIncomeTitle'),
      amountCents: Math.abs(gap),
      date: this.dateBounds().max,
      cadence: 'once',
      settled: true,
      ...(missing ? { centerId: this.gapCenter() } : { incomeType: this.incomeType().trim() }),
    });
    this.failed.set(!ids);
    if (ids) {
      this.startText.set('');
      this.endText.set('');
      this.message.set(this.t('added'));
    }
  }
}
