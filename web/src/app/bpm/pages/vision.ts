import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiError, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { Cadence, GoalCoverage, GoalType, LifeGoal, Vision } from '../../core/bpm-models';
import { CentsPipe, PercentPipe, ShortDatePipe, SignedCentsPipe, parseAmount, percentText, signedCents } from '../../core/format';
import { MetricTile, MetricTilesComponent } from '../../shared/metric-tiles.component';
import { ModalComponent } from '../../shared/modal.component';
import { BpmPageContext, BpmPageFrame, BpmRefresh, BpmSeriesChart, BpmState, ChartSeries, bpmLoader } from '../ui';
import { BpmGoalCoverage, GoalRow } from './vision-charts';
import { BpmGoalEditor, GoalTypeOption } from './vision-goal-editor';
import { BpmVisionObjectives, euroText, num } from './vision-objectives';

type ContribCadence = Exclude<Cadence, 'once'>;
const CADENCE_LABEL: Record<ContribCadence, string> = { weekly: 'par semaine', monthly: 'par mois', yearly: 'par an' };
const DEFAULT_TYPES: GoalTypeOption[] = [
  { key: 'etudes', label: 'Études', consumes: true },
  { key: 'retraite', label: 'Retraite', consumes: false },
  { key: 'achat', label: 'Achat', consumes: true },
  { key: 'securite', label: 'Sécurité', consumes: false },
  { key: 'transmission', label: 'Transmission', consumes: false },
  { key: 'autre', label: 'Autre', consumes: true },
];

/**
 * Objectifs et avenir (/vision), sur la structure source `bpm-vision.page` : résultats de la projection
 * (estimation, aucune écriture), les deux objectifs (budgétaire et cap patrimonial), puis le cockpit
 * 01 · État des lieux (hypothèses, apports, projection, objectifs de vie) et 02 · Agir (gestion des
 * objectifs, hypothèses). Les formulaires sont repliés ; seules les commandes explicites écrivent.
 */
