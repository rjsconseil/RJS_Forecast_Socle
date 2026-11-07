import { injectPageWorkspace } from '../shared/page-workspace';
import { BpmDrafts } from './ui/drafts';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, ApiError, newRequestKey, toApiError } from '../core/api.service';
import { BpmDashboard, Closure, CostCenter, Direction } from '../core/models';
import { BpmApi } from '../core/bpm-api.service';
import { CentsPipe, euros, parseAmount, ShortDatePipe } from '../core/format';
import { BpmPageFocus, BpmPageFrame, bpmLoader } from './ui';
import { PageResult } from '../shared/page-toolbar.component';

const amountInput = (n: number | null) => (n === null ? '' : String(n).replace('.', ','));

/**
 * Réglages, sur la page « Cycle budgétaire » de la référence (`rjs-budget-cycle-page`, feuille globale `_budget-cycle.scss`) :
 * bandeau commun, cycle (en-tête de période, compte du jour d'ancrage, formulaire), point de départ du patrimoine
 * en valeur (total, repères, formulaire), clôtures réalisées en tableau, centres de coût et accès aux formules.
 */
@Component({
  selector: 'app-bpm-settings',
  imports: [RouterLink, ShortDatePipe, CentsPipe, BpmPageFrame],
  template: `
    <bpm-page
      pageClass="bc-page"
      kicker="Mes projets de la vie"
      title="Cycle et réglages"
      lead="Réglez votre cycle budgétaire, le montant initial de votre patrimoine et vos postes."
      [context]="summary.data()?.context"
      [focus]="focus()"
      [scope]="workspace() ? 'Profil actif · ' + workspace()!.title : 'Profil actif · cycle, patrimoine et postes'"
      [result]="result()"
      toolsLabel="Réglages en cours"
    >
      <ng-container primary>
        @if (activeCycleDirty()) {
          <button
            type="submit"
            form="bpm-cycle-settings"
            class="app-hero-action"
            [disabled]="saving()"
          >
            {{ cycleSaving() ? 'Enregistrement…' : 'Enregistrer le cycle' }}
          </button>
        } @else if (activePatDirty()) {
          <button
            type="submit"
            form="bpm-wealth-settings"
            class="app-hero-action"
            [disabled]="saving()"
          >
            {{ patSaving() ? 'Enregistrement…' : 'Enregistrer le patrimoine' }}
          </button>
        } @else if (activeCenterLabel()) {
          <button
            type="submit"
            form="bpm-center-settings"
            class="app-hero-action"
            [disabled]="saving()"
          >
            {{ ccSaving() ? 'Ajout…' : 'Ajouter « ' + activeCenterLabel() + ' »' }}
          </button>
        } @else {
          <button
            type="button"
            class="btn btn-secondary"
            (click)="load(); summary.reload()"
            [disabled]="loading() || saving()"
          >
            Actualiser les réglages
          </button>
        }
      </ng-container>
      <ng-container actions>
        @if (activeCycleDirty() && activePatDirty()) {
          <button
            type="submit"
            form="bpm-wealth-settings"
            class="btn btn-secondary"
            [disabled]="saving()"
          >
            Enregistrer le patrimoine
          </button>
        }
        @if ((activeCycleDirty() || activePatDirty()) && activeCenterLabel()) {
          <button
            type="submit"
            form="bpm-center-settings"
            class="btn btn-secondary"
            [disabled]="saving()"
          >
            Ajouter « {{ activeCenterLabel() }} »
          </button>
        }
      </ng-container>
      <nav tools class="bpm-toolbar-shortcuts" aria-label="Accès aux réglages">
        @if (activeCycleDirty()) {
          <button
            type="button"
            class="btn btn-secondary"
            (click)="resetCycle()"
            [disabled]="saving()"
          >
            Rétablir le cycle enregistré
          </button>
        }
        @if (activePatDirty()) {
          <button
            type="button"
            class="btn btn-secondary"
            (click)="resetPatrimoine()"
            [disabled]="saving()"
          >
            Rétablir le patrimoine enregistré
          </button>
        }
        @if (!workspace()) {
        <a
          class="btn btn-secondary"
          [routerLink]="[]"
          fragment="bc-cycle-title"
          queryParamsHandling="preserve"
          >Cycle budgétaire</a
        >
        <a
          class="btn btn-secondary"
          [routerLink]="[]"
          fragment="bc-wealth-title"
          queryParamsHandling="preserve"
          >Stock d’ouverture</a
        >
        @if (closures().length) {
          <a
            class="btn btn-secondary"
            [routerLink]="[]"
            fragment="bc-history-title"
            queryParamsHandling="preserve"
            >{{ closures().length }} clôture(s) réalisées</a
          >
        }
        <a
          class="btn btn-secondary"
          [routerLink]="[]"
          fragment="bc-centers-title"
          queryParamsHandling="preserve"
          >Postes et revenus</a
        >
        } @else if (workspace()?.key === 'settings-cycle') {
          <a class="btn btn-secondary" routerLink="/projet-de-vie/cloture" queryParamsHandling="preserve">Examiner les cycles à clôturer</a>
          @if (closures().length) { <a class="btn btn-secondary" [routerLink]="[]" fragment="bc-history-title" queryParamsHandling="preserve">{{ closures().length }} clôture(s) enregistrée(s)</a> }
        } @else if (workspace()?.key === 'settings-wealth') {
          <a class="btn btn-secondary" routerLink="/vision/reperes" queryParamsHandling="preserve">Préparer mon épargne et mon cap</a>
        } @else {
          <a class="btn btn-secondary" routerLink="/plafonds/reglages" queryParamsHandling="preserve">Définir un plafond sur ces postes</a>
          <a class="btn btn-secondary" routerLink="/plafonds/categories" queryParamsHandling="preserve">Organiser les catégories de dépense</a>
        }
      </nav>

      @if (loadError()) {
        <div class="bc-alert bc-inline" role="alert">
          <span>{{ loadError() }}</span>
          <button type="button" class="btn btn-secondary" (click)="load()">Réessayer</button>
        </div>
      }

      @if (dash(); as d) {
        @if (!workspace() && d.cycle?.state !== 'active') {
          <!-- État vide de la référence : expliquer le cycle avant de le configurer. -->
          <section class="bc-empty" data-ui-pattern="panel" aria-labelledby="bc-empty-title">
            <p class="bc-kicker">Cycle budgétaire</p>
            <h2 id="bc-empty-title">
              Un budget qui repart de zéro, un patrimoine qui garde la mémoire
            </h2>
            <p>
              Choisissez le jour d'ancrage de votre cycle mensuel. À chaque fin de période, le
              résultat du budget rejoint le patrimoine ; le budget suivant repart à zéro.
            </p>
            <ol class="bc-steps">
              <li>
                <span class="bc-step-mark" aria-hidden="true">01</span><strong>La période</strong
                ><span>Les entrées et sorties de la période forment son résultat.</span>
              </li>
              <li>
                <span class="bc-step-mark" aria-hidden="true">02</span><strong>La clôture</strong
                ><span
                  >La période se clôture une seule fois ; sa formule et sa révision sont
                  conservées.</span
                >
              </li>
              <li>
                <span class="bc-step-mark" aria-hidden="true">03</span><strong>Le patrimoine</strong
                ><span
                  >Un excédent l'augmente, un déficit le diminue : il peut devenir négatif.</span
                >
              </li>
            </ol>
          </section>
        }

        @if (showCycle()) {
        <!-- 1. Le cycle -->
        <section
          class="bc-hero"
          data-bpm-frame="form"
          data-ui-pattern="panel"
          aria-labelledby="bc-cycle-title"
        >
          <header class="bc-hero-head">
            <div>
              <p class="bc-kicker">Cycle budgétaire · Mensuel</p>
              <h2 id="bc-cycle-title">
                {{ d.cycle?.state === 'active' ? 'Cycle actif' : 'Cycle à configurer' }}
              </h2>
              <p class="bc-subtitle">
                Chaque période commence le jour d'ancrage et se termine la veille du même jour le
                mois suivant.
              </p>
            </div>
            @if (d.cycle?.anchorDay; as day) {
              <div class="bc-countdown">
                <strong>{{ day }}</strong>
                <span>jour d'ancrage</span>
                @if (d.cycle?.startDate) {
                  <small>Depuis le {{ d.cycle?.startDate | shortDate }}</small>
                }
              </div>
            }
          </header>
          @if (d.cycle) {
            <p>
              <span
                class="bc-state"
                [attr.data-state]="d.cycle.state === 'active' ? 'closed' : 'forecast'"
                >{{ d.cycle.state === 'active' ? 'Actif' : 'À configurer' }}</span
              >
            </p>
          }
          @if (!d.cycle) {
            <p class="bc-alert" role="alert">Aucune liaison de cycle pour ce profil financier.</p>
          } @else {
            @if (closures().length) {
              <p class="bc-note bc-note-danger" role="note">
                {{ closures().length }} période(s) déjà close(s) : le jour d'ancrage et la date de
                début sont figés. Une modification sera refusée.
              </p>
            }
            <form
              id="bpm-cycle-settings"
              class="bc-form"
              (submit)="$event.preventDefault(); saveCycle()"
              novalidate
              aria-label="Configurer le cycle"
            >
              <div class="bc-controls">
                <label>
                  <span>Jour d'ancrage <em>1 à 28</em></span>
                  <input
                    type="number"
                    min="1"
                    max="28"
                    step="1"
                    inputmode="numeric"
                    [value]="cAnchor()"
                    (input)="cAnchor.set($any($event.target).value)"
                    [disabled]="!!closures().length || cycleSaving()"
                  />
                </label>
                <label>
                  <span>Date de début</span>
                  <input
                    type="date"
                    [value]="cStart()"
                    (input)="cStart.set($any($event.target).value)"
                    [disabled]="!!closures().length || cycleSaving()"
                  />
                </label>
                <button
                  type="submit"
                  class="btn btn-primary"
                  [disabled]="saving() || !!closures().length || !cycleDirty()"
                >
                  {{ cycleSaving() ? 'Enregistrement…' : 'Enregistrer le cycle' }}
                </button>
              </div>
              @if (cycleError(); as e) {
                <div class="bc-alert" role="alert">
                  <p>{{ cycleMessage(e) }}</p>
                  @if (e.isConflict) {
                    <button type="button" class="btn btn-secondary" (click)="reloadCycle()">
                      Relire la version actuelle
                    </button>
                  }
                </div>
              }
              @if (cycleSaved()) {
                <p class="bc-note bc-ok" data-sign="positive" role="status">Cycle enregistré.</p>
              }
            </form>
          }
        </section>

        }
        @if (showPatrimoine()) {
        <!-- 2. Le patrimoine : point de départ -->
        <section class="bc-wealth" data-ui-pattern="panel" aria-labelledby="bc-wealth-title">
          <div
            class="bc-wealth-main"
            [attr.data-sign]="
              d.patrimoine.openingStock === null ? 'unknown' : sign(d.patrimoine.openingStock)
            "
          >
            <p class="bc-kicker">Patrimoine</p>
            <h2 id="bc-wealth-title">Stock d'ouverture</h2>
            <strong class="bc-wealth-total">{{
              d.patrimoine.openingStock === null
                ? 'Inconnu'
                : signedEuros(d.patrimoine.openingStock)
            }}</strong>
            @if (d.patrimoine.openingStock === null) {
              <p class="bc-note">
                Le stock n'est pas connu : les chiffres qui en dépendent s'afficheront « Inconnu »,
                jamais 0.
              </p>
            } @else if (d.patrimoine.openingStock < 0) {
              <p class="bc-note bc-note-danger">Le stock d'ouverture est négatif.</p>
            }
          </div>
          <dl class="bc-wealth-parts">
            <div>
              <dt>Date d'ouverture</dt>
              <dd>
                {{
                  d.patrimoine.openingDate
                    ? (d.patrimoine.openingDate | shortDate)
                    : 'Non renseignée'
                }}
              </dd>
            </div>
            <div>
              <dt>Objectif</dt>
              <dd>
                {{
                  d.patrimoine.objective === null ? 'Aucun objectif' : euros(d.patrimoine.objective)
                }}
              </dd>
            </div>
            <div>
              <dt>Dernière clôture</dt>
              <dd [attr.data-sign]="closures().length ? sign(closures()[0].result) : null">
                {{ closures().length ? signedEuros(closures()[0].result) : 'Aucune clôture' }}
              </dd>
            </div>
            <div>
              <dt>Périodes closes</dt>
              <dd>{{ closures().length }}</dd>
            </div>
          </dl>
          <form
            id="bpm-wealth-settings"
            class="bc-form bc-wealth-form"
            (submit)="$event.preventDefault(); savePatrimoine()"
            novalidate
            aria-label="Modifier le point de départ du patrimoine"
          >
            <p class="bc-note">
              Le stock d'ouverture est votre point de départ ; il peut être négatif. Laissez-le vide
              s'il n'est pas connu. L'objectif est une information : il sert à mesurer la
              progression, sans contrainte.
            </p>
            <div class="bc-controls">
              <label>
                <span>Stock d'ouverture (€)</span>
                <input
                  inputmode="decimal"
                  autocomplete="off"
                  placeholder="Inconnu"
                  [value]="pStock()"
                  (input)="pStock.set($any($event.target).value)"
                />
              </label>
              <label>
                <span>Date d'ouverture</span>
                <input
                  type="date"
                  [value]="pDate()"
                  (input)="pDate.set($any($event.target).value)"
                />
              </label>
              <label>
                <span>Objectif (€) <em>facultatif</em></span>
                <input
                  inputmode="decimal"
                  autocomplete="off"
                  placeholder="Aucun objectif"
                  [value]="pObjective()"
                  (input)="pObjective.set($any($event.target).value)"
                />
              </label>
            </div>
            @if (patError(); as e) {
              <div class="bc-alert" role="alert">
                @if (e.isConflict) {
                  <p><strong>Le patrimoine a été modifié entre-temps.</strong></p>
                  <p>
                    Votre saisie est conservée. Vous pouvez relire la version actuelle ou
                    réappliquer votre saisie sur celle-ci.
                  </p>
                  <div class="bc-actions">
                    <button type="button" class="btn btn-secondary" (click)="reloadPatrimoine()">
                      Relire la version actuelle
                    </button>
                    <button type="button" class="btn btn-secondary" (click)="rebasePatrimoine()">
                      Réappliquer ma saisie
                    </button>
                  </div>
                } @else {
                  <p>{{ e.message }}</p>
                }
              </div>
            }
            @if (patSaved()) {
              <p class="bc-note bc-ok" data-sign="positive" role="status">Patrimoine enregistré.</p>
            }
            <div class="bc-actions">
              <button type="submit" class="btn btn-primary" [disabled]="patSaving()">
                {{ patSaving() ? 'Enregistrement…' : 'Enregistrer le patrimoine' }}
              </button>
              <a
                class="bpm-link"
                [routerLink]="['/object-management']"
                [queryParams]="{ inspect: d.patrimoine.id }"
                >Inspecter</a
              >
            </div>
          </form>
        </section>

        }
        @if (showCycle()) {
        <!-- 3. Historique des clôtures -->
        <section class="bc-history" data-ui-pattern="panel" aria-labelledby="bc-history-title">
          <p class="bc-kicker">Historique</p>
          <h2 id="bc-history-title" class="bc-section-title" data-ui-pattern="section-heading">
            Clôtures réalisées
          </h2>
          <p class="bc-note">
            À la clôture, le résultat de la période est calculé par sa formule et transféré une
            seule fois au Patrimoine (capitalisation). La formule et sa révision sont conservées
            telles qu'appliquées.
          </p>
          @if (closures().length) {
            <div class="bc-table-wrap">
              <table class="bc-table">
                <thead>
                  <tr>
                    <th scope="col">Période</th>
                    <th scope="col">Vers le patrimoine</th>
                    <th scope="col">Formule appliquée</th>
                    <th scope="col">État</th>
                    <th scope="col">Détails</th>
                  </tr>
                </thead>
                <tbody>
                  @for (c of closures(); track c.id) {
                    <tr>
                      <th scope="row">
                        {{ c.periodLabel }}
                        <small
                          >{{ c.periodStart | shortDate }} → {{ c.periodEnd | shortDate }}</small
                        >
                      </th>
                      <td [attr.data-sign]="sign(c.result)">
                        <strong>{{ signedEuros(c.result) }}</strong>
                      </td>
                      <td class="bc-formula">
                        <code>{{ c.calculation.formula }}</code>
                        @if (c.calculation.explanation) {
                          <small>= {{ c.calculation.explanation }}</small>
                        }
                        <small
                          >{{ c.calculation.parameter.key }} · révision
                          {{ c.calculation.parameter.revision ?? '—' }} ({{
                            c.calculation.parameter.origin
                          }}) · close le {{ c.createdAt.slice(0, 10) | shortDate }}</small
                        >
                      </td>
                      <td>
                        <span class="bc-state" data-state="closed"
                          >Budget remis à {{ c.budgetBalanceAfterCents | cents }}</span
                        >
                      </td>
                      <td class="bc-links-cell">
                        <a [routerLink]="['/admin/calculs', c.calculation.metric]"
                          >Formule actuelle</a
                        >
                        <a [routerLink]="['/object-management']" [queryParams]="{ inspect: c.id }"
                          >Inspecter la clôture</a
                        >
                        <a
                          [routerLink]="['/object-management']"
                          [queryParams]="{ inspect: c.capitalizationId }"
                          >Capitalisation</a
                        >
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="bc-note">Aucune période n'est encore clôturée.</p>
          }
        </section>

        }
        @if (showCenters()) {
        <!-- 4. Centres de coût -->
        <section class="bc-centers" data-ui-pattern="panel" aria-labelledby="bc-centers-title">
          <p class="bc-kicker">Budget</p>
          <h2 id="bc-centers-title" class="bc-section-title" data-ui-pattern="section-heading">
            Postes et sources de revenus
          </h2>
          <p class="bc-note">
            Le catalogue commun est géré dans l’<a routerLink="/admin">Administration</a>. Vos
            postes personnels appartiennent uniquement à votre profil financier.
          </p>
          <div class="bc-table-wrap">
            <table class="bc-table">
              <thead>
                <tr>
                  <th scope="col">Poste ou source</th>
                  <th scope="col">Sens</th>
                  <th scope="col">Origine</th>
                </tr>
              </thead>
              <tbody>
                @for (c of standardCenters(); track c.ref) {
                  <tr>
                    <th scope="row">{{ c.label }}</th>
                    <td [attr.data-sign]="c.direction === 'income' ? 'positive' : 'negative'">
                      {{ c.directionLabel }}
                    </td>
                    <td><span class="bc-state">Standard</span></td>
                  </tr>
                }
                @for (c of personalCenters(); track c.ref) {
                  <tr>
                    <th scope="row">{{ c.label }}</th>
                    <td [attr.data-sign]="c.direction === 'income' ? 'positive' : 'negative'">
                      {{ c.directionLabel }}
                    </td>
                    <td><span class="bc-state" data-state="open">Personnel</span></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (!personalCenters().length) {
            <p class="bc-note">Aucun poste personnel.</p>
          }
          <form
            id="bpm-center-settings"
            class="bc-form"
            (submit)="$event.preventDefault(); addCenter()"
            novalidate
            aria-label="Ajouter un poste personnel"
          >
            <div class="bc-controls">
              <label>
                <span>Nouveau poste ou source</span>
                <input
                  maxlength="120"
                  autocomplete="off"
                  placeholder="Ex. Animaux"
                  [value]="ccLabel()"
                  (input)="ccLabel.set($any($event.target).value)"
                />
              </label>
              <label>
                <span>Sens</span>
                <select
                  [value]="ccDirection()"
                  (change)="ccDirection.set($any($event.target).value)"
                >
                  <option value="charge" [selected]="ccDirection() === 'charge'">Charges</option>
                  <option value="income" [selected]="ccDirection() === 'income'">Revenus</option>
                </select>
              </label>
              <button type="submit" class="btn btn-secondary" [disabled]="ccSaving()">
                {{ ccSaving() ? 'Ajout…' : 'Ajouter' }}
              </button>
            </div>
            @if (ccError(); as e) {
              <p class="bc-alert" role="alert">{{ e.message }}</p>
            }
          </form>
        </section>

        }
        @if (!workspace()) {
        <!-- 5. Calculs -->
        <p class="bc-note">
          Les formules de tous les chiffres sont paramétrables dans l'Administration. Chaque chiffre
          affiché indique sa formule, sa révision et les opérations ou objets dont il provient.
        </p>
        <div class="bc-actions">
          <a class="btn btn-primary" routerLink="/depenses">Voir les dépenses</a>
          <button type="button" class="btn btn-secondary" (click)="load()" [disabled]="loading()">
            Actualiser
          </button>
        </div>
        }
      } @else if (loading()) {
        <p class="bc-loading" role="status">Lecture des réglages…</p>
      }
    </bpm-page>
  `,
  styles: `
    /* Compléments absents de _budget-cycle.scss (jetons source uniquement). */
    :host {
      display: block;
    }
    .bc-inline {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ecart-8) var(--ecart-12);
    }
    .bc-inline > span {
      flex: 1 1 16rem;
      min-width: 0;
    }
    .bc-alert p {
      margin: 0 0 var(--ecart-6);
    }
    .bc-alert p:last-child {
      margin-bottom: 0;
    }
    .bc-hero > p {
      margin: 0;
    }
    .bc-form {
      display: grid;
      gap: var(--ecart-12);
      min-width: 0;
    }
    .bc-controls input {
      width: var(--part-100);
      min-width: 0;
      min-height: var(--dim-48);
    }
    .bc-controls em {
      color: var(--muted);
      font-style: normal;
      font-weight: var(--fw-regular, 400);
    }
    .bc-ok {
      font-weight: var(--fw-semibold);
    }
    .bc-wealth .bc-wealth-form {
      grid-column: 1 / -1;
    }
    .bc-centers {
      display: grid;
      gap: var(--ecart-16);
      padding: var(--ecart-28);
    }
    .bc-formula {
      text-align: left;
      white-space: normal;
    }
    .bc-formula code {
      padding: var(--ecart-2) var(--ecart-8);
      border-radius: var(--rayon-6, 6px);
      background: var(--soft);
    }
    .bc-links-cell {
      text-align: left;
      white-space: normal;
    }
    .bc-links-cell a {
      display: block;
    }
    .bc-table th small {
      display: block;
      margin-top: var(--ecart-4);
      color: var(--muted);
      font-weight: var(--fw-regular, 400);
    }
    @media (max-width: 640px) {
      .bc-centers {
        padding: var(--ecart-16);
      }
    }
  `,
})
export class BpmSettings implements OnInit {
  protected workspace = injectPageWorkspace();
  protected showCycle = computed(() => !this.workspace() || this.workspace()?.key === 'settings-cycle');
  protected showPatrimoine = computed(() => !this.workspace() || this.workspace()?.key === 'settings-wealth');
  protected showCenters = computed(() => !this.workspace() || this.workspace()?.key === 'settings-centers');
  private api = inject(Api);
  private bpmApi = inject(BpmApi);
  /** Contexte du bandeau commun (user, périmètre, période, date de calcul), en lecture seule. */
  protected summary = bpmLoader(
    () => 0,
    () => this.bpmApi.summary(),
  );
  protected readonly euros = euros;

