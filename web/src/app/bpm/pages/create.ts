import { BpmNavigation } from '../ui/navigation';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { SetupProfile } from '../../core/bpm-models';
import { CentsPipe, ShortDatePipe, SignedCentsPipe, tone } from '../../core/format';
import {
  BpmPageContext,
  BpmPageFocus,
  BpmPageFrame,
  BpmRefresh,
  BpmState,
  bpmLoader,
  newRequestKey,
} from '../ui';
import { BpmCreateDetails } from './create-details';
import { injectPageWorkspace } from '../../shared/page-workspace';
import {
  CenterOption,
  Draft,
  Errors,
  JOURNEY,
  Mode,
  PayloadMaps,
  STEPS,
  buildPayload,
  centerOptions,
  cyclePreview,
  draftFromProfile,
  locateField,
  mergeProfile,
  toCents,
  totalsOf,
  validate,
} from './create-model';

const STORE = 'bpm-create-draft:';

/**
 * Démarrer un projet — Partir de zéro (assistant en 7 étapes).
 * - Principal : configure le Budget du projet de vie existant (aucun second projet de vie ni Patrimoine).
 * - Branche : crée de zéro un projet de la vie (Budget standard, racine noyau, ≥ 1 tâche) via Object Management.
 * Une seule commande `setup` à la confirmation, avec une clé de demande générée une fois par brouillon :
 * une nouvelle tentative (double clic, réponse perdue, reprise) ne crée aucun doublon.
 * Naviguer entre les étapes n'écrit rien ; annuler n'écrit rien.
 */
