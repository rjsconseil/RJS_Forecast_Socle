import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { ApiError, toApiError } from '../../core/api.service';
import { BpmApi } from '../data/bpm-api.service';
import { RegisterLine } from '../data/bpm-models';
import { Settlement } from './settlement';

/**
 * Une échéance telle qu'une page l'affiche : la ligne complète du registre, ou sa forme allégée
 * (Gestion du projet de vie), dont la ligne complète est relue au moment du règlement.
 */
export type SettleableLine = Pick<RegisterLine, 'id' | 'label' | 'direction' | 'settled'> & { status: string; kind?: RegisterLine['kind'] };

/** Une échéance que l'on peut encore régler : une opération ou une occurrence prévue, due ou en retard. */
export const isSettleable = (line: SettleableLine) =>
  !line.settled && (line.kind === undefined || line.kind === 'operation' || line.kind === 'occurrence') && (line.status === 'due' || line.status === 'late' || line.status === 'pending');

/**
 * Cockpit : régler une échéance d'un geste, là où elle est affichée. Le règlement se fait à la date du
 * jour et au montant prévu, par le même service que la fiche détaillée (`Settlement`) : mêmes
 * vérifications de plafonds, même confirmation, mêmes refus. Pour une autre date ou un autre montant,
 * la fiche de l'échéance reste le lieu de la saisie (`detail`).
 */
@Component({
  selector: 'bpm-quick-settle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (done()) {
      <span class="qs-done" role="status">{{ income() ? 'Reçu' : 'Payé' }} ✓</span>
    } @else if (settleable()) {
      <button
        type="button"
        class="btn small"
        [class.btn-primary]="line().status !== 'pending' || !!confirmation()"
        [class.btn-secondary]="line().status === 'pending' && !confirmation()"
        [disabled]="busy()"
        [attr.aria-label]="(confirmation() ? 'Confirmer le règlement : ' : income() ? 'Marquer reçue aujourd’hui : ' : 'Marquer payée aujourd’hui : ') + line().label"
        title="Aujourd’hui, au montant prévu. Ouvrez la fiche pour une autre date ou un autre montant."
        (click)="settle($event)"
      >{{ busy() ? '…' : confirmation() ? 'Confirmer' : income() ? 'Reçu' : 'Payé' }}</button>
      @if (confirmation() && message(); as m) {
        <p class="qs-note" role="alert">{{ m }}</p>
      }
      @if (error(); as e) {
        <p class="qs-note is-error" role="alert">{{ e.message }} <button type="button" class="qs-link" (click)="open($event)">Ouvrir la fiche</button></p>
      }
    }
  `,
  styles: `
    :host { display: inline-flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; }
    :host:empty { display: none; }
    .btn { white-space: nowrap; }
    .qs-done { color: var(--status-success); font-size: 12px; font-weight: 700; white-space: nowrap; }
    .qs-note { flex: 1 1 100%; margin: 0; padding: 6px 8px; border-radius: 4px; background: var(--status-warning-surface); color: var(--status-warning); font-size: 12px; text-align: left; white-space: normal; }
    .qs-note.is-error { background: var(--status-danger-surface); color: var(--status-danger); }
    .qs-link { padding: 0; border: 0; background: none; color: inherit; font: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }
  `,
})
export class BpmQuickSettle {
  readonly line = input.required<SettleableLine>();
  /** Le règlement est enregistré. */
  readonly settled = output<SettleableLine>();
  /** La personne demande la fiche de l'échéance (autre date, autre montant, refus à résoudre). */
  readonly detail = output<SettleableLine>();
  private readonly bpm = inject(BpmApi);
  /** La ligne complète du registre, relue une fois pour une échéance allégée. */
  private full: RegisterLine | null = null;
  private readonly readError = signal<ApiError | null>(null);

  private readonly settlement = new Settlement(() => this.line().id);
  protected readonly busy = this.settlement.busy;
  protected readonly message = this.settlement.message;
  protected readonly error = computed(() => this.readError() ?? this.settlement.error());
  protected readonly confirmation = this.settlement.confirmation;
  protected readonly done = signal(false);
  protected readonly income = computed(() => this.line().direction === 'income');
  protected readonly settleable = computed(() => isSettleable(this.line()));

  protected async settle(event: Event) {
    event.stopPropagation();
    if (this.done()) return;
    const line = this.line();
    this.readError.set(null);
    try {
      this.full ??= line.kind ? (line as RegisterLine) : (await this.bpm.line(line.id)).line;
    } catch (e) {
      this.readError.set(toApiError(e));
      return;
    }
    // Une tâche peut choisir une autre destination ou un autre cycle : montrer l'imputation avant validation.
    if (this.full.budgetRole === 'standard' || this.full.projectCharge) {
      this.detail.emit(line);
      return;
    }
    if (!(await this.settlement.settle(this.full))) return;
    this.done.set(true);
    this.settled.emit(line);
  }
  protected open(event: Event) {
    event.stopPropagation();
    this.detail.emit(this.line());
  }
}
