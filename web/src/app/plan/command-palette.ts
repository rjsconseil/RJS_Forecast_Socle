import { afterNextRender, ChangeDetectionStrategy, Component, computed, ElementRef, inject, Injector, signal, viewChild, ViewEncapsulation } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { RecetteContext } from '../core/api.service';
import { NavigationSystem } from '../navigation/navigation.service';
import { Journey } from './journey';
import { JourneyLevel, sameStep, visitLevel } from './journey-model';
import { PageObjectLabels } from './plan-context';
import { workspaceContextQuery } from './page-workspace';
import { contextActions, contextLinks, QUICK_GROUP_LABELS, QuickGroup, QuickLink, searchLinks, siteDestinations, uniqueLinks } from './quick-nav';
import { PinnedPages, ShellPreferences } from './shell-preferences';
import { locate, planContext } from './site-plan';

interface PaletteItem {
  order: number;
  link: QuickLink;
  label: string;
  level: JourneyLevel;
}
interface PaletteGroup {
  id: QuickGroup;
  label: string;
  items: PaletteItem[];
}
const RECENT_LIMIT = 6;
const SITE_LIMIT = 14;

/** Raccourcis du cadre, affichés dans l'aide (touche « ? »). */
export const SHELL_SHORTCUTS: { keys: string[]; label: string; single?: boolean }[] = [
  { keys: ['⌘ K', 'Ctrl K', '/'], label: 'Ouvrir la recherche et les accès rapides' },
  { keys: ['?'], label: 'Afficher cette aide' },
  { keys: ['H'], label: 'Remonter au niveau supérieur (page parente, fiche)', single: true },
  { keys: ['P', 'N'], label: 'Vue précédente / suivante de la page', single: true },
  { keys: ['J', 'K'], label: 'Étape suivante / précédente du parcours (pages de la section)', single: true },
  { keys: ['G'], label: 'Ouvrir les gestes de l’onglet : saisir, créer, régler', single: true },
  { keys: ['1', '…', '9'], label: 'Ouvrir la section n° de la zone', single: true },
  { keys: ['R', 'S'], label: 'Parcours : retour / suivant', single: true },
  { keys: ['D', 'F'], label: 'Parcours : revenir au début / reprendre au point d’arrêt', single: true },
  { keys: ['E'], label: 'Épingler ou désépingler la page', single: true },
  { keys: ['M'], label: 'Masquer ou afficher le menu', single: true },
];

/**
 * Palette de commandes : une seule entrée pour rejoindre n'importe quelle destination du plan, les
 * vues voisines, les pages épinglées, les étapes récentes du parcours et les actions utiles ici.
 * Tout vient du plan du site (`quick-nav.ts`) ; les libellés personnalisés du Navigation system
 * s'appliquent, et les liens de contexte gardent la période et les filtres lus.
 */
