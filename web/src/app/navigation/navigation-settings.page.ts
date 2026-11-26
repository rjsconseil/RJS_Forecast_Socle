import { defaultApplicationHome, defaultApplicationId } from '../platform/applications';
import { generateNavigation, acceptsNavigationChild } from './navigation-generator';
import { NavigationLivePreview } from './navigation-live-preview';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NgStyle, NgTemplateOutlet } from '@angular/common';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { NavigationSystem } from './navigation.service';
import { auditNavigation, navigationLoop } from './navigation-engine';
import {
  ContentMenuOptions,
  effectiveContentMenu,
  CONTENT_MENU_CHOICES,
  NavigationConfiguration,
  NavigationLevel,
  NavigationStyle,
  NavigationNode,
  NavigationSurface,
  effectiveStyle,
  effectiveLabel,
  filterTree,
  orderedChildren,
  reorder,
} from './navigation-model';
@Component({
  selector: 'rjs-navigation-settings',
  imports: [
    NavigationLivePreview,
    NgStyle,
    FormsModule,
    NgTemplateOutlet,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './navigation-settings.scss',
  host: { '(window:beforeunload)': 'beforeUnload($event)' },
  templateUrl: './navigation-settings.page.html',
})
export class NavigationSettingsPage {
  readonly previewPages = computed(() => this.pages().filter((page) => !page.link.includes(':')));
  readonly copiedStyle = signal<NavigationStyle | null>(null);
  copyStyle() {
    this.copiedStyle.set(structuredClone(this.preview(this.selectedLevel())));
    this.message.set('Style effectif copié. Choisissez une autre zone ou page pour le coller.');
  }
  pasteStyle() {
    const style = this.copiedStyle();
    if (!style) return;
    this.change((c) => {
      const levels = (((c.scopes[this.scope()] ??= {}).styles ??= {})[this.surface()] ??= {});
      levels[this.selectedLevel()] = structuredClone(style);
    });
  }
  resetSurface() {
    this.change((c) => {
      const styles = c.scopes[this.scope()]?.styles;
      if (styles) delete styles[this.surface()];
    });
  }
  readonly selectedKey = signal(defaultApplicationHome());
  readonly selected = computed(() => {
    const find = (nodes: NavigationNode[]): NavigationNode | undefined => {
      for (const n of nodes) {
        if (n.key === this.selectedKey()) return n;
        const found = find(n.children ?? []);
        if (found) return found;
      }
      return undefined;
    };
    return find([this.generated().root]) ?? this.generated().root;
  });
  readonly canvasMode = signal<'map' | 'preview'>('map');
  readonly previewNarrow = signal(false);
  readonly propertyTab = signal<'identity' | 'relations' | 'style' | 'behavior'>('identity');
  readonly propertyTabs = [
    { key: 'identity' as const, label: 'Identité' },
    { key: 'relations' as const, label: 'Relations' },
    { key: 'style' as const, label: 'Style' },
    { key: 'behavior' as const, label: 'Interaction' },
  ];
  readonly previewStates = [
    { key: 'rest', label: 'Au repos' },
    { key: 'hover', label: 'Au survol' },
    { key: 'active', label: 'Sélectionné' },
  ];
  selectNode(node: NavigationNode) {
    this.selectedKey.set(node.key);
    this.chooseSurface(node.surfaces[0] ?? 'primary');
    if (this.availableLevels().some((l) => l.id === node.level)) this.selectedLevel.set(node.level);
    const path = node.link?.split(/[?#]/)[0];
    if (path && this.pages().some((p) => p.link === path)) this.pageId.set(path);
  }
  displayNode(node: NavigationNode) {
    return effectiveLabel(this.draft(), this.context(), node.key, node.label);
  }
  nodeKind(node: NavigationNode) {
    return node.key.endsWith('#main')
      ? 'Sous-page d’accueil'
      : node.key.includes('?')
        ? 'Action'
        : node.level === 'content'
          ? 'Section de contenu'
          : node.level === 'section'
            ? 'Section'
            : node.level === 'page'
              ? 'Page'
              : 'Sous-page';
  }
  expandAll(folded: boolean) {
    for (const part of this.parts()) this.fold(part, folded);
  }
  levelLabel() {
    return this.levels.find((l) => l.id === this.selectedLevel())?.label;
  }
  sampleStyle(state: string) {
    const s = this.preview(this.selectedLevel());
    return {
      'font-size': (s.size ?? 14) + 'px',
      'font-weight': s.weight ?? 600,
      padding: (s.spacing ?? 10) + 'px ' + (s.horizontalPadding ?? 16) + 'px',
      'min-height': (s.minHeight ?? 44) + 'px',
      'border-radius': (s.radius ?? 10) + 'px',
      border: (s.borderWidth ?? 1) + 'px solid ' + (s.borderColor ?? '#dbe2ec'),
      'letter-spacing': (s.letterSpacing ?? 0) + 'px',
      color:
        state === 'active'
          ? (s.activeColor ?? '#ffffff')
          : state === 'hover'
            ? (s.hoverColor ?? s.color ?? '#24344b')
            : (s.color ?? '#24344b'),
      background:
        state === 'active'
          ? (s.activeBackground ?? '#364cc5')
          : state === 'hover'
            ? (s.hoverBackground ?? '#edf0fc')
            : (s.background ?? '#ffffff'),
    };
  }

  readonly sectionFilter = signal('');
  readonly bpmSections = computed(() => this.generated().root.children);
  readonly panel = signal<'structure' | 'appearance' | 'review'>('structure');
  readonly editorTabs = [
    {
      id: 'structure' as const,
      number: '01',
      label: 'Arborescence',
      help: 'Liens, libellés et ordre',
    },
    {
      id: 'appearance' as const,
      number: '02',
      label: 'Zones et apparence',
      help: 'Styles, niveaux et états',
    },
    {
      id: 'review' as const,
      number: '03',
      label: 'Révision et export',
      help: 'Contrôler et sauvegarder',
    },
  ];
  readonly menuPreview = computed(() => effectiveContentMenu(this.draft(), this.context()));
  setMenu(key: keyof ContentMenuOptions, value: string | number | null) {
    this.change((c) => {
      const options = ((c.scopes[this.scope()] ??= {}).contentMenu ??= {});
      if (value === '' || value === null) delete options[key];
      else
        Object.assign(options, {
          [key]: (CONTENT_MENU_CHOICES as readonly string[]).includes(key) ? value : Number(value),
        });
    });
  }
  chooseSurface(surface: NavigationSurface) {
    this.surface.set(surface);
    this.selectedLevel.set(
      surface === 'contents'
        ? 'content'
        : surface === 'actions' || surface === 'secondary'
          ? 'detail'
          : surface === 'tertiary' || surface === 'portal'
            ? 'page'
            : 'section',
    );
  }
  /** Le moteur contrôle la navigation de chaque module applicatif (règles N2 à N9). */
  readonly audits = computed(() =>
    (this.nav.catalog.applications?.() ?? []).map((app) => ({
      app,
      findings: auditNavigation(app),
      subpages: navigationLoop(app).length,
    })),
  );
  readonly validationErrors = computed(() => {
    const errors: string[] = [...this.generated().errors];
    for (const [scope, settings] of Object.entries(this.draft().scopes)) {
      if (scope !== ('module:' + defaultApplicationId()) && !this.pages().some((p) => scope === 'page:' + p.link)) continue;
      const menu = settings.contentMenu;
      if (
        menu?.width !== undefined &&
        (!Number.isInteger(menu.width) || menu.width < 220 || menu.width > 480)
      )
        errors.push(scope + ' : largeur du menu entre 220 et 480 px.');
      if (
        menu?.closeDelay !== undefined &&
        (!Number.isInteger(menu.closeDelay) || menu.closeDelay < 0 || menu.closeDelay > 600)
      )
        errors.push(scope + ' : délai de fermeture entre 0 et 600 ms.');
      for (const [surface, levels] of Object.entries(settings.styles ?? {}))
        for (const [level, style] of Object.entries(levels ?? {}))
          for (const [key, value] of Object.entries(style)) {
            const field = this.numericFields.find((f) => f.key === key);
            if (
              field &&
              (!Number.isInteger(value) || Number(value) < field.min || Number(value) > field.max)
            )
              errors.push(
                surface +
                  ' · ' +
                  level +
                  ' : ' +
                  field.label +
                  ' doit être compris entre ' +
                  field.min +
                  ' et ' +
                  field.max +
                  '.',
              );
            else if (!field && (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)))
              errors.push(surface + ' · ' + level + ' : couleur ' + key + ' invalide (#RRGGBB).');
          }
    }
    return errors;
  });
  readonly history = signal<NavigationConfiguration[]>([]);
  readonly selectedLevel = signal<NavigationLevel>('section');
  readonly availableLevels = computed(() =>
    this.levels.filter((level) =>
      this.surface() === 'contents'
        ? level.id === 'content'
        : this.surface() === 'actions' || this.surface() === 'secondary'
          ? level.id === 'detail'
          : this.surface() === 'portal'
            ? level.id === 'page'
            : level.id !== 'content',
    ),
  );
  readonly activeLevels = computed(() => this.levels.filter((l) => l.id === this.selectedLevel()));
  readonly numericFields = [
    { key: 'size', label: 'Taille du texte', min: 12, max: 28, step: 1, unit: 'px' },
    { key: 'weight', label: 'Graisse du texte', min: 400, max: 800, step: 100, unit: '' },
    { key: 'spacing', label: 'Marge intérieure verticale', min: 0, max: 20, step: 1, unit: 'px' },
    {
      key: 'horizontalPadding',
      label: 'Marge intérieure horizontale',
      min: 0,
      max: 40,
      step: 1,
      unit: 'px',
    },
    { key: 'minHeight', label: 'Hauteur minimale', min: 28, max: 72, step: 1, unit: 'px' },
    { key: 'radius', label: 'Arrondi des liens', min: 0, max: 32, step: 1, unit: 'px' },
    { key: 'borderWidth', label: 'Épaisseur de bordure', min: 0, max: 4, step: 1, unit: 'px' },
    { key: 'letterSpacing', label: 'Espacement des lettres', min: 0, max: 4, step: 1, unit: 'px' },
  ] as const;
  readonly changes = computed(() => {
    const a = this.nav.configuration(),
      b = this.draft();
    return [...new Set([...Object.keys(a.scopes), ...Object.keys(b.scopes)])]
      .filter((k) => JSON.stringify(a.scopes[k]) !== JSON.stringify(b.scopes[k]))
      .map((key) => ({
        key,
        label: key === ('module:' + defaultApplicationId()) ? 'Présentation du module' : 'Réglages d’une page',
        description: 'Libellés, styles ou comportement des menus.',
      }))
      .concat(
        [...new Set([...Object.keys(a.order ?? {}), ...Object.keys(b.order ?? {})])]
          .filter((k) => JSON.stringify(a.order?.[k]) !== JSON.stringify(b.order?.[k]))
          .map((key) => ({
            key,
            label: 'Ordre des liens',
            description: 'Position des enfants dans la navigation.',
          })),
      )
      .concat(
        JSON.stringify(a.relations) === JSON.stringify(b.relations)
          ? []
          : [
              {
                key: 'relations',
                label: 'Relations entre les liens',
                description: 'Parents, accueils et zones d’affichage.',
              },
            ],
      );
  });
  readonly changeCount = computed(() => this.changes().length);
  revisionValue(key: string, draft: boolean) {
    const c = draft ? this.draft() : this.nav.configuration();
    return JSON.stringify(
      (key === 'relations' ? c.relations : undefined) ??
        c.scopes[key] ??
        c.order?.[key] ??
        'Héritage / ordre du plan',
      null,
      2,
    );
  }
  private bpmKeys() {
    const walk = (nodes: NavigationNode[]): string[] =>
      nodes.flatMap((n) => [n.key, ...walk(n.children ?? [])]);
    return new Set(walk(this.nav.catalog.tree.filter((n) => n.key === ('zone:' + defaultApplicationId()))));
  }
  undo() {
    if (this.busy()) return;
    const h = this.history();
    if (!h.length) return;
    const previous = h[h.length - 1];
    this.draft.set(previous);
    this.history.set(h.slice(0, -1));
    this.dirty.set(JSON.stringify(previous) !== JSON.stringify(this.nav.configuration()));
    this.message.set('Dernière action annulée.');
  }
  resetLevel() {
    this.change((c) => {
      const styles = c.scopes[this.scope()]?.styles?.[this.surface()];
      if (styles) delete styles[this.selectedLevel()];
    });
  }
  preset(kind: 'compact' | 'comfortable' | 'contrast') {
    this.change((c) => {
      const levels = (((c.scopes[this.scope()] ??= {}).styles ??= {})[this.surface()] ??= {});
      levels[this.selectedLevel()] = {
        ...levels[this.selectedLevel()],
        ...(kind === 'compact'
          ? { size: 13, spacing: 5, horizontalPadding: 10, minHeight: 32, radius: 6 }
          : kind === 'comfortable'
            ? { size: 15, spacing: 10, horizontalPadding: 16, minHeight: 44, radius: 10 }
            : {
                color: '#182b45',
                background: '#ffffff',
                activeColor: '#ffffff',
                activeBackground: '#183b63',
                hoverColor: '#183b63',
                hoverBackground: '#e6eff9',
                weight: 700,
              }),
      };
    });
  }
  exportBpm() {
    const c = this.draft();
    const pages = new Set(this.pages().map((p) => 'page:' + p.link));
    const value = {
      version: 1,
      relations: { ['zone:' + defaultApplicationId()]: c.relations?.[('zone:' + defaultApplicationId())] ?? {} },
      scopes: Object.fromEntries(
        Object.entries(c.scopes).filter(([k]) => k === ('module:' + defaultApplicationId()) || pages.has(k)),
      ),
      order: Object.fromEntries(
        Object.entries(c.order ?? {}).filter(([k]) => this.bpmKeys().has(k)),
      ),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rjs-navigation-bpm.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  readonly nav = inject(NavigationSystem);
  readonly draft = signal<NavigationConfiguration>({ version: 1, scopes: {} });
  readonly generated = computed(() =>
    generateNavigation(
      this.nav.catalog.tree.find((node) => node.key === ('zone:' + defaultApplicationId()))!,
      this.draft(),
    ),
  );
  readonly selectedRelation = computed(
    () => this.generated().nodes.get(this.selectedKey()) ?? this.generated().root,
  );
  readonly parentChoices = computed(() => {
    const selected = this.selectedRelation();
    return [...this.generated().nodes.values()].filter(
      (node) => node.key !== selected.key && acceptsNavigationChild(node.kind, selected.kind),
    );
  });
  readonly homeChoices = computed(() =>
    this.selectedRelation().children.filter((node) =>
      ['section', 'page', 'subpage'].includes(node.kind),
    ),
  );
  setParent(parent: string) {
    const selected = this.selectedRelation();
    if (!this.parentChoices().some((node) => node.key === parent)) return;
    this.change((config) => {
      const relations = ((config.relations ??= {})[('zone:' + defaultApplicationId())] ??= {});
      (relations[selected.key] ??= {}).parent = parent;
      if (selected.parent && relations[selected.parent]?.home === selected.key) {
        delete relations[selected.parent].home;
      }
    });
  }
  setHome(home: string) {
    this.change((config) => {
      const relation = (((config.relations ??= {})[('zone:' + defaultApplicationId())] ??= {})[this.selected().key] ??= {});
      if (home) relation.home = home;
      else delete relation.home;
    });
  }
  setSurface(surface: NavigationSurface, enabled: boolean) {
    const surfaces = this.selected().surfaces;
    this.change((config) => {
      const relation = (((config.relations ??= {})[('zone:' + defaultApplicationId())] ??= {})[this.selected().key] ??= {});
      relation.surfaces = enabled
        ? [...new Set([...surfaces, surface])]
        : surfaces.filter((s) => s !== surface);
    });
  }
  resetRelations() {
    this.change((config) => {
      if (config.relations) delete config.relations[('zone:' + defaultApplicationId())];
    });
  }
  readonly dirty = signal(false);
  readonly busy = signal(false);
  readonly message = signal('');
  readonly scopeType = signal<'module' | 'page'>('module');
  readonly moduleId = signal(defaultApplicationId());
  readonly pageId = signal('/zones/' + defaultApplicationId());
  readonly surface = signal<NavigationSurface>('primary');
  readonly search = signal('');
  readonly levels: { id: NavigationLevel; label: string }[] = [
    { id: 'section', label: 'Sections' },
    { id: 'page', label: 'Pages' },
    { id: 'detail', label: 'Sous-pages et actions' },
    { id: 'content', label: 'Sections de contenu' },
  ];
  readonly colors = [
    { key: 'color', label: 'Texte' },
    { key: 'background', label: 'Fond' },
    { key: 'activeColor', label: 'Texte actif' },
    { key: 'activeBackground', label: 'Fond actif' },
    { key: 'hoverColor', label: 'Texte au survol' },
    { key: 'hoverBackground', label: 'Fond au survol' },
    { key: 'borderColor', label: 'Bordure' },
  ] as const;
  readonly scope = computed(() =>
    this.scopeType() === 'module' ? 'module:' + this.moduleId() : 'page:' + this.pageId(),
  );
  readonly settings = computed(() => this.draft().scopes[this.scope()] ?? {});
  readonly pages = computed(() => [
    ...new Map(
      this.nav.catalog.entries
        .filter((e) => e.module === defaultApplicationId() && !/[?#]/.test(e.link))
        .map((e) => [e.link, e]),
    ).values(),
  ]);
  readonly surfaceNames: { id: NavigationSurface; label: string; help: string }[] = [
    { id: 'primary', label: 'Menu de gauche', help: 'Sections, pages et sous-pages' },
    { id: 'secondary', label: 'Onglets horizontaux', help: 'Accueil et sous-pages de la page' },
    { id: 'actions', label: 'Menu des actions', help: 'Commandes de la sous-page d’accueil' },
    { id: 'contents', label: 'Sections de contenu', help: 'Ancres des sous-pages' },
    { id: 'tertiary', label: 'Fil d’Ariane et retours', help: 'Se situer et remonter le parcours' },
    { id: 'portal', label: 'Cartes d’accueil', help: 'Entrées des espaces BPM' },
  ];
  private readonly injector = inject(Injector);
  private readonly toggledParts = signal<Record<string, boolean>>({});
  /** Le lien qui vient de bouger : il s'éclaire un instant à sa nouvelle place. */
  readonly moved = signal('');
  /** Les parties du site : l'accueil, puis chaque module (ou le seul module du périmètre choisi). */
  readonly parts = computed(() => {
    const needle = this.search().trim().toLocaleLowerCase();
    const scoped = [this.generated().root]
      .filter((part) => part.key === ('zone:' + defaultApplicationId()))
      .map((part) =>
        this.sectionFilter()
          ? { ...part, children: part.children?.filter((n) => n.key === this.sectionFilter()) }
          : part,
      );
    return needle
      ? filterTree(scoped, (node) =>
          (node.label + ' ' + (this.settings().labels?.[node.key] ?? '') + ' ' + (node.link ?? ''))
            .toLocaleLowerCase()
            .includes(needle),
        )
      : scoped;
  });
  readonly reordered = computed(() =>
    Object.keys(this.draft().order ?? {}).some((key) => this.bpmKeys().has(key)),
  );
  children(parent: NavigationNode) {
    return orderedChildren(parent, this.draft().order ?? {});
  }
  movable(parent: NavigationNode) {
    return (parent.children ?? []).filter((child) => !child.fixed).length;
  }
  size(node: NavigationNode): number {
    return (node.children ?? []).reduce((total, child) => total + 1 + this.size(child), 0);
  }
  changed(node: NavigationNode): boolean {
    return (
      !!this.draft().order?.[node.key] || (node.children ?? []).some((child) => this.changed(child))
    );
  }
  surfaceLabel(surface: NavigationSurface) {
    return this.surfaceNames.find((entry) => entry.id === surface)?.label ?? surface;
  }
  gripId(parent: NavigationNode, node: NavigationNode) {
    return 'navigation-grip:' + parent.key + '>' + node.key;
  }
  opened(key: string) {
    return (
      !!this.search() ||
      (this.toggledParts()[key] ?? (key === '/' || key === 'zone:' + this.moduleId()))
    );
  }
  toggled(key: string, event: Event) {
    const open = (event.target as HTMLDetailsElement).open;
    if (!this.search() && open !== this.opened(key))
      this.toggledParts.update((value) => ({ ...value, [key]: open }));
  }
  private readonly foldedNodes = signal<Record<string, boolean>>({});
  /** Un niveau replié libère la place pour déplacer ses voisins ; la recherche déplie tout. */
  folded(node: NavigationNode) {
    return !this.search() && !!this.foldedNodes()[node.key];
  }
  toggleNode(node: NavigationNode) {
    this.foldedNodes.update((value) => ({ ...value, [node.key]: !value[node.key] }));
  }
  fold(part: NavigationNode, folded: boolean) {
    const keys = (nodes: NavigationNode[]): string[] =>
      nodes.flatMap((node) => (node.children?.length ? [node.key, ...keys(node.children)] : []));
    this.foldedNodes.update((value) => ({
      ...value,
      ...Object.fromEntries(keys(part.children ?? []).map((key) => [key, folded])),
    }));
  }
  drop(parent: NavigationNode, event: CdkDragDrop<unknown>) {
    this.move(parent, event.previousIndex, event.currentIndex);
  }
  step(parent: NavigationNode, node: NavigationNode, index: number, delta: number, event?: Event) {
    event?.preventDefault();
    if (!this.move(parent, index, index + delta)) return;
    // Le déplacement au clavier garde la main sur la poignée du lien déplacé.
    if (event)
      afterNextRender(() => document.getElementById(this.gripId(parent, node))?.focus(), {
        injector: this.injector,
      });
  }
  private move(parent: NavigationNode, from: number, to: number): boolean {
    const last = this.movable(parent) - 1;
    const target = Math.min(to, last);
    if (this.search() || from === target || from < 0 || target < 0 || from > last) return false;
    const key = parent.key + '>' + this.children(parent)[from].key;
    this.change((config) => {
      const order = reorder(config.order ?? {}, parent, from, target);
      if (Object.keys(order).length) config.order = order;
      else delete config.order;
    });
    this.moved.set(key);
    setTimeout(() => {
      if (this.moved() === key) this.moved.set('');
    }, 900);
    return true;
  }
  resetOrder() {
    this.change((config) => {
      for (const key of this.bpmKeys()) if (config.order) delete config.order[key];
    });
  }
  constructor() {
    for (const section of this.bpmSections()) this.fold(section, true);
    effect(() => {
      const value = this.nav.configuration();
      if (!untracked(this.dirty)) this.draft.set(structuredClone(value));
    });
  }
  changeModule(id: string) {
    this.moduleId.set(id);
    this.pageId.set(this.pages()[0]?.link ?? '/');
  }
  style(level: NavigationLevel): NavigationStyle {
    return this.settings().styles?.[this.surface()]?.[level] ?? {};
  }
  private context() {
    return { module: defaultApplicationId(), page: this.scopeType() === 'page' ? this.pageId() : '' };
  }
  preview(level: NavigationLevel) {
    return effectiveStyle(this.draft(), this.context(), this.surface(), level);
  }
  inherited(level: NavigationLevel) {
    const value = structuredClone(this.draft());
    delete value.scopes[this.scope()];
    return effectiveStyle(value, this.context(), this.surface(), level);
  }
  beforeUnload(event: BeforeUnloadEvent) {
    if (this.dirty() || this.busy()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  private change(update: (config: NavigationConfiguration) => void) {
    if (this.busy() || !this.nav.ready()) return;
    const before = structuredClone(this.draft());
    const value = structuredClone(before);
    update(value);
    if (JSON.stringify(before) === JSON.stringify(value)) return;
    this.history.update((h) => [...h.slice(-39), before]);
    this.draft.set(value);
    this.dirty.set(JSON.stringify(value) !== JSON.stringify(this.nav.configuration()));
    this.message.set('');
  }
  setStyle(level: NavigationLevel, key: keyof NavigationStyle, input: string | number | null) {
    this.change((config) => {
      const scope = (config.scopes[this.scope()] ??= {});
      const styles = (scope.styles ??= {});
      const levels = (styles[this.surface()] ??= {});
      const style = (levels[level] ??= {});
      if (input === '' || input === null) delete style[key];
      else
        Object.assign(style, {
          [key]: this.numericFields.some((field) => field.key === key) ? Number(input) : input,
        });
    });
  }
  setLabel(key: string, input: string) {
    this.change((config) => {
      const labels = ((config.scopes[this.scope()] ??= {}).labels ??= {});
      if (input.trim()) labels[key] = input.trim();
      else delete labels[key];
    });
  }
  resetScope() {
    this.change((config) => {
      delete config.scopes[this.scope()];
    });
  }
  discard() {
    if (this.busy()) return;
    this.draft.set(structuredClone(this.nav.configuration()));
    this.dirty.set(false);
    this.history.set([]);
    this.message.set('Modifications annulées.');
  }
  async save() {
    if (this.validationErrors().length || this.busy()) return;
    this.busy.set(true);
    this.message.set('');
    try {
      await this.nav.save(this.draft());
      this.dirty.set(false);
      this.history.set([]);
      this.message.set(
        'Configuration enregistrée. Les relations sont utilisées par la simulation statique.',
      );
    } catch (error: any) {
      this.message.set(
        error?.error?.code === 'STALE_VERSION'
          ? 'Les réglages ont changé ailleurs. Rechargez la page pour relire leur dernière version avant de modifier.'
          : 'Enregistrement impossible. Vérifiez les limites indiquées et les couleurs (#RRGGBB). Vos modifications sont conservées.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
