import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';

@Component({
  selector: 'rjs-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<dialog
    #dialog
    class="modal"
    [class.bulk-import-modal]="wide()"
    [attr.aria-label]="title()"
    (cancel)="cancel($event)"
    (click)="backdrop($event)"
  >
    @if (headed()) {
      <header class="modal-head">
        <h2>{{ title() }}</h2>
      </header>
    }
    <ng-content />
  </dialog>`,
})
export class ModalComponent {
  readonly open = input(false);
  readonly title = input.required<string>();
  readonly busy = input(false);
  readonly wide = input(false);
  /** Titre standard optionnel ; les anciens consommateurs gardent leur en-tête projeté. */
  readonly headed = input(false);
  readonly closed = output<void>();
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  constructor() {
    effect(() => {
      const dialog = this.dialog()?.nativeElement;
      if (!dialog) return;
      // Les environnements sans fenêtre modale native (tests jsdom) gardent l'attribut `open`.
      if (this.open() && !dialog.open) {
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      } else if (!this.open() && dialog.open) {
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      }
    });
  }
  protected cancel(event: Event) {
    event.preventDefault();
    if (!this.busy()) this.closed.emit();
  }
  protected backdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) this.cancel(event);
  }
}
