import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, Injector, signal, untracked, viewChild, type Type } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { CentsPipe } from '../core/format';
import { DataChanges } from '../core/data-changes';
import { BpmApi } from '../bpm/data/bpm-api.service';
import { BpmOperationEditor, BpmPageContext, BpmRefresh, bpmLoader, shiftPeriod } from '../bpm/ui';
import { BpmProjectEditor, BpmTaskEditor } from '../bpm/projects/project-editors';
import { BpmGoalEditor, type GoalTypeOption } from '../bpm/pages/vision-goal-editor';
import type { Direction } from '../bpm/data/bpm-models';
import { PAGE_GUIDANCE } from '../shared/page-guidance';
import { injectCurrentUrl, PageObjectLabels } from '../plan/plan-context';
import { projectLink } from '../bpm/bpm.screens';
import { PAGE_TOOLBAR_SLOT, type PageToolbarSlot } from '../shared/page-toolbar.component';
import { ASTRA_PARTS, astraMenuSlug, astraPartOf, astraTabsOf, astraUrl } from './astra-parts';
import { astraBridges } from './astra-bridges';
import { ASTRA_CREATE_MENU, AstraActions, astraLinkDoublesTab, type AstraCreateKind } from './astra-actions';

/**
 * Cadre commun des pages d'Astra, comme une application :
 * - le bandeau de partie (couleur, rôle, étape du parcours) et ses ponts chiffrés vers les deux autres parties ;
 * - la barre d'outils collante : onglets des pages qui travaillent ensemble, période, « Nouveau » ;
 * - les créations en fenêtre, sans quitter la page, confirmées par un message ;
 * - les raccourcis clavier (+ : nouveau, puis la lettre de l'objet ; [ et ] : période), en plus de ceux du site.
 */