@Component({
  selector: 'bpm-page-vision',
  providers: [BpmPageContext],
  imports: [FormsModule, RouterLink, BpmPageFrame, BpmState, BpmSeriesChart, BpmGoalCoverage, BpmGoalEditor, BpmVisionObjectives, MetricTilesComponent, ModalComponent, SignedCentsPipe, PercentPipe, ShortDatePipe, CentsPipe],
  styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-vision.page.scss'],
  template: `
    <bpm-page title="Objectifs et avenir" lead="Votre épargne, votre patrimoine, vos objectifs." pageClass="bpm-vision" [context]="summary.data()?.context">
      <ng-container actions>
        <button type="button" class="app-hero-action" (click)="openGoal(null)">＋ Ajouter un objectif</button>
        <a class="bpm-link" [routerLink]="[]" queryParamsHandling="preserve" fragment="hypotheses" (click)="openHyp()">Hypothèses →</a>
        <a class="bpm-link" routerLink="/projet-de-vie">Gestion du projet de vie →</a>
      </ng-container>

      <div class="bpm-vision" data-tone="budget">
        <nav class="bp-groups-nav" aria-label="Ma vision budgétaire">
          <a [routerLink]="[]" queryParamsHandling="preserve" fragment="objectifs-budgetaires">Objectif budgétaire</a>
          <a [routerLink]="[]" queryParamsHandling="preserve" fragment="cap-patrimonial">Objectif de patrimoine</a>
          <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bv-chart-title">Projection</a>
          <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bv-goals-title">Objectifs de vie</a>
          <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bv-alloc-title">Répartition</a>
        </nav>
        @if (message()) {
          <p class="bv-saved" role="status">{{ message() }}</p>
        }

        <!-- Résultats : la projection ouvre la page. -->
        <section class="bv-results" data-bpm-frame="metrics" aria-labelledby="bv-results-title">
          <header class="bv-results-head">
            <div>
              <span class="bv-eyebrow">Estimation{{ lastYear() ? ' · ' + lastYear() : '' }}</span>
              <h2 id="bv-results-title">Votre patrimoine demain</h2>
            </div>
          </header>
          <bpm-state [loading]="projection.loading() && !projection.data()" [error]="projection.error()" (retry)="projection.reload()" />
          @if (projection.data()) {
            <rjs-metric-tiles variant="instrument" label="Projection du patrimoine" [tiles]="tiles()" />
          }
        </section>

        <!-- Les deux objectifs : l'effort régulier et le stock à construire. -->
        <section class="bv-objectives-overview" aria-labelledby="bv-objectives-overview-title">
          <header class="bv-overview-head">
            <h2 id="bv-objectives-overview-title">Vos deux objectifs</h2>
            <p>Ce que vous gardez à chaque période construit votre patrimoine. Les deux cibles restent distinctes et ne s’additionnent jamais.</p>
          </header>
          <bpm-vision-objectives [profile]="profile" [directives]="directives" [summary]="summary" [contribution]="contributionText()" (saved)="message.set($event)" />
        </section>

        <!-- 01 · État des lieux : ce qui est, avant ce que l'on peut y faire. -->
        <section data-ui-pattern="panel cockpit" data-cockpit-phase="state" id="etat-des-lieux" aria-label="Comprendre la projection">
          <h2 class="cockpit-heading" data-ui-pattern="section-heading">
            <span class="cockpit-index" aria-hidden="true">01</span><span class="cockpit-title">Comprendre la projection</span>
          </h2>
          <p class="cockpit-lead">Les hypothèses retenues, l’apport du budget et la projection de votre patrimoine.</p>

          @if (projection.data(); as pr) {
            <p class="bv-contribution">
              Apport du budget dans la projection :
              <strong>{{ pr.hypotheses.contributionCents | signedCents }} {{ cadenceLabel(pr.hypotheses.cadence) }}</strong>, {{ pr.hypotheses.contributionSource }}.
            </p>
            @if (pr.status === 'missing-hypothesis') {
              <p class="bpm-missing" role="note">
                <strong>Hypothèse manquante.</strong> {{ pr.reason }} Aucune projection n'est calculée sans rendement.
                <button type="button" class="btn btn-secondary" (click)="openHyp()">Saisir le rendement</button>
              </p>
            } @else if (pr.status === 'unknown') {
              <p class="bpm-missing" role="note">
                <strong>Stock initial : À renseigner.</strong> {{ pr.reason ?? 'Aucune projection fiable sans valeur de départ.' }}
                <a class="btn btn-secondary" routerLink="/creer">Renseigner mon patrimoine initial</a>
              </p>
            }

            <!-- Hypothèses retenues -->
            <section class="bv-card" aria-labelledby="bv-hyp-title" data-ui-pattern="panel">
              <header class="bv-card-head">
                <div>
                  <h2 id="bv-hyp-title">Hypothèses de projection</h2>
                  <p>Valeurs utilisées par la projection. Elles restent des hypothèses ; elles se règlent dans « Ajuster les hypothèses ».</p>
                </div>
                <span class="status-pill">Estimation</span>
              </header>
              <table class="bv-inflation">
                <thead>
                  <tr><th scope="col">Hypothèse</th><th scope="col">Valeur</th><th scope="col">Source</th></tr>
                </thead>
                <tbody>
                  <tr><td>Horizon</td><td>{{ pr.hypotheses.horizonYears }} ans</td><td></td></tr>
                  <tr>
                    <td>Rendement annuel</td>
                    <td>@if (pr.hypotheses.ratePct === null) { Hypothèse manquante } @else { {{ pr.hypotheses.ratePct | pct }} }</td>
                    <td></td>
                  </tr>
                  <tr><td>Inflation par année</td><td>{{ pr.hypotheses.inflationPct | pct }}</td><td>{{ pr.hypotheses.inflationSource }}</td></tr>
                  <tr><td>Apport par période</td><td>{{ pr.hypotheses.contributionCents | signedCents }} {{ cadenceLabel(pr.hypotheses.cadence) }}</td><td>{{ pr.hypotheses.contributionSource }}</td></tr>
                  <tr>
                    <td>Stock de départ</td>
                    @if (pr.hypotheses.startCents === null) {
                      <td>À renseigner</td><td>{{ pr.hypotheses.stockReason }}</td>
                    } @else {
                      <td>{{ pr.hypotheses.startCents | signedCents }}</td><td>Stock enregistré</td>
                    }
                  </tr>
                </tbody>
              </table>
            </section>

            <!-- Comparaison des apports : l'apport retenu face au réel. -->
            <section class="bv-card" aria-labelledby="bv-cmp-title" data-ui-pattern="panel">
              <header class="bv-card-head">
                <div>
                  <h2 id="bv-cmp-title">L’apport retenu face au réel</h2>
                  <p>Mêmes horizon, rendement, inflation, stock de départ et objectifs ; seul l’apport change.</p>
                </div>
                <span class="status-pill">Estimation</span>
              </header>
              @if (pr.status !== 'estimate') {
                <p class="bpm-missing">Comparaison non calculable : la projection de base n’est pas disponible ({{ pr.status === 'unknown' ? 'stock à renseigner' : 'hypothèse manquante' }}).</p>
              } @else if (pr.comparison?.keyFigures && pr.comparison?.rows) {
                <div class="bv-reality" [attr.data-state]="cmpWarning() ? 'warning' : 'ok'">
                  <p>
                    {{ pr.comparison!.label }} sur {{ pr.comparison!.closures }} clôtures : {{ pr.comparison!.contributionCents ?? null | signedCents }} par mois ·
                    patrimoine en {{ lastYear() }} : {{ pr.comparison!.keyFigures?.nominalAtHorizonCents ?? null | signedCents }}.
                  </p>
                </div>
                <table class="bv-reality-table">
                  <thead>
                    <tr><th scope="col">Scénario</th><th scope="col">Apport</th><th scope="col">Nominal en {{ lastYear() }}</th><th scope="col">Euros d’aujourd’hui</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">Scénario retenu ({{ pr.hypotheses.contributionSource }})</th>
                      <td>{{ pr.hypotheses.contributionCents | signedCents }} {{ cadenceLabel(pr.hypotheses.cadence) }}</td>
                      <td>{{ pr.keyFigures?.nominalAtHorizonCents ?? null | signedCents }}</td>
                      <td>{{ pr.keyFigures?.realAtHorizonCents ?? null | signedCents }}</td>
                    </tr>
                    <tr>
                      <th scope="row">{{ pr.comparison!.label }} ({{ pr.comparison!.closures }} clôtures)</th>
                      <td>{{ pr.comparison!.contributionCents ?? null | signedCents }} par mois</td>
                      <td>{{ pr.comparison!.keyFigures?.nominalAtHorizonCents ?? null | signedCents }}</td>
                      <td>{{ pr.comparison!.keyFigures?.realAtHorizonCents ?? null | signedCents }}</td>
                    </tr>
                  </tbody>
                </table>
                <bpm-series-chart title="Patrimoine nominal selon l’apport" categoryLabel="Année" [categories]="projCategories()" [series]="cmpSeries()" [formats]="['lines']" initialFormat="lines" [height]="200" />
              } @else {
                <p class="bpm-missing">{{ pr.comparison?.reason ?? 'Comparaison indisponible.' }} ({{ closureCountText() }})</p>
              }
            </section>

            @if (pr.status === 'estimate' && pr.keyFigures) {
              <!-- Projection annuelle -->
              <section class="bv-card" data-bpm-frame="chart" aria-labelledby="bv-chart-title" data-ui-pattern="panel">
                <header class="bv-card-head">
                  <h2 id="bv-chart-title">Votre patrimoine au fil des années</h2>
                  <span class="status-pill">Estimation</span>
                </header>
                <bpm-series-chart
                  title="Patrimoine nominal et en euros d’aujourd’hui"
                  categoryLabel="Année"
                  [categories]="projCategories()"
                  [series]="projSeries()"
                  [formats]="['lines', 'area']"
                  initialFormat="lines"
                  [markers]="markers()"
                  [height]="260"
                />
                @if (markers().length) {
                  <div class="bv-legend">
                    <span class="bv-axis">◆ repères d’objectifs : @for (m of markers(); track m.index + m.label; let last = $last) { {{ m.label }}{{ last ? '' : ' · ' }} }</span>
                  </div>
                }
                <details class="bpm-disclosure">
                  <summary>Tableau détaillé et convention de calcul</summary>
                  <div class="bpm-disclosure-body">
                    <table class="bv-inflation">
                      <thead><tr><th scope="col">Année</th><th scope="col">Nominal</th><th scope="col">Euros d’aujourd’hui</th><th scope="col">Indice des prix</th><th scope="col">Part réservée</th></tr></thead>
                      <tbody>
                        @for (r of pr.rows; track r.year) {
                          <tr><td>{{ r.year }}</td><td>{{ r.nominalCents | signedCents }}</td><td>{{ r.realCents | signedCents }}</td><td>{{ r.priceIndex }}</td><td>{{ r.reservedCents | cents }}</td></tr>
                        }
                      </tbody>
                    </table>
                    <p class="bpm-help">Chaque année : rendement sur le capital de l’année précédente, puis apport annuel ({{ pr.annualContributionCents ?? null | signedCents }}), puis objectifs de l’année. Les objectifs de l’année de départ sont traités avant le premier rendement. Simulation : aucun paiement ni aucune valorisation n’est enregistré ; un stock négatif n’est pas ramené à zéro.</p>
                  </div>
                </details>
              </section>
            }
          }

          <!-- Objectifs de vie -->
          <section class="bv-card" id="objectifs" aria-labelledby="bv-goals-title" data-ui-pattern="panel">
            <header class="bv-card-head">
              <div>
                <h2 id="bv-goals-title">Vos objectifs de vie</h2>
                <p>Montants en euros d’aujourd’hui. Études, achat et autre consomment le capital ; retraite, sécurité et transmission en réservent une part.</p>
              </div>
              <button type="button" class="btn btn-primary" (click)="openGoal(null)">+ Ajouter un objectif</button>
            </header>
            <bpm-state [loading]="goals.loading() && !goals.data()" [error]="goals.error()" (retry)="goals.reload()" [empty]="!!goals.data() && !goals.data()!.length" emptyText="Aucun objectif daté pour le moment.">
              <button type="button" class="btn btn-primary" (click)="openGoal(null)">Ajouter un premier objectif</button>
            </bpm-state>
            @if (goalRows().length) {
              <bpm-goal-coverage [rows]="goalRows()" [editable]="true" (edit)="openGoal($event)" />
              @if (projection.data() && projection.data()!.status !== 'estimate') {
                <p class="bpm-help">Couverture non calculable tant que la projection n’est pas disponible (voir les hypothèses).</p>
              }
            }
            <p class="bpm-help">Les objectifs de projection sont distincts des projets de la vie budgétisés : ajouter un objectif daté ne crée ni Budget, ni tâche, ni paiement.</p>
          </section>

          <!-- Répartition patrimoniale : contrat absent. -->
          <section class="bv-card" aria-labelledby="bv-alloc-title" data-ui-pattern="panel">
            <h2 id="bv-alloc-title">Votre patrimoine par usage</h2>
            <p class="bpm-missing">Non calculable : le Patrimoine n’expose pas d’allocations (choix métier ouvert). Aucun graphe de répartition, versement entre actifs ou changement de phase n’est proposé tant que ce modèle n’est pas retenu.</p>
          </section>
        </section>

        <!-- 02 · Agir : les gestes qui modifient la vision, une fois l'état des lieux lu. -->
        <section data-ui-pattern="panel cockpit" data-cockpit-phase="act" id="agir" aria-label="Ajuster vos objectifs">
          <h2 class="cockpit-heading" data-ui-pattern="section-heading">
            <span class="cockpit-index" aria-hidden="true">02</span><span class="cockpit-title">Ajuster vos objectifs</span>
          </h2>
          <p class="cockpit-lead">Objectifs de vie et hypothèses de projection.</p>

          <section class="bv-card" aria-labelledby="bv-manage-title" data-ui-pattern="panel">
            <header class="bv-card-head">
              <div>
                <h2 id="bv-manage-title">Gérer mes objectifs</h2>
                <p>Définissez un montant et une date pour chaque objectif. La projection s’adapte, sans mouvement d’argent.</p>
              </div>
              <button type="button" class="btn btn-primary" (click)="openGoal(null)">+ Ajouter un objectif</button>
            </header>
            @if (removeError()) { <p class="bpm-error" role="alert">{{ removeError() }}</p> }
            @if (goalRows().length) {
              <details class="bpm-disclosure">
                <summary>Gérer ou retirer un objectif · {{ goalRows().length }}</summary>
                <ul class="bv-manage bpm-disclosure-body">
                  @for (r of goalRows(); track r.goal.id) {
                    <li>
                      <span><strong>{{ r.goal.label }}</strong> · {{ r.typeLabel }} · {{ r.goal.date | shortDate }} · {{ r.goal.targetTodayCents | cents }}</span>
                      <span class="bv-goal-actions">
                        <button type="button" class="btn btn-secondary" (click)="openGoal(r.goal)" [attr.aria-label]="'Modifier l’objectif ' + r.goal.label">Modifier</button>
                        <button type="button" class="btn btn-secondary" (click)="confirmGoal.set(r.goal)" [attr.aria-label]="'Retirer l’objectif ' + r.goal.label">Retirer</button>
                      </span>
                    </li>
                  }
                </ul>
              </details>
            }
            <rjs-modal [headed]="true" [open]="!!confirmGoal()" title="Retirer cet objectif ?" [busy]="removing()" (closed)="confirmGoal.set(null)">
              <section class="bv-form">
                <strong>{{ confirmGoal()?.label }}</strong>
                <p>L’objectif est retiré des projections et conservé dans l’historique. La projection est recalculée ; aucun actif ni aucune opération n’est modifié.</p>
                @if (removeError()) { <p class="bpm-error" role="alert">{{ removeError() }}</p> }
                <div class="bpm-actions">
                  <button autofocus type="button" class="btn btn-secondary" [disabled]="removing()" (click)="confirmGoal.set(null)">Annuler</button>
                  <button type="button" class="btn btn-primary" [disabled]="removing()" (click)="removeGoal(confirmGoal()!)">Retirer</button>
                </div>
              </section>
            </rjs-modal>
          </section>

          <!-- Hypothèses : formulaire replié. -->
          <details class="bpm-disclosure bv-card" id="hypotheses" [open]="hypOpen()" (toggle)="hypOpen.set($any($event.target).open)">
            <summary>Ajuster les hypothèses de projection</summary>
            <div class="bpm-disclosure-body">
              @if (profile.error(); as e) {
                <p class="bpm-error" role="alert">{{ e.message }} <button type="button" class="btn btn-secondary" (click)="profile.reload()">Réessayer</button></p>
              }
              @if (hypError(); as e) {
                <div class="bpm-error" role="alert">
                  {{ e.message }}
                  @if (e.isConflict) {
                    <p>Les hypothèses ont changé ailleurs ; votre saisie est conservée. <button type="button" class="btn btn-secondary" (click)="rereadHyp()">Relire la version enregistrée</button></p>
                  } @else {
                    <p>Rien n'a été enregistré ; votre saisie est conservée.</p>
                  }
                </div>
              }
              <form class="bv-return" (ngSubmit)="saveHyp()" (input)="hypDirty.set(true)" (change)="hypDirty.set(true)" novalidate>
                <div class="bv-split">
                  <section class="bv-card" aria-labelledby="bv-return-title" data-ui-pattern="panel">
                    <h2 id="bv-return-title">Hypothèse de rendement</h2>
                    <p>Taux annuel utilisé dans la projection, avant inflation, sur l’horizon choisi.</p>
                    <div class="bv-fields">
                      <label>
                        Horizon (années)
                        <input name="horizon" inputmode="numeric" [(ngModel)]="hHorizon" [attr.aria-invalid]="hypErr('horizonYears') ? 'true' : null" />
                        @if (hypErr('horizonYears')) { <span class="bpm-error">{{ hypErr('horizonYears') }}</span> }
                      </label>
                      <label>
                        Rendement annuel (%)
                        <input name="rate" inputmode="decimal" [(ngModel)]="hRate" [attr.aria-invalid]="hypErr('annualReturnPct') ? 'true' : null" />
                        @if (hypErr('annualReturnPct')) { <span class="bpm-error">{{ hypErr('annualReturnPct') }}</span> }
                      </label>
                    </div>
                    <p class="bpm-help">Rendement vide = hypothèse manquante (aucune projection).</p>
                  </section>
                  <section class="bv-card" aria-labelledby="bv-inflation-form-title" data-ui-pattern="panel">
                    <h2 id="bv-inflation-form-title">Ajuster l’inflation</h2>
                    <p>Ce taux ajuste le coût futur des objectifs et le pouvoir d’achat du patrimoine.</p>
                    <div class="bv-fields">
                      <label>
                        Inflation par année (%)
                        <input name="inflation" inputmode="decimal" [(ngModel)]="hInflation" [attr.aria-invalid]="hypErr('inflationPct') ? 'true' : null" />
                        @if (hypErr('inflationPct')) { <span class="bpm-error">{{ hypErr('inflationPct') }}</span> }
                      </label>
                      <label>
                        Source de l'inflation
                        <input name="inflationSource" [(ngModel)]="hInflationSource" maxlength="200" />
                      </label>
                    </div>
                  </section>
                  <section class="bv-card" aria-labelledby="bv-contrib-title" data-ui-pattern="panel">
                    <h2 id="bv-contrib-title">Apport et épargne</h2>
                    <p>L’apport alimente la projection à chaque période ; l’épargne visée reste facultative.</p>
                    <div class="bv-fields">
                      <label>
                        Apport par période (€)
                        <input name="contribution" inputmode="decimal" [(ngModel)]="hContribution" [attr.aria-invalid]="hypErr('contribution') ? 'true' : null" />
                        @if (hypErr('contribution')) { <span class="bpm-error">{{ hypErr('contribution') }}</span> }
                      </label>
                      <label>
                        Rythme de l'apport
                        <select name="cadence" [(ngModel)]="hCadence">
                          <option value="weekly">Par semaine (× 52)</option>
                          <option value="monthly">Par mois (× 12)</option>
                          <option value="yearly">Par an (× 1)</option>
                        </select>
                      </label>
                      <label>
                        Épargne visée par période (€)
                        <input name="savings" inputmode="decimal" [(ngModel)]="hSavings" [attr.aria-invalid]="hypErr('savingsTarget') ? 'true' : null" />
                        @if (hypErr('savingsTarget')) { <span class="bpm-error">{{ hypErr('savingsTarget') }}</span> }
                      </label>
                    </div>
                    <p class="bpm-help">Apport vide = moyenne mensuelle du budget type.</p>
                  </section>
                </div>
                <div class="bpm-actions">
                  <button type="submit" class="btn btn-primary" [disabled]="hypBusy() || !profile.data()">{{ hypBusy() ? 'Enregistrement…' : 'Enregistrer les hypothèses' }}</button>
                  @if (hypDirty()) { <span class="bpm-help">Modifications non enregistrées.</span> }
                </div>
              </form>
            </div>
          </details>
        </section>

        <p class="bpm-help">Ces calculs simulent un scénario ; ils n’écrivent aucun paiement ni aucune valorisation réelle. Les objectifs de projection ne créent ni Budget, ni tâche, ni paiement.</p>
      </div>

      @if (editing(); as ed) {
        <bpm-goal-editor [goal]="ed.goal" [types]="goalTypes()" (closed)="editing.set(null)" (saved)="goalSaved($event)" />
      }
    </bpm-page>
  `,
})
export class BpmVisionPage {
  protected readonly ctx = inject(BpmPageContext);
  private readonly bpm = inject(BpmApi);
  private readonly refresh = inject(BpmRefresh);