@Component({
  selector: 'rjs-command-palette',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Feuille globale chargée avec la palette : la fenêtre vit dans la couche supérieure du navigateur.
  encapsulation: ViewEncapsulation.None,
  styleUrl: './command-palette.scss',
  template: `
    <dialog #dialog class="quick-palette" aria-label="Recherche et accès rapides" (close)="closed()" (click)="backdrop($event)" (keydown)="key($event)">
      @if (opened()) {
        <div class="quick-box">
          <header class="quick-search">
            <span class="quick-search-icon" aria-hidden="true">⌕</span>
            <input
              #field
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls="quick-results"
              aria-autocomplete="list"
              aria-label="Rechercher une page, une vue ou une action"
              [attr.aria-activedescendant]="activeId()"
              autocomplete="off"
              spellcheck="false"
              placeholder="Aller à une page, une vue, une action…"
              [value]="text()"
              (input)="search($any($event.target).value)"
            />
            <button type="button" class="quick-key" (click)="close()" aria-label="Fermer">Échap</button>
          </header>
          @if (mode() === 'help') {
            <section class="quick-help" aria-label="Raccourcis clavier">
              <h2 class="quick-group">Raccourcis clavier</h2>
              <dl>
                @for (shortcut of shortcuts; track shortcut.label) {
                  <div [class.is-off]="shortcut.single && !prefs.singleKeys()">
                    <dt>@for (k of shortcut.keys; track k) { <kbd>{{ k }}</kbd> }</dt>
                    <dd>{{ shortcut.label }}</dd>
                  </div>
                }
              </dl>
              <div class="quick-settings">
                <label><input type="checkbox" [checked]="prefs.singleKeys()" (change)="prefs.setSingleKeys($any($event.target).checked)" /> Raccourcis à une touche (hors des champs de saisie)</label>
                <label><input type="checkbox" [checked]="prefs.density() === 'compact'" (change)="prefs.setDensity($any($event.target).checked ? 'compact' : 'comfortable')" /> Affichage dense</label>
              </div>
              <button type="button" class="quick-back" (click)="mode.set('go')"><span aria-hidden="true">←</span> Revenir aux accès rapides</button>
            </section>
          } @else {
            <div id="quick-results" class="quick-results" role="listbox" aria-label="Résultats">
              @for (group of groups(); track group.id) {
                <section role="group" [attr.aria-label]="group.label">
                  <h2 class="quick-group">
                    {{ group.label }}
                    @if (group.id === 'context' && here()) { <small>· {{ here() }}</small> }
                  </h2>
                  @for (item of group.items; track item.link.id) {
                    <a
                      role="option"
                      class="quick-item"
                      [id]="'quick-item-' + item.order"
                      [attr.data-navigation-level]="item.level"
                      [attr.data-kind]="item.link.kind"
                      [attr.data-tone]="item.link.tone ?? null"
                      [class.is-active]="item.order === active()"
                      [attr.aria-selected]="item.order === active()"
                      [routerLink]="item.link.link"
                      [queryParams]="item.link.query ?? null"
                      (click)="follow($event, item)"
                      (mousemove)="active.set(item.order)"
                    >
                      <span class="quick-mark" aria-hidden="true">{{ item.link.mark }}</span>
                      <span class="quick-text"><strong>{{ item.label }}</strong><small>{{ item.link.hint }}</small></span>
                      @if (item.link.carries) { <span class="quick-carry" title="La période et les filtres affichés suivent ce lien">même lecture</span> }
                      <span class="quick-enter" aria-hidden="true">↵</span>
                    </a>
                  }
                </section>
              } @empty {
                <p class="quick-empty">Aucune destination pour « {{ text() }} ». Essayez un autre mot : le nom d’une page, d’une zone ou d’une action.</p>
              }
            </div>
          }
          <footer class="quick-foot">
            <span><kbd>↑</kbd><kbd>↓</kbd> parcourir</span>
            <span><kbd>↵</kbd> ouvrir</span>
            <button type="button" (click)="mode.set(mode() === 'help' ? 'go' : 'help')"><kbd>?</kbd> {{ mode() === 'help' ? 'accès rapides' : 'raccourcis et affichage' }}</button>
          </footer>
        </div>
      }
    </dialog>
  `,
})
export class CommandPalette {
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly nav = inject(NavigationSystem);
  private readonly journey = inject(Journey);
  private readonly pinned = inject(PinnedPages);
  private readonly connected = inject(RecetteContext).connected;
  private readonly objectLabels = inject(PageObjectLabels);
  protected readonly prefs = inject(ShellPreferences);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  readonly opened = signal(false);
  protected readonly mode = signal<'go' | 'help'>('go');
  protected readonly text = signal('');
  protected readonly active = signal(0);
  protected readonly shortcuts = SHELL_SHORTCUTS;
  private readonly url = this.nav.url;

  private readonly objectLabel = computed(() => this.objectLabels.labelFor(this.url()));
  /** Où l'on se trouve, rappelé en tête des liens de contexte. */
  protected readonly here = computed(() => planContext(this.url(), this.objectLabel()).label);

  private readonly pinnedLinks = computed<QuickLink[]>(() => {
    const zone = locate(this.url()).zone?.id;
    return this.pinned.pins().map((pin) => {
      const target = locate(pin.link);
      // La période lue n'accompagne une épingle que dans la même zone, où elle a un sens.
      const query = target.zone?.id === zone ? workspaceContextQuery(this.url()) : {};
      return {
        id: 'pin:' + pin.link, group: 'pinned', kind: 'pinned', label: pin.label, hint: pin.hint, link: pin.link,
        query: Object.keys(query).length ? query : null, carries: Object.keys(query).length > 0,
        mark: '★', tone: target.page?.tone ?? target.section?.tone ?? target.zone?.tone, zone: target.zone?.id,
      } satisfies QuickLink;
    });
  });
  private readonly recentLinks = computed<QuickLink[]>(() => {
    const seen = new Set<string>();
    const here = this.url();
    return this.journey
      .visits()
      .map((visit, index) => ({ visit, index }))
      .reverse()
      .filter(({ visit }) => !sameStep(visit.url, here) && !seen.has(visit.url) && !!seen.add(visit.url))
      .slice(0, RECENT_LIMIT)
      .map(({ visit, index }) => {
        const at = locate(visit.url);
        const [path, search = ''] = visit.url.split('#')[0].split('?');
        const query = Object.fromEntries(new URLSearchParams(search));
        return {
          id: 'recent:' + visit.id, group: 'recent', kind: 'recent', label: visit.label, hint: `Étape ${index + 1} de mon parcours · ${at.zone?.label ?? ''}`,
          link: path, query: Object.keys(query).length ? query : null, mark: at.zone?.acronym ?? '↺', tone: at.zone?.tone, zone: at.zone?.id, journeyIndex: index,
        } satisfies QuickLink;
      });
  });