  protected dash = signal<BpmDashboard | null>(null);
  protected closures = signal<Closure[]>([]);
  protected centers = signal<CostCenter[]>([]);
  protected loading = signal(true);
  protected loadError = signal<string | null>(null);

  protected standardCenters = computed(() => this.centers().filter((c) => c.standard));
  protected personalCenters = computed(() => this.centers().filter((c) => !c.standard));

  // Cycle
  protected cAnchor = signal('');
  protected cStart = signal('');
  protected cycleSaving = signal(false);
  protected cycleSaved = signal(false);
  protected cycleError = signal<ApiError | null>(null);

  // Patrimoine
  protected pStock = signal('');
  protected pDate = signal('');
  protected pObjective = signal('');
  protected patSaving = signal(false);
  protected patSaved = signal(false);
  protected patError = signal<ApiError | null>(null);

  // Centres personnels
  protected ccLabel = signal('');
  protected ccDirection = signal<Direction>('charge');
  protected ccSaving = signal(false);
  protected ccError = signal<ApiError | null>(null);
  private ccRequestKey = newRequestKey();

  protected saving = computed(() => this.cycleSaving() || this.patSaving() || this.ccSaving());
  protected cycleDirty = computed(() => {
    const cycle = this.dash()?.cycle;
    return (
      !!cycle &&
      (this.cAnchor() !== (cycle.anchorDay == null ? '' : String(cycle.anchorDay)) ||
        this.cStart() !== (cycle.startDate ?? ''))
    );
  });
  protected patDirty = computed(() => {
    const p = this.dash()?.patrimoine;
    return (
      !!p &&
      (this.pStock() !== amountInput(p.openingStock) ||
        this.pDate() !== (p.openingDate ?? '') ||
        this.pObjective() !== amountInput(p.objective))
    );
  });
  protected activeCycleDirty = computed(() => this.showCycle() && this.cycleDirty());
  protected activePatDirty = computed(() => this.showPatrimoine() && this.patDirty());
  protected activeCenterLabel = computed(() => this.showCenters() ? this.ccLabel().trim() : '');
  private activeError = computed(() => (this.showCycle() ? this.cycleError() : null)
    ?? (this.showPatrimoine() ? this.patError() : null) ?? (this.showCenters() ? this.ccError() : null));
  private restoredCycle = false;
  private restoredPatrimoine = false;

