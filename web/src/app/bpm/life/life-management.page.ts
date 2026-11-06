import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, RouterLink } from '@angular/router';
import { Api, newRequestKey, RecetteContext, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmLifeManagement, LifeHealth, LifeLine } from '../../core/bpm-life.models';
import { CHARGE_NATURE_LABEL, ChargeNature, EntryInput, RegisterLine } from '../../core/bpm-models';
import { ProjectOverrun } from '../../core/bpm-projects.models';
import { cents, CentsPipe, percentText, ShortDatePipe, SignedCentsPipe } from '../../core/format';
import { ModalComponent } from '../../shared/modal.component';
import { PeriodNavigationComponent } from '../../shared/period-navigation.component';
import { BpmOverrunRequestComponent } from '../projects/project-parts';
import { BpmLineDetail, BpmOperationEditor, BpmRefresh, FUNDING, ProjectFunding } from '../ui';
import { BpmActBudgetType } from '../pages/act-budget-type';
import { shiftPeriod } from '../ui/page-context';
import { BpmFragmentNavigation } from '../ui/fragment-navigation';
import { BpmLifeFundingComponent } from './life-funding';
import { BpmLifeGaugeComponent } from './life-gauge';
import { BpmLifeObjectives } from './life-objectives';
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
  styleUrls: ['../projects/projects.page.scss', './life-management.page.scss'],
  imports: [RouterLink, NgTemplateOutlet, CentsPipe, SignedCentsPipe, ShortDatePipe, ModalComponent, PeriodNavigationComponent, BpmOverrunRequestComponent, BpmLineDetail, BpmOperationEditor, BpmLifeGaugeComponent, BpmLifeFundingComponent, BpmActBudgetType, BpmLifeObjectives, BpmFragmentNavigation],
  template: `
    <div class="page page-wide bpm-projects bpm-project-page bpm-management bpm-life-management" bpmFragmentNavigation [bpmFragmentReady]="!!data()">
      <header class="life-projects-banner" data-ui-pattern="heading" data-sticky-hero>
        <div class="life-banner-copy">
          <p class="eyebrow">Budget/Patrimoine · Ma vision budgétaire</p>
          <h1 class="display">Gestion du projet de vie</h1>
          <p class="page-intro">
            Le projet qui englobe tous les autres : pilotez le budget du cycle, réglez l’essentiel à
            temps, maîtrisez les dépenses courantes pour profiter de ce que vous avez, et suivez ce
            qui s’accumule cycle après cycle.
          </p>
        </div>
        <div class="life-header-actions">
          <a class="btn btn-secondary" routerLink="/app/reglages">Réglages du cycle</a>
          <button class="btn btn-secondary" type="button" [disabled]="!data()" (click)="followOpen.set(true)">
            Suivi et clôture
            @if (pending()) {
              <span class="life-alert-count">{{ pending() }}</span>
            }
          </button>
          @if (data()?.context?.period; as p) {
            <rjs-period-navigation
              class="life-period-nav"
              tone="accent"
              [start]="p.start"
              [end]="p.endExclusive"
              label="Période du projet de vie consultée"
              previousLabel="Période précédente"
              nextLabel="Période suivante"
              currentLabel="Revenir à la période en cours"
              compactCurrentLabel="Revenir"
              [status]="readingText().status"
              [compactStatus]="readingText().compact"
              [previousQuery]="periodQuery(-1)"
              [nextQuery]="periodQuery(1)"
              [currentQuery]="{ period: null }"
              [previousDisabled]="atFirst()"
              [nextDisabled]="atCurrent()"
              [busy]="loading()"
            />
          } @else if (data()) {
            <p class="life-period-empty">Cycle à configurer : aucune période à parcourir.</p>
          }
        </div>
        <div class="life-banner-tools" aria-label="Commandes du projet de vie">
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
          <form class="life-budget-project" (submit)="$event.preventDefault(); openLine(dueChoice())">
            <label>
              Échéance à régler
              <select [value]="dueChoice()" [disabled]="!data()?.dueSoon?.lines?.length" (change)="dueChoice.set($any($event.target).value)">
                <option value="">
                  {{ !data() ? 'Chargement…' : data()!.dueSoon.lines.length ? 'Choisir une échéance…' : 'Aucune échéance ouverte' }}
                </option>
                @for (l of data()?.dueSoon?.lines ?? []; track l.id) {
                  <option [value]="l.id">{{ l.plannedDate | shortDate }} · {{ l.label }} · {{ l.plannedCents | cents }}{{ l.status === 'late' ? ' (en retard)' : '' }}</option>
                }
              </select>
            </label>
            <button type="submit" class="btn btn-secondary" [disabled]="!dueChoice()">Ouvrir</button>
          </form>
          <button class="btn btn-primary life-create" type="button" [disabled]="!budgets().length" (click)="openEntry()">
            <span aria-hidden="true">+</span> Saisir une entrée ou une charge
          </button>
          <nav class="life-local-navigation" aria-label="Accès directs au pilotage">
            <a [routerLink]="[]" queryParamsHandling="preserve" fragment="life-objectives">Objectifs et avenir</a>
            <a [routerLink]="[]" queryParamsHandling="preserve" fragment="life-budget-type">Budget type</a>
            <a [routerLink]="[]" queryParamsHandling="preserve" fragment="life-due">Échéances à régler</a>
            <a [routerLink]="[]" queryParamsHandling="preserve" fragment="life-decisions">Décisions attendues</a>
            <a routerLink="/plafonds" [queryParams]="period() ? { period: period() } : {}">Plafonds et catégories</a>
          </nav>
        </div>
      </header>

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

      @if (reading() && reading() !== 'current') {
        <p class="life-reading-note" role="status">
          Vous consultez <strong>{{ data()!.cycle.period!.label }}</strong> ({{ readingText().status.toLowerCase() }}) : les volets
          montrent cette période. Les échéances à régler, les décisions et la clôture restent celles d’aujourd’hui.
          <a [routerLink]="[]" [queryParams]="{ period: null }">Revenir à la période en cours →</a>
        </p>
      }
      @if (notice(); as n) {
        <p class="bpm-feedback" [class.is-error]="n.error" [attr.role]="n.error ? 'alert' : 'status'">{{ n.text }}</p>
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
                  <div class="bpm-project-row-budget">
                    <bpm-life-gauge [gauge]="v.gauge" />
                  </div>
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

        <bpm-life-objectives />

        <details class="life-budget-type-disclosure" id="life-budget-type" [open]="budgetTypeOpen()" (toggle)="budgetTypeOpen.set($any($event.target).open)">
          <summary><strong>Budget type et dépenses récurrentes</strong><span>Préparer les entrées et charges des prochaines périodes</span></summary>
          @if (budgetTypeOpen()) { <bpm-act-budget-type [showCaps]="false" /> }
        </details>

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
            <p class="bpm-note">
              Décisions de dépassement et facturation :
              <a routerLink="/projet-de-vie" fragment="life-decisions" (click)="followOpen.set(false)">Décisions attendues</a>.
            </p>
            <nav class="bpm-actions" aria-label="Vues complémentaires">
              <a class="text-link" [routerLink]="['/app/projets', d.lifeProject.coreProjectId]">Fiche du projet de vie ↗</a>
              <a class="text-link" routerLink="/tableau-de-bord">Tableau de bord ↗</a>
              <a class="text-link" routerLink="/tableau-de-bord" fragment="bm-history" (click)="followOpen.set(false)">Historique des cycles ↗</a>
              <a class="text-link" routerLink="/projet-de-vie" fragment="objectifs-budgetaires" (click)="followOpen.set(false)">Objectif d’excédent ↗</a>
            </nav>
            <div class="bpm-actions">
              <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="followOpen.set(false)">Fermer</button>
            </div>
          </rjs-modal>
        }
      }
    </div>

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

    @if (entryOpen() && budgets().length) {
      <bpm-operation-editor [budgets]="budgets()" [line]="editing()" [defaults]="entryDefaults()" (closed)="closeEntry()" (saved)="saved($event)" />
    } @else if (lineId()) {
      <bpm-line-detail [lineId]="lineId()!" (closed)="closeLine()" (edit)="editLine($event)" />
    }
  `,
})
export class BpmLifeManagementPage {
  private bpm = inject(BpmApi);
  private funding = inject(ProjectFunding);
  protected readonly L = FUNDING;
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private refresh = inject(BpmRefresh);
  private context = inject(RecetteContext);
  private fragment = toSignal(this.route.fragment, { initialValue: this.route.snapshot.fragment });
  protected budgetTypeOpen = signal(false);
  private sequence = 0;
  /** Période consultée (`?period=AAAA-MM`) ; absente = période en cours. */
  private periodKey = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  protected period = computed(() => this.periodKey().get('period') || undefined);
  protected data = signal<BpmLifeManagement | null>(null);
  protected loading = signal(false);
  protected error = signal('');
  protected busy = signal(false);
  protected notice = signal<{ text: string; error: boolean } | null>(null);
  protected filter = signal<'all' | LifeHealth>('all');
  protected expanded = signal(new Set<string>());
  protected followOpen = signal(false);
  protected dueChoice = signal('');
  protected lineId = signal<string | null>(null);
  protected entryOpen = signal(false);
  protected editing = signal<RegisterLine | null>(null);
  protected entryDefaults = signal<Partial<EntryInput>>({ direction: 'charge' });
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
  protected pct = (v: number | null) => percentText(v, 0);
  protected euros = (v: number | null) => (v === null ? 'Inconnu' : cents(Math.round(v * 100)));

