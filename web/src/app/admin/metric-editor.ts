import { Component, computed, effect, ElementRef, inject, input, signal, untracked, viewChild } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api, ApiError, RecetteContext, toApiError } from '../core/api.service';
import { BpmApi } from '../core/bpm-api.service';
import { FigureEvaluation, FormulaReference, MetricCatalog, MetricDefinitionRow, Period } from '../core/models';
import { CalcTrace } from '../shared/calc-trace';
import { AppHeroComponent, HeroChip } from '../shared/app-hero.component';
import { functionDoc } from './metrics';

@Component({
  selector: 'app-metric-editor',
  imports: [RouterLink, JsonPipe, CalcTrace, AppHeroComponent],
  // Gabarits de la source : Configuration (cartes, héritage, comparaison d'impact).
  styleUrls: ['./configuration.page.scss', './admin-pages.scss'],
  template: `
    <section class="page cfg-page" data-ui-pattern="page" aria-labelledby="adm-formula-title">
      <rjs-app-hero
        data-sticky-hero
        tone="indigo"
        headingId="adm-formula-title"
        [title]="def()?.label ?? key()"
        kicker="Administration du site · Calculs · Formule"
        [lead]="'Paramètre metric.' + key() + ' : formule du chiffre, aperçu sur les données du user actif puis enregistrement révisé.'"
        [chips]="heroChips()"
      >
        <a heroActions class="app-hero-action is-secondary" routerLink="/admin/calculs">← Catalogue des calculs</a>
        <a heroActions class="app-hero-action is-secondary" routerLink="/admin">Administration</a>
      </rjs-app-hero>

      @if (loadError()) {
        <p class="cfg-error" role="alert">{{ loadError() }}</p>
        <div class="cfg-actions"><a class="btn btn-secondary" routerLink="/admin/calculs">Retour au catalogue</a></div>
      } @else if (def(); as d) {
        <div class="adm-layout is-editor">
          <div class="adm-panel-stack">
            <section class="cfg-panel" data-ui-pattern="panel" aria-labelledby="adm-def-title">
              <span class="cfg-number"><code>{{ key() }}</code> · paramètre <code>metric.{{ key() }}</code></span>
              <h2 id="adm-def-title">Définition</h2>
              @if (d.description) {
                <p>{{ d.description }}</p>
              }
              <div class="cfg-inheritance">
                <dl>
                  <div><dt>Unité</dt><dd>{{ d.unit }} <small>· {{ d.decimals }} décimale(s)</small></dd></div>
                  <div><dt>Groupe</dt><dd>{{ d.group ?? '—' }}</dd></div>
                  <div><dt>Module</dt><dd>{{ d.module }}</dd></div>
                  <div><dt>Origine</dt><dd>{{ d.parameter.origin }} <small>· révision {{ d.parameter.revision }}</small></dd></div>
                  @if (d.parameter.updatedAt) {
                    <div><dt>Modifiée le</dt><dd>{{ d.parameter.updatedAt }}</dd></div>
                  }
                </dl>
              </div>
              <h3>Formule actuelle</h3>
              <p class="adm-formula">{{ d.formula }}</p>
              <h3>Formule par défaut (code)</h3>
              <p class="adm-formula">{{ d.defaultFormula }}</p>
              @if (d.references.length) {
                <p class="cfg-hint">Références : @for (r of d.references; track r) {<code>{{ r }}</code>{{ $last ? '' : ', ' }}}</p>
              }
              @if (d.parameter.history.length) {
                <details class="adm-history">
                  <summary>Historique ({{ d.parameter.history.length }})</summary>
                  <ol reversed>
                    @for (h of d.parameter.history.slice().reverse(); track h.revision) {
                      <li>
                        <strong>révision {{ h.revision }}</strong> · {{ h.at }}{{ h.note ? ' · ' + h.note : '' }}<br />
                        <code>{{ h.previous | json }}</code> → <code>{{ h.value | json }}</code>
                      </li>
                    }
                  </ol>
                </details>
              }
            </section>

            @if (saved(); as s) {
              <div class="cfg-success" role="status">
                <p><strong>{{ s }}</strong></p>
                <p>Tous les chiffres qui utilisent cette métrique (tableau de bord, clôtures à venir) emploient désormais la nouvelle formule.</p>
                <p>Les clôtures passées conservent la formule et la révision enregistrées au moment de la clôture.</p>
              </div>
            }

            <section class="cfg-panel" data-ui-pattern="panel" aria-labelledby="adm-edit-title">
              <span class="cfg-number">{{ dirty() ? 'Brouillon non enregistré' : 'Formule enregistrée' }}</span>
              <h2 id="adm-edit-title">Éditer la formule</h2>
              <form class="adm-edit" (submit)="$event.preventDefault(); preview()">
                <label>
                  <span>Formule</span>
                  <textarea #editor [value]="formula()" (input)="onInput($any($event.target).value)" spellcheck="false" rows="4" aria-describedby="formula-help"></textarea>
                  <small class="cfg-hint" id="formula-help">Cliquer une référence ou une fonction de la palette l'insère au curseur.</small>
                </label>

                @if (formulaError(); as e) {
                  <div class="cfg-error" role="alert">
                    <strong>{{ e.body.code === 'FORMULA_INVALID' ? 'Formule invalide' : e.body.code }}</strong> — {{ e.message }}
                    @if (e.body.details?.['reference']) {
                      <p>Référence en cause : <code>{{ e.body.details?.['reference'] }}</code>. Utiliser une référence de la palette.</p>
                    }
                    @if (e.isConflict) {
                      <p>La formule a été modifiée entre-temps (révision actuelle différente). Votre saisie est conservée.</p>
                      <button type="button" class="btn btn-secondary" (click)="reloadDefinition()">Relire la version actuelle</button>
                    }
                  </div>
                }

                <div class="adm-row">
                  <label class="adm-field">
                    <span>Période de l'aperçu</span>
                    <select [value]="periodKey()" (change)="periodKey.set($any($event.target).value)" [disabled]="!periods().length">
                      <option value="">Période courante</option>
                      @for (p of periods(); track p.key) {
                        <option [value]="p.key">{{ p.label }}{{ p.status ? ' (' + statusLabel(p.status) + ')' : '' }}</option>
                      }
                    </select>
                  </label>
                  <button class="btn btn-secondary" type="submit" [disabled]="busy() || !ctx.userId()">Aperçu</button>
                </div>
                @if (!ctx.userId()) {
                  <p class="cfg-hint">L'aperçu est évalué sur les données du user actif : choisir un user dans l'en-tête.</p>
                } @else {
                  <p class="cfg-hint">Aperçu évalué sur les données du user actif, sans rien enregistrer.</p>
                }

                <label>
                  <span>Note de modification (facultative)</span>
                  <input [value]="note()" (input)="note.set($any($event.target).value)" maxlength="300" />
                </label>
                <div class="cfg-actions">
                  <button class="btn btn-primary" type="button" (click)="save()" [disabled]="busy() || !dirty()">{{ busy() ? 'En cours…' : 'Enregistrer' }}</button>
                  <button class="btn btn-secondary" type="button" (click)="formula.set(d.formula); formulaError.set(null)" [disabled]="!dirty()">Annuler la saisie</button>
                  @if (d.parameter.origin === 'administration') {
                    <button class="btn btn-secondary" type="button" (click)="reset()" [disabled]="busy()">Revenir à la formule par défaut</button>
                  }
                </div>
              </form>
            </section>

            @if (comparison(); as cmp) {
              <section class="cfg-panel" data-ui-pattern="panel" aria-live="polite" aria-labelledby="adm-preview-title">
                <span class="cfg-number">Aperçu non enregistré</span>
                <h2 id="adm-preview-title">Aperçu{{ cmp.current.period ? ' — ' + cmp.current.period.label : '' }}</h2>
                <div class="cfg-impact">
                  <div>
                    <h3>Formule actuelle</h3>
                    <app-calc-trace [figure]="cmp.current" />
                  </div>
                  <div>
                    <h3>Formule proposée (non enregistrée)</h3>
                    <app-calc-trace [figure]="cmp.preview" />
                  </div>
                </div>
              </section>
            }
          </div>

          <aside class="cfg-panel" data-ui-pattern="panel" aria-labelledby="adm-palette-title">
            <span class="cfg-number">Références</span>
            <h2 id="adm-palette-title">Palette</h2>
            <h3>Variables (niveau 2)</h3>
            <div class="adm-chips">
              @for (r of variables(); track r.name) {
                <button type="button" class="adm-chip" (click)="insert(r.name)" [title]="r.label + ' (' + r.unit + ') — ' + (r.description ?? '')">{{ r.name }}</button>
              }
            </div>
            <h3>Métriques</h3>
            <div class="adm-chips">
              @for (r of metricRefs(); track r.name) {
                <button type="button" class="adm-chip" [disabled]="r.name === key()" (click)="insert(r.name)" [title]="r.label + ' (' + r.unit + ')'">{{ r.name }}</button>
              }
            </div>
            <h3>Fonctions</h3>
            <div class="adm-chips">
              @for (f of functions(); track f) {
                <button type="button" class="adm-chip" (click)="insert(f + '(', ')')" [title]="doc(f).signature + ' : ' + doc(f).doc">{{ doc(f).signature }}</button>
              }
            </div>
            <h3>Opérateurs</h3>
            <div class="adm-chips">
              @for (o of operators; track o) {
                <button type="button" class="adm-chip" (click)="insert(' ' + o + ' ')">{{ o }}</button>
              }
            </div>
            <p class="cfg-hint">Une valeur inconnue se propage ; <code>siInconnu(x, 0)</code> la remplace explicitement.</p>
          </aside>
        </div>
      } @else {
        <p class="cfg-notice" role="status">Chargement…</p>
      }
    </section>
  `,
})
export class MetricEditor {
  readonly key = input.required<string>();
  private api = inject(Api);
  private bpm = inject(BpmApi);
  protected ctx = inject(RecetteContext);
  private editor = viewChild<ElementRef<HTMLTextAreaElement>>('editor');