  constructor() {
    inject(BpmDrafts).connect('settings-workspace', () => ({
      cycle: this.cycleDirty() ? { anchor: this.cAnchor(), start: this.cStart() } : null,
      patrimoine: this.patDirty() ? { stock: this.pStock(), date: this.pDate(), objective: this.pObjective() } : null,
      center: { label: this.ccLabel(), direction: this.ccDirection(), requestKey: this.ccRequestKey },
    }), draft => {
      if (draft.cycle) { this.cAnchor.set(draft.cycle.anchor); this.cStart.set(draft.cycle.start); this.restoredCycle = true; }
      if (draft.patrimoine) { this.pStock.set(draft.patrimoine.stock); this.pDate.set(draft.patrimoine.date); this.pObjective.set(draft.patrimoine.objective); this.restoredPatrimoine = true; }
      this.ccLabel.set(draft.center.label); this.ccDirection.set(draft.center.direction); this.ccRequestKey = draft.center.requestKey;
    }, inject(DestroyRef));
  }

  protected result = computed<PageResult | null>(() => {
    const error = this.activeError();
    if (error) return { message: error.message + ' Votre saisie est conservée.', tone: 'danger' };
    if (this.saving()) return { message: 'Enregistrement en cours…', tone: 'info' };
    if (this.activeCycleDirty() || this.activePatDirty() || this.activeCenterLabel()) return null;
    const saved = [
      this.showCycle() && this.cycleSaved() ? 'Cycle enregistré.' : '',
      this.showPatrimoine() && this.patSaved() ? 'Patrimoine enregistré.' : '',
    ].filter(Boolean);
    return saved.length ? { message: saved.join(' '), tone: 'success' } : null;
  });
  protected focus = computed<BpmPageFocus | null>(() => {
    const d = this.dash();
    if (!d) return null;
    const error = this.activeError();
    const count =
      Number(this.activeCycleDirty()) + Number(this.activePatDirty()) + Number(!!this.activeCenterLabel());
    if (error)
      return {
        title: 'Un réglage demande votre attention',
        detail: error.message + ' Votre saisie est conservée.',
        tone: 'warning',
      };
    if (count)
      return {
        title: `${count} réglage(s) à enregistrer`,
        detail: 'Les commandes ci-dessus enregistrent chaque partie séparément.',
        tone: 'warning',
      };
    if (this.workspace()?.key === 'settings-centers') return {
      title: `${this.personalCenters().length} poste(s) personnel(s)`,
      detail: 'Ajoutez un poste de charge ou une source de revenus, puis utilisez-le dans vos prochaines saisies.', tone: 'info',
    };
    if (this.showCycle() && d.cycle?.state !== 'active')
      return {
        title: 'Configurez votre cycle budgétaire',
        detail: 'Choisissez le jour d’ancrage et la date de début pour démarrer vos périodes.',
        tone: 'info',
      };
    if (this.showPatrimoine() && d.patrimoine.openingStock === null)
      return {
        title: 'Le stock d’ouverture reste à renseigner',
        detail: 'Indiquez votre point de départ pour obtenir les estimations du patrimoine.',
        tone: 'info',
      };
    return {
      title: 'Réglages enregistrés',
      detail: this.workspace()?.key === 'settings-wealth' ? 'Le stock d’ouverture et l’objectif servent de repères pour votre patrimoine.' : this.closures().length
        ? `${this.closures().length} période(s) close(s) : le début du cycle est figé.`
        : 'Vous pouvez ajuster le cycle, le patrimoine et vos postes personnels.',
      tone: 'success',
    };
  });