@Component({
  selector: 'bpm-page-create',
  imports: [
    FormsModule,
    BpmPageFrame,
    BpmState,
    BpmCreateDetails,
    CentsPipe,
    SignedCentsPipe,
    ShortDatePipe,
  ],
  providers: [BpmPageContext],
  styleUrls: [
    '../ref-styles/bpm-pages.scss',
    '../ref-styles/bpm-create.page.scss',
    './create-journey.scss',
  ],
  template: `
    <bpm-page
      title="Démarrer un projet"
      lead="Configurez votre Budget du projet de vie ou créez un projet de la vie, puis confirmez en une seule fois."
      [context]="profile.data()?.budgetType?.context"
      [focus]="focus()"
      [scope]="draftScope()"
      [result]="
        serverError()
          ? { message: serverError()!.message, tone: 'danger' }
          : stepErrors().length
            ? {
                message: stepErrors().length + ' point(s) à corriger avant de poursuivre.',
                tone: 'warning',
              }
            : null
      "
      toolsLabel="Parcours et brouillon"
    >
      <ng-container primary>
        @if (ready() && draft(); as d) {
          @if (d.step < 7) {
            <button
              type="button"
              class="app-hero-action"
              (click)="next()"
              [disabled]="submitting()"
            >
              Valider l’étape {{ d.step }} →
            </button>
          } @else {
            <button
              type="button"
              class="app-hero-action"
              (click)="confirm()"
              [disabled]="submitting()"
              [attr.aria-busy]="submitting()"
            >
              {{
                submitting()
                  ? 'Enregistrement…'
                  : d.mode === 'branch'
                    ? 'Créer et ouvrir ce projet'
                    : 'Enregistrer mon projet de vie'
              }}
            </button>
          }
        }
      </ng-container>
      <ng-container actions>
        @if (ready() && draft(); as d) {
          @if (d.step > 1) {
            <button
              type="button"
              class="btn btn-secondary"
              (click)="prev()"
              [disabled]="submitting()"
            >
              ← Précédente
            </button>
          }
          <button
            type="button"
            class="btn btn-secondary app-hero-action"
            (click)="askCancel()"
            [disabled]="submitting()"
          >
            Annuler
          </button>
        }
      </ng-container>
      <div tools class="bpm-toolbar-shortcuts">
        @if (ready() && draft(); as d) {
          <label
            >Reprendre une étape
            <select [ngModel]="d.step" (ngModelChange)="go(+$event)" [disabled]="submitting()">
              @for (step of steps; track $index) {
                <option [value]="$index + 1" [disabled]="$index + 1 > d.maxReached">
                  {{ $index + 1 }} · {{ step.label }}
                </option>
              }
            </select>
          </label>
          @if (stepErrors().length || serverError()) {
            <button type="button" class="btn btn-secondary" (click)="showCurrentErrors()">
              Voir les points à corriger
            </button>
          }
          <span>La saisie est conservée dans cette session ; confirmation à l’étape 7.</span>
        }
      </div>

      <div class="bpm-start" data-tone="budget">
        <bpm-state
          [loading]="profile.loading() && !ready()"
          [error]="ready() ? null : profile.error()"
          (retry)="profile.reload()"
          [lines]="5"
        />

        @if (ready() && draft(); as d) {
          @if (confirmCancel()) {
            <section class="bpm-blocked" role="alertdialog" aria-labelledby="cancel-q">
              <p id="cancel-q">
                <strong>Abandonner ce brouillon ?</strong> Rien n'a été enregistré ; votre saisie
                sera effacée et l'ensemble existant reste inchangé.
              </p>
              <div class="bs-inline-actions">
                <button type="button" class="btn btn-primary" (click)="cancel()">
                  Abandonner le brouillon
                </button>
                <button type="button" class="btn btn-secondary" (click)="confirmCancel.set(false)">
                  Continuer la saisie
                </button>
              </div>
            </section>
          }
          @if (restored()) {
            <div class="bpm-missing bs-inline-actions" role="status">
              <span>Brouillon non confirmé repris (rien n'avait été enregistré).</span>
              <button type="button" class="btn btn-secondary" (click)="restart()">
                Repartir du profil enregistré
              </button>
              <button
                type="button"
                class="btn btn-secondary"
                (click)="restored.set(false)"
                aria-label="Masquer ce message"
              >
                ✕
              </button>
            </div>
          }

          <div class="bs-layout">
            <section
              id="bs-stage"
              class="bs-stage"
              data-bpm-frame="form"
              data-ui-pattern="detail"
              aria-labelledby="step-title"
            >
              <header class="bs-stage-head">
                <p class="bs-stage-count">
                  Jalon {{ currentMilestoneIndex() + 1 }} ·
                  {{ journey.milestones[currentMilestoneIndex()].title }}
                </p>
                <p class="bs-step-position" aria-live="polite">Étape {{ d.step }} sur 7</p>
                <h2 id="step-title" tabindex="-1">{{ steps[d.step - 1].label }}</h2>
                <p class="bs-stage-help">{{ specializedMode() && d.step === 2
                  ? specializedMode() === 'principal'
                    ? 'Précisez le nom et la description de votre Budget du projet de vie.'
                    : 'Nommez votre projet de la vie et préparez au moins une première tâche.'
                  : steps[d.step - 1].help }}</p>
                @if (d.mode && d.step > 2) {
                  <p>
                    <span class="status-pill">{{
                      d.mode === 'principal'
                        ? 'Budget du projet de vie (principal)'
                        : 'Projet de la vie (branche)'
                    }}</span>
                  </p>
                }
              </header>

              <div class="bs-body" (input)="touch($event)" (change)="touch()">
                @switch (d.step) {
                  <!-- 1. Votre situation -->
                  @case (1) {
                    @if (profile.data(); as p) {
                      <dl class="bs-recap">
                        <div>
                          <dt>Profil financier</dt>
                          <dd>{{ p.user.label }}</dd>
                        </div>
                        <div>
                          <dt>Type</dt>
                          <dd>{{ p.user.userTypeLabel ?? p.user.userType }}</dd>
                        </div>
                        <div>
                          <dt>Budget du projet de vie</dt>
                          <dd>{{ p.principal.project.title }}</dd>
                        </div>
                        <div>
                          <dt>Cycle</dt>
                          <dd>
                            {{
                              p.principal.cycle.state === 'active'
                                ? 'Mensuel, jour ' + p.principal.cycle.anchorDay
                                : 'À configurer'
                            }}
                          </dd>
                        </div>
                      </dl>
                      <h3>Aperçu de votre budget type</h3>
                      @if (p.budgetType.empty) {
                        <p class="bs-note">
                          Aucune opération récurrente active pour l'instant : le budget type est
                          vide. Les montants se saisissent à l'étape 3.
                        </p>
                      } @else {
                        <dl class="bs-recap">
                          <div>
                            <dt>Revenus (moyenne mensuelle)</dt>
                            <dd class="num">{{ p.budgetType.averageIncomeCents | cents }}</dd>
                          </div>
                          <div>
                            <dt>Charges (moyenne mensuelle)</dt>
                            <dd class="num">{{ p.budgetType.averageChargeCents | cents }}</dd>
                          </div>
                          <div class="bs-recap-wide">
                            <dt>Épargne naturelle (moyenne mensuelle)</dt>
                            <dd class="num" [attr.data-tone]="tone(p.budgetType.averageNetCents)">
                              {{ p.budgetType.averageNetCents | signedCents }}
                            </dd>
                            <dd class="bs-recap-note">Revenus moyens moins charges moyennes</dd>
                          </div>
                        </dl>
                        <p class="bpm-help">{{ p.budgetType.label }}.</p>
                      }
                      <h3>Profil de départ proposé</h3>
                      <dl class="bs-profile-detail">
                        <dt>Lignes récurrentes</dt>
                        <dd>
                          {{ existingCount() }} ligne(s) déjà enregistrée(s), reprises et
                          modifiables à l'étape 3.
                        </dd>
                        <dt>Suggestions</dt>
                        <dd>
                          {{ p.suggestions.length }} libellé(s) du catalogue commun, à compléter
                          avec vos montants : {{ p.note }}
                        </dd>
                        <dt>Stock initial</dt>
                        <dd>
                          {{
                            p.principal.patrimoine.openingStockCents === null
                              ? 'À renseigner'
                              : (p.principal.patrimoine.openingStockCents | cents)
                          }}
                        </dd>
                        <dt>Objectifs</dt>
                        <dd>{{ activeGoalCount() }} objectif(s) daté(s) enregistré(s).</dd>
                      </dl>
                      <p class="bs-note">
                        Ces propositions sont éditables et ne valent pas des opérations réalisées.
                        Rien n'est enregistré avant la confirmation de l'étape 7.
                      </p>
                    }
                  }

                  <!-- 2. Le projet -->
                  @case (2) {
                    @if (!specializedMode()) {
                    <div
                      class="bs-paths"
                      role="radiogroup"
                      aria-label="Que voulez-vous faire ?"
                      [attr.aria-invalid]="err('mode') ? 'true' : null"
                    >
                      <label class="bs-path" [class.is-selected]="d.mode === 'principal'">
                        <input type="radio" name="mode" value="principal" [(ngModel)]="d.mode" />
                        <span class="bs-path-icon" aria-hidden="true">◎</span>
                        <strong>Configurer le Budget du projet de vie (principal)</strong>
                        <span
                          >Votre budget du projet de vie existe déjà : vous complétez ses revenus,
                          charges, Patrimoine, cycle et vision. Aucun second projet de vie n'est
                          créé.</span
                        >
                      </label>
                      <label class="bs-path" [class.is-selected]="d.mode === 'branch'">
                        <input type="radio" name="mode" value="branch" [(ngModel)]="d.mode" />
                        <span class="bs-path-icon" aria-hidden="true">✦</span>
                        <strong>Créer un projet de la vie (branche)</strong>
                        <span
                          >Un nouveau projet avec son budget et au moins une tâche, financé par le
                          projet de vie. Il partage votre patrimoine existant.</span
                        >
                      </label>
                    </div>
                    @if (err('mode')) {
                      <p class="err">{{ err('mode') }}</p>
                    }
                    } @else {
                      <p class="bs-note">
                        {{ specializedMode() === 'principal'
                          ? 'Vous complétez votre Budget du projet de vie existant. Son identité et son Patrimoine sont conservés.'
                          : 'Vous préparez un nouveau projet de la vie, son budget et ses premières tâches. Il reste relié à votre projet de vie.' }}
                      </p>
                    }

                    @if (d.mode === 'principal') {
                      <label class="bs-field">
                        <span>Nom du Budget du projet de vie</span>
                        <input
                          [(ngModel)]="d.principalName"
                          maxlength="200"
                          autocomplete="off"
                          [attr.aria-invalid]="err('name') ? 'true' : null"
                        />
                        @if (err('name')) {
                          <span class="err">{{ err('name') }}</span>
                        }
                      </label>
                      <label class="bs-field">
                        <span>Description (facultative)</span>
                        <textarea
                          rows="3"
                          [(ngModel)]="d.principalDescription"
                          [attr.aria-invalid]="err('description') ? 'true' : null"
                        ></textarea>
                        @if (err('description')) {
                          <span class="err">{{ err('description') }}</span>
                        }
                      </label>
                    } @else if (d.mode === 'branch') {
                      <label class="bs-field">
                        <span>Nom du projet de la vie</span>
                        <input
                          [(ngModel)]="d.branchName"
                          maxlength="200"
                          autocomplete="off"
                          placeholder="Ex. Rénovation de la cuisine"
                          [attr.aria-invalid]="err('name') ? 'true' : null"
                        />
                        @if (err('name')) {
                          <span class="err">{{ err('name') }}</span>
                        }
                      </label>
                      <label class="bs-field">
                        <span>Description (facultative)</span>
                        <textarea
                          rows="3"
                          [(ngModel)]="d.branchDescription"
                          [attr.aria-invalid]="err('description') ? 'true' : null"
                        ></textarea>
                        @if (err('description')) {
                          <span class="err">{{ err('description') }}</span>
                        }
                      </label>
                      <details class="bpm-disclosure" open>
                        <summary>Tâches initiales ({{ d.tasks.length }})</summary>
                        <bpm-create-details
                          section="tasks"
                          [draft]="d"
                          [errorOf]="errFn"
                          (changed)="touch()"
                        />
                      </details>
                    }
                  }

                  <!-- 3. Le budget -->
                  @case (3) {
                    @if (d.mode === 'branch') {
                      <p class="bs-note">
                        Les lignes du Budget du projet de vie ne sont pas reprises : saisissez ici
                        les revenus et charges propres à «
                        {{ d.branchName || 'ce projet de la vie' }} ».
                      </p>
                    }
                    <dl class="bs-recap" aria-live="polite">
                      <div>
                        <dt>Revenus — moyenne mensuelle</dt>
                        <dd class="num">{{ totals().incomeCents | cents }}</dd>
                      </div>
                      <div>
                        <dt>Charges — moyenne mensuelle</dt>
                        <dd class="num">{{ totals().chargeCents | cents }}</dd>
                      </div>
                      <div class="bs-recap-wide">
                        <dt>Solde type — moyenne mensuelle</dt>
                        <dd class="num" [attr.data-tone]="tone(totals().netCents)">
                          {{ totals().netCents | signedCents }}
                        </dd>
                      </div>
                    </dl>
                    <p class="bs-note">
                      Moyennes calculées sur {{ totals().recurring }} ligne(s) récurrente(s) (hebdo
                      × 52 / 12, mensuelle, annuelle / 12) ; une moyenne ne remplace pas les
                      échéances réelles.
                      @if (totals().once) {
                        Les {{ totals().once }} ponctuelle(s) ne comptent pas dans la moyenne
                        (entrées {{ totals().onceIncomeCents | cents }}, charges
                        {{ totals().onceChargeCents | cents }}).
                      }
                      @if (totals().ended) {
                        {{ totals().ended }} ligne(s) terminée(s) exclue(s).
                      }
                      @if (totals().ignored) {
                        {{ totals().ignored }} suggestion(s) vide(s) ignorée(s).
                      }
                    </p>
                    <details class="bpm-disclosure" open>
                      <summary>Détailler et adapter les propositions</summary>
                      <p>
                        Ouvrez une ligne pour changer son libellé, son centre, son montant, son
                        rythme ou ses dates. Les suggestions sont des exemples à relire.
                      </p>
                      <bpm-create-details
                        section="budget"
                        [draft]="d"
                        [errorOf]="errFn"
                        [centers]="options()"
                        (changed)="touch()"
                      />
                    </details>
                  }

                  <!-- 4. Le patrimoine -->
                  @case (4) {
                    @if (profile.data(); as p) {
                      @if (d.mode === 'branch') {
                        <p class="bs-note">
                          Ce projet utilise le patrimoine unique de votre profil financier. Les
                          montants ci-dessous sont affichés pour référence.
                        </p>
                        <dl class="bs-recap">
                          <div>
                            <dt>Stock initial</dt>
                            <dd class="num">
                              {{
                                p.principal.patrimoine.openingStockCents === null
                                  ? 'À renseigner'
                                  : (p.principal.patrimoine.openingStockCents | signedCents)
                              }}
                            </dd>
                          </div>
                          <div>
                            <dt>Date du stock</dt>
                            <dd>{{ p.principal.patrimoine.openingDate | shortDate }}</dd>
                          </div>
                          <div class="bs-recap-wide">
                            <dt>Objectif de stock</dt>
                            <dd class="num">
                              {{
                                p.principal.patrimoine.objectiveCents === null
                                  ? 'Non défini'
                                  : (p.principal.patrimoine.objectiveCents | cents)
                              }}
                            </dd>
                          </div>
                        </dl>
                      } @else {
                        <fieldset class="bs-options">
                          <legend>Stock initial du Patrimoine</legend>
                          <label class="bs-option" [class.is-selected]="d.stockKnown">
                            <input
                              type="radio"
                              name="stockKnown"
                              [value]="true"
                              [(ngModel)]="d.stockKnown"
                            />
                            <strong>Je connais le montant</strong>
                          </label>
                          <label class="bs-option" [class.is-selected]="!d.stockKnown">
                            <input
                              type="radio"
                              name="stockKnown"
                              [value]="false"
                              [(ngModel)]="d.stockKnown"
                            />
                            <strong>À renseigner plus tard</strong>
                            <span>Le stock reste inconnu, jamais compté comme zéro.</span>
                          </label>
                        </fieldset>
                        @if (d.stockKnown) {
                          <div class="bs-vision">
                            <label class="bs-field">
                              <span>Stock initial (€, négatif accepté)</span>
                              <input
                                [(ngModel)]="d.stock"
                                inputmode="decimal"
                                class="num"
                                [attr.aria-invalid]="err('stock') ? 'true' : null"
                              />
                              @if (err('stock')) {
                                <span class="err">{{ err('stock') }}</span>
                              }
                            </label>
                            <label class="bs-field">
                              <span>À la date du</span>
                              <input
                                type="date"
                                [(ngModel)]="d.stockDate"
                                [attr.aria-invalid]="err('stockDate') ? 'true' : null"
                              />
                              @if (err('stockDate')) {
                                <span class="err">{{ err('stockDate') }}</span>
                              }
                            </label>
                          </div>
                        } @else {
                          <p class="bs-note">
                            Le stock reste inconnu (jamais compté comme zéro) : les projections
                            patrimoniales seront indiquées « Non calculable » tant qu'il n'est pas
                            renseigné.
                          </p>
                        }
                        <label class="bs-field">
                          <span>Objectif de stock (€, facultatif)</span>
                          <input
                            [(ngModel)]="d.objective"
                            inputmode="decimal"
                            class="num"
                            [attr.aria-invalid]="err('objective') ? 'true' : null"
                          />
                          @if (err('objective')) {
                            <span class="err">{{ err('objective') }}</span>
                          }
                        </label>
                        <p class="bs-fixed">
                          <strong>Patrimoine unique du profil financier</strong> ·
                          {{ p.user.label }} : un seul patrimoine réunit votre stock et vos objectifs.
                        </p>
                      }
                    }
                  }

                  <!-- 5. Le cycle -->
                  @case (5) {
                    @if (profile.data(); as p) {
                      @if (d.mode === 'branch') {
                        <p class="bs-note">
                          Un projet de la vie suit le cycle du Budget du projet de vie :
                          {{
                            p.principal.cycle.state === 'active'
                              ? 'mensuel, jour ' +
                                p.principal.cycle.anchorDay +
                                ', depuis le ' +
                                (p.principal.cycle.startDate | shortDate)
                              : 'cycle encore à configurer (dans le parcours principal)'
                          }}.
                        </p>
                      } @else {
                        <fieldset class="bs-cadences">
                          <legend>Fréquence</legend>
                          <label class="bs-cadence is-selected">
                            <input
                              type="radio"
                              name="periodicity"
                              value="monthly"
                              checked
                              disabled
                            />
                            <strong>Mensuelle</strong>
                            <span>Seule fréquence prise en charge.</span>
                          </label>
                        </fieldset>
                        @if (cycleLocked()) {
                          <p class="bpm-missing">
                            Des périodes sont déjà closes : le jour d'ancrage et la date de début
                            sont figés.
                          </p>
                          <dl class="bs-recap">
                            <div>
                              <dt>Jour d'ancrage</dt>
                              <dd>{{ d.cycleOrig.anchorDay }}</dd>
                            </div>
                            <div>
                              <dt>Date de début</dt>
                              <dd>{{ d.cycleOrig.start | shortDate }}</dd>
                            </div>
                          </dl>
                        } @else {
                          <div class="bs-vision">
                            <label class="bs-field">
                              <span>Jour d'ancrage (début de chaque période)</span>
                              <select
                                [(ngModel)]="d.anchorDay"
                                [attr.aria-invalid]="err('anchorDay') ? 'true' : null"
                              >
                                @if (d.cycleOrig.anchorDay === '') {
                                  <option value="">À configurer plus tard</option>
                                }
                                @for (n of days; track n) {
                                  <option [value]="'' + n">{{ n }}</option>
                                }
                              </select>
                              @if (err('anchorDay')) {
                                <span class="err">{{ err('anchorDay') }}</span>
                              }
                            </label>
                            @if (d.anchorDay !== '') {
                              <label class="bs-field">
                                <span>Date de début du cycle</span>
                                <input
                                  type="date"
                                  [(ngModel)]="d.cycleStart"
                                  [attr.aria-invalid]="err('cycleStart') ? 'true' : null"
                                />
                                @if (err('cycleStart')) {
                                  <span class="err">{{ err('cycleStart') }}</span>
                                }
                              </label>
                            }
                          </div>
                        }
                        @if (cycleView(); as cv) {
                          <h3>Lecture indicative des périodes</h3>
                          <dl class="bs-recap">
                            <div>
                              <dt>Première période</dt>
                              <dd>{{ cv.first.label }}</dd>
                            </div>
                            <div>
                              <dt>Période suivante</dt>
                              <dd>{{ cv.next.label }}</dd>
                            </div>
                            <div class="bs-recap-wide">
                              <dt>Période courante</dt>
                              <dd>{{ cv.current.label }}</dd>
                              <dd class="bs-recap-note">
                                du {{ cv.current.start | shortDate }} inclus au
                                {{ cv.current.endExclusive | shortDate }} exclu
                              </dd>
                            </div>
                            <div class="bs-recap-wide">
                              <dt>Reprise passée</dt>
                              <dd>
                                {{
                                  cv.startsLater
                                    ? 'Aucune : le cycle commence plus tard'
                                    : cv.past === 0
                                      ? 'Aucune période passée'
                                      : cv.past + ' période(s) avant la courante'
                                }}
                              </dd>
                            </div>
                          </dl>
                          @if (cv.past > 0) {
                            <p class="bs-note">
                              Les périodes passées se clôturent dans l'ordre, une à une ; aucun
                              rattrapage automatique n'est appliqué.
                            </p>
                          }
                        } @else if (d.anchorDay === '') {
                          <p class="bs-note">
                            Sans jour d'ancrage, le cycle reste « à configurer » et aucune période
                            n'est calculée.
                          </p>
                        }
                        <ul class="bpm-help">
                          <li>
                            Cycles hebdomadaire et annuel : non disponibles (choix métier non
                            validé).
                          </li>
                          <li>
                            Rattrapage automatique des périodes passées : non disponible (choix
                            métier non validé).
                          </li>
                        </ul>
                      }
                    }
                  }

                  <!-- 6. Votre vision -->
                  @case (6) {
                    @if (profile.data(); as p) {
                      <fieldset class="bs-options">
                        <legend>Vision et objectifs</legend>
                        <label class="bs-option" [class.is-selected]="d.visionLater">
                          <input type="checkbox" [(ngModel)]="d.visionLater" />
                          <strong>Compléter plus tard</strong>
                          <span>La vision et les objectifs actuels restent inchangés.</span>
                        </label>
                      </fieldset>
                      @if (!d.visionLater) {
                        @if (d.mode === 'branch') {
                          <p class="bs-note">
                            La vision et les objectifs sont ceux de votre profil financier : ils
                            s'appliquent à l'ensemble, pas seulement à ce projet de la vie.
                          </p>
                        }
                        <div class="bs-vision">
                          <label class="bs-field">
                            <span>Rendement annuel (%, facultatif)</span>
                            <input
                              [(ngModel)]="d.rate"
                              inputmode="decimal"
                              class="num"
                              [attr.aria-invalid]="err('rate') ? 'true' : null"
                            />
                            @if (err('rate')) {
                              <span class="err">{{ err('rate') }}</span>
                            }
                          </label>
                          <label class="bs-field">
                            <span>Inflation annuelle (%)</span>
                            <input
                              [(ngModel)]="d.inflation"
                              inputmode="decimal"
                              class="num"
                              [attr.aria-invalid]="err('inflation') ? 'true' : null"
                            />
                            <small class="bs-field-help"
                              >Source actuelle : {{ p.principal.vision.inflationSource }}</small
                            >
                            @if (err('inflation')) {
                              <span class="err">{{ err('inflation') }}</span>
                            }
                          </label>
                          <label class="bs-field">
                            <span>Épargne visée par période (€, facultative)</span>
                            <input
                              [(ngModel)]="d.savingsTarget"
                              inputmode="decimal"
                              class="num"
                              [attr.aria-invalid]="err('savingsTarget') ? 'true' : null"
                            />
                            @if (err('savingsTarget')) {
                              <span class="err">{{ err('savingsTarget') }}</span>
                            }
                          </label>
                        </div>
                        <details class="bpm-disclosure" open>
                          <summary>Objectifs datés ({{ d.goals.length }})</summary>
                          <bpm-create-details
                            section="goals"
                            [draft]="d"
                            [errorOf]="errFn"
                            [goalTypes]="p.goalTypes"
                            (changed)="touch()"
                          />
                        </details>
                      }
                    }
                  }

                  <!-- 7. Vérifier et confirmer -->
                  @case (7) {
                    @if (profile.data(); as p) {
                      <section class="bs-recap-group" aria-labelledby="recap-project">
                        <header data-ui-pattern="section-heading">
                          <h3 id="recap-project">Projet</h3>
                          <button type="button" class="btn btn-secondary" (click)="go(2)">
                            Modifier
                          </button>
                        </header>
                        <dl class="bs-recap">
                          <div>
                            <dt>Profil financier</dt>
                            <dd>
                              {{ p.user.label }} ({{ p.user.userTypeLabel ?? p.user.userType }})
                            </dd>
                          </div>
                          <div>
                            <dt>Rôle</dt>
                            <dd>
                              {{
                                d.mode === 'principal'
                                  ? 'Budget du projet de vie (principal)'
                                  : 'Projet de la vie (branche)'
                              }}
                            </dd>
                          </div>
                          <div class="bs-recap-wide">
                            <dt>Nom</dt>
                            <dd>{{ d.mode === 'principal' ? d.principalName : d.branchName }}</dd>
                          </div>
                          @if (d.mode === 'branch') {
                            <div class="bs-recap-wide">
                              <dt>Tâches initiales</dt>
                              <dd>{{ taskTitles() }}</dd>
                            </div>
                          }
                        </dl>
                      </section>
                      <section class="bs-recap-group" aria-labelledby="recap-budget">
                        <header data-ui-pattern="section-heading">
                          <h3 id="recap-budget">Budget</h3>
                          <button type="button" class="btn btn-secondary" (click)="go(3)">
                            Modifier
                          </button>
                        </header>
                        <dl class="bs-recap">
                          <div>
                            <dt>Revenus — moyenne mensuelle</dt>
                            <dd class="num">{{ totals().incomeCents | cents }}</dd>
                          </div>
                          <div>
                            <dt>Charges — moyenne mensuelle</dt>
                            <dd class="num">{{ totals().chargeCents | cents }}</dd>
                          </div>
                          <div>
                            <dt>Solde type — moyenne mensuelle</dt>
                            <dd class="num" [attr.data-tone]="tone(totals().netCents)">
                              {{ totals().netCents | signedCents }}
                            </dd>
                          </div>
                          <div>
                            <dt>Lignes</dt>
                            <dd>
                              {{ totals().recurring }} récurrente(s),
                              {{ totals().once }} ponctuelle(s)
                            </dd>
                          </div>
                          @if (d.centers.length) {
                            <div class="bs-recap-wide">
                              <dt>Centres personnels</dt>
                              <dd>{{ centerNames() }}</dd>
                            </div>
                          }
                        </dl>
                      </section>
                      <section class="bs-recap-group" aria-labelledby="recap-wealth">
                        <header data-ui-pattern="section-heading">
                          <h3 id="recap-wealth">Patrimoine et cycle</h3>
                          <button type="button" class="btn btn-secondary" (click)="go(4)">
                            Modifier
                          </button>
                        </header>
                        <dl class="bs-recap">
                          @if (d.mode === 'principal') {
                            <div>
                              <dt>Stock connu</dt>
                              <dd class="num">
                                {{
                                  d.stockKnown
                                    ? (stockCents() | signedCents) +
                                      ' au ' +
                                      (d.stockDate | shortDate)
                                    : 'À renseigner'
                                }}
                              </dd>
                            </div>
                            <div>
                              <dt>Objectif de stock</dt>
                              <dd class="num">
                                {{ d.objective.trim() ? (objectiveCents() | cents) : 'Non défini' }}
                              </dd>
                            </div>
                            <div class="bs-recap-wide">
                              <dt>Cycle</dt>
                              <dd>{{ cycleText() }}</dd>
                            </div>
                          } @else {
                            <div>
                              <dt>Patrimoine</dt>
                              <dd>Patrimoine unique existant, inchangé</dd>
                            </div>
                            <div>
                              <dt>Cycle</dt>
                              <dd>Celui du Budget du projet de vie</dd>
                            </div>
                          }
                        </dl>
                      </section>
                      <section class="bs-recap-group" aria-labelledby="recap-vision">
                        <header data-ui-pattern="section-heading">
                          <h3 id="recap-vision">Vision</h3>
                          <button type="button" class="btn btn-secondary" (click)="go(6)">
                            Modifier
                          </button>
                        </header>
                        @if (d.visionLater) {
                          <p class="bs-note">
                            À compléter plus tard : vision et objectifs inchangés.
                          </p>
                        } @else {
                          <dl class="bs-recap">
                            <div>
                              <dt>Rendement annuel</dt>
                              <dd>{{ d.rate.trim() ? d.rate + ' %' : 'Non renseigné' }}</dd>
                            </div>
                            <div>
                              <dt>Inflation</dt>
                              <dd>{{ d.inflation }} %</dd>
                            </div>
                            <div class="bs-recap-wide">
                              <dt>Épargne visée</dt>
                              <dd class="num">
                                {{
                                  d.savingsTarget.trim() ? (savingsCents() | cents) : 'Non définie'
                                }}
                              </dd>
                            </div>
                            <div class="bs-recap-wide">
                              <dt>Objectifs datés</dt>
                              @if (d.goals.length) {
                                @for (g of d.goals; track g.uid) {
                                  <dd class="bs-recap-item">
                                    <strong>{{ g.label }}</strong> — {{ goalTypeLabel(g.type) }},
                                    {{ goalCents(g.amount) | cents }} (€ d'aujourd'hui) au
                                    {{ g.date | shortDate }}
                                  </dd>
                                }
                              } @else {
                                <dd>Aucun objectif daté.</dd>
                              }
                            </div>
                          </dl>
                        }
                      </section>

                      @if (payloadSummary(); as ps) {
                        <p class="bs-note">
                          À la confirmation :
                          {{
                            d.mode === 'branch'
                              ? 'création du projet de la vie, de son budget et de ' +
                                d.tasks.length +
                                ' tâche(s) ; '
                              : ''
                          }}
                          {{ ps.newEntries }} ligne(s) ajoutée(s), {{ ps.updatedEntries }} ligne(s)
                          existante(s) mise(s) à jour{{
                            ps.other.length ? ', ' + ps.other.join(', ') : ''
                          }}.
                          @if (ps.nothing) {
                            <strong>Aucun changement à enregistrer.</strong>
                          }
                        </p>
                      }
                      <p class="bpm-help">
                        L’enregistrement confirme l’ensemble du récapitulatif. En cas de nouvelle
                        tentative, vos éléments ne seront pas créés en double.
                      </p>
                    }
                  }
                }
              </div>

              @if (steps[d.step - 1].why; as why) {
                <details class="bs-why">
                  <summary>Pourquoi cette étape</summary>
                  <p>{{ why }}</p>
                </details>
              }

              @if (stepErrors().length) {
                <div class="bpm-error" role="alert" id="step-errors" tabindex="-1">
                  <p>
                    <strong>À corriger avant de continuer</strong> (votre saisie est conservée) :
                  </p>
                  <ul>
                    @for (m of stepErrors(); track $index) {
                      <li>{{ m }}</li>
                    }
                  </ul>
                </div>
              }
              @if (serverError(); as se) {
                @if (se.step === d.step) {
                  <div class="bpm-error" role="alert">
                    <p>{{ se.message }}</p>
                    @if (se.field) {
                      <p>Champ concerné : {{ se.field }}</p>
                    }
                    <p>
                      Rien n'a été enregistré ; corrigez puis confirmez à nouveau depuis l'étape 7.
                    </p>
                  </div>
                }
              }

              @if (submitting()) {
                <p class="bpm-help" role="status">
                  Traitement de la confirmation… ne fermez pas la page.
                </p>
              }
              @if (serverError(); as se) {
                @if (se.step === 7 && d.step === 7) {
                  <div [class.bpm-error]="!se.retry" [class.bpm-missing]="se.retry" role="alert">
                    <p>{{ se.message }}</p>
                    @if (se.retry) {
                      <p>
                        Votre saisie est conservée. Une nouvelle confirmation réutilise la même clé
                        de demande : si l'enregistrement avait abouti, il ne sera pas dupliqué.
                      </p>
                    }
                    @if (se.conflict) {
                      <button
                        type="button"
                        class="btn btn-secondary"
                        (click)="leaveAfterConflict()"
                      >
                        Voir le tableau de bord
                      </button>
                    }
                  </div>
                }
              }

              <div class="bs-actions">
                @if (d.step > 1) {
                  <button
                    type="button"
                    class="btn btn-secondary"
                    (click)="prev()"
                    [disabled]="submitting()"
                  >
                    ← Étape précédente
                  </button>
                }
                @if (d.step < 7) {
                  <button type="button" class="btn btn-primary" (click)="next()">
                    Étape suivante →
                  </button>
                } @else {
                  <button
                    type="button"
                    class="btn btn-primary bs-confirm"
                    (click)="confirm()"
                    [disabled]="submitting()"
                    [attr.aria-busy]="submitting()"
                  >
                    {{
                      submitting()
                        ? 'Enregistrement en cours…'
                        : d.mode === 'branch'
                          ? 'Créer et ouvrir ce projet'
                          : 'Enregistrer et piloter mon projet de vie'
                    }}
                  </button>
                }
                <button
                  type="button"
                  class="btn btn-secondary bs-cancel"
                  (click)="askCancel()"
                  [disabled]="submitting()"
                >
                  Annuler
                </button>
              </div>
            </section>

            <aside class="bs-rail" aria-label="Votre avancement">
              <!-- Grand parcours de la référence (rjs-milestone-journey, présentation « rail ») : jalons puis pas à pas. -->
              <section class="journey" data-layout="rail" [attr.aria-label]="journey.title">
                <header class="journey-heading">
                  <span class="journey-emblem" aria-hidden="true">{{ journey.number }}</span>
                  <div>
                    <p class="journey-kicker">Grand parcours</p>
                    <h2>{{ journey.title }}</h2>
                    <p class="journey-lead">{{ journey.lead }}</p>
                  </div>
                </header>
                <ol class="journey-milestones">
                  @for (m of journey.milestones; track m.id; let i = $index) {
                    <li>
                      <button
                        type="button"
                        [class.is-selected]="selectedMilestone().id === m.id"
                        [class.is-active]="currentMilestoneIndex() === i"
                        [attr.aria-current]="currentMilestoneIndex() === i ? 'step' : null"
                        [attr.aria-pressed]="selectedMilestone().id === m.id"
                        (click)="chooseMilestone(m.id)"
                      >
                        <span class="journey-mark">Jalon {{ i + 1 }}</span>
                        <strong>{{ m.title }}</strong>
                        @if (currentMilestoneIndex() === i) {
                          <span class="journey-current">Jalon en cours</span>
                        }
                        <small
                          >{{ m.steps.length }} {{ m.steps.length > 1 ? 'étapes' : 'étape' }}</small
                        >
                      </button>
                    </li>
                  }
                </ol>
                @if (selectedMilestone(); as m) {
                  <details
                    class="journey-detail"
                    [open]="railExpanded()"
                    (toggle)="railToggled($event)"
                  >
                    <summary>
                      <span
                        ><strong>{{ m.title }}</strong> <small>{{ m.goal }}</small></span
                      >
                      <span class="journey-disclosure"
                        >{{ railExpanded() ? 'Replier le pas à pas' : 'Voir le pas à pas' }}
                        <span aria-hidden="true">{{ railExpanded() ? '−' : '+' }}</span></span
                      >
                    </summary>
                    <ol class="journey-steps">
                      @for (n of m.steps; track n; let i = $index) {
                        <li
                          [class.is-current]="n === d.step"
                          [attr.aria-current]="n === d.step ? 'step' : null"
                        >
                          <span class="journey-step-index" aria-hidden="true">{{ n }}</span>
                          <div>
                            <strong>{{ steps[n - 1].label }}</strong>
                            <p>{{ steps[n - 1].help }}</p>
                            @if (n === d.step) {
                              <span class="journey-current">Étape en cours</span>
                            } @else {
                              <button
                                class="journey-action"
                                type="button"
                                [disabled]="n > d.maxReached || submitting()"
                                (click)="go(n)"
                                [attr.aria-label]="
                                  'Reprendre l\\'étape ' + n + ' : ' + steps[n - 1].label
                                "
                              >
                                Reprendre cette étape <span aria-hidden="true">→</span>
                              </button>
                            }
                          </div>
                        </li>
                      }
                    </ol>
                    <p class="journey-result">
                      <span aria-hidden="true">◎</span
                      ><span><strong>À l’issue de ce jalon</strong>{{ m.result }}</span>
                    </p>
                  </details>
                }
              </section>
              <p class="bs-rail-left" aria-live="polite">
                @if (7 - d.step > 0) {
                  Il reste <strong>{{ 7 - d.step }}</strong> étape(s)
                } @else {
                  Tout est prêt : vérifiez puis confirmez.
                }
              </p>
              <span class="bs-rail-bar" aria-hidden="true"
                ><span [style.width.%]="(d.step / 7) * 100"></span
              ></span>
            </aside>
          </div>
        }
      </div>
    </bpm-page>
  `,
  styles: `
    /* Compléments absents des feuilles source (jetons source uniquement). */
    :host {
      display: block;
    }
    .bs-body {
      display: grid;
      gap: var(--ecart-20);
      min-width: 0;
    }
    .bs-body h3 {
      margin: 0;
      color: var(--ink);
    }
    .bs-stage-head h2:focus {
      outline: none;
    }
    .bs-stage-head h2:focus-visible {
      outline: 2px solid var(--app-accent);
      outline-offset: 2px;
    }
    .bs-stage-head > p:last-child {
      margin: 0;
    }
    .bs-paths[aria-invalid='true'] .bs-path {
      border-color: var(--status-danger);
    }
    .err {
      color: var(--status-danger);
      font-weight: 400;
      margin: 0;
    }
    .bpm-error p,
    .bpm-missing p {
      margin: 0 0 var(--ecart-4);
    }
    .bpm-error ul {
      margin: var(--ecart-4) 0 0;
    }
    .bs-inline-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ecart-8);
    }
    .bs-field-help {
      color: var(--muted);
      font-weight: 400;
    }
    .bs-recap dd[data-tone='pos'] {
      color: var(--status-success);
    }
    .bs-recap dd[data-tone='neg'] {
      color: var(--status-danger);
    }
    .bs-recap dd.bs-recap-note {
      color: var(--muted);
      font-size: var(--fs-sm);
      font-weight: 400;
    }
    .bs-recap dd.bs-recap-item {
      font-size: var(--fs-md);
      font-weight: 400;
    }
    .bs-recap dd {
      word-break: break-word;
    }
    .bs-recap-group {
      display: grid;
      gap: var(--ecart-10);
    }
    .bs-recap-group > header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--ecart-8);
    }
    .bs-cadence input:disabled {
      cursor: default;
    }
    ul.bpm-help {
      padding-inline-start: 1.1rem;
    }
    .bs-actions .bs-cancel {
      margin-inline-start: auto;
    }
    /* Le rail porte le grand parcours : même allègement que la référence (.bs-rail:has(rjs-bpm-journey-guide)). */
    .bs-rail:has(.journey) {
      padding: 0;
      border: 0;
      background: transparent;
      box-shadow: none;
    }
    .bs-rail:has(.journey) .bs-rail-left {
      padding-inline: var(--ecart-16);
    }
    .journey-action:disabled {
      cursor: not-allowed;
      opacity: 0.55;
      text-decoration: none;
    }
    .bs-stage > .bpm-error ul {
      padding-inline-start: 1.1rem;
    }
  `,
})
export class BpmCreatePage {
  private api = inject(BpmApi);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private navigation = inject(BpmNavigation);
  private refresh = inject(BpmRefresh);
  protected ctx = inject(BpmPageContext);
  private workspace = injectPageWorkspace();
  protected specializedMode = computed<Mode | null>(() => {
    const key = this.workspace()?.key;
    return key === 'start-life' ? 'principal' : key === 'start-project' ? 'branch' : null;
  });

