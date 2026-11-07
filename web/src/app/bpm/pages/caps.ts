import { redirectLegacyView } from '../ui/legacy-view';
import { injectPageWorkspace } from '../../shared/page-workspace';
import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, inject, Injector, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { RecetteContext, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { CapsReview, ChargeCategory, ReviewCharge } from '../../core/bpm-caps.models';
import { EntryInput, RegisterLine } from '../../core/bpm-models';
import { cents, CentsPipe, percentText, ShortDatePipe } from '../../core/format';
import { BpmModal } from '../ui/modal';
import { BpmLifeGaugeComponent } from '../life/life-gauge';
import { BpmLineDetail, BpmEntryFlow, BpmPageContext, bpmQueryState, BpmPageFocus, BpmPageResult, BpmPageFrame, capEuroText, capInput } from '../ui';
import { BpmDrafts } from '../ui/drafts';
import { newRequestKey } from '../ui/page-context';
import {
  anteriorityText,
  CapCard,
  healthOf,
  recurrenceText,
  REVIEW_MODES,
  ReviewMode,
  isPastReading,
  reviewCards,
  reviewSummary,
  statusText,
} from './caps-review';

/**
 * Plafonds et catégories : savoir à tout moment ce qu'il reste sous chaque plafond avant d'acheter, et, une fois
 * dans le rouge, revoir les charges qui, ensemble, font dépasser un poste ou une catégorie — leur récurrence,
 * leur antériorité — et ce qu'il faut compenser ailleurs pour ne pas finir la période en déficit.
 * Les plafonds ne bloquent jamais rien ; retirer ou réduire une charge reste la décision de l'utilisateur.
 * Mise en page de « Gestion du projet de vie » : bandeau, synthèse chiffrée, cartes pleine largeur dépliables.
 */
@Component({
  selector: 'app-bpm-caps-page',
  providers: [BpmPageContext],
  styleUrls: ['../projects/projects.page.scss', '../life/life-management.page.scss', './caps.scss'],
  imports: [
    FormsModule,
    RouterLink,
    CentsPipe,
    ShortDatePipe,
    BpmPageFrame,
    BpmLifeGaugeComponent,
    BpmLineDetail,
    BpmEntryFlow,
    BpmModal,
  ],
  template: `
    <bpm-page
      [title]="workspace()?.title ?? 'Plafonds et catégories'"
      [lead]="workspace()?.lead ?? 'Suivez vos dépenses, définissez vos limites et organisez vos catégories.'"
      pageClass="bpm-projects bpm-management bpm-life-management bpm-caps-page"
      [context]="d()?.context"
      [periodNav]="true"
      [focus]="pageFocus()"
      [scope]="pageScope()"
      [result]="pageResult()"
      toolsLabel="Maîtriser et organiser les dépenses"
    >
      <button primary class="btn btn-primary" type="button" [disabled]="!d() || busy() || (primaryKind() === 'entry' && !budgets().length)" (click)="runPrimary()">{{ primaryLabel() }}</button>
      @if (primaryKind() !== 'entry') {
        <button actions class="btn btn-secondary" type="button" [disabled]="!budgets().length" (click)="openEntry()">＋ Saisir une dépense</button>
      }
      @if (view() === 'plafonds' && primaryKind() === 'save') {
        <button actions class="btn btn-secondary" type="button" [disabled]="busy()" (click)="openCapEditor()">Relire le plafond choisi</button>
      }
      @if (view() === 'suivi' && d()?.totals?.overCount && show() !== 'over' && primaryKind() !== 'overruns') {
        <button actions class="btn btn-secondary" type="button" (click)="reviewOverruns()">Isoler les dépassements</button>
      }
      @if (workspace()?.key === 'caps-settings') {
        <a actions class="bpm-link" routerLink="/plafonds/categories" [queryParams]="carry()">Organiser les catégories →</a>
      } @else if (workspace()?.key === 'caps-categories') {
        <a actions class="bpm-link" routerLink="/plafonds/reglages" [queryParams]="carry()">Définir les plafonds →</a>
      }
      <div tools class="bpm-caps-toolbar-tools">

        @if (view() === 'plafonds') {
          <div class="bpm-toolbar-search">
            <label>Plafond à régler<select [ngModel]="quickTarget()" (ngModelChange)="chooseTarget($event)">
              @for (target of capTargets(); track target.key) { <option [value]="target.key">{{ target.label }}</option> }
            </select></label>
            <button class="btn btn-secondary" type="button" [disabled]="!d()" (click)="openCategoryCreator()">Créer une catégorie dans ce poste</button>
          </div>
        }
        @if (view() === 'categories') {
          <!-- Le poste se choisit dans le formulaire « Nouvelle catégorie », juste dessous : pas de second sélecteur ici. -->
          <div class="bpm-toolbar-search">
            <span>{{ activeCategories().length }} catégorie(s) active(s). La création prépare aussi le réglage du plafond.</span>
          </div>
        }
        @if (view() === 'suivi') {
          @if (urgentCards().length) {
            <div class="bpm-toolbar-search">
              <label>Dépassement à examiner<select [ngModel]="urgentKey() || urgentCards()[0].key" (ngModelChange)="urgentKey.set($event)" name="urgentCap">
                @for (card of urgentCards(); track card.key) { <option [value]="card.key">{{ card.title }} · +{{ card.overCents | cents }}</option> }
              </select></label>
              @if (urgentCharge(); as charge) { <p>La commande principale ouvre « {{ charge.label }} » {{ charge.engagedAs === 'toPay' ? '(encore à payer)' : '(déjà réglée)' }}.</p> }
            </div>
          }
            <div class="caps-review-tools bpm-toolbar-search" role="search" aria-label="Présentation de la revue">
              <label
                >Regrouper<select [(ngModel)]="mode">
                  @for (m of modes; track m.key) {
                    <option [value]="m.key">{{ m.label }}</option>
                  }
                </select></label
              >
              <label
                >Afficher<select [(ngModel)]="show">
                  <option value="all">Tous les plafonds</option>
                  <option value="over">Dépassements seulement</option>
                </select></label
              >
              <p>
                <strong>Engagé = payé + restant à payer.</strong><br />Chaque plafond est suivi
                indépendamment.
              </p>
            </div>
        }
      </div>
      @if (error()) {
        <div class="empty-state" role="alert">
          <h2>Plafonds indisponibles</h2>
          <p>{{ error() }}</p>
          <button class="btn btn-secondary" (click)="load()">Réessayer</button>
        </div>
      } @else if (!d()) {
        <p role="status">Chargement des plafonds…</p>
      }
      @if (view() === 'suivi') {
        <section class="life-summary" aria-label="Synthèse des plafonds" [attr.aria-busy]="!d()">
          <div class="life-project-stats" aria-label="État des plafonds">
            <div class="life-stat life-stat-total">
              <span>Plafonds dépassés</span><strong>{{ d() ? d()!.totals.overCount : '—' }}</strong>
            </div>
            <div class="life-stat">
              <span
                ><i class="status-dot life-health-dot" data-health="alert" aria-hidden="true"></i
                >Postes · catégories</span
              ><strong>{{ s() ? s()!.overCenters + ' · ' + s()!.overCategories : '—' }}</strong>
            </div>
            <div class="life-stat">
              <span
                ><i class="status-dot life-health-dot" data-health="watch" aria-hidden="true"></i
                >Proches du plafond</span
              ><strong>{{ s() ? s()!.near : '—' }}</strong>
            </div>
            <div class="life-stat">
              <span
                ><i class="status-dot life-health-dot" data-health="ok" aria-hidden="true"></i>Dans
                le plafond</span
              ><strong>{{ s() ? s()!.within : '—' }}</strong>
            </div>
            <div class="life-progress">
              <span>Plafonds des postes engagés</span
              ><strong>{{ pct(s()?.usedPct ?? null) }}</strong>
              <div
                class="progress-track"
                role="progressbar"
                aria-label="Part engagée des plafonds de postes"
                [attr.aria-valuenow]="s()?.usedPct ?? null"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <span
                  [style.width.%]="bar(s()?.usedPct ?? 0)"
                  [class.is-over]="(s()?.usedPct ?? 0) > 100"
                ></span>
              </div>
            </div>
          </div>
          <dl class="life-financial-stats" aria-label="Plafonds et solde de la période">
            <div class="life-financial-stat life-allocated">
              <dt>Plafonds des postes</dt>
              <dd>{{ s() ? (s()!.capCents | cents) : '—' }}</dd>
              <span>Engagé {{ s() ? (s()!.engagedCents | cents) : '—' }}</span>
            </div>
            <div class="life-financial-stat life-available">
              <dt>Marge sous les plafonds</dt>
              <dd>{{ d() ? (d()!.totals.headroomCents | cents) : '—' }}</dd>
              <span>Postes encore dans leur plafond</span>
            </div>
            <div
              class="life-financial-stat life-remaining"
              [class.is-negative]="(d()?.totals?.toCompensateCents ?? 0) > 0"
            >
              <dt>À compenser</dt>
              <dd>{{ d() ? (d()!.totals.toCompensateCents | cents) : '—' }}</dd>
              <span>Au-delà des plafonds de postes ; les catégories sont suivies séparément</span>
            </div>
            <div
              class="life-financial-stat life-available"
              [class.is-negative]="(d()?.totals?.expectedCents ?? 0) < 0"
            >
              <dt>{{ closedReading() ? 'Résultat clôturé' : 'Solde prévu à la clôture' }}</dt>
              <dd>{{ expected() }}</dd>
              <span>{{ verdict() }}</span>
            </div>
          </dl>
        </section>

        @if (d(); as d) {
          @if (d.totals.toCompensateCents > 0 && !past()) {
            <section class="caps-compensation" aria-label="Marges de compensation">
              <h2>Où réduire les dépenses pour compenser ?</h2>
              <p>
                Ces marges tiennent compte du payé et du restant à payer. Ce sont des plafonds
                disponibles, pas une réserve d’argent : vérifiez aussi le solde prévu à la clôture.
              </p>
              <ul>
                @for (c of compensationCenters(); track c.ref) {
                  <li>
                    <strong>{{ c.label }}</strong
                    ><span>{{ c.marginCents | cents }} de marge</span>
                  </li>
                } @empty {
                  <li>
                    Aucun autre poste plafonné ne dispose de marge. Revoyez les charges prévues et
                    les postes sans plafond.
                  </li>
                }
              </ul>
            </section>
          }
          <section class="bpm-section caps-review" aria-labelledby="caps-review-title">
            <header>
              <h2 id="caps-review-title">Revue des plafonds · {{ d.context.period?.label }}</h2>
              <span class="bpm-note">{{ reviewNote() }}</span>
            </header>


            @if (!cards().length) {
              <div class="empty-state caps-empty">
                @if (show() === 'over' && allCards().length) {
                  <h3>Aucun dépassement sur la période</h3>
                  <p>
                    Tous vos plafonds sont respectés : chaque carte montre ce qu’il reste avant
                    d’acheter.
                  </p>
                  <button class="btn btn-secondary" type="button" (click)="show.set('all')">
                    Voir tous les plafonds
                  </button>
                } @else {
                  <h3>Aucun plafond défini</h3>
                  <p>
                    Définissez un montant dans « Définir les plafonds » : la page suivra ce qu’il
                    vous reste et signalera tout dépassement, sans jamais bloquer une dépense.
                  </p>
                  <a
                    class="btn btn-primary"
                    routerLink="/plafonds/reglages"
                    [queryParams]="carry()"
                    >Régler les plafonds</a
                  >
                }
              </div>
            }

            <div class="bpm-management-grid">
              @for (c of cards(); track c.key) {
                <article
                  class="bpm-management-card life-volet caps-card"
                  [class.is-expanded]="isOpen(c)"
                  [attr.data-health]="c.health"
                  [attr.aria-label]="c.level + ' ' + c.title"
                >
                  <div class="bpm-panel pm-project-overview">
                    <div class="bpm-project-row-summary">
                      <div class="bpm-project-links">
                        <span class="pm-life-health" [attr.data-health]="c.health">{{
                          c.healthLabel
                        }}</span
                        ><span class="pm-life-tag">{{ c.level }}</span>
                      </div>
                      <h3>{{ c.title }}</h3>
                      <p class="pm-project-description">
                        <span>{{ c.description }}</span>
                      </p>
                      <dl class="pm-project-facts">
                        @for (f of c.facts; track f.label) {
                          <div>
                            <dt>{{ f.label }}</dt>
                            <dd>{{ f.value }}</dd>
                            <small>{{ f.note ?? '' }}</small>
                          </div>
                        }
                      </dl>
                    </div>
                    <div class="bpm-project-row-budget">
                      <bpm-life-gauge [gauge]="c.gauge" />
                    </div>
                    @if (c.alert) {
                      <p class="pm-project-alert" [attr.data-health]="c.health">{{ c.alert }}</p>
                    }
                    <button
                      type="button"
                      class="pm-project-disclosure"
                      [attr.aria-expanded]="isOpen(c)"
                      [attr.aria-controls]="'caps-card-' + c.key"
                      (click)="toggle(c)"
                    >
                      <span
                        ><strong>{{
                          isOpen(c) ? 'Masquer les charges' : 'Revoir les charges'
                        }}</strong
                        ><span>{{
                          c.chargeCount
                            ? c.chargeCount +
                              ' charge' +
                              (c.chargeCount > 1 ? 's' : '') +
                              (c.chargeCount > 1 ? ' forment' : ' forme') +
                              ' l’engagé, les plus lourdes d’abord'
                            : 'Aucune charge sur la période'
                        }}</span></span
                      >
                      <span class="pm-disclosure-sign" aria-hidden="true">{{
                        isOpen(c) ? '−' : '+'
                      }}</span>
                    </button>
                  </div>
                  <aside
                    class="pm-project-command-panel"
                    [attr.aria-label]="'Commandes · ' + c.title"
                  >
                    <div class="bpm-actions bpm-project-row-actions">
                      @if (!past()) {
                        <button
                          class="btn btn-primary"
                          type="button"
                          [disabled]="!budgets().length"
                          (click)="openEntry(c)"
                        >
                          ＋ Saisir une dépense ici
                        </button>
                      }
                      <button class="btn btn-secondary" type="button" (click)="configure(c)">
                        Modifier le plafond
                      </button>
                    </div>
                    <dl class="pm-command-figures">
                      <div [class.has-pending]="c.health === 'alert'">
                        <dt>
                          {{ c.health === 'alert' ? 'Dépassement' : 'Reste avant le plafond' }}
                        </dt>
                        <dd>
                          {{ c.health === 'alert' ? '+' + money(c.overCents) : c.gauge.last.value }}
                        </dd>
                      </div>
                      <div>
                        <dt>Engagé</dt>
                        <dd>{{ c.gauge.middle.value }} · {{ c.gauge.meter.label }}</dd>
                      </div>
                    </dl>
                  </aside>
                  @if (isOpen(c)) {
                    <div
                      class="pm-project-tasks life-volet-detail caps-detail"
                      [id]="'caps-card-' + c.key"
                    >
                      @for (g of c.groups; track g.key) {
                        @if (g.label) {
                          <p class="caps-group-head" [attr.data-health]="g.health">
                            <strong>{{ g.label }}</strong>
                            @if (g.note) {
                              <span>{{ g.note }}</span>
                            }
                          </p>
                        }
                        @if (g.charges.length) {
                          <div class="caps-table-wrap">
                            <table class="bpm-table caps-charges">
                              <thead>
                                <tr>
                                  <th scope="col">Charge</th>
                                  <th scope="col">Engagée</th>
                                  <th scope="col">Récurrence</th>
                                  <th scope="col">Antériorité</th>
                                  <th scope="col" class="num">Montant</th>
                                  <th scope="col"><span class="visually-hidden">Ouvrir</span></th>
                                </tr>
                              </thead>
                              <tbody>
                                @for (x of g.charges; track x.id) {
                                  <tr
                                    [class.is-heavy]="
                                      g.overCents > 0 && x.engagedCents >= g.overCents
                                    "
                                  >
                                    <th scope="row">
                                      <span class="caps-charge-label">{{ x.label }}</span>
                                      <span class="caps-tags">
                                        @if (
                                          mode() !== 'both' &&
                                          x.categoryLabel &&
                                          c.level === 'Poste'
                                        ) {
                                          <span class="caps-tag">{{ x.categoryLabel }}</span>
                                        }
                                        @if (x.projectCharge && x.project) {
                                          <span class="caps-tag is-project"
                                            >Projet · {{ x.project.name }}</span
                                          >
                                        }
                                        @if (x.newThisPeriod) {
                                          <span class="caps-tag is-new">Nouvelle</span>
                                        }
                                      </span>
                                      @if (g.overCents > 0 && x.engagedCents >= g.overCents) {
                                        <small class="caps-hint"
                                          >À elle seule, elle couvre le dépassement de
                                          {{ g.overCents | cents }}.</small
                                        >
                                      }
                                    </th>
                                    <td>
                                      {{ x.engagedDate | shortDate }}
                                      <small
                                        class="caps-status"
                                        [attr.data-status]="
                                          x.engagedAs === 'paid' ? 'paid' : x.status
                                        "
                                        >{{ status(x) }}</small
                                      >
                                    </td>
                                    <td>
                                      <span
                                        class="caps-cadence"
                                        [class.is-recurring]="x.rank !== null"
                                        >{{ rec(x).label }}</span
                                      >
                                      @if (rec(x).note) {
                                        <small>{{ rec(x).note }}</small>
                                      }
                                    </td>
                                    <td>
                                      {{ age(x).label }}
                                      @if (age(x).note) {
                                        <small>{{ age(x).note }}</small>
                                      }
                                    </td>
                                    <td class="num">
                                      <strong>{{ x.engagedCents | cents }}</strong>
                                      <small>{{ share(x, g.charges) }} de l’engagé</small>
                                    </td>
                                    <td>
                                      <button type="button" class="text-link" (click)="openLine(x)">
                                        Ouvrir
                                      </button>
                                    </td>
                                  </tr>
                                }
                              </tbody>
                            </table>
                          </div>
                        } @else {
                          <p class="caps-group-empty">Aucune charge sur la période.</p>
                        }
                      }
                      <p class="caps-detail-note">
                        Retirer ou réduire une charge reste votre décision : ouvrez-la pour
                        consulter son détail ou la modifier. Les plafonds ne bloquent jamais une
                        dépense.
                      </p>
                    </div>
                  }
                </article>
              }
            </div>
          </section>
        }
      }
      @if (d(); as d) {
        @if (view() === 'plafonds') {
          <section class="caps-settings" aria-labelledby="caps-settings-title">
            <header>
              <div>
                <p class="caps-step">Paramétrage</p>
                <h2 id="caps-settings-title">Définir les plafonds</h2>
              </div>
              <p>Une limite par période du cycle budgétaire. Les dépenses restent autorisées.</p>
            </header>
            <div class="caps-setup-grid">
              <form
                class="caps-setting-form"
                aria-label="Plafond d’un poste"
                (ngSubmit)="saveCenter()"
              >
                <header>
                  <span class="caps-form-icon" aria-hidden="true">01</span>
                  <div>
                    <h3>Plafond d’un poste</h3>
                    <p>Le total de ses charges, toutes catégories comprises.</p>
                  </div>
                </header>
                <label
                  >Poste (centre de coûts)<select
                    name="centerRef"
                    [ngModel]="selectedCenter()"
                    (ngModelChange)="selectCenter($event)"
                    [disabled]="busy()"
                  >
                    <option value="">Choisir un poste…</option>
                    @for (c of d.centers; track c.ref) {
                      <option [value]="c.ref">
                        {{ c.label
                        }}{{ c.capCents === null ? ' · sans plafond' : ' · ' + money(c.capCents) }}
                      </option>
                    }
                  </select></label
                >
                <label
                  >Plafond par période (€)<input
                    name="centerCap"
                    inputmode="decimal"
                    placeholder="Vide : sans plafond"
                    [(ngModel)]="centerAmount"
                    [disabled]="!centerSelection() || busy()"
                /></label>
                @if (centerSelection(); as c) {
                  <dl class="caps-setting-facts">
                    <div>
                      <dt>Plafond actuel</dt>
                      <dd>{{ c.capCents === null ? 'Sans plafond' : money(c.capCents) }}</dd>
                    </div>
                    <div>
                      <dt>Engagé · {{ d.context.period?.label }}</dt>
                      <dd [class.is-negative]="c.over">{{ c.engagedCents | cents }}</dd>
                    </div>
                  </dl>
                } @else {
                  <p class="caps-field-help">
                    Sélectionnez un poste pour consulter son plafond et le modifier.
                  </p>
                }
                <p class="caps-field-help">
                  Laissez le montant vide pour retirer le plafond de ce poste.
                </p>
                <footer>
                  <button
                    type="submit"
                    class="btn btn-primary"
                    [disabled]="busy() || !centerDirty()"
                  >
                    {{ busy() ? 'Enregistrement…' : 'Enregistrer le plafond du poste' }}</button
                  ><button
                    type="button"
                    class="btn btn-secondary"
                    [disabled]="busy() || !centerDirty()"
                    (click)="selectCenter(selectedCenter())"
                  >
                    Annuler
                  </button>
                </footer>
              </form>
              <form
                class="caps-setting-form"
                aria-label="Plafond d’une catégorie"
                (ngSubmit)="saveCategoryCap()"
              >
                <header>
                  <span class="caps-form-icon" aria-hidden="true">02</span>
                  <div>
                    <h3>Plafond d’une catégorie</h3>
                    <p>Une limite indépendante de celle de son poste.</p>
                  </div>
                </header>
                <label
                  >Catégorie existante<select
                    name="categoryId"
                    [ngModel]="selectedCategory()"
                    (ngModelChange)="selectCategory($event)"
                    [disabled]="busy() || !activeCategories().length"
                  >
                    <option value="">Choisir une catégorie…</option>
                    @for (k of activeCategories(); track k.id) {
                      <option [value]="k.id">
                        {{ k.costCenterLabel }} · {{ k.label
                        }}{{ k.capCents === null ? ' · sans plafond' : ' · ' + money(k.capCents) }}
                      </option>
                    }
                  </select></label
                >
                <label
                  >Plafond par période (€)<input
                    name="categoryCap"
                    inputmode="decimal"
                    placeholder="Vide : sans plafond"
                    [(ngModel)]="categoryAmount"
                    [disabled]="!categorySelection() || busy()"
                /></label>
                @if (categorySelection(); as k) {
                  <dl class="caps-setting-facts">
                    <div>
                      <dt>Plafond actuel</dt>
                      <dd>{{ k.capCents === null ? 'Sans plafond' : money(k.capCents) }}</dd>
                    </div>
                    <div>
                      <dt>Poste de rattachement</dt>
                      <dd>{{ k.costCenterLabel }}</dd>
                    </div>
                  </dl>
                } @else {
                  <p class="caps-field-help">
                    Choisissez une catégorie déjà créée pour lui attribuer une limite.
                  </p>
                }
                <p class="caps-field-help">
                  Laissez le montant vide pour retirer le plafond de cette catégorie.
                </p>
                <footer>
                  <button
                    type="submit"
                    class="btn btn-primary"
                    [disabled]="busy() || !categoryDirty()"
                  >
                    {{
                      busy() ? 'Enregistrement…' : 'Enregistrer le plafond de la catégorie'
                    }}</button
                  ><button
                    type="button"
                    class="btn btn-secondary"
                    [disabled]="busy() || !categoryDirty()"
                    (click)="selectCategory(selectedCategory())"
                  >
                    Annuler
                  </button>
                </footer>
                @if (!activeCategories().length) {
                  <a
                    routerLink="/plafonds/categories"
                    [queryParams]="carry()"
                    >Créer votre première catégorie →</a
                  >
                }
              </form>
            </div>
            <p class="caps-settings-note">
              Ces plafonds s’appliquent à chaque période. Leur modification actualise aussi la
              lecture des périodes consultées ; elle ne modifie aucune dépense.
            </p>
          </section>
        }
        @if (view() === 'categories') {
          <section class="caps-settings" aria-labelledby="caps-categories-title">
            <header>
              <div>
                <p class="caps-step">Organisation</p>
                <h2 id="caps-categories-title">Créer et organiser les catégories</h2>
              </div>
              <p>Chaque catégorie appartient à un poste de dépenses.</p>
            </header>
            <form
              class="caps-setting-form caps-category-create"
              aria-label="Créer une catégorie"
              (ngSubmit)="createCategory()"
            >
              <header>
                <span class="caps-form-icon" aria-hidden="true">＋</span>
                <div>
                  <h3>Nouvelle catégorie</h3>
                  <p>Classez vos dépenses ponctuelles et récurrentes avec le même repère.</p>
                </div>
              </header>
              <div class="caps-create-fields">
                <label
                  >Poste de rattachement<select
                    name="newCenter"
                    [(ngModel)]="newCenter"
                    [disabled]="busy()"
                  >
                    <option value="">Choisir un poste…</option>
                    @for (c of d.centers; track c.ref) {
                      <option [value]="c.ref">{{ c.label }}</option>
                    }
                  </select></label
                >
                <label
                  >Nom de la catégorie<input
                    name="newLabel"
                    maxlength="120"
                    placeholder="Ex. Courses du quotidien, Cinéma…"
                    [(ngModel)]="newLabel"
                    [disabled]="busy()"
                /></label>
                <button
                  type="submit"
                  class="btn btn-primary"
                  [disabled]="busy() || !newLabel().trim() || !newCenter()"
                >
                  Créer la catégorie
                </button>
              </div>
              <p class="caps-field-help">
                La catégorie est créée sans plafond. Vous pouvez ensuite lui en attribuer un dans «
                Définir les plafonds ».
              </p>
            </form>
            <div class="caps-category-directory">
              <header>
                <h3>Vos catégories</h3>
                <span>{{ activeCategories().length }} actives</span>
              </header>
              @for (grp of categoryGroups(); track grp.ref) {
                <section class="caps-cat-group" [attr.aria-label]="grp.label">
                  <h4 class="caps-cat-center">{{ grp.label }}</h4>
                  <ul class="caps-cat-list">
                    @for (k of grp.items; track k.id) {
                      <li class="caps-cat-row" [class.is-archived]="k.archived">
                        @if (editing() === k.id) {
                          <form class="caps-cat-edit" (ngSubmit)="saveCategory(k)">
                            <label
                              >Nom de la catégorie<input
                                name="editLabel"
                                maxlength="120"
                                [(ngModel)]="editLabel" /></label
                            ><button type="submit" class="btn btn-primary" [disabled]="busy()">
                              Enregistrer le nom</button
                            ><button
                              type="button"
                              class="btn btn-secondary"
                              (click)="editing.set(null)"
                            >
                              Annuler
                            </button>
                          </form>
                        } @else {
                          <span class="caps-cat-name"
                            ><strong>{{ k.label }}</strong
                            ><small
                              >{{ k.archived ? 'Retirée des choix · ' : ''
                              }}{{
                                k.capCents === null
                                  ? 'Sans plafond'
                                  : 'Plafond ' + money(k.capCents) + ' par période'
                              }}</small
                            ></span
                          >
                          <span class="caps-cat-actions"
                            ><button
                              type="button"
                              class="text-link"
                              [disabled]="busy()"
                              (click)="startEdit(k)"
                            >
                              Renommer
                            </button>
                            @if (!k.archived) {
                              <button
                                type="button"
                                class="text-link"
                                (click)="configureCategory(k.id)"
                              >
                                Définir le plafond
                              </button>
                            }
                            <button
                              type="button"
                              class="text-link"
                              [disabled]="busy()"
                              (click)="archive(k, !k.archived)"
                            >
                              {{ k.archived ? 'Rétablir' : 'Retirer' }}
                            </button></span
                          >
                        }
                      </li>
                    }
                  </ul>
                </section>
              } @empty {
                <p class="caps-group-empty">
                  Aucune catégorie créée. Choisissez un poste et nommez votre première catégorie
                  ci-dessus.
                </p>
              }
            </div>
          </section>
        }
      }
    </bpm-page>

    <bpm-modal [open]="!!quickEditor()" [headed]="true" [title]="quickEditor() === 'create' ? 'Créer une catégorie dans son poste' : 'Régler un plafond'" [busy]="busy()" (closed)="quickEditor.set(null)">
      @if (notice()?.error) { <p class="bpm-error" role="alert">{{ notice()!.text }}</p> }
      @if (quickEditor() === 'create') {
        <form class="caps-setting-form" (ngSubmit)="createCategory()">
          <label>Poste de rattachement<select name="quickNewCenter" [ngModel]="newCenter()" (ngModelChange)="newCenter.set($event)" [disabled]="busy()">
            <option value="">Choisir un poste…</option>
            @for (center of d()?.centers ?? []; track center.ref) { <option [value]="center.ref">{{ center.label }}</option> }
          </select></label>
          <label>Nom de la catégorie<input name="quickNewLabel" maxlength="120" [ngModel]="newLabel()" (ngModelChange)="newLabel.set($event)" [disabled]="busy()" placeholder="Ex. Courses du quotidien" /></label>
          <p class="caps-field-help">Une fois créée, la catégorie est sélectionnée pour lui attribuer un plafond si utile.</p>
          <button class="btn btn-primary" type="submit" [disabled]="busy() || !newCenter() || !newLabel().trim()">Créer puis préparer son plafond</button>
        </form>
      } @else if (quickEditor() === 'category') {
        <form class="caps-setting-form" (ngSubmit)="saveCategoryCap()">
          <h3>{{ categorySelection()?.label }}</h3><p>{{ categorySelection()?.costCenterLabel }}</p>
          <label>Plafond par période (€)<input name="quickCategoryAmount" inputmode="decimal" [ngModel]="categoryAmount()" (ngModelChange)="categoryAmount.set($event)" [disabled]="busy()" placeholder="Sans plafond" /></label>
          <p class="caps-field-help">Un montant vide retire le plafond. Les dépenses restent inchangées.</p>
          <button class="btn btn-primary" type="submit" [disabled]="busy() || !categoryDirty()">Enregistrer ce plafond</button>
        </form>
      } @else if (quickEditor() === 'center') {
        <form class="caps-setting-form" (ngSubmit)="saveCenter()">
          <h3>{{ centerSelection()?.label }}</h3>
          <label>Plafond par période (€)<input name="quickCenterAmount" inputmode="decimal" [ngModel]="centerAmount()" (ngModelChange)="centerAmount.set($event)" [disabled]="busy()" placeholder="Sans plafond" /></label>
          <p class="caps-field-help">Un montant vide retire le plafond. Les dépenses restent inchangées.</p>
          <button class="btn btn-primary" type="submit" [disabled]="busy() || !centerDirty()">Enregistrer ce plafond</button>
        </form>
      }
      <button class="btn btn-secondary" type="button" [disabled]="busy()" (click)="quickEditor.set(null)">Fermer le panneau</button>
    </bpm-modal>

    <bpm-entry-flow [budgets]="budgets()" [defaults]="entryDefaults()" (saved)="saved($event)" />
    @if (lineId() && !ctx.q('entry')()) {
      <bpm-line-detail [lineId]="lineId()!" (closed)="closeLine()" (edit)="editLine($event)" />
    }
  `,
})
export class BpmCapsPage {
  protected ctx = inject(BpmPageContext);
  private router = inject(Router);
  private bpm = inject(BpmApi);
  private route = inject(ActivatedRoute);
  private user = inject(RecetteContext).userId;
  private readingOwner = this.user();
  protected workspace = injectPageWorkspace();
  protected carry = computed(() => Object.fromEntries(this.ctx.query().keys.filter(key => key !== 'view').map(key => [key, this.ctx.query().get(key)!])));
  private sequence = 0;
  private initialTarget = this.route.snapshot.queryParamMap.get('target');
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private injector = inject(Injector);
  /**
   * Arrivée avec une cible (« Définir le plafond » d'une catégorie, d'une carte) : le montant de
   * cette cible est amené à l'écran et prêt à la saisie, sans avoir à le chercher plus bas.
   */
  private focusTarget(key: string) {
    if (this.view() !== 'plafonds') return;
    const name = key.startsWith('category:') ? 'categoryCap' : 'centerCap';
    afterNextRender(
      () => {
        const field = this.host.nativeElement.querySelector<HTMLInputElement>(`.caps-settings input[name="${name}"]`);
        field?.scrollIntoView({ block: 'center' });
        field?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }
  private query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private fragment = toSignal(this.route.fragment, { initialValue: this.route.snapshot.fragment });
  protected readonly tabs = [
    { key: 'suivi', label: 'Suivi et pilotage', note: 'Marges et dépenses' },
    { key: 'plafonds', label: 'Définir les plafonds', note: 'Postes et catégories' },
    { key: 'categories', label: 'Créer les catégories', note: 'Organiser les dépenses' },
  ];
  protected view = computed(() => {
    if (this.workspace()?.key === 'caps-settings') return 'plafonds';
    if (this.workspace()?.key === 'caps-categories') return 'categories';
    const key = this.query().get('view');
    return this.tabs.some((t) => t.key === key)
      ? key
      : this.fragment() === 'reglages'
        ? 'plafonds'
        : this.fragment() === 'reglages-categories'
          ? 'categories'
          : 'suivi';
  });
  protected period = computed(() => this.query().get('period') || undefined);
  private readonly legacyView = redirectLegacyView(() => this.view() ?? 'suivi', 'suivi', { plafonds: '/plafonds/reglages', categories: '/plafonds/categories' }, () => !!this.workspace());

  protected d = signal<CapsReview | null>(null);
  protected loading = signal(false);
  protected error = signal('');
  protected busy = signal(false);
  protected notice = signal<{ text: string; error: boolean } | null>(null);

  protected readonly modes = REVIEW_MODES;
  protected compensationCenters = computed(() =>
    (this.d()?.centers ?? [])
      .filter((c) => (c.marginCents ?? 0) > 0)
      .sort((a, b) => b.marginCents! - a.marginCents!),
  );
  protected mode = bpmQueryState<ReviewMode>('mode', 'both');
  protected show = bpmQueryState<'all' | 'over'>('show', 'all');
  /** Cartes ouvertes ou fermées par l'utilisateur ; sinon un plafond dépassé s'ouvre d'emblée. */
  private choice = signal(new Map<string, boolean>());

  protected s = computed(() => (this.d() ? reviewSummary(this.d()!) : null));
  protected allCards = computed<CapCard[]>(() =>
    this.d() ? reviewCards(this.d()!, this.mode()) : [],
  );
  protected cards = computed(() =>
    this.show() === 'over' ? this.allCards().filter((c) => c.health === 'alert') : this.allCards(),
  );
  protected budgets = computed(() => this.d()?.context.budgets ?? []);

  protected urgentCards = computed(() => this.allCards().filter(card => card.health === 'alert'));
  protected urgentKey = signal('');
  protected urgentCard = computed(() => this.urgentCards().find(c => c.key === this.urgentKey()) ?? this.urgentCards()[0] ?? null);
  protected urgentCharge = computed(() => {
    const card = this.urgentCard();
    const centerOver = this.d()?.centers.find(center => center.ref === card?.centerRef)?.over;
    const charges = (card?.groups ?? []).filter(group => card?.level === 'Catégorie' || centerOver || group.health === 'alert').flatMap(group => group.charges);
    return [...charges].sort((a, b) => Number(b.engagedAs === 'toPay') - Number(a.engagedAs === 'toPay') || b.engagedCents - a.engagedCents)[0] ?? null;
  });
  protected reviewOverruns() {
    this.choice.set(new Map(this.urgentCards().map(card => [card.key, true])));
    if (this.workspace()) void this.router.navigate(['/plafonds'], { queryParams: { ...this.carry(), mode: 'both', show: 'over' } });
    else void this.ctx.setQuery({ mode: 'both', show: 'over' });
  }
  protected quickEditor = signal<'center' | 'category' | 'create' | null>(null);
  protected quickTarget = signal('');
  protected capTargets = computed(() => [
    ...(this.d()?.centers ?? []).map(c => ({ key: `center:${c.ref}`, label: `Poste · ${c.label}` })),
    ...this.activeCategories().map(c => ({ key: `category:${c.id}`, label: `Catégorie · ${c.label} (${c.costCenterLabel})` })),
  ]);
  protected chooseTarget(key: string) {
    this.quickTarget.set(key);
    if (key.startsWith('category:')) this.selectCategory(key.slice('category:'.length));
    else this.selectCenter(key.slice('center:'.length));
  }
  protected openCapEditor() {
    if (!this.quickTarget() && this.capTargets().length) this.chooseTarget(this.capTargets()[0].key);
    if (this.quickTarget()) this.quickEditor.set(this.quickTarget().startsWith('category:') ? 'category' : 'center');
  }
  protected openCategoryCreator() {
    // Preserve an existing category draft; otherwise use the selected or most useful post.
    if (!this.newCenter()) this.newCenter.set(this.categorySelection()?.costCenterRef || this.selectedCenter() || this.urgentCard()?.centerRef || this.d()?.centers[0]?.ref || '');
    this.quickEditor.set('create');
  }
  protected pendingCap = computed(() => {
    if (this.quickTarget().startsWith('category:') && this.categoryDirty()) return 'category';
    if (this.centerDirty()) return 'center';
    return this.categoryDirty() ? 'category' : null;
  });
  protected pendingRename = computed(() => {
    const category = this.catalog().find(category => category.id === this.editing());
    return category && this.editLabel().trim() !== category.label ? category : null;
  });
  protected categoryDraft = computed(() => !!this.newLabel().trim() && !!this.newCenter());
  protected primaryKind = computed(() => {
    if (this.pendingRename()) return 'rename';
    if (this.pendingCap()) return 'save';
    if (this.categoryDraft()) return 'create';
    if (this.quickEditor() === 'category' || this.quickEditor() === 'center') return 'cap';
    if (this.quickEditor() === 'create' || this.view() === 'categories') return 'category';
    if (this.view() === 'plafonds') return 'cap';
    if (this.urgentCharge()) return 'charge';
    if (this.d()?.totals.overCount && !this.urgentCards().length) return 'overruns';
    if (!this.d()?.totals.cappedCount || this.past()) return 'cap';
    return 'entry';
  });
  protected primaryLabel = computed(() => {
    if (this.busy()) return 'Enregistrement…';
    switch (this.primaryKind()) {
      case 'rename': return 'Enregistrer le nom saisi';
      case 'save': return this.pendingCap() === 'category' ? 'Enregistrer la catégorie modifiée' : 'Enregistrer le poste modifié';
      case 'create': return `Créer « ${this.newLabel().trim()} » et préparer son plafond`;
      case 'category': return '＋ Créer une catégorie';
      case 'cap': return this.d()?.totals.cappedCount ? 'Régler le plafond choisi' : 'Définir mon premier plafond';
      case 'charge': return !this.past() && this.urgentCharge()?.engagedAs === 'toPay' ? 'Revoir une charge avant paiement' : 'Examiner une charge du dépassement';
      case 'overruns': return 'Afficher les dépassements des autres regroupements';
      default: return '＋ Saisir une dépense';
    }
  });
  protected runPrimary() {
    switch (this.primaryKind()) {
      case 'rename': if (this.pendingRename()) void this.saveCategory(this.pendingRename()!); break;
      case 'save': if (this.pendingCap() === 'category') void this.saveCategoryCap(); else void this.saveCenter(); break;
      case 'create': this.quickEditor.set('create'); void this.createCategory(); break;
      case 'category': this.openCategoryCreator(); break;
      case 'cap': this.openCapEditor(); break;
      case 'charge': if (this.urgentCharge()) this.openLine(this.urgentCharge()!); break;
      case 'overruns': this.reviewOverruns(); break;
      default: this.openEntry();
    }
  }
  protected pageScope = computed(() => {
    const profile = `${this.d()?.context.user.label ?? 'Profil actif'} · `;
    if (this.pendingRename()) return profile + `Nom de catégorie : ${this.pendingRename()!.label} · ${this.pendingRename()!.costCenterLabel}`;
    const category = this.categorySelection();
    const pending = this.pendingCap();
    if (pending) return profile + `Plafond modifié : ${pending === 'category' ? category?.label : this.centerSelection()?.label} · limite commune à toutes les périodes`;
    if (this.categoryDraft() || this.view() === 'categories') return profile + `Catégories du profil · poste choisi : ${this.d()?.centers.find(center => center.ref === this.newCenter())?.label ?? 'à sélectionner'}`;
    if (this.view() === 'plafonds' || this.quickEditor() === 'category' || this.quickEditor() === 'center') return profile + `${this.capTargets().find(target => target.key === this.quickTarget())?.label ?? 'Plafond à sélectionner'} · limite commune à toutes les périodes`;
    return profile + `Lecture : ${this.d()?.context.period?.label ?? 'période courante'} · ${this.modes.find(mode => mode.key === this.mode())?.label ?? 'Poste et catégories'} · ${this.show() === 'over' ? 'dépassements seuls' : 'tous les plafonds'}${this.urgentCard() ? ` · sélection : ${this.urgentCard()!.title}` : ''}`;
  });
  protected pageResult = computed<BpmPageResult | null>(() => {
    const notice = this.notice();
    if (notice?.error) return { message: notice.text, tone: 'danger' };
    if (this.busy()) return { message: 'Enregistrement et actualisation des plafonds…', tone: 'info' };
    if (this.error()) return { message: `${notice ? notice.text + ' ' : ''}Lecture non actualisée : ${this.error()}`, tone: notice ? 'warning' : 'danger' };
    return notice && !this.pendingCap() && !this.pendingRename() && !this.categoryDraft() ? { message: notice.text, tone: 'success' } : null;
  });
  protected pageFocus = computed<BpmPageFocus | null>(() => {
    const d = this.d();
    if (!d) return null;
    if (this.pendingRename()) return { title: 'Le nom de catégorie modifié attend son enregistrement', detail: 'La commande principale enregistre uniquement le nom saisi, sans changer le poste ni le plafond.', tone: 'warning' };
    if (this.pendingCap()) return { title: 'Un plafond modifié attend son enregistrement', detail: 'La commande principale enregistre le plafond indiqué dans le contexte ; les autres saisies restent disponibles.', tone: 'warning' };
    if (this.categoryDraft()) return { title: `La catégorie « ${this.newLabel().trim()} » est prête à créer`, detail: 'La création prépare ensuite son plafond facultatif, sans modifier les dépenses.', tone: 'info' };
    if (this.view() === 'categories') return { title: `${this.activeCategories().length} catégorie(s) active(s)`, detail: this.newLabel().trim() ? `La catégorie « ${this.newLabel().trim()} » attend sa création.` : 'Choisissez d’abord le poste, puis créez une catégorie pour y ranger les prochaines dépenses.', tone: this.newLabel().trim() ? 'warning' : 'info' };
    if (this.view() === 'plafonds') {
      return { title: `${d.totals.cappedCount} plafond(s) défini(s)`, detail: 'Choisissez un poste ou une catégorie pour ajuster sa limite par période depuis le bandeau.', tone: 'info' };
    }
    if (d.totals.overCount) return { title: d.totals.toCompensateCents > 0 ? `${d.totals.overCount} dépassement(s) · ${cents(d.totals.toCompensateCents)} à compenser sur les postes` : `${d.totals.overCount} plafond(s) de catégorie dépassé(s)`, detail: this.past() ? 'Ce bilan permet de comprendre les écarts et de préparer les prochains cycles.' : d.totals.toCompensateCents > 0 ? 'Examinez d’abord une charge encore à payer ; le règlement déjà enregistré reste consultable.' : 'Le poste garde de la marge, mais une catégorie a atteint sa propre limite. Examinez ses charges avant le prochain achat.', tone: 'warning' };
    if (this.s()?.near) return { title: `${this.s()!.near} plafond(s) proche(s) de leur limite`, detail: this.past() ? 'Ce bilan montre les limites qui méritent votre attention pour les cycles suivants.' : 'Vérifiez les marges avant la prochaine charge, puis ajustez les montants prévus si nécessaire.', tone: 'info' };
    return { title: d.totals.cappedCount ? 'Aucun plafond dépassé' : 'Vos premières limites restent à définir', detail: d.totals.cappedCount ? 'Les marges restent disponibles pour préparer votre prochaine dépense.' : 'Définissez un plafond de poste, puis précisez les catégories qui méritent leur propre limite.', tone: d.totals.cappedCount ? 'success' : 'info' };
  });

  protected healthOf = healthOf;
  protected rec = recurrenceText;
  protected age = anteriorityText;
  protected status = statusText;
  protected money = cents;
  protected pct = (v: number | null) => (v === null ? '—' : percentText(v, 0));
  protected bar = (v: number | null) => Math.min(100, Math.max(0, v ?? 0));
  protected share = (x: ReviewCharge, all: ReviewCharge[]) => {
    const total = all.reduce((t, c) => t + c.engagedCents, 0);
    return total ? percentText((x.engagedCents / total) * 100, 0) : '—';
  };

  /** Période terminée ou close : bilan, sans incitation à de nouvelles dépenses. */
  protected past = computed(() => (this.d() ? isPastReading(this.d()!) : false));
  protected closedReading = computed(() => this.d()?.totals.reading === 'closed');
  protected expected = computed(() => {
    const t = this.d()?.totals;
    const v = t?.reading === 'closed' ? t.closedResultCents : t?.expectedCents;
    return v === null || v === undefined
      ? '—'
      : (v > 0 ? '+' : v < 0 ? '−' : '') + cents(Math.abs(v));
  });
  protected reviewNote = computed(() => {
    const n = this.d()?.totals.overCount ?? 0;
    return n
      ? `${n} dépassement${n > 1 ? 's' : ''} : les charges concernées sont dépliées, les plus lourdes d’abord.`
      : this.past()
        ? 'Aucun dépassement sur cette période.'
        : 'Aucun dépassement : chaque carte montre ce qu’il reste avant d’acheter.';
  });
  protected verdict = computed(() => {
    const t = this.d()?.totals;
    if (t?.reading === 'closed') return t.toCompensateCents ? 'Capitalisé malgré le dépassement des plafonds' : 'Capitalisé dans le patrimoine';
    if (t?.reading === 'ended') return 'Période terminée, en attente de clôture';
    if (!t || t.expectedCents === null) return 'Si tout le prévu se réalise';
    if (t.expectedCents < 0)
      return t.toCompensateCents
        ? 'Déficit prévu : réduisez d’autres postes'
        : 'Déficit prévu sur la période';
    return t.toCompensateCents
      ? 'Le reste du budget absorbe le dépassement'
      : 'Si tout le prévu se réalise';
  });

  protected isOpen = (c: CapCard) => this.choice().get(c.key) ?? c.health === 'alert';
  protected toggle(c: CapCard) {
    this.choice.set(new Map(this.choice()).set(c.key, !this.isOpen(c)));
  }

  private reader = effect(() => {
    this.period();
    const owner = this.user();
    untracked(() => {
      if (owner !== this.readingOwner) {
        this.quickTarget.set(''); this.selectedCenter.set(''); this.centerAmount.set('');
        this.selectedCategory.set(''); this.categoryAmount.set(''); this.newLabel.set(''); this.newCenter.set('');
        this.editing.set(null); this.editLabel.set(''); this.quickEditor.set(null); this.notice.set(null);
        this.d.set(null); this.catalog.set([]); this.readingOwner = owner;
      }
      void this.load();
    });
  });

  async load() {
    const sequence = ++this.sequence;
    this.loading.set(true);
    try {
      const [data, catalog] = await Promise.all([
        this.bpm.capsReview(this.period()),
        this.bpm.categories(true),
      ]);
      if (sequence !== this.sequence) return;
      this.d.set(data);
      this.catalog.set(catalog);
      if (this.initialTarget && this.capTargets().some(target => target.key === this.initialTarget)) {
        if (this.quickTarget() !== this.initialTarget) this.chooseTarget(this.initialTarget);
        this.focusTarget(this.initialTarget);
        this.initialTarget = null;
      }
      if (!this.quickTarget() && data.centers.length) this.chooseTarget(`center:${data.centers[0].ref}`);
      this.error.set('');
    } catch (e) {
      if (sequence === this.sequence) {
        this.d.set(null);
        this.catalog.set([]);
        this.error.set(toApiError(e).message);
      }
    } finally {
      if (sequence === this.sequence) this.loading.set(false);
    }
  }

  // ---------- saisie et détail d'une charge ----------

  protected lineId = bpmQueryState<string | null>('ligne', null, { overlay: true });
  protected entryDefaults = signal<Partial<EntryInput>>({ direction: 'charge' });

  protected openEntry(c?: CapCard) {
    this.entryDefaults.set({
      direction: 'charge',
      ...(c
        ? { costCenterRef: c.centerRef, ...(c.categoryId ? { categoryId: c.categoryId } : {}) }
        : {}),
    });
    void this.ctx.setQuery({ entry: 'new' });
  }
  protected closeEntry() {
    void this.ctx.setQuery({ entry: null }, { replace: true });
  }
  protected saved(text: string) {
    this.closeEntry();
    this.notice.set({ text, error: false });
    this.load();
  }
  protected openLine(x: ReviewCharge) {
    this.lineId.set(x.id);
  }
  protected closeLine() {
    this.lineId.set(null);
    this.load();
  }
  protected editLine(line: RegisterLine) {
    this.lineId.set(null);
    void this.ctx.setQuery({ entry: line.id });
  }

  // Un seul plafond modifié par commande ; les autres postes sont préservés.
  protected catalog = signal<ChargeCategory[]>([]);
  protected activeCategories = computed(() =>
    this.catalog()
      .filter((k) => !k.archived)
      .sort(
        (a, b) =>
          a.costCenterLabel.localeCompare(b.costCenterLabel, 'fr') ||
          a.label.localeCompare(b.label, 'fr'),
      ),
  );
  protected selectedCenter = signal('');
  protected centerAmount = signal('');
  protected centerSelection = computed(
    () => this.d()?.centers.find((c) => c.ref === this.selectedCenter()) ?? null,
  );
  protected centerDirty = computed(
    () =>
      !!this.centerSelection() &&
      this.centerAmount() !== capEuroText(this.centerSelection()!.capCents),
  );
  protected selectedCategory = signal('');
  protected categoryAmount = signal('');
  protected categorySelection = computed(
    () => this.activeCategories().find((k) => k.id === this.selectedCategory()) ?? null,
  );
  protected categoryDirty = computed(
    () =>
      !!this.categorySelection() &&
      this.categoryAmount() !== capEuroText(this.categorySelection()!.capCents),
  );
  protected selectCenter(ref: string) {
    this.quickTarget.set(`center:${ref}`);
    this.selectedCenter.set(ref);
    this.centerAmount.set(capEuroText(this.centerSelection()?.capCents ?? null));
  }
  protected selectCategory(id: string) {
    this.quickTarget.set(`category:${id}`);
    this.selectedCategory.set(id);
    this.categoryAmount.set(capEuroText(this.categorySelection()?.capCents ?? null));
  }
  protected configure(c: CapCard) {
    this.chooseTarget(c.level === 'Catégorie' && c.categoryId ? `category:${c.categoryId}` : `center:${c.centerRef}`);
    this.router.navigate(this.workspace() ? ['/plafonds/reglages'] : [], {
      relativeTo: this.route,
      queryParams: { view: this.workspace() ? null : 'plafonds', target: this.quickTarget() },
      queryParamsHandling: 'merge',
      fragment: undefined,
    });
  }
  protected configureCategory(id: string) {
    this.chooseTarget(`category:${id}`);
    this.router.navigate(this.workspace() ? ['/plafonds/reglages'] : [], {
      relativeTo: this.route,
      queryParams: { view: this.workspace() ? null : 'plafonds', target: this.quickTarget() },
      queryParamsHandling: 'merge',
      fragment: undefined,
    });
  }
  async saveCenter() {
    const c = this.centerSelection(),
      d = this.d();
    if (!c || !d || this.busy()) return;
    const amount = capInput(this.centerAmount());
    if (amount === undefined)
      return this.notice.set({
        text: 'Saisissez un montant positif, ou laissez vide pour retirer le plafond.',
        error: true,
      });
    await this.run(async () => {
      await this.bpm.setCaps({
        expectedRevision: d.lifeBudget.revision,
        caps: { [c.ref]: amount },
        merge: true,
      });
      this.centerAmount.set(capEuroText(amount === null ? null : Math.round(amount * 100)));
      if (this.quickEditor() === 'center') this.quickEditor.set(null);
      return `Plafond du poste « ${c.label} » ${amount === null ? 'retiré' : 'enregistré'}.`;
    });
  }
  async saveCategoryCap() {
    const k = this.categorySelection();
    if (!k || this.busy()) return;
    const cap = capInput(this.categoryAmount());
    if (cap === undefined)
      return this.notice.set({
        text: 'Saisissez un montant positif, ou laissez vide pour retirer le plafond.',
        error: true,
      });
    await this.run(async () => {
      await this.bpm.updateCategory(k.id, { expectedRevision: k.revision, cap });
      this.categoryAmount.set(capEuroText(cap === null ? null : Math.round(cap * 100)));
      if (this.quickEditor() === 'category') this.quickEditor.set(null);
      return `Plafond de la catégorie « ${k.label} » ${cap === null ? 'retiré' : 'enregistré'}.`;
    });
  }

  // ---------- catégories ----------

  protected categoryGroups = computed(() => {
    const v = this.d();
    if (!v) return [];
    return v.centers
      .map((c) => ({
        ref: c.ref,
        label: c.label,
        items: this.catalog()
          .filter((k) => k.costCenterRef === c.ref)
          .sort(
            (a, b) =>
              Number(a.archived) - Number(b.archived) || a.label.localeCompare(b.label, 'fr'),
          ),
      }))
      .filter((g) => g.items.length);
  });

  protected newLabel = signal('');
  protected newCenter = signal('');
  private createKey = newRequestKey('category');

  async createCategory() {
    if (!this.newLabel().trim() || !this.newCenter())
      return this.notice.set({ text: 'Nommez la catégorie et choisissez son poste.', error: true });
    await this.run(async () => {
      const r = await this.bpm.createCategory({
        requestKey: this.createKey,
        label: this.newLabel().trim(),
        costCenterRef: this.newCenter(),
      });
      this.createKey = newRequestKey('category');
      this.newLabel.set('');
      if (this.quickEditor() === 'create') {
        this.catalog.update(items => [...items, r.category]);
        this.chooseTarget(`category:${r.category.id}`);
        this.quickEditor.set('category');
      }
      return `Catégorie « ${r.category.label} » créée dans ${r.category.costCenterLabel}.`;
    });
  }

  protected editing = signal<string | null>(null);
  protected editLabel = signal('');
  protected startEdit(k: ChargeCategory) {
    this.editing.set(k.id);
    this.editLabel.set(k.label);
  }
  async saveCategory(k: ChargeCategory) {
    if (!this.editLabel().trim())
      return this.notice.set({ text: 'Le nom de la catégorie est obligatoire.', error: true });
    await this.run(async () => {
      await this.bpm.updateCategory(k.id, {
        expectedRevision: k.revision,
        label: this.editLabel().trim(),
      });
      this.editing.set(null);
      return `Catégorie « ${this.editLabel().trim()} » enregistrée.`;
    });
  }
  async archive(k: ChargeCategory, archived: boolean) {
    await this.run(async () => {
      await this.bpm.updateCategory(k.id, { expectedRevision: k.revision, archived });
      return archived
        ? `Catégorie « ${k.label} » retirée des choix ; ses dépenses gardent leur rangement.`
        : `Catégorie « ${k.label} » rétablie.`;
    });
  }

  constructor() {
    inject(BpmDrafts).fields('caps-workspace', this, [
      'quickTarget', 'selectedCenter', 'centerAmount', 'selectedCategory', 'categoryAmount',
      'newLabel', 'newCenter', 'createKey', 'editing', 'editLabel',
    ], inject(DestroyRef));
  }

  private async run(fn: () => Promise<string>) {
    if (this.busy()) return;
    this.busy.set(true);
    this.notice.set(null);
    try {
      const text = await fn();
      this.notice.set({ text, error: false });
      await this.load();
    } catch (e) {
      this.notice.set({ text: toApiError(e).message, error: true });
    } finally {
      this.busy.set(false);
    }
  }
}
