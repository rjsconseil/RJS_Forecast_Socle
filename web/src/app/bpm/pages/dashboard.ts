import { NgTemplateOutlet } from '@angular/common';
import { settlementOutsideWindow } from './period-presentation';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { CenterRow, EntryInput, Recurrence, RegisterLine } from '../../core/bpm-models';
import { cents, CentsPipe, euros, figureValue, percentText, ShortDatePipe, signedCents, SignedCentsPipe } from '../../core/format';
import { ClosingPreview } from '../../core/models';
import { MetricDetail, MetricTile, MetricTilesComponent } from '../../shared/metric-tiles.component';
import { BpmLineDetail, BpmOperationEditor, BpmPageContext, BpmPageFrame, BpmRefresh, BpmState, bpmLoader, newRequestKey, overCapsOf } from '../ui';
import { BpmDashboardHistory } from './dashboard-history';
import { BpmDashboardWealth, BpmSetupNeeded, setupProblem } from './dashboard-parts';

/** Un poste (centre) de la période et ses échéances, comme les listes source `rjs-bpm-income-list` / `rjs-bpm-period-expenses`. */
interface FlowGroup {
  key: string;
  label: string;
  lines: RegisterLine[];
  total: number;
  recorded: number;
  pending: number;
  unrealized: number;
}
/** Une part du parcours de chaque euro (barre source `.bm-flow-bar`). */
interface FlowPart {
  key: string;
  nature: 'poste' | 'reste';
  name: string;
  cents: number;
  pct: number;
  euros: number;
}

const longDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/**
 * Tableau de bord (Ma vision budgétaire), sur la page source `bpm-money` : chiffres clés de la
 * période (tuiles et calcul du reste) avec le Patrimoine, cadre du budget de la période (entrées,
 * charges avec le zoom sur les postes — parcours de chaque euro et relevé —, projets de la vie),
 * clôture et historique. Chaque chiffre mène au détail qui l'explique ; la clôture annonce le
 * résultat signé réellement capitalisé (même contrat que la commande).
 */