  protected readonly steps = STEPS;
  protected readonly journey = JOURNEY;
  protected readonly days = Array.from({ length: 28 }, (_, i) => i + 1);
  protected readonly tone = tone;

  /** Profil de départ (lecture seule) ; `cycleState.frozen` : des clôtures figent le cycle. */
  protected profile = bpmLoader(
    () => 0,
    () => this.api.setupProfile(),
  );

  protected draft = signal<Draft | null>(null);
  protected restored = signal(false);
  protected confirmCancel = signal(false);
  protected submitting = signal(false);
  /** Étapes dont les erreurs de saisie sont affichées (après une tentative de passage). */
  private shown = signal<number[]>([]);
  protected serverError = signal<{
    message: string;
    step: number;
    key: string | null;
    field: string | null;
    retry: boolean;
    conflict: boolean;
  } | null>(null);

  protected ready = computed(() => {
    const d = this.draft();
    const p = this.profile.data();
    return !!d && !!p && d.userId === p.user.id;
  });
  protected draftScope = computed(() => {
    const d = this.draft();
    if (!d) return 'Lecture du profil de départ';
    return `${d.mode === 'branch' ? d.branchName.trim() || 'Nouveau projet de la vie' : d.mode === 'principal' ? 'Budget du projet de vie' : 'Projet à choisir'} · étape ${d.step}/7 · brouillon non confirmé`;
  });
  protected cycleLocked = computed(() => this.profile.data()?.cycleState?.frozen ?? false);

