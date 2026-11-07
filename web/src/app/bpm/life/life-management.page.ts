import { injectPageWorkspace } from '../../shared/page-workspace';
import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api, newRequestKey, RecetteContext, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmLifeManagement, LifeHealth, LifeLine } from '../../core/bpm-life.models';
import { CHARGE_NATURE_LABEL, ChargeNature, EntryInput, RegisterLine } from '../../core/bpm-models';
import { ProjectOverrun } from '../../core/bpm-projects.models';
import { cents, CentsPipe, percentText, ShortDatePipe, SignedCentsPipe } from '../../core/format';
import { ModalComponent } from '../../shared/modal.component';
import { BpmOverrunRequestComponent } from '../projects/project-parts';
import { BpmPageBanner, BpmPageFocus, BpmPageResult, BpmPageContext, BpmEntryFlow, bpmQueryState, BpmLineDetail, BpmRefresh, FUNDING, ProjectFunding } from '../ui';
import { BpmActBudgetType } from '../pages/act-budget-type';
import { BpmFragmentNavigation } from '../ui/fragment-navigation';
import { BpmLifeFundingComponent } from './life-funding';
import { BpmLifeGaugeComponent } from './life-gauge';
import { OBJECTIVE_FRAGMENTS } from '../objectives/objectives-model';
import { followCount, lifeVolets, VoletAction, VoletLink, VoletView } from './life-volets';

/**
 * Gestion du projet de vie : l'équivalent de « Gestion de projet » pour le projet unique du user, celui qui
 * englobe tous les autres. Six volets pleine largeur (cycle en cours, charges indispensables, charges
 * courantes, projets de la vie financés, résultats des cycles et objectif d'excédent, patrimoine), chacun
 * avec sa synthèse d'un coup d'œil, son détail dépliable et ses commandes. Les chiffres sont ceux du tableau
 * de bord (mêmes métriques) ; l'usage de l'excédent relève d'un module à venir.
 */