  protected def = signal<MetricDefinitionRow | null>(null);
  protected catalog = signal<MetricCatalog | null>(null);
  protected periods = signal<Period[]>([]);
  protected loadError = signal<string | null>(null);

  protected formula = signal('');
  protected note = signal('');
  protected periodKey = signal('');
  protected busy = signal(false);
  protected formulaError = signal<ApiError | null>(null);
  protected comparison = signal<{ current: FigureEvaluation; preview: FigureEvaluation } | null>(null);
  protected saved = signal<string | null>(null);

  protected operators = ['+', '-', '*', '/', '(', ')', '>', '<', '>=', '<=', '==', '!='];
  protected doc = functionDoc;

  protected dirty = computed(() => !!this.def() && this.formula().trim() !== this.def()!.formula.trim() && this.formula().trim() !== '');
  /** Pastilles du bandeau : définition lue (unité, origine, révision, groupe). */
  protected heroChips = computed<HeroChip[]>(() => {
    const d = this.def();
    if (!d) return [];
    return [
      { label: 'Unité', value: d.unit },
      { label: 'Origine', value: d.parameter.origin },
      { label: 'Révision', value: String(d.parameter.revision) },
      { label: 'Groupe', value: d.group ?? '—' },
    ];
  });
  protected variables = computed<FormulaReference[]>(() => (this.catalog()?.references ?? []).filter((r) => r.type === 'variable'));
  protected metricRefs = computed<FormulaReference[]>(() => (this.catalog()?.references ?? []).filter((r) => r.type === 'metric'));
  protected functions = computed(() => this.catalog()?.functions ?? []);

