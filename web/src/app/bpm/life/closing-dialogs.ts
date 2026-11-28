import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { toApiError } from '../../core/api.service';

import { BpmApi } from '../data/bpm-api.service';
import { ClosingPoint } from '../data/bpm-closing.models';
import { ProjectOverrun, TaskBudgetRequest } from '../data/bpm-projects.models';
import { BpmOverrunRequestComponent, BpmTaskRequestsComponent } from '../projects/project-parts';
import { bpmLoader, BpmState, ProjectFunding } from '../ui';
import { BpmCapDialog } from '../ui/cap-dialog';
import { BpmModal } from '../ui/modal';

/** Les fenêtres « Régler le problème » prennent la présentation de la fiche d'échéance (`bpm-line-detail`). */
const DIALOG_STYLES = ['../ref-styles/bpm-context.scss', '../ref-styles/bpm-pages.scss', '../ui/line-detail.scss'];

/**
 * « Régler le problème » d'une décision de financement, en fenêtre : la carte de décision que montrent le projet et la
 * Gestion du projet de vie (`bpm-overrun-request`, `bpm-task-requests`), avec les mêmes gestes (`ProjectFunding`).
 */
@Component({
  selector: 'bpm-closing-decision',
  imports: [BpmModal, BpmState, BpmOverrunRequestComponent, BpmTaskRequestsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: DIALOG_STYLES,
  template: `
    <bpm-modal [open]="true" [headed]="true" [title]="point().label" [busy]="busy()" (closed)="closed.emit()">
      <div class="bpm-guide">
        <bpm-state [loading]="read.loading() && !read.data()" [error]="read.error()" (retry)="read.reload()" />
        @if (error(); as e) { <p class="bpm-error" role="alert">{{ e }}</p> }
        @if (read.data(); as d) {
          <header><small>Décision de financement · projet « {{ point().project?.name }} »</small></header>
          @if (overrun(); as o) {
            <bpm-overrun-request [overrun]="o" [busy]="busy()" (decide)="decideOverrun(o, $event)" />
          } @else if (request(); as r) {
            <bpm-task-requests [requests]="[r]" [funded]="!!d.budget?.regime" [busy]="busy()" (decide)="decideRequest($event)" />
          } @else {
            <p class="bld-saved" role="status">Cette décision n’est plus en attente : elle a déjà été prise.</p>
          }
          <p class="bpm-help">La décision s’enregistre comme depuis le projet ; le point se clôt aussitôt dans « À valider avant la clôture ».</p>
        }
      </div>
    </bpm-modal>
  `,
})
export class BpmClosingDecision {
  private readonly bpm = inject(BpmApi);
  private readonly funding = inject(ProjectFunding);
  readonly point = input.required<ClosingPoint>();
  readonly closed = output<void>();
  /** Décision prise : son message de résultat, le même que sur les pages du projet. */
  readonly done = output<string>();
  protected readonly read = bpmLoader(() => this.point().project?.coreProjectId ?? null, (id) => (id ? this.bpm.projectDetail(id) : Promise.resolve(null)));
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly overrun = computed(() => {
    const p = this.point();
    return p.decisionKind === 'overrun' ? this.read.data()?.overruns.find((o) => o.id === p.decisionId && o.status === 'pending') ?? null : null;
  });
  protected readonly request = computed(() => {
    const p = this.point();
    return p.decisionKind === 'request' ? this.read.data()?.requests.find((r) => r.id === p.decisionId && (r.status === 'pending' || r.status === 'awaiting-life')) ?? null : null;
  });

  protected decideOverrun(o: ProjectOverrun, decision: 'approve' | 'refuse') {
    return this.run(() => this.funding.decide(o, decision));
  }
  protected decideRequest(e: { request: TaskBudgetRequest; decision: 'approve' | 'refuse' | 'cancel' }) {
    return this.run(() => this.funding.decideTaskRequest(e.request, e.decision, this.read.data()?.budget?.revision));
  }
  private async run(act: () => Promise<{ message: string }>) {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.done.emit((await act()).message);
    } catch (err) {
      this.error.set(toApiError(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}

/**
 * « Régler le problème » d'un poste au-delà de son plafond : la fenêtre du plafond de la page Plafonds (`bpm-cap-dialog`),
 * lue sur le cycle de la clôture. Plusieurs postes en cause : la fenêtre propose de choisir le poste.
 */
@Component({
  selector: 'bpm-closing-cap',
  imports: [BpmModal, BpmState, BpmCapDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: DIALOG_STYLES,
  template: `
    @if (read.data(); as v) {
      <bpm-cap-dialog [centers]="centers()" [initialRef]="refs()[0] ?? null" [choose]="centers().length > 1" [revision]="v.lifeBudget.revision" [levels]="v.levels"
        [periodLabel]="v.context.period?.label ?? 'ce cycle'" (closed)="closed.emit()" (saved)="saved.emit($event)" />
    } @else {
      <bpm-modal [open]="true" [headed]="true" title="Plafond du poste" (closed)="closed.emit()">
        <div class="bpm-guide"><bpm-state [loading]="read.loading()" [error]="read.error()" (retry)="read.reload()" /></div>
      </bpm-modal>
    }
  `,
})
export class BpmClosingCap {
  private readonly bpm = inject(BpmApi);
  /** Postes en cause, celui à ouvrir d'abord. */
  readonly refs = input.required<string[]>();
  readonly periodKey = input.required<string>();
  readonly closed = output<void>();
  readonly saved = output<string>();
  protected readonly read = bpmLoader(() => this.periodKey(), (period) => this.bpm.spendingCaps(period));
  protected readonly centers = computed(() => {
    const refs = new Set(this.refs());
    return (this.read.data()?.centers ?? []).filter((c) => refs.has(c.ref));
  });
}