  // ---------- lectures ----------
  protected summary = bpmLoader(() => 0, () => this.bpm.summary());
  protected profile = bpmLoader(() => 0, () => this.bpm.setupProfile());
  protected projection = bpmLoader(() => 0, () => this.bpm.projection());
  protected goals = bpmLoader(() => 0, () => this.bpm.goals());
  protected directives = bpmLoader(() => 0, () => this.bpm.directives());

  protected message = signal<string | null>(null);
  protected vision = computed<Vision | null>(() => this.profile.data()?.principal.vision ?? null);
  protected goalTypes = computed<GoalTypeOption[]>(() => this.profile.data()?.goalTypes ?? DEFAULT_TYPES);

  protected cadenceLabel = (c: ContribCadence) => CADENCE_LABEL[c] ?? c;
  protected typeLabel = (t: GoalType) => this.goalTypes().find((x) => x.key === t)?.label ?? t;

  // ---------- projection ----------
  protected lastYear = computed(() => this.projection.data()?.rows.at(-1)?.year ?? '');
  protected projCategories = computed(() => (this.projection.data()?.rows ?? []).map((r) => String(r.year)));
  protected projSeries = computed<ChartSeries[]>(() => {
    const rows = this.projection.data()?.rows ?? [];
    return [
      { key: 'nominal', label: 'Nominal', color: 'var(--s-nominal)', values: rows.map((r) => r.nominalCents), kind: 'line' },
      { key: 'real', label: 'En euros d’aujourd’hui', color: 'var(--s-real)', values: rows.map((r) => r.realCents), kind: 'line', dashed: true },
    ];
  });
  protected markers = computed(() => {
    const rows = this.projection.data()?.rows ?? [];
    return (this.projection.data()?.goals ?? [])
      .filter((g) => g.status !== 'outOfHorizon' && g.status !== 'unknown')
      .map((g) => ({ index: rows.findIndex((r) => r.year === (g.year ?? Number(g.date.slice(0, 4)))), label: `${g.label} (${g.date.slice(0, 4)})`, short: '◆' }))
      .filter((m) => m.index >= 0);
  });
  protected cmpSeries = computed<ChartSeries[]>(() => {
    const p = this.projection.data();
    const alt = p?.comparison?.rows ?? [];
    return [
      { key: 'retained', label: 'Scénario retenu', color: 'var(--s-nominal)', values: (p?.rows ?? []).map((r) => r.nominalCents), kind: 'line' },
      { key: 'average', label: 'Moyenne réelle des clôtures', color: 'var(--s-expected)', values: (p?.rows ?? []).map((r) => alt.find((a) => a.year === r.year)?.nominalCents ?? null), kind: 'line', dashed: true },
    ];
  });
  /** Apport par période retenu, lisible dans la carte de l'objectif budgétaire. */
  protected contributionText = computed(() => {
    const h = this.projection.data()?.hypotheses;
    return h ? `${signedCents(h.contributionCents)} ${this.cadenceLabel(h.cadence)}` : '…';
  });
  /** La moyenne réelle des clôtures mène à un patrimoine inférieur au scénario retenu. */
  protected cmpWarning = computed(() => {
    const p = this.projection.data();
    const alt = p?.comparison?.keyFigures?.nominalAtHorizonCents;
    const base = p?.keyFigures?.nominalAtHorizonCents;
    return alt !== undefined && base !== undefined && alt < base;
  });
  /** Chiffres clés de la projection (`rjs-metric-tiles`) : inconnu ≠ zéro, la raison est donnée. */
  protected tiles = computed<MetricTile[]>(() => {
    const pr = this.projection.data();
    const kf = pr?.status === 'estimate' ? (pr.keyFigures ?? null) : null;
    const why = pr?.status === 'missing-hypothesis' ? 'Non calculable : hypothèse de rendement manquante.' : pr?.status === 'unknown' ? 'Non calculable : stock de départ à renseigner.' : 'Non calculable.';
    const sign = (c: number) => (c > 0 ? 'success' : c < 0 ? 'danger' : null);
    const unknown = 'Inconnu';
    return [
      { id: 'final', label: `Patrimoine nominal${this.lastYear() ? ' en ' + this.lastYear() : ''}`, value: kf ? signedCents(kf.nominalAtHorizonCents) : unknown, tone: kf ? sign(kf.nominalAtHorizonCents) : null, emphasis: true, note: kf ? 'Estimation avec l’apport et le rendement retenus.' : why },
      { id: 'real', label: 'En euros d’aujourd’hui', value: kf ? signedCents(kf.realAtHorizonCents) : unknown, tone: kf ? sign(kf.realAtHorizonCents) : null, note: kf ? 'Valeur nominale ÷ indice des prix de l’horizon.' : why },
      { id: 'realReturn', label: 'Rendement réel', value: kf ? percentText(kf.realReturnPct, 2) : unknown, tone: kf ? (kf.realReturnPct < 0 ? 'danger' : 'success') : null, note: kf ? '(1 + rendement) ÷ (1 + inflation) − 1' : why },
      { id: 'erosion', label: 'Érosion sans rendement', value: kf ? signedCents(kf.erosionWithoutReturnCents === 0 ? 0 : -kf.erosionWithoutReturnCents) : unknown, tone: kf && kf.erosionWithoutReturnCents ? 'warning' : null, note: kf ? 'Pouvoir d’achat perdu par le stock de départ s’il ne rapportait rien.' : why },
    ];
  });
  protected closureCountText = computed(() => {
    const n = this.projection.data()?.comparison?.closures;
    return n === undefined ? 'moins de deux clôtures enregistrées' : `${n} clôture(s)`;
  });

