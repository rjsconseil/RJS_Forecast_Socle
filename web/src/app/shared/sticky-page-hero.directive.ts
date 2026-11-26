import { afterNextRender, DestroyRef, Directive, ElementRef, inject } from '@angular/core';

/** Les éléments qui défilent avec la page ne masquent pas l'arrivée d'une ancre. */
function pinnedHeight(element: HTMLElement | null): number {
  if (!element || !['sticky', 'fixed'].includes(getComputedStyle(element).position)) return 0;
  return element.getBoundingClientRect().height;
}

/** Hauteur réellement fixe : barre de site sur ordinateur, barre Menu en portrait. */
export function pageTopOffset(): number {
  const bar = document.querySelector<HTMLElement>('.topbar');
  const mobile = document.querySelector<HTMLElement>('.sidebar-mobile-head');
  const base = pinnedHeight(bar) || (mobile?.getBoundingClientRect().height ? pinnedHeight(mobile.closest('.sidebar')) : 0);
  const navigation = document.querySelector<HTMLElement>('main > rjs-journey');
  return base + pinnedHeight(navigation);
}

/** Un seul bandeau fixé par page ; les mesures suivent le zoom, les outils et la barre du site. */
@Directive({ selector: '[rjsStickyPageHero]' })
export class StickyPageHeroDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly destroy = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const main = this.host.querySelector('main');
      const topbar = this.host.querySelector<HTMLElement>('.topbar');
      // Les environnements de test sans ResizeObserver (jsdom) gardent un bandeau non figé.
      if (!main || typeof ResizeObserver === 'undefined') return;
      let hero: HTMLElement | null = null;
      let navigation: HTMLElement | null = null;
      let frame = 0;
      const measure = () => {
        const top = pageTopOffset();
        this.host.style.setProperty('--page-top-offset', `${top}px`);
        this.host.style.setProperty('--bpm-routebar-top', `${top - pinnedHeight(navigation)}px`);
        const height = pinnedHeight(hero);
        // Scroll-padding belongs to the document scrollport, not to a second scrolling page.
        document.documentElement.style.scrollPaddingTop = `${top + height}px`;
      };
      const resize = new ResizeObserver(measure);
      if (topbar) resize.observe(topbar);
      const sidebar = this.host.querySelector('.sidebar');
      if (sidebar) resize.observe(sidebar);
      const sync = () => {
        frame = 0;
        const routebar = main.querySelector<HTMLElement>(':scope > rjs-journey');
        if (routebar !== navigation) {
          if (navigation) resize.unobserve(navigation);
          navigation = routebar;
          if (navigation) resize.observe(navigation);
        }
        const next = main.querySelector<HTMLElement>('[data-page-hero], rjs-app-hero, [data-ui-pattern~="heading"], .page-head, .pilotage-intro, .fm-hero, .cfg-hero, .page-heading, .reset-hero, .documentation-hero, .audit-header, .plan-heading, .budget-section-head:has(h1)');
        if (next !== hero) {
          if (hero) { resize.unobserve(hero); hero.removeAttribute('data-sticky-hero'); }
          hero = next;
          if (hero) { hero.setAttribute('data-sticky-hero', ''); resize.observe(hero); }
        }
        measure();
      };
      const mutation = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(sync); });
      mutation.observe(main, { childList: true, subtree: true });
      window.addEventListener('resize', measure);
      sync();
      this.destroy.onDestroy(() => {
        mutation.disconnect(); resize.disconnect(); cancelAnimationFrame(frame);
        window.removeEventListener('resize', measure);
        hero?.removeAttribute('data-sticky-hero');
        document.documentElement.style.removeProperty('scroll-padding-top');
      });
    });
  }
}