@Component({
  selector: 'astra-part',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgComponentOutlet, RouterLink, CentsPipe, BpmOperationEditor, BpmProjectEditor, BpmTaskEditor, BpmGoalEditor],
  providers: [BpmPageContext, AstraActions, { provide: PAGE_TOOLBAR_SLOT, useFactory: () => inject(AstraPartFrame).slot }],
  host: { '[attr.data-part]': 'part().key', '[attr.data-titled]': 'titled() || null', '(document:click)': 'outside($event)', '(calendarlayout)': 'calendarLayout($event)' },
  template: `
    @let p = part();
    <div class="astra-part-band">
      <a class="astra-part-id" [routerLink]="partHome()" [queryParams]="ctx.carry()">
        <span class="astra-part-mark" [attr.data-astra-icon]="p.icon" aria-hidden="true"></span>
        <span><b>{{ p.label }}</b><small>{{ p.role }}</small></span>
      </a>
      <ol class="astra-part-steps" [attr.aria-label]="'Parcours de ' + p.label">
        @for (page of p.pages; track page.slug; let i = $index) {
          <li [class.is-current]="page.slug === menuSlug()" [class.is-before]="i < stepIndex()">
            <a [routerLink]="url(page.slug)" [queryParams]="ctx.carry()" [attr.aria-current]="page.slug === menuSlug() ? 'step' : null"
               [attr.title]="page.label"><span class="astra-step-dot" aria-hidden="true"></span><span class="astra-step-label">{{ page.label }}</span></a>
          </li>
        }
      </ol>
    </div>

    <!-- Barre de titre : le titre de la page, ses outils communs, puis la navigation secondaire en onglets. -->
    <header class="astra-titlebar" role="toolbar" [attr.aria-label]="'Outils de ' + p.label">
      <div class="astra-titlebar-head">
        @if (titled()) {
          <div class="astra-titlebar-title"><h1>{{ pageTitle() }}</h1>@if (guidance?.lead) { <p>{{ guidance!.lead }}</p> }</div>
        }
        <div class="astra-tools">
          <div #barSlot class="astra-bar-primary" aria-label="Action principale de la page"></div>
          @if (nav().period && period(); as per) {
            <div class="astra-period" role="group" aria-label="Période budgétaire">
              <button type="button" class="astra-tool-icon" [disabled]="per.atFirst" (click)="shift(-1)" title="Période précédente ([)" aria-label="Période précédente"><span data-astra-icon="precedent" aria-hidden="true"></span></button>
              <span class="astra-period-label"><span data-astra-icon="cycle" aria-hidden="true"></span>{{ per.label }}</span>
              <button type="button" class="astra-tool-icon" [disabled]="per.atCurrent" (click)="shift(1)" title="Période suivante (])" aria-label="Période suivante"><span data-astra-icon="suivant" aria-hidden="true"></span></button>
              @if (!per.atCurrent) { <button type="button" class="astra-tool-text" (click)="today()">Aujourd’hui</button> }
            </div>
          }
          <div class="astra-new">
            <button type="button" class="astra-new-button" aria-haspopup="menu" [attr.aria-expanded]="menu()" (click)="menu.set(!menu()); $event.stopPropagation()">
              <span data-astra-icon="plus" aria-hidden="true"></span>Nouveau<kbd aria-hidden="true">+</kbd>
            </button>
            @if (menu()) {
              <ul class="astra-new-menu" role="menu" aria-label="Créer">
                @for (item of createMenu(); track item.kind) {
                  <li role="none"><button type="button" role="menuitem" [attr.data-to]="item.part" (click)="create(item.kind)">
                    <span class="astra-new-icon" [attr.data-astra-icon]="item.icon" aria-hidden="true"></span>{{ item.label }}<kbd aria-hidden="true">{{ item.key }}</kbd>
                  </button></li>
                }
              </ul>
            }
          </div>
          <button type="button" class="astra-tools-jump" (click)="showTools()" aria-controls="astra-workspace-tools" aria-label="Filtres et outils de la page" title="Filtres et outils de la page">
            <span data-astra-icon="reglages" aria-hidden="true"></span><span>Outils</span>
          </button>
        </div>
        </div>
      <nav class="astra-tabs" [attr.aria-label]="'Pages liées à ' + pageTitle()">
        <a class="astra-tab-step" [class.is-off]="!nav().prev" [routerLink]="nav().prev?.url ?? null" [queryParams]="ctx.carry()"
           [attr.aria-label]="nav().prev ? 'Page précédente : ' + nav().prev!.label : null" [attr.aria-disabled]="!nav().prev || null" [attr.title]="nav().prev?.label ?? null"><span data-astra-icon="precedent" aria-hidden="true"></span></a>
        @for (tab of nav().tabs; track tab.slug; let i = $index) {
          @if (tab.other && (i === 0 || !nav().tabs[i - 1].other)) { <span class="astra-tab-sep" aria-hidden="true"></span> }
          <a [routerLink]="tab.url" [queryParams]="ctx.carry()" [class.is-current]="tab.current" [class.is-other]="tab.other" [attr.data-part]="tab.part"
             [attr.aria-current]="tab.current ? 'page' : null" [attr.title]="tab.other ? tab.label + ' · ' + partLabel(tab.part) : null">
            @if (tab.step) { <span class="astra-tab-n" aria-hidden="true">{{ tab.step }}</span> }
            @if (tab.other) { <span class="astra-tab-part" [attr.data-astra-icon]="partIcon(tab.part)" aria-hidden="true"></span> }{{ tab.label }}
          </a>
        }
        <a class="astra-tab-step" [class.is-off]="!nav().next" [routerLink]="nav().next?.url ?? null" [queryParams]="ctx.carry()"
           [attr.aria-label]="nav().next ? 'Page suivante : ' + nav().next!.label : null" [attr.aria-disabled]="!nav().next || null" [attr.title]="nav().next?.label ?? null"><span data-astra-icon="suivant" aria-hidden="true"></span></a>
      </nav>
    </header>

    <!-- Mode clôture : visible sur toutes les pages tant que le cycle terminé attend sa clôture. -->
    @if (closingBanner(); as cb) {
      <div class="astra-closing-banner" role="status">
        <span data-astra-icon="cycle" aria-hidden="true"></span>
        <p><b>{{ cb.title }}</b> {{ cb.text }}</p>
        <a [routerLink]="url('cloture')" [queryParams]="ctx.carry()">Finaliser la clôture →</a>
      </div>
    }

    <div class="astra-body">
      <div class="astra-screen">
        @if (screen(); as s) { <ng-container *ngComponentOutlet="s" /> }
      </div>
      <aside #toolsRail id="astra-workspace-tools" class="astra-rail" tabindex="-1" aria-label="Commandes de la page et liens vers les autres parties">
        <!-- Boîte à outils : mêmes modules, même ordre, sur toutes les pages ; chacun s'adapte à la page. -->
        <section class="astra-mod" data-mod="focus" data-empty><h2 class="astra-rail-title">Priorité</h2><p>Rien d’urgent sur cette page.</p></section>
        <section class="astra-mod" data-mod="act" data-empty><h2 class="astra-rail-title">Autres actions</h2><p>Les gestes se font sur les lignes de la page.</p></section>
        <section class="astra-mod" data-mod="refine" data-empty><h2 class="astra-rail-title">Affiner</h2><p>Pas de filtre sur cette page.</p></section>
        <div #slot class="astra-rail-slot"></div>
        <section class="astra-mod" data-mod="create" aria-label="Créer">
          <h2 class="astra-rail-title">Créer</h2>
          <div class="astra-rail-create">
            @for (item of createMenu(); track item.kind) {
              <button type="button" [attr.data-to]="item.part" [class.is-own]="item.part === p.key" (click)="create(item.kind)">
                <span class="astra-new-icon" [attr.data-astra-icon]="item.icon" aria-hidden="true"></span>{{ item.label }}
              </button>
            }
          </div>
        </section>
      @if (bridges().length) {
        <nav class="astra-mod astra-bridges" data-mod="go" aria-label="Aller vers les autres parties">
          <h2 class="astra-rail-title">Aller vers</h2>
          @for (b of bridges(); track b.to) {
            <a class="astra-bridge" [attr.data-to]="b.to" [attr.data-state]="b.state" [routerLink]="url(b.link)" [queryParams]="ctx.carry()">
              <span class="astra-bridge-part"><span [attr.data-astra-icon]="partIcon(b.to)" aria-hidden="true"></span>{{ partLabel(b.to) }}</span>
              <span class="astra-bridge-label">{{ b.label }}</span>
              <strong>{{ b.valueCents | cents:0 }}</strong>
              <small>{{ b.note }}</small>
            </a>
          }
        </nav>
      }
      </aside>
    </div>

    @if (actions.creating(); as c) {
      @switch (c.kind) {
        @case ('project') { <bpm-project-editor (closed)="actions.close()" (saved)="projectSaved($event)" /> }
        @case ('task') { <bpm-task-editor [projects]="taskOptions()" [defaultProjectId]="c.projectId ?? ''" (closed)="actions.close()" (saved)="saved($event, 'taches')" /> }
        @case ('goal') { @if (goalTypes(); as types) { <bpm-goal-editor [types]="types" (closed)="actions.close()" (saved)="saved($event, 'objectif/echeances')" /> } }
        @default { @if (budgets().length) { <bpm-operation-editor [budgets]="budgets()" [defaults]="{ direction: direction(c.kind) }" (closed)="actions.close()" (saved)="saved($event, 'mouvements')" /> } }
      }
    }
    @if (actions.toast(); as t) {
      <div class="astra-toast" role="status">
        <span data-astra-icon="continuer" aria-hidden="true"></span><span>{{ t.text }}</span>
        @if (t.link) { <a [routerLink]="t.link" [queryParams]="ctx.carry()" (click)="actions.toast.set(null)">{{ t.linkLabel ?? 'Ouvrir' }}</a> }
        <button type="button" aria-label="Fermer le message" (click)="actions.toast.set(null)">×</button>
      </div>
    }
  `,
})
export class AstraPartFrame {
  protected readonly ctx = inject(BpmPageContext);
  protected readonly actions = inject(AstraActions);
  private readonly api = inject(BpmApi);
  private readonly refresh = inject(BpmRefresh);
  private readonly route = inject(ActivatedRoute);
  private readonly data = toSignal(this.route.data, { initialValue: this.route.snapshot.data });

