import { NavigationLabel, NavigationSurfaceDirective } from '../navigation/navigation-ui';
import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, ElementRef, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { workspaceContextQuery } from './page-workspace';
import { PlanTab } from './site-plan';

/**
 * Les onglets du bandeau : la vue principale de la page et ses sous-pages, avec les libellés du
 * menu latéral. L'onglet courant est celui de l'adresse ; la période et les filtres de lecture suivent.
 */
@Component({
  selector: 'rjs-page-tabs',
  imports: [NavigationLabel, NavigationSurfaceDirective, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'rjs-page-tabs' },
  template: `
    @if (tabs().length > 1) {
      <nav navigationSurface="secondary" class="page-tabs" [attr.aria-label]="label()">
        @for (tab of tabs(); track tab.link; let first = $first) {
          <a
            [attr.data-navigation-level]="first ? 'page' : 'detail'" class="page-tab"
            [routerLink]="tab.link"
            [queryParams]="query(tab)"
            [class.is-current]="tab.current"
            [attr.aria-current]="tab.current ? 'page' : null"
            >{{ tab.label | navigationLabel:tab.link }}</a
          >
        }
      </nav>
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
      grid-column: 1 / -1;
    }
    .page-tabs {
      position: relative;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 10px 0 2px;
      padding: 4px;
      border-radius: 12px;
      background: color-mix(in srgb, currentColor 7%, transparent);
      width: fit-content;
      max-width: 100%;
    }
    .page-tab {
      display: inline-flex;
      align-items: center;
      min-height: 36px;
      padding: 6px 14px;
      border-radius: 9px;
      color: inherit;
      font-weight: 600;
      font-size: 0.92rem;
      text-decoration: none;
      opacity: 0.82;
      white-space: nowrap;
      transition: opacity 160ms ease, background-color 160ms ease, box-shadow 240ms ease;
    }
    .page-tab:hover,
    .page-tab:focus-visible {
      opacity: 1;
      background: color-mix(in srgb, currentColor 10%, transparent);
    }
    /* Couleurs propres : les bandeaux sombres redéfinissent --ink en blanc, l'onglet courant doit rester lisible partout. */
    .page-tab.is-current {
      opacity: 1;
      background: var(--page-tab-current-bg, #fff);
      color: var(--page-tab-current-ink, #14213d);
      box-shadow: 0 1px 2px rgb(0 0 0 / 0.2), 0 8px 18px -8px rgb(0 0 0 / 0.45);
    }
    @media (max-width: 700px) {
      .page-tabs {
        flex-wrap: nowrap;
        overflow-x: auto;
        width: 100%;
      }
    }
  `,
})
export class PageTabs {
  readonly tabs = input.required<PlanTab[]>();
  readonly url = input.required<string>();
  readonly label = input('Vues de cette page');
  private readonly current = computed(() => this.url());
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // Sur un écran étroit, la bande défile : l'onglet de la page affichée reste visible.
    afterRenderEffect(() => {
      this.tabs();
      this.url();
      const nav = this.host.nativeElement.querySelector<HTMLElement>('.page-tabs');
      const tab = nav?.querySelector<HTMLElement>('.page-tab.is-current');
      if (nav && tab && nav.scrollWidth > nav.clientWidth)
        nav.scrollLeft = Math.max(0, tab.offsetLeft - (nav.clientWidth - tab.offsetWidth) / 2);
    });
  }
  /** Changer d'onglet garde la lecture (période, filtres), jamais une saisie ouverte. */
  protected query(tab: PlanTab) {
    return workspaceContextQuery(this.current(), tab.link);
  }
}