  // ---------- grand parcours (rail) : lecture seule ----------

  /** Jalon de l'étape en cours. */
  protected currentMilestoneIndex = computed(() => {
    const step = this.draft()?.step ?? 1;
    return Math.max(
      0,
      JOURNEY.milestones.findIndex((m) => m.steps.includes(step)),
    );
  });
  /** Jalon consulté dans le rail ; il revient au jalon en cours dès que l'étape change. */
  private railSelection = signal<{ id: string; step: number } | null>(null);
  protected railExpanded = signal(false);
  protected selectedMilestone = computed(() => {
    const sel = this.railSelection();
    const step = this.draft()?.step ?? 1;
    const wanted =
      sel && sel.step === step ? sel.id : JOURNEY.milestones[this.currentMilestoneIndex()].id;
    return JOURNEY.milestones.find((m) => m.id === wanted) ?? JOURNEY.milestones[0];
  });
  protected chooseMilestone(id: string) {
    this.railSelection.set({ id, step: this.draft()?.step ?? 1 });
    this.railExpanded.set(true);
  }
  protected railToggled(event: Event) {
    this.railExpanded.set((event.target as HTMLDetailsElement).open);
  }

  constructor() {
    // Le profil arrive (ou se recharge) : créer, reprendre ou compléter le brouillon sans écraser la saisie.
    effect(() => {
      const p = this.profile.data();
      if (p) untracked(() => this.adopt(p));
    });
    effect(() => {
      const raw = this.ctx.query().get('step');
      const ready = this.ready();
      if (!ready) return;
      untracked(() => {
        const d = this.draft()!;
        const wanted = Number(raw);
        if (!raw || !Number.isInteger(wanted) || wanted < 1 || wanted > Math.min(7, d.maxReached)) {
          void this.ctx.setQuery({ step: d.step }, { replace: true });
        } else if (wanted !== d.step && !this.submitting()) {
          this.draft.set({ ...d, step: wanted });
          this.save(this.draft()!);
          this.focusTitle();
        }
      });
    });
    // Changement de user : le brouillon d'un autre user n'est jamais montré.
    effect(() => {
      const u = this.ctx.userId();
      untracked(() => {
        const d = this.draft();
        if (d && d.userId !== u) {
          this.draft.set(null);
          this.shown.set([]);
          this.serverError.set(null);
          this.restored.set(false);
        }
      });
    });
  }

