import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { BpmApi } from '../../core/bpm-api.service';
import { DirectiveItem, GoalType, HistoryRow, Recurrence } from '../../core/bpm-models';
import {
  CentsPipe,
  PercentPipe,
  ShortDatePipe,
  SignedCentsPipe,
  cents,
  percentText,
  shortDate,
  signedCents,
} from '../../core/format';
import { MetricTile, MetricTilesComponent } from '../../shared/metric-tiles.component';
import {
  BpmCapChart,
  BpmPageContext,
  BpmPageFocus,
  BpmPageFrame,
  BpmProgress,
  BpmState,
  CapRow,
  bpmLoader,
} from '../ui';
import { BpmFlowLink, BpmImpactChart, FlowMeasure } from './pilot-charts';

const WINDOWS = [6, 12, 24];
const GOAL_LABEL: Record<GoalType, string> = {
  etudes: 'Études',
  retraite: 'Retraite',
  achat: 'Achat',
  securite: 'Sécurité',
  transmission: 'Transmission',
  autre: 'Autre',
};
const DAY = 86400000;

interface ZoomRow {
  label: string;
  cents: number | null;
  signed: boolean;
  unit: string;
  source: string;
  reason: string | null;
  /** Détail ouvert depuis la tuile du repère. */
  link: string | null;
  query: Record<string, string> | null;
}

interface AnalysisPoint {
  key: string;
  title: string;
  detail: string;
  action: string;
  link: string[];
  fragment?: string;
  tone: 'warning' | 'danger' | 'info';
}

/**
 * Graphiques et chiffres (/piloter), sur la lecture « analyse » du pilotage de la référence (`bpm-pilot.page`) :
 * synthèse des flux et passage au patrimoine, zoom sur le projet de vie, résultat réalisé et prévu par période,
 * charges par poste, entrées par source, dépenses à anticiper, budget type, épargne et clôtures.
 * Lecture seule : chaque bloc est alimenté par un contrat de lecture réel et mène à son détail.
 */