  /** Mêmes volets pour la période choisie : chaque changement de période relit la page. */
  private reader = effect(() => {
    this.period();
    this.refresh.version();
    this.context.userId();
    untracked(() => this.load());
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
  protected atFirst = computed(() => !!this.shownKey() && this.shownKey() === this.data()?.context.periods?.firstKey);
  protected atCurrent = computed(() => !!this.shownKey() && this.shownKey() === this.data()?.context.periods?.currentKey);
  /** Période voisine ; revenir sur la période en cours retire le paramètre (adresse de la page nue). */
  protected periodQuery(delta: number): Params {
    const key = this.shownKey();
    const target = key ? shiftPeriod(key, delta) : null;
    return { period: target && target !== this.data()?.context.periods?.currentKey ? target : null };
  }

  async load() {
    const sequence = ++this.sequence;
    this.loading.set(true);
    try {
      const data = await this.bpm.lifeManagement(this.period());
      if (sequence !== this.sequence) return;
      this.data.set(data);
      this.error.set('');
      // Volets à traiter ouverts d'emblée au premier chargement : le détail montre quoi faire.
      if (!this.expanded().size && sequence === 1) this.expanded.set(new Set(data.pilot.volets.filter((v) => v.health === 'alert').map((v) => v.key)));
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
    this.editing.set(null);
    this.entryDefaults.set({ direction });
    this.entryOpen.set(true);
  }
  protected closeEntry() {
    this.entryOpen.set(false);
    this.editing.set(null);
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
    this.editing.set(line);
    this.entryOpen.set(true);
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
