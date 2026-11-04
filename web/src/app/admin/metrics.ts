import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, toApiError } from '../core/api.service';
import { FormulaReference, MetricCatalog, MetricDefinitionRow } from '../core/models';
import { AppHeroComponent, HeroChip } from '../shared/app-hero.component';

/** Documentation d'une ligne des fonctions admises dans une formule. */
export const FUNCTION_DOCS: Record<string, { signature: string; doc: string }> = {
  min: { signature: 'min(a, b, …)', doc: 'plus petite des valeurs (inconnue si une valeur est inconnue)' },
  max: { signature: 'max(a, b, …)', doc: 'plus grande des valeurs (inconnue si une valeur est inconnue)' },
  abs: { signature: 'abs(x)', doc: 'valeur absolue' },
  arrondi: { signature: 'arrondi(x, n)', doc: 'arrondi à n décimales (0 par défaut)' },
  pourcentage: { signature: 'pourcentage(part, total)', doc: 'part / total × 100 ; inconnu si le total vaut 0' },
  si: { signature: 'si(condition, alors, sinon)', doc: 'choisit « alors » si la condition est vraie, sinon « sinon »' },
  siInconnu: { signature: 'siInconnu(x, v)', doc: 'remplace une valeur inconnue par v (explicite)' },
};

export function functionDoc(name: string) {
  return FUNCTION_DOCS[name] ?? { signature: `${name}(…)`, doc: '' };
}

@Component({
  selector: 'app-admin-metrics',
  imports: [RouterLink, AppHeroComponent],
  // Gabarits de la source : Configuration (cartes) et Journal d'activité (tableaux).
  styleUrls: ['./configuration.page.scss', './audit-admin.page.scss', './admin-pages.scss'],
  template: `
    <section class="page cfg-page" data-ui-pattern="page" aria-labelledby="adm-metrics-title">
      <rjs-app-hero
        data-sticky-hero
        tone="indigo"
        headingId="adm-metrics-title"
        title="Calculs des chiffres présentés"
        kicker="Administration du site · Calculs"
        lead="Chaque chiffre affiché par l'application est une métrique ; sa formule est le paramètre administrable metric.<clé>. Une valeur inconnue se propage : elle n'est jamais remplacée par 0 sans siInconnu(x, 0) explicite."
        [chips]="heroChips()"
      >
        <button heroActions type="button" class="app-hero-action" (click)="load()">Relire</button>
        <a heroActions class="app-hero-action is-secondary" routerLink="/admin">← Administration</a>
      </rjs-app-hero>

      @if (error()) {
        <p class="cfg-error" role="alert">{{ error() }}</p>
      }

      @if (catalog(); as c) {
        <div class="adm-layout">
          <div class="adm-panel-stack" role="region" aria-label="Métriques">
            @for (g of groups(); track g.group; let gi = $index) {
              <section class="cfg-panel" data-ui-pattern="panel" [attr.aria-labelledby]="'adm-metric-group-' + gi">
                <span class="cfg-number">{{ g.metrics.length }} chiffre(s)</span>
                <h2 [id]="'adm-metric-group-' + gi">{{ g.group }}</h2>
                <div class="audit-table-wrap" role="region" tabindex="0" [attr.aria-label]="'Métriques — ' + g.group">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Chiffre</th>
                        <th scope="col">Unité</th>
                        <th scope="col">Formule actuelle</th>
                        <th scope="col">Origine</th>
                        <th scope="col"><span class="visually-hidden">Action</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (m of g.metrics; track m.key) {
                        <tr>
                          <td><strong>{{ m.label }}</strong><small><code>{{ m.key }}</code></small></td>
                          <td>{{ m.unit }}</td>
                          <td><code class="adm-formula">{{ m.formula }}</code></td>
                          <td>
                            <strong>{{ m.parameter.origin === 'administration' ? 'Réglé' : 'Valeur livrée' }}</strong>
                            <small>{{ m.parameter.origin }} · rév. {{ m.parameter.revision }}</small>
                          </td>
                          <td><a class="btn btn-secondary" [routerLink]="['/admin/calculs', m.key]" [attr.aria-label]="'Éditer la formule : ' + m.label">Éditer</a></td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </section>
            }
          </div>

          <aside class="cfg-panel" data-ui-pattern="panel" aria-labelledby="adm-refs-title">
            <span class="cfg-number">Références utilisables</span>
            <h2 id="adm-refs-title">Références disponibles</h2>
            <p>Variables fournies par les modules de niveau 2 (données sources) et métriques (formules réutilisables).</p>
            <h3>Variables ({{ variables().length }})</h3>
            <ul class="adm-refs">
              @for (r of variables(); track r.name) {
                <li>
                  <code>{{ r.name }}</code> · {{ r.label }}
                  <small>{{ r.unit }} · {{ r.module }}{{ r.description ? ' — ' + r.description : '' }}</small>
                </li>
              }
            </ul>
            <h3>Métriques ({{ metricRefs().length }})</h3>
            <ul class="adm-refs">
              @for (r of metricRefs(); track r.name) {
                <li>
                  <a [routerLink]="['/admin/calculs', r.name]"><code>{{ r.name }}</code></a> · {{ r.label }}
                  <small>{{ r.unit }} · {{ r.module }}{{ r.description ? ' — ' + r.description : '' }}</small>
                </li>
              }
            </ul>
            <h3>Fonctions</h3>
            <ul class="adm-refs">
              @for (f of c.functions; track f) {
                <li><code>{{ doc(f).signature }}</code><small>{{ doc(f).doc }}</small></li>
              }
            </ul>
            <h3>Opérateurs</h3>
            <p class="cfg-hint"><code>+ - * /</code>, parenthèses, comparaisons <code>&gt; &lt; &gt;= &lt;= == !=</code> (dans <code>si</code>), nombres décimaux avec un point (<code>1.5</code>).</p>
          </aside>
        </div>
      } @else if (!error()) {
        <p class="cfg-notice" role="status">Chargement…</p>
      }
    </section>
  `,
})
export class AdminMetrics implements OnInit {
  private api = inject(Api);
  protected catalog = signal<MetricCatalog | null>(null);
  protected error = signal<string | null>(null);
  protected doc = functionDoc;

  protected groups = computed(() => {
    const groups = new Map<string, MetricDefinitionRow[]>();
    for (const m of this.catalog()?.metrics ?? []) {
      const g = m.group ?? 'Sans groupe';
      groups.set(g, [...(groups.get(g) ?? []), m]);
    }
    return [...groups].map(([group, metrics]) => ({ group, metrics }));
  });
  /** Pastilles du bandeau : volumes du catalogue lu. */
  protected heroChips = computed<HeroChip[]>(() => {
    const c = this.catalog();
    if (!c) return [];
    return [
      { label: 'Chiffres', value: String(c.metrics.length) },
      { label: 'Administrés', value: String(c.metrics.filter((m) => m.parameter.origin === 'administration').length) },
      { label: 'Variables', value: String(this.variables().length) },
      { label: 'Fonctions', value: String(c.functions.length) },
    ];
  });
  protected variables = computed<FormulaReference[]>(() => (this.catalog()?.references ?? []).filter((r) => r.type === 'variable'));
  protected metricRefs = computed<FormulaReference[]>(() => (this.catalog()?.references ?? []).filter((r) => r.type === 'metric'));

  ngOnInit() {
    this.load();
  }

  async load() {
    this.error.set(null);
    try {
      this.catalog.set(await this.api.metricCatalog());
    } catch (err) {
      this.error.set(toApiError(err).message);
    }
  }
}