@Component({
  selector: 'bpm-page-pilot',
  providers: [BpmPageContext],
  imports: [
    FormsModule,
    RouterLink,
    BpmPageFrame,
    BpmState,
    BpmCapChart,
    BpmProgress,
    BpmFlowLink,
    BpmImpactChart,
    MetricTilesComponent,
    CentsPipe,
    SignedCentsPipe,
    PercentPipe,
    ShortDatePipe,
  ],
  styleUrls: [
    '../ref-styles/bpm-pages.scss',
    '../ref-styles/bpm-vision.page.scss',
    '../ref-styles/bpm-pilot-charts.scss',
    '../ref-styles/bpm-flow-pilot.component.scss',
  ],
  template: `
    <bpm-page
      title="Graphiques et chiffres"
      lead="Ce qui est réalisé, ce qui est prévu."
      pageClass="bpm-vision bpm-analysis"
      [context]="summary.data()?.context"
      [periodKey]="ctx.period()"
      [periodNav]="true"
      [focus]="focus()"
      [scope]="readingScope()"
      [result]="summary.error() ? { message: summary.error()!.message, tone: 'danger' } : null"
      toolsLabel="Diagnostic de la période"
      (periodChange)="ctx.setQuery({ period: $event })"
    >
      <ng-container primary>
        @if (analysisPoint(); as point) {
          <a
            class="app-hero-action"
            [routerLink]="point.link"
            [queryParams]="ctx.carry()"
            [fragment]="point.fragment"
            >{{ point.action }} →</a
          >
        } @else {
          <button
            type="button"
            class="app-hero-action"
            (click)="refreshAnalysis()"
            [disabled]="summary.loading() || centers.loading()"
          >
            Relire la période
          </button>
        }
      </ng-container>
      @if (summary.data() && !summary.data()!.closed) {
        <a
          actions
          class="btn btn-secondary"
          routerLink="/depenses/registre"
          [queryParams]="{ period: ctx.period(), entry: 'new', direction: 'all' }"
          >＋ Saisir une entrée ou une dépense</a
        >
      }
      @if (analysisPoint()) {
        <button
          actions
          type="button"
          class="btn btn-secondary"
          (click)="refreshAnalysis()"
          [disabled]="summary.loading() || centers.loading()"
        >
          Relire la période
        </button>
      }

      <div tools class="bpm-toolbar-shortcuts">
        @if (analysisPoints().length) {
          <label
            >Point à examiner
            <select [ngModel]="analysisPoint()?.key" (ngModelChange)="analysisKey.set($event)">
              @for (point of analysisPoints(); track point.key) {
                <option [value]="point.key">{{ point.title }}</option>
              }
            </select>
          </label>
        }
        <label
          >Historique comparé
          <select
            [ngModel]="win()"
            (ngModelChange)="ctx.setQuery({ fenetre: +$event, avant: null })"
          >
            @for (window of windows; track window) {
              <option [value]="window">{{ window }} périodes</option>
            }
          </select>
        </label>
        @if (summary.data()?.closed) {
          <a [routerLink]="[]" queryParamsHandling="preserve" fragment="bp-history-title"
            >Voir le versement au patrimoine</a
          >
        }
      </div>

      <div class="bpm-vision bpm-analysis" data-tone="budget">
        <!-- Synthèse des flux (rjs-bpm-flow-pilot de la référence) : deux résultats dominants, le patrimoine, puis les graphes. -->
        <section class="fp-overview" aria-labelledby="fp-title">
          <div class="fp-summary" data-bpm-frame="metrics">
            <div class="fp-heading">
              <div>
                <h2 id="fp-title">Votre résultat de la période</h2>
                <p>
                  Le budget du projet de vie et son effet sur le patrimoine.
                  @if (summary.data()?.closed) {
                    <span class="chip recorded">Enregistré à la clôture</span>
                  }
                </p>
              </div>
            </div>
            <bpm-state
              [loading]="summary.loading() && !summary.data()"
              [error]="summary.error()"
              (retry)="summary.reload()"
            />
            @if (summary.data()) {
              <div class="fp-results">
                <article class="fp-result-card">
                  <span class="fp-result-badge">Aujourd’hui</span>
                  <h3>Solde à ce jour</h3>
                  <strong
                    class="fp-result-amount"
                    [attr.data-sign]="sign(fig('bpm.resultatPeriode'))"
                    >{{ fig('bpm.resultatPeriode') | signedCents }}</strong
                  >
                  @if (reason('bpm.resultatPeriode'); as r) {
                    <p class="bpm-help">Non calculable : {{ r }}</p>
                  }
                  <dl class="fp-result-detail">
                    <div>
                      <dt>
                        <span
                          class="flow-direction is-compact"
                          data-flow="income"
                          aria-hidden="true"
                          >↑</span
                        ><span>Reçu</span>
                      </dt>
                      <dd>{{ fig('bpm.revenus') | cents }}</dd>
                    </div>
                    <div>
                      <dt>
                        <span
                          class="flow-direction is-compact"
                          data-flow="expense"
                          aria-hidden="true"
                          >↓</span
                        ><span>Payé</span>
                      </dt>
                      <dd>{{ fig('bpm.charges') | cents }}</dd>
                    </div>
                  </dl>
                </article>
                <article class="fp-result-card is-forecast">
                  <span class="fp-result-badge">Fin de période</span>
                  <h3>Solde prévu en fin de période</h3>
                  <strong
                    class="fp-result-amount"
                    [attr.data-sign]="sign(fig('bpm.soldeAttendu'))"
                    >{{ fig('bpm.soldeAttendu') | signedCents }}</strong
                  >
                  @if (reason('bpm.soldeAttendu'); as r) {
                    <p class="bpm-help">Non calculable : {{ r }}</p>
                  }
                  <dl class="fp-result-detail">
                    <div>
                      <dt>
                        <span
                          class="flow-direction is-compact"
                          data-flow="income"
                          aria-hidden="true"
                          >↑</span
                        ><span>À recevoir</span>
                      </dt>
                      <dd>{{ fig('bpm.resteARecevoir') | cents }}</dd>
                    </div>
                    <div>
                      <dt>
                        <span
                          class="flow-direction is-compact"
                          data-flow="expense"
                          aria-hidden="true"
                          >↓</span
                        ><span>À payer</span>
                      </dt>
                      <dd>{{ fig('bpm.resteAPayer') | cents }}</dd>
                    </div>
                  </dl>
                </article>
              </div>

              <!-- Du budget au patrimoine : stock enregistré + effet de la période = estimation après la période. -->
              <section class="fp-card fp-goal" aria-labelledby="fp-goal">
                <div class="fp-heading">
                  <h3 id="fp-goal">Du budget au patrimoine</h3>
                  @if (summary.data()!.context.period; as p) {
                    <span>Estimation au {{ p.end | shortDate }}</span>
                  }
                </div>
                @let stock = fig('bpm.patrimoineConstitue');
                @let periodEffect = fig('bpm.resultatPeriode');
                @let after = fig('bpm.patrimoineFinPeriode');
                @if (stock !== null && periodEffect !== null) {
                  <div class="fp-stock-equation">
                    <dl class="fp-stock-step is-current">
                      <dt>Patrimoine actuel</dt>
                      <dd>{{ stock | cents }}</dd>
                      <small>Point de départ · enregistré</small>
                    </dl>
                    <span
                      class="fp-equation-sign"
                      [attr.data-sign]="periodEffect < 0 ? 'negative' : 'positive'"
                      aria-hidden="true"
                      >{{ periodEffect < 0 ? '−' : '+' }}</span
                    >
                    <dl
                      class="fp-stock-step is-contribution"
                      [attr.data-sign]="periodEffect < 0 ? 'negative' : 'positive'"
                    >
                      <dt>Effet de la période</dt>
                      <dd>{{ abs(periodEffect) }}</dd>
                    </dl>
                    <span class="fp-equation-sign" aria-hidden="true">=</span>
                    <dl class="fp-stock-step is-after">
                      <dt>Patrimoine après la période</dt>
                      <dd>{{ after | cents }}</dd>
                      <small>Prochaine étape · estimation</small>
                    </dl>
                  </div>
                } @else {
                  <dl class="fp-facts fp-past-facts">
                    <div class="fp-fact-result">
                      <dt>Patrimoine actuel</dt>
                      <dd>{{ stock === null ? 'À renseigner' : (stock | cents) }}</dd>
                    </div>
                    <div>
                      <dt>Patrimoine après la période</dt>
                      <dd>{{ after === null ? 'À renseigner' : (after | cents) }}</dd>
                    </div>
                  </dl>
                }
                <dl class="fp-stock-objective">
                  <div>
                    <dt>Atteinte de l’objectif</dt>
                    <dd>
                      {{
                        pctFig('bpm.progressionObjectif') === null
                          ? 'À renseigner'
                          : (pctFig('bpm.progressionObjectif') | pct)
                      }}
                    </dd>
                  </div>
                  <div>
                    <dt>Reste à constituer</dt>
                    <dd>
                      {{
                        fig('bpm.resteObjectif') === null
                          ? 'À renseigner'
                          : (fig('bpm.resteObjectif') | cents)
                      }}
                    </dd>
                  </div>
                </dl>
                <p>
                  Patrimoine après la période = patrimoine actuel + solde réalisé de la période ;
                  chaque clôture n’est comptée qu’une fois.
                  @if (initialBudget() !== null) {
                    Budget initial (référence distincte) :
                    <strong class="num">{{ initialBudget() | signedCents }}</strong
                    >.
                  }
                  <a [routerLink]="'/tableau-de-bord/rapprochement'" [queryParams]="ctx.carry()"
                    >Détail du solde →</a
                  >
                </p>
              </section>
            }
          </div>
          @if (summary.data()) {
            <div class="fp-charts">
              <section class="fp-card" data-bpm-frame="chart" aria-labelledby="fp-bridge">
                <h3 id="fp-bridge">Entrées − charges = solde</h3>
                <p>
                  Deux colonnes par ligne : le réalisé et le total prévu. Vert pour les entrées,
                  rouge pour les charges, violet pour le solde.
                </p>
                <bpm-flow-link title="Entrées − charges = solde" [measures]="flow()" />
              </section>
              <section class="fp-card" data-bpm-frame="chart" aria-labelledby="fp-projects">
                <h3 id="fp-projects">Charges par projet</h3>
                <p>
                  Du plus chargé au plus léger. Comparez les entrées et les charges de chaque projet
                  sur la même échelle.
                </p>
                <bpm-state
                  [loading]="impact.loading() && !impact.data()"
                  [error]="impact.error()"
                  (retry)="impact.reload()"
                  [empty]="!!impact.data() && !impact.data()!.rows.length"
                  emptyText="Aucun Budget à présenter."
                />
                @if (impact.data(); as im) {
                  @if (im.rows.length) {
                    <bpm-impact-chart [rows]="im.rows" />
                  }
                  <p class="bpm-missing" role="note">
                    <strong>Périmètre consolidé non défini.</strong> {{ im.consolidated.reason }}
                  </p>
                }
              </section>
            </div>
          }
        </section>

        <!-- 2. Zoom sur le projet de vie : les repères chiffrés. -->
        <header class="bp-scope-heading" id="bp-groupe-chiffres">
          <span class="bp-scope-icon" aria-hidden="true">◎</span>
          <div>
            <h2>Zoom sur votre projet de vie</h2>
            <p>
              Les chiffres ci-dessous portent sur votre budget quotidien. Vos autres projets
              figurent dans la synthèse au-dessus.
            </p>
          </div>
        </header>
        <section data-bpm-frame="metrics" aria-label="Repères du projet de vie">
          @if (tiles().length) {
            <rjs-metric-tiles
              variant="instrument"
              label="La période en chiffres"
              [tiles]="tiles()"
            />
            @if (directivesOtherPeriod()) {
              <p class="bpm-help">
                Les repères (épargne, plafond, disponible) portent sur la période courante ({{
                  directives.data()?.context?.period?.label
                }}), pas sur la période lue.
              </p>
            }
            <p class="bpm-help">
              <a routerLink="/vision/reperes" fragment="bp-dir-title"
                >Voir vos repères et leurs hypothèses →</a
              >
            </p>
          } @else {
            <bpm-state
              [loading]="summary.loading() || directives.loading()"
              [error]="summary.error() ?? directives.error()"
              (retry)="summary.reload(); directives.reload()"
            />
          }
        </section>

        <!-- 01 · État des lieux : ce qui s'est passé, puis ce qui vient. -->
        <section
          data-ui-pattern="panel cockpit"
          data-cockpit-phase="state"
          id="etat-des-lieux"
          aria-label="Graphiques et chiffres"
        >
          <h3 class="bp-group" id="bp-groupe-reel">
            Réalisé et prévu
            <small>Résultat, charges et entrées.</small>
          </h3>

          <!-- Résultat réalisé et prévu, période par période (même tracé que la référence). -->
          <section
            class="bv-card"
            data-bpm-frame="chart"
            aria-labelledby="bp-compare-title"
            data-ui-pattern="panel"
          >
            <h2 id="bp-compare-title">Résultat réalisé et prévu par période</h2>
            <div class="bpm-disclosure-body">
              <p>
                Au-dessus de zéro : excédent. En dessous : déficit. Barre pleine : réalisé · Contour
                : prévu.
              </p>
              <div class="bp-presets" role="group" aria-label="Fenêtre de périodes">
                @for (w of windows; track w) {
                  <button
                    type="button"
                    class="bp-chip"
                    [attr.aria-pressed]="win() === w"
                    (click)="ctx.setQuery({ fenetre: w === 12 ? null : w, avant: null })"
                  >
                    {{ w }} périodes
                  </button>
                }
              </div>
              <bpm-state
                [loading]="history.loading() && !history.data()"
                [error]="history.error()"
                (retry)="history.reload()"
                [empty]="!!history.data() && !history.data()!.rows.length"
                emptyText="Aucune période à présenter : cycle à configurer."
              />
              @if (history.data(); as h) {
                @if (h.rows.length) {
                  <div
                    class="bp-compare-scroll"
                    tabindex="0"
                    aria-label="Résultat réalisé et prévu par période"
                  >
                    <div class="bp-compare-stage" [style.--period-count]="bars().length">
                      <ol class="bp-compare-chart">
                        @for (bar of bars(); track bar.row.periodKey) {
                          <li
                            [attr.data-state]="bar.state"
                            [attr.aria-current]="bar.state === 'current' ? 'date' : null"
                          >
                            <span class="bp-compare-period"
                              >{{ bar.row.label }}{{ bar.row.recorded ? ' ✓' : '' }}</span
                            ><span class="bp-compare-bars" aria-hidden="true"
                              ><i class="bp-zero-label">0</i>
                              @if (bar.plannedCents !== null) {
                                <span
                                  class="is-planned"
                                  [attr.data-sign]="bar.plannedSign"
                                  [style.height.%]="bar.plannedPct / 2"
                                ></span>
                              }
                              @if (bar.state !== 'future' && bar.realCents !== null) {
                                <span
                                  class="is-real"
                                  [attr.data-sign]="bar.realSign"
                                  [style.height.%]="bar.realPct / 2"
                                ></span>
                              }
                            </span>
                            @if (bar.plannedCents !== null) {
                              <small>Prévu {{ bar.plannedCents | signedCents }}</small>
                            }
                            @if (bar.state !== 'future') {
                              <small>Réalisé {{ bar.realCents | signedCents }}</small>
                            }
                            @if (bar.gapCents) {
                              <small
                                class="bp-compare-gap"
                                [attr.data-sign]="bar.gapCents < 0 ? 'negative' : 'positive'"
                                >Écart {{ bar.gapCents | signedCents }}</small
                              >
                            }
                            @if (bar.state !== 'future') {
                              <a
                                class="bp-drill"
                                routerLink="/tableau-de-bord"
                                [queryParams]="{ period: bar.row.periodKey }"
                                [attr.aria-label]="'Ouvrir le relevé de ' + bar.row.label"
                                >Relevé →</a
                              >
                            }
                          </li>
                        }
                      </ol>
                      <svg
                        class="bp-history-overlay"
                        [attr.viewBox]="'0 0 ' + historyCurve().width + ' 200'"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <path class="bp-history-halo" [attr.d]="historyCurve().actual" />
                        <path class="bp-history-line" [attr.d]="historyCurve().actual" />
                        <path class="bp-history-halo" [attr.d]="historyCurve().forecast" />
                        <path
                          class="bp-history-line is-future"
                          [attr.d]="historyCurve().forecast"
                        />
                      </svg>
                    </div>
                  </div>
                  <p class="bp-compare-legend">
                    <span class="is-planned">Prévu</span>
                    <span class="is-real">Réalisé</span>
                    <span class="is-curve">Courbe : résultat réalisé</span>
                    @if (historyCurve().forecast) {
                      <span class="is-curve is-future">Prolongement : résultat prévu</span>
                    }
                    <span
                      >Les périodes closes présentent le résultat enregistré (✓) ; le prévu n’y est
                      plus recalculé.</span
                    >
                  </p>
                  <div class="bp-levers">
                    <button
                      type="button"
                      class="btn btn-secondary small"
                      [disabled]="h.nextBefore === null"
                      (click)="ctx.setQuery({ avant: h.nextBefore })"
                    >
                      ‹ Périodes plus anciennes
                    </button>
                    <span class="bpm-help"
                      >{{ h.rows.length }} période(s) affichée(s) sur {{ h.total }}</span
                    >
                    <button
                      type="button"
                      class="btn btn-secondary small"
                      [disabled]="!before()"
                      (click)="newer()"
                    >
                      Périodes plus récentes ›
                    </button>
                  </div>
                }
              }
            </div>
          </section>

          <!-- Charges par poste -->
          <section
            class="bv-card"
            data-bpm-frame="chart"
            aria-labelledby="bp-centers-title"
            data-ui-pattern="panel"
          >
            <h2 id="bp-centers-title">Charges par poste de la période</h2>
            <div class="bpm-disclosure-body">
              <bpm-state
                [loading]="centers.loading() && !centers.data()"
                [error]="centers.error()"
                (retry)="centers.reload()"
                [empty]="!!centers.data() && !centers.data()!.rows.length"
                emptyText="Aucune dépense réglée ni prévue pour l’instant."
              />
              @if (centers.data(); as c) {
                @if (c.rows.length) {
                  @if (capped().length) {
                    <p
                      class="bp-allowance-status"
                      [attr.data-state]="overCents() > 0 ? 'over' : 'ok'"
                    >
                      {{
                        overCents() > 0
                          ? 'Les dépenses prévues dépassent les plafonds de ' +
                            money(overCents()) +
                            ' : les plafonds par poste ci-dessous vous aident à ajuster les charges.'
                          : 'Les charges payées et à venir respectent les plafonds par poste.'
                      }}
                    </p>
                  }
                  <ul class="bp-centers bp-expense-centers">
                    @for (r of c.rows; track r.ref) {
                      <li>
                        <a
                          class="bp-drill-name"
                          [routerLink]="['/argent/postes', r.ref]"
                          [queryParams]="centerQuery()"
                          title="Voir le détail de ce poste"
                          >{{ r.label || 'Sans poste' }} <span aria-hidden="true">→</span></a
                        >
                        <strong
                          ><a routerLink="/depenses/registre" [queryParams]="expenseCenterQuery(r.ref)">{{
                            r.paidCents | cents
                          }}</a>
                          @if (r.remainingCents) {
                            <small>+ {{ r.remainingCents | cents }} à payer</small>
                          }
                          @if (r.capCents !== null) {
                            <small class="bp-allowance">· plafond {{ r.capCents | cents }}</small>
                          } @else {
                            <small>· sans plafond</small>
                          }
                          @if (r.marginCents !== null) {
                            <small [attr.data-sign]="r.marginCents < 0 ? 'negative' : 'positive'">{{
                              r.marginCents < 0
                                ? '· dépassement ' + abs(r.marginCents)
                                : '· marge ' + abs(r.marginCents)
                            }}</small>
                          }
                        </strong>
                        @if (r.sharePct !== null) {
                          <span
                            class="bp-share-note"
                            data-flow="expense"
                            [attr.title]="c.basis.label"
                            ><b>{{ r.sharePct | pct }}</b> de la base</span
                          >
                        }
                      </li>
                    }
                  </ul>
                  <bpm-cap-chart
                    title="Plafonds et marges par poste"
                    [rows]="capRows()"
                    (pick)="openCenter($event)"
                  />
                  <p class="bpm-help">
                    Montants réellement payés et restant à payer sur la période ; un plafond reste
                    un montant par période, jamais une moyenne appliquée aux paiements.
                  </p>
                }
              }
            </div>
          </section>

          <div class="bv-split">
            <!-- Entrées par source -->
            <section class="bv-card" aria-labelledby="bp-incomes-title" data-ui-pattern="panel">
              <h2 id="bp-incomes-title">Entrées par source de la période</h2>
              <div class="bpm-disclosure-body">
                <bpm-state
                  [loading]="incomes.loading() && !incomes.data()"
                  [error]="incomes.error()"
                  (retry)="incomes.reload()"
                  [empty]="!!incomes.data() && !incomes.data()!.sources.length"
                  emptyText="Aucune entrée reçue ni attendue sur la période."
                />
                @if (incomes.data(); as inc) {
                  @if (inc.sources.length) {
                    <ul class="bp-centers bp-income-centers">
                      @for (s of inc.sources; track s.ref) {
                        <li>
                          <a
                            class="bp-drill-name"
                            routerLink="/tableau-de-bord/entrees"
                            [queryParams]="ctx.carry()"
                            title="Voir le détail des entrées"
                            >{{ s.label }} <span aria-hidden="true">→</span></a
                          >
                          <strong
                            >{{ s.receivedCents | cents }}
                            @if (s.expectedCents) {
                              <small>+ {{ s.expectedCents | cents }} attendus</small>
                            }
                          </strong>
                          @if (s.sharePct !== null) {
                            <span class="bp-share-note" data-flow="income"
                              ><b>{{ s.sharePct | pct }}</b> du reçu</span
                            >
                          }
                        </li>
                      }
                    </ul>
                    <p class="bpm-help">
                      Reçu : par date réelle de règlement. Attendus : échéances de la période non
                      encore reçues.
                    </p>
                  }
                }
              </div>
            </section>

            <!-- Dépenses à anticiper : les objectifs datés à venir -->
            <section class="bv-card" aria-labelledby="bp-events-title" data-ui-pattern="panel">
              <h2 id="bp-events-title">Dépenses à anticiper</h2>
              <p>
                Vos objectifs datés à venir : leur coût à l’échéance et le montant indicatif à
                mettre de côté par période avant cette date.
              </p>
              <bpm-state
                [loading]="events.loading() && !events.data()"
                [error]="events.error()"
                (retry)="events.reload()"
                [empty]="!!events.data() && !events.data()!.rows.length"
                emptyText="Aucun objectif daté à venir."
              />
              @if (events.data(); as ev) {
                @if (ev.rows.length) {
                  <ul class="bp-pending">
                    @for (r of ev.rows; track r.goalId) {
                      <li data-sign="negative">
                        <span class="bp-pending-date">{{ r.date | shortDate }}</span>
                        <a routerLink="/vision" fragment="life-dated-goals"
                          ><strong>{{ r.label }}</strong></a
                        >
                        <span class="bp-pending-amount">−{{ r.futureCostCents | cents }}</span>
                        <small class="bp-provision">
                          {{ goalLabel(r.type) }} · {{ r.targetTodayCents | cents }} aujourd’hui ·
                          @if (r.provisionPerPeriodCents !== null) {
                            {{ r.provisionPerPeriodCents | cents }} par période ·
                            {{ r.periodsAvailable }} clôture(s) pour s’y préparer
                          } @else {
                            Non calculable : {{ r.reason }}
                          }
                        </small>
                      </li>
                    }
                  </ul>
                  @if (provisionTotal() !== null) {
                    <p class="bpm-help">
                      À mettre de côté : <strong>{{ provisionTotal() | cents }}</strong> par période
                      (indicatif).
                    </p>
                  }
                  <details>
                    <summary>Hypothèses</summary>
                    <ul class="bpm-help">
                      @for (a of ev.assumptions; track a) {
                        <li>{{ a }}</li>
                      }
                    </ul>
                    <p class="bpm-help">
                      Une provision indicative ne crée ni paiement ni allocation.
                    </p>
                  </details>
                }
              }
            </section>
          </div>

          <h3 class="bp-group" id="bp-groupe-avenir">
            <span aria-hidden="true">C</span>Budget type et patrimoine
            <small>Épargne, objectifs et clôtures.</small>
          </h3>

          <!-- Budget type : revenus et charges récurrents ramenés au mois -->
          <section
            class="bv-card bp-profile"
            aria-labelledby="bp-profile-title"
            data-ui-pattern="panel"
          >
            <header class="bv-card-head">
              <div>
                <h2 id="bp-profile-title">Budget type mensuel</h2>
                <p>
                  Vos revenus et charges récurrents, ramenés en moyenne par mois. Les flux ponctuels
                  sont exclus.
                </p>
              </div>
              @if (budgetType.data(); as bt) {
                @if (!bt.empty) {
                  <div
                    class="bp-profile-result"
                    [attr.data-sign]="bt.averageNetCents < 0 ? 'negative' : 'positive'"
                  >
                    <small>Solde du budget type / mois</small>
                    <strong>{{ bt.averageNetCents | signedCents }}</strong>
                  </div>
                }
              }
            </header>
            <bpm-state
              [loading]="budgetType.loading() && !budgetType.data()"
              [error]="budgetType.error()"
              (retry)="budgetType.reload()"
              [empty]="!!budgetType.data()?.empty"
              emptyText="Aucune opération récurrente active : le budget type est vide."
            >
              <a class="btn btn-secondary small" routerLink="/projet-de-vie/budget-type"
                >Composer mon budget type</a
              >
            </bpm-state>
            @if (budgetType.data(); as bt) {
              @if (!bt.empty) {
                <div class="bp-profile-grid">
                  <div>
                    <h3>Entrées régulières · {{ bt.averageIncomeCents | cents }}</h3>
                    <ul class="bp-profile-list">
                      @for (l of profileIncomes(); track l.id) {
                        <li>
                          <span>{{ l.label }}</span
                          ><strong data-sign="positive"
                            >+{{ l.monthlyAverageCents ?? null | cents }}</strong
                          >
                        </li>
                      } @empty {
                        <li class="bv-empty">
                          Ajoutez vos revenus réguliers dans « Mon budget type ».
                        </li>
                      }
                    </ul>
                  </div>
                  <div>
                    <h3>Charges régulières · {{ bt.averageChargeCents | cents }}</h3>
                    <ul class="bp-profile-list">
                      @for (g of profileCharges(); track g.label) {
                        <li class="bp-profile-group">
                          <span>{{ g.label }}</span
                          ><strong>−{{ g.totalCents | cents }}</strong>
                          <small>
                            @for (l of g.items; track l.id; let last = $last) {
                              {{ l.label }} {{ l.monthlyAverageCents ?? null | cents
                              }}{{
                                l.cadence === 'weekly'
                                  ? ' (chaque semaine)'
                                  : l.cadence === 'yearly'
                                    ? ' (chaque année)'
                                    : ''
                              }}{{ last ? '' : ' · ' }}
                            }
                          </small>
                        </li>
                      } @empty {
                        <li class="bv-empty">Aucune dépense récurrente pour l’instant.</li>
                      }
                    </ul>
                  </div>
                </div>
                <p class="bpm-help">
                  {{ bt.label }} — {{ bt.lines.length }} opération(s) récurrente(s).
                </p>
              }
            }
            <a class="btn btn-secondary" routerLink="/projet-de-vie/budget-type"
              >Modifier mon budget type →</a
            >
          </section>

          <!-- Vers l'épargne nécessaire : avancement de la période -->
          @if (summary.data(); as s) {
            <section
              class="bv-card bp-progress"
              aria-labelledby="bp-progress-title"
              data-ui-pattern="panel"
            >
              <h2 id="bp-progress-title">Vers votre épargne de la période</h2>
              <div class="bpm-disclosure-body">
                <bpm-progress
                  label="Période écoulée"
                  kind="time"
                  [pct]="time()?.pct ?? null"
                  [detail]="time()?.text ?? 'Cycle à configurer : aucune période.'"
                />
                @let net = s.figures['bpm.resultatPeriode']?.valueCents ?? null;
                @if (savingTarget(); as target) {
                  <dl class="bp-saving-comparison">
                    <div>
                      <dt>Mis de côté à ce jour</dt>
                      <dd [attr.data-sign]="sign(net)">{{ net | signedCents }}</dd>
                    </div>
                    <div>
                      <dt>Épargne nécessaire</dt>
                      <dd>{{ target | cents }}</dd>
                    </div>
                  </dl>
                  @if (net !== null) {
                    <div class="bp-saving-distance" [class.is-reached]="net >= target">
                      <span class="bp-saving-seal" aria-hidden="true">{{
                        net >= target ? '✓' : '◎'
                      }}</span>
                      <span
                        >{{ net >= target ? 'Au-delà de l’objectif' : 'Reste à constituer'
                        }}<strong>{{ abs(target - net) }}</strong></span
                      >
                      <b>{{ ratio(net, target) }}</b>
                    </div>
                  }
                } @else if (savings()?.computable && savings()?.valueCents !== null) {
                  <p class="bp-gauge-legend">
                    {{
                      savings()!.valueCents! < 0
                        ? 'Prélèvement possible sur le patrimoine : ' + abs(savings()!.valueCents!)
                        : 'Objectif : équilibrer la période sans puiser dans le patrimoine.'
                    }}
                  </p>
                  <p>
                    Solde réel à comparer à la cible : <strong>{{ net | signedCents }}</strong>
                  </p>
                } @else {
                  <p class="bv-empty">
                    Épargne nécessaire non calculable :
                    {{ savings()?.reason ?? 'repères indisponibles' }}. Fixez vos objectifs dans «
                    Objectifs et avenir ».
                  </p>
                }
                @if (directives.data()?.surplus; as sp) {
                  <bpm-progress
                    label="Excédent cumulé vers l’objectif d’excédent"
                    [value]="sp.cumulatedCents"
                    [target]="sp.targetCents"
                    [detail]="
                      sp.closedPeriods +
                      ' période(s) close(s) depuis ' +
                      sp.startKey +
                      ' sur ' +
                      sp.periods +
                      ' prévues.'
                    "
                  />
                }
                @if (s.context.period; as p) {
                  @let expected = fig('bpm.soldeAttendu');
                  <p class="bpm-help">
                    À la clôture du {{ p.end | shortDate }}, le solde réel rejoindra votre
                    patrimoine ; attendu
                    <strong [attr.data-sign]="sign(expected)">{{ expected | signedCents }}</strong>
                    (réel à ce jour {{ net | signedCents }}).
                  </p>
                }
              </div>
            </section>
          }

          <!-- Soldes versés au patrimoine -->
          <section class="bv-card" aria-labelledby="bp-history-title" data-ui-pattern="panel">
            <h2 id="bp-history-title">Soldes versés au patrimoine</h2>
            <div class="bpm-disclosure-body">
              <p>
                Chaque clôture verse le solde réel de la période au patrimoine : un excédent
                l’augmente, un déficit le diminue.
              </p>
              <bpm-state
                [loading]="closures.loading() && !closures.data()"
                [error]="closures.error()"
                (retry)="closures.reload()"
                [empty]="!!closures.data() && !closures.data()!.length"
                emptyText="Aucune clôture pour l’instant : la première aura lieu à la fin de la période."
              />
              @if (closures.data(); as cl) {
                @if (cl.length) {
                  <ol class="bp-history">
                    @for (c of cl; track c.id) {
                      <li [attr.data-sign]="c.resultCents < 0 ? 'negative' : 'positive'">
                        <a
                          class="bp-drill-name"
                          routerLink="/tableau-de-bord"
                          [queryParams]="{ period: c.periodKey }"
                          [attr.aria-label]="'Ouvrir le relevé de ' + c.periodLabel"
                          >{{ c.periodLabel }} · {{ c.periodStart | shortDate }} →
                          {{ c.periodEnd | shortDate }} <span aria-hidden="true">→</span></a
                        >
                        <strong>{{ c.resultCents | signedCents }}</strong>
                        <small>
                          Patrimoine après clôture ·
                          @if (patrimoineAfter().get(c.periodKey); as row) {
                            {{
                              row.patrimoineCents === null
                                ? 'À renseigner'
                                : (row.patrimoineCents | signedCents)
                            }}
                          } @else if (closureHistory.loading()) {
                            …
                          } @else {
                            —
                          }
                        </small>
                      </li>
                    }
                  </ol>
                  <p class="bpm-help">
                    Patrimoine après clôture lu sur les {{ closureWindow }} dernières périodes ;
                    pour une période plus ancienne, ouvrez son relevé au tableau de bord.
                  </p>
                }
              }
            </div>
          </section>
        </section>
      </div>
    </bpm-page>
  `,
  styles: `
    .bp-chip[aria-pressed='true'] {
      border-color: var(--app-accent);
      background: var(--app-accent);
      color: var(--app-on-accent);
    }
    .bp-levers {
      align-items: center;
      justify-content: space-between;
    }
    .bv-card-head > a {
      align-self: center;
    }
    .bp-history li > strong {
      text-align: end;
    }
  `,
})
export class BpmPilotPage {
  protected readonly ctx = inject(BpmPageContext);
  private readonly bpm = inject(BpmApi);
  private readonly router = inject(Router);
  protected readonly windows = WINDOWS;
  protected readonly closureWindow = 36;

