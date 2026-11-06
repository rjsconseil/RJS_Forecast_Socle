import { afterNextRender, DestroyRef, Directive, ElementRef, inject, signal } from '@angular/core';

/**
 * Cadre de taille fixe : signale quand son contenu dépasse (`overflowing()`, classe `is-overflowing`).
 * La carte garde sa taille quel que soit le contenu ; la page propose alors « Afficher la suite ».
 */
@Directive({
  selector: '[bpmOverflow]',
  exportAs: 'bpmOverflow',
  host: { '[class.is-overflowing]': 'overflowing()' },
})
export class BpmOverflowDirective {
  readonly overflowing = signal(false);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const el = this.el.nativeElement;
      const check = () => this.overflowing.set(el.scrollHeight > el.clientHeight + 1);
      check();
      const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
      resize?.observe(el);
      const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(check);
      mutation?.observe(el, { childList: true, subtree: true, characterData: true });
      this.destroyRef.onDestroy(() => {
        resize?.disconnect();
        mutation?.disconnect();
      });
    });
  }
}
