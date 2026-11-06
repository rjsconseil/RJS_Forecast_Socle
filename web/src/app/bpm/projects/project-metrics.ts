import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BpmTaskCard, ProjectBudget } from '../../core/bpm-projects.models';
import { CentsPipe } from '../../core/format';
import { TimeAggregates } from '../../core/models';
import { FUNDING } from '../ui/project-funding';

/** Les deux repères de la ligne de gestion : argent encore disponible et temps effectivement consommé. */
@Component({
  selector: 'bpm-project-metrics',
  imports: [CentsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let b = displayBudget();
    @let t = displayTime();
    <div
      class="pm-budget"
      [class.pm-vertical-metrics]="vertical()"
      [class.is-unfunded]="!b.regime"
      [attr.data-tone]="budgetTone()"
    >
      <div class="pm-metric-heading">
        <span>{{ task() ? 'Budget de la tâche' : 'Budget du projet' }}</span
        ><span class="pm-signal">{{ budgetLabel() }}</span>
      </div>
      @if (b.regime) {
        <div class="pm-money">
          <div class="pm-envelope">
            <small>{{ task() ? L.share : b.approvedOverrunCents ? L.envelopeWithOverrun : L.envelope }}</small>
            <strong>{{ b.ceilingCents | cents }}</strong>
          </div>
          @if (vertical()) {
            <div class="pm-consumed">
              <span>{{ task() ? 'Consommé estimé' : 'Réglé' }}</span
              ><strong>{{ b.paidCents | cents }}</strong>
            </div>
          }
          <div class="pm-budget-meter">
            <span class="pm-budget-percent">{{
              budgetPercent() === null ? 'À estimer' : budgetPercent() + ' % restant'
            }}</span>
            <div
              class="pm-track pm-budget-track"
              role="progressbar"
              aria-label="Budget restant"
              [attr.aria-orientation]="vertical() ? 'vertical' : 'horizontal'"
              [attr.aria-valuenow]="budgetPercent() === null ? null : budgetWidth()"
              [attr.aria-valuetext]="
                budgetPercent() === null
                  ? 'Consommation à estimer'
                  : budgetPercent() + ' % du budget restent à consommer'
              "
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span
                [style.width.%]="vertical() ? 100 : budgetWidth()"
                [style.height.%]="vertical() ? budgetWidth() : null"
              ></span>
            </div>
          </div>
          <div class="pm-remaining">
            <span>{{ task() ? 'Reste selon le temps' : L.remaining }}</span
            ><strong>{{ b.remainingCents | cents }}</strong>
          </div>
        </div>
        <div
          class="pm-metric-caption"
          [class.pm-caption-hidden]="vertical() && !b.approvedOverrunCents"
        >
          <span [hidden]="vertical()"
            >{{ task() ? 'Consommé selon le temps' : L.paidOnEnvelope }} :
            <strong>{{ b.paidCents | cents }}</strong>
            @if (task() && consumedPercent() !== null) {
              <strong> · {{ consumedPercent() }} %</strong>
            }
          </span>
          @if (task()) {
            <span>Estimation au prorata du temps saisi</span>
          } @else if (b.approvedOverrunCents) {
            <span>Dont {{ b.approvedOverrunCents | cents }} de dépassement autorisé</span>
          }
        </div>
      } @else {
        <div class="pm-budget-empty">
          <strong>{{ task() ? 'À demander' : 'À attribuer' }}</strong>
          <p>
            {{
              task()
                ? 'Demandez une part du budget du projet pour cette tâche.'
                : 'Définissez le montant pour commencer à financer les tâches.'
            }}
          </p>
        </div>
      }
      <div class="pm-time" [attr.data-tone]="timeTone()">
        <div class="pm-time-heading">
          <div>
            <span class="pm-metric-label">Temps consommé</span
            ><strong>{{ t.spentHoursTotal }} <small>h</small></strong
            ><span class="pm-time-planned"
              >sur {{ t.plannedHoursKnown }} h {{ t.plannedIsPartial ? '(partiel)' : '' }}</span
            >
          </div>
          <span class="pm-time-percent">{{
            timePercent() === null ? 'À estimer' : timePercent() + ' %'
          }}</span>
        </div>
        @if (timePercent() !== null) {
          <div
            class="pm-track pm-time-track"
            role="progressbar"
            aria-label="Temps consommé"
            [attr.aria-orientation]="vertical() ? 'vertical' : 'horizontal'"
            [attr.aria-valuenow]="timeWidth()"
            [attr.aria-valuetext]="timePercent() + ' % du temps prévu consommés'"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <span
              [style.width.%]="vertical() ? 100 : timeWidth()"
              [style.height.%]="vertical() ? timeWidth() : null"
            ></span>
          </div>
          @if ((timePercent() ?? 0) > 100) {
            <p class="pm-time-note">Temps prévu dépassé de {{ extraHours() }} h.</p>
          }
        } @else {
          <div class="pm-track pm-time-track is-unknown" aria-hidden="true"></div>
          <p class="pm-time-note">
            {{
              t.taskCount
                ? 'Complétez les temps prévus de chaque tâche pour calculer la consommation.'
                : 'Ajoutez des tâches et estimez leur temps pour suivre la consommation.'
            }}
          </p>
        }
      </div>
    </div>
  `,
})
export class BpmProjectMetricsComponent {
  protected readonly L = FUNDING;
  readonly vertical = input(false);
  readonly budget = input<ProjectBudget | null>(null);
  readonly time = input<TimeAggregates | null>(null);
  readonly task = input<BpmTaskCard | null>(null);
  protected displayBudget = computed(() => {
    const task = this.task();
    const b = this.budget();
    return task
      ? {
          regime: task.budget?.shareCents !== null && task.budget?.shareCents !== undefined,
          ceilingCents: task.budget?.shareCents ?? null,
          remainingCents: task.budget?.timeRemainingCents ?? null,
          paidCents: task.budget?.timeConsumedCents ?? null,
          approvedOverrunCents: 0,
        }
      : {
          regime: b?.regime ?? false,
          ceilingCents: b?.ceilingCents ?? null,
          remainingCents: b?.remainingCents ?? null,
          paidCents: b?.paidCents ?? null,
          approvedOverrunCents: b?.approvedOverrunCents ?? 0,
        };
  });
  protected displayTime = computed(() => {
    const task = this.task();
    if (task)
      return {
        taskCount: 1,
        spentHoursTotal: task.task.spentHours,
        plannedHoursKnown: task.task.plannedHours ?? 0,
        plannedIsPartial: task.task.plannedHours === null,
        spentToPlannedPercent: task.budget?.timeConsumptionPercent ?? null,
      };
    return (
      this.time() ?? {
        taskCount: 0,
        spentHoursTotal: 0,
        plannedHoursKnown: 0,
        plannedIsPartial: false,
        spentToPlannedPercent: null,
      }
    );
  });
  private budgetRatio = computed(() => {
    const b = this.displayBudget();
    return !b.regime || b.remainingCents === null
      ? null
      : (b.ceilingCents ?? 0) > 0
        ? (100 * (b.remainingCents ?? 0)) / b.ceilingCents!
        : 0;
  });
  protected budgetPercent = computed(() => {
    const ratio = this.budgetRatio();
    return ratio === null ? null : Math.round(ratio * 10) / 10;
  });
  protected consumedPercent = computed(() => {
    const b = this.displayBudget();
    return b.paidCents === null || !b.ceilingCents
      ? null
      : Math.round((1000 * b.paidCents) / b.ceilingCents) / 10;
  });
  protected budgetWidth = computed(() => Math.min(100, Math.max(0, this.budgetRatio() ?? 0)));
  protected budgetTone = computed(() => {
    const ratio = this.budgetRatio();
    return ratio === null ? 'unknown' : ratio >= 50 ? 'green' : ratio >= 20 ? 'orange' : 'red';
  });
  protected budgetLabel = computed(() => {
    const budget = this.displayBudget();
    if (!budget.regime) return 'Budget à définir';
    if (budget.ceilingCents === 0) return this.task() ? 'Part de 0 €' : 'Enveloppe de 0 €';
    const remaining = budget.remainingCents;
    if (remaining !== null && remaining < 0) return this.task() ? 'Estimation au-delà de la part' : 'Enveloppe dépassée';
    if (remaining === 0) return this.task() ? 'Part estimée consommée' : 'Enveloppe épuisée';
    return ({
        unknown: this.displayBudget().regime ? 'Consommation à estimer' : 'Budget à définir',
        green: 'Budget disponible',
        orange: 'Budget à surveiller',
        red: 'Budget presque épuisé',
      })[this.budgetTone()];
  });
  private timeRatio = computed(() => {
    const t = this.displayTime();
    return t.spentToPlannedPercent === null
      ? null
      : (100 * t.spentHoursTotal) / t.plannedHoursKnown;
  });
  protected timePercent = computed(() => {
    const ratio = this.timeRatio();
    return ratio === null ? null : Math.round(ratio * 10) / 10;
  });
  protected timeWidth = computed(() => Math.min(100, Math.max(0, this.timeRatio() ?? 0)));
  protected timeTone = computed(() => {
    const ratio = this.timeRatio();
    return ratio === null ? 'unknown' : ratio >= 100 ? 'green' : ratio >= 50 ? 'yellow' : 'blue';
  });
  protected extraHours = computed(
    () =>
      Math.round(
        Math.max(0, this.displayTime().spentHoursTotal - this.displayTime().plannedHoursKnown) *
          100,
      ) / 100,
  );
}
