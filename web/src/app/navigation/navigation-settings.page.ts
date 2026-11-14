import { ChangeDetectionStrategy, Component, Injector, afterNextRender, computed, effect, inject, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';
import { NavigationSystem } from './navigation.service';
import { NavigationConfiguration, NavigationLevel, NavigationStyle, NavigationNode, NavigationSurface, effectiveStyle, filterTree, orderedChildren, reorder } from './navigation-model';
@Component({
  selector: 'rjs-navigation-settings', imports: [FormsModule, NgTemplateOutlet, CdkDropList, CdkDrag, CdkDragHandle], changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './navigation-settings.scss',
  template: `
    <div class="page navigation-settings">
      <header><p class="eyebrow">Module technique · commun à tous les modules</p><h1>Navigation system</h1>
        <p>Personnalisez les menus et leurs libellés. Les destinations restent définies par le plan du site.</p>
        <p>Les réglages s’appliquent dans cet ordre : <strong>site → module → page</strong>. Un champ vide conserve la valeur héritée.</p>
      </header>
      @if (nav.error()) { <p role="alert">{{ nav.error() }} <button (click)="nav.reload()">Réessayer</button></p> }
      <div class="navigation-settings-actions">
        <button type="button" (click)="save()" [disabled]="!dirty() || busy() || !nav.ready()">{{ busy() ? 'Enregistrement…' : 'Enregistrer les réglages' }}</button>
        <button type="button" (click)="discard()" [disabled]="!dirty() || busy()">Annuler les modifications</button>
        <span role="status">{{ message() || (dirty() ? 'Modifications non enregistrées' : 'Réglages enregistrés') }}</span>
      </div>
      <fieldset [disabled]="busy() || !nav.ready()"><legend>Périmètre des modifications</legend>
        <div class="navigation-settings-grid">
          <label>Portée<select aria-label="Portée" [ngModel]="scopeType()" (ngModelChange)="scopeType.set($event)"><option value="site">Site entier</option><option value="module">Un module</option><option value="page">Une page</option></select></label>
          @if (scopeType() !== 'site') {
            <label>Module<select aria-label="Module" [ngModel]="moduleId()" (ngModelChange)="changeModule($event)">@for (module of nav.catalog.modules; track module.id) { <option [value]="module.id">{{ module.label }}</option> }</select></label>
          }
          @if (scopeType() === 'page') {
            <label>Page<select aria-label="Page" [ngModel]="pageId()" (ngModelChange)="pageId.set($event)">@for (page of pages(); track page.link) { <option [value]="page.link">{{ page.label }} — {{ page.link }}</option> }</select></label>
          }
        </div>
        <p>Les réglages d’un module ou d’une page concernent la navigation affichée dans ce contexte.</p>
        <button type="button" (click)="resetScope()">Rétablir l’héritage de ce périmètre</button>
      </fieldset>
      <fieldset [disabled]="busy() || !nav.ready()"><legend>Présentation des zones de navigation</legend>
        <label>Zone à personnaliser<select aria-label="Zone à personnaliser" [ngModel]="surface()" (ngModelChange)="surface.set($event)">
          <option value="primary">Principale · menu de gauche</option><option value="secondary">Secondaire · onglets du cadre supérieur</option>
          <option value="tertiary">Tertiaire · fil d’Ariane et retour au parent</option><option value="portal">Accueil · modules et sections</option>
        </select></label>
        <p>Chaque niveau conserve sa hiérarchie. Les couleurs de l’élément actif se règlent séparément.</p>
        @for (level of levels; track level.id) {
          <section class="navigation-level-editor"><h2>{{ level.label }}</h2>
            <div class="navigation-settings-grid">
              <label>Taille du texte (px)<input type="number" min="12" max="28" [ngModel]="style(level.id).size ?? ''" (ngModelChange)="setStyle(level.id, 'size', $event)" [placeholder]="inherited(level.id).size?.toString() || 'Style du site'"></label>
              <label>Espacement vertical (px)<input type="number" min="0" max="20" [ngModel]="style(level.id).spacing ?? ''" (ngModelChange)="setStyle(level.id, 'spacing', $event)" placeholder="Hérité"></label>
              @for (color of colors; track color.key) {
                <label>{{ color.label }}<span class="navigation-color"><input type="color" [attr.aria-label]="color.label + ' — ' + level.label" [ngModel]="style(level.id)[color.key] || inherited(level.id)[color.key] || '#24344b'" (ngModelChange)="setStyle(level.id, color.key, $event)">
                <input type="text" maxlength="7" pattern="#[0-9a-fA-F]{6}" [attr.aria-label]="color.label + ' hexadécimal — ' + level.label" [ngModel]="style(level.id)[color.key] || ''" (ngModelChange)="setStyle(level.id, color.key, $event)" placeholder="Hérité"></span></label>
              }
            </div>
            <div class="navigation-preview" aria-label="Aperçu du niveau" [style.font-size.px]="preview(level.id).size || 15" [style.color]="preview(level.id).color || '#24344b'" [style.background-color]="preview(level.id).background || '#f2f5f8'" [style.padding-block.px]="preview(level.id).spacing ?? 8">
              {{ level.label }} <span [style.color]="preview(level.id).activeColor || '#ffffff'" [style.background-color]="preview(level.id).activeBackground || '#24344b'">Élément actif</span>
            </div>
          </section>
        }
      </fieldset>
      <fieldset class="navigation-links" [disabled]="busy() || !nav.ready()"><legend>Liens : ordre et libellés</legend>
        <p>Les liens sont rangés comme le site les montre : l’accueil d’abord, puis chaque module, niveau par niveau. Faites glisser un lien par sa poignée pour le déplacer parmi ses voisins ; les flèches, ou ↑ ↓ sur la poignée, font la même chose au clavier.</p>
        <p>L’ordre vaut pour tout le site. Le libellé, lui, s’applique au périmètre choisi plus haut ; effacez-le pour retrouver le texte hérité. Les adresses sont en lecture seule.</p>
        <div class="navigation-links-tools">
          <label>Rechercher un lien<input type="search" [ngModel]="search()" (ngModelChange)="search.set($event)" placeholder="Nom ou adresse"></label>
          <button type="button" (click)="resetOrder()" [disabled]="!reordered()">Rétablir l’ordre du plan</button>
        </div>
        @if (search()) { <p class="navigation-links-note" role="status">{{ parts().length ? 'Le déplacement reprend dès que la recherche est vide.' : 'Aucun lien ne correspond à cette recherche.' }}</p> }
        <ul class="navigation-legend" aria-label="Zones de navigation">
          @for (surface of surfaceNames; track surface.id) { <li [attr.data-surface]="surface.id">{{ surface.label }}</li> }
        </ul>
        @for (part of parts(); track part.key) {
          <details class="navigation-part" [open]="opened(part.key)" (toggle)="toggled(part.key, $event)">
            <summary><strong>{{ part.label }}</strong><small>{{ part.key === '/' ? 'Liens rangés dans la page de contenu' : 'Menu de gauche, puis cadre supérieur de la page' }} · {{ size(part) }} liens</small>
              @if (changed(part)) { <em>Ordre modifié</em> }
            </summary>
            <div class="navigation-part-tools">
              <button type="button" (click)="fold(part, true)" [disabled]="!!search()">Replier les sous-niveaux</button>
              <button type="button" (click)="fold(part, false)" [disabled]="!!search()">Tout déplier</button>
            </div>
            <ng-container *ngTemplateOutlet="branch; context: { $implicit: part, depth: 0 }" />
          </details>
        }
      </fieldset>
      <ng-template #branch let-parent let-depth="depth">
        <ul class="navigation-tree" [attr.data-depth]="depth" cdkDropList [cdkDropListDisabled]="!!search()" (cdkDropListDropped)="drop(parent, $event)" [attr.aria-label]="'Liens de : ' + parent.label">
          @for (node of children(parent); track node.key; let index = $index) {
            <li class="navigation-node" cdkDrag cdkDragLockAxis="y" [cdkDragDisabled]="!!node.fixed || !!search()" [attr.data-level]="node.level" [class.is-fixed]="node.fixed" [class.is-moved]="moved() === parent.key + '>' + node.key">
              <div class="navigation-row">
                @if (node.fixed) { <span class="navigation-grip is-fixed" aria-hidden="true" title="La place de ce lien suit l’objet ouvert">·</span> }
                @else {
                  <button type="button" class="navigation-grip" cdkDragHandle [id]="gripId(parent, node)" [disabled]="!!search()"
                    [attr.aria-label]="'Déplacer : ' + node.label + ', position ' + (index + 1) + ' sur ' + movable(parent)" title="Glisser pour déplacer"
                    (keydown.arrowup)="step(parent, node, index, -1, $event)" (keydown.arrowdown)="step(parent, node, index, 1, $event)">⠿</button>
                }
                <span class="navigation-node-text"><span class="navigation-node-name">{{ node.label }}
                  @if (node.children?.length) { <button type="button" class="navigation-fold" (click)="toggleNode(node)" [attr.aria-expanded]="!folded(node)" [attr.aria-label]="(folded(node) ? 'Déplier : ' : 'Replier : ') + node.label"><span aria-hidden="true">{{ folded(node) ? '▸' : '▾' }}</span> {{ size(node) }}</button> }</span>
                  <small>{{ node.role }}@if (node.link) { · {{ node.link }} }</small>
                  <span class="navigation-node-surfaces">@for (surface of node.surfaces; track surface) { <i [attr.data-surface]="surface">{{ surfaceLabel(surface) }}</i> }</span>
                </span>
                @if (node.unlabeled) { <span class="navigation-node-label"></span> } @else {<input class="navigation-node-label" maxlength="100" [attr.aria-label]="'Libellé : ' + node.label + ' (' + node.key + ')'" [ngModel]="settings().labels?.[node.key] || ''" (ngModelChange)="setLabel(node.key, $event)" [placeholder]="node.label">}
                @if (!node.fixed) {
                  <span class="navigation-moves">
                    <button type="button" (click)="step(parent, node, index, -1)" [disabled]="index === 0 || !!search()" [attr.aria-label]="'Monter : ' + node.label" title="Monter">↑</button>
                    <button type="button" (click)="step(parent, node, index, 1)" [disabled]="index >= movable(parent) - 1 || !!search()" [attr.aria-label]="'Descendre : ' + node.label" title="Descendre">↓</button>
                  </span>
                }
              </div>
              @if (node.children?.length && !folded(node)) { <ng-container *ngTemplateOutlet="branch; context: { $implicit: node, depth: depth + 1 }" /> }
            </li>
          }
        </ul>
      </ng-template>
    </div>
  `,
})
export class NavigationSettingsPage {
  readonly nav = inject(NavigationSystem);
  readonly draft = signal<NavigationConfiguration>({ version: 1, scopes: {} });
  readonly dirty = signal(false); readonly busy = signal(false); readonly message = signal('');
  readonly scopeType = signal<'site' | 'module' | 'page'>('site'); readonly moduleId = signal('bpm'); readonly pageId = signal('/zones/bpm');
  readonly surface = signal<NavigationSurface>('primary'); readonly search = signal('');
  readonly levels: { id: NavigationLevel; label: string }[] = [{ id: 'section', label: 'Grandes sections' }, { id: 'page', label: 'Sous-sections et pages' }, { id: 'detail', label: 'Éléments et sous-pages' }];
  readonly colors = [{ key: 'color', label: 'Texte' }, { key: 'background', label: 'Fond' }, { key: 'activeColor', label: 'Texte actif' }, { key: 'activeBackground', label: 'Fond actif' }] as const;
  readonly scope = computed(() => this.scopeType() === 'site' ? 'site' : this.scopeType() === 'module' ? 'module:' + this.moduleId() : 'page:' + this.pageId());
  readonly settings = computed(() => this.draft().scopes[this.scope()] ?? {});
  readonly pages = computed(() => [...new Map(this.nav.catalog.entries.filter(e => e.module === this.moduleId()).map(e => [e.link, e])).values()]);
  readonly surfaceNames: { id: NavigationSurface; label: string }[] = [{ id: 'portal', label: 'Page d’accueil' }, { id: 'primary', label: 'Menu de gauche' }, { id: 'secondary', label: 'Onglets du cadre supérieur' }, { id: 'tertiary', label: 'Fil d’Ariane' }];
  private readonly injector = inject(Injector);
  private readonly toggledParts = signal<Record<string, boolean>>({});
  /** Le lien qui vient de bouger : il s'éclaire un instant à sa nouvelle place. */
  readonly moved = signal('');
  /** Les parties du site : l'accueil, puis chaque module (ou le seul module du périmètre choisi). */
  readonly parts = computed(() => {
    const needle = this.search().trim().toLocaleLowerCase();
    const scoped = this.nav.catalog.tree.filter(part => this.scopeType() === 'site' || part.key === '/' || part.key === 'zone:' + this.moduleId());
    return needle ? filterTree(scoped, node => (node.label + ' ' + (node.link ?? '')).toLocaleLowerCase().includes(needle)) : scoped;
  });
  readonly reordered = computed(() => Object.keys(this.draft().order ?? {}).length > 0);
  children(parent: NavigationNode) { return orderedChildren(parent, this.draft().order ?? {}); }
  movable(parent: NavigationNode) { return (parent.children ?? []).filter(child => !child.fixed).length; }
  size(node: NavigationNode): number { return (node.children ?? []).reduce((total, child) => total + 1 + this.size(child), 0); }
  changed(node: NavigationNode): boolean { return !!this.draft().order?.[node.key] || (node.children ?? []).some(child => this.changed(child)); }
  surfaceLabel(surface: NavigationSurface) { return this.surfaceNames.find(entry => entry.id === surface)?.label ?? surface; }
  gripId(parent: NavigationNode, node: NavigationNode) { return 'navigation-grip:' + parent.key + '>' + node.key; }
  opened(key: string) { return !!this.search() || (this.toggledParts()[key] ?? (key === '/' || key === 'zone:' + this.moduleId())); }
  toggled(key: string, event: Event) {
    const open = (event.target as HTMLDetailsElement).open;
    if (!this.search() && open !== this.opened(key)) this.toggledParts.update(value => ({ ...value, [key]: open }));
  }
  private readonly foldedNodes = signal<Record<string, boolean>>({});
  /** Un niveau replié libère la place pour déplacer ses voisins ; la recherche déplie tout. */
  folded(node: NavigationNode) { return !this.search() && !!this.foldedNodes()[node.key]; }
  toggleNode(node: NavigationNode) { this.foldedNodes.update(value => ({ ...value, [node.key]: !value[node.key] })); }
  fold(part: NavigationNode, folded: boolean) {
    const keys = (nodes: NavigationNode[]): string[] => nodes.flatMap(node => node.children?.length ? [node.key, ...keys(node.children)] : []);
    this.foldedNodes.update(value => ({ ...value, ...Object.fromEntries(keys(part.children ?? []).map(key => [key, folded])) }));
  }
  drop(parent: NavigationNode, event: CdkDragDrop<unknown>) { this.move(parent, event.previousIndex, event.currentIndex); }
  step(parent: NavigationNode, node: NavigationNode, index: number, delta: number, event?: Event) {
    event?.preventDefault();
    if (!this.move(parent, index, index + delta)) return;
    // Le déplacement au clavier garde la main sur la poignée du lien déplacé.
    if (event) afterNextRender(() => document.getElementById(this.gripId(parent, node))?.focus(), { injector: this.injector });
  }
  private move(parent: NavigationNode, from: number, to: number): boolean {
    const last = this.movable(parent) - 1;
    const target = Math.min(to, last);
    if (this.search() || from === target || from < 0 || target < 0 || from > last) return false;
    const key = parent.key + '>' + this.children(parent)[from].key;
    this.change(config => { const order = reorder(config.order ?? {}, parent, from, target); if (Object.keys(order).length) config.order = order; else delete config.order; });
    this.moved.set(key);
    setTimeout(() => { if (this.moved() === key) this.moved.set(''); }, 900);
    return true;
  }
  resetOrder() { this.change(config => { delete config.order; }); }
  constructor() { effect(() => { const value = this.nav.configuration(); if (!untracked(this.dirty)) this.draft.set(structuredClone(value)); }); }
  changeModule(id: string) { this.moduleId.set(id); this.pageId.set(this.pages()[0]?.link ?? '/'); }
  style(level: NavigationLevel): NavigationStyle { return this.settings().styles?.[this.surface()]?.[level] ?? {}; }
  private context() { return { module: this.scopeType() === 'site' ? undefined : this.moduleId(), page: this.scopeType() === 'page' ? this.pageId() : '' }; }
  preview(level: NavigationLevel) { return effectiveStyle(this.draft(), this.context(), this.surface(), level); }
  inherited(level: NavigationLevel) { const value = structuredClone(this.draft()); delete value.scopes[this.scope()]; return effectiveStyle(value, this.context(), this.surface(), level); }
  private change(update: (config: NavigationConfiguration) => void) { const value = structuredClone(this.draft()); update(value); this.draft.set(value); this.dirty.set(true); this.message.set(''); }
  setStyle(level: NavigationLevel, key: keyof NavigationStyle, input: string | number | null) {
    this.change(config => {
      const scope = config.scopes[this.scope()] ??= {}; const styles = scope.styles ??= {}; const levels = styles[this.surface()] ??= {}; const style = levels[level] ??= {};
      if (input === '' || input === null) delete style[key];
      else Object.assign(style, { [key]: key === 'size' || key === 'spacing' ? Number(input) : input });
    });
  }
  setLabel(key: string, input: string) { this.change(config => { const labels = (config.scopes[this.scope()] ??= {}).labels ??= {}; if (input.trim()) labels[key] = input.trim(); else delete labels[key]; }); }
  resetScope() { this.change(config => { delete config.scopes[this.scope()]; }); }
  discard() { this.draft.set(structuredClone(this.nav.configuration())); this.dirty.set(false); this.message.set('Modifications annulées.'); }
  async save() {
    this.busy.set(true); this.message.set('');
    try { await this.nav.save(this.draft()); this.dirty.set(false); this.message.set('Réglages enregistrés et appliqués à tout le site.'); }
    catch (error: any) { this.message.set(error?.error?.code === 'STALE_VERSION' ? 'Les réglages ont changé ailleurs. Rechargez la page pour relire leur dernière version avant de modifier.' : 'Enregistrement impossible. Vérifiez les tailles (12–28 px), espacements (0–20 px) et couleurs (#RRGGBB). Vos modifications sont conservées.'); }
    finally { this.busy.set(false); }
  }
}