  // ---------- objectifs ----------
  protected goalRows = computed<GoalRow[]>(() => {
    const cov = new Map((this.projection.data()?.goals ?? []).map((g) => [g.goalId, g]));
    return (this.goals.data() ?? []).map((goal) => {
      const c = cov.get(goal.id) ?? null;
      return { goal, typeLabel: goal.typeLabel ?? this.typeLabel(goal.type), cov: c, status: (c?.status ?? 'unknown') as GoalCoverage['status'] };
    });
  });
  protected editing = signal<{ goal: LifeGoal | null } | null>(null);
  /** Objectif dont le retrait attend confirmation (fenêtre `rjs-modal`). */
  protected confirmGoal = signal<LifeGoal | null>(null);
  protected removing = signal(false);
  protected removeError = signal<string | null>(null);

  protected openGoal(goal: LifeGoal | null) {
    this.message.set(null);
    this.editing.set({ goal });
  }
  protected goalSaved(text: string) {
    this.editing.set(null);
    this.message.set(text);
  }
  protected async removeGoal(goal: LifeGoal) {
    this.removing.set(true);
    this.removeError.set(null);
    try {
      await this.bpm.removeGoal(goal.id, goal.revision);
      this.confirmGoal.set(null);
      this.message.set(`Objectif « ${goal.label} » retiré des projections (conservé dans l’historique).`);
      this.refresh.bump();
    } catch (e) {
      this.removeError.set(toApiError(e).message);
    } finally {
      this.removing.set(false);
    }
  }