  // ---------- brouillon ----------

  private adopt(p: SetupProfile) {
    const d = this.draft();
    if (d && d.userId === p.user.id) {
      if (mergeProfile(d, p)) this.touch();
      return;
    }
    const stored = this.load(p.user.id);
    if (stored) {
      mergeProfile(stored, p);
      this.draft.set(stored);
      this.restored.set(true);
    } else {
      this.draft.set(this.newDraft(p));
      this.restored.set(false);
    }
    if (this.specializedMode()) this.save(this.draft()!);
    this.shown.set([]);
    this.serverError.set(null);
  }

  /** Signale une modification du brouillon (saisie ou bouton) et le conserve pour une reprise. */
  protected touch(event?: Event) {
    // NgModel met les radios, cases et sélections à jour sur `change`, après `input`.
    // Garder le même objet jusque-là, sinon le contrôle écrit dans l’ancien brouillon.
    const target = event?.target;
    if (
      event?.type === 'input' &&
      (target instanceof HTMLSelectElement ||
        (target instanceof HTMLInputElement && ['radio', 'checkbox'].includes(target.type)))
    )
      return;
    const d = this.draft();
    if (!d) return;
    const copy = { ...d };
    this.draft.set(copy);
    this.save(copy);
  }

  private load(userId: string): Draft | null {
    try {
      const mode = this.specializedMode();
      const keys = mode
        ? [STORE + userId + ':' + mode, STORE + userId]
        : [STORE + userId, STORE + userId + ':principal', STORE + userId + ':branch'];
      for (const key of keys) {
        const d = this.storedDraft(userId, key);
        if (!d || (mode && d.mode && d.mode !== mode)) continue;
        if (mode) d.mode = mode;
        return d;
      }
      return null;
    } catch {
      return null;
    }
  }
  private save(d: Draft) {
    try {
      const key = STORE + d.userId;
      const previous = this.storedDraft(d.userId, key);
      // Le dernier brouillon reste accessible depuis l’entrée nominale ; l’autre mode garde sa propre reprise.
      if (previous?.v === 1 && previous.userId === d.userId && previous.mode && previous.requestKey !== d.requestKey) {
        sessionStorage.setItem(key + ':' + previous.mode, JSON.stringify(previous));
      }
      const raw = JSON.stringify(d);
      sessionStorage.setItem(key, raw);
      if (d.mode) sessionStorage.setItem(key + ':' + d.mode, raw);
    } catch {
      /* stockage indisponible : le brouillon reste en mémoire */
    }
  }
  private forget(userId: string) {
    try {
      const requestKey = this.draft()?.requestKey;
      for (const suffix of ['', ':principal', ':branch']) {
        const key = STORE + userId + suffix;
        if (this.storedDraft(userId, key)?.requestKey === requestKey) sessionStorage.removeItem(key);
      }
    } catch {
      /* rien à faire */
    }
  }

