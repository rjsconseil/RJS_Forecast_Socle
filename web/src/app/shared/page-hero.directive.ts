import { afterNextRender, DestroyRef, Directive, ElementRef, inject, Injector, signal } from '@angular/core';

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
  private readonly injector = inject(Injector);
  constructor() {
    afterNextRender(() => {
      const win = this.host.ownerDocument.defaultView;
      if (!win) return;
      let frame = 0;
      let expandedHeight = this.host.getBoundingClientRect().height;
      const update = () => {
        frame = 0;
        if (!this.compact()) expandedHeight = this.host.getBoundingClientRect().height;
        // La réduction retire de la hauteur au document. L'ancrage natif du navigateur compense
        // ce retrait : attendre d'avoir dépassé le cadre évite d'osciller entre les deux tailles.
        if (win.scrollY > Math.max(180, expandedHeight + 48)) this.compact.set(true);
        else if (win.scrollY < 32 && this.compact()) {
          this.compact.set(false);
          this.expanded.set(false);
          afterNextRender(() => win.scrollTo({ top: 0, behavior: 'instant' }), { injector: this.injector });
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