  // ---------- formulaire des hypothèses ----------
  protected hypOpen = signal(false);
  protected hypDirty = signal(false);
  protected hypBusy = signal(false);
  protected hypError = signal<ApiError | null>(null);
  private hypLocal = signal<{ field: string; message: string } | null>(null);
  protected hHorizon = signal('');
  protected hRate = signal('');
  protected hInflation = signal('');
  protected hInflationSource = signal('');
  protected hContribution = signal('');
  protected hCadence = signal<ContribCadence>('monthly');
  protected hSavings = signal('');

  constructor() {
    // Brouillons initialisés depuis la version enregistrée, sans écraser une saisie en cours.
    effect(() => {
      const v = this.vision();
      if (!v || untracked(this.hypDirty)) return;
      untracked(() => this.fillHyp(v));
    });
  }

  private fillHyp(v: Vision) {
    this.hHorizon.set(String(v.horizonYears));
    this.hRate.set(v.annualReturnPct === null ? '' : String(v.annualReturnPct).replace('.', ','));
    this.hInflation.set(String(v.inflationPct).replace('.', ','));
    this.hInflationSource.set(v.inflationSource);
    this.hContribution.set(euroText(v.contributionCents));
    this.hCadence.set(v.contributionCadence);
    this.hSavings.set(euroText(v.savingsTargetCents));
  }

