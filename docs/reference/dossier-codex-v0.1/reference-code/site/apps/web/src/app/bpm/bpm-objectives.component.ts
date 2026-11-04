import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { formatMoney, parseAmount } from '../shared/amount';
import { registerPageTexts, pageText } from '../shared/page-text';
import { RangeFieldComponent } from '../shared/range-field.component';
import { ModalComponent } from '../shared/modal.component';
import { BpmProject, PatrimoineLifecycle } from './bpm.model';
import { BpmStore } from './bpm.store';
import { budgetSurplusProgress } from './bpm-vision.model';
const P = 'content.pages.bpm.bpm-objectives.component.';
export const BPM_OBJECTIVES_TEXTS: Record<string, string> = {
  budgetTitle: 'Objectif budgétaire',
  budgetEyebrow: 'À chaque période',
  wealthEyebrow: 'Sur toute votre vie',
  goalPeriods: 'périodes',
  targetProgress: 'de l’objectif atteint',
  budgetSettings: 'Ajuster l’objectif budgétaire',
  wealthSettings: 'Ajuster l’objectif de patrimoine',
  minimumSaved: 'Minimum par période',
  noMinimum: 'À définir',
  cumulativeSaved: 'Objectif cumulé',
  reachedBudget: 'Objectif cumulé atteint.',
  wealthGap: 'Reste à atteindre',
  budgetHelp: 'Fixez le montant à garder à chaque clôture, puis un total à atteindre si besoin.',
  minimum: 'Minimum à garder par période',
  zero: '0 € : viser l’équilibre. Un montant positif : viser un excédent.',
  cumulative: 'Total à atteindre (€), facultatif',
  periods: 'Nombre de périodes',
  start: 'Première période',
  cumulativeHelp:
    'Ce total inclut votre minimum. Le cumul compte les soldes clôturés, déficits compris. Laissez vide pour suivre seulement le minimum.',
  saveBudget: 'Enregistrer l’objectif budgétaire',
  saved: 'Objectifs enregistrés.',
  invalid: 'Vérifiez les montants, les périodes et la date de départ.',
  achieved: 'Cumul déjà clôturé',
  left: 'Reste à atteindre',
  remaining: 'Périodes restantes',
  average: 'À garder par période restante',
  catchup: 'Si les autres périodes restent au minimum, il faudra une période à au moins',
  ended: 'Le délai est terminé. Fixez un nouvel objectif pour la suite.',
  wealthTitle: 'Objectif de patrimoine',
  wealthHelp:
    'Votre patrimoine s’accumule toute la vie, sans remise à zéro. Atteignez votre objectif, puis décidez de sa répartition.',
  accumulation: '01 · Accumuler',
  allocation: '02 · Répartir',
  target: 'Patrimoine total visé (€)',
  noTarget: 'Indiquez le patrimoine total que vous souhaitez atteindre.',
  current: 'Patrimoine actuel',
  cap: 'Objectif actuel',
  overrun: 'Objectif de dépassement n°',
  reached: 'Objectif atteint : choisissez la suite',
  reachedHelp: 'Fixez un objectif plus élevé ou préparez la répartition de votre patrimoine.',
  saveTarget: 'Enregistrer l’objectif de patrimoine',
  nextTarget: 'Nouveau patrimoine total visé (€)',
  extend: 'Enregistrer le nouvel objectif',
  switch: 'Préparer la répartition',
  switchTitle: 'Passer à la répartition du patrimoine ?',
  early:
    'Votre objectif n’est pas atteint. En confirmant, vous le ramenez au patrimoine actuel indiqué ci-dessous et passez à sa répartition.',
  reduced: 'Objectif ramené au patrimoine détenu lors du passage anticipé. Ancien objectif :',
  switchHelp:
    'Vous terminez l’accumulation et préparez un plan de répartition de votre patrimoine.',
  confirm: 'Confirmer et préparer la répartition',
  cancel: 'Annuler',
  allocationsTitle: 'Plan de répartition',
  allocationsHelp:
    'Indiquez un montant pour chaque usage. La validation enregistre le plan sans déplacer d’argent.',
  allocationAmount: 'Montant alloué (€)',
  unallocated: 'Reste à répartir',
  validate: 'Valider le plan',
  validated: 'Plan validé',
  changed: 'Le plan a changé : une nouvelle validation est nécessaire.',
  unknown: 'Renseignez la valeur de votre patrimoine avant de passer à la répartition.',
  noAllocations: 'Créez vos allocations dans Patrimoine Management avant de valider un plan.',
  fixed: 'Ce montant reste fixe jusqu’à son atteinte. Vous pourrez alors fixer un nouvel objectif.',
};
registerPageTexts(
  Object.fromEntries(Object.entries(BPM_OBJECTIVES_TEXTS).map(([key, value]) => [P + key, value])),
);
@Component({
  selector: 'rjs-bpm-objectives',
  imports: [FormsModule, RangeFieldComponent, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './bpm-objectives.component.scss',
  host: { '[class.is-compact]': 'compactControls()' },
  template: `
    <section
      class="objectives objectives-budget"
      data-bpm-frame="metrics"
      data-ui-pattern="panel"
      aria-labelledby="budget-objectives-title"
      id="objectifs-budgetaires"
    >
      <header data-ui-pattern="section-heading">
        <span class="objectives-eyebrow">{{ t('budgetEyebrow') }}</span>
        <h2 id="budget-objectives-title">{{ t('budgetTitle') }}</h2>
        <p>{{ t('budgetHelp') }}</p>
      </header>
      <dl class="objectives-summary">
        <div>
          <dt>{{ t('minimumSaved') }}</dt>
          <dd>
            {{
              project().vision.savingsTargetCents == null
                ? t('noMinimum')
                : money(project().vision.savingsTargetCents!)
            }}
          </dd>
        </div>
        @if (project().vision.surplusGoal; as goal) {
          <div>
            <dt>{{ t('cumulativeSaved') }}</dt>
            <dd>{{ money(goal.targetCents) }}</dd>
            <small>{{ goal.periods }} {{ t('goalPeriods') }}</small>
          </div>
        }
      </dl>
      @if (progress(); as p) {
        <dl class="objectives-metrics">
          <div>
            <dt>{{ t('achieved') }}</dt>
            <dd>{{ money(p.achievedCents) }}</dd>
          </div>
          <div>
            <dt>{{ t('left') }}</dt>
            <dd>{{ money(p.remainingCents) }}</dd>
          </div>
          <div>
            <dt>{{ t('remaining') }}</dt>
            <dd>{{ p.remainingPeriods }}</dd>
          </div>
          <div>
            <dt>{{ t('average') }}</dt>
            <dd>{{ money(p.requiredPerPeriodCents) }}</dd>
          </div>
        </dl>
        @if (p.reached) {
          <p class="objectives-callout" data-state="success">{{ t('reachedBudget') }}</p>
        }
        @if (p.remainingPeriods && !p.reached) {
          <p class="objectives-callout">
            {{ t('catchup') }} <strong>{{ money(p.finalPeriodCents) }}</strong
            >.
          </p>
        }
        @if (!p.remainingPeriods && !p.reached) {
          <p class="objectives-callout">{{ t('ended') }}</p>
        }
      }
      @if (manages()) {
        <details
          class="objectives-settings"
          [open]="!compactControls()"
          [class.is-fixed]="!compactControls()"
        >
          <summary [hidden]="!compactControls()">{{ t('budgetSettings') }}</summary>
          <form #budgetForm="ngForm" (ngSubmit)="budgetForm.valid && saveBudget()">
            <rjs-range-field
              id="budget-surplus-minimum"
              name="minimum"
              [label]="t('minimum')"
              [min]="0"
              [max]="minimumMax()"
              [step]="10"
              [numberStep]="0.01"
              unit="€"
              [(ngModel)]="minimum"
              required
            />
            <p class="bpm-help">{{ t('zero') }}</p>
            <div class="objectives-fields">
              <label
                >{{ t('cumulative')
                }}<input type="number" min="0.01" step="0.01" name="total" [(ngModel)]="cumulative"
              /></label>
              <label
                >{{ t('periods')
                }}<input
                  type="number"
                  min="1"
                  max="1200"
                  step="1"
                  name="periods"
                  [(ngModel)]="periods"
                  [required]="cumulative !== null"
              /></label>
              <label
                >{{ t('start')
                }}<input
                  type="date"
                  name="start"
                  [(ngModel)]="start"
                  [required]="cumulative !== null"
              /></label>
            </div>
            <p class="bpm-help">{{ t('cumulativeHelp') }}</p>
            <button
              class="btn btn-primary"
              type="submit"
              [disabled]="store.saving() || budgetForm.invalid"
            >
              {{ t('saveBudget') }}
            </button>
          </form>
        </details>
      }
    </section>
    <section
      class="objectives objectives-wealth"
      data-bpm-frame="metrics"
      data-ui-pattern="panel"
      aria-labelledby="wealth-objectives-title"
      id="cap-patrimonial"
    >
      <header data-ui-pattern="section-heading">
        <span class="objectives-eyebrow">{{ t('wealthEyebrow') }}</span>
        <h2 id="wealth-objectives-title">{{ t('wealthTitle') }}</h2>
        <p>{{ t('wealthHelp') }}</p>
      </header>
      <div class="objectives-wealth-route">
        @if (wealthPercent() !== null) {
          <div class="objectives-route-heading">
            <strong>{{ wealthPercent() }} %</strong>
            <span>{{ t('targetProgress') }}</span>
          </div>
        }
        <dl class="objectives-wealth-landmarks">
          <div class="objectives-landmark objectives-landmark-current">
            <dt>
              <span class="objectives-landmark-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="7"></circle>
                  <circle cx="12" cy="12" r="2"></circle>
                </svg> </span
              >{{ t('current') }}
            </dt>
            <dd>{{ total() === null ? '—' : money(total()!) }}</dd>
          </div>
          <div class="objectives-landmark objectives-landmark-target">
            <dt>
              <span class="objectives-landmark-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M6 21V4m0 0c4-4 8 4 12 0v9c-4 4-8-4-12 0"></path>
                </svg> </span
              >{{ t('cap') }}
            </dt>
            <dd>{{ cap() === null ? '—' : money(cap()!) }}</dd>
          </div>
          @if (wealthGap(); as gap) {
            <div class="objectives-landmark-gap">
              <dt>{{ t('wealthGap') }}</dt>
              <dd>{{ money(gap) }}</dd>
            </div>
          }
        </dl>
      </div>
      <ol class="objectives-phases">
        <li [attr.aria-current]="life().phase === 'accumulation' ? 'step' : null">
          {{ t('accumulation') }}
        </li>
        <li [attr.aria-current]="life().phase === 'allocation' ? 'step' : null">
          {{ t('allocation') }}
        </li>
      </ol>
      @if (life().phase === 'accumulation') {
        @if (life().overruns.length) {
          <p>{{ t('overrun') }} {{ life().overruns.length }} · {{ t('fixed') }}</p>
        } @else if (manages()) {
          <details
            class="objectives-settings"
            [open]="!compactControls() || cap() === null"
            [class.is-fixed]="!compactControls()"
          >
            <summary [hidden]="!compactControls()">{{ t('wealthSettings') }}</summary>
            <form
              #targetForm="ngForm"
              (ngSubmit)="targetForm.valid && act({ action: 'target', targetCents: cents(target) })"
            >
              <label
                >{{ t('target')
                }}<input
                  type="number"
                  min="0"
                  step="0.01"
                  name="target"
                  [(ngModel)]="target"
                  required
              /></label>
              @if (cap() === null) {
                <p class="bpm-help">{{ t('noTarget') }}</p>
              }
              <button
                class="btn btn-primary"
                type="submit"
                [disabled]="store.saving() || targetForm.invalid"
              >
                {{ t('saveTarget') }}
              </button>
            </form>
          </details>
        }
        @if (reached()) {
          <aside class="objectives-callout" role="status">
            <h3>{{ t('reached') }}</h3>
            <p>{{ t('reachedHelp') }}</p>
          </aside>
          @if (manages()) {
            <form
              #overrunForm="ngForm"
              (ngSubmit)="
                overrunForm.valid && act({ action: 'overrun', targetCents: cents(nextTarget) })
              "
            >
              <label
                >{{ t('overrun') }} {{ life().overruns.length + 1 }} · {{ t('nextTarget')
                }}<input
                  type="number"
                  [min]="(total() ?? 0) / 100 + 0.01"
                  step="0.01"
                  name="next"
                  [(ngModel)]="nextTarget"
                  required
              /></label>
              <button
                class="btn btn-primary"
                type="submit"
                [disabled]="store.saving() || overrunForm.invalid"
              >
                {{ t('extend') }}
              </button>
            </form>
          }
        }
        @if (manages()) {
          <button
            class="btn btn-secondary"
            type="button"
            [disabled]="store.saving() || total() === null || cap() === null"
            (click)="switching.set(true)"
          >
            {{ t('switch') }}
          </button>
          @if (total() === null) {
            <p class="bpm-help">{{ t('unknown') }}</p>
          }
        }
      } @else {
        @if (life().previousTargetCents !== undefined) {
          <p class="objectives-callout">
            {{ t('reduced') }} <strong>{{ money(life().previousTargetCents!) }}</strong
            >.
          </p>
        }
        <h3>{{ t('allocationsTitle') }}</h3>
        <p>{{ t('allocationsHelp') }}</p>
        @if (allocationValid() && !allocationDraftChanged()) {
          <p role="status" class="objectives-callout">
            {{ t('validated') }} · {{ life().allocationValidatedAt?.slice(0, 10) }}
          </p>
        } @else if (life().allocationValidatedAt) {
          <p class="objectives-callout">{{ t('changed') }}</p>
        }
        @if (manages() && allocations().length) {
          <form #allocForm="ngForm" (ngSubmit)="allocForm.valid && validateAllocations()">
            <div class="objectives-fields">
              @for (item of allocations(); track item.id) {
                <label
                  >{{ item.name }} · {{ t('allocationAmount')
                  }}<input
                    type="number"
                    min="0"
                    step="0.01"
                    [name]="item.id"
                    [(ngModel)]="allocationDraft[item.id]"
                    required
                /></label>
              }
            </div>
            <p>
              {{ t('unallocated') }} : <strong>{{ money(unallocated()) }}</strong>
            </p>
            <button
              class="btn btn-primary"
              type="submit"
              [disabled]="
                store.saving() || allocForm.invalid || unallocated() < 0 || total() === null
              "
            >
              {{ t('validate') }}
            </button>
          </form>
        } @else if (!allocations().length) {
          <p>{{ t('noAllocations') }}</p>
        }
      }
    </section>
    @if (message()) {
      <p role="status">{{ message() }}</p>
    }
    @if (store.error()) {
      <p class="bpm-error" role="alert">{{ store.error() }}</p>
    }
    <rjs-modal
      [headed]="true"
      [open]="switching()"
      [title]="t('switchTitle')"
      [busy]="store.saving()"
      (closed)="switching.set(false)"
    >
      <p>{{ t(reached() ? 'switchHelp' : 'early') }}</p>
      <p>
        {{ t('cap') }} : <strong>{{ cap() === null ? '—' : money(cap()!) }}</strong>
      </p>
      <p>
        {{ t('current') }} : <strong>{{ total() === null ? '—' : money(total()!) }}</strong>
      </p>
      @if (store.error()) {
        <p class="bpm-error" role="alert">{{ store.error() }}</p>
      }
      <div class="bpm-actions">
        <button class="btn btn-secondary" type="button" (click)="switching.set(false)">
          {{ t('cancel') }}</button
        ><button
          class="btn btn-primary"
          type="button"
          [disabled]="store.saving()"
          (click)="switchPhase()"
        >
          {{ t('confirm') }}
        </button>
      </div>
    </rjs-modal>
  `,
})
export class BpmObjectivesComponent {
  readonly project = input.required<BpmProject>();
  readonly manages = input(false);
  readonly compactControls = input(false);
  protected readonly store = inject(BpmStore);
  protected readonly money = formatMoney;
  protected readonly switching = signal(false);
  protected readonly message = signal('');
  protected minimum: number | null = 0;
  protected cumulative: number | null = null;
  protected periods: number | null = 12;
  protected start = '';
  protected target: number | null = null;
  protected nextTarget: number | null = null;
  protected allocationDraft: Record<string, number> = {};
  protected readonly life = computed<PatrimoineLifecycle>(
    () =>
      this.project().snapshot?.patrimoineLifecycle ?? {
        phase: 'accumulation',
        targetCents: null,
        overruns: [],
        allocationValidatedAt: null,
        allocationPlan: [],
      },
  );
  protected readonly total = computed(() => this.project().snapshot?.standing.totalCents ?? null);
  protected readonly cap = computed(() =>
    this.life().phase === 'allocation'
      ? this.life().targetCents
      : (this.life().overruns.at(-1)?.targetCents ?? this.life().targetCents),
  );
  protected readonly wealthGap = computed(() => {
    const total = this.total();
    const cap = this.cap();
    return total === null || cap === null ? null : Math.max(0, cap - total);
  });
  protected readonly wealthPercent = computed(() => {
    const current = this.total();
    const target = this.cap();
    return current === null || target === null || target <= 0
      ? null
      : Math.max(0, Math.min(100, Math.round((current / target) * 100)));
  });
  protected readonly reached = computed(
    () => this.total() !== null && this.cap() !== null && this.total()! >= this.cap()!,
  );
  protected readonly allocations = computed(() => this.project().snapshot?.allocations ?? []);
  protected readonly progress = computed(() => budgetSurplusProgress(this.project()));
  protected minimumMax() {
    return Math.max(10000, Math.ceil((this.minimum ?? 0) / 1000) * 1000);
  }
  protected unallocated() {
    return (
      Math.max(this.total() ?? 0, 0) -
      Object.values(this.allocationDraft).reduce((sum, value) => sum + (this.cents(value) ?? 0), 0)
    );
  }
  protected readonly allocationValid = computed(
    () =>
      !!this.life().allocationValidatedAt &&
      this.life().allocationPlan.reduce((sum, item) => sum + item.targetCents, 0) <=
        Math.max(this.total() ?? 0, 0) &&
      this.life().allocationPlan.length === this.allocations().length &&
      this.allocations().every((item) =>
        this.life().allocationPlan.some(
          (p) => p.id === item.id && p.targetCents === item.targetCents,
        ),
      ),
  );
  protected allocationDraftChanged(): boolean {
    return this.allocations().some(
      (item) =>
        this.life().allocationPlan.find((plan) => plan.id === item.id)?.targetCents !==
        this.cents(this.allocationDraft[item.id] ?? null),
    );
  }
  protected t(key: string) {
    return pageText(P + key);
  }
  protected cents(value: number | null) {
    return value === null ? null : parseAmount(String(value));
  }
  private budgetKey = '';
  private wealthKey = '';
  private allocationKey = '';
  constructor() {
    effect(() => {
      const p = this.project();
      const life = this.life();
      const allocations = this.allocations();
      untracked(() => {
        const budgetKey = JSON.stringify([p.id, p.vision.savingsTargetCents, p.vision.surplusGoal]);
        const wealthKey = JSON.stringify([p.patrimoineProjectId, life]);
        const allocationKey = JSON.stringify([
          p.patrimoineProjectId,
          allocations.map((item) => [item.id, item.targetCents]),
        ]);
        if (budgetKey !== this.budgetKey) {
          this.budgetKey = budgetKey;
          this.minimum = (p.vision.savingsTargetCents ?? 0) / 100;
          this.cumulative = p.vision.surplusGoal ? p.vision.surplusGoal.targetCents / 100 : null;
          this.periods = p.vision.surplusGoal?.periods ?? 12;
          this.start = p.vision.surplusGoal?.startDate ?? p.snapshot?.period.start ?? '';
        }
        if (wealthKey !== this.wealthKey) {
          this.wealthKey = wealthKey;
          this.target = life.targetCents === null ? null : life.targetCents / 100;
        }
        if (allocationKey !== this.allocationKey) {
          this.allocationKey = allocationKey;
          this.allocationDraft = Object.fromEntries(
            allocations.map((item) => [item.id, (item.targetCents ?? 0) / 100]),
          );
        }
      });
    });
  }
  protected async saveBudget() {
    const minimum = this.cents(this.minimum);
    const target = this.cents(this.cumulative);
    if (
      minimum === null ||
      minimum < 0 ||
      (this.cumulative !== null && (!target || !this.periods || !this.start))
    ) {
      this.message.set(this.t('invalid'));
      return;
    }
    if (
      await this.store.saveVision(this.project().id, {
        ...this.project().vision,
        savingsTargetCents: minimum,
        surplusGoal:
          this.cumulative === null
            ? null
            : { targetCents: target!, periods: this.periods!, startDate: this.start },
      })
    )
      this.message.set(this.t('saved'));
  }
  protected async act(body: object) {
    const ok = await this.store.patrimoineAction(this.project(), body);
    if (ok) this.message.set(this.t('saved'));
    return ok;
  }
  protected async switchPhase() {
    if (await this.act({ action: 'allocate', confirmReducedTarget: !this.reached() }))
      this.switching.set(false);
  }
  protected validateAllocations() {
    return this.act({
      action: 'validate-allocations',
      allocations: this.allocations().map((item) => ({
        id: item.id,
        targetCents: this.cents(this.allocationDraft[item.id] ?? null),
      })),
    });
  }
}