  protected readonly groups = computed<PaletteGroup[]>(() => {
    const url = this.url();
    const text = this.text();
    const zone = locate(url).zone?.id ?? null;
    const typed = text.trim().length > 0;
    const near = [
      ...contextLinks(url, this.objectLabel()),
      ...contextActions(url, this.connected(), this.objectLabel()),
      ...this.pinnedLinks(),
      ...this.recentLinks(),
    ];
    // Dans la zone où l'on se trouve, une destination du plan garde la période lue ; ailleurs elle n'a pas de sens.
    const reading = workspaceContextQuery(url);
    const keeps = Object.keys(reading).length > 0;
    const site = typed
      ? siteDestinations(this.connected()).map((link) => (keeps && zone && link.zone === zone && link.kind !== 'zone' && link.kind !== 'section' ? { ...link, query: reading, carries: true } : link))
      : [];
    const found = uniqueLinks(searchLinks([...near, ...site], text, zone));
    const groups: PaletteGroup[] = [];
    let order = 0;
    for (const id of ['context', 'action', 'pinned', 'recent', 'site'] as const) {
      const links = found.filter((link) => link.group === id).slice(0, id === 'site' ? SITE_LIMIT : undefined);
      if (!links.length) continue;
      groups.push({
        id,
        label: QUICK_GROUP_LABELS[id],
        items: links.map((link) => ({
          order: order++,
          link,
          label: link.navigationKey ? this.nav.label(link.navigationKey, link.label, url) : link.label,
          level: link.kind === 'recent' ? visitLevel(link.link) : link.kind === 'zone' || link.kind === 'section' ? 'section' : link.kind === 'page' || link.kind === 'pinned' || link.kind === 'sibling' || link.kind === 'up' ? 'page' : 'detail',
        })),
      });
    }
    return groups;
  });
  private readonly items = computed(() => this.groups().flatMap((group) => group.items));
  protected readonly activeId = computed(() => (this.items().length ? 'quick-item-' + Math.min(this.active(), this.items().length - 1) : null));

  open(mode: 'go' | 'help' = 'go') {
    this.mode.set(mode);
    this.text.set('');
    this.active.set(0);
    this.opened.set(true);
    const dialog = this.dialog().nativeElement;
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    afterNextRender(() => this.field()?.nativeElement.focus(), { injector: this.injector });
  }
  close() {
    const dialog = this.dialog().nativeElement;
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    this.opened.set(false);
  }
  toggle() {
    if (this.opened()) this.close();
    else this.open();
  }

  protected closed() {
    this.opened.set(false);
  }
  protected backdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) this.close();
  }
  protected search(value: string) {
    this.text.set(value);
    this.active.set(0);
    if (this.mode() === 'help' && value) this.mode.set('go');
  }
  protected key(event: KeyboardEvent) {
    if (this.mode() === 'help') return;
    const count = this.items().length;
    const move = (to: number) => {
      event.preventDefault();
      if (!count) return;
      this.active.set((to + count) % count);
      queueMicrotask(() => document.getElementById('quick-item-' + this.active())?.scrollIntoView({ block: 'nearest' }));
    };
    if (event.key === 'ArrowDown') move(Math.min(this.active(), count - 1) + 1);
    else if (event.key === 'ArrowUp') move(Math.min(this.active(), count - 1) - 1);
    else if (event.key === 'Home' && !this.text()) move(0);
    else if (event.key === 'End' && !this.text()) move(count - 1);
    else if (event.key === 'Enter') {
      event.preventDefault();
      const item = this.items()[Math.min(this.active(), count - 1)];
      if (item) this.run(item, event.metaKey || event.ctrlKey);
    } else if (event.key === '?' && !this.text()) {
      event.preventDefault();
      this.mode.set('help');
    }
  }
  /** Un clic simple suit le lien dans l'application ; avec une touche de modification, le navigateur ouvre un onglet. */
  protected follow(event: MouseEvent, item: PaletteItem) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (item.link.journeyIndex !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      this.journey.jump(item.link.journeyIndex);
      return;
    }
    this.close();
  }
  private run(item: PaletteItem, newTab: boolean) {
    const tree = this.router.createUrlTree([item.link.link], { queryParams: item.link.query ?? undefined });
    this.close();
    if (newTab) window.open(this.router.serializeUrl(tree), '_blank', 'noopener');
    else if (item.link.journeyIndex !== undefined) this.journey.jump(item.link.journeyIndex);
    else void this.router.navigateByUrl(tree);
  }
}
