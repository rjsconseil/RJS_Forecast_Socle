import { ResponsiveNavigationDirective } from './navigation/responsive-navigation';
import { NavigationLabel, NavigationSurfaceDirective } from './navigation/navigation-ui';
import { Journey, JourneyBar } from './plan/journey';
import { visitLabel } from './plan/journey-model';
import { ChangeDetectionStrategy, Component, computed, effect, HostListener, inject, OnInit, signal, untracked, viewChild } from '@angular/core';
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
import {
  hasPageMenu,
  hasSectionHome,
  locate,
  menuPages,
  planContext,
  PLAN_OVERVIEW_TONE,
  PLAN_ZONES,
  PlanSection,
  PlanZone,
  sectionEntry,
  sectionHomeLink,
  zoneHomeLink,
  zoneSections,
} from './plan/site-plan';

/**
 * Coquille du site de référence (`app.ts` de rjsconseil/rjs-forecast, `_shell.scss`, `_zones.scss`) :
 * barre latérale (marque, utilisateur connecté, identité de la zone, sections, pages de la section, bas du menu),
 * barre du haut (fil d'Ariane Accueil / zone / section / page, date, utilisateur), zone principale et pied de page.
 * Sous 820 px, le menu devient un popover natif ouvert par le bouton « Menu ».
 */