  protected readonly slug = computed(() => String(this.data()['astraSlug'] ?? ''));
  protected readonly part = computed(() => astraPartOf(this.slug()));
  protected readonly menuSlug = computed(() => astraMenuSlug(this.slug()));
  protected readonly stepIndex = computed(() => this.part().pages.findIndex(p => p.slug === this.menuSlug()));
  protected readonly partHome = computed(() => astraUrl(this.part().pages[0].slug));
  /** Onglets : les pages qui répondent à celle-ci (aller et retour), avec l'identifiant de la fiche ouverte. */
  protected readonly nav = computed(() => {
    const { tabs, period } = astraTabsOf(this.slug());
    const params = this.ctx.params();
    const fill = (slug: string) => slug.replace(':id', params.get('id') ?? '').replace(':poste', params.get('poste') ?? '');
    const own = this.part().key;
    const list = tabs.map(t => ({ ...t, url: astraUrl(fill(t.slug)), other: t.part !== own }));
    const at = list.findIndex(t => t.current);
    const tab = (i: number) => (i >= 0 && i < list.length ? list[i] : null);
    return { tabs: list, period, prev: tab(at - 1), next: tab(at + 1) };
  });
  protected readonly screen = signal<Type<unknown> | null>(null);
  protected readonly menu = signal(false);
  protected readonly guidance = inject(PAGE_GUIDANCE, { optional: true });
  /**
   * Nom de l'objet ouvert sur une fiche (« Voyage au Japon »), tel que l'écran le publie au plan du site
   * (adresse Astra, ou adresse d'origine de BPM pour la fiche projet).
   */
  private readonly objectLabels = inject(PageObjectLabels);
  private readonly currentUrl = injectCurrentUrl();
  protected readonly objectName = computed(() => {
    if (!this.slug().includes(':')) return null;
    const id = this.ctx.params().get('id');
    return this.objectLabels.labelFor(this.currentUrl()) ?? (id ? this.objectLabels.labelFor(projectLink(id)) : null);
  });
  /**
   * La barre de titre porte le titre de la page, ou le nom de l'objet sur une fiche : le bandeau de l'écran, qui le
   * répétait dessous, est alors masqué. Une fiche qui ne publie pas encore son nom garde son bandeau.
   */
  protected readonly titled = computed(() => !this.slug().includes(':') || this.objectName() !== null);
  protected readonly pageTitle = computed(() => this.objectName() ?? this.guidance?.title ?? String(this.route.snapshot.routeConfig?.title ?? '').replace(/ · BPM-Astra$/, ''));
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly slotHost = viewChild.required<ElementRef<HTMLElement>>('slot');
  private readonly barHost = viewChild.required<ElementRef<HTMLElement>>('barSlot');
  private readonly toolsRail = viewChild.required<ElementRef<HTMLElement>>('toolsRail');
  protected readonly slotUsed = signal(false);