@Component({
  selector: 'app-bpm-life-management',
  providers: [BpmPageContext],
  styleUrls: ['../projects/projects.page.scss', './life-management.page.scss'],
  imports: [BpmEntryFlow, BpmPageBanner, RouterLink, NgTemplateOutlet, CentsPipe, SignedCentsPipe, ShortDatePipe, ModalComponent, BpmOverrunRequestComponent, BpmLineDetail, BpmLifeGaugeComponent, BpmLifeFundingComponent, BpmActBudgetType, BpmFragmentNavigation],
  template: `
    <div class="page page-wide bpm-projects bpm-project-page bpm-management bpm-life-management" bpmFragmentNavigation [bpmFragmentReady]="!!data()">
      <bpm-page-banner
        title="Gestion du projet de vie"
        lead="Pilotez votre cycle, réglez l’essentiel à temps et décidez de ce que vos projets peuvent recevoir."
        [context]="data()?.context"
        [periodNav]="true"
        [focus]="pageFocus()"
        [scope]="pageScope()"
        [result]="pageResult()"
        toolsLabel="Piloter le projet de vie"
      >
        @if (!workspace() && data()?.cycle?.status === 'to_configure') {
          <a primary class="btn btn-primary" routerLink="/app/reglages">Configurer mon cycle</a>
        } @else {
          <button primary class="btn btn-primary" type="button" [disabled]="!data() || busy() || (workspace()?.key === 'life-budget' && (!budgetType()?.ready() || budgetType()?.saving()))" (click)="runPriority()">{{ priorityLabel() }}</button>
        }
        @if (workspace()?.key === 'life-budget') {
          <ng-container actions>
          <button actions class="btn btn-secondary" type="button" [disabled]="!budgetType()?.ready() || budgetType()?.saving()" (click)="budgetType()?.addRecurring('income')">＋ Entrée récurrente</button>
          @if (budgetType()?.pendingChanges()) { <button actions class="btn btn-secondary" type="button" [disabled]="budgetType()?.saving()" (click)="budgetType()?.addRecurring('charge')">＋ Dépense récurrente</button> }
          <a actions class="bpm-link" routerLink="/depenses/registre" queryParamsHandling="preserve">Vérifier les échéances générées →</a>
          </ng-container>
        } @else {
          <button actions class="btn btn-secondary" type="button" [disabled]="!budgets().length" (click)="openEntry()">＋ Saisir une entrée ou une dépense</button>
        }
        @if (!workspace() && priorityKind() !== 'budget') {
          <button actions class="btn btn-secondary" type="button" [disabled]="!data()" (click)="budgetTypeOpen.set(true)">Budget type</button>
        }
        @if (!workspace() && pending() && priorityKind() !== 'follow') {
          <button actions class="btn btn-secondary" type="button" (click)="followOpen.set(true)">Suivi et clôture <span class="life-alert-count">{{ pending() }}</span></button>
        }
        <div tools class="life-context-tools">
        @if (!workspace()) {
          <label>
            Afficher les volets
            <select [value]="filter()" (change)="filter.set($any($event.target).value)">
              <option value="all">Tous les volets</option>
              <option value="alert">À traiter</option>
              <option value="watch">À surveiller</option>
              <option value="ok">En règle</option>
              <option value="unknown">À renseigner</option>
            </select>
          </label>
          @if (data()?.dueSoon?.lines?.length) {
            <div class="life-budget-project">
              <label>Échéance à régler
                <select [value]="dueChoice()" (change)="dueChoice.set($any($event.target).value)">
                  <option value="">Choisir une échéance à examiner…</option>
                  @for (l of data()!.dueSoon.lines; track l.id) {
                    <option [value]="l.id">{{ l.plannedDate | shortDate }} · {{ l.label }} · {{ l.plannedCents | cents }}{{ l.status === 'late' ? ' (en retard)' : '' }}</option>
                  }
                </select>
              </label>
            </div>
          }
          @if (capOverCount()) {
            <a class="btn btn-secondary" routerLink="/plafonds" [queryParams]="{ period: period(), show: 'over' }">Traiter {{ capOverCount() }} dépassement(s)</a>
          } @else if (data() && data()!.results.savingsTargetCents === null) {
            <a class="btn btn-secondary" routerLink="/vision/reperes" fragment="epargne">Fixer mon épargne visée</a>
          } @else if (nextUnfunded(); as project) {
            <a class="btn btn-secondary" [routerLink]="['/app/gestion-projet', project.coreProjectId]">Préparer les projets sans enveloppe</a>
          }
        } @else if (workspace()?.key === 'life-budget') {
          <p>{{ budgetType()?.pendingChanges() ?? 0 }} modification(s) à enregistrer · les règlements existants restent conservés.</p>
        } @else {
          <a class="btn btn-secondary" routerLink="/tableau-de-bord/rapprochement" queryParamsHandling="preserve">Vérifier le compte avant la clôture</a>
          <span>{{ data()?.results?.toCloseCount ?? 0 }} cycle(s) terminé(s) à clôturer</span>
        }
        </div>
      </bpm-page-banner>

      @if (!workspace()) {
      <section class="life-summary" aria-label="Synthèse du projet de vie" [attr.aria-busy]="!data()">
        <div class="life-project-stats" aria-label="État des volets du projet de vie">
          <div class="life-stat life-stat-total">
            <span>Volets à traiter</span><strong>{{ data() ? data()!.pilot.counts.alert : '—' }}</strong>
          </div>
          @for (h of summaryHealths; track h.key) {
            <div class="life-stat">
              <span><i class="status-dot life-health-dot" [attr.data-health]="h.key" aria-hidden="true"></i>{{ h.label }}</span
              ><strong>{{ data() ? data()!.pilot.counts[h.key] : '—' }}</strong>
            </div>
          }
          <div class="life-progress">
            <span>Période écoulée</span><strong>{{ data()?.cycle?.days ? pct(data()!.cycle.days!.elapsedPct) : '—' }}</strong>
            <div
              class="progress-track"
              role="progressbar"
              aria-label="Part écoulée du cycle"
              [attr.aria-valuenow]="data()?.cycle?.days?.elapsedPct ?? null"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span [style.width.%]="data()?.cycle?.days?.elapsedPct ?? 0"></span>
            </div>
          </div>
        </div>
        <dl class="life-financial-stats" [attr.aria-label]="'Budget du cycle · ' + (data()?.cycle?.period?.label ?? '—')">
          <div class="life-financial-stat life-allocated">
            <dt>Reçu</dt>
            <dd>{{ data() ? (data()!.cycle.flows?.receivedCents | cents) : '—' }}</dd>
            <span>Entrées du cycle</span>
          </div>
          <div class="life-financial-stat life-paid">
            <dt>Dépensé</dt>
            <dd>{{ data() ? (data()!.cycle.flows?.paidCents | cents) : '—' }}</dd>
            <span>Projets validés inclus</span>
          </div>
          <div class="life-financial-stat life-remaining" [class.is-negative]="(data()?.cycle?.flows?.netCents ?? 0) < 0">
            <dt>{{ readingText().net }}</dt>
            <dd>{{ data() ? (data()!.cycle.flows?.netCents | signedCents) : '—' }}</dd>
            <span>Reçu − dépensé</span>
          </div>
          <div class="life-financial-stat life-available" [class.is-negative]="(data()?.cycle?.flows?.expectedCents ?? 0) < 0">
            <dt>{{ readingText().expected }}</dt>
            <dd>{{ data() ? (reading() === 'closed' ? (data()!.cycle.closedResultCents | signedCents) : (data()!.cycle.flows?.expectedCents | signedCents)) : '—' }}</dd>
            <span>{{ readingText().expectedNote }}</span>
          </div>
        </dl>
      </section>

      }
      @if (reading() && reading() !== 'current') {
        <p class="life-reading-note" role="status">
          Vous consultez <strong>{{ data()!.cycle.period!.label }}</strong> ({{ readingText().status.toLowerCase() }}) : les volets
          montrent cette période. Les échéances à régler, les décisions et la clôture restent celles d’aujourd’hui.
          <a [routerLink]="[]" [queryParams]="{ period: null }">Revenir à la période en cours →</a>
        </p>
      }
      @if (error()) {
        <div class="empty-state" role="alert">
          <h2>Gestion du projet de vie indisponible</h2>
          <p>{{ error() }}</p>
          <button class="btn btn-secondary" type="button" (click)="load()">Réessayer</button>
        </div>
      } @else if (!data()) {
        <p role="status">Chargement du projet de vie…</p>
      }

      @if (data(); as d) {
        @if (!workspace()) {
        <section class="bpm-section" aria-labelledby="life-volets-title">
          <header>
            <h2 id="life-volets-title">{{ d.lifeProject.title }}</h2>
            <span class="bpm-note">{{ d.pilot.counts.ok }} volet(s) en règle sur 6 · {{ d.context.user.label }}</span>
            <a class="btn btn-secondary life-fiche-link" [routerLink]="['/app/gestion-projet', d.lifeProject.coreProjectId]">Fiche du projet de vie →</a>
          </header>
          <!-- Projet non standard : unique, rattaché au patrimoine, il porte et finance les projets de la vie. -->
          <ul class="life-relations" aria-label="Rattachements du projet de vie">
            <li><span class="life-relation-kind">Projet de vie</span> unique pour {{ d.context.user.label }}</li>
            <li><span class="life-relation-kind">Patrimoine</span> {{ d.patrimoine.stockCents | cents }} enregistrés</li>
            <li>
              <span class="life-relation-kind">Projets de la vie</span>
              {{ d.projects.projectCount }} rattaché{{ d.projects.projectCount > 1 ? 's' : '' }} · {{ d.projects.fundedCount }} financé{{ d.projects.fundedCount > 1 ? 's' : '' }}
              <a [routerLink]="[]" queryParamsHandling="preserve" fragment="life-funding-title">par une enveloppe</a>
            </li>
          </ul>
          <div class="bpm-management-grid">
            @for (v of visibleVolets(); track v.key) {
              <article
                class="bpm-management-card life-volet"
                [class.is-expanded]="expanded().has(v.key)"
                [attr.data-volet]="v.key"
                [attr.data-health]="v.health"
                [attr.aria-label]="'Volet ' + v.title"
              >
                <div class="bpm-panel pm-project-overview">
                  <div class="bpm-project-row-summary">
                    <div class="bpm-project-links">
                      <span class="pm-life-health" [attr.data-health]="v.health">{{ v.healthLabel }}</span
                      ><span class="pm-life-tag"><span class="pm-life-index" aria-hidden="true">{{ v.index }}</span>{{ v.tag }}</span>
                    </div>
                    <h3>
                      <a [routerLink]="v.link.link" [fragment]="v.link.fragment" [queryParams]="v.link.queryParams" [title]="v.title">{{ v.title }}</a>
                    </h3>
                    <p class="pm-project-description">
                      <span [title]="v.description">{{ v.description }}</span>
                    </p>
                    <dl class="pm-project-facts">
                      @for (f of v.facts; track f.label) {
                        <div>
                          <dt>{{ f.label }}</dt>
                          <dd>{{ f.value }}</dd>
                          <small>{{ f.note ?? '' }}</small>
                        </div>
                      }
                    </dl>
                  </div>
                  @if (!v.hideGauge) {
                    <div class="bpm-project-row-budget">
                      <bpm-life-gauge [gauge]="v.gauge" />
                    </div>
                  }
                  @if (v.alert) {
                    <p class="pm-project-alert" [attr.data-health]="v.health">{{ v.alert }}</p>
                  }
                  <button
                    type="button"
                    class="pm-project-disclosure"
                    [attr.aria-expanded]="expanded().has(v.key)"
                    [attr.aria-controls]="'life-volet-' + v.key"
                    (click)="toggle(v.key)"
                  >
                    <span
                      ><strong>{{ expanded().has(v.key) ? 'Masquer le détail' : v.disclosure.label }}</strong
                      ><span>{{ v.disclosure.summary }}</span></span
                    >
                    <span class="pm-disclosure-sign" aria-hidden="true">{{ expanded().has(v.key) ? '−' : '+' }}</span>
                  </button>
                </div>
                <aside class="pm-project-command-panel" [attr.aria-label]="'Commandes du volet ' + v.title">
                  <div class="bpm-actions bpm-project-row-actions" [attr.aria-label]="'Actions du volet ' + v.title">
                    @if (v.primary.action) {
                      <button class="btn btn-primary" type="button" [disabled]="busy()" (click)="act(v.primary)">{{ v.primary.label }}</button>
                    } @else {
                      <a class="btn btn-primary" [routerLink]="v.primary.link" [fragment]="v.primary.fragment" [queryParams]="v.primary.queryParams">{{ v.primary.label }}</a>
                    }
                    @for (a of v.actions; track a.label) {
                      @if (a.action) {
                        <button class="btn btn-secondary" type="button" [disabled]="busy() || (a.action.startsWith('entry') && !budgets().length)" (click)="act(a)">{{ a.label }}</button>
                      } @else {
                        <a class="btn btn-secondary" [routerLink]="a.link" [fragment]="a.fragment" [queryParams]="a.queryParams">{{ a.label }}</a>
                      }
                    }
                  </div>
                  <dl class="pm-command-figures" [attr.aria-label]="'Repères du volet ' + v.title">
                    @for (f of v.figures; track f.label) {
                      <div [class.has-pending]="f.pending">
                        <dt>{{ f.label }}</dt>
                        <dd>{{ f.value }}</dd>
                      </div>
                    }
                  </dl>
                </aside>
                @if (expanded().has(v.key)) {
                  <div class="pm-project-tasks life-volet-detail" [id]="'life-volet-' + v.key" [attr.aria-label]="'Détail du volet ' + v.title">
                    @switch (v.key) {
                      @case ('cycle') {
                        @if (d.cycle.flows; as f) {
                          <div class="pm-project-finance">
                            <p class="pm-detail-eyebrow">Du budget initial au solde prévu</p>
                            <dl class="pm-finance-summary">
                              <div>
                                <dt>Budget initial</dt>
                                <dd>{{ f.initialBudgetCents | signedCents }}</dd>
                                <small>Montants prévus du cycle</small>
                              </div>
                              <div>
                                <dt>Écart au budget initial</dt>
                                <dd [class.is-deficit]="(f.gapToInitialCents ?? 0) < 0">{{ f.gapToInitialCents | signedCents }}</dd>
                                <small>Solde prévu − budget initial</small>
                              </div>
                              <div>
                                <dt>Charges des projets validées</dt>
                                <dd>{{ f.projectsPaidCents | cents }}</dd>
                                <small>Comptées dans le Dépensé</small>
                              </div>
                            </dl>
                          </div>
                          <ng-container *ngTemplateOutlet="lineTable; context: { $implicit: f.incomeLines, empty: 'Aucune entrée prévue dans le cycle.', caption: 'Entrées du cycle' }" />
                        } @else {
                          <p class="bpm-note">Le cycle est à configurer : choisissez son jour d’ancrage dans <a routerLink="/app/reglages">les réglages</a>.</p>
                        }
                      }
                      @case ('indispensable') {
                        <ng-container *ngTemplateOutlet="natureDetail; context: { $implicit: d.natures.indispensable }" />
                      }
                      @case ('courante') {
                        <ng-container *ngTemplateOutlet="natureDetail; context: { $implicit: d.natures.courante }" />
                      }
                      @case ('projets') {
                        <div class="bpm-table-wrap">
                          <table class="bpm-table">
                            <caption class="visually-hidden">Projets de la vie financés par le projet de vie</caption>
                            <thead>
                              <tr><th>Projet</th><th>Avancement</th><th>{{ L.envelope }}</th><th>{{ L.paidOnEnvelope }}</th><th>{{ L.remaining }}</th><th>Réglé ce cycle</th></tr>
                            </thead>
                            <tbody>
                              @for (p of d.projects.projects; track p.budgetId) {
                                <tr [attr.data-state]="p.state">
                                  <th><a [routerLink]="['/app/gestion-projet', p.coreProjectId]" [queryParams]="shownKey() ? { lifePeriod: shownKey() } : {}">{{ p.name }}</a>@if (p.pendingOverrun) { <small class="life-flag">Décision attendue</small> }</th>
                                  <td>{{ p.statusLabel ?? '—' }}</td>
                                  <td>{{ p.regime ? (p.allocationCents | cents) : 'À attribuer' }}</td>
                                  <td>{{ p.paidCents | cents }}</td>
                                  <td [class.is-deficit]="(p.remainingCents ?? 0) < 0">{{ p.remainingCents | cents }}</td>
                                  <td>{{ p.periodPaidCents | cents }}</td>
                                </tr>
                              } @empty {
                                <tr><td colspan="6">Aucun projet de la vie n’est encore financé. <a routerLink="/app/gestion-projet">Budgéter un projet</a>.</td></tr>
                              }
                            </tbody>
                          </table>
                        </div>
                        @if (d.projects.pendingRequests.length || d.projects.billable.length) {
                          <div class="bpm-actions">
                            <button class="btn btn-secondary" type="button" (click)="followOpen.set(true)">
                              Décider ({{ d.projects.pendingRequests.length }}) · Facturer ({{ d.projects.billable.length }})
                            </button>
                          </div>
                        }
                      }
                      @case ('resultats') {
                        <div class="bpm-table-wrap">
                          <table class="bpm-table">
                            <caption class="visually-hidden">Résultats des cycles clôturés</caption>
                            <thead>
                              <tr><th>Cycle</th><th>Résultat capitalisé</th><th>Objectif du cycle</th><th>Objectif tenu</th></tr>
                            </thead>
                            <tbody>
                              @for (r of d.results.rows; track r.closureId) {
                                <tr>
                                  <th>{{ r.periodLabel }}</th>
                                  <td [class.is-deficit]="r.resultCents < 0">{{ r.resultCents | signedCents }}</td>
                                  <td>{{ r.targetCents === null ? 'Sans objectif' : (r.targetCents | cents) }}</td>
                                  <td>{{ r.meetsTarget === null ? '—' : r.meetsTarget ? 'Oui' : 'Non' }}</td>
                                </tr>
                              } @empty {
                                <tr><td colspan="4">Aucun cycle clôturé pour l’instant.</td></tr>
                              }
                            </tbody>
                          </table>
                        </div>
                        <p class="bpm-note life-surplus-note">{{ d.results.surplusUseNote }}</p>
                      }
                      @case ('patrimoine') {
                        <div class="pm-project-finance">
                          <p class="pm-detail-eyebrow">Ce qui s’accumule</p>
                          <dl class="pm-finance-summary">
                            <div>
                              <dt>Stock d’ouverture</dt>
                              <dd>{{ d.patrimoine.openingStockCents | cents }}</dd>
                              <small>{{ d.patrimoine.openingDate ? 'au ' + (d.patrimoine.openingDate | shortDate) : 'Date à renseigner' }}</small>
                            </div>
                            <div>
                              <dt>Résultats capitalisés</dt>
                              <dd>{{ d.patrimoine.capitalizedCents | signedCents }}</dd>
                              <small>{{ d.patrimoine.capitalizationCount }} clôture(s)</small>
                            </div>
                            <div>
                              <dt>Si tout le prévu se réalise</dt>
                              <dd>{{ d.patrimoine.expectedAfterCents | cents }}</dd>
                              <small>Stock + solde prévu du cycle</small>
                            </div>
                          </dl>
                        </div>
                        <p class="bpm-note life-surplus-note">{{ d.patrimoine.surplusUseNote }}</p>
                      }
                    }
                  </div>
                }
              </article>
            } @empty {
              <div class="bpm-panel">
                <h3>Aucun volet pour ce filtre</h3>
                <p>Tous les volets du projet de vie sont dans un autre état.</p>
                <button class="btn btn-secondary" type="button" (click)="filter.set('all')">Afficher tous les volets</button>
              </div>
            }
          </div>
        </section>


        <section class="life-budget-type-disclosure" id="life-budget-type" aria-labelledby="life-budget-type-title">
          <h2 id="life-budget-type-title">Budget type et dépenses récurrentes</h2>
          <p>Préparez les entrées et charges des prochaines périodes. Le panneau reste accessible depuis le bandeau.</p>
          <button class="btn btn-secondary" type="button" (click)="budgetTypeOpen.set(true)">Ouvrir le budget type</button>
        </section>
        <rjs-modal [open]="budgetTypeOpen()" [headed]="true" [wide]="true" title="Préparer mon budget type" (closed)="budgetTypeOpen.set(false)">
          @if (budgetTypeLoaded()) { <bpm-act-budget-type [showCaps]="false" /> }
          <button class="btn btn-secondary" type="button" (click)="budgetTypeOpen.set(false)">Fermer et conserver la saisie</button>
        </rjs-modal>

        @if (d.projects.projectCount || d.projects.pendingRequests.length) {
          <section class="bpm-section" id="life-funding" aria-labelledby="life-funding-title">
            <header>
              <h2 id="life-funding-title">Financement des projets de la vie</h2>
              <span class="count-badge">{{ d.projects.projectCount }}</span>
            </header>
            <p class="bpm-note">
              Le budget du projet de vie porte tous les projets de la vie qui lui sont rattachés et finance chacun par une enveloppe.
              Pour chaque projet : son enveloppe, la période où elle a été attribuée, ses dépassements et ce qu’il a fait
              remonter au budget du projet de vie à chaque cycle.
            </p>
            <bpm-life-funding [funding]="d.projects.funding" [highlight]="shownKey()" />
          </section>

          <section class="bpm-section" id="life-decisions" aria-labelledby="life-decisions-title">
            <header>
              <h2 id="life-decisions-title">Décisions attendues</h2>
              <span class="count-badge">{{ d.projects.pendingRequests.length + d.projects.taskRequestCount }}</span>
            </header>
            <p class="bpm-note">
              Ce que les projets demandent au projet de vie : autoriser un dépassement d’enveloppe (facturé en fin de cycle) et,
              dans chaque projet, accorder les parts demandées par les tâches.
            </p>
            @for (o of d.projects.pendingRequests; track o.id) {
              <bpm-overrun-request [overrun]="o" [busy]="busy()" (decide)="decideOverrun(o, $event)" />
              <p class="bpm-note"><a [routerLink]="['/app/gestion-projet', o.coreProjectId]" [queryParams]="shownKey() ? { lifePeriod: shownKey() } : {}">Ouvrir le projet « {{ o.budgetName }} » →</a></p>
            } @empty {
              <p class="bpm-note">Aucune autorisation de dépassement en attente.</p>
            }
            @if (d.projects.taskRequests?.length) {
              <ul class="life-task-requests">
                @for (r of d.projects.taskRequests; track r.id) {
                  <li>
                    Part demandée pour « {{ r.taskTitle }} » ({{ r.budgetName }}) : {{ r.amountCents | cents }}
                    @if (r.grantedCents) { <small>· {{ r.grantedCents | cents }} déjà accordés</small> }
                    · <a [routerLink]="['/app/gestion-projet', r.coreProjectId]" [queryParams]="shownKey() ? { lifePeriod: shownKey() } : {}" fragment="requests-title">Accorder ou refuser dans le projet →</a>
                  </li>
                }
              </ul>
            }
            @if (d.projects.billable.length) {
              <div class="bpm-actions">
                <button class="btn btn-primary" type="button" [disabled]="busy()" (click)="bill()">
                  Facturer les dépassements au projet de vie ({{ d.projects.billableCents | cents }})
                </button>
              </div>
            } @else if (d.projects.nextBillingDate) {
              <p class="bpm-note">Prochaine facturation des dépassements autorisés : {{ d.projects.nextBillingDate | shortDate }}.</p>
            }
          </section>
        } @else {
          <!-- Sans projet de la vie : une seule section courte au lieu d'un tableau et d'une file de décisions vides. -->
          <section class="bpm-section" id="life-funding" aria-labelledby="life-funding-title">
            <header>
              <h2 id="life-funding-title">Projets de la vie</h2>
              <span class="count-badge">0</span>
            </header>
            <p class="bpm-note" id="life-decisions">
              Aucun projet de la vie n’est rattaché : aucune enveloppe à suivre ni décision attendue. Un projet de la vie finance
              une envie (voyage, travaux, formation…) par une enveloppe ; ses dépenses validées entrent alors dans le cycle.
            </p>
            <div class="bpm-actions"><a class="btn btn-primary" routerLink="/creer/projet-de-la-vie">Créer un projet de la vie</a></div>
          </section>
        }

        <section class="bpm-section" id="life-due" aria-labelledby="life-due-title">
          <header>
            <h2 id="life-due-title">Échéances à régler</h2>
            <span class="count-badge">{{ d.dueSoon.lines.length }}</span>
          </header>
          <p class="bpm-note">
            Échéances ouvertes à ce jour, quelle que soit la période consultée — celles du projet de vie et les dépenses
            prévues de ses projets : en retard depuis le {{ d.dueSoon.from | shortDate }}, puis celles des sept prochains jours.
            Ouvrez une échéance pour la régler ou la modifier ; la dépense réglée d’un projet financé entre dans le Dépensé à sa date réelle.
          </p>
          <ng-container *ngTemplateOutlet="lineTable; context: { $implicit: d.dueSoon.lines, empty: 'Aucune échéance ouverte : tout est réglé.', caption: 'Échéances à régler', nature: true }" />
        </section>

        <p class="bpm-note life-essentials-note">
          Charges indispensables : {{ d.essentials.labels.join(', ') || 'aucun poste' }}. Les autres charges du budget du projet de vie sont
          courantes. Cette répartition peut être ajustée dans les paramètres de l’application.
        </p>

        @if (followOpen()) {
          <rjs-modal [open]="followOpen()" [headed]="true" title="Suivi et clôture du projet de vie" [busy]="busy()" (closed)="followOpen.set(false)">
            <ng-container *ngTemplateOutlet="followContent; context: { $implicit: d }" />
          </rjs-modal>
        }
        } @else if (workspace()?.key === 'life-budget') {
          <bpm-act-budget-type [showCaps]="false" />
        } @else if (workspace()?.key === 'life-closing') {
          <ng-container *ngTemplateOutlet="followContent; context: { $implicit: d }" />
        }
      }
    </div>

    <ng-template #followContent let-d>
            <p>{{ d.context.user.label }} · {{ d.lifeProject.title }} · {{ d.cycle.period?.label ?? 'Cycle à configurer' }}</p>
            <dl class="bpm-kpis">
              <div>
                <dt>{{ readingText().net }}</dt>
                <dd>{{ d.cycle.flows?.netCents | signedCents }}</dd>
              </div>
              <div>
                <dt>Solde prévu à la clôture</dt>
                <dd>{{ d.cycle.flows?.expectedCents | signedCents }}</dd>
              </div>
              <div>
                <dt>Stock enregistré</dt>
                <dd>{{ d.patrimoine.stockCents | cents }}</dd>
              </div>
              <div>
                <dt>Cycles à clôturer</dt>
                <dd>{{ d.results.toCloseCount }}</dd>
              </div>
            </dl>
            @if (notice(); as n) {
              <p class="bpm-feedback" [class.is-error]="n.error" [attr.role]="n.error ? 'alert' : 'status'">{{ n.text }}</p>
            }
            <section class="bpm-section" aria-labelledby="life-closing-title">
              <header>
                <h2 id="life-closing-title">Clôture du cycle</h2>
              </header>
              @if (d.results.closing?.possible && d.results.closing?.preview; as pv) {
                <p>
                  {{ pv.periodLabel }} est terminé. Son résultat est capitalisé une seule fois dans le patrimoine,
                  même s’il est nul ou négatif.
                </p>
                <dl class="bpm-kpis">
                  <div>
                    <dt>Résultat capitalisé</dt>
                    <dd>{{ pv.resultCents | signedCents }}</dd>
                  </div>
                  <div>
                    <dt>Stock avant → après</dt>
                    <dd>{{ euros(pv.stockBefore) }} → {{ euros(pv.stockAfter) }}</dd>
                  </div>
                  <div>
                    <dt>Date de capitalisation</dt>
                    <dd>{{ pv.capitalizationDate | shortDate }}</dd>
                  </div>
                </dl>
                <ul class="life-conditions">
                  @for (c of pv.conditions; track c) {
                    <li>{{ c }}</li>
                  }
                </ul>
                <div class="bpm-actions">
                  <button class="btn btn-primary" type="button" [disabled]="busy()" (click)="close(pv.periodKey, pv.resultCents)">
                    Clôturer {{ pv.periodLabel }}
                  </button>
                </div>
              } @else if (d.results.toCloseCount) {
                <p class="bpm-note">{{ d.results.closing?.reason ?? 'Clôture impossible pour l’instant.' }}</p>
              } @else {
                <p class="bpm-note">
                  Aucun cycle terminé à clôturer.
                  {{ d.cycle.period ? 'Le cycle en cours se clôturera après le ' + (d.cycle.period.end | shortDate) + '.' : '' }}
                </p>
              }
            </section>
            @if (d.projects.pendingRequests.length || d.projects.taskRequestCount || d.projects.billable.length) {
              <section class="bpm-section" aria-label="Suites à donner aux projets">
                <h2>Demandes et dépassements des projets</h2>
                @for (request of d.projects.pendingRequests; track request.id) {
                  <bpm-overrun-request [overrun]="request" [busy]="busy()" (decide)="decideOverrun(request, $event)" />
                }
                @for (request of d.projects.taskRequests ?? []; track request.id) {
                  <p>« {{ request.taskTitle }} » · {{ request.budgetName }} · {{ request.amountCents | cents }} demandés
                    <a class="btn btn-secondary" [routerLink]="['/app/gestion-projet', request.coreProjectId]" fragment="requests-title">Examiner la part demandée</a>
                  </p>
                }
                @if (d.projects.billable.length) {
                  <button class="btn btn-secondary" type="button" [disabled]="busy()" (click)="bill()">Intégrer {{ d.projects.billableCents | cents }} de dépassements au budget de vie</button>
                }
              </section>
            }
            <p class="bpm-note">
              Décisions de dépassement et facturation :
              <a routerLink="/projet-de-vie" fragment="life-decisions" (click)="followOpen.set(false)">Décisions attendues</a>.
            </p>
            <nav class="bpm-actions" aria-label="Vues complémentaires">
              <a class="text-link" [routerLink]="['/app/gestion-projet', d.lifeProject.coreProjectId]">Fiche du projet de vie ↗</a>
              <a class="text-link" routerLink="/tableau-de-bord">Tableau de bord ↗</a>
              <a class="text-link" routerLink="/tableau-de-bord" fragment="bm-history" (click)="followOpen.set(false)">Historique des cycles ↗</a>
              <a class="text-link" routerLink="/vision" fragment="objectifs-budgetaires" (click)="followOpen.set(false)">Objectif d’excédent ↗</a>
            </nav>
            @if (!workspace()) {
              <div class="bpm-actions"><button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="followOpen.set(false)">Fermer</button></div>
            }
    </ng-template>

    <ng-template #natureDetail let-x>
      <div class="bpm-table-wrap">
        <table class="bpm-table">
          <caption class="visually-hidden">{{ x.label }} par poste</caption>
          <thead>
            <tr><th>Poste</th><th>Réglé</th><th>À payer</th><th>Plafond</th><th>Marge</th></tr>
          </thead>
          <tbody>
            @for (r of x.rows; track r.ref) {
              <tr [class.is-over]="r.over">
                <th><a [routerLink]="['/argent/postes', centerKey(r.ref)]">{{ r.label }}</a>@if (r.lateCount) { <small class="life-flag">{{ r.lateCount }} en retard</small> }</th>
                <td>{{ r.paidCents | cents }}</td>
                <td>{{ r.toPayCents | cents }}</td>
                <td>{{ r.capCents === null ? 'Sans plafond' : (r.capCents | cents) }}</td>
                <td [class.is-deficit]="(r.marginCents ?? 0) < 0">{{ r.marginCents === null ? '—' : (r.marginCents | signedCents) }}</td>
              </tr>
            } @empty {
              <tr><td colspan="5">Aucune charge sur ces postes pendant le cycle.</td></tr>
            }
          </tbody>
        </table>
      </div>
      <ng-container *ngTemplateOutlet="lineTable; context: { $implicit: x.lines, empty: 'Aucune échéance prévue dans le cycle.', caption: 'Échéances du cycle' }" />
    </ng-template>

    <ng-template #lineTable let-lines let-empty="empty" let-caption="caption" let-nature="nature">
      <div class="bpm-table-wrap">
        <table class="bpm-table life-line-table">
          <caption class="visually-hidden">{{ caption }}</caption>
          <thead>
            <tr>
              <th>Date prévue</th>
              <th>Échéance</th>
              @if (nature) {
                <th>Nature</th>
              }
              <th>Poste</th>
              <th>Montant</th>
              <th>État</th>
            </tr>
          </thead>
          <tbody>
            @for (l of lines; track l.id) {
              <tr [attr.data-status]="l.status">
                <td>{{ l.plannedDate | shortDate }}</td>
                <th><button type="button" class="text-link" (click)="openLine(l.id)">{{ l.label }}</button></th>
                @if (nature) {
                  <td>
                    @if (l.project; as p) {
                      <a class="text-link" [routerLink]="['/app/gestion-projet', p.coreProjectId]" [queryParams]="shownKey() ? { lifePeriod: shownKey() } : {}" [title]="'Ouvrir le projet ' + p.name">Projet · {{ p.name }}</a>
                      @if (p.taskTitle) { <small class="life-line-task">{{ p.taskTitle }}</small> }
                      @if (!p.funded) { <small class="life-line-task">Sans budget attribué · hors budget de vie</small> }
                    } @else {
                      {{ natureLabel(l) }}
                    }
                  </td>
                }
                <td>{{ l.costCenterLabel ?? 'À préciser' }}</td>
                <td>{{ amountOf(l) | cents }}</td>
                <td><span class="life-line-status" [attr.data-status]="l.status">{{ l.statusLabel }}</span></td>
              </tr>
            } @empty {
              <tr><td [attr.colspan]="nature ? 6 : 5">{{ empty }}</td></tr>
            }
          </tbody>
        </table>
      </div>
    </ng-template>

    <bpm-entry-flow [budgets]="budgets()" [defaults]="entryDefaults()" [clearOnClose]="['entryDirection']" (saved)="saved($event)" /> @if (lineId() && !ctx.q('entry')()) {
      <bpm-line-detail [lineId]="lineId()!" (closed)="closeLine()" (edit)="editLine($event)" />
    }
  `,
})
export class BpmLifeManagementPage {
  protected ctx = inject(BpmPageContext);
  private bpm = inject(BpmApi);
  private funding = inject(ProjectFunding);
  protected readonly L = FUNDING;
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  protected workspace = injectPageWorkspace();
  protected budgetType = viewChild(BpmActBudgetType);
  private refresh = inject(BpmRefresh);
  private context = inject(RecetteContext);
  private fragment = toSignal(this.route.fragment, { initialValue: this.route.snapshot.fragment });
  private objectivesRouter = inject(Router);
  private followMovedObjectives = effect(() => {
    const fragment = this.fragment();
    if (fragment && OBJECTIVE_FRAGMENTS.includes(fragment)) {
      void this.objectivesRouter.navigate(['/vision'], { fragment, replaceUrl: true });
    }
  });
  protected budgetTypeOpen = signal(false);
  protected budgetTypeLoaded = signal(false);
  private keepBudgetType = effect(() => {
    if (this.budgetTypeOpen()) this.budgetTypeLoaded.set(true);
  });
  private budgetTypeOwner = effect(() => {
    this.context.userId();
    untracked(() => { this.budgetTypeOpen.set(false); this.budgetTypeLoaded.set(false); });
  });
  private sequence = 0;
  private readingOwner = this.context.userId();
  /** Période consultée (`?period=AAAA-MM`) ; absente = période en cours. */
  private periodKey = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  protected period = computed(() => this.periodKey().get('period') || undefined);
  protected data = signal<BpmLifeManagement | null>(null);
  protected loading = signal(false);
  protected error = signal('');
  protected busy = signal(false);
  protected notice = signal<{ text: string; error: boolean } | null>(null);
  protected filter = bpmQueryState<'all' | LifeHealth>('filter', 'all');
  protected expanded = bpmQueryState('expanded', new Set<string>(), { parse: raw => new Set(raw.split(',').filter(Boolean)), format: ids => [...ids].join(','), replace: true });
  protected followOpen = signal(false);
  protected dueChoice = signal('');
  protected lineId = bpmQueryState<string | null>('ligne', null, { overlay: true });
  protected entryDefaults = computed<Partial<EntryInput>>(() => ({ direction: this.ctx.query().get('entryDirection') === 'income' ? 'income' : 'charge' }));
  private closeKey = newRequestKey();