@Component({
  selector: 'app-root',
  imports: [NavigationLabel, NavigationSurfaceDirective, SectionPageMenu, JourneyBar, RouterOutlet, RouterLink, AccountChipComponent, ResponsiveNavigationDirective, StickyPageHeroDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip-link" href="#main">Aller au contenu</a>
    <div
      class="app-shell"
      rjsStickyPageHero
      [class.editorial-style]="visualStyle() === 'editorial'"
      [attr.data-module]="workspaceIdentity().module"
      [attr.data-space]="workspaceIdentity().space"
      [attr.data-section-tone]="sectionTone()"
      [attr.data-overview]="isOverview() ? 'true' : null"
      [attr.data-page-tone]="location().page?.tone ?? location().section?.homeTone ?? null"
    >
      <aside navigationSurface="primary" class="sidebar" aria-label="Navigation de RJS Forecast">
        <div class="sidebar-mobile-head">
          <a class="mobile-brand" routerLink="/" aria-label="Accueil RJS Forecast">R<span>.</span> <small>FORECAST</small></a>
          @if (location().zone; as zone) {
            <span class="mobile-zone" [attr.data-tone]="zone.tone"
              ><span class="zone-mark" aria-hidden="true">{{ zone.acronym }}</span>{{ location().section?.label ?? zone.label }}</span
            >
          }
          <button class="mobile-nav-toggle" type="button" popovertarget="workspace-navigation" aria-controls="workspace-navigation" [attr.aria-expanded]="navigation.opened()">
            <span aria-hidden="true">☰</span> Menu
          </button>
        </div>
        <a class="brand" routerLink="/" aria-label="Accueil RJS Forecast — toutes les zones"
          ><span class="brand-mark">R<span>.</span></span
          ><span class="brand-name">RJS <strong>Forecast</strong><small>ZONES DE TRAVAIL</small></span></a
        >
        <div
          id="workspace-navigation"
          class="sidebar-navigation"
          rjsResponsiveNavigation
          #navigation="rjsNavigation"
          tabindex="-1"
          aria-label="Choisir une section ou une page"
          (click)="closeNavigationOnLink($event)"
        >
          <div class="navigation-drawer-head">
            <strong>Votre navigation</strong>
            <button type="button" popovertarget="workspace-navigation" popovertargetaction="hide">Fermer <span aria-hidden="true">×</span></button>
          </div>
          <!-- Même identité sur bureau et dans le menu mobile, sans répétition au-dessus de la page. -->
          <rjs-account-chip class="sidebar-account" variant="sidebar" [label]="activeUser()?.label ?? null" [typeLabel]="activeUser()?.userTypeLabel ?? ''" />
          @if (location().zone; as zone) {
            <div class="zone-identity" [attr.data-tone]="zone.tone">
              <a data-navigation-level="section" class="zone-identity-head" [routerLink]="zoneHome(zone)" [attr.title]="zone.mission"
                ><span class="zone-mark" aria-hidden="true">{{ zone.acronym }}</span
                ><span
                  ><small>{{ zone.eyebrow }}</small><strong>{{ zone.label | navigationLabel:("zone:" + zone.id) }}</strong></span
                ></a
              >
              <a class="zone-identity-switch" routerLink="/">Changer de zone <span aria-hidden="true">↗</span></a>
            </div>
            <div class="nav-label">Sections de la zone</div>
            <nav class="section-switch" [attr.aria-label]="'Sections de ' + zone.label">
              @for (section of visibleSections(zone); track section.id) {
                @let entry = entryOf(zone, section);
                @let current = location().section?.id === section.id;
                <a
                  data-navigation-level="section" class="section-switch-entry"
                  [attr.data-tone]="section.tone ?? zone.tone"
                  [routerLink]="entry.link"
                  [queryParams]="entry.query"
                  [class.active]="current"
                  [attr.aria-current]="current ? 'true' : null"
                  ><span class="section-mark" aria-hidden="true">{{ section.acronym }}</span
                  ><span class="section-switch-text"
                    ><strong>{{ section.label | navigationLabel:("section:" + zone.id + ":" + section.id) }}</strong><small>{{ section.intention }}</small></span
                  >
                  @if (current) {
                    <span class="section-selected" aria-hidden="true">✓</span>
                  }
                </a>
              }
            </nav>
            @if (location().section; as section) {
              @if (pageMenu(section)) {
                <div class="nav-label">{{ section.label | navigationLabel:("section:" + zone.id + ":" + section.id) }}</div>
                <nav class="section-pages" [attr.aria-label]="'Pages de ' + section.label">
                  @if (sectionHome(section)) {
                    <a
                      [attr.data-page-tone]="section.homeTone"
                      [routerLink]="sectionHomeOf(zone, section)"
                      [class.active]="location().kind === 'section'"
                      [attr.aria-current]="location().kind === 'section' ? 'page' : null"
                      ><span class="nav-icon" aria-hidden="true">⌂</span><span>Accueil de la section</span></a
                    >
                  }
                  <rjs-section-page-menu [section]="section" [url]="url()" [objectLabel]="objectLabel()" />
                </nav>
              }
            }
          } @else {
            <div class="nav-label">Zones principales</div>
            @if (location().kind === 'portal') {
              <ul class="portal-zone-labels" aria-label="Zones principales">
                @for (zone of zones; track zone.id) {
                  <li><a data-navigation-level="section" [routerLink]="zoneHome(zone)">{{ zone.label | navigationLabel:("zone:" + zone.id) }}</a></li>
                }
              </ul>
            } @else {
              <nav class="section-switch zone-switch" aria-label="Zones principales">
                @for (zone of zones; track zone.id) {
                  <a data-navigation-level="section" class="section-switch-entry" [attr.data-tone]="zone.tone" [routerLink]="zoneHome(zone)"
                    ><span class="section-mark" aria-hidden="true">{{ zone.acronym }}</span
                    ><span class="section-switch-text"
                      ><strong>{{ zone.label | navigationLabel:("zone:" + zone.id) }}</strong><small>{{ visibleSections(zone).length }} sections</small></span
                    ></a
                  >
                }
              </nav>
            }
          }

          <!-- Dans une zone, un accès direct aux autres modules ; sur le portail, la liste des zones suffit. -->
          @if (location().zone) {
          <details class="navigation-module-switcher">
            <summary>Tous les modules</summary>
            <nav aria-label="Accès à tous les modules">
              @for (zone of zones; track zone.id) {
                <a data-navigation-level="section" [routerLink]="zoneHome(zone)" [attr.aria-current]="location().zone?.id === zone.id ? 'true' : null">{{ zone.label | navigationLabel:("zone:" + zone.id) }}</a>
              }
            </nav>
          </details>
          }
          <a class="navigation-settings-link" data-navigation-level="detail" routerLink="/navigation"><span aria-hidden="true">⚙</span> {{ "Réglages de navigation" | navigationLabel:"/navigation" }}</a>
          <div class="sidebar-tools">
            <div class="profile-switcher" aria-label="Utilisateur connecté" role="group">
              <span class="profile-switcher-mark" aria-hidden="true">{{ activeInitial() }}</span>
              <div>
                @if (activeUser(); as user) {
                  <strong>{{ user.label }}</strong>
                  <small>{{ user.userTypeLabel }}</small>
                  <a routerLink="/utilisateurs">Changer d’utilisateur</a>
                } @else if (users().length === 0 && ready()) {
                  <strong>Aucun utilisateur</strong>
                  <small>Créez le premier pour ouvrir les modules métier.</small>
                  <a routerLink="/utilisateurs">Créer le premier utilisateur</a>
                } @else if (error()) {
                  <strong>Utilisateurs illisibles</strong>
                  <small>{{ error() }}</small>
                } @else if (!ready()) {
                  <strong>Utilisateur</strong>
                  <small>Lecture des utilisateurs…</small>
                } @else {
                  <strong>Aucun utilisateur choisi</strong>
                  <small>Choisissez qui travaille.</small>
                  <a routerLink="/utilisateurs">Choisir un utilisateur</a>
                }
              </div>
            </div>
            <label class="appearance-picker">
              <span>Utilisateur actif</span>
              <select aria-label="Utilisateur actif" (change)="choose($any($event.target).value)" [disabled]="!users().length">
                <option value="" [selected]="!ctx.connected()">Non connecté</option>
                @for (u of users(); track u.id) {
                  <option [value]="u.id" [selected]="u.id === ctx.userId()">{{ u.label }} · {{ u.userTypeLabel }}</option>
                }
              </select>
            </label>
            <label class="appearance-picker">
              <span>Style de l’interface</span>
              <select aria-label="Style de l’interface" [value]="visualStyle()" (change)="setVisualStyle($event)">
                <option value="classic">Classique</option>
                <option value="editorial">Sombre éditorial</option>
              </select>
            </label>
            <div class="sidebar-bottom">
              <span class="local-indicator"></span>
              <div><strong>Espace local</strong><small>Enregistré sur cet ordinateur</small></div>
            </div>
          </div>
        </div>
      </aside>

      <div class="main-shell">
        <header class="topbar">
          <nav navigationSurface="tertiary" class="topbar-context" aria-label="Fil d’Ariane">
            <span class="topbar-square" aria-hidden="true"></span>
            <a data-navigation-level="section" routerLink="/">{{ "Accueil" | navigationLabel:"/" }}</a>
            @for (crumb of breadcrumb(); track $index) {
              <span class="topbar-separator" aria-hidden="true">/</span>
              @if (crumb.link) {
                <a [routerLink]="crumb.link" [queryParams]="crumb.query ?? null" [attr.data-navigation-level]="crumb.link.startsWith('/zones/') ? 'section' : 'page'">{{ crumb.label | navigationLabel:crumb.navigationKey }}</a>
              } @else {
                <span data-navigation-level="detail" class="topbar-current" aria-current="page" [attr.title]="crumb.label | navigationLabel:crumb.navigationKey">{{ crumb.label | navigationLabel:crumb.navigationKey }}</span>
              }
            }
          </nav>
          <div class="topbar-actions">
            <time class="topbar-date" [attr.datetime]="todayIso">{{ todayLabel }}</time>
            <a class="topbar-home" routerLink="/">RJS Forecast</a>
            <!-- En haut à droite, comme d'usage : l'utilisateur connecté, accueil compris. -->
            <rjs-account-chip class="topbar-account" variant="topbar" [label]="activeUser()?.label ?? null" [typeLabel]="activeUser()?.userTypeLabel ?? ''" />
          </div>
        </header>

        @if (location().zone?.band === 'assembled' || location().zone?.id === 'noyau') {
          <div class="recette-banner">Environnement de recette — données fictives. Les interfaces middleware servent aux tests ; les actions métier passent par Budget/Patrimoine Management.</div>
        }
        @if (error()) {
          <div class="error-bar" role="alert">
            <span>{{ error() }}</span><button type="button" aria-label="Masquer le message" (click)="error.set(null)">×</button>
          </div>
        }

        <main id="main" tabindex="-1">
          @if (ready()) {
            @if (users().length === 0 && needsUser()) {
              <div class="page plan-page">
                <section class="plan-empty" data-ui-pattern="empty">
                  <h1>Bienvenue</h1>
                  <p>Aucun utilisateur pour l’instant. Démarrez votre projet de vie : votre profil, son budget et son patrimoine seront créés en même temps.</p>
                  <a class="plan-action" routerLink="/creer">Démarrer un projet <span aria-hidden="true">→</span></a>
                </section>
              </div>
            } @else {
              <!-- Le parcours (Retour / Mon parcours / Suivant) structure toutes les zones du plan, pas seulement BPM. -->
              @if (location().zone) { <rjs-journey /> }
              <router-outlet />
            }
          } @else if (!error()) {
            <div class="page"><p class="muted">Chargement…</p></div>
          }
        </main>
        @if (showBackToTop()) {
          <button class="back-to-top" type="button" (click)="backToTop()" aria-label="Revenir en haut de la page">↑ <span>Haut de page</span></button>
        }
        <footer class="main-footer">
          <span>RJS Forecast · Budget/Patrimoine Management</span><span>Données locales · montants en euros</span>
        </footer>
      </div>
    </div>
  `,
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
  protected readonly zones = PLAN_ZONES;
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

  private static readonly appearanceKey = 'rjs-forecast-appearance';
  // Le choix personnel du navigateur prime ; sinon la présentation classique.
  private readonly personalStyle = signal<'classic' | 'editorial' | null>(App.readVisualStyle());
  protected readonly visualStyle = computed(() => this.personalStyle() ?? 'classic');

  constructor() {
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
