import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { BUDGET_STATE_LABEL, ProjectBudget, ProjectBudgetState, ProjectOverrun } from '../../core/bpm-projects.models';
import { CentsPipe, ShortDatePipe } from '../../core/format';

/** Part d'un montant dans le budget du projet, bornée à 100 % pour la jauge. */
const share = (value: number, total: number | null) => (!total || total <= 0 ? (value > 0 ? 100 : 0) : Math.min(100, Math.round((value / total) * 1000) / 10));

/** Pastille d'état budgétaire d'un projet (rouge réservé au dépassement autorisé). */
@Component({
  selector: 'bpm-budget-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="bpm-state-chip" [attr.data-state]="state()" [attr.title]="title() || null">{{ label() }}</span>`,
})
export class BpmBudgetStateComponent {
  readonly state = input.required<ProjectBudgetState>();
  readonly title = input<string>('');
  protected label = computed(() => BUDGET_STATE_LABEL[this.state()]);
}

/**
 * Jauge du budget d'un projet : budget (attribué + dépassements autorisés), part ventilée sur les tâches et
 * dépenses réglées validées ; disponible, engagé et reste en chiffres.
 */
@Component({
  selector: 'bpm-budget-meter',
  imports: [CentsPipe, BpmBudgetStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let b = budget();
    @if (!b.regime) {
      <p class="bpm-budget-empty">Aucun montant attribué par le budget de vie.</p>
    } @else {
      <div class="bpm-budget" [attr.data-state]="b.state" [class.is-compact]="compact()">
        <div class="bpm-budget-head">
          <span>Budget</span><strong>{{ b.ceilingCents | cents }}</strong>
          @if (showState()) {
            <bpm-budget-state [state]="b.state" [title]="stateTitle()" />
          }
          @if (b.approvedOverrunCents) {
            <small class="bpm-budget-over">dont {{ b.approvedOverrunCents | cents }} de dépassement autorisé</small>
          }
        </div>
        <div class="bpm-budget-track" role="img" [attr.aria-label]="ariaLabel()">
          <span class="bpm-budget-fill is-shared" [style.width.%]="sharedPct()"></span>
          <span class="bpm-budget-fill is-paid" [style.width.%]="paidPct()"></span>
        </div>
        @if (figures()) {
          <dl [class]="compact() ? 'bpm-budget-rows' : 'bpm-budget-figures'">
            <div><dt>Ventilé</dt><dd>{{ b.sharesCents | cents }}</dd></div>
            <div><dt>Réglé validé</dt><dd>{{ b.paidCents | cents }}</dd></div>
            <div><dt>À ventiler</dt><dd>{{ b.availableCents | cents }}</dd></div>
            @if (!compact()) {
              <div><dt>Engagé</dt><dd>{{ b.engagedCents | cents }}</dd></div>
              <div><dt>Reste</dt><dd>{{ b.remainingCents | cents }}</dd></div>
            }
          </dl>
        }
      </div>
    }
  `,
})
export class BpmBudgetMeterComponent {
  readonly budget = input.required<ProjectBudget>();
  /** Carte de tableau : chiffres en lignes. */
  readonly compact = input(false);
  /** Chiffres sous la jauge (masqués quand la page les présente déjà). */
  readonly figures = input(true);
  /** Pastille d'état dans l'en-tête de la jauge. */
  readonly showState = input(false);
  protected stateTitle = computed(() => {
    const b = this.budget();
    if (b.state === 'deficit') return 'Dépassement autorisé par le budget de vie, facturé à la fin de son cycle.';
    if (b.state === 'at-risk') return 'Les charges planifiées du projet dépassent son budget.';
    return 'Dépenses réglées et parts des tâches dans le budget du projet.';
  });
  protected sharedPct = computed(() => share(this.budget().sharesCents, this.budget().ceilingCents));
  protected paidPct = computed(() => share(this.budget().paidCents, this.budget().ceilingCents));
  protected ariaLabel = computed(() => `Ventilé ${this.sharedPct()} % et réglé ${this.paidPct()} % du budget du projet`);
}

/** Demande de dépassement en attente : la décision appartient au budget de vie. */
@Component({
  selector: 'bpm-overrun-request',
  imports: [CentsPipe, ShortDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let o = overrun();
    <div class="bpm-overrun" role="group" [attr.aria-label]="'Demande de dépassement du projet ' + (o.budgetName ?? '')">
      <p>
        <strong>Demande au budget de vie</strong> · {{ o.budgetName }}@if (o.taskTitle) { · {{ o.taskTitle }} }
      </p>
      <p>
        {{ o.reasonLabel }} : dépassement de <strong>{{ o.amountCents | cents }}</strong>, demandé le {{ o.requestedAt | shortDate }}.
      </p>
      <p class="bpm-overrun-help">
        Autoriser fait passer le projet en dépassement ; la charge sera facturée au budget de vie à la fin de son cycle.
      </p>
      <div class="bpm-actions">
        <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="decide.emit('approve')">Autoriser le dépassement</button>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="decide.emit('refuse')">Refuser</button>
      </div>
    </div>
  `,
})
export class BpmOverrunRequestComponent {
  readonly overrun = input.required<ProjectOverrun>();
  readonly busy = input(false);
  readonly decide = output<'approve' | 'refuse'>();
}
