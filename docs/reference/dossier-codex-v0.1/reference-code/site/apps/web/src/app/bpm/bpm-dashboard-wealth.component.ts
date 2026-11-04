import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatMoney } from '../shared/amount';
import { pageText, registerPageTexts } from '../shared/page-text';
import type { FlowPilot } from './bpm-flow-pilot.model';
import type { BpmProject } from './bpm.model';

const P = 'content.pages.bpm.bpm-dashboard-wealth.component.';
export const BPM_DASHBOARD_WEALTH_TEXTS: Record<string, string> = {
  title: 'Patrimoine estimé en fin de période',
  estimate: 'Estimation au {date}',
  help: 'Actifs connus + soldes des budgets clôturés + résultat prévu de cette période.',
  unknown: 'À valoriser',
  unavailable: 'La synthèse patrimoniale de cette période est indisponible.',
  contribution: 'Effet de la période',
  contributionHelp: 'Solde prévu, ajouté ou retiré à la clôture.',
  contributionLink: 'Ajuster les entrées et charges',
  target: 'Objectif de patrimoine',
  targetMissing: 'Objectif à renseigner',
  progress: '{pct} % de l’objectif',
  remaining: 'À constituer',
  exceeded: 'Au-delà de l’objectif',
  reached: 'Objectif atteint',
  estimateLabel: 'Après cette période',
  baseLabel: 'Notre point de départ',
  baseHelp: 'Actifs connus et apports des budgets antérieurs.',
  expectedEffect: 'Effet prévu de cette période',
  currentState: 'Réalisé à ce jour',
  accumulation: 'Accumulation',
  allocation: 'Allocation',
  phase: 'Phase {phase}',
  editTarget: 'Modifier l’objectif',
  composition: 'Comprendre ce montant',
  stock: 'Patrimoine enregistré aujourd’hui',
  historical: 'Clôtures avant la période',
  previous: 'Dont la clôture précédente',
  current: 'Contribution de la période affichée',
  cumulative: 'Cumul des contributions avec cette période',
  compositionHelp:
    'Stock enregistré aujourd’hui, puis estimation avec le résultat complet de la période affichée, sans double compte.',
  global: 'Voir le patrimoine global',
};
registerPageTexts(
  Object.fromEntries(
    Object.entries(BPM_DASHBOARD_WEALTH_TEXTS).map(([key, value]) => [P + key, value]),
  ),
);

