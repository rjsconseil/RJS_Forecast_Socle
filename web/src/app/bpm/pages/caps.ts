import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { CapsReview, ChargeCategory, ReviewCharge } from '../../core/bpm-caps.models';
import { EntryInput, RegisterLine } from '../../core/bpm-models';
import { cents, CentsPipe, percentText, ShortDatePipe } from '../../core/format';
import { BpmLifeGaugeComponent } from '../life/life-gauge';
import { BpmLineDetail, BpmOperationEditor, BpmPageFrame, capEuroText, capInput } from '../ui';
import { newRequestKey } from '../ui/page-context';
import {
  anteriorityText,
  CapCard,
  healthOf,
  recurrenceText,
  REVIEW_MODES,
  ReviewMode,
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
  styleUrls: ['../projects/projects.page.scss', '../life/life-management.page.scss', './caps.scss'],
  imports: [
    FormsModule,
    RouterLink,
    CentsPipe,
    ShortDatePipe,
    BpmPageFrame,
    BpmLifeGaugeComponent,
    BpmLineDetail,
    BpmOperationEditor,
  ],
  template: `
    <bpm-page
      title="Plafonds et catégories"
      lead="Suivez vos dépenses, définissez vos limites et organisez vos catégories."
      pageClass="bpm-projects bpm-management bpm-life-management bpm-caps-page"
      [context]="d()?.context"
      [periodNav]="true"
    >
      <button
        actions
        class="btn btn-primary"
        type="button"
        [disabled]="!budgets().length"
        (click)="openEntry()"
      >
        ＋ Saisir une charge
      </button>
      <a actions class="bpm-link" routerLink="/depenses" [queryParams]="{ period: period() }"
        >Voir les dépenses</a
      >
      <nav tools class="caps-workspaces" aria-label="Espaces des plafonds et catégories">
        @for (tab of tabs; track tab.key; let i = $index) {
          <a
            [routerLink]="[]"
            [queryParams]="{ view: tab.key }"
            queryParamsHandling="merge"
            [fragment]="undefined"
            [attr.aria-current]="view() === tab.key ? 'page' : null"
          >
            <span class="caps-workspace-number">0{{ i + 1 }}</span
            ><span
              ><strong>{{ tab.label }}</strong
              ><small>{{ tab.note }}</small></span
            >
          </a>
        }
      </nav>
      @if (notice(); as n) {
        <p
          class="bpm-feedback"
          [class.is-error]="n.error"
          [attr.role]="n.error ? 'alert' : 'status'"
        >
          {{ n.text }}
        </p>
      }
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
              <span>Au-delà des plafonds, à reprendre ailleurs</span>
            </div>
            <div
              class="life-financial-stat life-available"
              [class.is-negative]="(d()?.totals?.expectedCents ?? 0) < 0"
            >
              <dt>Solde prévu à la clôture</dt>
              <dd>{{ expected() }}</dd>
              <span>{{ verdict() }}</span>
            </div>
          </dl>
        </section>

        @if (d(); as d) {
          @if (d.totals.toCompensateCents > 0) {
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
            <div class="caps-review-tools" role="search" aria-label="Présentation de la revue">
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
                    [routerLink]="[]"
                    [queryParams]="{ view: 'plafonds' }"
                    queryParamsHandling="merge"
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
                      <button
                        class="btn btn-primary"
                        type="button"
                        [disabled]="!budgets().length"
                        (click)="openEntry(c)"
                      >
                        Saisir une charge ici
                      </button>
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
                <p class="caps-step">02 · Paramétrage</p>
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
                    [routerLink]="[]"
                    [queryParams]="{ view: 'categories' }"
                    queryParamsHandling="merge"
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
                <p class="caps-step">03 · Organisation</p>
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

    @if (entryOpen() && budgets().length) {
      <bpm-operation-editor
        [budgets]="budgets()"
        [line]="editingLine()"
        [defaults]="entryDefaults()"
        (closed)="closeEntry()"
        (saved)="saved($event)"
      />
    } @else if (lineId()) {
      <bpm-line-detail [lineId]="lineId()!" (closed)="closeLine()" (edit)="editLine($event)" />
    }
  `,
})
export class BpmCapsPage {
  private router = inject(Router);
  private bpm = inject(BpmApi);
  private route = inject(ActivatedRoute);
  private sequence = 0;
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
  protected mode = signal<ReviewMode>('both');
  protected show = signal<'all' | 'over'>('all');
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

  protected expected = computed(() => {
    const v = this.d()?.totals.expectedCents;
    return v === null || v === undefined
      ? '—'
      : (v > 0 ? '+' : v < 0 ? '−' : '') + cents(Math.abs(v));
  });
  protected reviewNote = computed(() => {
    const n = this.d()?.totals.overCount ?? 0;
    return n
      ? `${n} dépassement${n > 1 ? 's' : ''} : les charges concernées sont dépliées, les plus lourdes d’abord.`
      : 'Aucun dépassement : chaque carte montre ce qu’il reste avant d’acheter.';
  });
  protected verdict = computed(() => {
    const t = this.d()?.totals;
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
    untracked(() => this.load());
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

  protected lineId = signal<string | null>(null);
  protected entryOpen = signal(false);
  protected editingLine = signal<RegisterLine | null>(null);
  protected entryDefaults = signal<Partial<EntryInput>>({ direction: 'charge' });

  protected openEntry(c?: CapCard) {
    this.editingLine.set(null);
    this.entryDefaults.set({
      direction: 'charge',
      ...(c
        ? { costCenterRef: c.centerRef, ...(c.categoryId ? { categoryId: c.categoryId } : {}) }
        : {}),
    });
    this.entryOpen.set(true);
  }
  protected closeEntry() {
    this.entryOpen.set(false);
    this.editingLine.set(null);
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
    this.editingLine.set(line);
    this.entryOpen.set(true);
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
    this.selectedCenter.set(ref);
    this.centerAmount.set(capEuroText(this.centerSelection()?.capCents ?? null));
  }
  protected selectCategory(id: string) {
    this.selectedCategory.set(id);
    this.categoryAmount.set(capEuroText(this.categorySelection()?.capCents ?? null));
  }
  protected configure(c: CapCard) {
    if (c.level === 'Catégorie' && c.categoryId) this.selectCategory(c.categoryId);
    else this.selectCenter(c.centerRef);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { view: 'plafonds' },
      queryParamsHandling: 'merge',
      fragment: undefined,
    });
  }
  protected configureCategory(id: string) {
    this.selectCategory(id);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { view: 'plafonds' },
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