@Component({
  selector: 'bpm-page-dashboard',
  providers: [BpmPageContext],
  imports: [NgTemplateOutlet, RouterLink, BpmPageFrame, BpmState, BpmLineDetail, BpmOperationEditor, BpmDashboardWealth, BpmDashboardHistory, BpmSetupNeeded, MetricTilesComponent, CentsPipe, SignedCentsPipe, ShortDatePipe],
  styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-money.scss', '../ref-styles/bpm-expenses.page.scss', './bpm-money-page.scss'],
  template: `
    <bpm-page
      title="Tableau de bord"
      pageClass="bpm-money"
      [lead]="lead()"
      [context]="info()"
      [periodKey]="period()"
      [periodNav]="true"
      (periodChange)="goPeriod($event)"
    >
      <button actions type="button" class="app-hero-action" (click)="openCreate()" [disabled]="!budgets().length">＋ Ajouter une entrée ou une charge</button>
      <a actions class="bpm-link" routerLink="/projet-de-vie" [queryParams]="carry()">Gestion du projet de vie →</a>
      <a actions class="bpm-link" routerLink="/plafonds" [queryParams]="carry()">Plafonds et catégories →</a>
      <a actions class="bpm-link" routerLink="/projet-de-vie" fragment="life-objectives">Mes objectifs →</a>
      <a actions class="bpm-link" routerLink="/depenses" [queryParams]="carry()">Détail des dépenses →</a>

      <div class="bpm-money bpm-money-body" data-tone="budget">
        @if (notice()) {
          <div class="alert ok" role="status">{{ notice() }} <button type="button" class="btn btn-secondary" (click)="notice.set(null)">Masquer</button></div>
        }

        @if (problem(); as p) {
          <bpm-setup-needed [kind]="p" [message]="summary.error()?.message ?? ''" />
        } @else if (!summary.data()) {
          <bpm-state [loading]="summary.loading()" [error]="summary.error()" [lines]="4" (retry)="summary.reload()" />
        } @else {
          @let s = summary.data()!;
          @if (!s.context.period) {
            <p class="bpm-missing" role="note">
              <strong>Cycle à configurer.</strong> Les chiffres d'une période (reçu, dépensé, reste) sont inconnus tant que le cycle du Budget du projet de vie n'a pas de date de début : ils ne valent pas zéro.
              <a class="bm-action-link" routerLink="/creer">Configurer le cycle →</a>
            </p>
          }
          @if (summary.error()) {
            <bpm-state [error]="summary.error()" (retry)="summary.reload()" />
          }

          <!-- 1. Votre argent, cette période : tuiles, calcul du reste et Patrimoine -->
          <section id="bm-key-figures" class="bm-key-figures" data-bpm-frame="metrics" aria-label="Chiffres clés du relevé" data-ui-pattern="panel">
            <header class="bm-overview-heading">
              <div>
                <span class="bm-section-kicker">{{ periodName() }}</span>
                <h2>Votre argent, cette période</h2>
                <p>Le réalisé aujourd’hui, la prévision à la clôture.</p>
              </div>
              @if (s.closed) {
                <span class="bm-badge" title="Chiffres enregistrés à la clôture, non recalculés">Clôturée · chiffres enregistrés</span>
              }
            </header>
            <rjs-metric-tiles variant="instrument" layout="last-wide" label="Chiffres clés du relevé" [tiles]="tiles()" (fragmentSelected)="revealFragment($event)" />
            @if (noOperation()) {
              <p class="bm-empty">
                Aucun flux réalisé : ajoutez vos entrées et charges. Les zéros affichés sont des valeurs connues, pas des données manquantes.
                <button type="button" class="btn btn-secondary" (click)="openCreate()">Saisir une première entrée ou charge</button>
              </p>
            }
            <details id="bm-calculation" class="bm-calculation" [open]="calculationOpen()" (toggle)="calculationOpen.set($any($event.target).open)">
              <summary>Comprendre le calcul du reste</summary>
              <div class="record-details">
                <p>Reçu − dépensé = reste à ce jour. Ajoutez ce qui reste à recevoir et retirez les charges à venir pour obtenir le solde prévu à la clôture. Le réalisé suit la date réelle ; les listes suivent la date prévue.</p>
                <dl class="record-facts">
                  <div><dt>↑ Entrées reçues</dt><dd>{{ known('bpm.revenus') }}</dd></div>
                  <div><dt>↓ Dépenses réalisées</dt><dd>{{ known('bpm.charges') }}</dd></div>
                  <div><dt>↑ Entrées encore attendues</dt><dd>{{ known('bpm.resteARecevoir') }}</dd></div>
                  <div><dt>↓ Charges encore prévues</dt><dd>{{ known('bpm.resteAPayer') }}</dd></div>
                  <div><dt>= Reste</dt><dd>{{ known('bpm.resultatPeriode', true) }}</dd></div>
                  <div><dt>Solde prévu à la clôture</dt><dd>{{ known('bpm.soldeAttendu', true) }}</dd></div>
                </dl>
                <a class="bpm-link" routerLink="/argent/reste" [queryParams]="carry()">Voir le détail du solde →</a>
              </div>
            </details>
            @if (s.closed && s.comparison.length) {
              <details class="bm-calculation">
                <summary>Recalcul avec les formules actuelles (comparaison séparée)</summary>
                <div class="record-details">
                  <p class="bpm-help">Les chiffres ci-dessus restent ceux enregistrés à la clôture. Ce recalcul est présenté à titre de comparaison seulement.</p>
                  <div class="table-scroll">
                    <table class="data-table">
                      <thead><tr><th>Chiffre</th><th class="num">Enregistré</th><th class="num">Recalculé</th><th>Formule actuelle</th></tr></thead>
                      <tbody>
                        @for (c of s.comparison; track c.key) {
                          <tr><td>{{ c.label }}</td><td class="num">{{ cmp(c.key, c.recorded) }}</td><td class="num">{{ cmp(c.key, c.recomputed) }}</td><td class="small"><code>{{ c.currentFormula }}</code></td></tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            }
            <bpm-dashboard-wealth
              id="bm-wealth"
              [stock]="stock()"
              [effect]="periodEffect()"
              [after]="after()"
              [objective]="objective()"
              [closed]="s.closed"
              [stockReason]="fig('bpm.patrimoineConstitue')?.unavailableReason ?? null"
              [formula]="fig('bpm.patrimoineFinPeriode')?.formula ?? null"
              [endDate]="s.context.period?.end ?? null"
              [carry]="carry()"
            />
          </section>

          <!-- Plafonds dépassés (postes et catégories, lus indépendamment) : signalés en rouge, jamais bloquants -->
          @if (overCaps().length) {
            <p class="bm-caps-alert" role="status">
              <strong>{{ overCaps().length }} plafond{{ overCaps().length > 1 ? 's' : '' }} dépassé{{ overCaps().length > 1 ? 's' : '' }}</strong>
              @for (o of overCaps(); track o.key) {
                <span>{{ o.level }} « {{ o.label }} » <strong>+{{ o.overCents | cents }}</strong></span>
              }
              <a routerLink="/plafonds" [queryParams]="carry()">Voir les plafonds →</a>
            </p>
          }

          <!-- 2. Budget de la période : entrées, charges (avec le zoom sur les postes) et projets -->
          <section class="bm-budget-frame" aria-labelledby="bm-budget-title" data-ui-pattern="panel">
            <header class="bm-budget-heading" data-ui-pattern="section-heading">
              <div>
                <span class="bm-section-kicker">{{ periodName() }}</span>
                <h2 id="bm-budget-title">Budget standard de la période</h2>
                <p>Retrouvez vos entrées, vos charges et vos projets.</p>
              </div>
              @if (register.data()) {
                <div class="bm-budget-total">
                  <small>Budget du projet de vie</small><strong><span aria-hidden="true">↑</span> {{ incomeTotal() | cents }}</strong>
                </div>
              }
            </header>
            <div class="bm-budget-content">
              <details class="bm-standard-details">
                <summary>Comprendre le budget du projet de vie</summary>
                <p class="bpm-help">Les deux listes ci-dessous reprennent les échéances du Budget du projet de vie dont la date prévue tombe dans la période, récurrentes et ponctuelles. Les définitions récurrentes actives sont rappelées ici.</p>
                <dl class="bm-funding-split">
                  <div><dt>Entrées récurrentes</dt><dd>{{ register.data() ? (incomeSplit().recurring | cents) : '—' }}</dd></div>
                  <div><dt>Entrées ponctuelles</dt><dd>{{ register.data() ? (incomeSplit().oneTime | cents) : '—' }}</dd></div>
                </dl>
                <bpm-state [loading]="recurrences.loading() && !recurrences.data()" [error]="recurrences.error()" (retry)="recurrences.reload()" [lines]="2" />
                @if (recurrences.data()) {
                  @if (recurring().length) {
                    <ol class="bm-lines" aria-label="Définitions récurrentes actives">
                      @for (r of recurring(); track r.id; let i = $index) {
                        <li><button type="button" class="bm-line" [attr.data-nature]="r.direction === 'income' ? 'entrees' : 'poste'" [attr.data-index]="i % 8" (click)="openRecurrence(r)" [attr.aria-label]="r.label + ', ' + r.cadenceLabel + ', ' + money(r.amountCents) + ' — ouvrir'">
                          <span class="bm-line-sign" aria-hidden="true">{{ r.direction === 'income' ? '↑' : '↓' }}</span>
                          <span class="bm-line-main"><strong>{{ r.label }}</strong><small>{{ r.direction === 'income' ? 'Entrée' : 'Charge' }} récurrente · {{ r.cadenceLabel }} · {{ r.costCenterLabel ?? 'Poste à préciser' }}</small></span>
                          <span class="bm-line-amount">{{ r.direction === 'income' ? '+' : '−' }}{{ r.amountCents | cents }}</span>
                          <span class="bm-line-open">Voir le détail →</span>
                        </button></li>
                      }
                    </ol>
                  } @else {
                    <p class="bm-empty">Aucune entrée ni charge récurrente active.</p>
                  }
                }
              </details>

              <details id="bm-period-income" class="bm-period-section is-income" [open]="incomeOpen()" (toggle)="incomeOpen.set($any($event.target).open)">
                <summary class="bm-period-heading" data-ui-pattern="section-heading">
                  <span class="bm-section-mark" aria-hidden="true">↑</span>
                  <div>
                    <h3>Entrées prévues dans la période</h3>
                    <p>{{ !s.context.period ? 'Cycle à configurer' : register.data() ? incomeLines().length + ' entrée(s) · Budget du projet de vie' : 'Lecture en cours…' }}</p>
                  </div>
                  @if (register.data()) {
                    <div class="bm-section-total"><small>Total des entrées listées</small><strong>{{ incomeTotal() | cents }}</strong></div>
                  }
                  <span class="bm-section-cue" aria-hidden="true">⌄</span>
                </summary>
                <div class="bm-period-list">
                  @if (!s.context.period) {
                    <p class="bm-empty">Aucune période tant que le cycle n'est pas configuré.</p>
                  } @else {
                    <bpm-state [loading]="register.loading() && !register.data()" [error]="register.error()" (retry)="register.reload()" [lines]="2" />
                    @if (register.data()) {
                      <p class="bpm-help">Cette liste suit les dates prévues. Les règlements peuvent avoir eu lieu dans une autre période ; le chiffre « Reçu » du tableau de bord suit leur date réelle.</p>
                      @for (g of incomeGroups(); track g.key) {
                        <ng-container *ngTemplateOutlet="flowGroup; context: { $implicit: g, income: true }" />
                      } @empty {
                        <p class="bm-empty">Aucune entrée reçue ou attendue à une date prévue dans cette période.</p>
                      }
                    }
                  }
                </div>
              </details>

              <details id="bm-period-expenses" class="bm-period-section is-expense" [open]="expenseOpen()" (toggle)="expenseOpen.set($any($event.target).open)">
                <summary class="bm-period-heading" data-ui-pattern="section-heading">
                  <span class="bm-section-mark" aria-hidden="true">↓</span>
                  <div>
                    <h3>Charges prévues dans la période</h3>
                    <p>{{ !s.context.period ? 'Cycle à configurer' : register.data() ? chargeLines().length + ' charge(s) · Budget du projet de vie' : 'Lecture en cours…' }}</p>
                  </div>
                  @if (register.data()) {
                    <div class="bm-section-total"><small>Total des charges listées</small><strong>{{ chargeTotal() | cents }}</strong></div>
                  }
                  <span class="bm-section-cue" aria-hidden="true">⌄</span>
                </summary>
                <div class="bm-period-list">
                  @if (!s.context.period) {
                    <p class="bm-empty">Aucune période tant que le cycle n'est pas configuré.</p>
                  } @else {
                    @if (register.data()) {
                      <p class="bpm-help">Cette liste suit les dates prévues, tandis que le chiffre « Dépensé » suit les dates réelles de paiement. Ouvrez une charge pour son détail. Les projets de la vie y contribuent seulement par leurs règlements validés depuis l’attribution de leur enveloppe.</p>
                      @for (g of chargeGroups(); track g.key) {
                        <ng-container *ngTemplateOutlet="flowGroup; context: { $implicit: g, income: false }" />
                      } @empty {
                        <p class="bm-empty">Aucune charge prévue dans cette période.</p>
                      }
                    } @else {
                      <bpm-state [loading]="register.loading()" [error]="register.error()" (retry)="register.reload()" [lines]="2" />
                    }
                  }
                </div>

                @if (s.context.period) {
                  <details class="bpm-disclosure bm-reading-analysis">
                    <summary>Zoom sur les postes du projet de vie</summary>
                    <div class="bpm-disclosure-body">
                      <bpm-state [loading]="centers.loading() && !centers.data()" [error]="centers.error()" (retry)="centers.reload()" />
                      @if (centers.data(); as c) {
                        @if (flow(); as f) {
                          <details class="bpm-disclosure bm-flow" aria-labelledby="bm-flow-title" data-ui-pattern="panel">
                            <summary><h3 id="bm-flow-title">Le parcours de chaque euro</h3></summary>
                            <div class="bpm-disclosure-body">
                              <div class="bm-flow-bar" role="img" [attr.aria-label]="flowLabel()">
                                @for (part of f.bar; track part.key; let i = $index) {
                                  <span [attr.data-nature]="part.nature" [attr.data-index]="i % 8" [style.width.%]="part.pct" [attr.title]="part.name + ' · ' + money(part.cents)"></span>
                                }
                              </div>
                              <p class="bpm-help">La barre représente tout l’argent qui a circulé ; chaque couleur est un poste, la dernière part est ce qui reste.</p>
                              <p class="bm-hundred">
                                <strong>{{ f.basis === 'received' ? 'Sur 100 € reçus' : 'Sur 100 € dépensés' }} :</strong>
                                @for (part of f.parts; track part.key) {
                                  <span [attr.data-nature]="part.nature">{{ part.euros }} € {{ part.nature === 'reste' ? (part.euros >= 0 ? 'restent' : 'pris sur le patrimoine') : part.name }}</span>
                                }
                              </p>
                              @if (f.basis === 'spent') {
                                <p class="bpm-help">Les dépenses dépassent encore les entrées reçues : les parts se lisent sur ce qui a été dépensé.</p>
                              }
                            </div>
                          </details>
                        } @else {
                          <p class="bm-empty">Rien de reçu ni de dépensé à date de règlement : aucune part n'est calculée.</p>
                        }

                        <section class="bm-statement" aria-labelledby="bm-statement-title" data-ui-pattern="panel">
                          <header class="bm-statement-head">
                            <h3 id="bm-statement-title">Le relevé, ligne par ligne</h3>
                            <p class="bpm-help">{{ c.basis.label }} Ouvrez une ligne pour retrouver ses opérations.</p>
                          </header>
                          <ol class="bm-lines">
                            <li>
                              <a class="bm-line" data-nature="entrees" routerLink="/argent/entrees" [queryParams]="carry()">
                                <span class="bm-line-sign" aria-hidden="true">↑</span>
                                <span class="bm-line-main"><strong>Entrées reçues</strong><small>{{ incomeReminder() }}</small></span>
                                <span class="bm-line-amount">{{ c.basis.receivedCents | cents }}</span>
                                <span class="bm-line-open">Voir le détail →</span>
                              </a>
                            </li>
                            @for (r of statementRows(); track r.ref; let i = $index) {
                              <li>
                                <a class="bm-line" data-nature="poste" [attr.data-index]="i % 8" [routerLink]="['/argent/postes', r.ref]" [queryParams]="carry()">
                                  <span class="bm-line-sign" aria-hidden="true">↓</span>
                                  <span class="bm-line-main">
                                    <strong>{{ r.label }}</strong>
                                    <small>{{ reminder(r, c.basis.kind) }}</small>
                                    @if (r.sharePct !== null && r.paidCents > 0) {
                                      <span class="bm-line-share" aria-hidden="true"><span [style.width.%]="min(r.sharePct, 100)"></span></span>
                                    }
                                  </span>
                                  <span class="bm-line-amount">{{ r.paidCents | cents }}</span>
                                  <span class="bm-line-open">Voir le détail →</span>
                                </a>
                              </li>
                            }
                            <li>
                              <a class="bm-line bm-line-total" data-nature="reste" id="bm-remaining" [attr.data-sign]="(periodEffect() ?? 0) < 0 ? 'negative' : 'positive'" routerLink="/argent/reste" [queryParams]="carry()">
                                <span class="bm-line-sign" aria-hidden="true">=</span>
                                <span class="bm-line-main"><strong>{{ restLabel() }}</strong><small>{{ restReminder() }}</small></span>
                                <span class="bm-line-amount">{{ periodEffect() === null ? 'Inconnu' : (periodEffect() | signedCents) }}</span>
                                <span class="bm-line-open">Voir le détail →</span>
                              </a>
                            </li>
                          </ol>
                          <div class="bm-statement-foot">
                            <details class="bm-calculation">
                              <summary>Comment le reste rejoint le patrimoine</summary>
                              <p class="bpm-help">À la clôture, le résultat signé de la période (reçu − dépensé à date de règlement) est capitalisé une seule fois dans le Patrimoine, même s’il est nul ou négatif. Les échéances encore prévues comptent à leur règlement.</p>
                            </details>
                          </div>
                        </section>
                      }
                    </div>
                  </details>
                }
              </details>

              <details id="bm-projects" class="bm-period-section is-projects" [open]="projectsOpen()" (toggle)="projectsOpen.set($any($event.target).open)">
                <summary class="bm-period-heading" data-ui-pattern="section-heading">
                  <span class="bm-section-mark" aria-hidden="true">◇</span>
                  <div>
                    <h3>Projets de la vie</h3>
                    <p>{{ lifeProjects.data() ? lifeProjects.data()!.length + ' projet(s) · ' + projectTaskCount() + ' tâche(s)' : 'Lecture en cours…' }}</p>
                  </div>
                  <span class="bm-section-cue" aria-hidden="true">⌄</span>
                </summary>
                <p class="bm-projects-help">Ouvrez un projet pour voir ses tâches et son avancement.</p>
                <div class="bm-period-list">
                  <bpm-state [loading]="lifeProjects.loading() && !lifeProjects.data()" [error]="lifeProjects.error()" (retry)="lifeProjects.reload()" [lines]="2" />
                  @if (lifeProjects.data(); as lps) {
                    @if (lps.length) {
                      <ol class="bm-lines">
                        @for (lp of lps; track lp.budgetId; let i = $index) {
                          <li><a class="bm-line" [attr.data-index]="i % 8" [routerLink]="['/app/gestion-projet', lp.coreProjectId]">
                            <span class="bm-line-sign" aria-hidden="true">◇</span>
                            <span class="bm-line-main"><strong>{{ lp.name }}</strong><small>{{ lp.view.statusLabel }} · {{ lp.view.time.taskCount }} tâche(s) d'un projet budgétisé</small></span>
                            <span class="bm-line-amount">{{ lp.view.completionPercent }} %</span>
                            <span class="bm-line-open">Ouvrir le projet →</span>
                          </a></li>
                        }
                      </ol>
                    } @else {
                      <p class="bm-projects-help">Aucun autre projet rattaché à votre projet de vie : un voyage, un équipement, une formation… <a class="bm-action-link" routerLink="/creer">Créer un projet de la vie →</a></p>
                    }
                  }
                </div>
              </details>
            </div>
          </section>

          <!-- 3. Clôture de la période -->
          <section class="bm-statement" aria-labelledby="dash-close" data-ui-pattern="panel">
            <header class="bm-statement-head bm-head-row">
              <h2 id="dash-close">Clôture de la période</h2>
              @if (dash.data()?.period?.status; as st) {
                <span class="chip" [class]="periodTone(st)">{{ periodLabel(st) }}</span>
              }
            </header>
            @if (dash.error() && !dash.data()) {
              <bpm-state [error]="dash.error()" (retry)="dash.reload()" />
            } @else if (dash.data(); as d) {
              @if (d.cycle?.state === 'to_configure' || !d.period) {
                <p class="bpm-help">Cycle à configurer : aucune période ne peut être close.</p>
                <a class="bm-action-link" routerLink="/creer">Configurer le cycle →</a>
              } @else if (d.closure; as c) {
                <p>{{ c.periodLabel }} a été close le <strong>{{ c.createdAt.slice(0, 10) | shortDate }}</strong>.</p>
                <dl class="record-facts">
                  <div><dt>Résultat capitalisé dans le Patrimoine</dt><dd class="num big" [class.pos]="c.resultCents > 0" [class.neg]="c.resultCents < 0">{{ c.resultCents | signedCents }}</dd></div>
                  <div><dt>Date de capitalisation</dt><dd>{{ c.periodEnd | shortDate }}</dd></div>
                </dl>
                <details class="bm-calculation">
                  <summary>Calcul enregistré à la clôture</summary>
                  <div class="record-details">
                    <p><code>{{ c.calculation.formula }}</code></p>
                    <p>{{ c.calculation.explanation }}</p>
                    <a class="bpm-link" [routerLink]="['/object-management']" [queryParams]="{ inspect: c.id }">Traçabilité de la clôture →</a>
                  </div>
                </details>
              } @else if (d.closing.possible) {
                @if (!confirming()) {
                  <p class="bpm-help">{{ d.period.label }} est terminée. La clôture capitalise son résultat signé dans le Patrimoine, une seule fois, puis le cycle suivant repart à zéro.</p>
                  @if (d.closing.preview; as pv) {
                    <p>Montant qui serait capitalisé : <strong class="num" [class.pos]="pv.resultCents > 0" [class.neg]="pv.resultCents < 0">{{ pv.resultCents | signedCents }}</strong></p>
                  }
                  <div class="bpm-actions">
                    <button type="button" class="btn btn-secondary" (click)="askClose()" [disabled]="!d.closing.preview">Clôturer la période…</button>
                  </div>
                } @else {
                  <div class="bm-confirm" role="group" aria-labelledby="confirm-title">
                    <h3 id="confirm-title">Clôturer {{ d.period.label }} ?</h3>
                    @if (preview(); as pv) {
                      <p>
                        Résultat signé capitalisé :
                        <strong class="num" [class.pos]="pv.resultCents > 0" [class.neg]="pv.resultCents < 0">{{ pv.resultCents | signedCents }}</strong>
                        au {{ pv.capitalizationDate.slice(0, 10) | shortDate }}.
                      </p>
                      @if (pv.stockBefore !== null) {
                        <p>Effet sur le Patrimoine : stock enregistré {{ eur(pv.stockBefore) }} → {{ eur(pv.stockAfter) }}.</p>
                      } @else {
                        <p>Stock du Patrimoine à renseigner : le résultat sera capitalisé, le stock total restera inconnu.</p>
                      }
                      @if (pv.conditions.length) {
                        <ul class="bm-conditions">
                          @for (k of pv.conditions; track k) { <li>{{ k }}</li> }
                        </ul>
                      }
                      <p class="bpm-help">{{ pv.explanation }}</p>
                      <p>Les opérations financières de cette période ne pourront plus être modifiées. Cette action est définitive.</p>
                    }
                    @if (closeError(); as e) {
                      <p class="bpm-error" role="alert">{{ e }}</p>
                    }
                    <div class="bpm-actions">
                      <button type="button" class="btn btn-primary" [disabled]="closingNow() || !preview()" (click)="confirmClose(d.period.key)">{{ closingNow() ? 'Clôture en cours…' : 'Confirmer la clôture' }}</button>
                      <button type="button" class="btn btn-secondary" [disabled]="closingNow()" (click)="cancelClose()">Annuler</button>
                    </div>
                  </div>
                }
              } @else {
                <p class="bpm-help">{{ d.closing.reason ?? 'Clôture indisponible pour cette période.' }}</p>
              }
              @if (closedMessage()) {
                <div class="alert ok" role="status">{{ closedMessage() }}</div>
              }
            } @else {
              <bpm-state [loading]="dash.loading()" />
            }
          </section>

          <!-- 4. Historique -->
          @if (s.context.period) {
            <bpm-dashboard-history id="bm-history" [currentKey]="info()?.period?.key" />
          }
        }
      </div>
    </bpm-page>

    <!-- Un poste et ses échéances, sur le gabarit source des listes d'entrées et de charges -->
    <ng-template #flowGroup let-g let-income="income">
      <details class="expense-group expense-category" [attr.data-flow]="income ? 'income' : 'expense'">
        <summary class="expense-center-heading" data-ui-pattern="section-heading">
          <div>
            <h4>{{ g.label }}</h4>
            <p>{{ g.lines.length }} {{ income ? 'entrée(s)' : 'échéance(s)' }}</p>
          </div>
          <div class="expense-center-total">
            <small>{{ income ? 'Total des entrées listées' : 'Total des échéances' }}</small><strong><span aria-hidden="true">{{ income ? '↑' : '↓' }}</span> {{ g.total | cents }}</strong>
          </div>
          <p class="expense-center-breakdown">
            <span>{{ income ? 'Reçu' : 'Payé' }} <strong>{{ g.recorded | cents }}</strong></span>
            <span class="expense-pending-total">{{ income ? 'En attente' : 'À payer' }} <strong>{{ g.pending | cents }}</strong></span>
            @if (g.unrealized) {
              <span>{{ income ? 'Non reçu' : 'Non réalisé' }} <strong>{{ g.unrealized | cents }}</strong></span>
            }
          </p>
        </summary>
        <div class="expense-category-body">
          @for (l of g.lines; track l.id) {
            <article class="expense-row" [attr.data-status]="rowStatus(l)" [attr.data-selected]="lineParam() === l.id || null">
              <button type="button" class="expense-charge-summary" (click)="openLine(l.id)" [attr.aria-label]="l.label + ', ' + l.statusLabel + ' — ouvrir le détail'">
                <span class="expense-date">
                  <small>Date prévue</small>{{ l.plannedDate | shortDate }}
                  @if (l.realizedDate && l.realizedDate !== l.plannedDate) { <small>{{ income ? 'Réception réelle' : 'Date de paiement' }} · {{ l.realizedDate | shortDate }}</small> }
                  @if (outsideWindow(l)) { <small class="chip">Réglé hors de cette période</small> }
                </span>
                <span class="expense-main">
                  <strong>{{ l.label }}</strong>
                  <small>{{ l.cadenceLabel }}@if (l.taskTitle) { · {{ l.taskTitle }} }@if (l.note) { · note }</small>
                </span>
                <span class="expense-amount" [attr.data-flow]="income ? 'income' : 'expense'">
                  <strong><span class="expense-flow-sign" aria-hidden="true">{{ income ? '↑' : '↓' }}</span> {{ amountOf(l) | cents }}</strong>
                  @if (l.settled && l.realizedCents !== null && l.realizedCents !== l.plannedCents) { <small>Montant prévu · {{ l.plannedCents | cents }}</small> }
                </span>
                <span class="expense-state">{{ l.statusLabel }}</span>
              </button>
            </article>
          }
        </div>
      </details>
    </ng-template>

    @if (lineParam()) {
      <bpm-line-detail [lineId]="lineParam()" [period]="period()" (closed)="closeLine()" (edit)="startEdit($event)" />
    }
    @if (editorOpen() && budgets().length) {
      <bpm-operation-editor [budgets]="budgets()" [line]="editLine()" [defaults]="editorDefaults()" (closed)="closeEditor()" (saved)="onSaved($event)" />
    }
  `,
  styles: `
    :host { display: block; }
    .bm-caps-alert { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ecart-6) var(--ecart-12); margin: 0; padding: var(--ecart-10) var(--ecart-16); border: 1px solid color-mix(in srgb, var(--status-danger) 40%, var(--line)); border-radius: var(--radius-sm); background: var(--status-danger-surface); color: var(--status-danger); }
    .bm-caps-alert > span { color: var(--ink); }
    .bm-caps-alert a { margin-left: auto; font-weight: var(--fw-semibold); }
    .bm-head-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--ecart-8); }
    .bm-statement-head h2 { margin: 0; font-size: var(--fs-lg); }
    /* Corps d'un tiroir, comme l'hôte des listes source (rjs-bpm-income-list / rjs-bpm-period-expenses). */
    .bm-period-section > .bm-period-list { display: grid; gap: var(--ecart-20); min-width: 0; padding: 0 var(--ecart-24) var(--ecart-24); }
    .bm-period-list h4, .bm-period-list .expense-center-heading p { margin: 0; }
    .bm-standard-details { display: grid; gap: var(--ecart-12); }
    .bm-empty .btn { margin-inline-start: var(--ecart-12); }
    .bm-confirm { display: grid; gap: var(--ecart-8); padding: var(--ecart-16); border: 1px solid var(--status-warning); border-radius: var(--radius-md, 12px); background: var(--status-warning-surface); }
    .bm-confirm h3, .bm-confirm p { margin: 0; }
    .bm-conditions { margin: 0; padding-inline-start: var(--ecart-20); }
    .big { font-size: var(--fs-xl); font-weight: 600; }
    @media (max-width: 640px) {
      .bm-period-section > .bm-period-list { padding-inline: var(--ecart-12); }
    }
  `,
})
export class BpmDashboard {
  private ctx = inject(BpmPageContext);
  private bpm = inject(BpmApi);
  private api = inject(Api);
  private refresh = inject(BpmRefresh);
  /** Ancre de l'URL (#bm-period-income, #bm-projects…) : elle ouvre le tiroir visé, comme dans la source. */
  private fragment = toSignal(inject(ActivatedRoute).fragment, { initialValue: null });