/** Synthèse en lecture seule issue du même périmètre consolidé que le pilotage. */
@Component({
  selector: 'rjs-bpm-dashboard-wealth',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './bpm-dashboard-wealth.component.scss',
  template: `
    <section
      class="dashboard-wealth"
      aria-labelledby="dashboard-wealth-title"
      data-ui-pattern="panel"
    >
      <header class="wealth-heading">
        <h2 id="dashboard-wealth-title">{{ t('title') }}</h2>
        <span>{{ t('estimate').replace('{date}', date(data().end)) }}</span>
      </header>
      @if (data().periodWealth; as wealth) {
        <div class="wealth-overview">
          <div class="wealth-base">
            <span class="wealth-label"
              ><b class="wealth-step" aria-hidden="true">1</b>{{ t('baseLabel') }}</span
            >
            <strong>{{
              money(
                wealth.totalCents === null ? null : wealth.totalCents - wealth.currentClosureCents
              )
            }}</strong>
            <p>{{ t('baseHelp') }}</p>
          </div>
          <div class="wealth-contribution">
            <span class="wealth-label"
              ><b class="wealth-step" aria-hidden="true">2</b>{{ t('expectedEffect') }}</span
            >
            <strong
              class="wealth-contribution-value"
              [class.is-negative]="wealth.currentClosureCents < 0"
            >
              <span
                class="flow-direction is-compact"
                [attr.data-flow]="wealth.currentClosureCents < 0 ? 'expense' : 'income'"
                aria-hidden="true"
                >{{ wealth.currentClosureCents < 0 ? '↓' : '↑' }}</span
              >
              {{ signedMoney(wealth.currentClosureCents) }}
            </strong>
            <p>{{ t('contributionHelp') }}</p>
          </div>
          <div class="wealth-total">
            <span class="wealth-label wealth-estimate-label">
              <b class="wealth-step" aria-hidden="true">3</b>{{ t('estimateLabel') }}
            </span>
            <strong [class.is-unknown]="wealth.totalCents === null">{{
              money(wealth.totalCents)
            }}</strong>
            <p>{{ t('help') }}</p>
          </div>
          <div class="wealth-target">
            <div class="wealth-target-heading">
              <span class="wealth-label">{{ t('target') }}</span>
              <span class="wealth-phase">{{
                t('phase').replace(
                  '{phase}',
                  t(data().phase === 'allocation' ? 'allocation' : 'accumulation')
                )
              }}</span>
            </div>
            <strong>{{
              data().targetCents === null ? t('targetMissing') : money(data().targetCents)
            }}</strong>
            @if (progress(); as p) {
              <div class="wealth-cap-comparison">
                <div class="wealth-cap-position">
                  <span class="wealth-cap-mark" aria-hidden="true">⚑</span>
                  <span>{{ t('progress').replace('{pct}', p.label) }}</span>
                </div>
                <div class="wealth-cap-gap" [class.is-reached]="p.gap <= 0">
                  <span>{{ t(p.gap > 0 ? 'remaining' : p.gap < 0 ? 'exceeded' : 'reached') }}</span>
                  @if (p.gap !== 0) {
                    <strong>{{ money(p.gap < 0 ? -p.gap : p.gap) }}</strong>
                  }
                </div>
              </div>
            }
            <a
              routerLink="/budget-patrimoine-management/vision"
              [queryParams]="{ projet: project().id }"
              fragment="cap-patrimonial"
              >{{ t('editTarget') }} →</a
            >
          </div>
        </div>
        <details class="wealth-composition">
          <summary>
            <span>{{ t('composition') }}</span
            ><span class="wealth-chevron" aria-hidden="true">›</span>
          </summary>
          <div class="wealth-composition-body">
            <dl class="wealth-facts">
              <div>
                <dt>{{ t('stock') }}</dt>
                <dd>{{ money(data().stockCents) }}</dd>
              </div>
              <div>
                <dt>{{ t('historical') }}</dt>
                <dd [class.is-negative]="wealth.historicalFlowCents < 0">
                  {{ signedMoney(wealth.historicalFlowCents) }}
                </dd>
              </div>
              <div>
                <dt>{{ t('previous') }}</dt>
                <dd [class.is-negative]="wealth.previousClosureCents < 0">
                  {{ signedMoney(wealth.previousClosureCents) }}
                </dd>
              </div>
              <div>
                <dt>{{ t('current') }}</dt>
                <dd [class.is-negative]="wealth.currentClosureCents < 0">
                  {{ signedMoney(wealth.currentClosureCents) }}
                </dd>
              </div>
              <div>
                <dt>{{ t('cumulative') }}</dt>
                <dd [class.is-negative]="wealth.cumulativeFlowCents < 0">
                  {{ signedMoney(wealth.cumulativeFlowCents) }}
                </dd>
              </div>
            </dl>
            <p>{{ t('compositionHelp') }}</p>
            <a
              routerLink="/budget-patrimoine-management/patrimoine-global"
              [queryParams]="{ projet: project().id }"
              >{{ t('global') }} →</a
            >
          </div>
        </details>
      } @else {
        <p class="wealth-unavailable">{{ t('unavailable') }}</p>
      }
    </section>
  `,
})
export class BpmDashboardWealthComponent {
  readonly data = input.required<FlowPilot>();
  readonly project = input.required<BpmProject>();
  protected readonly progress = computed(() => {
    const value = this.data().periodWealth?.totalCents;
    const target = this.data().targetCents;
    if (value == null || target === null) return null;
    const percent = target > 0 ? (value / target) * 100 : value >= 0 ? 100 : 0;
    return {
      gap: target - value,
      label: new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(percent),
    };
  });
  protected readonly money = (value: number | null) =>
    value === null ? this.t('unknown') : formatMoney(value);
  protected readonly signedMoney = (value: number) => (value > 0 ? '+' : '') + formatMoney(value);
  protected date(value: string): string {
    return new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(value + 'T12:00:00Z'));
  }
  protected t(key: string): string {
    return pageText(P + key);
  }
}
