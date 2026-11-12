import { JourneyBar } from '../../plan/journey';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** Une seule convention d'enregistrement/annulation pour les formulaires BPM. */
@Component({
  selector: 'bpm-form-actions',
  imports: [JourneyBar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <rjs-journey [compact]="true" [blocked]="busy()" />
    <div class="bpm-actions">
      <button
        class="btn btn-primary"
        type="submit"
        [disabled]="busy() || !valid()"
        [attr.aria-busy]="busy()"
      >
        {{ busy() ? 'Enregistrement…' : label() }}
      </button>
      <button class="btn btn-secondary" type="button" [disabled]="busy()" (click)="cancel.emit()">
        {{ cancelLabel() }}
      </button>
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    :host-context(dialog) rjs-journey { display: none; }
    .bpm-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    button {
      min-height: 44px;
    }
  `,
})
export class BpmFormActions {
  readonly busy = input(false);
  readonly valid = input(true);
  readonly label = input('Enregistrer');
  readonly cancelLabel = input('Annuler');
  readonly cancel = output<void>();
}