  protected period = this.ctx.period;
  protected lineParam = this.ctx.q('ligne');
  protected carry = computed(() => this.ctx.carry() as Record<string, string>);

  // Lectures communes (rechargées après toute écriture, réponses périmées ignorées).
  protected summary = bpmLoader(() => this.period(), (p) => this.bpm.summary(p));
  protected dash = bpmLoader(() => this.period(), (p) => this.api.dashboard(p));
  protected register = bpmLoader(() => this.period(), (p) => this.bpm.register({ period: p, groupBy: 'none' }));
  protected recurrences = bpmLoader(() => 0, () => this.bpm.recurrences());
  protected lifeProjects = bpmLoader(() => 0, () => this.api.lifeProjects());
  protected centers = bpmLoader(() => this.period(), (p) => this.bpm.centers({ period: p, direction: 'charge' }));
  /** Plafonds dépassés de la période, lus avec le registre (aucune lecture de plus). */
  protected overCaps = computed(() => overCapsOf(this.register.data()?.caps, (ref) => this.centers.data()?.rows.find((r) => r.ref === ref)?.label));

  protected info = computed(() => this.summary.data()?.context ?? null);
  protected problem = computed(() => setupProblem(this.summary.error()));
  protected budgets = computed(() => this.info()?.budgets ?? []);
  private lifeBudgetId = computed(() => this.budgets().find((b) => b.role === 'life')?.id ?? null);
  protected periodName = computed(() => this.info()?.period?.label ?? 'Période à configurer');