  private fenetre = this.ctx.q('fenetre');
  private avant = this.ctx.q('avant');
  protected win = computed(() =>
    WINDOWS.includes(Number(this.fenetre())) ? Number(this.fenetre()) : 12,
  );
  protected before = computed(() => {
    const n = Number(this.avant());
    return this.avant() && Number.isInteger(n) ? n : null;
  });

  // ---------- lectures ----------
  protected summary = bpmLoader(
    () => this.ctx.period(),
    (p) => this.bpm.summary(p),
  );
  protected impact = bpmLoader(
    () => this.ctx.period(),
    (p) => this.bpm.impact(p),
  );
  protected centers = bpmLoader(
    () => this.ctx.period(),
    (p) => this.bpm.centers({ period: p, direction: 'charge' }),
  );
  protected incomes = bpmLoader(
    () => this.ctx.period(),
    (p) => this.bpm.incomes(p),
  );
  protected history = bpmLoader(
    () => ({ before: this.before(), limit: this.win() }),
    (k) => this.bpm.history(k),
  );
  protected directives = bpmLoader(
    () => 0,
    () => this.bpm.directives(),
  );
  protected events = bpmLoader(
    () => 0,
    () => this.bpm.events(),
  );
  protected budgetType = bpmLoader(
    () => 0,
    () => this.bpm.budgetType(),
  );
  protected closures = bpmLoader(
    () => 0,
    () => this.bpm.closures(),
  );
  protected closureHistory = bpmLoader(
    () => 0,
    () => this.bpm.history({ limit: this.closureWindow }),
  );