  protected openHyp() {
    this.hypOpen.set(true);
  }
  protected rereadHyp() {
    this.hypDirty.set(false);
    this.hypError.set(null);
    this.profile.reload();
  }
  protected hypErr(field: string) {
    const l = this.hypLocal();
    if (l && l.field === field) return l.message;
    const e = this.hypError();
    return e && e.body.details?.['field'] === field ? e.message : null;
  }

  protected async saveHyp() {
    const p = this.profile.data();
    if (!p) return;
    this.hypLocal.set(null);
    const horizon = num(this.hHorizon());
    const rate = num(this.hRate());
    const inflation = num(this.hInflation());
    const contribution = parseAmount(this.hContribution());
    const savings = parseAmount(this.hSavings());
    const bad = (field: string, message: string) => this.hypLocal.set({ field, message });
    if (horizon === null || !Number.isInteger(horizon) || horizon < 1 || horizon > 80) return bad('horizonYears', 'Nombre entier d’années entre 1 et 80.');
    if (rate !== null && (!Number.isFinite(rate) || rate < -50 || rate > 50)) return bad('annualReturnPct', 'Pourcentage entre −50 et 50, ou vide.');
    if (inflation === null || !Number.isFinite(inflation) || inflation < -20 || inflation > 50) return bad('inflationPct', 'Pourcentage entre −20 et 50.');
    if (contribution === 'invalid') return bad('contribution', 'Montant en euros attendu, ou vide.');
    if (savings === 'invalid' || (typeof savings === 'number' && savings < 0)) return bad('savingsTarget', 'Montant positif en euros attendu, ou vide.');
    this.hypBusy.set(true);
    this.hypError.set(null);
    try {
      const r = await this.bpm.updateVision({
        expectedRevision: p.principal.revision,
        horizonYears: horizon,
        annualReturnPct: rate,
        inflationPct: inflation,
        inflationSource: this.hInflationSource().trim(),
        contribution,
        contributionCadence: this.hCadence(),
        savingsTarget: savings,
      });
      this.hypDirty.set(false);
      this.hypOpen.set(false);
      this.message.set(`Hypothèses enregistrées (révision ${r.revision}). La projection est recalculée.`);
      this.refresh.bump();
    } catch (e) {
      this.hypError.set(toApiError(e));
    } finally {
      this.hypBusy.set(false);
    }
  }
}