  protected fig = (key: string) => this.summary.data()?.figures[key] ?? null;
  private v = (key: string) => this.fig(key)?.valueCents ?? null;
  private reason = (key: string) => {
    const f = this.fig(key);
    return f && f.valueCents === null ? (f.unavailableReason ?? 'Non calculable') : null;
  };
  /** Montant d'un chiffre ; inconnu reste « Inconnu », jamais zéro. */
  protected known = (key: string, signed = false) => {
    const c = this.v(key);
    return c === null ? 'Inconnu' : signed ? signedCents(c) : cents(c);
  };
  private closeDate = computed(() => {
    const end = this.info()?.period?.end;
    return end ? longDate.format(new Date(`${end.slice(0, 10)}T12:00:00Z`)) : null;
  });

  /** Phrase du bandeau (source `lead`) : elle oriente, les montants restent dans la lecture de la période. */
  protected lead = computed(() => {
    const data = this.summary.data();
    if (!data) return 'Lecture du relevé…';
    if (!data.context.period) return 'Cycle à configurer : les chiffres de la période sont inconnus.';
    if (data.closed) return 'Période clôturée : son solde a rejoint votre patrimoine.';
    const start = data.context.period.start;
    if (this.dash.data()?.period?.status === 'future') return `Début le ${longDate.format(new Date(`${start.slice(0, 10)}T12:00:00Z`))} : préparez vos flux.`;
    if (this.noOperation()) return 'Aucun flux réalisé : ajoutez vos entrées et charges.';
    const loose = this.chargeLines().filter((l) => !l.centerKnown).length;
    return 'Reçu, dépensé, disponible.' + (loose ? ` ${loose} dépense(s) restent à préciser.` : '');
  });