  protected readingScope = computed(
    () =>
      `${this.summary.data()?.context.period?.label ?? 'Période en cours'} · ${this.win()} périodes comparées${this.summary.data()?.closed ? ' · lecture close' : ''}`,
  );
  protected analysisKey = signal<string | null>(null);
  protected analysisPoints = computed<AnalysisPoint[]>(() => {
    const summary = this.summary.data();
    if (!summary) return [];
    const points: AnalysisPoint[] = [];
    const expected = this.fig('bpm.soldeAttendu');
    const result = this.fig('bpm.resultatPeriode');
    if (expected !== null && expected < 0 && !summary.closed)
      points.push({
        key: 'deficit',
        title: 'Solde prévu déficitaire',
        detail: `${signedCents(expected)} attendus en fin de période. Examinez les entrées restantes et les charges à payer.`,
        action: 'Comprendre le déficit prévu',
        link: ['/tableau-de-bord/rapprochement'],
        tone: 'danger',
      });
    if (summary.closed && result !== null && result < 0)
      points.push({
        key: 'closed-deficit',
        title: 'Résultat clos déficitaire',
        detail: `${signedCents(result)} ont été versés au patrimoine pour cette période close.`,
        action: 'Examiner le résultat enregistré',
        link: ['/tableau-de-bord/rapprochement'],
        tone: 'warning',
      });
    for (const row of (this.centers.data()?.rows ?? [])
      .filter((row) => row.marginCents !== null && row.marginCents < 0)
      .sort((a, b) => a.marginCents! - b.marginCents!)) {
      points.push({
        key: 'cap:' + row.ref,
        title: `${row.label} dépasse son plafond`,
        detail: `${cents(-row.marginCents!)} de dépassement prévu, paiements et échéances restants inclus.`,
        action: `Examiner ${row.label}`,
        link: ['/argent/postes', row.ref],
        tone: 'warning',
      });
    }
    if (this.fig('bpm.patrimoineConstitue') === null)
      points.push({
        key: 'stock',
        title: 'Patrimoine actuel non calculable',
        detail:
          this.reason('bpm.patrimoineConstitue') ??
          'Vérifiez le stock d’ouverture pour rendre les estimations du patrimoine calculables.',
        action: 'Vérifier le point de départ',
        link: ['/app/reglages'],
        fragment: 'bc-wealth-title',
        tone: 'info',
      });
    const missing = [
      'bpm.resultatPeriode',
      ...(!summary.closed ? ['bpm.soldeAttendu'] : []),
    ].filter((key) => this.fig(key) === null);
    if (missing.length)
      points.push({
        key: 'missing',
        title: 'Des montants de la période sont inconnus',
        detail:
          missing
            .map((key) => this.reason(key))
            .filter(Boolean)
            .join(' · ') || 'Consultez les sources du solde pour compléter les données manquantes.',
        action: 'Examiner les sources du solde',
        link: ['/tableau-de-bord/rapprochement'],
        tone: 'info',
      });
    return points;
  });
  protected analysisPoint = computed(
    () =>
      this.analysisPoints().find((point) => point.key === this.analysisKey()) ??
      this.analysisPoints()[0] ??
      null,
  );
  protected focus = computed<BpmPageFocus | null>(() => {
    if (!this.summary.data()) return null;
    const point = this.analysisPoint();
    if (point)
      return {
        title: `${this.analysisPoints().length} point(s) à examiner · ${point.title}`,
        detail: point.detail,
        tone: point.tone,
      };
    if (this.summary.loading() || this.centers.loading())
      return {
        title: 'Analyse de la période en cours',
        detail: 'Lecture du résultat et des plafonds de dépenses.',
        tone: 'info',
      };
    if (this.summary.error() || this.centers.error())
      return {
        title: 'Analyse partielle',
        detail:
          'Une lecture a échoué. Relisez la période pour vérifier le résultat et les plafonds.',
        tone: 'warning',
      };
    return {
      title: 'Aucun déficit ni dépassement de plafond détecté',
      detail: 'Ce contrôle porte sur le solde et les postes plafonnés de la période consultée.',
      tone: 'success',
    };
  });
  protected refreshAnalysis() {
    this.summary.reload();
    this.centers.reload();
    this.incomes.reload();
    this.history.reload();
    this.impact.reload();
  }

