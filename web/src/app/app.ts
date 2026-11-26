import { NgComponentOutlet } from '@angular/common';
import { ResponsiveNavigationDirective } from './navigation/responsive-navigation';
import { NavigationLabel, NavigationSurfaceDirective } from './navigation/navigation-ui';
import { Journey, JourneyBar } from './plan/journey';
import { visitLabel } from './plan/journey-model';
import { ChangeDetectionStrategy, Component, computed, effect, HostListener, inject, OnInit, signal, Type, untracked, viewChild } from '@angular/core';
import { applicationOf } from './platform/applications';
import { Title } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { RecetteContext, toApiError, UserDirectory } from './core/api.service';
import { AccountChipComponent } from './shared/account-chip.component';
import { StickyPageHeroDirective } from './shared/sticky-page-hero.directive';
import { SectionPageMenu } from './plan/section-page-menu.component';
import { workspaceContextQuery } from './plan/page-workspace';
import { PageObjectLabels } from './plan/plan-context';
import { CommandPalette } from './plan/command-palette';
import { contextLinks } from './plan/quick-nav';
import { PinnedPages, ShellPreferences } from './plan/shell-preferences';
import {
  hasPageMenu,
  hasSectionHome,
  locate,
  menuPages,
  orderedZones,
  planContext,
  PLAN_OVERVIEW_TONE,
  PlanSection,
  PlanZone,
  sectionEntry,
  sectionHomeLink,
  zoneHomeLink,
  zoneSections,
  sectionMark,
} from './plan/site-plan';
import { planOrder } from './plan/plan-order';
import { NavigationSystem } from './navigation/navigation.service';

/**
 * Coquille du site de référence (`app.ts` de rjsconseil/rjs-forecast, `_shell.scss`, `_zones.scss`) :
 * barre latérale (marque, utilisateur connecté, identité de la zone, sections, pages de la section, bas du menu),
 * barre du haut (fil d'Ariane Accueil / zone / section / page, date, utilisateur), zone principale et pied de page.
 * Sous 820 px, le menu devient un popover natif ouvert par le bouton « Menu ».
 */
@Component({
  selector: 'app-root',
  imports: [NgComponentOutlet, NavigationLabel, NavigationSurfaceDirective, SectionPageMenu, JourneyBar, RouterOutlet, RouterLink, AccountChipComponent, ResponsiveNavigationDirective, StickyPageHeroDirective, CommandPalette],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
})
export class App implements OnInit {
  private readonly journey = inject(Journey);
  protected ctx = inject(RecetteContext);
  private directory = inject(UserDirectory);
  private router = inject(Router);
  private readonly title = inject(Title);
  protected users = this.directory.users;
  protected ready = signal(false);
  protected error = signal<string | null>(null);
  protected readonly zones = computed(() => orderedZones());
  protected readonly todayIso = new Date().toISOString().slice(0, 10);
  protected readonly todayLabel = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  protected readonly showBackToTop = signal(false);

  private readonly navigation = viewChild(ResponsiveNavigationDirective);