  // ---------- 1. chiffres clés (tuiles source) ----------

  protected tiles = computed<MetricTile[]>(() => {
    const data = this.summary.data();
    if (!data) return [];
    const query = this.carry();
    const recorded = data.closed ? ' Chiffre enregistré à la clôture.' : '';
    const sum = (a: number | null, b: number | null) => (a === null || b === null ? null : a + b);
    const received = this.v('bpm.revenus');
    const toReceive = this.v('bpm.resteARecevoir');
    const spent = this.v('bpm.charges');
    const toPay = this.v('bpm.resteAPayer');
    const net = this.v('bpm.resultatPeriode');
    const expected = this.v('bpm.soldeAttendu');
    const initial = this.v('bpm.resultatPrevu');
    const money = (c: number | null) => (c === null ? 'Inconnu' : cents(c));
    const sgn = (c: number | null) => (c === null ? 'Inconnu' : signedCents(c));
    const restDetails: MetricDetail[] = [{ label: data.closed ? 'Solde clôturé' : 'Solde prévu à la clôture', value: sgn(expected), tone: expected === null ? null : expected < 0 ? 'danger' : 'success' }];
    if (this.closeDate()) restDetails.push({ label: 'Clôture le', value: this.closeDate()! });
    if (!(initial === null && this.reason('bpm.resultatPrevu'))) restDetails.push({ label: 'Budget initial (référence)', value: sgn(initial) });
    const afterCharges = net === null || toPay === null ? null : net - toPay;
    // État du reste (source `restState`) : définitif une fois clos, provisoire couvert, ou à ce jour.
    const restNote =
      net === null
        ? null
        : data.closed
          ? net < 0 ? 'Pris sur votre patrimoine à la clôture.' : 'Le solde de clôture rejoindra votre patrimoine.'
          : net >= 0
            ? 'Le solde de clôture rejoindra votre patrimoine.'
            : expected !== null && expected >= 0
              ? `Provisoire : les entrées attendues le compensent (attendu ${sgn(expected)}).`
              : `À ce jour ; attendu ${sgn(expected)} à la fin de la période.`;
    return [
      {
        id: 'income',
        symbol: 'income',
        detailsPlacement: 'between',
        label: 'Reçu',
        value: money(received),
        tone: received === null ? null : 'success',
        details: [
          { label: 'À recevoir', value: money(toReceive), tone: 'success' },
          { label: 'Total de la période', value: money(sum(received, toReceive)) },
        ],
        note: (this.reason('bpm.revenus') ?? 'Reçu sur la période.') + recorded,
        link: '/argent/entrees',
        query,
      },
      {
        id: 'expense',
        symbol: 'expense',
        detailsPlacement: 'between',
        label: 'Dépensé',
        value: money(spent),
        tone: spent === null ? null : 'danger',
        details: [
          { label: 'À payer', value: money(toPay), tone: 'warning' },
          { label: 'Total de la période', value: money(sum(spent, toPay)) },
        ],
        note: (this.reason('bpm.charges') ?? 'Payé sur la période.') + recorded,
        link: '/depenses',
        query: { ...query, dateBasis: 'realized', status: 'settled' },
      },
      {
        id: 'rest',
        symbol: 'balance',
        detailsPlacement: 'aside',
        label: 'Reste',
        value: sgn(net),
        tone: net === null ? null : net < 0 ? (expected !== null && expected >= 0 && !data.closed ? 'warning' : 'danger') : net > 0 ? 'success' : null,
        emphasis: true,
        details: restDetails,
        checks: [
          { label: 'Prévision', value: expected === null ? 'Non calculable' : expected >= 0 ? '✓ Sans déficit prévu' : 'Déficit prévu', tone: expected === null ? null : expected >= 0 ? 'success' : 'danger' },
          { label: 'Reste après les charges à venir', value: sgn(afterCharges), tone: afterCharges === null ? null : afterCharges >= 0 ? 'success' : 'warning' },
        ],
        actions: [
          { label: 'Voir le calcul', link: '/tableau-de-bord', fragment: 'bm-calculation', query },
          { label: 'Voir les charges', link: '/depenses', query },
        ],
        note: (this.reason('bpm.resultatPeriode') ?? this.reason('bpm.soldeAttendu') ?? restNote ?? '') + recorded,
        link: '/argent/reste',
        query,
      },
    ];
  });

