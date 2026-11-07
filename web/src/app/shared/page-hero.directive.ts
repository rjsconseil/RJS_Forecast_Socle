import { afterNextRender, DestroyRef, Directive, ElementRef, inject, signal } from '@angular/core';

/** Comportement de travail commun à tous les bandeaux, indépendant du domaine métier. */
@Directive({
  selector: '[rjsPageHero]',
  exportAs: 'pageHero',
  host: {
    'data-sticky-hero': '',
    'data-page-hero': '',
    '[class.page-hero-compact]': 'compact() && !expanded()',
  },
})
export class PageHeroDirective {
  readonly compact = signal(false);
  readonly expanded = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly destroy = inject(DestroyRef);
  constructor() {
    afterNextRender(() => {
      const win = this.host.ownerDocument.defaultView;
      if (!win) return;
      let frame = 0;
      const update = () => {
        frame = 0;
        if (win.scrollY > 180) this.compact.set(true);
        else if (win.scrollY < 32) {
          this.compact.set(false);
          this.expanded.set(false);
        }
      };
      const scroll = () => {
        if (!frame) frame = win.requestAnimationFrame(update);
      };
      win.addEventListener('scroll', scroll, { passive: true });
      update();
      this.destroy.onDestroy(() => {
        win.removeEventListener('scroll', scroll);
        win.cancelAnimationFrame(frame);
      });
    });
  }
}
