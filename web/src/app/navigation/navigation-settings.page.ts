import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationSystem } from './navigation.service';
import { NavigationConfiguration, NavigationLevel, NavigationStyle, NavigationSurface, effectiveStyle } from './navigation-model';
@Component({
  selector: 'rjs-navigation-settings', imports: [FormsModule], changeDetection: ChangeDetectionStrategy.OnPush,
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
      <fieldset [disabled]="busy() || !nav.ready()"><legend>Libellés des liens</legend>
        <p>Le libellé est commun aux occurrences du lien dans le périmètre choisi. Effacez-le pour retrouver le texte hérité. Les adresses sont en lecture seule.</p>
        <label>Rechercher un lien<input type="search" [ngModel]="search()" (ngModelChange)="search.set($event)" placeholder="Nom ou adresse"></label>
        @for (entry of entries(); track entry.key) {
          <label class="navigation-label-editor"><span>{{ entry.label }}<small>{{ entry.module || 'Site' }} · {{ entry.level }} · {{ entry.link }}</small></span>
            <input maxlength="100" [attr.aria-label]="'Libellé : ' + entry.label + ' (' + entry.key + ')'" [ngModel]="settings().labels?.[entry.key] || ''" (ngModelChange)="setLabel(entry.key, $event)" [placeholder]="entry.label"></label>
        }
      </fieldset>
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
  readonly entries = computed(() => this.nav.catalog.entries.filter(e => (this.scopeType() === 'site' || e.module === this.moduleId() || !e.module) && (e.label + e.link).toLocaleLowerCase().includes(this.search().toLocaleLowerCase())));
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
