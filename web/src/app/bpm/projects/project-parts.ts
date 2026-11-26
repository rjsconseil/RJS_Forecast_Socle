import { BpmAmount } from '../ui/amount';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { BUDGET_STATE_LABEL, ProjectBudget, ProjectBudgetState, ProjectOverrun, TaskBudgetRequest } from '../data/bpm-projects.models';
import { CentsPipe, ShortDatePipe } from '../../core/format';
import { BpmRouterLink } from '../ui/bpm-router-link';
import { FUNDING, FUNDING_ACTIONS } from '../ui/project-funding';

/** Part d'un montant dans le budget du projet, bornée à 100 % pour la jauge. */
const share = (value: number, total: number | null) => (!total || total <= 0 ? (value > 0 ? 100 : 0) : Math.min(100, Math.round((value / total) * 1000) / 10));

/** Pastille d'état budgétaire : dépassement en rouge, risque en jaune, budget tenu en vert. */
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
  styles: `
    .bpm-budget-cta { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; width: 100%; padding: 8px 10px; border: 1px dashed var(--astra-keyline, var(--bpm-line)); border-radius: 8px; background: var(--astra-wash, var(--bpm-soft)); color: var(--bpm-text); font: inherit; cursor: pointer; text-align: left; }
    .bpm-budget-cta span { color: var(--bpm-muted); font-size: 12px; }
    .bpm-budget-cta strong { color: var(--astra-link, var(--bpm-link)); text-decoration: underline; text-underline-offset: 3px; }
    .bpm-budget-cta:hover { border-style: solid; }
    .bpm-budget-amount-link { padding: 0; border: 0; background: none; font: inherit; cursor: pointer; }
    .bpm-budget-amount-link strong { text-decoration: underline; text-decoration-color: var(--astra-keyline, currentColor); text-underline-offset: 3px; }
    .bpm-budget-amount-link:hover strong { text-decoration-color: currentColor; }
  `,
  imports: [BpmAmount, CentsPipe, BpmBudgetStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let b = budget();
    @if (!b.regime) {
      @if (editable()) {
        <button type="button" class="bpm-budget-cta" (click)="envelope.emit()" [attr.aria-label]="'Attribuer une enveloppe au projet « ' + b.name + ' »'">
          <span>Budget</span><strong>À attribuer</strong>
        </button>
      } @else {
        <p class="bpm-budget-empty">Aucun montant attribué par le budget du projet de vie.</p>
      }
    } @else {
      <div class="bpm-budget" [attr.data-state]="b.state" [class.is-compact]="compact()">
        <div class="bpm-budget-head">
          <span>Budget</span>
          @if (editable()) {
            <button type="button" class="bpm-budget-amount-link" (click)="envelope.emit()" [attr.aria-label]="'Modifier l’enveloppe du projet « ' + b.name + ' »'" title="Modifier l’enveloppe"><strong [bpmAmount]="b.ceilingCents" bpmTone="info">{{ b.ceilingCents | cents }}</strong></button>
          } @else {
            <strong [bpmAmount]="b.ceilingCents" bpmTone="info">{{ b.ceilingCents | cents }}</strong>
          }
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
            <div><dt>{{ L.shared }}</dt><dd [bpmAmount]="b.sharesCents" bpmTone="info">{{ b.sharesCents | cents }}</dd></div>
            <div><dt>{{ L.paidOnEnvelope }}</dt><dd [bpmAmount]="b.paidCents" bpmFlow="expense">{{ b.paidCents | cents }}</dd></div>
            <div><dt>{{ L.toShare }}</dt><dd [bpmAmount]="b.availableCents">{{ b.availableCents | cents }}</dd></div>
            @if (!compact()) {
              <div><dt>{{ L.engaged }}</dt><dd [bpmAmount]="b.engagedCents" bpmTone="info">{{ b.engagedCents | cents }}</dd></div>
              <div><dt>{{ L.remaining }}</dt><dd [bpmAmount]="b.remainingCents">{{ b.remainingCents | cents }}</dd></div>
            }
          </dl>
        }
      </div>
    }
  `,
})
export class BpmBudgetMeterComponent {
  protected readonly L = FUNDING;
  readonly budget = input.required<ProjectBudget>();
  /** Carte de tableau : chiffres en lignes. */
  readonly compact = input(false);
  /** Chiffres sous la jauge (masqués quand la page les présente déjà). */
  readonly figures = input(true);
  /** Pastille d'état dans l'en-tête de la jauge. */
  readonly showState = input(false);
  /** Le montant (ou « À attribuer ») ouvre la fenêtre de l'enveloppe. */
  readonly editable = input(false);
  readonly envelope = output<void>();
  protected stateTitle = computed(() => {
    const b = this.budget();
    if (b.state === 'deficit') return 'Moyens supplémentaires autorisés ; aucune charge créée par cette décision.';
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
  imports: [BpmAmount, CentsPipe, ShortDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let o = overrun();
    <div class="bpm-overrun" role="group" [attr.aria-label]="'Demande de dépassement du projet ' + (o.budgetName ?? '')">
      <p>
        <strong>Demande au budget du projet de vie</strong> · {{ o.budgetName }}@if (o.taskTitle) { · {{ o.taskTitle }} }
      </p>
      <p>
        {{ o.reasonLabel }} : dépassement de <strong [bpmAmount]="o.amountCents" bpmTone="warning">{{ o.amountCents | cents }}</strong>, demandé le {{ o.requestedAt | shortDate }}.
      </p>
      <p class="bpm-overrun-help">
        Autoriser ajuste les moyens du projet. Cette décision ne crée aucune charge : seuls les flux des tâches validés sont imputés au cycle ou au patrimoine.
      </p>
      <div class="bpm-actions">
        <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="decide.emit('approve')">{{ act.authorize(o.amountCents) }}</button>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="decide.emit('refuse')">{{ act.refuseRequest }}</button>
      </div>
    </div>
  `,
})
export class BpmOverrunRequestComponent {
  readonly overrun = input.required<ProjectOverrun>();
  readonly busy = input(false);
  readonly decide = output<'approve' | 'refuse'>();
  protected readonly act = FUNDING_ACTIONS;
}