  constructor() {
    // La même instance peut servir plusieurs clés (lien vers une métrique référencée).
    effect(() => {
      const key = this.key();
      untracked(() => this.load(key));
    });
    // Périodes du user actif (pour l'aperçu) ; l'aperçu précédent ne vaut plus pour un autre user.
    effect(() => {
      const userId = this.ctx.userId();
      untracked(() => {
        this.comparison.set(null);
        this.loadPeriods(userId);
      });
    });
  }

  private async load(key: string) {
    this.loadError.set(null);
    this.def.set(null);
    this.comparison.set(null);
    this.formulaError.set(null);
    this.saved.set(null);
    try {
      const [def, catalog] = await Promise.all([this.api.metric(key), this.catalog() ? Promise.resolve(this.catalog()!) : this.api.metricCatalog()]);
      this.def.set(def);
      this.catalog.set(catalog);
      this.formula.set(def.formula);
      this.note.set('');
    } catch (err) {
      this.loadError.set(toApiError(err).message);
    }
  }

  private async loadPeriods(userId: string | null) {
    this.periods.set([]);
    this.periodKey.set('');
    if (!userId) return;
    try {
      const dash = await this.bpm.dashboard();
      this.periods.set(dash.cycle?.periods ?? []);
    } catch {
      // Sans cycle configuré, l'aperçu porte sur la période courante calculée par l'API.
    }
  }

