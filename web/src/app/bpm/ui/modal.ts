import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ModalComponent } from '../../shared/modal.component';
import { JourneyBar } from '../../plan/journey';

/** Une fenêtre BPM reste une étape du parcours, avec les mêmes retours que la page. */
@Component({
  selector: 'bpm-modal',
  imports: [ModalComponent, JourneyBar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <rjs-modal [open]="open()" [title]="title()" [busy]="busy()" [wide]="wide()" [headed]="headed()" (closed)="closed.emit()">
      <rjs-journey class="modal-journey" [compact]="true" [blocked]="busy()" />
      <ng-content />
    </rjs-modal>
  `,
  styles: `
    .modal-journey { display: block; position: sticky; top: 0; z-index: 3; background: var(--raised-surface, white); border-bottom: 1px solid var(--line); }
  `,
})
export class BpmModal {
  readonly open = input(false);
  readonly title = input.required<string>();
  readonly busy = input(false);
  readonly wide = input(false);
  readonly headed = input(false);
  readonly closed = output<void>();
}
