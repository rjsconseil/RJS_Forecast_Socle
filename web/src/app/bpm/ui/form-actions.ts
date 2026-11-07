import { BpmNavigationComponent } from './navigation';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** Une seule convention d'enregistrement/annulation pour les formulaires BPM. */
@Component({
  selector: 'bpm-form-actions',
  imports: [BpmNavigationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bpm-navigation [compact]="true" [blocked]="busy()" />
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
    /* Dans une fenêtre, « Annuler » la referme : le parcours (quitter la page) reste dans la barre du haut. */
    :host-context(dialog) bpm-navigation,
    :host-context([role='dialog']) bpm-navigation {
      display: none;
    }
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