  protected calculationOpen = signal(false);
  protected incomeOpen = signal(false);
  protected expenseOpen = signal(false);
  protected projectsOpen = signal(false);
  protected revealFragment(fragment: string | null | undefined) {
    if (fragment === 'bm-calculation') this.calculationOpen.set(true);
    if (fragment === 'bm-period-income') this.incomeOpen.set(true);
    if (fragment === 'bm-period-expenses') this.expenseOpen.set(true);
    if (fragment === 'bm-projects') this.projectsOpen.set(true);
  }

  protected noOperation = computed(() => {
    const r = this.register.data();
    return !!r && r.totals.unfilteredCount === 0 && !this.summary.data()?.closed;
  });

  protected cmp(key: string, v: number | null) {
    return figureValue(v, this.fig(key)?.unit ?? 'EUR');
  }

  // ---------- patrimoine ----------

  protected stock = computed(() => this.v('bpm.patrimoineConstitue'));
  protected periodEffect = computed(() => this.v('bpm.resultatPeriode'));
  protected after = computed(() => this.v('bpm.patrimoineFinPeriode'));
  protected objective = computed(() => {
    const o = this.dash.data()?.patrimoine.objective;
    return o === null || o === undefined ? null : Math.round(o * 100);
  });

  // ---------- clôture (même contrat que la commande : C02) ----------

