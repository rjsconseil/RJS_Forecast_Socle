import { afterNextRender, Directive, ElementRef, inject } from '@angular/core';

/**
 * Promeut une fenêtre flottante au premier plan du navigateur (couche supérieure des popovers).
 * Elle garde sa place calculée, mais n'est plus coupée par un cadre arrondi ou défilant, ni recouverte
 * par un bandeau figé, une colonne voisine ou le menu : elle reste visible sur tous les bords.
 * Sous 900 px, l'aperçu se range dans la page : il n'est pas promu. Sans prise en charge, rien ne change.
 */
@Directive({ selector: '[rjsTopLayer]' })
export class TopLayerDirective {
  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      if (typeof element.showPopover !== 'function' || !element.isConnected || window.innerWidth <= 900) return;
      try {
        element.setAttribute('popover', 'manual');
        element.showPopover();
      } catch {
        element.removeAttribute('popover');
      }
    });
  }
}