  protected readonly summaryHealths: { key: LifeHealth; label: string }[] = [
    { key: 'watch', label: 'À surveiller' },
    { key: 'ok', label: 'En règle' },
    { key: 'unknown', label: 'À renseigner' },
  ];
  protected budgets = computed(() => this.data()?.context.budgets ?? []);
  protected volets = computed<VoletView[]>(() => {
    const d = this.data();
    return d ? lifeVolets(d) : [];
  });
  protected visibleVolets = computed(() => {
    const f = this.filter();
    const all = this.volets();
    return f === 'all' ? all : all.filter((v) => v.health === f);
  });
  protected pending = computed(() => {
    const d = this.data();
    return d ? followCount(d) : 0;
  });
  protected nextDue = computed(() => [...(this.data()?.dueSoon.lines ?? [])]
    .sort((a, b) => Number(b.status === 'late') - Number(a.status === 'late') || a.plannedDate.localeCompare(b.plannedDate))[0] ?? null);
  protected selectedDue = computed(() => this.data()?.dueSoon.lines.find(line => line.id === this.dueChoice()) ?? null);
  protected priorityKind = computed(() => this.workspace()?.key === 'life-budget' ? 'budget' : this.workspace()?.key === 'life-closing' ? 'follow' : this.selectedDue() || (this.data()?.dueSoon.lateCount && this.nextDue()) ? 'due' : this.pending() ? 'follow' : this.nextDue() ? 'due' : 'budget');
  protected priorityDue = computed(() => this.selectedDue() ?? this.nextDue());
  protected pageScope = computed(() => {
    const d = this.data();
    if (!d) return 'Projet de vie · chargement du contexte';
    const reading = d.context.period?.label ?? 'cycle à configurer';
    const action = this.workspace()?.key === 'life-closing' ? 'Clôture des cycles terminés · décisions des projets' : this.priorityKind() === 'due' && this.priorityDue() ? `Échéance ouverte à ce jour : ${this.priorityDue()!.label}` : this.priorityKind() === 'follow' ? 'Décisions et clôtures à traiter aujourd’hui' : 'Budget type des prochaines périodes';
    return `${d.context.user.label} · Lecture : ${reading} · ${action}${this.filter() !== 'all' ? ` · ${this.visibleVolets().length} volet(s) affiché(s) sur 6` : ''}`;
  });
  protected pageResult = computed<BpmPageResult | null>(() => {
    const notice = this.notice();
    if (this.workspace()?.key === 'life-budget') {
      const budget = this.budgetType();
      if (budget?.saving()) return { message: 'Enregistrement du budget type…', tone: 'info' };
      if (budget?.feedback()) return { message: budget.feedback()!, tone: budget.feedback()!.includes('non enregistrée') ? 'warning' : 'success' };
    }
    if (notice?.error) return { message: notice.text, tone: 'danger' };
    if (this.busy()) return { message: 'Enregistrement et vérification du projet de vie…', tone: 'info' };
    if (this.error()) return { message: `${notice ? notice.text + ' ' : ''}Lecture non actualisée : ${this.error()}`, tone: notice ? 'warning' : 'danger' };
    return notice ? { message: notice.text, tone: 'success' } : null;
  });
  protected nextUnfunded = computed(() => this.data()?.projects.projects.find(project => project.state === 'unallocated') ?? null);
  protected capOverCount = computed(() => (this.data()?.natures.indispensable.overCount ?? 0) + (this.data()?.natures.courante.overCount ?? 0));
  protected pageFocus = computed<BpmPageFocus | null>(() => {
    const d = this.data();
    if (!d) return null;
    if (this.workspace()?.key === 'life-budget') return {
      title: this.budgetType()?.pendingChanges() ? `${this.budgetType()!.pendingChanges()} modification(s) du budget type` : 'Préparez les prochaines périodes',
      detail: 'Ajustez les lignes récurrentes puis enregistrez. Les montants déjà réglés restent conservés.', tone: this.budgetType()?.pendingChanges() ? 'warning' : 'info',
    };
    if (this.workspace()?.key === 'life-closing') return {
      title: d.results.toCloseCount ? `${d.results.toCloseCount} cycle(s) terminé(s) à clôturer` : 'Aucun cycle terminé à clôturer',
      detail: d.results.closing?.possible ? 'Relisez le résultat et le patrimoine après capitalisation, puis clôturez le cycle.' : d.results.closing?.reason ?? 'Le cycle en cours reste disponible pour les règlements.',
      tone: d.results.toCloseCount ? 'warning' : 'success',
    };
    if (d.cycle.status === 'to_configure') return { title: 'Votre cycle reste à configurer', detail: 'Choisissez son point de départ pour prévoir et suivre les échéances.', tone: 'warning' };
    if (this.selectedDue()) return { title: `Échéance sélectionnée : ${this.selectedDue()!.label}`, detail: `${cents(this.selectedDue()!.plannedCents)} à vérifier dans le détail avant d’enregistrer le règlement.`, tone: this.selectedDue()!.status === 'late' ? 'danger' : 'info' };
    if (d.dueSoon.lateCount && this.nextDue()) return { title: `${d.dueSoon.lateCount} échéance(s) en retard`, detail: `Commencez par « ${this.nextDue()!.label} ». Le détail permet de vérifier puis enregistrer le règlement.`, tone: 'danger' };
    if (this.pending()) return { title: `${this.pending()} suite(s) à donner`, detail: `${d.results.toCloseCount} période(s) à clôturer · ${d.projects.pendingRequests.length + d.projects.taskRequestCount} demande(s) de financement.`, tone: 'warning' };
    if (this.nextDue()) return { title: `À préparer : ${this.nextDue()!.label}`, detail: `${cents(this.nextDue()!.plannedCents)} à vérifier avant le règlement. Les échéances restent celles d’aujourd’hui.`, tone: 'info' };
    if ((d.cycle.flows?.expectedCents ?? 0) < 0 && d.cycle.reading !== 'closed') return { title: 'Le cycle prévoit un déficit', detail: 'Réexaminez les charges et les entrées du budget type avant de financer un autre projet.', tone: 'warning' };
    return { title: d.cycle.reading === 'closed' ? 'Bilan de la période clôturée' : 'Aucune échéance urgente ni décision en attente', detail: 'Profitez de ce point pour vérifier le budget type et préparer la prochaine période.', tone: 'success' };
  });
  protected priorityLabel = computed(() => this.workspace()?.key === 'life-budget'
    ? this.budgetType()?.pendingChanges() ? `Enregistrer le budget type · ${this.budgetType()!.pendingChanges()} modification(s)` : '＋ Ajouter une dépense récurrente'
    : this.workspace()?.key === 'life-closing'
      ? this.data()?.results.closing?.possible && this.data()?.results.closing?.preview ? `Clôturer ${this.data()!.results.closing!.preview!.periodLabel}` : 'Actualiser la clôture'
      : this.priorityKind() === 'due' ? `Examiner et régler · ${this.priorityDue()?.label ?? 'échéance'}` : this.priorityKind() === 'follow' ? 'Ouvrir les suites à donner' : 'Revoir mon budget type');
  protected runPriority() {
    if (this.workspace()?.key === 'life-budget') {
      if (this.budgetType()?.pendingChanges()) void this.budgetType()?.saveAll();
      else this.budgetType()?.addRecurring('charge');
      return;
    }
    if (this.workspace()?.key === 'life-closing') {
      const preview = this.data()?.results.closing?.preview;
      if (this.data()?.results.closing?.possible && preview) void this.close(preview.periodKey, preview.resultCents);
      else void this.load();
      return;
    }
    if (this.priorityKind() === 'due' && this.priorityDue()) this.openLine(this.priorityDue()!.id);
    else if (this.priorityKind() === 'follow') this.followOpen.set(true);
    else this.budgetTypeOpen.set(true);
  }
  protected pct = (v: number | null) => percentText(v, 0);
  protected euros = (v: number | null) => (v === null ? 'Inconnu' : cents(Math.round(v * 100)));