  protected confirming = signal(false);
  protected closingNow = signal(false);
  protected closeError = signal<string | null>(null);
  protected closedMessage = signal<string | null>(null);
  /** Aperçu figé au moment de la demande : c'est ce montant que la commande vérifie. */
  protected preview = signal<ClosingPreview | null>(null);
  private closeKey = newRequestKey('close');

  protected periodLabel = (st: string) => ({ closed: 'Clôturée', ended: 'Terminée', current: 'En cours', future: 'À venir' })[st] ?? st;
  protected periodTone = (st: string) => ({ closed: 'recorded', ended: 'warn', current: 'accent', future: 'estimate' })[st] ?? '';

  protected askClose() {
    this.closeError.set(null);
    this.closedMessage.set(null);
    this.preview.set(this.dash.data()?.closing.preview ?? null);
    this.confirming.set(true);
  }

  protected cancelClose() {
    this.confirming.set(false);
    this.closeError.set(null);
  }

  protected async confirmClose(periodKey: string) {
    const pv = this.preview();
    if (!pv || this.closingNow()) return;
    this.closingNow.set(true);
    this.closeError.set(null);
    try {
      const r = await this.api.closePeriod({ requestKey: this.closeKey, periodKey, expectedResultCents: pv.resultCents });
      this.closeKey = newRequestKey('close');
      this.confirming.set(false);
      this.closedMessage.set(`${r.closure.periodLabel} est close : ${signedCents(r.closure.resultCents)} capitalisés dans le Patrimoine.`);
      this.refresh.bump();
    } catch (err) {
      const e = toApiError(err);
      if (e.body.code === 'CLOSING_PREVIEW_STALE' && e.body.details?.['preview']) {
        // Données changées depuis l'aperçu : nouveau montant à relire avant une nouvelle confirmation.
        const fresh = e.body.details['preview'] as ClosingPreview;
        this.preview.set(fresh);
        this.closeKey = newRequestKey('close');
        this.closeError.set(`Les données ont changé depuis l’aperçu : le résultat à capitaliser est maintenant ${signedCents(fresh.resultCents)}. Relisez-le avant de confirmer.`);
      } else {
        this.closeError.set(e.message);
      }
    } finally {
      this.closingNow.set(false);
    }
  }

  // ---------- 2. budget de la période ----------

  /** Définitions récurrentes actives du Budget du projet de vie (entrées puis charges). */
  protected recurring = computed(() => {
    const life = this.lifeBudgetId();
    const from = this.info()?.period?.start ?? this.info()?.calculationDate ?? '';
    const active = (this.recurrences.data() ?? []).filter((r) => (!life || r.budgetId === life) && (!r.endDate || r.endDate >= from));
    return [...active.filter((r) => r.direction === 'income'), ...active.filter((r) => r.direction === 'charge')];
  });
  /** Lignes comptées : les charges spéciales des projets (budget attribué, dépassement) sont présentées dans Dépenses, jamais totalisées. */
  private lines = computed(() => (this.register.data()?.lines ?? []).filter((l) => !l.special));
  protected incomeLines = computed(() => this.lines().filter((l) => l.direction === 'income'));
  protected chargeLines = computed(() => this.lines().filter((l) => l.direction === 'charge'));
  /** Montant d'une échéance : réel une fois réglée, sinon prévu. */
  protected amountOf(l: RegisterLine) {
    return l.settled && l.realizedCents !== null ? l.realizedCents : l.plannedCents;
  }
  protected outsideWindow = (line: RegisterLine) => settlementOutsideWindow(line, this.register.data()?.window);
  private total = (lines: RegisterLine[]) => lines.reduce((sum, l) => sum + this.amountOf(l), 0);
  protected incomeTotal = computed(() => this.total(this.incomeLines()));
  protected chargeTotal = computed(() => this.total(this.chargeLines()));
  protected incomeSplit = computed(() => {
    const lines = this.incomeLines();
    return { recurring: this.total(lines.filter((l) => l.cadence !== 'once')), oneTime: this.total(lines.filter((l) => l.cadence === 'once')) };
  });
  protected incomeGroups = computed(() => this.group(this.incomeLines(), 'Poste non renseigné'));
  protected chargeGroups = computed(() => this.group(this.chargeLines(), 'Poste à préciser'));
  /** Regroupe par poste (du plus lourd au plus léger), puis par date prévue. */
  private group(lines: RegisterLine[], unknown: string): FlowGroup[] {
    const groups = new Map<string, FlowGroup>();
    for (const l of lines) {
      const key = l.centerKnown ? l.costCenterRef : '__none__';
      const g = groups.get(key) ?? { key, label: l.centerKnown ? (l.costCenterLabel ?? unknown) : unknown, lines: [], total: 0, recorded: 0, pending: 0, unrealized: 0 };
      g.lines.push(l);
      g.total += this.amountOf(l);
      if (l.settled) g.recorded += this.amountOf(l);
      else if (l.status === 'unrealized') g.unrealized += l.plannedCents;
      else g.pending += l.plannedCents;
      groups.set(key, g);
    }
    return [...groups.values()]
      .map((g) => ({ ...g, lines: [...g.lines].sort((a, b) => a.plannedDate.localeCompare(b.plannedDate) || a.label.localeCompare(b.label)) }))
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  }
  /** État source de la ligne : réglée = « recorded », ouverte = « pending », sinon non réalisée. */
  protected rowStatus(l: RegisterLine) {
    return l.status === 'settled' ? 'recorded' : l.status === 'unrealized' ? 'unrealized' : 'pending';
  }
  protected projectTaskCount = computed(() => (this.lifeProjects.data() ?? []).reduce((sum, lp) => sum + lp.view.time.taskCount, 0));
  protected money = cents;
  protected eur = euros;