  private storedDraft(userId: string, key: string): Draft | null {
    try {
      const raw = sessionStorage.getItem(key);
      const draft = raw ? (JSON.parse(raw) as Draft) : null;
      return draft?.v === 1 && draft.userId === userId && typeof draft.requestKey === 'string' ? draft : null;
    } catch {
      return null;
    }
  }

  private newDraft(profile: SetupProfile) {
    const draft = draftFromProfile(profile, newRequestKey('setup'));
    draft.mode = this.specializedMode();
    return draft;
  }

  /** Abandonne le brouillon repris et repart du profil enregistré (nouvelle clé de demande). */
  protected restart() {
    const p = this.profile.data();
    if (!p) return;
    this.forget(p.user.id);
    this.draft.set(this.newDraft(p));
    if (this.specializedMode()) this.save(this.draft()!);
    void this.ctx.setQuery({ step: 1 }, { replace: true });
    this.restored.set(false);
    this.shown.set([]);
    this.serverError.set(null);
  }

  // ---------- lectures dérivées ----------

  private errorsOf = (step: number): Errors => {
    const d = this.draft();
    const p = this.profile.data();
    return d && p ? validate(step, d, p, this.cycleLocked()) : {};
  };

  private clientErrors = computed<Errors>(() => {
    this.draft();
    const out: Errors = {};
    for (const s of this.shown()) Object.assign(out, this.errorsOf(s));
    return out;
  });