  /** Mêmes volets pour la période choisie : chaque changement de période relit la page. */
  private reader = effect(() => {
    this.period();
    this.refresh.version();
    const owner = this.context.userId();
    untracked(() => {
      if (owner !== this.readingOwner) {
        this.data.set(null); this.notice.set(null); this.followOpen.set(false); this.dueChoice.set('');
        this.readingOwner = owner;
      }
      void this.load();
    });
  });
  private openSection = effect(() => {
    if (this.fragment() === 'life-budget-type') this.budgetTypeOpen.set(true);
  });

  protected reading = computed(() => this.data()?.cycle.reading ?? null);
  protected readingText = computed(() => {
    switch (this.reading()) {
      case 'closed':
        return { status: 'Période clôturée · consultation', compact: 'Clôturée', net: 'Solde réalisé', expected: 'Résultat clôturé', expectedNote: 'Capitalisé dans le patrimoine' };
      case 'ended':
        return { status: 'Période terminée · à clôturer', compact: 'À clôturer', net: 'Solde réalisé', expected: 'Solde prévu à la clôture', expectedNote: 'Résultat à capitaliser' };
      default:
        return { status: 'Période actuelle', compact: 'Actuelle', net: 'Solde à ce jour', expected: 'Solde prévu à la clôture', expectedNote: 'Si tout le prévu se réalise' };
    }
  });
  protected shownKey = computed(() => this.data()?.context.period?.key ?? null);