  // ---------- 1. synthèse des flux ----------
  protected fig(key: string) {
    return this.summary.data()?.figures[key]?.valueCents ?? null;
  }
  protected reason(key: string) {
    const f = this.summary.data()?.figures[key];
    return f && f.valueCents === null ? (f.unavailableReason ?? 'valeur indisponible') : null;
  }
  /** Repère exprimé en % (sans centimes) : sa valeur brute, ou null s'il est inconnu. */
  protected pctFig(key: string) {
    const f = this.summary.data()?.figures[key];
    return f && f.status === 'ok' ? f.value : null;
  }
  protected sign(v: number | null) {
    return v === null ? null : v < 0 ? 'negative' : 'positive';
  }
  protected money = cents;
  protected initialBudget = computed(() => this.fig('bpm.resultatPrevu'));
  protected flow = computed<FlowMeasure[]>(() => {
    if (!this.summary.data()) return [];
    const add = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);
    return [
      {
        key: 'income',
        label: 'Entrées',
        color: 'var(--s-income)',
        kind: 'income',
        realizedCents: this.fig('bpm.revenus'),
        expectedCents: add(this.fig('bpm.revenus'), this.fig('bpm.resteARecevoir')),
      },
      {
        key: 'charge',
        label: 'Charges',
        color: 'var(--s-charge)',
        kind: 'expense',
        realizedCents: this.fig('bpm.charges'),
        expectedCents: add(this.fig('bpm.charges'), this.fig('bpm.resteAPayer')),
      },
      {
        key: 'net',
        label: 'Net',
        color: 'var(--s-net)',
        kind: 'net',
        realizedCents: this.fig('bpm.resultatPeriode'),
        expectedCents: this.fig('bpm.soldeAttendu'),
        signed: true,
      },
    ];
  });

  // ---------- 2. zoom ----------
  private item(key: DirectiveItem['key']) {
    return this.directives.data()?.items.find((i) => i.key === key) ?? null;
  }
  protected savings = computed(() => this.item('savings'));
  protected directivesOtherPeriod = computed(() => {
    const d = this.directives.data()?.context.period?.key;
    const s = this.summary.data()?.context.period?.key;
    return !!d && !!s && d !== s;
  });
  protected zoom = computed<ZoomRow[]>(() => {
    const s = this.summary.data();
    const d = this.directives.data();
    if (!s || !d) return [];
    const f = s.figures;
    const fromFigure = (key: string, label: string, source: string): ZoomRow => ({
      label,
      cents: f[key]?.valueCents ?? null,
      signed: true,
      unit: 'Période lue (' + (s.context.period?.label ?? '—') + ')',
      source,
      reason: f[key]?.unavailableReason ?? null,
      link: '/tableau-de-bord/rapprochement',
      query: this.carryQuery(),
    });
    const fromDirective = (
      key: DirectiveItem['key'],
      label: string,
      unit: string,
      signed: boolean,
    ): ZoomRow => {
      const it = this.item(key);
      return {
        label,
        cents: it?.valueCents ?? null,
        signed,
        unit,
        source: 'Directives — ' + (it?.assumptions.join(' ; ') || 'aucune hypothèse'),
        reason: it?.reason ?? null,
        link: '/vision/reperes',
        query: this.carryQuery(),
      };
    };
    const c = this.centers.data();
    const capped = c?.rows.filter((r) => r.capCents !== null) ?? [];
    const margin = capped.length ? capped.reduce((sum, r) => sum + (r.marginCents ?? 0), 0) : null;
    return [
      fromFigure(
        'bpm.resultatPeriode',
        'Net réalisé',
        'Synthèse : revenus reçus − dépenses payées (date réelle)',
      ),
      fromFigure(
        'bpm.soldeAttendu',
        'Net attendu à la clôture',
        'Synthèse : net réalisé + restant à recevoir − restant à payer',
      ),
      fromDirective('savings', 'Épargne nécessaire', 'Par période (période courante)', false),
      fromDirective('cap', 'Plafond de dépenses', 'Par période (somme des plafonds)', false),
      {
        label: 'Marge restante sous plafonds',
        cents: c ? margin : null,
        signed: true,
        unit: 'Période lue',
        source: 'Centres de coûts : plafond − payé − restant prévu (centres plafonnés)',
        reason: c
          ? capped.length
            ? null
            : 'Aucun plafond par centre renseigné'
          : 'Centres non lus',
        link: '/depenses/registre',
        query: this.carryQuery(),
      },
      fromDirective('available', 'Disponible', 'Période courante', true),
      fromDirective('weekly', 'Montant indicatif', 'Par semaine restante', true),
    ];
  });

  /** Repères en tuiles : une valeur inconnue reste « Non calculable » avec sa raison, jamais un zéro. */
  protected tiles = computed<MetricTile[]>(() =>
    this.zoom().map((z, i) => ({
      id: 'zoom-' + i,
      label: z.label,
      value: z.cents === null ? 'Non calculable' : z.signed ? signedCents(z.cents) : cents(z.cents),
      tone:
        z.cents === null
          ? 'warning'
          : z.signed && z.cents < 0
            ? 'danger'
            : z.signed && z.cents > 0
              ? 'success'
              : null,
      note:
        z.cents === null
          ? (z.reason ?? 'raison non fournie') + ' · ' + z.unit
          : z.unit + ' · ' + z.source,
      link: z.link ?? undefined,
      query: z.query,
    })),
  );
  private carryQuery() {
    return Object.fromEntries(Object.entries(this.ctx.carry()).map(([k, v]) => [k, String(v)]));
  }

  // ---------- 3. résultat réalisé et prévu par période ----------
  /**
   * Colonnes du graphe de la référence (`bp-compare-chart`) : réalisé (barre pleine) et prévu (contour)
   * de chaque période, sur une échelle commune. Une période close n'a plus de prévu recalculé (null) :
   * seul son résultat enregistré est tracé ; une valeur inconnue n'est jamais tracée comme un zéro.
   */
  protected bars = computed(() => {
    const rows: HistoryRow[] = [...(this.history.data()?.rows ?? [])].reverse(); // chronologique
    const max = Math.max(
      1,
      ...rows.flatMap((r) => [Math.abs(r.netCents ?? 0), Math.abs(r.expectedCents ?? 0)]),
    );
    const sign = (v: number | null) =>
      v === null ? null : v > 0 ? 'positive' : v < 0 ? 'negative' : 'zero';
    const pct = (v: number | null) => (v === null ? 0 : Math.round((Math.abs(v) / max) * 100));
    return rows.map((row) => {
      const state =
        row.status === 'current' ? 'current' : row.status === 'future' ? 'future' : 'past';
      const realCents = state === 'future' ? null : row.netCents;
      const plannedCents = row.expectedCents;
      return {
        row,
        state,
        realCents,
        plannedCents,
        realPct: pct(realCents),
        plannedPct: pct(plannedCents),
        realSign: sign(realCents),
        plannedSign: sign(plannedCents),
        gapCents: realCents === null || plannedCents === null ? null : realCents - plannedCents,
      };
    });
  });
  /** Courbe du résultat réalisé, puis prolongement prévisionnel sur les périodes à venir (même échelle que les colonnes). */
  protected historyCurve = computed(() => {
    const bars = this.bars();
    const point = (i: number, future: boolean) => {
      const b = bars[i]!;
      const pct = future ? b.plannedPct : b.realPct;
      const sign = future ? b.plannedSign : b.realSign;
      return { x: 64 + i * 140, y: 100 - (sign === 'negative' ? -pct : pct) };
    };
    const path = (points: { x: number; y: number }[]) =>
      points
        .map((p, i) => {
          if (!i) return `M ${p.x} ${p.y}`;
          const prev = points[i - 1]!;
          const mid = (prev.x + p.x) / 2;
          return `C ${mid} ${prev.y}, ${mid} ${p.y}, ${p.x} ${p.y}`;
        })
        .join(' ');
    const actual = bars.flatMap((b, i) =>
      b.state !== 'future' && b.realCents !== null ? [point(i, false)] : [],
    );
    const forecast = bars.flatMap((b, i) =>
      b.state === 'future' && b.plannedCents !== null ? [point(i, true)] : [],
    );
    if (forecast.length && actual.length) forecast.unshift(actual[actual.length - 1]!);
    return {
      width: Math.max(1, bars.length * 140 - 12),
      actual: path(actual),
      forecast: forecast.length > 1 ? path(forecast) : '',
    };
  });
  protected newer() {
    const b = this.before();
    const top = this.history.data()?.context.period?.index;
    if (b === null) return;
    const next = b + this.win();
    this.ctx.setQuery({ avant: top !== undefined && next > top ? null : next });
  }

  // ---------- 4. centres ----------
  protected capRows = computed<CapRow[]>(() =>
    (this.centers.data()?.rows ?? []).map((r) => ({
      key: r.ref,
      label: r.label,
      paidCents: r.paidCents,
      remainingCents: r.remainingCents,
      capCents: r.capCents,
    })),
  );
  protected centerQuery = computed(() => ({ ...this.ctx.carry(), from: 'piloter' }));
  /** Registre des dépenses de la période, filtré sur un poste. */
  protected expenseCenterQuery(ref: string) {
    return { ...this.ctx.carry(), center: ref };
  }
  protected openCenter(ref: string) {
    this.router.navigate(['/argent/postes', ref], { queryParams: this.centerQuery() });
  }
  protected abs = (v: number) => cents(Math.abs(v));
  protected capped = computed(() =>
    (this.centers.data()?.rows ?? []).filter((r) => r.capCents !== null),
  );
  /** Somme des dépassements des centres plafonnés (marges négatives). */
  protected overCents = computed(() =>
    this.capped().reduce((sum, r) => sum + Math.max(0, -(r.marginCents ?? 0)), 0),
  );

  // ---------- 6. événements ----------
  protected goalLabel = (t: GoalType) => GOAL_LABEL[t] ?? t;
  /** Total indicatif à mettre de côté par période ; inconnu dès qu'une provision n'est pas calculable. */
  protected provisionTotal = computed(() => {
    const rows = this.events.data()?.rows ?? [];
    if (!rows.length || rows.some((r) => r.provisionPerPeriodCents === null)) return null;
    return rows.reduce((sum, r) => sum + (r.provisionPerPeriodCents ?? 0), 0);
  });

  // ---------- 7. budget type ----------
  protected profileIncomes = computed(() =>
    (this.budgetType.data()?.lines ?? []).filter((l) => l.direction === 'income'),
  );
  /** Charges du budget type regroupées par centre, comme le profil de la période de la référence. */
  protected profileCharges = computed(() => {
    const groups = new Map<
      string,
      { label: string; totalCents: number | null; items: Recurrence[] }
    >();
    for (const l of this.budgetType.data()?.lines ?? []) {
      if (l.direction !== 'charge') continue;
      const key = l.costCenterLabel ?? 'À préciser';
      const g = groups.get(key) ?? { label: key, totalCents: 0, items: [] };
      g.items.push(l);
      g.totalCents =
        g.totalCents === null || l.monthlyAverageCents === undefined
          ? null
          : g.totalCents + l.monthlyAverageCents;
      groups.set(key, g);
    }
    return [...groups.values()];
  });

  // ---------- 8. avancement ----------
  protected time = computed(() => {
    const c = this.summary.data()?.context;
    const p = c?.period;
    if (!c || !p) return null;
    const start = Date.parse(p.start);
    const end = Date.parse(p.endExclusive);
    const now = Date.parse(c.calculationDate);
    const total = Math.round((end - start) / DAY);
    const elapsed = Math.min(total, Math.max(0, Math.round((now - start) / DAY) + 1)); // le jour du calcul compte comme entamé
    if (!total) return null;
    const text =
      now < start
        ? `Période à venir (débute le ${shortDate(p.start)}).`
        : now >= end
          ? `Période terminée (${total} jours).`
          : `Jour ${elapsed} sur ${total} (calcul au ${shortDate(c.calculationDate)}).`;
    return { pct: Math.round((elapsed / total) * 1000) / 10, text };
  });

  /** Cible d'épargne positive et calculable : comparaison directe au net réalisé. */
  protected savingTarget = computed(() => {
    const v = this.savings()?.valueCents ?? null;
    return this.savings()?.computable && v !== null && v > 0 ? v : null;
  });
  protected ratio(net: number, target: number) {
    return percentText(Math.round((net / target) * 1000) / 10);
  }

  // ---------- 9. clôtures ----------
  protected patrimoineAfter = computed(
    () =>
      new Map(
        (this.closureHistory.data()?.rows ?? [])
          .filter((r) => r.recorded)
          .map((r) => [r.periodKey, r]),
      ),
  );
}