  protected url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((e) => (e as NavigationEnd).urlAfterRedirects),
    ),
    // Avant la première navigation, le routeur ne connaît que « / » : l'adresse du navigateur situe déjà la zone.
    { initialValue: this.router.navigated ? this.router.url : window.location.pathname + window.location.search },
  );
  private path = computed(() => this.url().split(/[?#]/)[0]);
  /** Où se trouve l'adresse courante dans le plan : zone, section, page. */
  protected location = computed(() => locate(this.url()));
  protected readonly isAstra = computed(() => this.location().zone?.id === 'bpm-astra');
  /** L'écran « choisir un profil » de l'application courante (point d'extension `profilePicker`), chargé à la demande. */
  protected readonly profilePicker = signal<Type<unknown> | null>(null);
  private readonly loadProfilePicker = effect(() => {
    const load = applicationOf(this.location().zone?.id)?.profilePicker;
    if (!load) { this.profilePicker.set(null); return; }
    void load().then((component) => this.profilePicker.set(component));
  });
  protected readonly astraReading = computed(() => {
    const { period } = workspaceContextQuery(this.url());
    return period ? { period } : {};
  });
  /** L'identité de couleur suit la zone et la nuance de l'espace courant (`_identities.scss`). */
  protected readonly workspaceIdentity = computed(() => {
    const { zone, section, page } = this.location();
    if (!zone) return { module: 'core', space: 'projects' };
    const first = section ?? zone.sections[0];
    return { module: zone.module ?? section?.module ?? zone.tone, space: page?.space ?? first?.space ?? 'projects' };
  });
  protected readonly isOverview = computed(() => {
    const { kind, page, section } = this.location();
    return kind === 'zone' || !!page?.overview || (kind === 'section' && section?.id === 'ensemble');
  });
  protected readonly sectionTone = computed(() => {
    const { section, page } = this.location();
    return page?.overview || !section ? PLAN_OVERVIEW_TONE : section.tone;
  });
  private readonly objectLabels = inject(PageObjectLabels);
  /** Le nom de l'objet ouvert (fiche projet) quand la page l'a publié. */
  protected readonly objectLabel = computed(() => this.objectLabels.labelFor(this.url()));
  /** Le fil d'Ariane suit le plan : zone, section, page, fiche, sous-page ; la lecture (période, filtres) suit les liens. */
  protected breadcrumb = computed(() =>
    planContext(this.url(), this.objectLabel()).crumbs.map((crumb) => ({
      ...crumb,
      navigationKey: crumb.label === this.location().zone?.label ? 'zone:' + this.location().zone!.id
        : crumb.label === this.location().section?.label ? 'section:' + this.location().zone!.id + ':' + this.location().section!.id
        : crumb.link ?? this.url(),
      query: crumb.link ? workspaceContextQuery(this.url(), crumb.link.startsWith('/zones/') ? '' : crumb.link) : null,
    })),
  );
  protected activeUser = computed(() => this.users().find((u) => u.id === this.ctx.userId()) ?? null);
  protected activeInitial = computed(() => this.activeUser()?.label.trim()[0]?.toUpperCase() ?? '·');
  /** Accueil, accueils de zone (hors BPM), utilisateurs, administration et Object Management restent consultables sans user. */
  protected needsUser = computed(() => !/^\/($|navigation|utilisateurs|app\/bienvenue|admin|object-management|zones(?!\/bpm(\/|$)))/.test(this.path()));

  protected readonly prefs = inject(ShellPreferences);
  protected readonly pinned = inject(PinnedPages);
  private readonly paletteView = viewChild<CommandPalette>('palette');
  protected openPalette(mode: 'go' | 'help' = 'go'): void {
    this.paletteView()?.open(mode);
  }
  /** Les épingles de l'utilisateur ; dans la zone affichée, elles gardent la période lue. */
  protected readonly pins = computed(() => {
    const url = this.url();
    const zone = this.location().zone?.id;
    const here = this.path().replace(/\/+$/, '') || '/';
    return this.pinned.pins().map((pin) => {
      const query = locate(pin.link).zone?.id === zone ? workspaceContextQuery(url) : {};
      return { ...pin, query: Object.keys(query).length ? query : null, current: pin.link === here };
    });
  });
  protected readonly isPinned = computed(() => this.pinned.has(this.url()));
  /** « Poursuivre » : page précédente, niveau supérieur, autres vues, page suivante — dans l'ordre du plan. */
  protected readonly dock = computed(() => {
    if (!this.ready() || !this.location().zone || (this.users().length === 0 && this.needsUser())) return [];
    const links = contextLinks(this.url(), this.objectLabel());
    const of = (kind: string, mark?: string) => links.filter((link) => link.kind === kind && (!mark || link.mark === mark));
    return [...of('sibling', '←'), ...of('up'), ...of('view').slice(0, 4), ...of('sibling', '→')];
  });

  private static readonly appearanceKey = 'rjs-forecast-appearance';
  // Le choix personnel du navigateur prime ; sinon la présentation classique.
  private readonly personalStyle = signal<'classic' | 'editorial' | null>(App.readVisualStyle());
  protected readonly visualStyle = computed(() => this.personalStyle() ?? 'classic');

  constructor() {
    // L'ordre des liens réglé dans Navigation system vaut pour toutes les listes que le plan projette.
    const navigationSystem = inject(NavigationSystem);
    effect(() => planOrder.set(navigationSystem.configuration().order ?? {}));
    // Une navigation referme le menu mobile.
    effect(() => {
      this.url();
      this.navigation()?.close();
    });
    // Une fiche ou un poste ouvert donne son nom à l'onglet du navigateur, comme au fil d'Ariane et au parcours.
    // L'effet passe après le titre de la route, posé à la fin de la navigation.
    effect(() => {
      const url = this.url();
      const name = this.objectLabel();
      if (name) untracked(() => this.title.setTitle(`${visitLabel(url, name)} — RJS Forecast`));
    });
    // Une fiche épinglée avant d'être nommée reprend son nom dès que la page le publie.
    effect(() => {
      const url = this.url();
      const name = this.objectLabel();
      const at = this.location();
      if (name && !at.subpage && (at.object || at.kind === 'detail')) untracked(() => this.pinned.rename(url, name));
    });
  }

  protected togglePin(): void {
    const context = planContext(this.url(), this.objectLabel());
    const { zone, section } = context.location;
    if (!zone) return;
    const hint = [zone.label, section && section.id !== 'ensemble' && section.label !== context.label ? section.label : null].filter(Boolean).join(' › ');
    this.pinned.toggle(this.url(), context.label ?? zone.label, hint);
  }

  /**
   * Raccourcis du cadre. ⌘K / Ctrl K ouvre la recherche partout ; les raccourcis à une touche
   * (désactivables dans l'aide) ne valent que hors d'un champ de saisie et d'une fenêtre ouverte.
   */
  @HostListener('document:keydown', ['$event'])
  protected shortcut(event: KeyboardEvent): void {
    const key = event.key?.toLowerCase();
    if (!key || event.defaultPrevented) return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && key === 'k') {
      event.preventDefault();
      this.paletteView()?.toggle();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('input, textarea, select, [contenteditable], [role="textbox"], [role="combobox"], [role="listbox"], [role="grid"]') || document.querySelector('dialog[open], [popover]:popover-open')) return;
    if (key === '/' || key === '?') {
      event.preventDefault();
      this.paletteView()?.open(key === '?' ? 'help' : 'go');
      return;
    }
    if (!this.prefs.singleKeys() || event.shiftKey || event.repeat) return;
    const url = this.url();
    const context = planContext(url, this.objectLabel());
    const go = (link: string | undefined, parent = link) => {
      if (!link) return;
      event.preventDefault();
      void this.router.navigate([link], { queryParams: workspaceContextQuery(url, parent ?? '') });
    };
    const tab = (offset: number) => {
      const index = context.tabs.findIndex((entry) => entry.current);
      go(index < 0 ? undefined : context.tabs[index + offset]?.link);
    };
    if (key === 'h') go(context.up?.link);
    else if (key === 'p') tab(-1);
    else if (key === 'n') tab(1);
    else if (key === 'j' || key === 'k') {
      // Étape suivante / précédente du parcours : les pages de la section, dans l'ordre du menu.
      const { section, page } = context.location;
      const pages = section ? menuPages(section).filter((entry) => !entry.zoneOverview) : [];
      const index = pages.findIndex((entry) => entry.link === page?.link);
      go(index < 0 ? undefined : pages[index + (key === 'j' ? 1 : -1)]?.link, '');
    } else if (key === 'g') {
      // Les gestes de l'onglet affiché (saisir, créer, régler), sinon ceux du premier onglet qui en porte.
      const more = document.querySelector<HTMLElement>('.page-tab-more.is-current') ?? document.querySelector<HTMLElement>('.page-tab-more');
      if (more) {
        event.preventDefault();
        more.click();
      }
    } else if (key === 'e' && context.location.zone) this.togglePin();
    else if (key === 'm') this.prefs.toggleFocus();
    else if (key === 'r') this.journey.back();
    else if (key === 's') this.journey.forward();
    else if (key === 'd') this.journey.toStart();
    else if (key === 'f') this.journey.resume();
    else if (/^[1-9]$/.test(key) && context.location.zone) {
      const section = this.visibleSections(context.location.zone)[Number(key) - 1];
      if (section) go(sectionEntry(context.location.zone, section).link, '');
    }
  }

  async ngOnInit() {
    try {
      const users = await this.directory.refresh();
      // Sans connexion mémorisée (ou user disparu), le site s'ouvre non connecté : seul « Démarrer un projet » est proposé.
      if (this.ctx.connected() && !users.some((u) => u.id === this.ctx.userId())) this.ctx.select(null);
      this.ready.set(true);
    } catch (err) {
      this.error.set(toApiError(err).message);
    }
  }

  protected zoneHome(zone: PlanZone) {
    return zoneHomeLink(zone);
  }
  protected sectionHomeOf(zone: PlanZone, section: PlanSection) {
    return sectionHomeLink(zone, section);
  }
  protected pageMenu(section: PlanSection) {
    return hasPageMenu(section);
  }
  protected sectionHome(section: PlanSection) {
    return hasSectionHome(section);
  }
  protected markOf = sectionMark;
  protected visibleSections(zone: PlanZone) {
    return zoneSections(zone, this.ctx.connected());
  }
  protected entryOf(zone: PlanZone, section: PlanSection) {
    return sectionEntry(zone, section);
  }
  protected visiblePages(section: PlanSection) {
    return menuPages(section);
  }

  choose(id: string) {
    this.ctx.select(id || null);
    // Le périmètre change : on revient à l'entrée de la section pour ne pas afficher un objet d'un autre user.
    const { zone, section } = this.location();
    const target = zone && section ? sectionEntry(zone, section).link : this.path();
    this.router.navigateByUrl(target).then(() => location.reload());
  }

  protected closeNavigationOnLink(event: Event): void {
    // Un clic de navigation ferme aussi le volet si l'adresse est déjà active ; les sélecteurs du bas restent utilisables.
    if ((event.target as Element).closest('a[href]')) this.navigation()?.close();
  }

  @HostListener('window:scroll')
  protected updateScrollPosition(): void {
    this.showBackToTop.set(window.scrollY > 600);
  }
  protected backToTop(): void {
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    document.querySelector<HTMLElement>('#main')?.focus({ preventScroll: true });
  }
  protected setVisualStyle(event: Event): void {
    const style = (event.target as HTMLSelectElement).value === 'editorial' ? 'editorial' : 'classic';
    this.personalStyle.set(style);
    try {
      localStorage.setItem(App.appearanceKey, style);
    } catch {
      // Le choix reste en mémoire pour cette session si le stockage est indisponible.
    }
  }
  private static readVisualStyle(): 'classic' | 'editorial' | null {
    try {
      const saved = localStorage.getItem(App.appearanceKey);
      return saved === 'editorial' || saved === 'classic' ? saved : null;
    } catch {
      return null;
    }
  }
}