  async load() {
    const sequence = ++this.sequence;
    this.loading.set(true);
    try {
      const data = await this.bpm.lifeManagement(this.period());
      if (sequence !== this.sequence) return;
      this.data.set(data);
      this.error.set('');
      // Volets à traiter ouverts d'emblée au premier chargement : le détail montre quoi faire.
      // Seule la vue principale montre les volets : une sous-page ne réécrit pas son adresse pour eux.
      if (!this.workspace() && !this.expanded().size && sequence === 1) this.expanded.set(new Set(data.pilot.volets.filter((v) => v.health === 'alert').map((v) => v.key)));
      if (this.dueChoice() && !data.dueSoon.lines.some((l) => l.id === this.dueChoice())) this.dueChoice.set('');
    } catch (err) {
      if (sequence === this.sequence) this.error.set(toApiError(err).message);
    } finally {
      if (sequence === this.sequence) this.loading.set(false);
    }
  }

  private async run<T>(action: () => Promise<T>, success: string | ((result: T) => string)) {
    if (this.busy()) return;
    this.busy.set(true);
    this.notice.set(null);
    try {
      const result = await action();
      await this.load();
      this.notice.set({ text: typeof success === 'function' ? success(result) : success, error: false });
    } catch (err) {
      await this.load();
      this.notice.set({ text: toApiError(err).message, error: true });
    } finally {
      this.busy.set(false);
    }
  }

