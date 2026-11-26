import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CalendarInteraction, CalendarFormatField, CalendarLayout } from './calendar.models';
import { FORMAT_FIELDS, LAYOUTS, LAYOUT_LABELS } from './calendar-formats';
import { injectCalendarPresentation } from './presentation/calendar-presentation';

interface ConfigFormat {
  id: string;
  libelle: string;
  disposition: CalendarLayout;
  champs: CalendarFormatField[];
  reperesParCase?: number;
}

interface Configuration {
  libelle: string;
  vue?: string;
  reperesParCase?: number;
  indicateurs?: string[];
  format?: string;
  formats?: ConfigFormat[];
  design?: string;
  effet?: string;
  elements: { id: string; libelle: string; disponible?: boolean; affiche?: boolean; branche?: boolean }[];
  interaction?: Partial<CalendarInteraction>;
}

/** Formats livrés par le module : toujours proposés, appelés par leur identifiant. */
const BUILT_IN = [
  { id: 'standard', label: 'Standard' },
  { id: 'compact', label: 'Compact' },
  { id: 'detaille', label: 'Détaillé' },
];

/**
 * Édite le contrat de l'instance (paramètre `calendrier.<id>`) sans modifier les règles métier ni le rendu
 * commun : accès au volet, commandes laissées à la personne, lecture initiale, sources (disponibles, branchées
 * et affichées au départ), formats propres à ce calendrier et format d'ouverture, indicateurs du survol.
 */