  protected stepErrors = computed(() => {
    const d = this.draft();
    return d && this.shown().includes(d.step) ? Object.values(this.errorsOf(d.step)) : [];
  });

  protected focus = computed<BpmPageFocus | null>(() => {
    const d = this.draft();
    if (!d || !this.ready()) return null;
    const error = this.serverError();
    const count = this.stepErrors().length;
    return {
      title: `Étape ${d.step} sur 7 · ${STEPS[d.step - 1].label}`,
      detail: this.submitting()
        ? 'Votre confirmation est en cours d’enregistrement.'
        : error
          ? error.message
          : count
            ? `${count} point(s) à corriger avant de poursuivre. Votre saisie est conservée.`
            : this.restored()
              ? 'Brouillon repris. Vérifiez vos choix puis poursuivez ; rien n’est encore confirmé.'
              : 'Brouillon non confirmé. Vous pouvez revenir aux étapes déjà parcourues.',
      tone: error || count ? 'warning' : 'info',
    };
  });

  protected showCurrentErrors() {
    document.getElementById(this.stepErrors().length ? 'step-errors' : 'step-title')?.focus();
  }

  protected err(key: string): string | null {
    const se = this.serverError();
    return this.clientErrors()[key] ?? (se?.key === key ? se.message : null);
  }
  /** Même lecture, transmise au détail repliable (référence stable). */
  protected readonly errFn = (key: string) => this.err(key);

  protected totals = computed(() => {
    const d = this.draft();
    return d ? totalsOf(d) : totalsOf({ lines: [], mode: null } as unknown as Draft);
  });

  protected existingCount = computed(() => this.profile.data()?.budgetType.lines.length ?? 0);
  protected activeGoalCount = computed(
    () => this.profile.data()?.goals.filter((g) => !g.removed).length ?? 0,
  );
  protected cycleView = computed(() => {
    const d = this.draft();
    if (!d) return null;
    return this.cycleLocked()
      ? cyclePreview(d.cycleOrig.anchorDay, d.cycleOrig.start)
      : cyclePreview(d.anchorDay, d.cycleStart);
  });

