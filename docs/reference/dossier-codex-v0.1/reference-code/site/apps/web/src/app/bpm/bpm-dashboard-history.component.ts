import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { catchError, forkJoin, of } from 'rxjs';
import { formatMoney } from '../shared/amount';
import { periodBounds, shiftDate, validDate } from '../shared/calendar';
import { calendarViewOf } from '../shared/period-lens';
import { pageText, registerPageTexts } from '../shared/page-text';
import { SITE_SETTINGS, siteSetting } from '../shared/site-settings';
import { lastDayOf, lensWords } from './bpm-lens.model';
import { BpmStatement, cadenceOfWindow, expectedRest, shiftWindow } from './bpm-money.model';
import { periodLabel, periodMark } from './bpm.model';
import {
  HISTORY_COLORS,
  HISTORY_GROUPS,
  HISTORY_COMPOSITIONS,
  HistoryMeasure,
  HistoryComposition,
  HistoryFormat,
  HistoryPartition,
  HISTORY_PARTITIONS,
  historySlicePath,
  orderedMeasures,
  compositionOf,
} from './bpm-dashboard-history.model';
export type { HistoryMeasure } from './bpm-dashboard-history.model';

const P = 'content.pages.bpm.bpm-dashboard-history.component.';
export const BPM_DASHBOARD_HISTORY_TEXTS: Record<string, string> = {
  graph: 'Évolution du budget',
  settingsTitle: 'Réglages du graphique',
  format: 'Changer de format si besoin',
  formatLabel: 'Format du graphique',
  formatHelp: 'Un seul graphique. Changez sa forme sans perdre vos sources ni leurs couleurs.',
  partition: 'Répartition à afficher',
  radialHelp:
    'Répartition de la période sélectionnée, en montants absolus. Le volume n’est pas le solde.',
  radialPeriod: 'Période du camembert ou de l’anneau',
  radialEmpty: 'Aucun montant à répartir pour cette période.',
  radialUnknown:
    'Répartition indisponible : une des sources est inconnue. Aucun pourcentage n’est inventé.',
  radialTotal: 'Volume représenté',
  inArea: 'En aire',
  inSlice: 'En part',
  'help-lines':
    'Toutes les sources choisies se superposent en courbes, sur la même échelle en euros. Les charges se lisent sous zéro.',
  'help-bars':
    'Toutes les sources choisies se comparent en barres groupées, sur la même échelle en euros. Les charges se lisent sous zéro.',
  'help-area':
    'Les aires se superposent sans s’additionner. La même échelle en euros et le zéro commun conservent les excédents et déficits.',
  resize: 'Adapter l’affichage si besoin',
  periods: 'Périodes affichées',
  height: 'Hauteur',
  decrease: 'Réduire',
  increase: 'Agrandir',
  resetSize: 'Taille initiale',
  resizeHelp:
    'Six périodes par défaut. Ajustez l’historique et la hauteur pour affiner la lecture.',
  compose: 'Composer le graphique',
  composeHint: 'Choisissez une lecture complémentaire si besoin.',
  curveSettings: 'Personnaliser les courbes si besoin',
  barSettings: 'Personnaliser les barres si besoin',
  curvesTitle: 'Courbes',
  barsTitle: 'Barres',
  barSources: 'Sources des barres',
  custom: 'Composition personnalisée',
  inverted: 'sens inversé',
  swap: 'Inverser courbes et barres',
  reset: 'Revenir à Résultat & flux',
  wealthOverlay: 'Afficher la courbe de patrimoine',
  wealthOverlayHelp:
    'Stock de patrimoine en fin de chaque période. Depuis un camembert ou un anneau, cette option ouvre la vue chronologique.',
  source: 'source',
  sources: 'sources',
  primarySources: 'Personnaliser les sources principales',
  extraSources: 'Personnaliser les sources complémentaires',
  includeExtra: 'Inclure les sources complémentaires',
  sourcesPeriod: 'périodes',
  hidden: 'masquées',
  inCurves: 'En courbe',
  inBars: 'En barre',
  inBoth: 'Courbe et barre',
  chooseHelp:
    'Choisissez librement plusieurs sources. La couleur reste attachée à la donnée, même après inversion.',
  'group-actual': 'Flux réalisés',
  'group-wealth': 'Patrimoine',
  'group-forecast': 'Fin de période et attentes',
  'group-projects': 'Projet de vie et projets personnels',
  'measure-expectedNet': 'Résultat attendu',
  'measure-expectedIncome': 'Entrées attendues au total',
  'measure-expectedExpense': 'Charges prévues au total',
  'measure-pendingIncome': 'Entrées encore attendues',
  'measure-pendingExpense': 'Charges encore à payer',
  'measure-lifeIncome': 'Entrées du projet de vie',
  'measure-lifeExpense': 'Charges du projet de vie',
  'measure-lifeNet': 'Résultat du projet de vie',
  'measure-projectIncome': 'Entrées des autres projets',
  'measure-projectExpense': 'Charges des autres projets',
  'measure-projectNet': 'Résultat des autres projets',
  sourceExpected:
    'Réalisé et échéances encore attendues dans cette période. Les prévisions non réalisées d’une période clôturée sont exclues.',
  sourcePending:
    'Échéances de la période encore attendues ; aucun montant n’est considéré comme déjà reçu ou payé.',
  sourceLife: 'Flux réalisés du seul projet de vie standard de l’utilisateur.',
  sourceProjects:
    'Flux réalisés des autres projets personnels inclus dans le budget de cet utilisateur.',
  'preset-balance': 'Résultat & flux',
  'preset-flows': 'Entrées face aux charges',
  'preset-closing': 'Réalisé & fin de période',
  'preset-wealth': 'Patrimoine & contribution',
  'preset-growth': 'Construction du patrimoine',
  'preset-contributions': 'Apports & résultats',
  'preset-income': 'Encaissements & attentes',
  'preset-expenses': 'Dépenses & reste à payer',
  'preset-pending': 'Équilibre à venir',
  'preset-life-projects': 'Vie quotidienne & projets',
  'preset-projects': 'Économie des projets',
  'preset-life': 'Économie du projet de vie',
  'preset-sources': 'Origine des entrées',
  'preset-stock-flows': 'Stock & mouvements',
  'preset-net-contribution': 'Du budget au patrimoine',
  'preset-forecast-wealth': 'Cap de fin de période',
  'preset-help-balance': 'Voir ce que les entrées et les charges laissent à chaque période.',
  'preset-help-flows': 'Comparer les deux mouvements qui produisent le résultat.',
  'preset-help-closing': 'Comparer le résultat déjà réalisé à celui attendu à la clôture.',
  'preset-help-wealth': 'Relier le stock accumulé à la contribution de chaque période.',
  'preset-help-growth': 'Distinguer le patrimoine total de la part apportée par les budgets.',
  'preset-help-contributions': 'Comparer les résultats aux apports qui s’accumulent.',
  'preset-help-income': 'Situer les montants reçus par rapport aux recettes encore attendues.',
  'preset-help-expenses': 'Situer les charges payées par rapport aux échéances restantes.',
  'preset-help-pending':
    'Voir les entrées et charges qui peuvent encore faire évoluer le résultat.',
  'preset-help-life-projects': 'Distinguer le poids du quotidien de celui des autres projets.',
  'preset-help-projects': 'Lire les recettes, les charges et le résultat des autres projets.',
  'preset-help-life': 'Lire les recettes, les charges et le résultat du budget standard.',
  'preset-help-sources': 'Distinguer les recettes du quotidien de celles des autres projets.',
  'preset-help-stock-flows': 'Mettre le patrimoine en regard des mouvements de chaque période.',
  'preset-help-net-contribution':
    'Comparer le résultat personnel et la contribution des budgets liés au patrimoine.',
  'preset-help-forecast-wealth':
    'Mettre en regard le stock projeté et le résultat attendu de la période.',
  title: 'Votre budget dans le temps',
  'title-weekly': 'Votre budget sur {count} semaines',
  'title-monthly': 'Votre budget sur {count} mois',
  'title-yearly': 'Votre budget sur {count} années',
  legend: 'Légende',
  lead: 'Comparez les dernières périodes et retrouvez les montants, leur origine et leur impact.',
  weekly: 'Lecture par semaine',
  monthly: 'Lecture par mois',
  yearly: 'Lecture par année',
  clamped: 'La période consultée est future : ce graphique s’arrête à la période en cours.',
  income: 'Entrées reçues',
  expense: 'Charges payées',
  net: 'Solde réalisé',
  comparisons: 'Sources des courbes',
  comparisonHelp:
    'Cochez une ou plusieurs courbes pour les superposer. Chaque indicateur garde sa couleur, sur une échelle commune en euros.',
  bars: 'Afficher les barres dans le graphique',
  noSelection: 'Ouvrez les réglages pour choisir au moins une source de données.',
  'measure-net': 'Résultat net de la période',
  'measure-wealth': 'Patrimoine accumulé',
  'measure-income': 'Entrées reçues de la période',
  'measure-expense': 'Charges payées de la période',
  'measure-contribution': 'Contribution de la période des budgets liés',
  'measure-cumulative': 'Apports budgétaires cumulés',
  'help-net':
    'Entrées reçues moins charges payées de chaque période, projet de vie et projets personnels réunis.',
  'help-wealth':
    'Patrimoine en fin de période ; estimation pour la période en cours. Une valeur inconnue interrompt la courbe.',
  'help-income':
    'Entrées réellement reçues dans chaque période. Les recettes encore attendues sont conservées dans le détail.',
  'help-expense':
    'Charges réellement payées dans chaque période, représentées en négatif pour suivre les barres de sortie.',
  'help-contribution':
    'Résultat des budgets liés au patrimoine. Les périodes non clôturées restent des estimations.',
  'help-cumulative':
    'Clôtures budgétaires acquises dans le patrimoine à chaque date passée, puis estimation avec la période en cours.',
  estimated: 'Estimation',
  estimatedAt: 'Estimation au',
  valueAt: 'Valeur au',
  curveUnavailable: 'Valeur inconnue',
  estimateLegend:
    'Valeurs acquises en plein. Estimations en pointillés, avec points creux ou barres en contour.',
  sourceConsolidated:
    'Flux réalisés du projet de vie et des projets personnels, consolidés sans double compte.',
  sourceStandard:
    'Relevé réalisé du budget standard ; consolidation des autres projets indisponible.',
  sourceWealthHistory:
    'Stock historique : actifs et versements datés, avec les clôtures déjà enregistrées à cette date.',
  sourceWealthForecast:
    'Stock estimé à la clôture : actifs connus et apports historiques, plus le résultat attendu des budgets liés.',
  sourceWealthUnknown:
    'Le stock de cette date est incomplet ou indisponible. Aucune valeur ne remplace cette information manquante.',
  sourceContribution:
    'Résultat de la période retenu pour les budgets liés au patrimoine ; une période non clôturée reste prévisionnelle.',
  sourceCumulativeHistory:
    'Cumul des seuls soldes budgétaires déjà clôturés et acquis dans le patrimoine à cette date.',
  sourceCumulativeForecast:
    'Cumul des clôtures historiques et du résultat attendu de la période pour les budgets liés.',
  sourceUnavailable: 'Cette mesure n’est pas disponible dans le relevé de cette période.',
  expected: 'Solde attendu à la fin de la période',
  expectedHelp: 'Réalisé + entrées encore attendues − charges encore prévues.',
  pendingIncome: 'Encore attendu',
  pendingExpense: 'Encore prévu',
  chartHelp:
    'Courbes et barres sur les mêmes périodes et la même échelle. Les charges se lisent sous zéro.',
  scale: 'Échelle de chaque côté du zéro',
  zero: 'Zéro',
  closed: 'Clôturée',
  past: 'Passée',
  current: 'En cours',
  future: 'À venir',
  empty: 'Aucun flux enregistré',
  loading: 'Lecture des périodes précédentes…',
  unavailable: 'Indisponible',
  partial: 'Certaines périodes n’ont pas pu être chargées. Leurs montants ne sont pas représentés.',
  retry: 'Réessayer',
  consolidated: 'Projet de vie et projets personnels',
  standard: 'Projet de vie uniquement · relevé ancien',
  standardHelp:
    'La consolidation des autres projets n’est pas disponible dans ce relevé. Les barres montrent uniquement le budget standard.',
  period: 'Période sélectionnée',
  until: 'au',
  open: 'Ouvrir cette période',
  selection: 'Sélectionner la période',
  contribution: 'Solde des budgets liés au patrimoine',
  contributionForecast: 'Contribution estimée des budgets liés',
  contributionHelp:
    'Résultat de la période versé au patrimoine. Pour la période en cours, c’est une estimation.',
  contributionUnavailable: 'Contribution patrimoniale non disponible dans ce relevé.',
  noData: 'Cette période est indisponible. Réessayez pour obtenir ses montants.',
};
registerPageTexts(
  Object.fromEntries(
    Object.entries(BPM_DASHBOARD_HISTORY_TEXTS).map(([key, value]) => [P + key, value]),
  ),
);

