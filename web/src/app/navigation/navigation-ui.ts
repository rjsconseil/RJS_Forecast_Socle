import { Directive, ElementRef, Pipe, PipeTransform, effect, inject, input } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { NavigationSystem } from './navigation.service';
import { NavigationSurface, effectiveStyle } from './navigation-model';
@Pipe({ name: 'navigationLabel', pure: false })
export class NavigationLabel implements PipeTransform {
  private readonly nav = inject(NavigationSystem);
  private readonly router = inject(Router);
  transform(fallback: string, key: string): string { return this.nav.label(key, fallback, this.router.url); }
}
/** Opt-in : seules les zones marquées reçoivent les variables et classes de navigation. */
@Directive({ selector: '[navigationSurface]', host: { class: 'navigation-system', '[attr.data-navigation-surface]': 'navigationSurface()' } })
export class NavigationSurfaceDirective {
  readonly navigationSurface = input<NavigationSurface>('primary');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly nav = inject(NavigationSystem);
  private readonly router = inject(Router);
  private readonly url = toSignal(this.router.events.pipe(filter(e => e instanceof NavigationEnd), map(e => e.urlAfterRedirects)), { initialValue: this.router.url });
  constructor() {
    effect(() => {
      const context = this.nav.catalog.context(this.url());
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
