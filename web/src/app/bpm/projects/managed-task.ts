import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { newRequestKey } from '../../core/api.service';
import { BpmTaskCard, ProjectOverrun, TaskBudgetRequest } from '../../core/bpm-projects.models';
import { CentsPipe, parseAmount, ShortDatePipe } from '../../core/format';
import { COLUMNS, TaskStatus } from '../../core/models';
import { BpmProjectMetricsComponent } from './project-metrics';
import { BpmOverrunRequestComponent } from './project-parts';
import { FUNDING, FUNDING_ACTIONS } from '../ui/project-funding';

export interface TaskFundingSubmission {
  task: BpmTaskCard;
  amount: number;
  note: string;
  requestKey: string;
  onAccepted?: () => void;
}

@Component({
  selector: 'bpm-managed-task',
  imports: [
    FormsModule,
    RouterLink,
    CentsPipe,
    ShortDatePipe,
    BpmProjectMetricsComponent,
    BpmOverrunRequestComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let t = task();
    <article
      class="bpm-managed-task"
      [attr.data-status]="t.task.status"
      [attr.aria-label]="'Tâche ' + t.task.title"
    >
      <div class="pm-task-summary">
        <header class="pm-task-heading">
          <h4>
            <button type="button" class="text-link" [disabled]="busy()" (click)="edit.emit(t)">
              {{ t.task.title }}
            </button>
          </h4>
          @if (t.task.description) {
            <p class="bpm-note pm-task-description" [title]="t.task.description">
              {{ t.task.description }}
            </p>
          }
          <dl class="pm-task-dates">
            <div>
              <dt>Début</dt>
              <dd>{{ t.task.startDate ? (t.task.startDate | shortDate) : 'À définir' }}</dd>
            </div>
            <div>
              <dt>Échéance</dt>
              <dd>{{ t.task.dueDate ? (t.task.dueDate | shortDate) : 'À définir' }}</dd>
            </div>
          </dl>
        </header>
        <dl class="pm-task-cash">
          <div>
            <dt>{{ L.engaged }}</dt>
            <dd>{{ t.budget?.engagedCents ?? 0 | cents }}</dd>
          </div>
          <div>
            <dt>{{ L.sharePaid }}</dt>
            <dd>{{ t.budget?.paidCents ?? 0 | cents }}</dd>
          </div>
          <div>
            <dt>{{ L.shareRest }}</dt>
            <dd [class.is-deficit]="(t.budget?.remainingCents ?? 0) < 0">
              {{ t.budget?.remainingCents | cents }}
            </dd>
          </div>
        </dl>
      </div>
      <bpm-project-metrics [task]="t" [vertical]="true" />
      <aside
        class="pm-side-panel pm-task-sidebar"
        [attr.aria-label]="'Pilotage de ' + t.task.title"
      >
        <label class="pm-task-status" [attr.data-status]="t.task.status"
          >État
          <select
            [attr.aria-label]="'État de ' + t.task.title"
            [value]="t.task.status"
            [disabled]="busy()"
            (change)="status.emit({ task: t, status: $any($event.target).value })"
          >
            @for (c of columns; track c.id) {
              <option [value]="c.id" [selected]="t.task.status === c.id">{{ c.label }}</option>
            }
          </select>
        </label>
        <div class="bpm-actions pm-task-actions">
          <button
            class="btn btn-primary"
            type="button"
            [disabled]="busy() || !!t.budget?.request"
            [attr.aria-label]="'Demander un montant pour ' + t.task.title"
            [attr.aria-expanded]="requestOpen()"
            (click)="requestOpen.set(!requestOpen())"
          >
            Demander un montant
          </button>
          <button
            class="btn btn-secondary"
            type="button"
            [disabled]="busy()"
            (click)="edit.emit(t)"
          >
            Modifier
          </button>
          <button
            class="text-link"
            type="button"
            [disabled]="
              busy() ||
              t.budget?.shareCents !== null ||
              !!t.budget?.request ||
              (t.budget?.engagedCents ?? 0) > 0 ||
              !!t.budget?.return
            "
            (click)="detach.emit(t)"
          >
            Détacher
          </button>
        </div>
        @if (!funded()) {
          <p class="bpm-note pm-task-warning">
            Préparez la demande, puis <a class="text-link" [routerLink]="['/app/gestion-projet', t.task.projectId]" fragment="enveloppe">attribuez l’enveloppe du projet</a> pour pouvoir l’accorder.
          </p>
        }
      </aside>
      @if (requestOpen() && !t.budget?.request) {
        <form class="pm-task-funding-form" (ngSubmit)="submit()">
          <label
            >Montant total souhaité (€)<input
              name="amount"
              inputmode="decimal"
              [(ngModel)]="amount"
              required
          /></label>
          <label>Motif, facultatif<input name="note" maxlength="1000" [(ngModel)]="note" /></label>
          <p class="bpm-note">
            Part accordée : {{ t.budget?.shareCents | cents }}. Indiquez le nouveau montant total
            souhaité.
          </p>
          @if (error()) {
            <p class="bpm-feedback is-error" role="alert">{{ error() }}</p>
          }
          <div class="bpm-actions">
            <button type="submit" class="btn btn-primary" [disabled]="busy()">Envoyer</button
            ><button
              type="button"
              class="btn btn-secondary"
              [disabled]="busy()"
              (click)="requestOpen.set(false)"
            >
              Annuler
            </button>
          </div>
        </form>
      }
      @if (t.budget?.request; as r) {
        <div class="pm-task-decision" [attr.data-status]="r.status" role="status">
          <div>
            <strong>Demande : {{ r.amountCents | cents }}</strong>
            <p class="bpm-note">{{ r.statusLabel }}{{ r.note ? ' · ' + r.note : '' }}</p>
          </div>
          <div class="bpm-actions">
            @if (r.status === 'pending') {
              <button
                type="button"
                class="btn btn-primary"
                [disabled]="busy() || !funded()"
                (click)="decide.emit({ request: r, decision: 'approve' })"
              >
                {{ act.grantShare(r.amountCents, t.task.title) }}
              </button>
              <button
                type="button"
                class="btn btn-secondary"
                [disabled]="busy()"
                (click)="decide.emit({ request: r, decision: 'refuse' })"
              >
                {{ act.refuseRequest }}
              </button>
            }
            <button
              type="button"
              class="text-link"
              [disabled]="busy()"
              (click)="decide.emit({ request: r, decision: 'cancel' })"
            >
              Annuler la demande
            </button>
          </div>
        </div>
      }
      @if (overrun(); as o) {
        <div class="pm-task-parent-decision">
          <bpm-overrun-request
            [overrun]="o"
            [busy]="busy()"
            (decide)="decideOverrun.emit({ overrun: o, decision: $event })"
          />
        </div>
      }
    </article>
  `,
})
export class BpmManagedTaskComponent {
  readonly task = input.required<BpmTaskCard>();
  readonly funded = input(false);
  readonly busy = input(false);
  readonly overrun = input<ProjectOverrun | null>(null);
  readonly edit = output<BpmTaskCard>();
  readonly detach = output<BpmTaskCard>();
  readonly status = output<{ task: BpmTaskCard; status: TaskStatus }>();
  readonly request = output<TaskFundingSubmission>();
  readonly decide = output<{
    request: TaskBudgetRequest;
    decision: 'approve' | 'refuse' | 'cancel';
  }>();
  readonly decideOverrun = output<{ overrun: ProjectOverrun; decision: 'approve' | 'refuse' }>();
  protected columns = COLUMNS;
  protected readonly L = FUNDING;
  protected readonly act = FUNDING_ACTIONS;
  protected requestOpen = signal(false);
  protected error = signal('');
  protected amount = '';
  protected note = '';
  private keys = new Map<string, string>();
  constructor() {
    effect(() => {
      if (this.task().budget?.request) {
        this.requestOpen.set(false);
        this.keys.clear();
      }
    });
  }
  protected submit() {
    const amount = parseAmount(this.amount);
    if (amount === null || amount === 'invalid' || amount <= 0) {
      this.error.set('Indiquez le montant total souhaité en euros, avec deux décimales au plus.');
      return;
    }
    this.error.set('');
    const signature = JSON.stringify([amount, this.note]);
    const requestKey = this.keys.get(signature) ?? newRequestKey();
    this.keys.set(signature, requestKey);
    this.request.emit({
      task: this.task(),
      amount,
      note: this.note,
      requestKey,
      onAccepted: () => this.keys.delete(signature),
    });
  }
}