  /** Une définition récurrente s'ouvre sur son occurrence de la période lue, sinon sur sa première occurrence. */
  protected openRecurrence(r: Recurrence) {
    const inPeriod = this.lines().find((l) => l.recurrenceId === r.id);
    this.openLine(inPeriod?.id ?? `${r.id}@${r.firstDate}`);
  }

  // ---------- zoom sur les postes : parcours de chaque euro et relevé ----------

  /** Barre et lecture « sur 100 € » : postes payés du plus lourd au plus léger, puis ce qui reste. */
  protected flow = computed(() => {
    const c = this.centers.data();
    if (!c || c.basis.baseCents <= 0) return null;
    const base = c.basis.baseCents;
    const items: Omit<FlowPart, 'pct' | 'euros'>[] = c.rows
      .filter((r) => r.paidCents > 0)
      .sort((a, b) => b.paidCents - a.paidCents)
      .map((r) => ({ key: r.ref, nature: 'poste' as const, name: r.label, cents: r.paidCents }));
    if (c.basis.kind === 'received' && c.basis.restCents) items.push({ key: '__rest__', nature: 'reste', name: 'Reste versé au patrimoine', cents: c.basis.restCents });
    const parts = items.map((p) => ({ ...p, pct: Math.round((p.cents / base) * 1000) / 10, euros: Math.round((p.cents / base) * 100) }));
    return { basis: c.basis.kind, bar: parts.filter((p) => p.cents > 0), parts: parts.filter((p) => p.cents !== 0) };
  });
  protected flowLabel = computed(() => (this.flow()?.bar ?? []).map((p) => `${p.name} ${percentText(p.pct)}`).join(', '));
  /** Relevé ligne par ligne : centres payés (du plus grand au plus petit), puis ceux encore sans paiement. */
  protected statementRows = computed(() => {
    const rows = this.centers.data()?.rows ?? [];
    const paid = rows.filter((r) => r.paidCents > 0).sort((a, b) => b.paidCents - a.paidCents);
    const pending = rows.filter((r) => r.paidCents === 0 && r.remainingCents > 0);
    return [...paid, ...pending];
  });
  /** Rappels d'une ligne (source `reminders`) : prévu restant, part de la base, plafond. */
  protected reminder(r: CenterRow, basis: 'received' | 'spent') {
    const parts: string[] = [];
    if (r.paidCents === 0) parts.push('Sans paiement encore');
    if (r.remainingCents > 0) parts.push(`+ ${cents(r.remainingCents)} encore prévus`);
    if (r.sharePct !== null && r.paidCents > 0) parts.push(`${percentText(r.sharePct)} ${basis === 'received' ? 'des entrées' : 'des dépenses'}`);
    if (r.capCents !== null) parts.push(r.marginCents !== null && r.marginCents < 0 ? `plafond ${cents(r.capCents)} dépassé de ${cents(-r.marginCents)}` : `plafond ${cents(r.capCents)}`);
    return parts.join(' · ');
  }
  protected incomeReminder = computed(() => {
    const toReceive = this.v('bpm.resteARecevoir');
    return toReceive ? `Reçu sur la période · + ${cents(toReceive)} attendus` : 'Reçu sur la période, à date de règlement';
  });
  /** Le nom du reste : définitif une fois clos, « à ce jour » tant que la période est ouverte. */
  protected restLabel = computed(() => {
    if (!this.summary.data()?.closed) return 'Reste à ce jour';
    return (this.periodEffect() ?? 0) < 0 ? 'Pris sur le patrimoine' : 'Reste versé au patrimoine';
  });
  protected restReminder = computed(() => {
    if (this.summary.data()?.closed) {
      const after = this.after();
      return after === null ? 'Clôturée' : `Clôturée · patrimoine après la clôture : ${signedCents(after)}`;
    }
    const expected = this.v('bpm.soldeAttendu');
    const end = this.closeDate();
    return `${end ? `Fin de période le ${end} · ` : ''}attendu ${expected === null ? 'inconnu' : signedCents(expected)} si tout le prévu se réalise`;
  });
  protected min = Math.min;

  // ---------- navigation, détail et éditeur ----------

  protected editorOpen = signal(false);
  protected editLine = signal<RegisterLine | null>(null);
  protected editorDefaults = signal<Partial<EntryInput>>({});
  /** Message laissé par l'assistant « Partir de zéro » (état de navigation `bpmNotice`). */
  protected notice = signal<string | null>((history.state as { bpmNotice?: string } | null)?.bpmNotice ?? null);

  constructor() {
    // Changement de période : l'étape de confirmation de clôture repart de zéro.
    effect(() => {
      this.period();
      untracked(() => {
        this.confirming.set(false);
        this.closeError.set(null);
        this.closedMessage.set(null);
        this.closeKey = newRequestKey('close');
      });
    });
    // Un lien vers un tiroir (#bm-period-income, #bm-projects…) l'ouvre, comme dans la source.
    effect(() => {
      const fragment = this.fragment();
      untracked(() => this.revealFragment(fragment));
    });
  }

  protected goPeriod(key: string | null) {
    this.ctx.setQuery({ period: key });
  }
  protected openLine(id: string) {
    this.ctx.setQuery({ ligne: id });
  }
  protected closeLine() {
    this.ctx.setQuery({ ligne: null });
  }
  protected openCreate() {
    this.editLine.set(null);
    this.editorDefaults.set({});
    this.editorOpen.set(true);
  }
  protected startEdit(line: RegisterLine) {
    this.closeLine();
    this.editLine.set(line);
    this.editorDefaults.set({});
    this.editorOpen.set(true);
  }
  protected closeEditor() {
    this.editorOpen.set(false);
    this.editLine.set(null);
  }
  protected onSaved(message: string) {
    this.closeEditor();
    this.notice.set(message);
  }
}