  protected toggle(key: string) {
    this.expanded.update((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  protected act(link: VoletLink) {
    const actions: Record<VoletAction, () => void> = {
      'entry-income': () => this.openEntry('income'),
      'entry-charge': () => this.openEntry('charge'),
      follow: () => this.followOpen.set(true),
      close: () => this.followOpen.set(true),
    };
    if (link.action) actions[link.action]();
  }

  protected openEntry(direction: 'income' | 'charge' = 'charge') {
    void this.ctx.setQuery({ entry: 'new', entryDirection: direction });
  }
  protected closeEntry() {
    void this.ctx.setQuery({ entry: null, entryDirection: null }, { replace: true });
  }
  protected saved(text: string) {
    this.closeEntry();
    this.notice.set({ text, error: false });
    this.load();
  }
  protected openLine(id: string) {
    if (id) this.lineId.set(id);
  }
  protected closeLine() {
    this.lineId.set(null);
    this.load();
  }
  protected editLine(line: RegisterLine) {
    this.lineId.set(null);
    void this.ctx.setQuery({ entry: line.id });
  }

  protected natureLabel(l: LifeLine) {
    return l.direction === 'income' ? 'Entrée' : l.nature ? CHARGE_NATURE_LABEL[l.nature as ChargeNature] : '—';
  }
  protected amountOf(l: LifeLine) {
    return l.settled && l.realizedCents !== null ? l.realizedCents : l.plannedCents;
  }
  protected centerKey(ref: string) {
    return ref.replace(/^std:/, '');
  }

  protected async close(periodKey: string, expectedResultCents: number) {
    if (this.busy()) return;
    this.busy.set(true);
    this.notice.set(null);
    try {
      const r = await this.api.closePeriod({ requestKey: this.closeKey, periodKey, expectedResultCents });
      this.closeKey = newRequestKey();
      await this.load();
      this.notice.set({ text: `${r.closure.periodLabel} est clos : ${cents(Math.round(r.closure.result * 100))} capitalisés dans le patrimoine.`, error: false });
    } catch (err) {
      const e = toApiError(err);
      this.closeKey = newRequestKey();
      await this.load();
      this.notice.set({
        text: e.body.code === 'CLOSING_PREVIEW_STALE' ? 'Les données ont changé depuis l’aperçu : relisez le nouveau montant avant de confirmer.' : e.message,
        error: true,
      });
    } finally {
      this.busy.set(false);
    }
  }
  protected decideOverrun(o: ProjectOverrun, decision: 'approve' | 'refuse') {
    return this.run(
      () => this.funding.decide(o, decision),
      (r) => r.message,
    );
  }
  protected bill() {
    return this.run(() => this.bpm.billOverruns(), 'Dépassements intégrés aux budgets attribués, sans compter une seconde fois les dépenses réglées.');
  }
}