interface HistoryWindow {
  start: string;
  end: string;
}
interface HistoryReading extends HistoryWindow {
  statement: BpmStatement | null;
  unavailable: boolean;
}
interface HistoryPeriod extends HistoryReading {
  label: string;
  mark: string;
  year: string;
  state: 'closed' | 'past' | 'current' | 'future';
  income: number;
  expense: number;
  net: number;
  expected: number;
  pendingIncome: number;
  pendingExpense: number;
  contribution: number | null;
  consolidated: boolean;
  empty: boolean;
}
interface CurveReading {
  amount: number | null;
  date: string;
  source: string;
  estimated: boolean;
}

/** Six relevés datés en lecture seule, avec des stocks historiques fournis par le serveur. */
@Component({
  selector: 'rjs-bpm-dashboard-history',
  imports: [RouterLink, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './bpm-dashboard-history.component.scss',
  template: `
    <section
      class="dh-history"
      [class.dh-wealth-enabled]="showWealthCurve()"
      aria-labelledby="bm-history-title"
      [attr.aria-busy]="loading()"
    >
      <header class="dh-heading">
        <div>
          <span class="dh-eyebrow"><span aria-hidden="true">▥</span> {{ t('graph') }}</span>
          <h2 id="bm-history-title">
            {{ t('title-' + cadence()).replace('{count}', '' + periodCount()) }}
          </h2>
          <p>{{ t('lead') }}</p>
        </div>
        <span class="dh-cadence">{{ t(cadence()) }}</span>
      </header>
      @if (clamped()) {
        <p class="dh-notice">{{ t('clamped') }}</p>
      }
      <div class="dh-workspace" data-bpm-frame="chart">
        <p class="dh-chart-help" id="bm-history-help">
          {{
            t(radial() ? 'radialHelp' : format() === 'combined' ? 'chartHelp' : 'help-' + format())
          }}
        </p>
        @if (hasEstimates()) {
          <p class="dh-estimate-help">{{ t('estimateLegend') }}</p>
        }
        <div class="dh-toolbar">
          <strong>{{ compositionLabel() }}</strong>
          <div class="dh-chart-actions">
            <label class="dh-wealth-toggle" [title]="t('wealthOverlayHelp')">
              <input
                type="checkbox"
                [checked]="showWealthCurve()"
                (change)="toggleWealthCurve($any($event.target).checked)"
                aria-controls="bm-history-chart"
                [attr.aria-description]="t('wealthOverlayHelp')"
              />
              <span>{{ t('wealthOverlay') }}</span>
            </label>
            @if (format() === 'combined') {
              <button type="button" class="btn btn-secondary" (click)="invert()">
                ⇅ {{ t('swap') }}
              </button>
            }
            <button
              type="button"
              class="btn btn-quiet"
              (click)="applyComposition(compositions[0]!)"
            >
              {{ t('reset') }}
            </button>
          </div>
        </div>
        @if (radial()) {
          <div
            class="dh-radial-view"
            id="bm-history-chart"
            [style.--dh-height-scale]="size('height') / 100"
          >
            <div class="dh-radial-heading">
              <h3>{{ partitionLabel() }}</h3>
              <label class="dh-field"
                ><span>{{ t('radialPeriod') }}</span>
                <select [ngModel]="selected()?.start" (ngModelChange)="selectedStart.set($event)">
                  @for (period of periods(); track period.start) {
                    <option [value]="period.start">
                      {{ period.label }} ·
                      {{ t(period.unavailable ? 'unavailable' : period.state) }}
                    </option>
                  }
                </select>
              </label>
            </div>
            @if (pie(); as chart) {
              @if (chart.total !== null && chart.total > 0) {
                <div class="dh-radial-layout">
                  <figure class="dh-radial-figure" [class.dh-ring-figure]="format() === 'donut'">
                    <svg
                      class="dh-pie"
                      viewBox="0 0 200 200"
                      role="img"
                      [attr.aria-label]="pieDescription()"
                    >
                      <title>{{ partitionLabel() }} · {{ selected()?.label }}</title>
                      @for (slice of chart.slices; track slice.measure) {
                        <path
                          [attr.d]="slice.path"
                          [style.--curve-color]="colors[slice.measure]"
                          [class.dh-slice-estimated]="slice.estimated"
                          [attr.data-measure]="slice.measure"
                        >
                          <title>
                            {{ t('measure-' + slice.measure) }} ·
                            {{ curveMoney(slice.amount!, slice.measure) }} ·
                            {{ percent(slice.share) }}
                          </title>
                        </path>
                      }
                      @if (format() === 'donut') {
                        <circle class="dh-donut-hole" cx="100" cy="100" r="53" />
                      }
                    </svg>
                    <figcaption>
                      <small>{{ t('radialTotal') }}</small
                      ><strong>{{ money(chart.total) }}</strong>
                    </figcaption>
                  </figure>
                  <div class="dh-radial-legend">
                    @for (slice of chart.readings; track slice.measure) {
                      <div
                        class="dh-radial-item"
                        [style.--curve-color]="colors[slice.measure]"
                        [attr.data-measure]="slice.measure"
                      >
                        <span class="dh-slice-key" aria-hidden="true"></span>
                        <div>
                          <strong>{{ t('measure-' + slice.measure) }}</strong
                          ><small
                            >{{ t(slice.estimated ? 'estimated' : 'valueAt')
                            }}{{ slice.estimated ? '' : ' ' + date(slice.date) }}</small
                          >
                        </div>
                        <div class="dh-radial-amount">
                          <strong>{{ curveMoney(slice.amount!, slice.measure) }}</strong
                          ><small>{{ percent(slice.share) }}</small>
                        </div>
                      </div>
                    }
                  </div>
                </div>
              } @else {
                <p class="dh-notice">
                  {{ t(chart.total === null ? 'radialUnknown' : 'radialEmpty') }}
                </p>
              }
            }
          </div>
        } @else {
          <p class="dh-scale">{{ t('scale') }} · {{ money(maximum()) }}</p>
          <div
            class="dh-chart-scroll"
            tabindex="0"
            aria-describedby="bm-history-help"
            [style.--dh-width]="Math.max(100, (periodCount() / 6) * 100) + '%'"
            [style.--dh-count]="periodCount()"
            [style.--dh-label-headroom]="labelHeadroom() + 'px'"
            [style.--dh-column-min]="Math.max(120, panels()[0]!.bars.length * 64 + 16) + 'px'"
            [style.--dh-height-scale]="size('height') / 100"
          >
            @for (panel of panels(); track panel.id) {
              <section class="dh-panel" [attr.aria-label]="formatLabel()">
                <h3 class="dh-panel-title">{{ t('title') }}</h3>
                <div class="dh-legend" [attr.aria-label]="t('legend')">
                  @for (option of panel.curves; track option) {
                    <span [style.--curve-color]="colors[option]"
                      ><i class="dh-curve-key" aria-hidden="true"></i>{{ t('measure-' + option) }} ·
                      {{ t(format() === 'area' ? 'inArea' : 'inCurves') }}</span
                    >
                  }
                  @if (panel.bars.length) {
                    @for (option of panel.bars; track option) {
                      <span [style.--curve-color]="colors[option]"
                        ><i class="dh-bar-key" aria-hidden="true"></i>{{ t('measure-' + option) }} ·
                        {{ t('inBars') }}</span
                      >
                    }
                  }
                </div>
                @if (!panel.measures.length) {
                  <p class="dh-notice">{{ t('noSelection') }}</p>
                }
                <div
                  class="dh-chart"
                  [class.dh-line-chart]="panel.curves.length > 0"
                  id="bm-history-chart"
                  role="group"
                  [attr.aria-label]="t('title')"
                >
                  @for (period of periods(); track period.start) {
                    <button
                      class="dh-column"
                      type="button"
                      [class.dh-unavailable]="period.unavailable"
                      [attr.aria-pressed]="selectedStart() === period.start"
                      aria-controls="bm-history-detail"
                      [attr.aria-label]="periodDescription(period)"
                      (click)="selectedStart.set(period.start)"
                    >
                      <span class="dh-column-heading"
                        ><strong>{{ period.mark }}</strong
                        ><small>{{ period.year }}</small
                        ><small class="dh-state">{{
                          period.unavailable ? t('unavailable') : t(period.state)
                        }}</small></span
                      >
                      <span class="dh-plot" aria-hidden="true"
                        ><span class="dh-zero">0</span>
                        @if (panel.bars.length) {
                          @for (option of panel.bars; track option) {
                            @let value = readingFor(period, option);
                            <span
                              class="dh-bar-track"
                              [style.--curve-color]="colors[option]"
                              [attr.data-measure]="option"
                            >
                              @if (value.amount !== null) {
                                <span
                                  class="dh-bar"
                                  [class.dh-bar-estimated]="value.estimated"
                                  [style.height.%]="height(value.amount)"
                                  [style.bottom.%]="value.amount >= 0 ? 50 : null"
                                  [style.top.%]="value.amount < 0 ? 50 : null"
                                ></span>
                              }
                            </span>
                          }
                        }
                        @for (label of labelsFor(period); track label.key) {
                          <span
                            class="dh-mark-label"
                            [class.dh-curve-label]="label.kind === 'curve'"
                            [class.dh-bar-label]="label.kind === 'bar'"
                            [class.dh-label-estimated]="label.estimated"
                            [style.--curve-color]="colors[label.measure]"
                            [style.top.%]="label.top"
                            [style.left.%]="label.left"
                            [style.--dh-label-lift]="label.lift + 'px'"
                            [attr.data-measure]="label.measure"
                            [attr.title]="
                              t('measure-' + label.measure) +
                              ' · ' +
                              curveMoney(label.amount, label.measure)
                            "
                          >
                            @if (label.lift > 0) {
                              <i class="dh-label-connector"></i>
                            }
                            {{ markMoney(label.amount) }}
                          </span>
                        }
                      </span>
                      <span class="dh-column-values">
                        @for (option of panel.measures; track option) {
                          @let value = readingFor(period, option);
                          <small
                            [style.color]="
                              option === 'wealth' && showWealthCurve()
                                ? 'var(--history-wealth-label)'
                                : colors[option]
                            "
                            [attr.aria-label]="
                              t('measure-' + option) +
                              ' · ' +
                              (value.amount !== null
                                ? curveMoney(value.amount, option)
                                : t('curveUnavailable'))
                            "
                            [attr.title]="t('measure-' + option)"
                            >{{
                              value.amount !== null ? curveMoney(value.amount, option) : '—'
                            }}</small
                          >
                        }
                      </span>
                      <small class="dh-column-note">{{
                        period.empty ? t('empty') : period.unavailable ? t('unavailable') : ''
                      }}</small>
                    </button>
                  }
                  @if (panel.curves.length) {
                    <svg
                      class="dh-curve"
                      viewBox="0 0 600 120"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                      focusable="false"
                    >
                      @for (series of curves(); track series.measure) {
                        <g
                          [attr.data-measure]="series.measure"
                          [style.--curve-color]="colors[series.measure]"
                        >
                          @for (segment of series.segments; track $index) {
                            @if (
                              format() === 'area' &&
                              !(showWealthCurve() && series.measure === 'wealth')
                            ) {
                              <polygon class="dh-area" [attr.points]="areaPoints(segment.points)" />
                            }
                            <polyline
                              [attr.points]="segment.points"
                              [class.dh-segment-estimated]="segment.estimated"
                            />
                          }
                          @for (point of series.points; track point.x) {
                            <circle
                              [attr.cx]="point.x"
                              [attr.cy]="point.y"
                              [class.dh-point-estimated]="point.estimated"
                              r="3"
                            />
                          }
                        </g>
                      }
                    </svg>
                  }
                </div>
              </section>
            }
          </div>
        }
        @if (loading()) {
          <p class="dh-state-message" role="status">{{ t('loading') }}</p>
        }
        @if (error()) {
          <div class="dh-state-message dh-error" role="alert">
            <p>{{ t('partial') }}</p>
            <button class="btn btn-secondary" type="button" (click)="retry.update(increment)">
              {{ t('retry') }}
            </button>
          </div>
        }
        @if (selected(); as period) {
          <section
            class="dh-detail"
            id="bm-history-detail"
            aria-labelledby="bm-history-detail-title"
            aria-live="polite"
          >
            <header class="dh-detail-heading">
              <div>
                <small>{{ t('period') }} · {{ t(period.state) }}</small>
                <h3 id="bm-history-detail-title">{{ period.label }}</h3>
                <p>{{ date(period.start) }} {{ t('until') }} {{ date(lastDay(period.end)) }}</p>
              </div>
              <a
                class="btn btn-secondary"
                routerLink="/budget-patrimoine-management/tableau-de-bord"
                [queryParams]="{ projet: projectId(), du: period.start, au: period.end }"
                fragment="bm-key-figures"
                >{{ t('open') }} →</a
              >
            </header>
            @if (period.statement) {
              <div class="dh-selected-series">
                @for (option of displayedMeasures(); track option) {
                  @let reading = readingFor(period, option);
                  <div
                    class="dh-selected-measure"
                    [attr.data-measure]="option"
                    [style.--curve-color]="colors[option]"
                  >
                    <div>
                      <small>{{ t('measure-' + option) }} · {{ roleOf(option) }}</small>
                      <strong>{{
                        reading.amount !== null
                          ? curveMoney(reading.amount, option)
                          : t('curveUnavailable')
                      }}</strong>
                      <span
                        >{{ t(reading.estimated ? 'estimatedAt' : 'valueAt') }}
                        {{ date(reading.date) }}</span
                      >
                    </div>
                    <p>{{ t(reading.source) }}</p>
                  </div>
                }
              </div>
              <p class="dh-scope">{{ t(period.consolidated ? 'consolidated' : 'standardHelp') }}</p>
              @if (period.empty) {
                <p class="dh-notice">{{ t('empty') }}</p>
              }
            } @else {
              <p>{{ loading() ? t('loading') : t('noData') }}</p>
            }
          </section>
        }
      </div>
      <section class="dh-settings-workspace" aria-labelledby="bm-history-settings-title">
        <h3 id="bm-history-settings-title">{{ t('settingsTitle') }}</h3>
        <div class="dh-top-controls">
          <div class="dh-settings-list">
            <details class="dh-settings dh-format-settings">
              <summary>
                <span
                  ><strong>{{ t('format') }}</strong
                  ><small>{{ formatLabel() }}</small></span
                ><b aria-hidden="true">⌄</b>
              </summary>
              <div class="dh-settings-body">
                <p class="dh-chart-help">{{ t('formatHelp') }}</p>
                <label class="dh-field"
                  ><span>{{ t('formatLabel') }}</span>
                  <select [ngModel]="format()" (ngModelChange)="changeFormat($event)">
                    @for (option of formats; track option.value) {
                      <option [value]="option.value">{{ option.label }}</option>
                    }
                  </select>
                </label>
                @if (radial()) {
                  <label class="dh-field"
                    ><span>{{ t('partition') }}</span>
                    <select [ngModel]="partition()" (ngModelChange)="chartPartition.set($event)">
                      @for (option of partitions; track option.value) {
                        <option [value]="option.value">{{ option.label }}</option>
                      }
                    </select>
                  </label>
                }
              </div>
            </details>
            @if (!radial()) {
              <details class="dh-settings">
                <summary>
                  <span
                    ><strong>{{ t('compose') }}</strong
                    ><small>{{ compositionLabel() }} · {{ t('composeHint') }}</small></span
                  ><b aria-hidden="true">⌄</b>
                </summary>
                <div class="dh-settings-body dh-presets">
                  @for (preset of compositions; track preset.id) {
                    <button
                      type="button"
                      class="dh-preset"
                      [attr.aria-pressed]="
                        composition()?.composition?.id === preset.id && !composition()?.inverted
                      "
                      (click)="applyComposition(preset)"
                    >
                      <strong>{{ t('preset-' + preset.id) }}</strong>
                      <span>{{ t('preset-help-' + preset.id) }}</span>
                      <small>{{ t('curvesTitle') }} · {{ sourceNames(preset.curves) }}</small>
                      <small>{{ t('barsTitle') }} · {{ sourceNames(preset.bars) }}</small>
                    </button>
                  }
                </div>
              </details>
              @for (target of ['curves', 'bars']; track target) {
                <details class="dh-settings" [attr.data-settings]="target">
                  <summary>
                    <span
                      ><strong>{{
                        t(
                          format() === 'combined'
                            ? target === 'curves'
                              ? 'curveSettings'
                              : 'barSettings'
                            : target === 'curves'
                              ? 'primarySources'
                              : 'extraSources'
                        )
                      }}</strong
                      ><small
                        >{{ (target === 'curves' ? activeMeasures() : activeBarMeasures()).length }}
                        {{
                          t(
                            (target === 'curves' ? activeMeasures() : activeBarMeasures())
                              .length === 1
                              ? 'source'
                              : 'sources'
                          )
                        }}
                        ·
                        {{
                          sourceNames(target === 'curves' ? activeMeasures() : activeBarMeasures())
                        }}</small
                      ></span
                    ><b aria-hidden="true">⌄</b>
                  </summary>
                  <div class="dh-settings-body">
                    <p class="dh-chart-help">{{ t('chooseHelp') }}</p>
                    @if (target === 'bars') {
                      <label class="dh-options"
                        ><input
                          type="checkbox"
                          [ngModel]="showBars()"
                          (ngModelChange)="showBars.set($event)"
                        />{{ t(format() === 'combined' ? 'bars' : 'includeExtra') }}</label
                      >
                    }
                    @for (group of groups; track group.id) {
                      <fieldset class="dh-comparisons">
                        <legend>{{ t('group-' + group.id) }}</legend>
                        <div class="dh-comparison-options">
                          @for (option of group.measures; track option) {
                            <label
                              [style.--curve-color]="colors[option]"
                              [class.dh-option-active]="
                                (target === 'curves'
                                  ? activeMeasures()
                                  : activeBarMeasures()
                                ).includes(option)
                              "
                            >
                              <input
                                type="checkbox"
                                [checked]="
                                  (target === 'curves'
                                    ? activeMeasures()
                                    : activeBarMeasures()
                                  ).includes(option)
                                "
                                (change)="
                                  toggleComparison(option, target === 'curves' ? 'curves' : 'bars')
                                "
                              />
                              <i aria-hidden="true"></i><span>{{ t('measure-' + option) }}</span>
                            </label>
                          }
                        </div>
                      </fieldset>
                    }
                  </div>
                </details>
              }
            }
          </div>
          <details class="dh-settings dh-display-settings">
            <summary>
              <span
                ><strong>{{ t('resize') }}</strong
                ><small
                  >{{ periodCount() }} {{ t('sourcesPeriod') }} · {{ size('height') }} %</small
                ></span
              ><b aria-hidden="true">⌄</b>
            </summary>
            <div class="dh-settings-body dh-resize">
              @for (axis of sizeAxes; track axis.id) {
                <div class="dh-size-control">
                  <label [for]="'bm-history-' + axis.id">
                    <span
                      ><span aria-hidden="true">{{ axis.id === 'height' ? '↕' : '↔' }}</span>
                      {{ t(axis.id) }}</span
                    >
                    <output
                      >{{ size(axis.id) }}
                      {{ axis.id === 'height' ? '%' : t('sourcesPeriod') }}</output
                    >
                  </label>
                  <div class="dh-size-range">
                    <button
                      type="button"
                      class="btn btn-secondary"
                      [attr.aria-label]="t('decrease') + ' · ' + t(axis.id)"
                      [disabled]="size(axis.id) <= axis.min"
                      (click)="resize(axis.id, size(axis.id) - axis.step)"
                    >
                      −
                    </button>
                    <input
                      type="range"
                      [id]="'bm-history-' + axis.id"
                      [min]="axis.min"
                      [max]="axis.max"
                      [step]="axis.step"
                      [value]="size(axis.id)"
                      [attr.aria-valuetext]="
                        size(axis.id) + (axis.id === 'height' ? ' %' : ' ' + t('sourcesPeriod'))
                      "
                      aria-controls="bm-history-chart"
                      (input)="resize(axis.id, $any($event.target).valueAsNumber)"
                    />
                    <button
                      type="button"
                      class="btn btn-secondary"
                      [attr.aria-label]="t('increase') + ' · ' + t(axis.id)"
                      [disabled]="size(axis.id) >= axis.max"
                      (click)="resize(axis.id, size(axis.id) + axis.step)"
                    >
                      +
                    </button>
                  </div>
                </div>
              }
              <button type="button" class="btn btn-quiet" (click)="resetSize()">
                ↺ {{ t('resetSize') }}
              </button>
              <small>{{ t('resizeHelp') }}</small>
            </div>
          </details>
        </div>
      </section>
    </section>
  `,
})
export class BpmDashboardHistoryComponent {
  readonly statement = input.required<BpmStatement>();
  readonly projectId = input.required<string>();
  readonly selectedMeasures = model<HistoryMeasure[]>(['net']);
  readonly showBars = model(true);
  readonly barMeasures = model<HistoryMeasure[]>(['income', 'expense']);
  readonly chartHeight = model<number | null>(null);
  readonly chartPeriods = model<number | null>(null);
  readonly chartFormat = model<HistoryFormat | null>(null);
  readonly chartPartition = model<HistoryPartition | null>(null);
  readonly showWealthCurve = model(false);
  protected readonly formats = SITE_SETTINGS.find((value) => value.key === 'bpm.historique.format')!
    .options!;
  protected readonly partitions = SITE_SETTINGS.find(
    (value) => value.key === 'bpm.historique.repartition',
  )!.options!;
  protected readonly format = computed(
    () => this.chartFormat() ?? siteSetting<HistoryFormat>('bpm.historique.format'),
  );
  protected readonly partition = computed(
    () => this.chartPartition() ?? siteSetting<HistoryPartition>('bpm.historique.repartition'),
  );
  protected readonly formatLabel = computed(
    () => this.formats.find((value) => value.value === this.format())!.label,
  );
  protected readonly partitionLabel = computed(
    () => this.partitions.find((value) => value.value === this.partition())!.label,
  );
  protected readonly radial = computed(() => ['pie', 'donut'].includes(this.format()));
  protected readonly Math = Math;
  protected readonly sizeAxes = (
    [
      ['height', 'hauteurPct'],
      ['periods', 'periodes'],
    ] as const
  ).map(([id, key]) => {
    const definition = SITE_SETTINGS.find((setting) => setting.key === 'bpm.historique.' + key)!;
    return {
      id,
      key: definition.key,
      min: definition.min!,
      max: definition.max!,
      step: definition.step!,
    };
  });
  protected size(id: 'height' | 'periods'): number {
    const value = id === 'height' ? this.chartHeight() : this.chartPeriods();
    return value ?? siteSetting<number>(this.sizeAxes.find((axis) => axis.id === id)!.key);
  }
  protected resize(id: 'height' | 'periods', value: number): void {
    if (!Number.isFinite(value)) return;
    const axis = this.sizeAxes.find((axis) => axis.id === id)!;
    const next = Math.max(
      axis.min,
      Math.min(axis.max, axis.min + Math.round((value - axis.min) / axis.step) * axis.step),
    );
    (id === 'height' ? this.chartHeight : this.chartPeriods).set(next);
  }
  protected resetSize(): void {
    this.chartHeight.set(null);
    this.chartPeriods.set(null);
  }
  protected readonly periodCount = computed(() => this.size('periods'));
  protected readonly panels = computed(() => [
    {
      id: 'combined',
      curves: orderedMeasures([
        ...(this.showWealthCurve() ? ['wealth' as const] : []),
        ...(this.format() === 'bars'
          ? []
          : this.format() === 'combined'
            ? this.activeMeasures()
            : this.timelineMeasures()),
      ]),
      bars: (this.format() === 'bars'
        ? this.timelineMeasures()
        : this.format() === 'combined' && this.showBars()
          ? this.activeBarMeasures()
          : []
      ).filter((measure) => !this.showWealthCurve() || measure !== 'wealth'),
      measures: this.displayedMeasures(),
    },
  ]);
  protected readonly colors = HISTORY_COLORS;
  protected readonly groups = HISTORY_GROUPS;
  protected readonly compositions = HISTORY_COMPOSITIONS;
  protected readonly activeMeasures = computed(() => orderedMeasures(this.selectedMeasures()));
  protected readonly activeBarMeasures = computed(() => orderedMeasures(this.barMeasures()));
  protected readonly displayedMeasures = computed(() =>
    this.radial() ? [...HISTORY_PARTITIONS[this.partition()]] : this.timelineMeasures(),
  );
  protected readonly timelineMeasures = computed(() =>
    orderedMeasures([
      ...this.activeMeasures(),
      ...(this.showBars() ? this.activeBarMeasures() : []),
      ...(this.showWealthCurve() ? ['wealth' as const] : []),
    ]),
  );
  protected readonly composition = computed(() =>
    compositionOf(this.activeMeasures(), this.activeBarMeasures()),
  );
  protected readonly compositionLabel = computed(() => {
    const value = this.composition();
    return value
      ? this.t('preset-' + value.composition.id) +
          (value.inverted ? ' · ' + this.t('inverted') : '')
      : this.t('custom');
  });
  protected toggleComparison(option: HistoryMeasure, target: 'curves' | 'bars' = 'curves'): void {
    const model = target === 'curves' ? this.selectedMeasures : this.barMeasures;
    const current = model();
    model.set(
      current.includes(option) ? current.filter((value) => value !== option) : [...current, option],
    );
  }
  protected applyComposition(value: HistoryComposition): void {
    this.selectedMeasures.set([...value.curves]);
    this.barMeasures.set([...value.bars]);
    this.showBars.set(true);
  }
  protected invert(): void {
    const previous = [...this.activeMeasures()];
    this.selectedMeasures.set([...this.activeBarMeasures()]);
    this.barMeasures.set(previous);
    this.showBars.set(true);
  }
  protected toggleWealthCurve(visible: boolean): void {
    if (visible && this.radial()) this.chartFormat.set('combined');
    this.showWealthCurve.set(visible);
  }
  protected changeFormat(format: HistoryFormat): void {
    this.chartFormat.set(format);
    if (['pie', 'donut'].includes(format)) this.showWealthCurve.set(false);
  }
  protected sourceNames(values: readonly HistoryMeasure[]): string {
    return values.map((value) => this.t('measure-' + value)).join(' · ');
  }
  protected roleOf(measure: HistoryMeasure): string {
    if (this.radial()) return this.t('inSlice');
    if (measure === 'wealth' && this.showWealthCurve()) return this.t('inCurves');
    if (this.format() === 'lines') return this.t('inCurves');
    if (this.format() === 'area') return this.t('inArea');
    if (this.format() === 'bars') return this.t('inBars');
    return this.t(
      this.activeMeasures().includes(measure)
        ? this.showBars() && this.activeBarMeasures().includes(measure)
          ? 'inBoth'
          : 'inCurves'
        : 'inBars',
    );
  }
  protected readingFor(period: HistoryPeriod, measure: HistoryMeasure): CurveReading {
    return this.curveReading(
      period,
      period.income,
      period.expense,
      period.net,
      period.state === 'closed',
      measure,
    );
  }
  private readonly http = inject(HttpClient);
  private readonly readings = signal<HistoryReading[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  protected readonly retry = signal(0);
  protected readonly increment = (value: number) => value + 1;
  protected readonly selectedStart = signal('');
  protected readonly money = formatMoney;
  protected readonly lastDay = lastDayOf;
  protected readonly cadence = computed(() =>
    cadenceOfWindow(this.statement().start, this.statement().end),
  );
  protected readonly clamped = computed(() => this.statement().start > this.statement().today);
  private readonly windows = computed(() => {
    const source = this.statement();
    let last: HistoryWindow = { start: source.start, end: source.end };
    if (source.start > source.today && validDate(source.today)) {
      const current = periodBounds(source.today, calendarViewOf(this.cadence()));
      last = { start: current.start, end: shiftDate(current.end, 1) };
    }
    const result = [last];
    for (let index = 0; index < this.periodCount() - 1; index++)
      result.unshift(shiftWindow(result[0]!.start, result[0]!.end, -1));
    return result;
  });
  protected readonly periods = computed<HistoryPeriod[]>(() =>
    this.readings().map((reading) => {
      const source = reading.statement;
      const flow =
        source?.flowPilot?.start === reading.start && source.flowPilot.end === reading.end
          ? source.flowPilot
          : null;
      const rows = source?.periodFlows;
      const closed =
        !!source?.closed &&
        !!rows &&
        [...rows.income.rows, ...rows.expense.rows].every((row) => row.closed);
      const state = closed
        ? 'closed'
        : reading.end <= this.statement().today
          ? 'past'
          : reading.start > this.statement().today
            ? 'future'
            : 'current';
      const income = flow?.incomeCents ?? source?.incomeCents ?? 0;
      const expense = flow?.expenseCents ?? source?.expenseCents ?? 0;
      const expectedIncome =
        flow?.expectedIncomeCents ??
        (source ? source.incomeCents + source.remainingIncomeCents : 0);
      const expectedExpense =
        flow?.expectedExpenseCents ??
        (source ? source.expenseCents + source.remainingExpenseCents : 0);
      const net = flow?.netCents ?? source?.netCents ?? 0;
      return {
        ...reading,
        label: periodLabel(reading.start, this.cadence(), lensWords()),
        mark: periodMark(reading.start, this.cadence()),
        year: this.cadence() === 'yearly' ? '' : reading.start.slice(0, 4),
        state,
        income,
        expense,
        net,
        expected: flow?.expectedNetCents ?? (source ? expectedRest(source) : 0),
        pendingIncome: Math.max(0, expectedIncome - income),
        pendingExpense: Math.max(0, expectedExpense - expense),
        contribution: flow?.periodWealth?.currentClosureCents ?? null,
        consolidated: !!flow,
        empty: !!source && income === 0 && expense === 0,
      };
    }),
  );
  protected readonly selected = computed(
    () =>
      this.periods().find((period) => period.start === this.selectedStart()) ??
      this.periods().at(-1) ??
      null,
  );
  protected readonly maximum = computed(() =>
    Math.max(
      0,
      ...this.periods()
        .filter((period) => !!period.statement)
        .flatMap((period) => [
          ...this.displayedMeasures().map((measure) =>
            Math.abs(this.readingFor(period, measure).amount ?? 0),
          ),
        ]),
    ),
  );
  /** Le même zéro et la même échelle que les barres, avec une rupture à chaque lecture absente. */
  protected readonly curves = computed(() =>
    this.panels()[0]!.curves.map((measure) => ({ measure, ...this.drawCurve(measure) })),
  );
  protected markMoney(value: number): string {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value / 100);
  }
  protected labelsFor(period: HistoryPeriod) {
    const panel = this.panels()[0]!;
    const scale = this.size('height') / 100;
    const labels = [
      ...panel.curves.map((measure) => ({ measure, kind: 'curve' as const, left: 50 })),
      ...panel.bars.map((measure, index) => ({
        measure,
        kind: 'bar' as const,
        left: ((index + 0.5) / panel.bars.length) * 100,
      })),
    ]
      .flatMap((label) => {
        const reading = this.readingFor(period, label.measure);
        if (reading.amount === null) return [];
        const top =
          50 -
          (label.kind === 'bar'
            ? this.height(Math.max(0, reading.amount))
            : Math.sign(reading.amount) * this.height(reading.amount));
        return [
          {
            ...label,
            key: label.kind + '-' + label.measure,
            amount: reading.amount,
            estimated: reading.estimated,
            top,
            anchor: top,
            lift: 0,
          },
        ];
      })
      .sort((a, b) => b.top - a.top);
    // Reserve a readable line above the anchor; labels never cover the mark itself.
    const placed: typeof labels = [];
    for (const label of labels) {
      for (const previous of placed) {
        if (
          Math.abs(label.left - previous.left) < 65 &&
          Math.abs(label.top - previous.top) < 14 / scale
        )
          label.top = Math.min(label.top, previous.top - 14 / scale);
      }
      label.lift = (label.anchor - label.top) * 2 * scale;
      placed.push(label);
    }
    return labels;
  }
  protected readonly labelHeadroom = computed(() =>
    Math.max(
      28,
      ...this.periods().flatMap((period) =>
        this.labelsFor(period).map((label) => 28 - (label.top * 2 * this.size('height')) / 100),
      ),
    ),
  );
  protected areaPoints(points: string): string {
    const ends = points.split(' ');
    return `${ends[0]!.split(',')[0]},60 ${points} ${ends.at(-1)!.split(',')[0]},60`;
  }
  protected readonly pie = computed(() => {
    const period = this.selected();
    if (!period) return null;
    const readings = this.displayedMeasures().map((measure) => ({
      measure,
      ...this.readingFor(period, measure),
    }));
    const total = readings.some((reading) => reading.amount === null)
      ? null
      : readings.reduce((sum, reading) => sum + Math.abs(reading.amount!), 0);
    let cursor = 0;
    const shares = readings.map((reading) => {
      const share = total ? Math.abs(reading.amount!) / total : 0;
      const start = cursor;
      cursor += share;
      return { ...reading, share, path: share ? historySlicePath(start, cursor) : '' };
    });
    return { total, readings: shares, slices: shares.filter((reading) => reading.share > 0) };
  });
  protected percent(value: number): string {
    return new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 }).format(
      value,
    );
  }
  protected pieDescription(): string {
    const chart = this.pie();
    return [
      this.partitionLabel(),
      this.selected()?.label,
      ...(chart?.readings ?? []).map(
        (reading) =>
          this.t('measure-' + reading.measure) +
          ' · ' +
          (reading.amount === null
            ? this.t('curveUnavailable')
            : this.curveMoney(reading.amount, reading.measure) +
              ' · ' +
              this.percent(reading.share)),
      ),
    ].join(' ; ');
  }
  private drawCurve(measure: HistoryMeasure) {
    const maximum = this.maximum();
    const points: { x: number; y: number; estimated: boolean; index: number }[] = [];
    const segments: { points: string; estimated: boolean }[] = [];
    let previous: { x: number; y: number; estimated: boolean; index: number } | null = null;
    for (const [index, period] of this.periods().entries()) {
      const reading = this.readingFor(period, measure);
      if (reading.amount === null) {
        previous = null;
        continue;
      }
      const point = {
        x: (index + 0.5) * (600 / this.periodCount()),
        y: 60 - (maximum ? (reading.amount / maximum) * 60 : 0),
        estimated: reading.estimated,
        index,
      };
      points.push(point);
      if (previous && previous.index === index - 1) {
        segments.push({
          points: previous.x + ',' + previous.y + ' ' + point.x + ',' + point.y,
          estimated: previous.estimated || point.estimated,
        });
      }
      previous = point;
    }
    return { points, segments };
  }
  protected readonly hasEstimates = computed(() =>
    this.periods().some((period) =>
      this.displayedMeasures().some((measure) => {
        const reading = this.readingFor(period, measure);
        return reading.amount !== null && reading.estimated;
      }),
    ),
  );
  private ticket = 0;

  constructor() {
    effect((onCleanup) => {
      const source = this.statement(),
        projectId = this.projectId(),
        windows = this.windows();
      this.retry();
      const ticket = ++this.ticket;
      const reusable = (window: HistoryWindow) =>
        source.projectId === projectId &&
        window.start === source.start &&
        window.end === source.end;
      this.readings.set(
        windows.map((window) => ({
          ...window,
          statement: reusable(window) ? source : null,
          unavailable: false,
        })),
      );
      const selected = untracked(() => this.selectedStart());
      this.selectedStart.set(
        windows.some((window) => window.start === selected) ? selected : windows.at(-1)!.start,
      );
      this.loading.set(true);
      this.error.set(false);
      const requests = windows.map((window) =>
        reusable(window)
          ? of(source)
          : this.http
              .get<BpmStatement>(
                '/api/bpm/projects/' + encodeURIComponent(projectId) + '/statement',
                { params: { start: window.start, end: window.end } },
              )
              .pipe(catchError(() => of(null))),
      );
      const subscription = forkJoin(requests).subscribe((statements) => {
        if (ticket !== this.ticket) return;
        this.readings.set(
          windows.map((window, index) => ({
            ...window,
            statement: statements[index] ?? null,
            unavailable: !statements[index],
          })),
        );
        this.error.set(statements.some((statement) => !statement));
        this.loading.set(false);
      });
      onCleanup(() => subscription.unsubscribe());
    });
  }

  protected t(key: string): string {
    return pageText(P + key);
  }
  protected signed(value: number): string {
    return (value > 0 ? '+' : '') + formatMoney(value);
  }
  protected curveMoney(value: number, measure: HistoryMeasure): string {
    return ['income', 'wealth'].includes(measure) ? formatMoney(value) : this.signed(value);
  }
  private curveReading(
    reading: HistoryReading,
    income: number,
    expense: number,
    net: number,
    closed: boolean,
    measure: HistoryMeasure,
  ): CurveReading {
    const source = reading.statement;
    const past = reading.end <= this.statement().today;
    const actualDate = past ? lastDayOf(reading.end) : this.statement().today;
    const flow =
      source?.flowPilot?.start === reading.start && source.flowPilot.end === reading.end
        ? source.flowPilot
        : null;
    const realized = (amount: number): CurveReading => ({
      amount: source ? amount : null,
      date: actualDate,
      source: flow ? 'sourceConsolidated' : 'sourceStandard',
      estimated: false,
    });
    const expected = (
      amount: number | null,
      pending: boolean,
      reason = 'sourceExpected',
    ): CurveReading => ({
      amount: source ? amount : null,
      date: reading.end,
      source: reason,
      estimated: pending,
    });
    if (
      [
        'lifeIncome',
        'lifeExpense',
        'lifeNet',
        'projectIncome',
        'projectExpense',
        'projectNet',
      ].includes(measure)
    ) {
      const standard = measure.startsWith('life');
      const projects = flow?.projects.filter((project) => project.standard === standard);
      const income = projects?.reduce((sum, project) => sum + project.incomeCents, 0) ?? null;
      const expense = projects?.reduce((sum, project) => sum + project.expenseCents, 0) ?? null;
      const amount =
        income === null || expense === null
          ? null
          : measure.endsWith('Income')
            ? income
            : measure.endsWith('Expense')
              ? -expense
              : income - expense;
      return {
        amount,
        date: actualDate,
        source: flow ? (standard ? 'sourceLife' : 'sourceProjects') : 'sourceUnavailable',
        estimated: false,
      };
    }
    const pendingIncome = Math.max(
      0,
      (flow?.expectedIncomeCents ??
        (source ? source.incomeCents + source.remainingIncomeCents : 0)) - income,
    );
    const pendingExpense = Math.max(
      0,
      (flow?.expectedExpenseCents ??
        (source ? source.expenseCents + source.remainingExpenseCents : 0)) - expense,
    );
    switch (measure) {
      case 'expectedIncome':
        return expected(income + pendingIncome, pendingIncome > 0);
      case 'expectedExpense':
        return expected(-expense - pendingExpense, pendingExpense > 0);
      case 'expectedNet':
        return expected(
          net + pendingIncome - pendingExpense,
          pendingIncome > 0 || pendingExpense > 0,
        );
      case 'pendingIncome':
        return expected(pendingIncome, pendingIncome > 0, 'sourcePending');
      case 'pendingExpense':
        return expected(-pendingExpense, pendingExpense > 0, 'sourcePending');
      case 'income':
        return realized(income);
      case 'expense':
        return realized(-expense);
      case 'net':
        return realized(net);
      case 'wealth': {
        const historical = past ? source?.wealthAtEnd : null;
        return past
          ? {
              amount: historical?.totalCents ?? null,
              date: historical?.date ?? reading.end,
              source:
                historical?.totalCents != null ? 'sourceWealthHistory' : 'sourceWealthUnknown',
              estimated: false,
            }
          : {
              amount: flow?.periodWealth?.totalCents ?? null,
              date: reading.end,
              source:
                flow?.periodWealth?.totalCents != null
                  ? 'sourceWealthForecast'
                  : 'sourceWealthUnknown',
              estimated: true,
            };
      }
      case 'contribution':
        return {
          amount: flow?.periodWealth?.currentClosureCents ?? null,
          date: reading.end,
          source: flow?.periodWealth ? 'sourceContribution' : 'sourceUnavailable',
          estimated: !closed,
        };
      case 'cumulative': {
        const historical = past ? source?.wealthAtEnd : null;
        return past
          ? {
              amount: historical?.budgetFlowCents ?? null,
              date: historical?.date ?? reading.end,
              source: 'sourceCumulativeHistory',
              estimated: false,
            }
          : {
              amount: flow?.periodWealth?.cumulativeFlowCents ?? null,
              date: reading.end,
              source: flow?.periodWealth ? 'sourceCumulativeForecast' : 'sourceUnavailable',
              estimated: !closed,
            };
      }
    }
    return { amount: null, date: actualDate, source: 'sourceUnavailable', estimated: false };
  }
  protected height(value: number): number {
    return this.maximum() ? (Math.abs(value) / this.maximum()) * 50 : 0;
  }
  protected date(value: string): string {
    return new Date(value + 'T12:00:00Z').toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
  protected periodDescription(period: HistoryPeriod): string {
    return [
      this.t('selection'),
      period.label,
      this.t(period.unavailable ? 'unavailable' : period.state),
      ...(period.statement
        ? [
            this.t('income') + ' ' + this.money(period.income),
            this.t('expense') + ' ' + this.money(period.expense),
            this.t('net') + ' ' + this.signed(period.net),
            ...this.displayedMeasures().map((measure) => {
              const reading = this.readingFor(period, measure);
              return (
                this.t('measure-' + measure) +
                ' ' +
                (reading.amount !== null
                  ? this.curveMoney(reading.amount, measure)
                  : this.t('curveUnavailable')) +
                (reading.estimated ? ' · ' + this.t('estimated') : '')
              );
            }),
          ]
        : []),
    ].join(' · ');
  }
}
