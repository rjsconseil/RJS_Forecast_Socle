import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatMoney } from '../shared/amount';
import { pageText, registerPageTexts } from '../shared/page-text';
import { FlowPilot } from './bpm-flow-pilot.model';
const P = 'content.pages.bpm.bpm-flow-pilot.component.';
export const BPM_FLOW_PILOT_TEXTS = {
  title: 'Votre résultat, tous projets réunis',
  compactTitle: 'Votre période',
  compactImpact: 'Patrimoine après clôtures',
  inspect: 'Voir l’analyse',
  received: 'Reçu',
  spent: 'Payé',
  incomeRemaining: 'À recevoir',
  expenseRemaining: 'À payer',
  actualBadge: 'Aujourd’hui',
  forecastBadge: 'Fin de période',
  intro: 'Le quotidien, vos projets et leur effet sur le patrimoine.',
  real: 'Solde à ce jour',
  realHelp: 'Entrées reçues − charges payées sur la période.',
  expected: 'Solde prévu en fin de période',
  expectedHelp: 'Solde réalisé + entrées attendues − charges à venir.',
  stock: 'Patrimoine actuel',
  stockHelp: 'Actifs connus et soldes des périodes déjà clôturées.',
  gap: 'Reste à constituer',
  gapHelp: 'Montant manquant pour atteindre votre objectif de patrimoine.',
  unknown: 'À renseigner',
  bridge: 'Entrées − charges = solde',
  bridgeHelp:
    'Deux colonnes par ligne : le réalisé et le total prévu. Vert pour les entrées, rouge pour les charges, violet pour le solde.',
  income: 'Entrées de la période',
  life: 'Charges du projet de vie',
  projects: 'Charges des autres projets',
  net: 'Solde de la période',
  actual: 'Réalisé',
  forecast: 'Total prévu',
  costs: 'Charges par projet',
  costsHelp:
    'Du plus chargé au plus léger. Comparez les entrées et les charges de chaque projet sur la même échelle.',
  ownIncome: 'Entrées prévues',
  linked: 'Solde lié au patrimoine',
  unlinked: 'Liaison suspendue ou absente',
  goal: 'Du budget au patrimoine',
  goalHelp:
    'Patrimoine estimé = patrimoine actuel + soldes à venir. Les actifs gardent leur valeur connue ; chaque clôture est comptée une seule fois.',
  contribution: 'Effet des clôtures prévues',
  after: 'Patrimoine après clôtures',
  target: 'Objectif de patrimoine',
  past: 'Période passée : le patrimoine affiché est celui d’aujourd’hui, avec les clôtures déjà enregistrées.',
  excluded:
    'Sans liaison active, le solde du projet compte dans le budget mais pas dans le patrimoine estimé.',
  axisOut: 'Sorties et déficit',
  axisIn: 'Entrées et excédent',
  progressNow: 'Progression actuelle',
  progressAfter: 'Progression estimée',
  incomeKey: 'Entrées',
  expenseKey: 'Charges',
  pointKey: 'Couleur pleine : réalisé',
  outlineKey: 'Couleur claire : total prévu',
  stockNowShort: 'Aujourd’hui',
  stockAfterShort: 'Après clôtures',
  stockTargetShort: 'Objectif',
  expectedCharges: 'Charges prévues',
  expectedIncomes: 'Entrées prévues',
  curveComparison: 'Évolution du réalisé vers le prévu',
  curveDifference: 'Écart prévu',
  curveExplanation:
    'La courbe compare le réalisé au total prévu ; elle ne représente pas un historique.',
  balanceCurve: 'Solde = entrées − charges',
  projected: 'Prévu',
  knownLabel: 'Point de départ · enregistré',
  estimatedLabel: 'Prochaine étape · estimation',
  closing: 'Prochaine clôture',
  horizon: 'Estimation au',
  cycle: 'Vérifier les liaisons',
  entry: 'Ajouter entrée / charge',
  detail: 'Voir les charges',
  allocation: 'Phase Allocation',
};
registerPageTexts(
  Object.fromEntries(Object.entries(BPM_FLOW_PILOT_TEXTS).map(([k, v]) => [P + k, v])),
);
@Component({
  selector: 'rjs-bpm-flow-pilot',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./bpm-flow-pilot.component.scss'],
  template: ` @if (data(); as d) {
    <section class="fp-overview" [class.is-compact]="compact()" aria-labelledby="fp-title">
      @if (compact()) {
        <div class="fp-summary" data-bpm-frame="metrics">
          <div class="fp-compact-heading">
            <h2 id="fp-title">{{ t('compactTitle') }}</h2>
            <a
              routerLink="/budget-patrimoine-management/piloter"
              [queryParams]="{ projet: projectId() }"
              >{{ t('inspect') }} →</a
            >
          </div>
          <dl class="fp-compact-facts">
            <div>
              <dt>{{ t('real') }}</dt>
              <dd [attr.data-sign]="d.netCents < 0 ? 'negative' : 'positive'">
                {{ money(d.netCents) }}
              </dd>
            </div>
            <div>
              <dt>{{ t('expected') }}</dt>
              <dd [attr.data-sign]="d.expectedNetCents < 0 ? 'negative' : 'positive'">
                {{ money(d.expectedNetCents) }}
              </dd>
            </div>
            <div>
              <dt>{{ t(d.nextContributionCents === null ? 'stock' : 'compactImpact') }}</dt>
              <dd>
                {{ money(d.nextContributionCents === null ? d.stockCents : d.projectedStockCents) }}
              </dd>
            </div>
          </dl>
        </div>
      } @else {
        <div class="fp-summary" data-bpm-frame="metrics">
          <div class="fp-heading">
            <div>
              <h2 id="fp-title">{{ t('title') }}</h2>
              <p>{{ t('intro') }}</p>
            </div>
          </div>
          <div class="fp-results">
            <article class="fp-result-card">
              <span class="fp-result-badge">{{ t('actualBadge') }}</span>
              <h3>{{ t('real') }}</h3>
              <strong
                class="fp-result-amount"
                [attr.data-sign]="d.netCents < 0 ? 'negative' : 'positive'"
                >{{ money(d.netCents) }}</strong
              >
              <dl class="fp-result-detail">
                <div>
                  <dt>
                    <span class="flow-direction is-compact" data-flow="income" aria-hidden="true"
                      >↑</span
                    ><span>{{ t('received') }}</span>
                  </dt>
                  <dd>{{ money(d.incomeCents) }}</dd>
                </div>
                <div>
                  <dt>
                    <span class="flow-direction is-compact" data-flow="expense" aria-hidden="true"
                      >↓</span
                    ><span>{{ t('spent') }}</span>
                  </dt>
                  <dd>{{ money(d.expenseCents) }}</dd>
                </div>
              </dl>
            </article>
            <article class="fp-result-card is-forecast">
              <span class="fp-result-badge">{{ t('forecastBadge') }}</span>
              <h3>{{ t('expected') }}</h3>
              <strong
                class="fp-result-amount"
                [attr.data-sign]="d.expectedNetCents < 0 ? 'negative' : 'positive'"
                >{{ money(d.expectedNetCents) }}</strong
              >
              <dl class="fp-result-detail">
                <div>
                  <dt>
                    <span class="flow-direction is-compact" data-flow="income" aria-hidden="true"
                      >↑</span
                    ><span>{{ t('incomeRemaining') }}</span>
                  </dt>
                  <dd>{{ money(d.expectedIncomeCents - d.incomeCents) }}</dd>
                </div>
                <div>
                  <dt>
                    <span class="flow-direction is-compact" data-flow="expense" aria-hidden="true"
                      >↓</span
                    ><span>{{ t('expenseRemaining') }}</span>
                  </dt>
                  <dd>{{ money(d.expectedExpenseCents - d.expenseCents) }}</dd>
                </div>
              </dl>
            </article>
          </div>
          <section class="fp-card fp-goal" aria-labelledby="fp-goal">
            <div class="fp-heading">
              <h3 id="fp-goal">{{ t('goal') }}</h3>
              <span>{{ t('horizon') }} {{ date(d.end) }}</span>
              @if (d.phase === 'allocation') {
                <strong>{{ t('allocation') }}</strong>
              }
            </div>
            @if (d.nextContributionCents !== null) {
              <div class="fp-stock-equation">
                <dl class="fp-stock-step is-current">
                  <dt>{{ t('stock') }}</dt>
                  <dd>{{ money(d.stockCents) }}</dd>
                  <small>{{ t('knownLabel') }}</small>
                </dl>
                <span
                  class="fp-equation-sign"
                  [attr.data-sign]="d.nextContributionCents < 0 ? 'negative' : 'positive'"
                  aria-hidden="true"
                  >{{ d.nextContributionCents < 0 ? '−' : '+' }}</span
                >
                <dl
                  class="fp-stock-step is-contribution"
                  [attr.data-sign]="d.nextContributionCents < 0 ? 'negative' : 'positive'"
                >
                  <dt>{{ t('contribution') }}</dt>
                  <dd>{{ money(Math.abs(d.nextContributionCents)) }}</dd>
                </dl>
                <span class="fp-equation-sign" aria-hidden="true">=</span>
                <dl class="fp-stock-step is-after">
                  <dt>{{ t('after') }}</dt>
                  <dd>{{ money(d.projectedStockCents) }}</dd>
                  <small>{{ t('estimatedLabel') }} · {{ date(d.end) }}</small>
                </dl>
              </div>
              <dl class="fp-stock-objective">
                <div>
                  <dt>{{ t('target') }}</dt>
                  <dd>{{ d.targetCents === null ? t('unknown') : money(d.targetCents) }}</dd>
                </div>
                @if (d.targetCents !== null && d.stockCents !== null) {
                  <div>
                    <dt>{{ t('gap') }}</dt>
                    <dd>{{ money(Math.max(0, d.targetCents - d.stockCents)) }}</dd>
                  </div>
                }
              </dl>
              @if (d.targetCents !== null && d.targetCents > 0 && d.stockCents !== null) {
                <div class="fp-row fp-progress-labels">
                  <span
                    >{{ t('progressNow') }}
                    <strong
                      >{{
                        goalWidth(d.stockCents).toLocaleString('fr-FR', {
                          maximumFractionDigits: 1,
                        })
                      }}
                      %</strong
                    ></span
                  ><span
                    >{{ t('progressAfter') }}
                    <strong
                      >{{
                        goalWidth(d.projectedStockCents).toLocaleString('fr-FR', {
                          maximumFractionDigits: 1,
                        })
                      }}
                      %</strong
                    ></span
                  >
                </div>
              }
              <p>{{ t('goalHelp') }}</p>
            } @else {
              <dl class="fp-facts fp-past-facts">
                <div class="fp-fact-result">
                  <dt>{{ t('stock') }}</dt>
                  <dd>{{ money(d.stockCents) }}</dd>
                </div>
                <div>
                  <dt>{{ t('target') }}</dt>
                  <dd>{{ money(d.targetCents) }}</dd>
                </div>
                <div>
                  <dt>{{ t('gap') }}</dt>
                  <dd>
                    {{
                      d.targetCents === null || d.stockCents === null
                        ? t('unknown')
                        : money(Math.max(0, d.targetCents - d.stockCents))
                    }}
                  </dd>
                </div>
              </dl>
              <p>{{ t('past') }}</p>
            }
            @if (unlinked()) {
              <p class="fp-warning">
                {{ t('excluded') }}
                <a
                  routerLink="/budget-patrimoine-management/cycle"
                  [queryParams]="{ projet: projectId() }"
                  >{{ t('cycle') }} →</a
                >
              </p>
            }
          </section>
        </div>
        <div class="fp-charts">
          <section class="fp-card" data-bpm-frame="chart" aria-labelledby="fp-bridge">
            <h3 id="fp-bridge">{{ t('bridge') }}</h3>
            <p>{{ t('bridgeHelp') }}</p>
            <ol class="fp-bars">
              @for (row of bars(); track row.label) {
                <li
                  [class.fp-negative]="row.kind === 'expense'"
                  [class.fp-result]="row.kind === 'net'"
                  [class.fp-deficit]="row.kind === 'net' && row.actual < 0"
                >
                  <div class="fp-row">
                    <strong>{{ row.label }}</strong
                    ><span class="fp-values"
                      ><span class="fp-value"
                        ><small>{{ t('actual') }}</small
                        ><b>{{ money(row.actual) }}</b></span
                      ><span class="fp-value is-forecast"
                        ><small>{{ t('forecast') }}</small
                        ><b>{{ money(row.expected) }}</b></span
                      ></span
                    >
                  </div>
                  <div class="fp-curve-caption">
                    <span>{{ t('curveComparison') }}</span
                    ><strong
                      >{{ t('curveDifference') }}
                      {{ signedMoney(row.expected - row.actual) }}</strong
                    >
                  </div>
                  <svg class="fp-comparison-plot" viewBox="0 0 640 212" aria-hidden="true">
                    <line class="fp-grid-line" x1="70" x2="590" y1="18" y2="18" />
                    <line class="fp-comparison-axis" x1="70" x2="590" y1="90" y2="90" />
                    <line class="fp-grid-line" x1="70" x2="590" y1="162" y2="162" />
                    <text class="fp-tick-label" x="58" y="23" text-anchor="end">
                      {{ axisMoney(flowMax()) }}
                    </text>
                    <text class="fp-tick-label" x="58" y="95" text-anchor="end">0 €</text>
                    <text class="fp-tick-label" x="58" y="167" text-anchor="end">
                      {{ axisMoney(-flowMax()) }}
                    </text>
                    <rect
                      class="fp-column is-real"
                      x="190"
                      width="88"
                      rx="5"
                      [attr.y]="Math.min(90, flowBarY(row.actual, row.kind))"
                      [attr.height]="Math.abs(90 - flowBarY(row.actual, row.kind))"
                    />
                    <rect
                      class="fp-column is-forecast"
                      x="410"
                      width="88"
                      rx="5"
                      [attr.y]="Math.min(90, flowBarY(row.expected, row.kind))"
                      [attr.height]="Math.abs(90 - flowBarY(row.expected, row.kind))"
                    />
                    <path
                      class="fp-curve-halo"
                      [attr.d]="
                        curvePath(
                          234,
                          flowBarY(row.actual, row.kind),
                          454,
                          flowBarY(row.expected, row.kind)
                        )
                      "
                    />
                    <path
                      class="fp-overlay-curve"
                      [attr.d]="
                        curvePath(
                          234,
                          flowBarY(row.actual, row.kind),
                          454,
                          flowBarY(row.expected, row.kind),
                          'actual'
                        )
                      "
                    />
                    <path
                      class="fp-overlay-curve is-forecast"
                      [attr.d]="
                        curvePath(
                          234,
                          flowBarY(row.actual, row.kind),
                          454,
                          flowBarY(row.expected, row.kind),
                          'forecast'
                        )
                      "
                    />
                    <text class="fp-category-label" x="234" y="202" text-anchor="middle">
                      {{ t('actual') }}
                    </text>
                    <text class="fp-category-label" x="454" y="202" text-anchor="middle">
                      {{ t('forecast') }}
                    </text>
                  </svg>
                </li>
              }
            </ol>
            <div class="fp-chart-legend">
              <span class="is-real">{{ t('pointKey') }}</span
              ><span class="is-forecast">{{ t('outlineKey') }}</span>
            </div>
            <p class="fp-curve-explanation">{{ t('curveExplanation') }}</p>
          </section>
          <section class="fp-card" data-bpm-frame="chart" aria-labelledby="fp-projects">
            <h3 id="fp-projects">{{ t('costs') }}</h3>
            <p>{{ t('costsHelp') }}</p>
            <div class="fp-project-legend">
              <span class="is-income">{{ t('incomeKey') }}</span
              ><span class="is-expense">{{ t('expenseKey') }}</span>
            </div>
            <ol class="fp-projects">
              @for (p of ranked(); track p.id; let rank = $index) {
                <li>
                  <div class="fp-row">
                    <span class="fp-rank">{{ rank + 1 }}</span
                    ><a
                      routerLink="/budget-patrimoine-management/depenses"
                      [queryParams]="{ projet: projectId(), du: d.start, au: d.end, budget: p.id }"
                      >{{ p.standard ? t('life') : p.title }}</a
                    ><strong>{{ money(p.expectedExpenseCents) }}</strong>
                  </div>
                  <div class="fp-curve-caption is-balance">
                    <span>{{ t('balanceCurve') }}</span>
                  </div>
                  <svg class="fp-project-plot" viewBox="0 0 640 252" aria-hidden="true">
                    <line class="fp-grid-line" x1="70" x2="608" y1="30" y2="30" />
                    <line
                      class="fp-comparison-axis"
                      x1="70"
                      x2="608"
                      [attr.y1]="projectBarY(0)"
                      [attr.y2]="projectBarY(0)"
                    />
                    <text class="fp-tick-label" x="58" y="35" text-anchor="end">
                      {{ axisMoney(projectDomain().max) }}
                    </text>
                    <text
                      class="fp-tick-label"
                      x="58"
                      [attr.y]="projectBarY(0) + 4"
                      text-anchor="end"
                    >
                      0 €
                    </text>
                    @if (projectDomain().min < 0) {
                      <line class="fp-grid-line" x1="70" x2="608" y1="184" y2="184" />
                      <text class="fp-tick-label" x="58" y="188" text-anchor="end">
                        {{ axisMoney(projectDomain().min) }}
                      </text>
                    }
                    <rect
                      class="fp-project-column is-income is-real"
                      x="108"
                      width="62"
                      rx="4"
                      [attr.y]="Math.min(projectBarY(0), projectBarY(p.incomeCents))"
                      [attr.height]="Math.abs(projectBarY(p.incomeCents) - projectBarY(0))"
                    />
                    <rect
                      class="fp-project-column is-expense is-real"
                      x="216"
                      width="62"
                      rx="4"
                      [attr.y]="Math.min(projectBarY(0), projectBarY(p.expenseCents))"
                      [attr.height]="Math.abs(projectBarY(p.expenseCents) - projectBarY(0))"
                    />
                    <rect
                      class="fp-project-column is-income is-forecast"
                      x="378"
                      width="62"
                      rx="4"
                      [attr.y]="Math.min(projectBarY(0), projectBarY(p.expectedIncomeCents))"
                      [attr.height]="Math.abs(projectBarY(p.expectedIncomeCents) - projectBarY(0))"
                    />
                    <rect
                      class="fp-project-column is-expense is-forecast"
                      x="486"
                      width="62"
                      rx="4"
                      [attr.y]="Math.min(projectBarY(0), projectBarY(p.expectedExpenseCents))"
                      [attr.height]="Math.abs(projectBarY(p.expectedExpenseCents) - projectBarY(0))"
                    />
                    <path
                      class="fp-curve-halo"
                      [attr.d]="
                        curvePath(
                          193,
                          projectBarY(p.incomeCents - p.expenseCents),
                          463,
                          projectBarY(p.expectedIncomeCents - p.expectedExpenseCents)
                        )
                      "
                    />
                    <path
                      class="fp-overlay-curve is-balance"
                      [attr.d]="
                        curvePath(
                          193,
                          projectBarY(p.incomeCents - p.expenseCents),
                          463,
                          projectBarY(p.expectedIncomeCents - p.expectedExpenseCents),
                          'actual'
                        )
                      "
                    />
                    <path
                      class="fp-overlay-curve is-balance is-forecast"
                      [attr.d]="
                        curvePath(
                          193,
                          projectBarY(p.incomeCents - p.expenseCents),
                          463,
                          projectBarY(p.expectedIncomeCents - p.expectedExpenseCents),
                          'forecast'
                        )
                      "
                    />
                    <text
                      class="fp-curve-value"
                      x="193"
                      [attr.y]="projectBarY(p.incomeCents - p.expenseCents) - 12"
                      text-anchor="middle"
                    >
                      {{ signedAxisMoney(p.incomeCents - p.expenseCents) }}
                    </text>
                    <text
                      class="fp-curve-value"
                      x="463"
                      [attr.y]="projectBarY(p.expectedIncomeCents - p.expectedExpenseCents) - 12"
                      text-anchor="middle"
                    >
                      {{ signedAxisMoney(p.expectedIncomeCents - p.expectedExpenseCents) }}
                    </text>
                    <text class="fp-category-label is-income" x="139" y="213" text-anchor="middle">
                      {{ t('received') }}
                    </text>
                    <text class="fp-category-label is-expense" x="247" y="213" text-anchor="middle">
                      {{ t('spent') }}
                    </text>
                    <text class="fp-category-label is-income" x="409" y="213" text-anchor="middle">
                      {{ t('incomeKey') }}
                    </text>
                    <text class="fp-category-label is-expense" x="517" y="213" text-anchor="middle">
                      {{ t('expenseKey') }}
                    </text>
                    <text class="fp-category-label" x="193" y="245" text-anchor="middle">
                      {{ t('actual') }}
                    </text>
                    <text class="fp-category-label" x="463" y="245" text-anchor="middle">
                      {{ t('forecast') }}
                    </text>
                  </svg>
                  <div class="fp-project-balance">
                    <span
                      >{{ t('actual') }}
                      <strong>{{ signedMoney(p.incomeCents - p.expenseCents) }}</strong></span
                    ><span
                      >{{ t('projected') }}
                      <strong>{{
                        signedMoney(p.expectedIncomeCents - p.expectedExpenseCents)
                      }}</strong></span
                    >
                  </div>
                  <div class="fp-row fp-caption">
                    <span class="fp-project-numbers"
                      ><span class="is-expense">{{ t('spent') }} {{ money(p.expenseCents) }}</span
                      ><span class="is-income"
                        >{{ t('received') }} {{ money(p.incomeCents) }} · {{ t('ownIncome') }}
                        {{ money(p.expectedIncomeCents) }}</span
                      ></span
                    ><span [class.fp-warning]="!p.linked"
                      >{{ t(p.linked ? 'linked' : 'unlinked') }}
                      @if (p.nextClosing) {
                        · {{ t('closing') }} {{ date(p.nextClosing) }}
                      }
                    </span>
                  </div>
                </li>
              }
            </ol>
            <div class="fp-chart-legend">
              <span class="is-real">{{ t('pointKey') }}</span
              ><span class="is-forecast">{{ t('outlineKey') }}</span>
            </div>
          </section>
        </div>
      }
    </section>
  }`,
})
export class BpmFlowPilotComponent {
  protected readonly Math = Math;
  readonly data = input<FlowPilot | null>(null);
  readonly projectId = input.required<string>();
  readonly compact = input(false);
  protected readonly money = (n: number | null) =>
    n === null ? this.t('unknown') : formatMoney(n);
  protected t(k: string) {
    return pageText(P + k);
  }
  protected readonly ranked = computed(() =>
    [...(this.data()?.projects ?? [])].sort(
      (a, b) => b.expectedExpenseCents - a.expectedExpenseCents,
    ),
  );
  protected readonly unlinked = computed(() => this.data()?.projects.some((p) => !p.linked));
  protected readonly bars = computed(() => {
    const d = this.data();
    if (!d) return [];
    const cost = (standard: boolean, key: 'expenseCents' | 'expectedExpenseCents') =>
      d.projects.filter((p) => p.standard === standard).reduce((s, p) => s + p[key], 0);
    return [
      {
        label: this.t('income'),
        actual: d.incomeCents,
        expected: d.expectedIncomeCents,
        kind: 'income',
      },
      {
        label: this.t('life'),
        actual: cost(true, 'expenseCents'),
        expected: cost(true, 'expectedExpenseCents'),
        kind: 'expense',
      },
      {
        label: this.t('projects'),
        actual: cost(false, 'expenseCents'),
        expected: cost(false, 'expectedExpenseCents'),
        kind: 'expense',
      },
      { label: this.t('net'), actual: d.netCents, expected: d.expectedNetCents, kind: 'net' },
    ];
  });
  protected date(s: string) {
    return new Date(s + 'T12:00:00Z').toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
  protected readonly flowMax = computed(() =>
    Math.max(1, ...this.bars().flatMap((r) => [Math.abs(r.actual), Math.abs(r.expected)])),
  );
  protected flowBarY(n: number, kind: string) {
    return 90 - ((kind === 'expense' ? -Math.abs(n) : n) / this.flowMax()) * 72;
  }
  protected readonly projectDomain = computed(() => {
    const amounts = this.ranked().flatMap((p) => [
      p.incomeCents,
      p.expectedIncomeCents,
      p.expenseCents,
      p.expectedExpenseCents,
      p.incomeCents - p.expenseCents,
      p.expectedIncomeCents - p.expectedExpenseCents,
    ]);
    return { min: Math.min(0, ...amounts), max: Math.max(1, ...amounts) };
  });
  protected projectBarY(n: number) {
    const { min, max } = this.projectDomain();
    return 184 - ((n - min) / (max - min)) * 154;
  }
  protected readonly axisMoney = (n: number) =>
    new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: Math.abs(n) >= 1000000 ? 1 : 0,
      notation: Math.abs(n) >= 1000000 ? 'compact' : 'standard',
    }).format(n / 100);
  protected curvePath(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    part: 'all' | 'actual' | 'forecast' = 'all',
  ) {
    const dx = x2 - x1;
    const midY = (y1 + y2) / 2;
    if (part === 'actual') {
      return `M ${x1} ${y1} C ${x1 + dx * 0.125} ${y1}, ${x1 + dx * 0.3125} ${(3 * y1 + y2) / 4}, ${x1 + dx / 2} ${midY}`;
    }
    if (part === 'forecast') {
      return `M ${x1 + dx / 2} ${midY} C ${x1 + dx * 0.6875} ${(y1 + 3 * y2) / 4}, ${x1 + dx * 0.875} ${y2}, ${x2} ${y2}`;
    }
    return `M ${x1} ${y1} C ${x1 + dx * 0.25} ${y1}, ${x1 + dx * 0.75} ${y2}, ${x2} ${y2}`;
  }
  protected signedMoney(n: number) {
    return `${n > 0 ? '+' : ''}${this.money(n)}`;
  }
  protected signedAxisMoney(n: number) {
    return `${n > 0 ? '+' : ''}${this.axisMoney(n)}`;
  }
  protected goalWidth(n: number | null) {
    return Math.max(
      0,
      Math.min(100, ((n ?? 0) / Math.max(1, this.data()?.targetCents ?? 0)) * 100),
    );
  }
}