  async reloadDefinition() {
    try {
      const def = await this.api.metric(this.key());
      this.def.set(def);
      this.formulaError.set(null);
    } catch (err) {
      this.formulaError.set(toApiError(err));
    }
  }

  protected statusLabel(s: string) {
    return ({ closed: 'close', ended: 'terminée', current: 'en cours', future: 'à venir' } as Record<string, string>)[s] ?? s;
  }

  onInput(value: string) {
    this.formula.set(value);
    this.saved.set(null);
  }

  /** Insère au curseur (ou remplace la sélection) ; `after` entoure la sélection (ex. fonctions). */
  insert(text: string, after = '') {
    const el = this.editor()?.nativeElement;
    const value = this.formula();
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    const next = value.slice(0, start) + text + selected + after + value.slice(end);
    this.formula.set(next);
    if (el) {
      el.value = next;
      const caret = start + text.length + selected.length;
      el.focus();
      el.setSelectionRange(caret, caret);
    }
  }

  async preview() {
    if (!this.ctx.userId()) return;
    this.formulaError.set(null);
    this.busy.set(true);
    try {
      this.comparison.set(await this.api.previewMetric(this.key(), { formula: this.formula(), periodKey: this.periodKey() || undefined }));
    } catch (err) {
      this.comparison.set(null);
      this.formulaError.set(toApiError(err));
    } finally {
      this.busy.set(false);
    }
  }

  async save() {
    const d = this.def();
    if (!d) return;
    this.formulaError.set(null);
    this.busy.set(true);
    try {
      const res = await this.api.setParameter('metric.' + this.key(), { value: this.formula().trim(), expectedRevision: d.parameter.revision, note: this.note().trim() || undefined });
      await this.afterWrite(`Formule enregistrée (révision ${res.parameter.revision}).`);
    } catch (err) {
      this.formulaError.set(toApiError(err));
    } finally {
      this.busy.set(false);
    }
  }

  async reset() {
    const d = this.def();
    if (!d) return;
    this.formulaError.set(null);
    this.busy.set(true);
    try {
      const res = await this.api.resetParameter('metric.' + this.key(), d.parameter.revision);
      await this.afterWrite(`Formule par défaut rétablie (révision ${res.parameter.revision}).`);
    } catch (err) {
      this.formulaError.set(toApiError(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async afterWrite(message: string) {
    const def = await this.api.metric(this.key());
    this.def.set(def);
    this.formula.set(def.formula);
    this.note.set('');
    this.comparison.set(null);
    this.catalog.set(await this.api.metricCatalog());
    this.saved.set(message);
  }
}