  protected showTools(): void {
    const rail = this.toolsRail().nativeElement;
    rail.scrollIntoView({ block: 'start' });
    rail.focus({ preventScroll: true });
  }
  /** Les commandes de l'écran (action principale, outils, filtres) se rangent dans le panneau latéral. */
  readonly slot: PageToolbarSlot = {
    // La barre de commandes donne ses emplacements déclarés : rien n'est cherché par classe dans l'écran.
    claim: ({ host, primary, actions }) => {
      if (this.slotUsed()) return null;
      this.slotHost().nativeElement.append(host);
      // Répartition : l'action principale va dans la barre horizontale ; priorité, autres actions et filtres restent dans le panneau.
      this.barHost().nativeElement.append(primary);
      this.claimedActions = actions;
      this.marks.observe(actions, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
      this.markTabLinks();
      this.slotUsed.set(true);
      return () => { primary.remove(); this.marks.disconnect(); this.claimedActions = null; this.slotUsed.set(false); };
    },
  };
  /** « Autres actions » de l'écran ouvert, relues quand l'écran les réécrit. */
  private claimedActions: HTMLElement | null = null;
  private readonly marks = new MutationObserver(() => this.markTabLinks());

  private readonly life = bpmLoader(this.ctx.period, period => this.api.lifeManagement(period));
  protected readonly bridges = computed(() => {
    const d = this.life.data();
    return d ? astraBridges(this.part().key, d) : [];
  });
  protected readonly budgets = computed(() => this.life.data()?.context.budgets ?? []);
  protected readonly taskOptions = computed(() => (this.life.data()?.projects.projects ?? []).map(p => ({ projectId: p.coreProjectId, title: p.name })));
  protected readonly goalTypes = signal<GoalTypeOption[] | null>(null);

  /** La création de la partie ouverte vient en premier. */
  protected readonly createMenu = computed(() => {
    const key = this.part().key;
    return [...ASTRA_CREATE_MENU].sort((a, b) => Number(b.part === key) - Number(a.part === key));
  });

  /**
   * Suivi de clôture sur toutes les pages : relu à chaque écriture (ici ou ailleurs). Un point qui se clôt est
   * signalé à l'instant ; tant que le cycle terminé attend sa clôture, un bandeau l'annonce.
   */
  private readonly changes = inject(DataChanges);
  private readonly brief = bpmLoader(() => this.changes.version(), () => Promise.resolve().then(() => this.api.closingBrief()).catch(() => null));
  protected readonly closingBanner = computed(() => {
    const b = this.brief.data();
    if (!b?.closingMode.active || !b.period || this.menuSlug() === 'cloture') return null;
    const open = b.counts?.open ?? 0;
    return {
      title: `${b.period.label} en clôture · ${open ? `${open} point${open > 1 ? 's' : ''} ouvert${open > 1 ? 's' : ''}` : 'prêt à clôturer'}.`,
      text: `Ses points sont figés : seuls ceux encore ouverts se traitent. ${b.next?.label ?? 'Le cycle suivant'} démarrera à la clôture.`,
    };
  });
  private briefSeen: { period: string; open: Set<string> } | null = null;

  protected readonly period = computed(() => {
    const d = this.life.data();
    const key = d?.context.period?.key ?? null;
    if (!d || !key) return null;
    const bounds = d.context.periods;
    return { key, label: d.cycle.period?.label ?? key, atFirst: key === bounds?.firstKey, atCurrent: key === bounds?.currentKey };
  });

  constructor() {
    const load = this.route.snapshot.data['astraScreen'] as (() => Promise<Type<unknown>>) | undefined;
    void load?.().then(type => this.screen.set(type));
    // Le nom de la fiche projet, publié par l'écran à son adresse d'origine, vaut aussi pour l'adresse Astra :
    // fil d'Ariane, titre de l'onglet du navigateur et parcours affichent « Voyage au Japon ».
    effect(() => {
      const id = this.ctx.params().get('id'), name = this.objectName();
      if (id && name && this.slug().startsWith('projets/:id')) untracked(() => this.objectLabels.set(astraUrl('projets/' + id), name));
    });
    // Les types d'objectif ne sont lus qu'à la première création d'un objectif daté.
    effect(() => {
      if (this.actions.creating()?.kind === 'goal' && !untracked(this.goalTypes)) void this.api.setupProfile().then(p => this.goalTypes.set(p.goalTypes));
    });
    // Un point du cycle qui se clôt (règlement, écart, décision) est signalé à l'instant, sans attendre la clôture.
    effect(() => {
      const b = this.brief.data();
      if (!b?.period) return;
      const seen = this.briefSeen;
      const open = new Set(b.points.filter(p => p.state === 'open' || p.state === 'deferred').map(p => p.id));
      this.briefSeen = { period: b.period.key, open };
      if (!seen || seen.period !== b.period.key || untracked(this.menuSlug) === 'cloture') return;
      const closed = b.points.filter(p => p.state === 'closed' && seen.open.has(p.id));
      if (!closed.length) return;
      const what = closed.length === 1 ? `« ${closed[0].label} »` : `${closed.length} points`;
      untracked(() => this.actions.notify({
        text: `${what} ${closed.length === 1 ? 'est clos' : 'sont clos'} à l’instant dans le suivi de clôture · ${b.period!.label} complété à ${b.percent} %.`,
        link: astraUrl('cloture'),
        linkLabel: 'Suivi de clôture',
      }));
    });
    // Une seule place pour chaque navigation : les liens de la boîte à outils qui ouvrent une page déjà en onglet
    // sont marqués (et masqués). Relu quand les onglets changent et quand l'écran réécrit ses commandes.
    effect(() => { this.nav(); untracked(() => this.markTabLinks()); });
    // Sur un écran étroit, l'onglet de la page ouverte reste visible dans la barre (qui défile de côté).
    effect(() => {
      this.nav();
      afterNextRender(() => this.host.nativeElement.querySelector('.astra-tabs a.is-current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }), { injector: this.injector });
    });
    inject(DestroyRef).onDestroy(() => this.marks.disconnect());
    // Un lien de création d'un écran (« Créer un projet », « Nouvelle tâche »…) ouvre la fenêtre ici,
    // au lieu d'emmener sur la page qui liste ces objets. Sur cette page même, l'écran garde sa fenêtre.
    inject(ElementRef<HTMLElement>).nativeElement.addEventListener('click', (event: MouseEvent) => this.intercept(event), true);
    // Capturés avant les raccourcis du site (N, P : onglets) pour que la lettre choisie dans le menu ne navigue pas.
    const keys = (event: KeyboardEvent) => this.shortcut(event);
    window.addEventListener('keydown', keys, true);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('keydown', keys, true));
  }

  /**
   * Marque les liens de « Autres actions » qui mènent à une page déjà en onglet (même adresse, sans création ni
   * ancre) : l'onglet est la place de cette navigation. Une action (création, fenêtre, bouton) reste.
   */
  private markTabLinks(): void {
    const actions = this.claimedActions;
    if (!actions) return;
    const tabs = new Set(this.nav().tabs.map(t => t.url));
    for (const link of Array.from(actions.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
      const duplicate = astraLinkDoublesTab(link.href, location.href, tabs, link.hasAttribute('data-astra-keep'));
      if (duplicate !== link.hasAttribute('data-astra-tab')) link.toggleAttribute('data-astra-tab', duplicate);
    }
  }

  private intercept(event: MouseEvent): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    const q = url.searchParams;
    const kind: AstraCreateKind | null = q.get('editProject') === 'new' || url.pathname === '/bpm-astra/nouveau' ? 'project'
      : q.get('editTask') === 'new' || url.pathname === '/bpm-astra/taches/nouvelle' ? 'task'
      : q.get('entry') === 'new' ? ((q.get('entryDirection') ?? q.get('direction')) === 'income' ? 'income' : 'charge') : null;
    if (!kind || url.pathname === location.pathname) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const project = [q.get('project'), q.get('projectId')].find(v => v?.startsWith('prj_'));
    this.create(kind, project ?? undefined);
  }

  protected create(kind: AstraCreateKind, projectId?: string): void {
    this.menu.set(false);
    this.actions.create(kind, { projectId });
  }

  protected direction(kind: AstraCreateKind): Direction {
    return kind === 'income' ? 'income' : 'charge';
  }

  protected saved(text: string, slug: string): void {
    this.actions.close();
    this.refresh.bump();
    this.actions.notify({ text, link: slug === this.slug() ? undefined : astraUrl(slug), linkLabel: 'Ouvrir la liste' });
  }

  protected projectSaved(e: { projectId: string; title: string }): void {
    this.actions.close();
    this.refresh.bump();
    this.actions.notify({ text: `Projet « ${e.title} » créé.`, link: astraUrl('projets/' + e.projectId), linkLabel: 'Ouvrir sa fiche' });
  }

  protected shift(delta: number): void {
    const p = this.period();
    if (!p || (delta < 0 && p.atFirst) || (delta > 0 && p.atCurrent)) return;
    void this.ctx.setQuery({ period: shiftPeriod(p.key, delta) });
  }

  protected today(): void {
    void this.ctx.setQuery({ period: null });
  }

  /** Raccourcis : jamais pendant une saisie ni dans une fenêtre ouverte. */
  private shortcut(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (event.metaKey || event.ctrlKey || event.altKey || this.actions.creating() || document.querySelector('dialog[open]')) return;
    if (target?.closest('input, textarea, select, [contenteditable], [role="textbox"], [role="combobox"]')) return;
    const key = event.key.toUpperCase();
    if (event.key === 'Escape' && this.menu()) { this.menu.set(false); return; }
    if (this.menu()) {
      const item = ASTRA_CREATE_MENU.find(i => i.key === key);
      if (item) { event.preventDefault(); event.stopPropagation(); this.create(item.kind); }
      return;
    }
    if (event.key === '+') { event.preventDefault(); this.menu.set(true); }
    else if (event.key === '[' && this.nav().period) this.shift(-1);
    else if (event.key === ']' && this.nav().period) this.shift(1);
  }

  /** Le calendrier annonce la hauteur de ses outils et de sa grille : la colonne d'outils d'Astra s'y aligne. */
  protected calendarLayout(event: Event): void {
    const height = (event as CustomEvent<{ toolsHeight: number | null }>).detail?.toolsHeight ?? null;
    const host = this.host.nativeElement as HTMLElement;
    host.toggleAttribute('data-calendar-tools', height !== null);
    if (height === null) host.style.removeProperty('--astra-calendar-tools-height');
    else host.style.setProperty('--astra-calendar-tools-height', `${height}px`);
  }

  protected outside(event: Event): void {
    if (this.menu() && !(event.target as HTMLElement | null)?.closest('.astra-new')) this.menu.set(false);
  }

  protected url = astraUrl;
  protected partLabel = (key: string) => ASTRA_PARTS.find(p => p.key === key)?.label ?? key;
  protected partIcon = (key: string) => ASTRA_PARTS.find(p => p.key === key)?.icon ?? key;
}