  protected resetCycle() {
    const d = this.dash();
    if (d) this.fillCycle(d);
    this.cycleError.set(null);
  }
  protected resetPatrimoine() {
    const d = this.dash();
    if (d) this.fillPatrimoine(d);
    this.patError.set(null);
  }

  async ngOnInit() {
    await this.load();
  }

  async load() {
    const keepCycle = this.cycleDirty() || this.restoredCycle;
    const keepPatrimoine = this.patDirty() || this.restoredPatrimoine;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [d, closures, centers] = await Promise.all([
        this.api.dashboard(),
        this.api.closures(),
        this.api.bpmCostCenters(),
      ]);
      this.dash.set(d);
      this.setClosures(closures);
      this.centers.set(centers);
      if (!keepCycle) this.fillCycle(d);
      if (!keepPatrimoine) this.fillPatrimoine(d);
      this.restoredCycle = false; this.restoredPatrimoine = false;
    } catch (err) {
      this.loadError.set(toApiError(err).message);
    } finally {
      this.loading.set(false);
    }
  }

  private setClosures(list: Closure[]) {
    this.closures.set(list.slice().sort((a, b) => b.periodStart.localeCompare(a.periodStart)));
  }

  private fillCycle(d: BpmDashboard) {
    this.cAnchor.set(d.cycle?.anchorDay != null ? String(d.cycle.anchorDay) : '');
    this.cStart.set(d.cycle?.startDate ?? '');
  }

  private fillPatrimoine(d: BpmDashboard) {
    this.pStock.set(amountInput(d.patrimoine.openingStock));
    this.pDate.set(d.patrimoine.openingDate ?? '');
    this.pObjective.set(amountInput(d.patrimoine.objective));
  }

  protected sign(v: number | null | undefined) {
    return v === null || v === undefined
      ? 'unknown'
      : v > 0
        ? 'positive'
        : v < 0
          ? 'negative'
          : null;
  }

  protected signedEuros(v: number) {
    return (v > 0 ? '+ ' : '') + euros(v);
  }

  protected cycleMessage(e: ApiError) {
    if (e.body.code === 'FORBIDDEN_BY_RULE') return `Modification refusée : ${e.message}`;
    if (e.isConflict)
      return 'Le cycle a été modifié entre-temps. Relisez la version actuelle avant de réessayer.';
    return e.message;
  }

  private invalid(target: 'cycle' | 'pat' | 'cc', message: string, field: string) {
    const err = new ApiError(400, {
      code: 'VALIDATION',
      action: null,
      message,
      details: { field },
    });
    (target === 'cycle' ? this.cycleError : target === 'pat' ? this.patError : this.ccError).set(
      err,
    );
  }

  // ---------- cycle ----------

  async saveCycle() {
    if (this.saving()) return;
    const d = this.dash();
    if (!d?.cycle) return;
    this.cycleSaved.set(false);
    const raw = this.cAnchor().trim();
    const anchorDay = Number(raw);
    if (!raw || !Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 28)
      return this.invalid('cycle', "Le jour d'ancrage est un entier de 1 à 28.", 'anchorDay');
    this.cycleSaving.set(true);
    this.cycleError.set(null);
    try {
      const next = await this.api.configureCycle({
        anchorDay,
        startDate: this.cStart() || null,
        expectedRevision: d.cycle.revision,
      });
      this.dash.set(next);
      this.fillCycle(next);
      this.cycleSaved.set(true);
    } catch (err) {
      this.cycleError.set(toApiError(err));
    } finally {
      this.cycleSaving.set(false);
    }
  }

  async reloadCycle() {
    try {
      const d = await this.api.dashboard();
      this.dash.set(d);
      this.fillCycle(d);
      this.cycleError.set(null);
    } catch (err) {
      this.cycleError.set(toApiError(err));
    }
  }

  // ---------- patrimoine ----------

  async savePatrimoine() {
    if (this.saving()) return;
    const d = this.dash();
    if (!d) return;
    this.patSaved.set(false);
    const stock = parseAmount(this.pStock());
    const objective = parseAmount(this.pObjective());
    if (stock === 'invalid')
      return this.invalid(
        'pat',
        "Stock d'ouverture : un montant en euros (ex. -1 250,50), ou vide s'il est inconnu.",
        'openingStock',
      );
    if (objective === 'invalid' || (objective !== null && objective < 0))
      return this.invalid('pat', 'Objectif : un montant positif en euros, ou vide.', 'objective');
    this.patSaving.set(true);
    this.patError.set(null);
    try {
      await this.api.updateBpmPatrimoine({
        expectedRevision: d.patrimoine.revision,
        openingStock: stock,
        openingDate: this.pDate() || null,
        objective,
      });
      const fresh = await this.api.dashboard();
      this.dash.set(fresh);
      this.fillPatrimoine(fresh);
      this.patSaved.set(true);
    } catch (err) {
      this.patError.set(toApiError(err));
    } finally {
      this.patSaving.set(false);
    }
  }

  async reloadPatrimoine() {
    try {
      const d = await this.api.dashboard();
      this.dash.set(d);
      this.fillPatrimoine(d);
      this.patError.set(null);
    } catch (err) {
      this.patError.set(toApiError(err));
    }
  }

  /** Conserve la saisie et adopte seulement la nouvelle version comme base. */
  async rebasePatrimoine() {
    try {
      this.dash.set(await this.api.dashboard());
      this.patError.set(null);
    } catch (err) {
      this.patError.set(toApiError(err));
    }
  }

  // ---------- centres personnels ----------

  async addCenter() {
    if (this.saving()) return;
    const label = this.ccLabel().trim();
    if (!label) return this.invalid('cc', 'Indiquez le nom du centre.', 'label');
    this.ccSaving.set(true);
    this.ccError.set(null);
    try {
      const r = await this.api.addCostCenter({
        requestKey: this.ccRequestKey,
        label,
        direction: this.ccDirection(),
      });
      this.ccRequestKey = newRequestKey();
      this.centers.set(r.costCenters);
      this.ccLabel.set('');
    } catch (err) {
      this.ccError.set(toApiError(err));
    } finally {
      this.ccSaving.set(false);
    }
  }
}