  /** Centres proposés aux lignes et plafonds : standards du profil puis centres personnels du brouillon. */
  protected options = computed<CenterOption[]>(() => {
    const d = this.draft();
    const p = this.profile.data();
    return d && p ? centerOptions(p, d) : [];
  });

  protected stockCents = computed(() => toCents(this.draft()?.stock ?? ''));
  protected objectiveCents = computed(() => toCents(this.draft()?.objective ?? ''));
  protected savingsCents = computed(() => toCents(this.draft()?.savingsTarget ?? ''));
  protected goalCents = (raw: string) => toCents(raw);
  protected goalTypeLabel(type: string) {
    return this.profile.data()?.goalTypes.find((t) => t.key === type)?.label ?? type;
  }
  protected taskTitles = computed(() =>
    (this.draft()?.tasks ?? []).map((t) => t.title.trim() || '(sans titre)').join(' · '),
  );
  protected centerNames = computed(() =>
    (this.draft()?.centers ?? [])
      .map((c) => `${c.label.trim()} (${c.direction === 'income' ? 'revenus' : 'charges'})`)
      .join(', '),
  );
  protected cycleText = computed(() => {
    const d = this.draft();
    if (!d) return '';
    const cv = this.cycleView();
    if (!cv) return 'À configurer';
    const day = this.cycleLocked() ? d.cycleOrig.anchorDay : d.anchorDay;
    return `Mensuel, jour ${day} — période courante : ${cv.current.label}`;
  });

  /** Ce que la confirmation enregistrera (lecture du contenu de la commande, sans l'envoyer). */
  protected payloadSummary = computed(() => {
    const d = this.draft();
    if (!d?.mode) return null;
    const { input } = buildPayload(d, this.cycleLocked());
    const entries = input.entries ?? [];
    const other: string[] = [];
    if (input.customCenters?.length)
      other.push(`${input.customCenters.length} centre(s) personnel(s)`);
    if (input.caps) other.push(`${Object.keys(input.caps).length} plafond(s)`);
    if (input.patrimoine) other.push('Patrimoine mis à jour');
    if (input.cycle) other.push('cycle mis à jour');
    if (input.vision) other.push('vision mise à jour');
    if (input.goals?.length)
      other.push(`${input.goals.length} objectif(s) ajouté(s) ou modifié(s)`);
    if (input.project && d.mode === 'principal') other.push('nom ou description mis à jour');
    const updatedEntries = entries.filter((e) => e.recurrenceId).length;
    const newEntries = entries.length - updatedEntries;
    return {
      newEntries,
      updatedEntries,
      other,
      nothing: d.mode === 'principal' && !entries.length && !other.length,
    };
  });

  // ---------- navigation entre étapes (aucune écriture) ----------

  private navigateStep(step: number) {
    const query = Object.fromEntries(
      this.ctx.query().keys.map((key) => [key, this.ctx.query().get(key)]),
    );
    const url = this.router.serializeUrl(
      this.router.createUrlTree([], { relativeTo: this.route, queryParams: { ...query, step } }),
    );
    if (this.navigation.next()?.url === url) this.navigation.forward();
    else if (this.navigation.previous()?.url === url) this.navigation.back();
    else void this.ctx.setQuery({ step });
  }

  protected go(step: number) {
    const d = this.draft();
    if (!d || step > d.maxReached || this.submitting()) return;
    this.navigateStep(step);
  }

  protected next() {
    const d = this.draft();
    if (!d) return;
    const errors = this.errorsOf(d.step);
    if (Object.keys(errors).length) {
      this.shown.update((s) => (s.includes(d.step) ? s : [...s, d.step]));
      setTimeout(() => document.getElementById('step-errors')?.focus());
      return;
    }
    const step = Math.min(7, d.step + 1);
    d.maxReached = Math.max(d.maxReached, step);
    this.touch();
    this.navigateStep(step);
  }

  protected prev() {
    const d = this.draft();
    if (!d || d.step <= 1) return;
    this.navigateStep(d.step - 1);
  }

  private focusTitle() {
    setTimeout(() => document.getElementById('step-title')?.focus());
  }

  // ---------- annulation (aucune écriture) ----------

  protected askCancel() {
    this.confirmCancel.set(true);
  }
  /** Un brouillon confirmé ou abandonné n'a plus d'étapes où revenir : elles quittent le parcours. */
  private closeWizard() {
    this.navigation.completeFlow((url) => /^\/creer(?:[/?#]|$)/.test(url));
  }

  protected cancel() {
    const d = this.draft();
    if (d) this.forget(d.userId);
    this.draft.set(null);
    this.closeWizard();
    this.router.navigate(['/tableau-de-bord'], {
      state: { bpmNotice: 'Brouillon abandonné : rien n’a été enregistré.' },
    });
  }
  protected leaveAfterConflict() {
    const d = this.draft();
    if (d) this.forget(d.userId);
    this.refresh.bump();
    this.closeWizard();
    this.router.navigate(['/tableau-de-bord']);
  }

  // ---------- confirmation unique ----------

  protected async confirm() {
    const d = this.draft();
    if (!d || !d.mode || this.submitting()) return;
    for (const s of [2, 3, 4, 5, 6]) {
      if (Object.keys(this.errorsOf(s)).length) {
        this.shown.update((x) => (x.includes(s) ? x : [...x, s]));
        this.go(s);
        return;
      }
    }
    const { input, maps } = buildPayload(d, this.cycleLocked());
    this.submitting.set(true);
    this.serverError.set(null);
    try {
      const r = await this.api.setup(input);
      this.forget(d.userId);
      this.refresh.bump();
      const created = r.created.length + (r.taskIds?.length ?? 0) + (r.budgetId ? 1 : 0);
      const notice = r.replayed
        ? 'Cette confirmation était déjà enregistrée : rien n’a été dupliqué.'
        : r.mode === 'branch'
          ? `Projet de la vie « ${d.branchName.trim()} » créé avec ${r.taskIds?.length ?? 0} tâche(s).`
          : `Budget du projet de vie configuré : ${created} élément(s) créé(s), ${new Set(r.updated).size} mis à jour.`;
      this.closeWizard();
      await this.router.navigate(
        r.mode === 'branch' && r.coreProjectId
          ? ['/app/gestion-projet', r.coreProjectId]
          : ['/projet-de-vie'],
        { state: { bpmNotice: notice } },
      );
    } catch (err) {
      this.submitting.set(false);
      this.reportError(err, maps);
    }
  }

  private reportError(err: unknown, maps: PayloadMaps) {
    const e = toApiError(err);
    const field = e.body.details?.field;
    if (e.body.code === 'IDEMPOTENCY_CONFLICT') {
      this.serverError.set({
        message:
          'Une confirmation précédente de ce brouillon a déjà été enregistrée, avec un contenu différent de la saisie actuelle. Consultez le tableau de bord pour voir ce qui est enregistré ; pour ajouter autre chose, abandonnez ce brouillon et recommencez.',
        step: 7,
        key: null,
        field: null,
        retry: false,
        conflict: true,
      });
      return;
    }
    if (e.isNetwork || e.status >= 500) {
      this.serverError.set({
        message: `${e.message} Le résultat de la confirmation est inconnu.`,
        step: 7,
        key: null,
        field: null,
        retry: true,
        conflict: false,
      });
      return;
    }
    const where = locateField(field, maps);
    this.serverError.set({
      message: e.message,
      step: where.step,
      key: where.key,
      field: field ?? null,
      retry: false,
      conflict: false,
    });
    const d = this.draft();
    if (d && where.step !== d.step) {
      this.navigateStep(where.step);
    }
  }
}