@Component({
  selector: 'rjs-calendar-settings-editor',
  imports: [FormsModule],
  styles: [`
    :host { display: block; min-width: 0; }
    .settings-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(240px,100%),1fr)); gap: 1rem; }
    fieldset { min-width: 0; margin: 0 0 1rem; padding: 1rem; border: 1px solid var(--line, #d5dce5); border-radius: 12px; }
    legend { font-weight: 650; padding: 0 .4rem; }
    label { display: flex; flex-wrap: wrap; align-items: center; gap: .65rem; margin: .7rem 0; }
    input[type=checkbox] { width: 1rem; height: 1rem; flex: 0 0 auto; }
    input[type=text], select { min-width: 0; flex: 1 1 180px; max-width: 100%; padding: .6rem; border: 1px solid #c5cedb; border-radius: 8px; background: var(--surface, white); color: inherit; }
    p, small { color: var(--muted, #637084); line-height: 1.5; }
    .source, .format { padding: .6rem 0; border-bottom: 1px solid var(--line, #e0e5ed); }
    .source:last-child, .format:last-of-type { border: 0; }
    .source-options, .format-fields { display: flex; flex-wrap: wrap; gap: .25rem 1rem; }
    .format-head { display: flex; flex-wrap: wrap; gap: .5rem 1rem; align-items: center; }
    .format-head > button, .add { border: 0; background: none; color: var(--link, #1d4ed8); cursor: pointer; padding: 0; font: inherit; }
  `],
  template: `
    @if (config(); as c) {
      <p>Une instance, un réglage commun à ses pages. Les cases magnifiées, l’aperçu et le panneau latéral utilisent les mêmes événements filtrés.</p>
      <div class="settings-grid">
        <fieldset><legend>Accès à « Sources et affichage »</legend>
          <label>Présentation <select aria-label="Accès aux réglages du calendrier" [ngModel]="c.interaction?.access ?? 'collapsed'" (ngModelChange)="interaction('access', $event)" [ngModelOptions]="{standalone:true}">
            <option value="collapsed">Volet fermé à l’ouverture</option>
            <option value="expanded">Volet ouvert à l’arrivée</option>
            <option value="hidden">Masqué · réglages imposés</option>
          </select></label>
          <p>Commandes que l’utilisateur peut modifier :</p>
          @for (control of controls; track control.key) {
            <label><input type="checkbox" [checked]="c.interaction?.controls?.[control.key] !== false" [disabled]="c.interaction?.access === 'hidden'" (change)="controlValue(control.key, $any($event.target).checked)" />{{ control.label }}</label>
          }
        </fieldset>
        <fieldset><legend>Lecture initiale</legend>
          <label>Vue <select aria-label="Vue initiale" [ngModel]="c.vue ?? 'mois'" (ngModelChange)="change('vue', $event)" [ngModelOptions]="{standalone:true}"><option value="semaine">Semaine</option><option value="mois">Mois</option><option value="annee">Année</option></select></label>
          <label>Événements par case <select aria-label="Nombre initial d’événements par case" [ngModel]="c.reperesParCase ?? 2" (ngModelChange)="change('reperesParCase', $event)" [ngModelOptions]="{standalone:true}">@for (n of [0,1,2,3,4,5,6,7,8]; track n) {<option [ngValue]="n">{{n}}</option>}</select></label>
          <label>Format d’ouverture <select aria-label="Format d’affichage à l’ouverture" [ngModel]="c.format ?? 'standard'" (ngModelChange)="change('format', $event)" [ngModelOptions]="{standalone:true}">
            @for (f of formatChoices(); track f.id) { <option [value]="f.id">{{ f.label }}</option> }
          </select></label>
          <label>Design <select aria-label="Design à l’ouverture" [ngModel]="c.design ?? 'standard'" (ngModelChange)="change('design', $event === 'standard' ? undefined : $event)" [ngModelOptions]="{standalone:true}">
            @for (d of presentation.designs; track d.id) { <option [value]="d.id">{{ d.label }}</option> }
          </select></label>
          <label>Effets d’affichage <select aria-label="Effets d’affichage à l’ouverture" [ngModel]="c.effet ?? 'standard'" (ngModelChange)="change('effet', $event === 'standard' ? undefined : $event)" [ngModelOptions]="{standalone:true}">
            @for (e of presentation.effects; track e.id) { <option [value]="e.id">{{ e.label }}</option> }
          </select></label>
          <label><input type="checkbox" [checked]="c.interaction?.includeDone !== false" (change)="interaction('includeDone', $any($event.target).checked)" />Inclure les éléments terminés</label>
          <small>L’apparence et les effets restent définis par le module Calendrier.</small>
        </fieldset>
      </div>
      <fieldset><legend>Sources de cette instance</legend>
        <p>Disponible : lisible dans ce calendrier. Branchée au départ : lue avant tout choix personnel (sinon proposée au branchement). Affichée au départ : visible avant tout choix personnel. Les sources d’autres calendriers sont proposées par la page qui affiche le calendrier.</p>
        @for (source of c.elements; track source.id; let i = $index) {
          <div class="source"><strong>{{source.libelle}}</strong><div class="source-options">
            <label><input type="checkbox" [attr.aria-label]="source.libelle + ' · Disponible'" [checked]="source.disponible !== false" (change)="sourceValue(i, 'disponible', $any($event.target).checked)" />Disponible</label>
            <label><input type="checkbox" [attr.aria-label]="source.libelle + ' · Branchée au départ'" [checked]="source.branche !== false" [disabled]="source.disponible === false" (change)="sourceValue(i, 'branche', $any($event.target).checked)" />Branchée au départ</label>
            <label><input type="checkbox" [attr.aria-label]="source.libelle + ' · Affichée au départ'" [checked]="source.affiche !== false" [disabled]="source.disponible === false || source.branche === false" (change)="sourceValue(i, 'affiche', $any($event.target).checked)" />Affichée au départ</label>
          </div></div>
        }
      </fieldset>
      <fieldset><legend>Formats propres à ce calendrier</legend>
        <p>Proposés à côté des formats livrés (Standard, Compact, Détaillé). Chaque personne peut aussi créer les siens.</p>
        @for (f of c.formats ?? []; track f.id; let i = $index) {
          <div class="format">
            <div class="format-head">
              <label>Nom <input type="text" [attr.aria-label]="'Nom du format ' + f.libelle" [ngModel]="f.libelle" (ngModelChange)="formatValue(i, 'libelle', $event)" [ngModelOptions]="{standalone:true}" /></label>
              <label>Disposition <select [attr.aria-label]="'Disposition du format ' + f.libelle" [ngModel]="f.disposition" (ngModelChange)="formatValue(i, 'disposition', $event)" [ngModelOptions]="{standalone:true}">@for (l of layouts; track l) {<option [value]="l">{{ layoutLabels[l] }}</option>}</select></label>
              <label>Par case <select [attr.aria-label]="'Événements par case du format ' + f.libelle" [ngModel]="f.reperesParCase ?? null" (ngModelChange)="formatValue(i, 'reperesParCase', $event)" [ngModelOptions]="{standalone:true}"><option [ngValue]="null">Selon le calendrier</option>@for (n of [0,1,2,3,4,5,6,7,8]; track n) {<option [ngValue]="n">{{n}}</option>}</select></label>
              <button type="button" (click)="removeFormat(i)" [attr.aria-label]="'Retirer le format ' + f.libelle">Retirer</button>
            </div>
            <div class="format-fields" role="group" [attr.aria-label]="'Informations du format ' + f.libelle + ', dans l’ordre de sélection'">
              @for (field of fields; track field.key) {
                <label><input type="checkbox" [checked]="f.champs.includes(field.key)" (change)="formatField(i, field.key, $any($event.target).checked)" />{{ field.label }}@if (f.champs.includes(field.key)) { <small>({{ f.champs.indexOf(field.key) + 1 }})</small> }</label>
              }
            </div>
          </div>
        }
        <button type="button" class="add" (click)="addFormat()">+ Ajouter un format</button>
      </fieldset>
      <fieldset><legend>Indicateurs proposés au survol</legend>
        <p>Entre un et quatre indicateurs, partagés avec le bilan du jour.</p>
        @for (indicator of indicators; track indicator.key) {<label><input type="checkbox" [checked]="(c.indicateurs ?? ['elements','dates','suivi']).includes(indicator.key)" (change)="toggleIndicator(indicator.key, $any($event.target).checked)" />{{indicator.label}}</label>}
      </fieldset>
      <p>Après enregistrement, les pages relues appliquent la nouvelle révision. Les préférences personnelles repartent des valeurs définies ici.</p>
    }
  `,
})
export class CalendarSettingsEditorComponent {
  readonly value = input.required<string>();
  readonly valueChange = output<string>();
  protected readonly config = computed(() => {
    try { return JSON.parse(this.value()) as Configuration; } catch { return null; }
  });
  protected readonly fields = FORMAT_FIELDS;
  protected readonly layouts = LAYOUTS;
  protected readonly layoutLabels = LAYOUT_LABELS;
  protected readonly formatChoices = computed(() => [...BUILT_IN, ...(this.config()?.formats ?? []).map((f) => ({ id: f.id, label: f.libelle }))]);
  protected readonly controls: { key: keyof CalendarInteraction['controls']; label: string }[] = [
    { key: 'sources', label: 'Choix et branchement des sources' }, { key: 'fields', label: 'Format d’affichage (choisir, créer)' },
    { key: 'indicators', label: 'Indicateurs au survol' }, { key: 'density', label: 'Nombre d’événements par case' },
    { key: 'completed', label: 'Inclusion des éléments terminés' },
    { key: 'appearance', label: 'Apparence (design et effets d’affichage)' },
  ];
  /** Designs et effets proposés : ceux du module, puis ceux du site. */
  protected readonly presentation = injectCalendarPresentation();
  protected readonly indicators = [{key:'elements',label:'Éléments'}, {key:'dates',label:'Dates'}, {key:'suivi',label:'Suivi'}, {key:'flux',label:'Flux'}, {key:'solde',label:'Solde'}];
  protected change(key: string, value: unknown) {
    const next: Record<string, unknown> = { ...this.config(), [key]: value };
    if (value === undefined) delete next[key];
    this.valueChange.emit(JSON.stringify(next, null, 2));
  }
  protected interaction(key: string, value: unknown) { this.change('interaction', {...this.config()?.interaction, [key]: value}); }
  protected controlValue(key: string, value: boolean) { this.interaction('controls', {...this.config()?.interaction?.controls, [key]: value}); }
  protected sourceValue(index: number, key: string, value: boolean) { this.change('elements', this.config()!.elements.map((s,i) => i === index ? {...s, [key]:value} : s)); }
  protected toggleIndicator(key: string, checked: boolean) { const current = this.config()?.indicateurs ?? ['elements','dates','suivi']; this.change('indicateurs', checked ? [...current,key] : current.filter(k=>k!==key)); }

