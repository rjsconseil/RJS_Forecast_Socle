import { Directive, ElementRef, Pipe, PipeTransform, effect, inject, input } from '@angular/core';
import { NavigationSystem } from './navigation.service';
import { NavigationSurface, effectiveStyle } from './navigation-model';
@Pipe({ name: 'navigationLabel', pure: false })
export class NavigationLabel implements PipeTransform {
  private readonly nav = inject(NavigationSystem);
  transform(fallback: string, key: string): string { return this.nav.label(key, fallback, this.nav.url()); }
}
/** Opt-in : seules les zones marquées reçoivent les variables et classes de navigation. */
@Directive({ selector: '[navigationSurface]', host: { class: 'navigation-system', '[attr.data-navigation-surface]': 'navigationSurface()' } })
export class NavigationSurfaceDirective {
  readonly navigationSurface = input<NavigationSurface>('primary');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly nav = inject(NavigationSystem);
  constructor() {
    effect(() => {
      const context = this.nav.catalog.context(this.nav.url());
      for (const level of ['section', 'page', 'detail'] as const) {
        const style = effectiveStyle(this.nav.configuration(), context, this.navigationSurface(), level);
        for (const key of ['size', 'spacing', 'color', 'background', 'activeColor', 'activeBackground'] as const) {
          const property = '--navigation-' + level + '-' + key;
          const value = style[key];
          this.host.toggleAttribute('data-navigation-' + level + '-' + key, value !== undefined);
          if (value === undefined) this.host.style.setProperty(property, 'initial');
          else this.host.style.setProperty(property, String(value) + (['size', 'spacing'].includes(key) ? 'px' : ''));
        }
      }
    });
  }
}
