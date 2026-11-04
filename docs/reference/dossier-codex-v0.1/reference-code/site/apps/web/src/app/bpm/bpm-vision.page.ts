import { BpmProjectCostsComponent } from './bpm-project-costs.component';
import { expensePeriodQuery } from './bpm-expense-links';
import { BpmObjectivesComponent } from './bpm-objectives.component';
import { RangeFieldComponent } from '../shared/range-field.component';
import './bpm-goal-labels';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ModalComponent } from '../shared/modal.component';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { formatMoney, parseAmount } from '../shared/amount';
import { AppHeroComponent, HeroChip } from '../shared/app-hero.component';
import { MetricTile, MetricTilesComponent } from '../shared/metric-tiles.component';
import { pageText, registerPageTexts } from '../shared/page-text';
import { siteSetting } from '../shared/site-settings';
import { UserSession } from '../utilisateurs/utilisateurs.contract';
import { BpmProject } from './bpm.model';
import { cycleOf, lensWord, toLens } from './bpm-lens.model';
import { BpmProjectSwitchComponent } from './bpm-project-switch.component';
import { BpmPopoverComponent } from './bpm-popover.component';
import { BpmStore } from './bpm.store';
import { BpmContextComponent } from './bpm-context.component';
import { BpmGateComponent } from './bpm-gate.component';
import { BpmWorkspaceNavComponent } from './bpm-workspace-nav.component';
import { BpmTermComponent } from './bpm-term.component';
import { BpmTourComponent } from './bpm-tour.component';
import {
  BPM_GOAL_KINDS,
  BpmGoal,
  BpmGoalKind,
  contributionPerPeriod,
  contributionOf,
  contributionReality,
  emptyVision,
  GoalReading,
  inflationRate,
  requiredContribution,
  visionChart,
  visionInputOf,
  visionProjection,
} from './bpm-vision.model';
import { visionSettings } from './bpm-settings';

const P = 'content.pages.bpm.bpm-vision.page.';
/** Textes livrés de la vision ; ils se personnalisent dans Configuration → Contenus. */
export const BPM_VISION_TEXTS: Record<string, string> = {
  expensesDetail: 'Dépenses de la période',
  kicker: 'Ma vision budgétaire',
  title: 'Objectifs & avenir',
  chipProject: 'Projet',
  zoneState: 'Comprendre la projection',
  resultsTitle: 'Votre patrimoine demain',
  resultsLabel: 'Estimation',
  goalsOverview: 'Vos deux objectifs',
  goalsOverviewHelp: 'Ce que vous gardez à chaque période construit votre patrimoine.',
  zoneStateLead: 'Estimez votre patrimoine et les objectifs qu’il pourra financer.',
  zoneAct: 'Ajuster vos objectifs',
  zoneActLead: 'Objectifs de vie, versements entre actifs et hypothèses de projection.',
  manageTitle: 'Gérer mes objectifs',
  manageIntro:
    'Définissez un montant et une date pour chaque objectif. La projection s’adapte, sans mouvement d’argent.',
  transferIntro:
    'Un versement déplace de la valeur d’un actif vers un autre : le patrimoine total ne change pas.',
  inflationFormTitle: 'Ajuster l’inflation',
  inflationFormIntro:
    'Saisissez une année et son taux : votre valeur remplace la référence INSEE pour cette année.',
  readOnlyAct: 'Lecture seule : seul l’utilisateur à qui appartient le projet agit sur sa vision.',
  heroTitle: 'En {year}, votre patrimoine pourrait atteindre {amount}',
  heroAllFunded: '{financed}/{due} objectifs finançables.',
  heroSomeFunded: '{financed}/{due} objectifs finançables.',
  heroUnknown: 'Valorisez votre patrimoine.',
  heroFunded: 'Objectifs finançables',
  heroReal: 'En euros d’aujourd’hui',
  lead: 'Votre épargne, votre patrimoine, vos objectifs.',
  loading: 'Lecture de votre vision…',
  empty:
    'Créez d’abord un projet Budget/Patrimoine : la vision s’appuie sur son budget et son patrimoine.',
  emptyAction: 'Créer un projet',
  readOnly: 'Lecture seule : ce projet appartient à un autre utilisateur.',
  chipToday: 'Patrimoine aujourd’hui',
  chipReturn: 'Rendement estimé',
  chipInflation: 'Inflation retenue',
  chipHorizon: 'Horizon',
  years: 'ans',
  perYear: '% par an',
  unknown: 'À valoriser',
  kpis: 'Projection du patrimoine',
  kpiFinal: 'Patrimoine à l’horizon',
  kpiFinalHelp: 'Estimation avec les apports du budget et le rendement retenu.',
  kpiReal: 'En euros d’aujourd’hui',
  kpiRealHelp: 'La même estimation, corrigée de l’inflation.',
  kpiRealReturn: 'Rendement réel',
  kpiRealReturnHelp: 'Rendement annuel corrigé de l’inflation : le pouvoir d’achat diminue.',
  kpiRealReturnGainHelp:
    'Rendement annuel corrigé de l’inflation : le pouvoir d’achat est préservé ou augmente.',
  kpiErosion: 'Perte sans rendement',
  kpiErosionHelp: 'Pouvoir d’achat perdu en un an si le patrimoine ne rapporte rien.',
  contribution: 'Apport du budget dans la projection',
  contributionobjectif: 'selon votre minimum d’épargne',
  contributionrecurrent: 'selon vos flux récurrents actuels',
  contributionhistorique: 'la moyenne des périodes clôturées',
  contributionaucun: 'aucun apport connu pour l’instant',
  realityLine: 'Apport moyen sur {n} clôtures : {avg} {per} · Écart avec la projection : {gap}.',
  realityOpen: 'Comparer les projections',
  realityTitle: 'L’apport retenu face au réel',
  realityKicker: 'Comparaison avec le réel',
  realityRetained: 'Apport retenu',
  realityAverage: 'Moyenne réelle des clôtures',
  realityProjected: 'Patrimoine à l’horizon',
  realityFunded: 'Objectifs finançables',
  realityWith: 'avec l’apport retenu',
  realityWithAverage: 'avec la moyenne réelle',
  realityHelp:
    'Comparez l’apport retenu avec la moyenne réellement versée aux clôtures. Les autres hypothèses restent identiques.',
  realityMoney: 'Voir le tableau de bord',
  directiveNeed: 'Épargne nécessaire pour vos objectifs :',
  directiveSurplus: 'Retrait possible selon la projection :',
  directiveOk: 'L’apport retenu suffit selon ces hypothèses.',
  directiveBehind:
    'L’apport retenu est insuffisant. Ajustez vos entrées, vos charges ou vos objectifs.',
  directiveOpen: 'Piloter la période',
  chartTitle: 'Votre patrimoine au fil des années',
  chartNominal: 'Valeur projetée',
  chartReal: 'En euros d’aujourd’hui',
  budgetShortcut: 'Objectif budgétaire',
  wealthShortcut: 'Objectif de patrimoine',
  projectionShortcut: 'Projection',
  assumptionsShortcut: 'Hypothèses',
  lifeGoalsShortcut: 'Objectifs de vie',
  allocationShortcut: 'Répartition',
  goalsTitle: 'Vos objectifs de vie',
  goalManagement: 'Gérer ou retirer un objectif',
  assumptionsTitle: 'Ajuster les hypothèses de projection',
  transferSettings: 'Préparer un versement entre actifs',
  goalsIntro:
    'Montants en euros d’aujourd’hui. La projection déduit les achats et études à leur date ; retraite, précaution et transmission restent du capital à conserver.',
  goalSpent: 'À dépenser : déduit du patrimoine projeté à la date choisie.',
  goalKept: 'À conserver : reste dans le patrimoine projeté, réservé à cet objectif.',
  goalNoTransfer: 'L’enregistrement ajuste la projection, sans réserver ni transférer d’argent.',
  removeTitle: 'Retirer cet objectif ?',
  removeHelp:
    'Votre projection et l’effort budgétaire seront recalculés. Vos actifs et vos opérations restent inchangés.',
  goalsEmpty:
    'Aucun objectif pour l’instant : ajoutez les études des enfants, votre retraite ou un projet.',
  addGoal: 'Ajouter un objectif',
  editGoal: 'Modifier l’objectif',
  goalLabel: 'Nom de l’objectif',
  goalKind: 'Usage',
  goalAmount: 'Montant visé (euros d’aujourd’hui)',
  goalDate: 'Date visée',
  goalNote: 'Note, facultative',
  save: 'Enregistrer',
  cancel: 'Annuler',
  edit: 'Modifier',
  remove: 'Retirer',
  needed: 'À la date visée :',
  covered: 'couvert',
  statusfinance: 'Finançable',
  statuspartiel: 'Partiellement finançable',
  'statusnon-finance': 'À financer',
  'statusau-dela': 'Au-delà de l’horizon',
  returnTitle: 'Hypothèse de rendement',
  returnIntro: 'Taux annuel utilisé dans la projection, avant inflation. Il reste une hypothèse.',
  returnLabel: 'Rendement annuel (%)',
  inflationTitle: 'Inflation retenue par année',
  inflationIntro:
    'Ces taux ajustent le coût futur des objectifs et le pouvoir d’achat du patrimoine. Référence INSEE ou valeurs saisies.',
  inflationFuture: 'Pour les années sans indice, l’hypothèse retenue est de',
  inflationSetting: 'Régler l’hypothèse',
  inflationYear: 'Année',
  inflationRate: 'Taux (%)',
  inflationSource: 'Source',
  sourcereference: 'Référence INSEE',
  sourceprofil: 'Votre saisie',
  inflationAdd: 'Ajouter ou corriger une année',
  inflationReset: 'Revenir à la référence',
  saved: 'Enregistré.',
  goalAllocation: 'Allocation associée',
  noAllocation: 'Aucune pour l’instant',
  constituted: 'Déjà constitué :',
  ofGoal: 'de l’objectif',
  sharedBy: 'partagé entre',
  goalsWord: 'objectifs',
  ofTheirTarget: 'de leurs',
  allocTitle: 'Votre patrimoine par usage',
  allocIntro: 'Vos actifs regroupés par usage : épargne disponible, études, transmission…',
  allocNoAsset: 'Aucun actif pour l’instant',
  allocFlows: 'Apports du budget non répartis',
  allocFlowsHelp:
    'Soldes des budgets clôturés, inclus dans le patrimoine total et distincts des valeurs des actifs.',
  transferTitle: 'Verser d’un actif vers un autre',
  transferFrom: 'Depuis',
  transferTo: 'Vers',
  transferAmount: 'Montant (€)',
  transferDate: 'Date',
  transferAction: 'Enregistrer le versement',
  transferInvalid: 'Choisissez deux actifs différents et un montant positif.',
  invalid: 'Vérifiez les champs : nom, montant positif et date sont obligatoires.',
};
registerPageTexts(
  Object.fromEntries(Object.entries(BPM_VISION_TEXTS).map(([key, value]) => [P + key, value])),
);