  // ---------- formats de la configuration ----------
  private setFormats(formats: ConfigFormat[]) {
    const c = this.config()!;
    const ids = new Set([...BUILT_IN.map((f) => f.id), ...formats.map((f) => f.id)]);
    const next: Record<string, unknown> = { ...c, formats };
    // Le format d'ouverture suit : un format retiré ramène au format standard.
    if (c.format && !ids.has(c.format)) delete next['format'];
    this.valueChange.emit(JSON.stringify(next, null, 2));
  }
  protected addFormat() {
    const formats = this.config()?.formats ?? [];
    const taken = new Set([...BUILT_IN.map((f) => f.id), ...formats.map((f) => f.id)]);
    let n = formats.length + 1;
    while (taken.has(`format-${n}`)) n++;
    this.setFormats([...formats, { id: `format-${n}`, libelle: `Format ${n}`, disposition: 'ligne', champs: ['amount', 'total'] }]);
  }
  protected removeFormat(index: number) { this.setFormats((this.config()?.formats ?? []).filter((_, i) => i !== index)); }
  protected formatValue(index: number, key: keyof ConfigFormat, value: unknown) {
    this.setFormats((this.config()?.formats ?? []).map((f, i) => {
      if (i !== index) return f;
      const next = { ...f, [key]: value } as ConfigFormat;
      if (key === 'reperesParCase' && value === null) delete next.reperesParCase;
      return next;
    }));
  }
  /** Cocher ajoute l'information en fin d'ordre ; décocher la retire. */
  protected formatField(index: number, field: CalendarFormatField, on: boolean) {
    const f = this.config()?.formats?.[index];
    if (!f) return;
    this.formatValue(index, 'champs', on ? [...f.champs.filter((c) => c !== field), field] : f.champs.filter((c) => c !== field));
  }
}
