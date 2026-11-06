import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Api, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { Cadence, LifeGoal, Vision } from '../../core/bpm-models';
import { cents, CentsPipe, parseAmount, ShortDatePipe, SignedCentsPipe } from '../../core/format';
import { ModalComponent } from '../../shared/modal.component';
import { BpmGoalEditor } from '../pages/vision-goal-editor';
import { BpmVisionObjectives, euroText, num } from '../pages/vision-objectives';
import { BpmRefresh, BpmSeriesChart, BpmState, ChartSeries, bpmLoader } from '../ui';

const CADENCES = { weekly: 'semaine', monthly: 'mois', yearly: 'an' };

/** Objectifs du projet de vie : réglages existants réunis, sans créer de flux financier. */
@Component({
  selector: 'bpm-life-objectives',
  imports: [
    FormsModule,
    CentsPipe,
    SignedCentsPipe,
    ShortDatePipe,
    BpmVisionObjectives,
    BpmGoalEditor,
    BpmSeriesChart,
    BpmState,
    ModalComponent,
  ],
  styleUrl: './life-objectives.scss',
  template: `
    <section class="life-objectives" aria-labelledby="life-objectives-title" id="life-objectives">
      <header class="life-objectives-heading">
        <div>
          <p class="eyebrow">Préparer l’avenir</p>
          <h2 id="life-objectives-title">Objectifs du projet de vie</h2>
          <p>
            Un objectif d’excédent pour vos budgets, un cap pour votre patrimoine et des objectifs
            datés pour vos envies.
          </p>
        </div>
        <button
          type="button"
          class="btn btn-primary"
          [disabled]="!profile.data()"
          (click)="editing.set({ goal: null })"
        >
          + Ajouter un objectif daté
        </button>
      </header>
      <bpm-state
        [loading]="profile.loading() && !profile.data()"
        [error]="profile.error()"
        (retry)="profile.reload()"
      />
      @if (message()) {
        <p class="bpm-feedback" role="status">{{ message() }}</p>
      }
      @if (profile.data(); as p) {
        <dl class="life-objective-summary">
          <div>
            <dt>Épargne visée par période</dt>
            <dd>
              {{
                p.principal.vision.savingsTargetCents === null
                  ? 'À définir'
                  : (p.principal.vision.savingsTargetCents | cents)
              }}
            </dd>
            <small>Objectif du budget</small>
          </div>
          <div>
            <dt>Cap patrimonial</dt>
            <dd>
              {{
                p.principal.patrimoine.objectiveCents === null
                  ? 'À définir'
                  : (p.principal.patrimoine.objectiveCents | cents)
              }}
            </dd>
            <small>Montant à constituer</small>
          </div>
          <div>
            <dt>Objectifs datés</dt>
            <dd>{{ goals.data()?.length ?? '—' }}</dd>
            <small>Préparer sans engager de dépense</small>
          </div>
        </dl>
        <details
          class="life-objective-disclosure"
          [open]="budgetOpen()"
          (toggle)="budgetOpen.set($any($event.target).open)"
        >
          <summary>
            <strong>Épargne, excédent et cap patrimonial</strong
            ><span>Suivre la progression et modifier les montants</span>
          </summary>
          <div class="life-objective-body">
            <bpm-vision-objectives
              [profile]="profile"
              [directives]="directives"
              [summary]="summary"
              [contribution]="contributionLabel()"
              [inlineWealthEditor]="true"
              (saved)="message.set($event)"
            >
              <form wealthEditor class="life-objective-form" (ngSubmit)="saveWealth()" novalidate>
                <label
                  >Cap patrimonial (€)<input
                    name="wealthTarget"
                    inputmode="decimal"
                    [(ngModel)]="wealthTarget"
                    (ngModelChange)="wealthDirty.set(true)"
                    placeholder="Sans objectif"
                /></label>
                <p class="bpm-help">
                  Un champ vide retire l’objectif. Le montant du patrimoine reste inchangé.
                </p>
                @if (wealthError()) {
                  <p class="bpm-error" role="alert">
                    {{ wealthError() }} Votre saisie est conservée.
                  </p>
                }
                <div class="bpm-actions">
                  <button
                    type="submit"
                    class="btn btn-primary"
                    [disabled]="wealthBusy() || !wealthDirty()"
                  >
                    Enregistrer le cap patrimonial</button
                  ><button
                    type="button"
                    class="btn btn-secondary"
                    [disabled]="wealthBusy()"
                    (click)="resetWealth()"
                  >
                    Annuler les modifications
                  </button>
                </div>
              </form>
            </bpm-vision-objectives>
            <form class="life-objective-form" (ngSubmit)="saveSavings()" novalidate>
              <label
                >Épargne visée par période (€)<input
                  name="savingsTarget"
                  inputmode="decimal"
                  [(ngModel)]="savingsTarget"
                  (ngModelChange)="savingsDirty.set(true)"
                  placeholder="Sans objectif"
              /></label>
              <p class="bpm-help">
                Un repère pour le solde de chaque période, sans transfert automatique d’argent.
              </p>
              @if (savingsError()) {
                <p class="bpm-error" role="alert">
                  {{ savingsError() }} Votre saisie est conservée.
                </p>
              }
              <div class="bpm-actions">
                <button
                  type="submit"
                  class="btn btn-primary"
                  [disabled]="savingsBusy() || !savingsDirty()"
                >
                  Enregistrer l’épargne visée</button
                ><button
                  type="button"
                  class="btn btn-secondary"
                  [disabled]="savingsBusy()"
                  (click)="resetSavings()"
                >
                  Annuler les modifications
                </button>
              </div>
            </form>
          </div>
        </details>

        <section
          class="life-dated-goals"
          id="life-dated-goals"
          aria-labelledby="life-dated-goals-title"
        >
          <h3 id="life-dated-goals-title">Vos objectifs datés</h3>
          <bpm-state
            [loading]="goals.loading() && !goals.data()"
            [error]="goals.error()"
            (retry)="goals.reload()"
          />
          <ul class="life-goal-list">
            @for (g of goalRows(); track g.goal.id) {
              <li>
                <div class="life-goal-name">
                  <strong>{{ g.goal.label }}</strong
                  ><span
                    >{{ g.goal.typeLabel ?? g.goal.type }} · {{ g.goal.date | shortDate }}</span
                  >
                </div>
                <div class="life-goal-amount">
                  <strong>{{ g.goal.targetTodayCents | cents }}</strong
                  ><span>en euros d’aujourd’hui</span>
                </div>
                <span class="life-goal-status" [attr.data-status]="g.status">{{
                  g.statusLabel
                }}</span>
                <div class="bpm-actions">
                  <button
                    type="button"
                    class="btn btn-secondary"
                    (click)="editing.set({ goal: g.goal })"
                    [attr.aria-label]="'Modifier l’objectif ' + g.goal.label"
                  >
                    Modifier</button
                  ><button
                    type="button"
                    class="btn btn-secondary"
                    (click)="confirmGoal.set(g.goal)"
                    [attr.aria-label]="'Retirer l’objectif ' + g.goal.label"
                  >
                    Retirer
                  </button>
                </div>
              </li>
            } @empty {
              @if (goals.data()) {
                <li class="life-goal-empty">
                  Aucun objectif daté. Ajoutez par exemple un achat, des études ou une réserve de
                  sécurité.
                </li>
              }
            }
          </ul>
          <p class="bpm-help">
            Ces objectifs alimentent la projection. Ils ne créent ni projet de la vie, ni tâche, ni
            paiement.
          </p>
        </section>

        <details
          class="life-objective-disclosure"
          id="life-projection"
          [open]="projectionOpen()"
          (toggle)="projectionOpen.set($any($event.target).open)"
        >
          <summary>
            <strong>Projection du patrimoine</strong
            ><span>Scénario sur {{ p.principal.vision.horizonYears }} ans et hypothèses</span>
          </summary>
          <div class="life-objective-body">
            <bpm-state
              [loading]="projection.loading() && !projection.data()"
              [error]="projection.error()"
              (retry)="projection.reload()"
            />
            @if (projection.data(); as pr) {
              @if (pr.status === 'estimate') {
                <dl class="life-objective-summary">
                  <div>
                    <dt>Patrimoine estimé en {{ pr.rows.at(-1)?.year }}</dt>
                    <dd>{{ pr.rows.at(-1)?.nominalCents | signedCents }}</dd>
                    <small>En valeur nominale</small>
                  </div>
                  <div>
                    <dt>En euros d’aujourd’hui</dt>
                    <dd>{{ pr.rows.at(-1)?.realCents | signedCents }}</dd>
                    <small>Après prise en compte de l’inflation</small>
                  </div>
                </dl>
                <bpm-series-chart
                  title="Projection du patrimoine"
                  categoryLabel="Année"
                  [categories]="projectionYears()"
                  [series]="projectionSeries()"
                  [formats]="['lines']"
                  initialFormat="lines"
                  [height]="220"
                />
              } @else {
                <p class="bpm-help" role="status">
                  Projection non calculable :
                  {{
                    pr.status === 'unknown'
                      ? 'renseignez le patrimoine initial dans Cycle et réglages.'
                      : 'renseignez l’hypothèse de rendement ci-dessous.'
                  }}
                </p>
              }
            }
            <details
              class="life-hypotheses"
              [open]="hypOpen()"
              (toggle)="hypOpen.set($any($event.target).open)"
            >
              <summary>Modifier les hypothèses de projection</summary>
              <form
                class="life-objective-form"
                (ngSubmit)="saveHypotheses()"
                (input)="hypDirty.set(true)"
                (change)="hypDirty.set(true)"
                novalidate
              >
                <div class="life-objective-fields">
                  <label
                    >Horizon (années)<input
                      name="horizon"
                      inputmode="numeric"
                      [(ngModel)]="horizon"
                  /></label>
                  <label
                    >Rendement annuel (%)<input
                      name="rate"
                      inputmode="decimal"
                      [(ngModel)]="rate"
                      placeholder="À renseigner"
                  /></label>
                  <label
                    >Inflation annuelle (%)<input
                      name="inflation"
                      inputmode="decimal"
                      [(ngModel)]="inflation"
                  /></label>
                  <label
                    >Source de l’inflation<input
                      name="inflationSource"
                      [(ngModel)]="inflationSource"
                      maxlength="200"
                  /></label>
                  <label
                    >Apport régulier (€)<input
                      name="contribution"
                      inputmode="decimal"
                      [(ngModel)]="contribution"
                      placeholder="Moyenne du budget type"
                  /></label>
                  <label
                    >Rythme de l’apport<select name="cadence" [(ngModel)]="cadence">
                      <option value="weekly">Par semaine</option>
                      <option value="monthly">Par mois</option>
                      <option value="yearly">Par an</option>
                    </select></label
                  >
                </div>
                <p class="bpm-help">
                  Rendement vide : projection indisponible. Apport vide : moyenne du budget type. Ce
                  scénario ne réalise aucun paiement.
                </p>
                @if (hypError()) {
                  <p class="bpm-error" role="alert">{{ hypError() }} Votre saisie est conservée.</p>
                }
                <div class="bpm-actions">
                  <button
                    type="submit"
                    class="btn btn-primary"
                    [disabled]="hypBusy() || !hypDirty()"
                  >
                    Enregistrer les hypothèses</button
                  ><button
                    type="button"
                    class="btn btn-secondary"
                    [disabled]="hypBusy()"
                    (click)="resetHypotheses()"
                  >
                    Annuler les modifications
                  </button>
                </div>
              </form>
            </details>
          </div>
        </details>
      }
      @if (editing(); as ed) {
        <bpm-goal-editor
          [goal]="ed.goal"
          [types]="profile.data()?.goalTypes ?? []"
          (closed)="editing.set(null)"
          (saved)="goalSaved($event)"
        />
      }
      <rjs-modal
        [open]="!!confirmGoal()"
        [headed]="true"
        title="Retirer cet objectif ?"
        [busy]="removing()"
        (closed)="confirmGoal.set(null)"
      >
        <p>
          « {{ confirmGoal()?.label }} » sera retiré des projections et conservé dans l’historique.
          Aucun paiement n’est modifié.
        </p>
        @if (removeError()) {
          <p class="bpm-error" role="alert">{{ removeError() }}</p>
        }
        <div class="bpm-actions">
          <button
            type="button"
            class="btn btn-secondary"
            [disabled]="removing()"
            (click)="confirmGoal.set(null)"
          >
            Annuler</button
          ><button
            type="button"
            class="btn btn-primary"
            [disabled]="removing()"
            (click)="removeGoal()"
          >
            Retirer l’objectif
          </button>
        </div>
      </rjs-modal>
    </section>
  `,
})
export class BpmLifeObjectives {
  private bpm = inject(BpmApi);
  private api = inject(Api);
  private refresh = inject(BpmRefresh);
  private route = inject(ActivatedRoute);
  private fragment = toSignal(this.route.fragment, { initialValue: this.route.snapshot.fragment });
  protected profile = bpmLoader(
    () => 0,
    () => this.bpm.setupProfile(),
  );
  protected summary = bpmLoader(
    () => 0,
    () => this.bpm.summary(),
  );
  protected directives = bpmLoader(
    () => 0,
    () => this.bpm.directives(),
  );
  protected goals = bpmLoader(
    () => 0,
    () => this.bpm.goals(),
  );
  protected projection = bpmLoader(
    () => 0,
    () => this.bpm.projection(),
  );
  protected budgetOpen = signal(false);
  protected projectionOpen = signal(false);
  protected message = signal('');
  protected editing = signal<{ goal: LifeGoal | null } | null>(null);
  protected confirmGoal = signal<LifeGoal | null>(null);
  protected removing = signal(false);
  protected removeError = signal('');
  protected wealthTarget = signal('');
  protected wealthDirty = signal(false);
  protected wealthBusy = signal(false);
  protected wealthError = signal('');
  protected savingsTarget = signal('');
  protected savingsDirty = signal(false);
  protected savingsBusy = signal(false);
  protected savingsError = signal('');
  protected hypOpen = signal(false);
  protected hypDirty = signal(false);
  protected hypBusy = signal(false);
  protected hypError = signal('');
  protected horizon = signal('');
  protected rate = signal('');
  protected inflation = signal('');
  protected inflationSource = signal('');
  protected contribution = signal('');
  protected cadence = signal<Exclude<Cadence, 'once'>>('monthly');
  protected contributionLabel = computed(() => {
    const v = this.profile.data()?.principal.vision;
    return !v || v.contributionCents === null
      ? 'Moyenne du budget type'
      : `${cents(v.contributionCents)} / ${CADENCES[v.contributionCadence]}`;
  });
  protected goalRows = computed(() => {
    const coverage = new Map((this.projection.data()?.goals ?? []).map((g) => [g.goalId, g]));
    const labels = {
      funded: 'Couvert',
      partial: 'Partiellement couvert',
      unfunded: 'À financer',
      outOfHorizon: 'Hors horizon',
      unknown: 'À calculer',
    };
    return (this.goals.data() ?? []).map((goal) => {
      const status = coverage.get(goal.id)?.status ?? 'unknown';
      return { goal, status, statusLabel: labels[status] };
    });
  });
  protected projectionYears = computed(() =>
    (this.projection.data()?.rows ?? []).map((r) => String(r.year)),
  );
  protected projectionSeries = computed<ChartSeries[]>(() => [
    {
      key: 'nominal',
      label: 'Valeur nominale',
      color: 'var(--s-nominal)',
      kind: 'line',
      values: (this.projection.data()?.rows ?? []).map((r) => r.nominalCents),
    },
    {
      key: 'real',
      label: 'Euros d’aujourd’hui',
      color: 'var(--s-real)',
      kind: 'line',
      dashed: true,
      values: (this.projection.data()?.rows ?? []).map((r) => r.realCents),
    },
  ]);
  constructor() {
    effect(() => {
      const p = this.profile.data();
      if (!p) return;
      untracked(() => {
        if (!this.wealthDirty()) this.resetWealth();
        if (!this.savingsDirty()) this.resetSavings();
        if (!this.hypDirty()) this.fillHypotheses(p.principal.vision);
      });
    });
    effect(() => {
      const f = this.fragment();
      if (f === 'objectifs-budgetaires' || f === 'cap-patrimonial') this.budgetOpen.set(true);
      if (f === 'life-projection' || f === 'hypotheses') this.projectionOpen.set(true);
      if (f === 'hypotheses') this.hypOpen.set(true);
    });
  }
  protected resetWealth() {
    this.wealthTarget.set(
      euroText(this.profile.data()?.principal.patrimoine.objectiveCents ?? null),
    );
    this.wealthDirty.set(false);
    this.wealthError.set('');
  }
  protected resetSavings() {
    this.savingsTarget.set(
      euroText(this.profile.data()?.principal.vision.savingsTargetCents ?? null),
    );
    this.savingsDirty.set(false);
    this.savingsError.set('');
  }
  protected async saveWealth() {
    const p = this.profile.data();
    if (!p || this.wealthBusy()) return;
    const objective = parseAmount(this.wealthTarget());
    if (objective === 'invalid' || (objective !== null && objective < 0))
      return this.wealthError.set('Saisissez un montant positif ou laissez vide.');
    this.wealthBusy.set(true);
    this.wealthError.set('');
    try {
      await this.api.updateBpmPatrimoine({
        expectedRevision: p.principal.patrimoine.revision,
        objective,
      });
      this.wealthDirty.set(false);
      this.message.set('Cap patrimonial enregistré.');
      this.refresh.bump();
    } catch (e) {
      this.wealthError.set(toApiError(e).message);
    } finally {
      this.wealthBusy.set(false);
    }
  }
  protected async saveSavings() {
    const p = this.profile.data();
    if (!p || this.savingsBusy()) return;
    const savingsTarget = parseAmount(this.savingsTarget());
    if (savingsTarget === 'invalid' || (savingsTarget !== null && savingsTarget < 0))
      return this.savingsError.set('Saisissez un montant positif ou laissez vide.');
    this.savingsBusy.set(true);
    this.savingsError.set('');
    try {
      await this.bpm.updateVision({ expectedRevision: p.principal.revision, savingsTarget });
      this.savingsDirty.set(false);
      this.message.set('Épargne visée enregistrée.');
      this.refresh.bump();
    } catch (e) {
      this.savingsError.set(toApiError(e).message);
    } finally {
      this.savingsBusy.set(false);
    }
  }
  protected goalSaved(text: string) {
    this.editing.set(null);
    this.message.set(text);
  }
  protected async removeGoal() {
    const g = this.confirmGoal();
    if (!g || this.removing()) return;
    this.removing.set(true);
    this.removeError.set('');
    try {
      await this.bpm.removeGoal(g.id, g.revision);
      this.confirmGoal.set(null);
      this.message.set(`Objectif « ${g.label} » retiré.`);
      this.refresh.bump();
    } catch (e) {
      this.removeError.set(toApiError(e).message);
    } finally {
      this.removing.set(false);
    }
  }
  private fillHypotheses(v: Vision) {
    this.horizon.set(String(v.horizonYears));
    this.rate.set(v.annualReturnPct === null ? '' : String(v.annualReturnPct));
    this.inflation.set(String(v.inflationPct));
    this.inflationSource.set(v.inflationSource);
    this.contribution.set(euroText(v.contributionCents));
    this.cadence.set(v.contributionCadence);
  }
  protected resetHypotheses() {
    const p = this.profile.data();
    if (p) this.fillHypotheses(p.principal.vision);
    this.hypDirty.set(false);
    this.hypError.set('');
  }
  protected async saveHypotheses() {
    const p = this.profile.data();
    if (!p || this.hypBusy()) return;
    const horizonYears = num(this.horizon());
    const annualReturnPct = num(this.rate());
    const inflationPct = num(this.inflation());
    const contribution = parseAmount(this.contribution());
    if (
      horizonYears === null ||
      !Number.isInteger(horizonYears) ||
      horizonYears < 1 ||
      horizonYears > 80
    )
      return this.hypError.set('Choisissez un horizon de 1 à 80 années entières.');
    if (
      annualReturnPct !== null &&
      (!Number.isFinite(annualReturnPct) || annualReturnPct < -50 || annualReturnPct > 50)
    )
      return this.hypError.set('Le rendement doit être compris entre −50 % et 50 %.');
    if (
      inflationPct === null ||
      !Number.isFinite(inflationPct) ||
      inflationPct < -20 ||
      inflationPct > 50
    )
      return this.hypError.set('L’inflation doit être comprise entre −20 % et 50 %.');
    if (contribution === 'invalid')
      return this.hypError.set('Saisissez un apport en euros ou laissez vide.');
    this.hypBusy.set(true);
    this.hypError.set('');
    try {
      await this.bpm.updateVision({
        expectedRevision: p.principal.revision,
        horizonYears,
        annualReturnPct,
        inflationPct,
        inflationSource: this.inflationSource().trim(),
        contribution,
        contributionCadence: this.cadence(),
      });
      this.hypDirty.set(false);
      this.hypOpen.set(false);
      this.message.set('Hypothèses enregistrées. La projection est recalculée.');
      this.refresh.bump();
    } catch (e) {
      this.hypError.set(toApiError(e).message);
    } finally {
      this.hypBusy.set(false);
    }
  }
}
