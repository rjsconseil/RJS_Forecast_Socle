import { Directive, Input, inject } from '@angular/core';
import { RouterLink, UrlTree } from '@angular/router';
import { BPM_PAGE_PATH } from './bpm-page-path';

/** Le routeur Angular garde les href, modificateurs clavier, paramètres, fragments et liens relatifs.
 * L'application hôte peut fournir une autre adresse pour les écrans métier qu'elle présente. */
@Directive({
  selector: '[routerLink]',
  hostDirectives: [{
    directive: RouterLink,
    inputs: ['target', 'queryParams', 'fragment', 'queryParamsHandling', 'state', 'info',
      'relativeTo', 'preserveFragment', 'skipLocationChange', 'replaceUrl', 'browserUrl'],
  }],
})
export class BpmRouterLink {
  private readonly path = inject(BPM_PAGE_PATH);
  private readonly link = inject(RouterLink);

  @Input() set routerLink(value: string | readonly unknown[] | UrlTree | null | undefined) {
    if (typeof value === 'string') {
      this.link.routerLink = this.path(value);
    } else if (Array.isArray(value) && typeof value[0] === 'string') {
      const first = this.path(value[0]);
      this.link.routerLink = first === value[0] ? value : [first, ...value.slice(1)];
    } else {
      this.link.routerLink = value;
    }
  }
}
