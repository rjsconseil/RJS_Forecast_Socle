import { PAGE_GUIDANCE } from '../shared/page-guidance';
import { PAGE_TABS_STYLES } from './page-tabs.styles';
import { navigationNumber } from '../navigation/navigation-engine';
import { NavigationSystem } from '../navigation/navigation.service';
import { effectiveContentMenu } from '../navigation/navigation-model';
import { ContentSections } from '../navigation/content-sections.service';
import { NavigationLabel, NavigationSurfaceDirective } from '../navigation/navigation-ui';
import {
  afterRenderEffect,
  DestroyRef,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  signal,
} from '@angular/core';
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
    @if (tabs().length) {
      <nav navigationSurface="secondary" class="page-tabs" [attr.aria-label]="label()">
        @for (tab of tabs(); track tab.link; let first = $first) {
          <span
            class="page-tab-group"
            (mouseenter)="hover(tab, first, $event)"
            (mouseleave)="scheduleClose(first ? tab : null)"
            (keydown.escape)="sectionOpen.set(null)"
          >
            <a
              data-navigation-level="detail"
              class="page-tab"
              [routerLink]="tab.link"
              [queryParams]="query(tab)"
              [class.is-current]="tab.current"
              (click)="first && tab.current && tab.links.length ? toggle(tab, $event) : null"
              [attr.aria-current]="tab.current ? 'page' : null"
              >{{ tab.label | navigationLabel: (first ? tab.link + '#main' : tab.link) }}</a
            >
            @if (first && tab.links.length) {
              <!-- Niveau vertical : les gestes de l'onglet, ouverts sous lui. -->
              <button
                type="button"
                class="page-tab-more"
                [class.is-current]="tab.current"
                aria-haspopup="true"
                [attr.aria-expanded]="opened() === tab.link"
                [attr.aria-label]="'Gestes de : ' + tab.label"
                [attr.title]="'Gestes de « ' + tab.label + ' »'"
                (click)="toggle(tab, $event)"
                (keydown.arrowdown)="toggle(tab, $event, true)"
              >
                <span aria-hidden="true">▾</span>
              </button>
              <div
                navigationSurface="actions"
                class="page-tab-menu"
                popover="auto"
                [attr.data-tab]="tab.link"
                (toggle)="toggled(tab, $event)"
                (keydown)="move($event)"
              >
                <p class="page-tab-menu-title">
                  {{ tab.label | navigationLabel: (first ? tab.link + '#main' : tab.link) }}
                </p>
                @for (link of tab.links; track link.key) {
                  <a
                    data-navigation-level="detail"
                    class="page-tab-link"
                    [routerLink]="
                      link.link ?? tab.link
                    "
                    [queryParams]="linkQuery(tab, link)"
                    (click)="close($event)"
                    ><span aria-hidden="true">＋</span
                    >{{ link.label | navigationLabel: link.key }}</a
                  >
                }
              </div>
            }
            @if (!first && sections.of(tab.link)?.length) {
              <button
                type="button"
                class="page-tab-more"
                [attr.aria-expanded]="sectionOpen() === tab.link"
                [attr.aria-label]="'Sections de contenu : ' + tab.label"
                (click)="
                  sectionOpen() === tab.link ? sectionOpen.set(null) : openSections(tab, $event)
                "
              >
                ⌄
              </button>
              @if (sectionOpen() === tab.link) {
                <div
                  navigationSurface="contents"
                  [style.width.px]="menuOptions().width"
                  class="content-section-menu"
                  (mouseenter)="cancelClose()"
                  (focusout)="leaveSections($event)"
                >
                  <span class="page-tab-menu-title">Sections de contenu</span>
                  @for (section of sections.of(tab.link); track section.id; let i = $index) {
                    <a
                      data-navigation-level="content"
                      class="page-tab-link"
                      [class.is-current]="tab.current && currentSection() === section.id"
                      [routerLink]="tab.link"
                      [queryParams]="query(tab)"
                      [fragment]="section.id"
                      (click)="jump(section.id)"
                      >@if (numbered()) {<b class="section-number">{{ number(i) }}</b>}{{ section.label | navigationLabel: tab.link + '#' + section.id }}</a
                    >
                  }
                </div>
              }
            }
          </span>
        }
      </nav>
    }
      @if (band(); as b) {
        <!-- N7 : le titre de la section courante, sous le cadre ; le contenu défile dessous. -->
        <div class="section-band" data-navigation-level="content" role="navigation" aria-label="Sections de la sous-page">
          @if (guided && b.entries.length > 1) {
            <label class="guided-section-picker">
              <span>Dans cette page</span>
              <select (change)="jump($any($event.target).value)">
                @for (entry of b.entries; track entry.id; let i = $index) {
                  <option [value]="entry.id" [selected]="i === b.index">{{ entry.label }}</option>
                }
              </select>
            </label>
          } @else {
          <span class="band-mark" aria-hidden="true">{{ numbered() ? number(b.index) : "§" }}</span>
          <span class="band-title" aria-live="polite">{{ b.label }}</span>
          <span class="band-dots">
            @for (entry of b.entries; track entry.id; let i = $index) {
              <button
                type="button"
                [class.is-current]="i === b.index"
                [class.is-past]="i < b.index"
                [attr.aria-label]="entry.label"
                [attr.title]="entry.label"
                (click)="jump(entry.id)"
              ></button>
            }
          </span>
          }
          <span class="band-count">{{ b.index + 1 }} / {{ b.entries.length }}</span>
          <button type="button" class="band-step" aria-label="Section précédente" [disabled]="b.index === 0" (click)="jump(b.entries[b.index - 1].id)">↑</button>
          <button type="button" class="band-step" aria-label="Section suivante" [disabled]="b.index === b.entries.length - 1" (click)="jump(b.entries[b.index + 1].id)">↓</button>
        </div>
      }
  `,
  styles: PAGE_TABS_STYLES,
})
export class PageTabs {
  protected readonly guided = inject(PAGE_GUIDANCE, { optional: true });
  readonly tabs = input.required<PlanTab[]>();
  readonly url = input.required<string>();
  readonly label = input('Vues de cette page');
  private readonly current = computed(() => this.url());
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly navigation = inject(NavigationSystem);
  protected readonly menuOptions = computed(() =>
    effectiveContentMenu(
      this.navigation.configuration(),
      this.navigation.catalog.context(this.url()),
    ),
  );
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  protected cancelClose() {
    clearTimeout(this.closeTimer);
  }
  protected scheduleClose(home: PlanTab | null = null) {
    this.cancelClose();
    this.closeTimer = setTimeout(() => {
      this.sectionOpen.set(null);
      if (home && this.hoveredHome === home) {
        this.menu(home)?.hidePopover();
        this.hoveredHome = null;
      }
    }, this.menuOptions().closeDelay);
  }
  /** Une seule mécanique de survol : l'accueil déroule ses actions, les autres onglets leurs sections. */
  protected hover(tab: PlanTab, home: boolean, event: Event) {
    this.cancelClose();
    if (home) {
      if (tab.links.length && this.menuOptions().homeTrigger === 'hover') this.openHome(tab, event);
      return;
    }
    if (this.menuOptions().trigger === 'hover') this.openSections(tab, event);
  }
  private hoveredHome: PlanTab | null = null;
  private openHome(tab: PlanTab, event: Event) {
    const menu = this.menu(tab);
    if (!menu || menu.matches(':popover-open')) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menu.showPopover();
    menu.style.top = `${Math.round(box.bottom + 6)}px`;
    menu.style.left = `${Math.round(Math.max(12, Math.min(box.left, window.innerWidth - menu.offsetWidth - 12)))}px`;
    this.hoveredHome = tab;
  }
  protected readonly numbered = computed(() => this.menuOptions().numbers === 'on');
  protected number(index: number) {
    return navigationNumber(index);
  }
  /** La section lue : la dernière dont le titre a passé le bas du cadre collant. */
  protected readonly currentSection = signal<string | null>(null);
  private readonly path = computed(() => this.url().split(/[?#]/)[0]);
  protected readonly band = computed(() => {
    if (this.menuOptions().band !== 'on') return null;
    const entries = this.sections.of(this.path()).filter((entry) => entry.id !== 'contenu-principal');
    if (!entries.length || (!this.tabs().length && (!this.guided || entries.length < 2))) return null;
    const index = Math.max(0, entries.findIndex((entry) => entry.id === this.currentSection()));
    return { entries, index, label: entries[index].label };
  });
  /** Le bas du cadre collant (bandeau de page) : la ligne sous laquelle le contenu défile. */
  private frameBottom() {
    const frame = this.host.nativeElement.closest<HTMLElement>('[data-sticky-hero]') ?? this.host.nativeElement;
    if (['sticky', 'fixed'].includes(getComputedStyle(frame).position)) return frame.getBoundingClientRect().bottom;
    return parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  }
  private spyLock = 0;
  private spy() {
    if (performance.now() < this.spyLock) return;
    const entries = this.band()?.entries;
    if (!entries) return;
    const line = this.frameBottom() + 16;
    let current = entries[0].id;
    for (const entry of entries) {
      const element = document.getElementById(entry.id);
      if (element && element.getBoundingClientRect().top <= line) current = entry.id;
    }
    const doc = document.documentElement;
    if (window.scrollY > 0 && window.innerHeight + window.scrollY >= doc.scrollHeight - 4) current = entries[entries.length - 1].id;
    this.currentSection.set(current);
  }
  protected readonly sections = inject(ContentSections);
  protected readonly sectionOpen = signal<string | null>(null);
  protected openSections(tab: PlanTab, event: Event) {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.host.nativeElement.style.setProperty('--section-menu-top', box.bottom + 'px');
    this.host.nativeElement.style.setProperty(
      '--section-menu-left',
      Math.max(8, Math.min(box.left, window.innerWidth - this.menuOptions().width - 12)) + 'px',
    );
    this.sectionOpen.set(tab.link);
  }
  protected leaveSections(event: FocusEvent) {
    if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node))
      this.sectionOpen.set(null);
  }
  protected jump(id: string) {
    this.sectionOpen.set(null);
    const target = document.getElementById(id);
    for (let node = target; node; node = node.parentElement) {
      if (node.tagName === 'DETAILS') (node as HTMLDetailsElement).open = true;
    }
    if (!target) return;
    this.currentSection.set(id);
    this.spyLock = performance.now() + 500;
    const align = () => {
      const delta = target.getBoundingClientRect().top - (this.frameBottom() + 12);
      if (Math.abs(delta) > 2) window.scrollTo({ top: window.scrollY + delta, behavior: 'instant' });
    };
    align();
    // Le bandeau se compacte pendant le trajet : un second alignement tient compte de sa hauteur finale.
    setTimeout(align, 260);
    target.focus({ preventScroll: true });
  }
  constructor() {
    const destroy = inject(DestroyRef);
    let timer: ReturnType<typeof setTimeout>;
    const scan = () => {
      const path = this.url().split(/[?#]/)[0];
      const main = this.host.nativeElement.closest('main');
      if (!main) return;
      const heading = main.querySelector<HTMLElement>('h1');
      if (heading && !main.querySelector('#contenu-principal')) {
        const marker = document.createElement('span');
        marker.id = 'contenu-principal';
        marker.tabIndex = -1;
        heading.after(marker);
      }
      const headings = [...main.querySelectorAll<HTMLElement>('h2')].filter(
        // `data-nav-skip` : un bloc dont les titres ne sont pas des sections (cartes, aperçus).
        (h) => !h.closest('rjs-page-banner, rjs-page-tabs, [role="dialog"], bpm-modal, .modal, [data-nav-skip]'),
      );
      const seen = new Set<string>();
      const entries = headings.flatMap((h, index) => {
        const label = h.textContent?.trim().replace(/\s+/g, ' ');
        if (!label || h.closest('[hidden], [role="status"], [role="alert"]')) return [];
        if (!h.id)
          h.id =
            'contenu-' +
            label
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '') +
            '-' +
            index;
        if (seen.has(h.id)) return [];
        seen.add(h.id);
        // Le décalage des barres fixes est déjà porté par le scroll-padding du document.
        h.style.scrollMarginTop = '16px';
        h.tabIndex = -1;
        return [{ id: h.id, label }];
      });
      this.sections.publish(
        path,
        entries.length
          ? entries
          : [{ id: 'contenu-principal', label: 'Vue d’ensemble du contenu' }],
      );
      let fragment = this.url().split('#')[1] ?? '';
      try {
        fragment = decodeURIComponent(fragment);
      } catch {
        /* Une ancre mal encodée ne bloque pas le rendu. */
      }
      if (
        fragment &&
        fragment !== handled &&
        (fragment === 'contenu-principal' || entries.some((e) => e.id === fragment))
      ) {
        handled = fragment;
        this.jump(fragment);
      }
      if (!fragment) handled = '';
    };
    let handled = '';
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(scan, 80);
    });
    afterRenderEffect(() => {
      this.url();
      const main = this.host.nativeElement.closest('main');
      if (main) {
        observer.disconnect();
        observer.observe(main, { childList: true, subtree: true, characterData: true });
        scan();
      }
    });
    let frame = 0;
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; this.spy(); });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    afterRenderEffect(() => {
      this.band();
      onScroll();
    });
    destroy.onDestroy(() => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
      observer.disconnect();
      clearTimeout(timer);
      this.cancelClose();
    });
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
    return (
      [...this.host.nativeElement.querySelectorAll<HTMLElement>('.page-tab-menu')].find(
        (menu) => menu.dataset['tab'] === tab.link,
      ) ?? null
    );
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
    const start =
      (caret.previousElementSibling as HTMLElement | null)?.getBoundingClientRect().left ??
      anchor.left;
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
    const context = link.link ? workspaceContextQuery(this.current(), link.link) : this.query(tab);
    return { ...context, ...link.query };
  }
  /** Changer d'onglet garde la lecture (période, filtres), jamais une saisie ouverte. */
  protected query(tab: PlanTab) {
    return workspaceContextQuery(this.current(), tab.link);
  }
}