const KIND_SYMBOLS: Record<BpmGoalKind, string> = {
  etudes: '🎓',
  retraite: '🌅',
  achat: '🏡',
  securite: '🛟',
  transmission: '🤝',
  autre: '✦',
};
const year = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const at = (value: string) => new Date(`${value}T12:00:00Z`);
const percentFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const goalDraft = () => ({
  id: '',
  label: '',
  kind: 'etudes' as BpmGoalKind,
  amount: '',
  date: '',
  note: '',
  allocationId: '',
});

/**
 * Ma vision budgétaire : les objectifs de vie, le rendement visé et l'indice
 * d'inflation, avec la projection qui en découle. Les écritures passent par
 * l'API BPM ; tout le reste est calculé à la lecture.
 */
@Component({
  selector: 'rjs-bpm-vision-page',
  imports: [
    BpmProjectCostsComponent,
    BpmObjectivesComponent,
    RangeFieldComponent,
    BpmContextComponent,
    BpmPopoverComponent,
    BpmProjectSwitchComponent,
    ModalComponent,
    AppHeroComponent,
    BpmGateComponent,
    BpmTermComponent,
    BpmTourComponent,
    BpmWorkspaceNavComponent,
    FormsModule,
    MetricTilesComponent,
    RouterLink,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./bpm-pages.scss', './bpm-vision.page.scss'],
  template: `
    <div class="page bpm-reading bpm-vision" data-tone="budget">
      <rjs-bpm-gate suite="/budget-patrimoine-management/vision" />
      @if (store.workspace() && store.error()) {
        <p class="bpm-error" role="alert">{{ store.error() }}</p>
      }
      @if (!store.workspace()) {
      } @else if (!project()) {
        <rjs-app-hero
          toolsLabel="Actions"
          tone="aurora"
          headingId="bv-empty-title"
          [kicker]="t('kicker')"
          [title]="t('title')"
          [lead]="t('empty')"
          [actions]="[
            { label: t('emptyAction') + ' →', link: '/budget-patrimoine-management/creer' },
          ]"
        ></rjs-app-hero>
      } @else {
        @let p = project()!;
        @let mine = manages(p);
        @let o = outlook();
        <rjs-app-hero
          toolsLabel="Actions"
          data-tour="outlook"
          tone="lagoon"
          headingId="bv-title"
          [kicker]="t('kicker')"
          [title]="t('title')"
          [lead]="t('lead')"
          [chips]="chips()"
        >
          <rjs-bpm-workspace-nav heroGuide [project]="p" active="vision" />
          <rjs-bpm-tour
            heroGuide
            [inline]="true"
            page="vision"
            [steps]="['outlook', 'chart', 'goals', 'allocations', 'inflation', 'act']"
          />
          @if (o.due) {
            <div
              class="bp-rhythm"
              role="img"
              [attr.aria-label]="o.financed + ' / ' + o.due + ' ' + t('heroFunded')"
              [attr.data-state]="o.financed < o.due ? 'ahead' : 'ok'"
            >
              <span class="bp-rhythm-row"
                ><small>{{ t('heroFunded') }}</small
                ><strong>{{ o.financed }} / {{ o.due }}</strong></span
              >
              <span class="bp-rhythm-row"
                ><small>{{ t('heroReal') }}</small
                ><strong>{{ money(o.realCents) }}</strong></span
              >
            </div>
          }
          @if (mine) {
            <button heroActions type="button" class="app-hero-action" (click)="startGoal()">
              ＋ {{ t('addGoal') }}
            </button>
          }
          <a
            heroActions
            class="bpm-link"
            [routerLink]="[]"
            queryParamsHandling="preserve"
            fragment="hypotheses"
            (click)="assumptionsOpen.set(true)"
            >{{ t('assumptionsShortcut') }} →</a
          >
          <nav heroPageTools [attr.aria-label]="t('kicker')">
            <a [routerLink]="[]" queryParamsHandling="preserve" fragment="objectifs-budgetaires">{{
              t('budgetShortcut')
            }}</a>
            <a [routerLink]="[]" queryParamsHandling="preserve" fragment="cap-patrimonial">{{
              t('wealthShortcut')
            }}</a>
            <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bv-chart-title">{{
              t('projectionShortcut')
            }}</a>
            <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bv-goals-title">{{
              t('lifeGoalsShortcut')
            }}</a>
            <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bv-alloc-title">{{
              t('allocationShortcut')
            }}</a>
          </nav>
          <rjs-bpm-project-switch
            heroMeta
            [embedded]="true"
            [projects]="projects()"
            [current]="p.id"
          />
          <rjs-bpm-context heroMetaWide [scopeOnly]="true" [compact]="true" [embedded]="true" />
        </rjs-app-hero>

        <section class="bv-results" data-bpm-frame="metrics" aria-labelledby="bv-results-title">
          <header class="bv-results-head">
            <div>
              <span class="bv-eyebrow"
                >{{ t('resultsLabel') }} · {{ projection().final.year }}</span
              >
              <h2 id="bv-results-title">{{ t('resultsTitle') }}</h2>
            </div>
          </header>
          <rjs-metric-tiles variant="instrument" [label]="t('kpis')" [tiles]="tiles()" />
        </section>

        <section class="bv-objectives-overview" aria-labelledby="bv-objectives-overview-title">
          <header class="bv-overview-head">
            <h2 id="bv-objectives-overview-title">{{ t('goalsOverview') }}</h2>
            <p>{{ t('goalsOverviewHelp') }}</p>
          </header>
          <rjs-bpm-objectives [project]="p" [manages]="mine" [compactControls]="true" />
        </section>

        <!-- 01 · État des lieux : ce qui est, avant ce que l'on peut y faire. -->
        <section
          data-ui-pattern="panel cockpit"
          data-cockpit-phase="state"
          id="etat-des-lieux"
          data-tour="state"
          [attr.aria-label]="t('zoneState')"
        >
          <h2 class="cockpit-heading" data-ui-pattern="section-heading">
            <span class="cockpit-index" aria-hidden="true">01</span
            ><span class="cockpit-title">{{ t('zoneState') }}</span>
          </h2>
          <p class="cockpit-lead">{{ t('zoneStateLead') }}</p>
          @if (!mine) {
            <p class="bpm-missing">{{ t('readOnly') }}</p>
          }

          <p class="bv-contribution">
            {{ t('contribution') }} <rjs-bpm-term key="apports" /> :
            <strong>{{ money(inLens(p, contribution().cents)) }} {{ word('per') }}</strong
            >, {{ t('contribution' + contribution().source) }}.
          </p>
          @if (reality(); as r) {
            <div class="bv-reality" [attr.data-state]="(r.gapPct ?? 0) < -10 ? 'warning' : 'ok'">
              <p>
                {{
                  fill('realityLine', {
                    n: String(r.closures),
                    avg: money(inLens(p, r.averageCents)),
                    per: word('per'),
                    gap:
                      r.gapPct === null
                        ? '—'
                        : (r.gapPct > 0 ? '+' : r.gapPct < 0 ? '−' : '') +
                          Math.abs(r.gapPct) +
                          ' %',
                  })
                }}
              </p>
              <rjs-bpm-popover
                icon="≈"
                [label]="t('realityOpen')"
                [kicker]="t('realityKicker')"
                [title]="t('realityTitle')"
              >
                <table class="bv-reality-table">
                  <thead>
                    <tr>
                      <th scope="col"></th>
                      <th scope="col">{{ t('realityWith') }}</th>
                      <th scope="col">{{ t('realityWithAverage') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">{{ t('realityRetained') }} / {{ t('realityAverage') }}</th>
                      <td>{{ money(inLens(p, r.retainedCents)) }} {{ word('per') }}</td>
                      <td>{{ money(inLens(p, r.averageCents)) }} {{ word('per') }}</td>
                    </tr>
                    @if (prudent(); as pr) {
                      <tr>
                        <th scope="row">{{ t('realityProjected') }} · {{ pr.year }}</th>
                        <td>{{ money(projection().final.nominalCents) }}</td>
                        <td>{{ money(pr.nominalCents) }}</td>
                      </tr>
                      <tr>
                        <th scope="row">{{ t('realityFunded') }}</th>
                        <td>{{ funded(projection().goals) }}</td>
                        <td>{{ funded(pr.goals) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
                <p>{{ t('realityHelp') }}</p>
                <a
                  routerLink="/budget-patrimoine-management/tableau-de-bord"
                  [queryParams]="{ projet: p.id }"
                  >{{ t('realityMoney') }} →</a
                >
              </rjs-bpm-popover>
            </div>
          }
          @let need = required();
          @if (need !== null) {
            <aside
              class="bv-directive"
              [attr.data-state]="contribution().cents >= need ? 'ok' : 'behind'"
            >
              <strong
                >{{ need < 0 ? t('directiveSurplus') : t('directiveNeed') }}
                {{ money(inLens(p, need < 0 ? -need : need)) }} {{ word('per') }}</strong
              >
              <rjs-bpm-term key="epargneNecessaire" />
              <span>{{
                contribution().cents >= need ? t('directiveOk') : t('directiveBehind')
              }}</span>
              <a routerLink="/budget-patrimoine-management/piloter" [queryParams]="{ projet: p.id }"
                >{{ t('directiveOpen') }} →</a
              >
            </aside>
          }
          <section
            class="bv-card"
            data-tour="chart"
            data-bpm-frame="chart"
            aria-labelledby="bv-chart-title"
            data-ui-pattern="panel"
          >
            <h2 id="bv-chart-title">{{ t('chartTitle') }} <rjs-bpm-term key="inflation" /></h2>
            @if (chart(); as c) {
              <svg
                class="bv-chart"
                [attr.viewBox]="'0 0 ' + c.width + ' ' + c.height"
                preserveAspectRatio="none"
                role="img"
                [attr.aria-label]="t('chartTitle')"
              >
                <line
                  class="bv-zero"
                  x1="0"
                  [attr.x2]="c.width"
                  [attr.y1]="c.zero"
                  [attr.y2]="c.zero"
                />
                <path class="bv-area" [attr.d]="c.area" />
                <path class="bv-nominal" [attr.d]="c.nominal" />
                <path class="bv-real" [attr.d]="c.real" />
                @for (marker of c.markers; track marker.id) {
                  <line
                    class="bv-marker"
                    [attr.data-status]="marker.status"
                    [attr.x1]="marker.x"
                    [attr.x2]="marker.x"
                    y1="0"
                    [attr.y2]="c.height"
                  />
                }
              </svg>
              <div class="bv-legend">
                <span class="bv-legend-nominal">{{ t('chartNominal') }}</span>
                <span class="bv-legend-real">{{ t('chartReal') }}</span>
                <span class="bv-axis"
                  >{{ projection().years[0]!.year }} → {{ projection().final.year }}</span
                >
              </div>
            }
          </section>
          <section
            class="bv-card"
            data-tour="goals"
            id="objectifs"
            aria-labelledby="bv-goals-title"
            data-ui-pattern="panel"
          >
            <header class="bv-card-head">
              <div>
                <h2 id="bv-goals-title">{{ t('goalsTitle') }} <rjs-bpm-term key="objectifs" /></h2>
                <p>{{ t('goalsIntro') }}</p>
              </div>
              @if (mine) {
                <button type="button" class="btn btn-primary" (click)="startGoal()">
                  + {{ t('addGoal') }}
                </button>
              }
            </header>
            @if (projection().goals.length) {
              <ul class="bv-goals">
                @for (reading of projection().goals; track reading.goal.id) {
                  <li class="bv-goal" [attr.data-status]="reading.status">
                    <span class="bv-goal-icon" aria-hidden="true">{{
                      symbol(reading.goal.kind)
                    }}</span>
                    <div class="bv-goal-body">
                      <small
                        >{{ t('kind' + reading.goal.kind) }} ·
                        {{ monthYear(reading.goal.targetDate) }}</small
                      >
                      <strong>{{ reading.goal.label }}</strong>
                      <span
                        >{{ money(reading.goal.targetCents) }}
                        @if (reading.status !== 'au-dela') {
                          · {{ t('needed') }} {{ money(reading.targetNominalCents) }}
                        }
                      </span>
                      @if (reading.status !== 'au-dela') {
                        <span class="bv-meter" aria-hidden="true"
                          ><span [style.width.%]="percent(reading)"></span
                        ></span>
                      }
                      @if (allocationOf(reading.goal); as allocation) {
                        @let sharing = sharedGoals(allocation.id);
                        <span class="bv-constituted"
                          >{{ t('constituted') }} {{ money(allocation.valueCents) }} ·
                          {{ allocation.name }}
                          @if (sharing.count > 1) {
                            ({{ t('sharedBy') }} {{ sharing.count }} {{ t('goalsWord') }},
                            {{ constitutedShare(allocation.valueCents, sharing.targetCents) }} %
                            {{ t('ofTheirTarget') }} {{ money(sharing.targetCents) }})
                          } @else {
                            ({{
                              constitutedShare(allocation.valueCents, reading.goal.targetCents)
                            }}
                            % {{ t('ofGoal') }})
                          }
                        </span>
                      }
                    </div>
                    <div class="bv-goal-result">
                      <span class="bv-status"
                        >{{ t('status' + reading.status) }}
                        @if (reading.status === 'partiel') {
                          · {{ percent(reading) }} % {{ t('covered') }}
                        }
                      </span>
                      @if (mine) {
                        <button
                          type="button"
                          class="btn btn-secondary"
                          (click)="startGoal(reading.goal)"
                          [attr.aria-label]="t('editGoal') + ' · ' + reading.goal.label"
                        >
                          {{ t('edit') }}
                        </button>
                      }
                    </div>
                  </li>
                }
              </ul>
            } @else if (!editing()) {
              <p class="bv-empty">{{ t('goalsEmpty') }}</p>
            }
          </section>
          <section
            class="bv-card"
            data-tour="allocations"
            aria-labelledby="bv-alloc-title"
            data-ui-pattern="panel"
          >
            <h2 id="bv-alloc-title">{{ t('allocTitle') }} <rjs-bpm-term key="allocation" /></h2>
            <p>{{ t('allocIntro') }}</p>
            @if (allocations().length) {
              <ul class="bv-allocations">
                @for (allocation of allocations(); track allocation.id) {
                  <li>
                    <div class="bv-alloc-head">
                      <strong>{{ allocation.name }}</strong>
                      <span
                        >{{ money(allocation.valueCents) }}
                        @if (allocation.targetCents) {
                          <small>/ {{ money(allocation.targetCents) }}</small>
                        }
                      </span>
                    </div>
                    @if (allocation.targetCents) {
                      <span class="bv-meter" aria-hidden="true"
                        ><span
                          [style.width.%]="
                            constitutedShare(allocation.valueCents, allocation.targetCents)
                          "
                        ></span
                      ></span>
                    }
                    <small>
                      @for (asset of allocation.assets; track asset.id; let last = $last) {
                        {{ asset.name }} : {{ asset.known ? money(asset.valueCents) : t('unknown')
                        }}{{ last ? '' : ' · ' }}
                      } @empty {
                        {{ t('allocNoAsset') }}
                      }
                    </small>
                  </li>
                }
                @if (p.snapshot?.standing?.budgetFlowCents; as flows) {
                  <li class="bv-alloc-flows">
                    <div class="bv-alloc-head">
                      <strong>{{ t('allocFlows') }}</strong>
                      <span>{{ money(flows) }}</span>
                    </div>
                    <small>{{ t('allocFlowsHelp') }}</small>
                  </li>
                }
              </ul>
            }
          </section>
          <details
            class="bpm-disclosure bv-card"
            data-tour="inflation"
            aria-labelledby="bv-inflation-title"
            data-ui-pattern="panel"
          >
            <summary>
              <h2 id="bv-inflation-title">{{ t('inflationTitle') }}</h2>
            </summary>
            <div class="bpm-disclosure-body">
              <p>{{ t('inflationIntro') }}</p>
              <table class="bv-inflation">
                <thead>
                  <tr>
                    <th scope="col">{{ t('inflationYear') }}</th>
                    <th scope="col">{{ t('inflationRate') }}</th>
                    <th scope="col">{{ t('inflationSource') }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (point of inflation(); track point.year) {
                    <tr [attr.data-source]="point.source">
                      <td>{{ point.year }}</td>
                      <td>{{ pct(point.ratePct) }} %</td>
                      <td>{{ t('source' + point.source) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
              <p class="bpm-help">
                {{ t('inflationFuture') }} <strong>{{ pct(inflationDefault) }} %</strong>.
                <a routerLink="/configuration/reglages">{{ t('inflationSetting') }}</a>
              </p>
            </div>
          </details>
        </section>

        <!-- 02 · Agir : les gestes qui modifient la vision, une fois l'état des lieux lu. -->
        <section
          data-ui-pattern="panel cockpit"
          data-cockpit-phase="act"
          id="agir"
          data-tour="act"
          [attr.aria-label]="t('zoneAct')"
        >
          <h2 class="cockpit-heading" data-ui-pattern="section-heading">
            <span class="cockpit-index" aria-hidden="true">02</span
            ><span class="cockpit-title">{{ t('zoneAct') }}</span>
          </h2>
          <p class="cockpit-lead">{{ t('zoneActLead') }}</p>
          @if (message()) {
            <p class="bv-saved" role="status">{{ message() }}</p>
          }
          @if (mine) {
            <section
              class="bv-card"
              data-tour="act-goals"
              aria-labelledby="bv-manage-title"
              data-ui-pattern="panel"
            >
              <header class="bv-card-head">
                <div>
                  <h2 id="bv-manage-title">{{ t('manageTitle') }}</h2>
                  <p>{{ t('manageIntro') }}</p>
                </div>
                <button type="button" class="btn btn-primary" (click)="startGoal()">
                  + {{ t('addGoal') }}
                </button>
              </header>
              <rjs-modal
                [headed]="true"
                [open]="editing()"
                [title]="draft.id ? t('editGoal') : t('addGoal')"
                [busy]="store.saving()"
                (closed)="editing.set(false)"
              >
                @if (editing()) {
                  <form class="bv-form" (ngSubmit)="saveGoal(p)">
                    <div class="bv-kinds" role="radiogroup" [attr.aria-label]="t('goalKind')">
                      @for (kind of kinds; track kind) {
                        <label class="bv-kind" [class.is-selected]="draft.kind === kind">
                          <input type="radio" name="kind" [value]="kind" [(ngModel)]="draft.kind" />
                          <span aria-hidden="true">{{ symbol(kind) }}</span
                          >{{ t('kind' + kind) }}
                        </label>
                      }
                    </div>
                    <p class="bpm-help">
                      {{
                        ['transmission', 'retraite', 'securite'].includes(draft.kind)
                          ? t('goalKept')
                          : t('goalSpent')
                      }}
                    </p>
                    <p class="bpm-help">{{ t('goalNoTransfer') }}</p>
                    <div class="bv-fields">
                      <label
                        >{{ t('goalLabel')
                        }}<input
                          autofocus
                          name="label"
                          [(ngModel)]="draft.label"
                          maxlength="80"
                          required
                      /></label>
                      <label
                        >{{ t('goalAmount')
                        }}<input
                          name="amount"
                          inputmode="decimal"
                          [(ngModel)]="draft.amount"
                          required
                      /></label>
                      <label
                        >{{ t('goalDate')
                        }}<input name="date" type="date" [(ngModel)]="draft.date" required
                      /></label>
                      <label
                        >{{ t('goalAllocation') }}
                        <select name="allocation" [(ngModel)]="draft.allocationId">
                          <option value="">{{ t('noAllocation') }}</option>
                          @for (allocation of allocations(); track allocation.id) {
                            <option [value]="allocation.id">{{ allocation.name }}</option>
                          }
                        </select>
                      </label>
                      <label class="bv-wide"
                        >{{ t('goalNote')
                        }}<input name="note" [(ngModel)]="draft.note" maxlength="300"
                      /></label>
                    </div>
                    @if (store.error()) {
                      <p class="bpm-error" role="alert">{{ store.error() }}</p>
                    }
                    @if (formError()) {
                      <p class="bpm-error" role="alert">{{ formError() }}</p>
                    }
                    <div class="bpm-actions">
                      <button type="submit" class="btn btn-primary" [disabled]="store.saving()">
                        {{ t('save') }}
                      </button>
                      <button type="button" class="btn btn-secondary" (click)="editing.set(false)">
                        {{ t('cancel') }}
                      </button>
                    </div>
                  </form>
                }
              </rjs-modal>
              <rjs-modal
                [headed]="true"
                [open]="!!removing()"
                [title]="t('removeTitle')"
                [busy]="store.saving()"
                (closed)="removing.set(null)"
              >
                <section class="bv-form">
                  <strong>{{ removing()?.label }}</strong>
                  <p>{{ t('removeHelp') }}</p>
                  @if (store.error()) {
                    <p class="bpm-error" role="alert">{{ store.error() }}</p>
                  }
                  <div class="bpm-actions">
                    <button
                      autofocus
                      type="button"
                      class="btn btn-secondary"
                      [disabled]="store.saving()"
                      (click)="removing.set(null)"
                    >
                      {{ t('cancel') }}
                    </button>
                    <button
                      type="button"
                      class="btn btn-primary"
                      [disabled]="store.saving()"
                      (click)="removeGoal(p, removing()!.id)"
                    >
                      {{ t('remove') }}
                    </button>
                  </div>
                </section>
              </rjs-modal>
              @if (vision().goals.length) {
                <details class="bpm-disclosure">
                  <summary>{{ t('goalManagement') }} · {{ vision().goals.length }}</summary>
                  <ul class="bv-manage bpm-disclosure-body">
                    @for (goal of vision().goals; track goal.id) {
                      <li>
                        <span
                          ><strong>{{ goal.label }}</strong> · {{ monthYear(goal.targetDate) }} ·
                          {{ money(goal.targetCents) }}</span
                        >
                        <span class="bv-goal-actions">
                          <button type="button" class="btn btn-secondary" (click)="startGoal(goal)">
                            {{ t('edit') }}
                          </button>
                          <button
                            type="button"
                            class="btn btn-secondary"
                            (click)="removing.set(goal)"
                          >
                            {{ t('remove') }}
                          </button>
                        </span>
                      </li>
                    }
                  </ul>
                </details>
              }
            </section>
            @if (assets().length > 1) {
              <section
                class="bv-card"
                data-tour="act-transfer"
                aria-labelledby="bv-transfer-title"
                data-ui-pattern="panel"
              >
                <h2 id="bv-transfer-title">{{ t('transferTitle') }}</h2>
                <p>{{ t('transferIntro') }}</p>
                <details class="bpm-disclosure">
                  <summary>{{ t('transferSettings') }}</summary>
                  <form class="bv-transfer bpm-disclosure-body" (ngSubmit)="transfer(p)">
                    <div class="bv-fields">
                      <label
                        >{{ t('transferFrom') }}
                        <select name="from" [(ngModel)]="transferDraft.from" required>
                          @for (asset of assets(); track asset.id) {
                            <option [value]="asset.id">
                              {{ asset.name }} ({{ money(asset.valueCents) }})
                            </option>
                          }
                        </select>
                      </label>
                      <label
                        >{{ t('transferTo') }}
                        <select name="to" [(ngModel)]="transferDraft.to" required>
                          @for (asset of assets(); track asset.id) {
                            <option [value]="asset.id">{{ asset.name }}</option>
                          }
                        </select>
                      </label>
                      <label
                        >{{ t('transferAmount')
                        }}<input
                          name="transferAmount"
                          inputmode="decimal"
                          [(ngModel)]="transferDraft.amount"
                          required
                      /></label>
                      <label
                        >{{ t('transferDate')
                        }}<input
                          name="transferDate"
                          type="date"
                          [(ngModel)]="transferDraft.date"
                          required
                      /></label>
                    </div>
                    @if (transferError()) {
                      <p class="bpm-error" role="alert">{{ transferError() }}</p>
                    }
                    <button type="submit" class="btn btn-primary" [disabled]="store.saving()">
                      {{ t('transferAction') }}
                    </button>
                  </form>
                </details>
              </section>
            }
            <details
              class="bpm-disclosure bv-card"
              id="hypotheses"
              [open]="assumptionsOpen()"
              (toggle)="assumptionsOpen.set($any($event.target).open)"
            >
              <summary>{{ t('assumptionsTitle') }}</summary>
              <div class="bv-split bpm-disclosure-body">
                <section class="bv-card" aria-labelledby="bv-return-title" data-ui-pattern="panel">
                  <h2 id="bv-return-title">
                    {{ t('returnTitle') }} <rjs-bpm-term key="rendementReel" />
                  </h2>
                  <p>{{ t('returnIntro') }}</p>
                  <form
                    class="bv-return"
                    #returnForm="ngForm"
                    (ngSubmit)="returnForm.valid && saveReturn(p)"
                  >
                    <rjs-range-field
                      id="vision-return"
                      name="returnValue"
                      [label]="t('returnLabel')"
                      [min]="returnMin"
                      [max]="returnMax"
                      [step]="0.1"
                      [numberStep]="0.01"
                      unit="%"
                      [(ngModel)]="returnDraft"
                    />
                    <button
                      type="submit"
                      class="btn btn-primary"
                      [disabled]="store.saving() || returnForm.invalid"
                    >
                      {{ t('save') }}
                    </button>
                  </form>
                </section>
                <section
                  class="bv-card"
                  aria-labelledby="bv-inflation-form-title"
                  data-ui-pattern="panel"
                >
                  <h2 id="bv-inflation-form-title">{{ t('inflationFormTitle') }}</h2>
                  <p>{{ t('inflationFormIntro') }}</p>
                  <form
                    class="bv-inflation-form"
                    #inflationForm="ngForm"
                    (ngSubmit)="inflationForm.valid && saveInflation()"
                  >
                    <label
                      >{{ t('inflationYear')
                      }}<input
                        type="number"
                        name="iy"
                        [(ngModel)]="inflationYearDraft"
                        min="1900"
                        max="2200"
                        required
                    /></label>
                    <rjs-range-field
                      id="vision-inflation"
                      name="ir"
                      [label]="t('inflationRate')"
                      [min]="inflationMin"
                      [max]="inflationMax"
                      [step]="0.1"
                      [numberStep]="0.01"
                      unit="%"
                      [(ngModel)]="inflationRateDraft"
                    />
                    <button
                      type="submit"
                      class="btn btn-secondary"
                      [disabled]="store.saving() || inflationForm.invalid"
                    >
                      {{ t('inflationAdd') }}
                    </button>
                  </form>
                </section>
              </div>
            </details>
          } @else {
            <p class="bpm-missing">{{ t('readOnlyAct') }}</p>
          }
        </section>
        @if (p.snapshot; as snapshot) {
          <rjs-bpm-project-costs
            [project]="p"
            [costs]="view()?.budgetProjects ?? snapshot.budgetProjects ?? []"
            [start]="view()?.start ?? snapshot.period.start"
            [end]="view()?.end ?? snapshot.period.end"
          />
        }
      }
    </div>
  `,
})
export class BpmVisionPage {
  protected readonly assumptionsOpen = signal(false);
  protected readonly view = computed(() => {
    const p = this.project();
    return p?.snapshot?.lenses?.[cycleOf(p)] ?? null;
  });
  protected expenseQuery(operation?: string, occurrence?: string, date?: string) {
    const p = this.project()!,
      view = this.view();
    return {
      ...expensePeriodQuery(p, { start: view?.start, end: view?.end, operation, occurrence, date }),
      budget: p.budgetProjectId,
    };
  }

  protected readonly removing = signal<BpmGoal | null>(null);
  protected readonly store = inject(BpmStore);
  private readonly session = inject(UserSession);
  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap);
  protected readonly kinds = BPM_GOAL_KINDS;
  protected readonly money = formatMoney;
  protected readonly inflationDefault = Number(siteSetting<string>('bpm.vision.inflationDefaut'));
  private readonly returnDefault = Number(siteSetting<string>('bpm.vision.rendementDefaut'));
  private readonly horizon = siteSetting<number>('bpm.vision.horizonAns');
  protected readonly returnMin = Number(siteSetting<string>('bpm.vision.rendementMin'));
  protected readonly inflationMin = Number(siteSetting<string>('bpm.vision.inflationMin'));
  protected readonly inflationMax = Number(siteSetting<string>('bpm.vision.inflationMax'));
  protected readonly returnMax = Number(siteSetting<string>('bpm.vision.rendementMax'));
  protected readonly editing = signal(false);
  protected readonly formError = signal('');
  protected readonly message = signal('');
  protected draft = goalDraft();
  protected returnDraft: number | null = 0;
  protected inflationYearDraft = new Date().getFullYear();
  protected inflationRateDraft = 0;

  protected readonly projects = computed(() => {
    const me = this.session.profile()?.id ?? '';
    return [...this.store.displayedProjects()].sort(
      (a, b) =>
        Number(b.ownerUserId === me) - Number(a.ownerUserId === me) ||
        Number(b.defaultForEntity === true) - Number(a.defaultForEntity === true) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  });
  protected readonly project = computed(() => {
    const wanted = this.params()?.get('projet') ?? '';
    return this.projects().find((entry) => entry.id === wanted) ?? this.projects()[0] ?? null;
  });
  protected readonly vision = computed(() => this.project()?.vision ?? emptyVision());
  protected readonly allocations = computed(() => this.project()?.snapshot?.allocations ?? []);
  protected readonly assets = computed(() =>
    this.allocations().flatMap((allocation) => allocation.assets),
  );
  protected readonly transferError = signal('');
  protected transferDraft = {
    from: '',
    to: '',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
  };
  protected readonly inflation = computed(() => this.store.workspace()?.inflation.effective ?? []);
  protected readonly contribution = computed(() =>
    this.project() ? contributionOf(this.project()!) : contributionPerPeriod(this.vision(), []),
  );
  private readonly input = computed(() => {
    const p = this.project();
    const w = this.store.workspace();
    return p && w ? visionInputOf(p, w, visionSettings()) : null;
  });
  protected readonly projection = computed(() => {
    const input = this.input();
    return visionProjection(
      input ?? {
        today: '2000-01-01',
        startCents: 0,
        contributionPerPeriodCents: 0,
        periodsPerYear: 12,
        returnPct: 0,
        inflation: () => 0,
        horizonYears: 1,
        goals: [],
      },
    );
  });
  /** L'épargne par période qui finance tous les objectifs de l'horizon. */
  /** Ce que les clôtures ont réellement versé, face à l'apport retenu par la projection. */
  protected readonly reality = computed(() => {
    const p = this.project();
    return p ? contributionReality(p) : null;
  });
  /** La projection prudente : la même, avec la moyenne réelle des clôtures pour apport. */
  protected readonly prudent = computed(() => {
    const p = this.project();
    const w = this.store.workspace();
    const r = this.reality();
    if (!p || !w || !r) return null;
    const reading = visionProjection(
      visionInputOf(p, w, visionSettings(), r.averageCents - r.retainedCents),
    );
    return {
      year: reading.final.year,
      nominalCents: reading.final.nominalCents,
      goals: reading.goals,
    };
  });
  protected readonly Math = Math;
  protected readonly String = String;
  protected fill(key: string, values: Record<string, string>): string {
    return Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, value),
      this.t(key),
    );
  }
  protected funded(goals: readonly { status: string }[]): string {
    const due = goals.filter((goal) => goal.status !== 'au-dela');
    return `${due.filter((goal) => goal.status === 'finance').length} / ${due.length}`;
  }
  protected readonly required = computed(() => {
    const input = this.input();
    return input ? requiredContribution(input) : null;
  });
  protected readonly chart = computed(() =>
    visionChart(this.projection().years, this.projection().goals),
  );
  /** Le bandeau de la vue : ce que le patrimoine pourrait devenir et les objectifs qu'il finance. */
  protected readonly outlook = computed(() => {
    const p = this.project();
    const reading = this.projection();
    const due = reading.goals.filter((entry) => entry.status !== 'au-dela');
    const financed = due.filter((entry) => entry.status === 'finance').length;
    const known = p?.snapshot?.standing.totalCents != null;
    const fill = (key: string, values: Record<string, string>) =>
      Object.entries(values).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, value),
        this.t(key),
      );
    const title = known
      ? fill('heroTitle', {
          year: String(reading.final.year),
          amount: formatMoney(reading.final.nominalCents),
        })
      : this.t('title');
    const lead = !known
      ? this.t('heroUnknown')
      : due.length
        ? fill(financed === due.length ? 'heroAllFunded' : 'heroSomeFunded', {
            financed: String(financed),
            due: String(due.length),
            real: formatMoney(reading.final.realCents),
          })
        : this.t('lead');
    return { title, lead, financed, due: due.length, realCents: reading.final.realCents };
  });
  protected readonly chips = computed<HeroChip[]>(() => {
    const today = Number((this.store.workspace()?.today ?? '').slice(0, 4));
    return [
      {
        label: this.t('chipReturn'),
        value: `${this.pct(this.vision().returnPct ?? this.returnDefault)} ${this.t('perYear')}`,
      },
      {
        label: this.t('chipInflation'),
        value: `${this.pct(inflationRate(this.inflation(), this.inflationDefault)(today))} ${this.t('perYear')}`,
      },
      { label: this.t('chipHorizon'), value: `${this.horizon} ${this.t('years')}` },
    ];
  });
  protected readonly tiles = computed<MetricTile[]>(() => {
    const reading = this.projection();
    const sign = (cents: number) => (cents > 0 ? 'success' : cents < 0 ? 'danger' : null);
    return [
      {
        id: 'final',
        label: `${this.t('kpiFinal')} · ${reading.final.year}`,
        value: formatMoney(reading.final.nominalCents),
        tone: sign(reading.final.nominalCents),
        emphasis: true,
        note: this.t('kpiFinalHelp'),
      },
      {
        id: 'real',
        label: this.t('kpiReal'),
        value: formatMoney(reading.final.realCents),
        tone: sign(reading.final.realCents),
        note: this.t('kpiRealHelp'),
      },
      {
        id: 'realReturn',
        label: this.t('kpiRealReturn'),
        value: `${this.pct(reading.realReturnPct)} %`,
        tone: reading.realReturnPct < 0 ? 'danger' : 'success',
        note: this.t(reading.realReturnPct < 0 ? 'kpiRealReturnHelp' : 'kpiRealReturnGainHelp'),
      },
      {
        id: 'erosion',
        label: this.t('kpiErosion'),
        value: `− ${formatMoney(reading.erosionCents)}`,
        tone: reading.erosionCents ? 'warning' : null,
        note: this.t('kpiErosionHelp'),
      },
    ];
  });

  private readonly projectId = computed(() => this.project()?.id);
  /** L'effort appartient au cycle du budget ; le stock patrimonial reste permanent. */
  protected readonly lens = computed(() => (this.project() ? cycleOf(this.project()!) : 'monthly'));
  /** Un mot de la vue courante : « par semaine », « par mois », « par an ». */
  protected word(kind: 'per' | 'this'): string {
    return lensWord(kind, this.lens());
  }
  /** Un montant par période du cycle, exprimé dans la vue courante. */
  protected inLens(project: BpmProject, cents: number): number {
    return toLens(cents, project, this.lens());
  }
  constructor() {
    effect(() => {
      const id = this.projectId();
      untracked(() => {
        if (!id) return;
        this.returnDraft = this.vision().returnPct ?? this.returnDefault;
        const assets = this.assets();
        this.transferDraft = {
          from: assets[0]?.id ?? '',
          to: assets[1]?.id ?? '',
          amount: '',
          date: this.store.workspace()?.today ?? new Date().toISOString().slice(0, 10),
        };
        this.draft = goalDraft();
        this.removing.set(null);
        this.editing.set(false);
        this.message.set('');
        this.formError.set('');
        this.transferError.set('');
      });
    });
    void this.store.load();
  }
  protected t(key: string): string {
    return pageText(P + key);
  }
  protected manages(project: BpmProject): boolean {
    return project.ownerUserId === '' || project.ownerUserId === (this.session.profile()?.id ?? '');
  }
  protected pct(value: number): string {
    return percentFormat.format(value);
  }
  protected symbol(kind: BpmGoalKind): string {
    return KIND_SYMBOLS[kind];
  }
  protected monthYear(value: string): string {
    return year.format(at(value));
  }
  protected percent(reading: GoalReading): number {
    return Math.round(reading.coverage * 100);
  }
  protected allocationOf(goal: BpmGoal) {
    return goal.allocationId
      ? (this.allocations().find((entry) => entry.id === goal.allocationId) ?? null)
      : null;
  }
  /** Les objectifs qui partagent une allocation et la somme de leurs montants visés. */
  protected sharedGoals(allocationId: string): { count: number; targetCents: number } {
    const goals = this.vision().goals.filter((goal) => goal.allocationId === allocationId);
    return {
      count: goals.length,
      targetCents: goals.reduce((sum, goal) => sum + goal.targetCents, 0),
    };
  }
  protected constitutedShare(value: number, target: number): number {
    return target > 0 ? Math.max(0, Math.min(100, Math.round((value / target) * 100))) : 0;
  }
  protected async transfer(project: BpmProject): Promise<void> {
    this.transferError.set('');
    const cents = parseAmount(this.transferDraft.amount);
    if (
      !this.transferDraft.from ||
      !this.transferDraft.to ||
      this.transferDraft.from === this.transferDraft.to ||
      !cents ||
      cents <= 0
    ) {
      this.transferError.set(this.t('transferInvalid'));
      return;
    }
    if (
      await this.store.transfer(project.id, {
        fromAssetId: this.transferDraft.from,
        toAssetId: this.transferDraft.to,
        amountCents: cents,
        date: this.transferDraft.date,
      })
    ) {
      this.transferDraft = { ...this.transferDraft, amount: '' };
      this.message.set(this.t('saved'));
    }
  }
  protected startGoal(goal?: BpmGoal): void {
    this.formError.set('');
    this.draft = goal
      ? {
          id: goal.id,
          label: goal.label,
          kind: goal.kind,
          amount: String(goal.targetCents / 100),
          date: goal.targetDate,
          note: goal.note,
          allocationId: goal.allocationId ?? '',
        }
      : goalDraft();
    this.editing.set(true);
  }
  protected async saveGoal(project: BpmProject): Promise<void> {
    const cents = parseAmount(this.draft.amount);
    if (!this.draft.label.trim() || !cents || cents <= 0 || !this.draft.date) {
      this.formError.set(this.t('invalid'));
      return;
    }
    const goal: BpmGoal = {
      id: this.draft.id || `G${Date.now().toString(36).toUpperCase()}`,
      label: this.draft.label.trim(),
      kind: this.draft.kind,
      targetCents: cents,
      targetDate: this.draft.date,
      note: this.draft.note.trim(),
      allocationId: this.draft.allocationId || null,
    };
    const goals = this.vision()
      .goals.filter((entry) => entry.id !== goal.id)
      .concat(goal);
    if (await this.store.saveVision(project.id, { ...this.vision(), goals })) {
      this.editing.set(false);
      this.message.set(this.t('saved'));
    }
  }
  protected async removeGoal(project: BpmProject, id: string): Promise<void> {
    const goals = this.vision().goals.filter((entry) => entry.id !== id);
    if (await this.store.saveVision(project.id, { ...this.vision(), goals })) {
      this.removing.set(null);
      this.message.set(this.t('saved'));
    }
  }
  protected async saveReturn(project: BpmProject): Promise<void> {
    const value = this.returnDraft;
    if (
      value === null ||
      !Number.isFinite(value) ||
      value < this.returnMin ||
      value > this.returnMax
    )
      return;
    if (
      await this.store.saveVision(project.id, {
        ...this.vision(),
        returnPct: Number.isFinite(value) ? value : null,
      })
    )
      this.message.set(this.t('saved'));
  }
  protected async saveInflation(): Promise<void> {
    const own = (this.store.workspace()?.inflation.own ?? []).filter(
      (entry) => entry.year !== Number(this.inflationYearDraft),
    );
    own.push({ year: Number(this.inflationYearDraft), ratePct: Number(this.inflationRateDraft) });
    if (await this.store.saveInflation(own)) this.message.set(this.t('saved'));
  }
}