/** Demandes persistantes : le montant demandé est la nouvelle part totale de la tâche, pas un supplément. */
@Component({
  selector: 'bpm-task-requests',
  imports: [BpmAmount, CentsPipe, ShortDatePipe, BpmRouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bpm-request-list">
      @for (r of requests(); track r.id) {
        <article class="bpm-request" [attr.data-status]="r.status" [attr.aria-label]="'Demande de ' + r.taskTitle">
          <div>
            <h3>{{ r.taskTitle }}</h3>
            <p class="bpm-note"><a class="text-link" [routerLink]="['/app/gestion-projet', r.coreProjectId]" fragment="requests-title">{{ r.budgetName }} →</a> · demandé le {{ r.requestedAt | shortDate }}</p>
            @if (r.note) { <p>{{ r.note }}</p> }
          </div>
          <dl><div><dt>Montant total demandé</dt><dd [bpmAmount]="r.amountCents" bpmTone="warning">{{ r.amountCents | cents }}</dd></div><div><dt>{{ L.share }}</dt><dd [bpmAmount]="r.grantedCents" bpmTone="info">{{ r.grantedCents | cents }}</dd></div></dl>
          <div>
            <p class="bpm-note" role="status">{{ r.statusLabel }}</p>
            @if (r.status === 'pending') {
              <div class="bpm-actions">
                <button class="btn btn-primary" type="button" [disabled]="busy() || !funded()" (click)="decide.emit({ request: r, decision: 'approve' })">{{ act.grantShare(r.amountCents, r.taskTitle) }}</button>
                <button class="btn btn-secondary" type="button" [disabled]="busy()" (click)="decide.emit({ request: r, decision: 'refuse' })">{{ act.refuseRequest }}</button>
                <button class="text-link" type="button" [disabled]="busy()" (click)="decide.emit({ request: r, decision: 'cancel' })">Annuler la demande</button>
              </div>
              @if (!funded()) {
                <p class="bpm-note">Demande préparée. Attribuez d’abord une enveloppe au projet pour accorder cette part.</p>
              }
            } @else if (r.status === 'awaiting-life') {
              <p class="bpm-note">La part dépasse l’enveloppe : le dépassement attend l’accord du projet de vie (« Décisions attendues »). L’autorisation accorde la part si les autres parts n’ont pas changé ; sinon la demande revient au projet pour être réexaminée.</p>
              <a class="text-link" routerLink="/projet-de-vie" fragment="life-decisions">Ouvrir les décisions attendues →</a>
              <button class="text-link" type="button" [disabled]="busy()" (click)="decide.emit({ request: r, decision: 'cancel' })">Annuler la demande</button>
            }
          </div>
        </article>
      } @empty { <p class="bpm-note">Aucune demande de montant.</p> }
    </div>
  `,
})
export class BpmTaskRequestsComponent {
  protected readonly L = FUNDING;
  protected readonly act = FUNDING_ACTIONS;
  readonly requests = input.required<TaskBudgetRequest[]>();
  readonly busy = input(false);
  readonly funded = input(true);
  readonly decide = output<{ request: TaskBudgetRequest; decision: 'approve' | 'refuse' | 'cancel' }>();
}
