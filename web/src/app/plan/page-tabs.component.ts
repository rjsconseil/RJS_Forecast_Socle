import { NavigationLabel, NavigationSurfaceDirective } from '../navigation/navigation-ui';
import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { workspaceContextQuery } from './page-workspace';
import { PlanTab } from './site-plan';
import { PlanTabLink } from './tab-links';

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
          @if (tab.links.length) {
            <!-- Niveau vertical : les gestes de l'onglet, ouverts sous lui. -->
            <button type="button" class="page-tab-more" [class.is-current]="tab.current" aria-haspopup="true"
              [attr.aria-expanded]="opened() === tab.link" [attr.aria-label]="'Gestes de : ' + tab.label"
              [attr.title]="'Gestes de « ' + tab.label + ' »'" (click)="toggle(tab, $event)" (keydown.arrowdown)="toggle(tab, $event, true)"
              ><span aria-hidden="true">▾</span></button
            >
            <div class="page-tab-menu" popover="auto" [attr.data-tab]="tab.link" (toggle)="toggled(tab, $event)" (keydown)="move($event)">
              <p class="page-tab-menu-title">{{ tab.label | navigationLabel:tab.link }}</p>
              @for (link of tab.links; track link.key) {
                <a data-navigation-level="detail" class="page-tab-link" [routerLink]="tab.link" [queryParams]="linkQuery(tab, link)" (click)="close($event)"
                  ><span aria-hidden="true">＋</span>{{ link.label | navigationLabel:link.key }}</a
                >
              }
            </div>
          }
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
    /* Le chevron prolonge son onglet ; la liste s'ouvre dessous, au premier plan : la bande ne la rogne jamais. */
    .page-tab-more {
      display: inline-grid;
      place-items: center;
      align-self: center;
      flex: none;
      width: 24px;
      height: 28px;
      margin-inline-start: -4px;
      padding: 0;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 0.8rem;
      line-height: 1;
      opacity: 0.7;
      cursor: pointer;
      transition: opacity 160ms ease, background-color 160ms ease;
    }
    .page-tab-more span {
      display: inline-block;
      transition: transform 160ms ease;
    }
    .page-tab-more:hover,
    .page-tab-more:focus-visible,
    .page-tab-more[aria-expanded='true'] {
      opacity: 1;
      background: color-mix(in srgb, currentColor 14%, transparent);
    }
    .page-tab-more[aria-expanded='true'] span {
      transform: rotate(180deg);
    }
    .page-tab-more:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 2px;
    }
    .page-tab-menu {
      position: fixed;
      inset: auto;
      margin: 0;
      min-width: 220px;
      max-width: min(320px, calc(100vw - 24px));
      padding: 6px;
      border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
      border-radius: 12px;
      /* Mêmes couleurs propres que l'onglet courant : lisible sur un bandeau clair comme sombre. */
      background: var(--page-tab-current-bg, #fff);
      color: var(--page-tab-current-ink, #14213d);
      box-shadow: 0 14px 34px rgb(20 32 50 / 0.22);
    }
    .page-tab-menu:popover-open {
      display: grid;
      gap: 2px;
      animation: page-tab-menu-in 140ms ease-out;
    }
    @keyframes page-tab-menu-in {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: none; }
    }
    .page-tab-menu-title {
      margin: 0;
      padding: 4px 10px 6px;
      opacity: 0.66;
      font-size: 0.72rem;
      font-weight: 650;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .page-tab-link {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 36px;
      padding: 6px 10px;
      border-radius: 8px;
      color: inherit;
      font-size: 0.9rem;
      font-weight: 550;
      text-decoration: none;
    }
    .page-tab-link span {
      opacity: 0.6;
    }
    .page-tab-link:hover,
    .page-tab-link:focus-visible {
      background: color-mix(in srgb, currentColor 9%, transparent);
      outline: none;
    }
    @media (prefers-reduced-motion: reduce) {
      .page-tab-menu:popover-open { animation: none; }
      .page-tab-more span { transition: none; }
    }
    @media (max-width: 700px) {
      .page-tab-more { height: 36px; }
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
  /** L'onglet dont la liste verticale est ouverte. */
  protected readonly opened = signal<string | null>(null);
  private menu(tab: PlanTab) {
    return [...this.host.nativeElement.querySelectorAll<HTMLElement>('.page-tab-menu')].find(menu => menu.dataset['tab'] === tab.link) ?? null;
  }
  /** Ouvre la liste sous son chevron, ramenée dans l'écran ; au clavier, le premier geste prend la main. */
  protected toggle(tab: PlanTab, event: Event, focus = false) {
    event.preventDefault();
    const menu = this.menu(tab);
    if (!menu) return;
    if (menu.matches(':popover-open')) return menu.hidePopover();
    const caret = event.currentTarget as HTMLElement;
    const anchor = caret.getBoundingClientRect();
    // La liste s'aligne sur le début de son onglet, comme un prolongement vers le bas.
    const start = (caret.previousElementSibling as HTMLElement | null)?.getBoundingClientRect().left ?? anchor.left;
    menu.showPopover();
    const width = menu.offsetWidth;
    menu.style.top = `${Math.round(anchor.bottom + 6)}px`;
    menu.style.left = `${Math.round(Math.max(12, Math.min(start, window.innerWidth - width - 12)))}px`;
    if (focus || (event as MouseEvent).detail === 0) menu.querySelector<HTMLElement>('a')?.focus();
  }
  protected toggled(tab: PlanTab, event: Event) {
    const open = (event as ToggleEvent).newState === 'open';
    if (open) this.opened.set(tab.link);
    else if (this.opened() === tab.link) this.opened.set(null);
  }
  protected close(event: Event) {
    (event.currentTarget as HTMLElement).closest<HTMLElement>('.page-tab-menu')?.hidePopover();
  }
  /** Flèches haut et bas parcourent la liste verticale. */
  protected move(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const links = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('a')];
    const index = links.indexOf(document.activeElement as HTMLElement);
    links[(index + (event.key === 'ArrowDown' ? 1 : links.length - 1)) % links.length]?.focus();
  }
  /** Un geste s'ouvre sur son onglet, avec la lecture en cours (période, filtres). */
  protected linkQuery(tab: PlanTab, link: PlanTabLink) {
    return { ...this.query(tab), ...link.query };
  }
  /** Changer d'onglet garde la lecture (période, filtres), jamais une saisie ouverte. */
  protected query(tab: PlanTab) {
    return workspaceContextQuery(this.current(), tab.link);
  }
}
