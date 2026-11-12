import { Directive, ElementRef, inject, signal, DestroyRef } from '@angular/core';
/**
 * Un seul menu (directive `responsive-navigation` de la référence) : colonne sur grand écran,
 * popover natif sous 820 px (`$rupture-820` de `_shell.scss`). Le navigateur gère l'appui extérieur,
 * Échap et le retour au bouton ouvrant.
 */
@Directive({
  selector: '[rjsResponsiveNavigation]',
  exportAs: 'rjsNavigation',
  host: {
    '[attr.popover]': 'compact() ? "auto" : null',
    '(toggle)': 'onToggle($event)',
  },
})
export class ResponsiveNavigationDirective {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly media = typeof matchMedia === 'function' ? matchMedia('(max-width: 820px)') : null;
  readonly compact = signal(this.media?.matches ?? false);
  readonly opened = signal(false);

  constructor() {
    const resize = () => {
      // Fermer dans le mode précédent avant de retirer l'attribut popover.
      this.close();
      this.compact.set(this.media?.matches ?? false);
    };
    this.media?.addEventListener('change', resize);
    inject(DestroyRef).onDestroy(() => this.media?.removeEventListener('change', resize));
  }

  onToggle(event: Event): void {
    this.opened.set((event as ToggleEvent).newState === 'open');
  }

  close(): void {
    if (this.element.matches?.(':popover-open')) this.element.hidePopover();
    this.opened.set(false);
  }
}

