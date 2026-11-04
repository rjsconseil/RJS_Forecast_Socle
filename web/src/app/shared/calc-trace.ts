import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FigureEvaluation, FigureInput, FigureSource, MetricParameterRef } from '../core/models';
import { EurosPipe, FigureValuePipe, ShortDatePipe, shortId } from '../core/format';

// ---------------------------------------------------------------------------
// Outils partagés : formule surlignée, provenance du paramètre, libellés.
// ---------------------------------------------------------------------------

export interface FormulaToken {
  text: string;
  kind: 'ref' | 'fn' | 'num' | 'op' | 'space';
  title?: string;
}

const TOKEN_RE = /([A-Za-zÀ-ÖØ-öø-ÿ_][\wÀ-ÖØ-öø-ÿ]*(?:\.[\wÀ-ÖØ-öø-ÿ]+)*)|(\d+(?:[.,]\d+)?)|(\s+)|([\s\S])/gu;

/** Découpe une formule pour la présenter : références (variables / chiffres), fonctions, nombres, opérateurs. */
export function tokenizeFormula(formula: string, labels: Map<string, string> = new Map()): FormulaToken[] {
  const out: FormulaToken[] = [];
  const src = formula ?? '';
  for (const m of src.matchAll(TOKEN_RE)) {
    const [text, ident, num, space] = m;
    if (ident) {
      const rest = src.slice((m.index ?? 0) + text.length);
      const isFn = /^\s*\(/.test(rest);
      out.push(isFn ? { text, kind: 'fn' } : { text, kind: 'ref', title: labels.get(text) });
    } else if (num) out.push({ text, kind: 'num' });
    else if (space) out.push({ text, kind: 'space' });
    else out.push({ text, kind: 'op' });
  }
  return out;
}

function dateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

/** « Formule administrée · révision N · modifiée le … » ou « Formule par défaut du code ». */
export function provenance(p: MetricParameterRef | null | undefined): string {
  if (!p || p.isDefault || p.origin !== 'administration') {
    return p?.revision ? `Formule par défaut du code · révision ${p.revision}` : 'Formule par défaut du code';
  }
  const parts = ['Formule administrée'];
  if (p.revision !== null && p.revision !== undefined) parts.push(`révision ${p.revision}`);
  if (p.updatedAt) parts.push(`modifiée le ${dateTime(p.updatedAt)}`);
  return parts.join(' · ');
}

/** Clé de la métrique à partir de la clé de son paramètre (`metric.<clé>`). */
export function metricKeyOf(parameterKey: string | null | undefined, fallback: string): string {
  return parameterKey?.startsWith('metric.') ? parameterKey.slice('metric.'.length) : fallback;
}

const SOURCE_STATUS: Record<string, string> = { realized: 'Réalisée', planned: 'Prévue', closed: 'Close', ok: 'OK' };
const SOURCE_KIND: Record<string, string> = {
  operation: 'Opération',
  patrimoine: 'Patrimoine',
  capitalization: 'Capitalisation',
  closure: 'Clôture',
  budget: 'Budget',
  costCenter: 'Centre de coût',
  cycleLink: 'Liaison de cycle',
  bpmComposition: 'Composition BPM',
};
const PERIOD_STATUS: Record<string, string> = { current: 'en cours', ended: 'terminée', closed: 'close', future: 'à venir' };

const DECIMALS = (unit: string | undefined) => (unit === '%' ? 1 : 2);

// ---------------------------------------------------------------------------
// Styles (chaque composant garde les siens : le nœud récursif a sa propre vue).
// ---------------------------------------------------------------------------

const SHARED_CSS = `
  :host { font-variant-numeric: tabular-nums; --ct-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; --ct-line: color-mix(in srgb, var(--border) 80%, transparent); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .ct-formula { font: 0.92rem/1.6 var(--ct-mono); overflow-wrap: anywhere; white-space: pre-wrap; }
  .ct-formula.small { font-size: 0.8rem; }
  .tk-ref { display: inline-block; max-width: 100%; overflow-wrap: anywhere; background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); border-radius: 4px; padding: 0 3px; font-weight: 600; }
  .tk-fn { color: var(--s-hold); font-weight: 600; }
  .tk-num { font-weight: 600; }
  .tk-op { color: var(--muted); }
  .ct-tech { font: 0.74rem var(--ct-mono); color: var(--muted); word-break: break-all; }
  .ct-empty { color: var(--muted); font-size: 0.84rem; margin: 6px 0 0; }
  .unknown { color: var(--unknown); }
  a { text-underline-offset: 3px; }
  a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
`;

const TRACE_CSS = `
  :host { display: block; color: inherit; }
  .ct-head { background: var(--surface); border: 1px solid var(--ct-line); border-radius: 14px; padding: 16px 18px; display: grid; gap: 12px; }
  .ct-row { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 4px 14px; align-items: baseline; }
  .ct-caption { font-size: 0.72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  .ct-explanation { margin: 0; font: 0.95rem/1.5 var(--ct-mono); overflow-wrap: anywhere; }
  .ct-value { margin: 0; font-size: 1.5rem; font-weight: 700; letter-spacing: -0.01em; }
  .ct-value.unknown { background: var(--unknown-bg); border-radius: 999px; padding: 0 12px; justify-self: start; }
  .ct-reason { margin: 0; padding: 8px 12px; border-radius: 10px; background: var(--unknown-bg); color: var(--unknown); font-size: 0.88rem; }
  .ct-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px 20px; margin: 16px 2px 0; }
  .ct-meta dt { font-size: 0.72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: 3px; }
  .ct-meta dd { margin: 0; display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; font-size: 0.9rem; }
  .ct-prov-chip { display: inline-block; font-size: 0.8rem; padding: 2px 10px; border-radius: 999px; background: var(--surface-2); color: var(--muted); }
  .ct-prov-chip.admin { background: color-mix(in srgb, var(--s-hold) 14%, transparent); color: var(--s-hold); font-weight: 600; }
  .ct-edit { margin: 10px 2px 0; }
  .ct-edit-link { font-weight: 600; }
  .ct-inputs { margin-top: 22px; }
  .ct-h { font-size: 0.78rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 10px; font-weight: 600; }
  .ct-tree { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  :host(.compact) .ct-head { padding: 12px 14px; gap: 8px; }
  :host(.compact) .ct-value { font-size: 1.2rem; }
  :host(.compact) .ct-inputs { margin-top: 14px; }
  @media (max-width: 560px) {
    .ct-row { grid-template-columns: minmax(0, 1fr); }
    .ct-head { padding: 14px; }
  }
`;

const NODE_CSS = `
  :host { display: block; background: var(--surface); border: 1px solid var(--ct-line); border-radius: 12px; padding: 12px 14px; min-width: 0; }
  :host(.is-unknown) { border-color: color-mix(in srgb, var(--unknown) 45%, transparent); }
  :host(.compact) { padding: 9px 11px; }
  .ct-node-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 4px 10px; align-items: baseline; }
  .ct-kind { font-size: 0.68rem; text-transform: uppercase; letter-spacing: .05em; padding: 1px 7px; border-radius: 999px; background: var(--surface-2); color: var(--muted); font-weight: 600; white-space: nowrap; }
  .ct-kind.k-metric { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }
  .ct-kind.k-unknown { background: var(--unknown-bg); color: var(--unknown); }
  .ct-node-label { display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: baseline; min-width: 0; }
  .ct-name { font-weight: 600; }
  .ct-node-value { font-weight: 700; white-space: nowrap; }
  .ct-node-value.unknown { background: var(--unknown-bg); border-radius: 999px; padding: 0 8px; }
  .ct-note { margin: 6px 0 0; font-size: 0.84rem; color: var(--muted); font-style: italic; }
  :host(.is-unknown) .ct-note { color: var(--unknown); }
  .ct-desc { margin: 4px 0 0; font-size: 0.82rem; color: var(--muted); }
  details.ct-sub { margin-top: 8px; }
  details.ct-sub > summary { list-style: none; cursor: pointer; display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; color: inherit; font-size: 0.85rem; padding: 6px 8px; margin: 0 -8px; border-radius: 8px; }
  details.ct-sub > summary::-webkit-details-marker { display: none; }
  details.ct-sub > summary::before { content: ''; width: 7px; height: 7px; border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted); transform: rotate(-45deg); transition: transform .15s ease; align-self: center; flex: none; }
  details.ct-sub[open] > summary::before { transform: rotate(45deg); }
  details.ct-sub > summary:hover { background: var(--surface-2); }
  .ct-sub-title { color: var(--muted); }
  .ct-sub-body { padding-top: 2px; }
  .ct-explanation.small { font: 0.84rem/1.5 var(--ct-mono); margin: 4px 0; overflow-wrap: anywhere; }
  .ct-prov { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 4px 0 0; font-size: 0.8rem; color: var(--muted); }
  .ct-prov a { font-weight: 600; }
  .ct-tree { list-style: none; margin: 10px 0 0; padding: 0 0 0 14px; border-left: 2px solid var(--ct-line); display: grid; gap: 10px; }
  .ct-sources { margin-top: 10px; border-radius: 10px; border-color: var(--ct-line); }
  .ct-sources table { font-size: 0.82rem; }
  .ct-sources th { font-size: 0.72rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .ct-sources .num { text-align: right; }
  .ct-sources .nowrap { white-space: nowrap; }
  .src-label { display: block; font-weight: 600; }
  .src-kind { display: block; font-size: 0.74rem; color: var(--muted); }
  .src-id code { font-size: 0.74rem; }
  @media (max-width: 560px) {
    :host { padding: 10px 11px; }
    .ct-node-head { grid-template-columns: minmax(0, 1fr) auto; }
    .ct-kind { grid-column: 1 / -1; justify-self: start; }
    .ct-tree { padding-left: 9px; }
  }
`;

// ---------------------------------------------------------------------------
// Nœud de l'arbre des entrées (récursif).
// ---------------------------------------------------------------------------

@Component({
  selector: 'li[appCalcInput]',
  imports: [RouterLink, EurosPipe, FigureValuePipe, ShortDatePipe, CalcInputNode],
  host: { class: 'ct-node', '[class.is-unknown]': 'node().value === null', '[class.is-metric]': "node().type === 'metric'", '[class.compact]': 'compact()' },
  styles: [SHARED_CSS, NODE_CSS],
  template: `
    @let n = node();
    <div class="ct-node-head">
      <span class="ct-kind" [class.k-metric]="n.type === 'metric'" [class.k-unknown]="n.type === 'unknown'">
        {{ n.type === 'metric' ? 'Chiffre' : n.type === 'variable' ? 'Donnée' : 'Référence inconnue' }}
      </span>
      <span class="ct-node-label">
        <span class="ct-name">{{ n.label }}</span>
        <code class="ct-tech">{{ n.name }}</code>
      </span>
      <span class="ct-node-value" [class.unknown]="n.value === null">{{ n.value | figureValue: n.unit ?? 'EUR' : decimals(n) }}</span>
    </div>
    @if (n.note) {
      <p class="ct-note">{{ n.note }}</p>
    }
    @if (n.description && !compact()) {
      <p class="ct-desc">{{ n.description }}</p>
    }

    @if (n.type === 'metric') {
      <details class="ct-sub" [open]="depth() < 1 && !compact()">
        <summary>
          <span class="ct-sub-title">Calcul de « {{ n.label }} »</span>
          <code class="ct-formula small">
            @for (t of tokens(); track $index) {
              <span class="tk-{{ t.kind }}" [attr.title]="t.title ?? null">{{ t.text }}</span>
            }
          </code>
        </summary>
        <div class="ct-sub-body">
          @if (n.explanation) {
            <p class="ct-explanation small"><span class="sr-only">Valeurs substituées : </span>{{ n.explanation }}</p>
          }
          <p class="ct-prov small">
            <span>{{ prov() }}</span>
            <a [routerLink]="['/admin/calculs', metricKey()]">Voir / modifier la formule</a>
          </p>
          @if (n.inputs?.length) {
            <ul class="ct-tree">
              @for (c of n.inputs; track c.name + $index) {
                <li appCalcInput [node]="c" [depth]="depth() + 1" [compact]="compact()"></li>
              }
            </ul>
          }
        </div>
      </details>
    } @else if (n.type === 'variable') {
      @if (n.sources.length) {
        <div class="table-wrap ct-sources">
          <table>
            <caption class="sr-only">Objets sources de {{ n.label }}</caption>
            <thead>
              <tr><th scope="col">Objet source</th><th scope="col">Date</th><th scope="col" class="num">Montant</th><th scope="col">Statut</th><th scope="col">Identifiant</th></tr>
            </thead>
            <tbody>
              @for (s of n.sources; track s.id + $index) {
                <tr>
                  <td>
                    <span class="src-label">{{ s.label }}</span>
                    <span class="src-kind">{{ kindLabel(s) }}</span>
                  </td>
                  <td class="nowrap">{{ s.date | shortDate }}</td>
                  <td class="num nowrap" [class.unknown]="s.amount === null">{{ s.amount | euros }}</td>
                  <td>{{ statusLabel(s) }}</td>
                  <td>
                    <a class="src-id" [routerLink]="['/object-management']" [queryParams]="{ inspect: s.id }" [attr.title]="'Inspecter ' + s.id + ' dans Object Management'">
                      <code>{{ short(s.id) }}</code>
                    </a>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <p class="ct-empty">Aucun objet source.</p>
      }
    }
  `,
})
export class CalcInputNode {
  readonly node = input.required<FigureInput>();
  readonly depth = input(0);
  readonly compact = input(false);

  protected tokens = computed(() => {
    const n = this.node();
    const labels = new Map((n.inputs ?? []).map((i) => [i.name, i.label] as [string, string]));
    return tokenizeFormula(n.formula ?? '', labels);
  });
  protected prov = computed(() => provenance(this.node().parameter));
  protected metricKey = computed(() => metricKeyOf(this.node().parameter?.key, this.node().name));

  protected decimals(n: FigureInput) {
    return DECIMALS(n.unit);
  }
  protected kindLabel(s: FigureSource) {
    return SOURCE_KIND[s.kind] ?? s.kind;
  }
  protected statusLabel(s: FigureSource) {
    return s.status ? (SOURCE_STATUS[s.status] ?? s.status) : '—';
  }
  protected short(id: string) {
    return shortId(id);
  }
}

// ---------------------------------------------------------------------------
// Chemin de calcul complet d'un chiffre.
// ---------------------------------------------------------------------------

/**
 * Présente le chemin de calcul d'un chiffre : formule administrée, valeurs substituées,
 * provenance du paramètre, période, puis l'arbre des entrées jusqu'aux objets sources.
 * Réutilisé par l'éditeur de formule de l'Administration (contrat : `figure`, `compact`).
 */
@Component({
  selector: 'app-calc-trace',
  imports: [RouterLink, FigureValuePipe, ShortDatePipe, CalcInputNode],
  host: { class: 'calc-trace', '[class.compact]': 'compact()' },
  template: `
    @let f = figure();
    <section class="ct-head" aria-label="Formule et résultat">
      <div class="ct-row">
        <span class="ct-caption">Formule</span>
        <code class="ct-formula">
          @for (t of tokens(); track $index) {
            <span class="tk-{{ t.kind }}" [attr.title]="t.title ?? null">{{ t.text }}</span>
          }
        </code>
      </div>
      <div class="ct-row">
        <span class="ct-caption">Avec les valeurs</span>
        <p class="ct-explanation">{{ f.explanation || '—' }}</p>
      </div>
      <div class="ct-row ct-result">
        <span class="ct-caption">Résultat</span>
        <p class="ct-value" [class.unknown]="f.value === null">{{ f.value | figureValue: f.unit : f.decimals }}</p>
      </div>
      @if (f.value === null && f.unavailableReason) {
        <p class="ct-reason" role="note"><strong>Inconnu :</strong> {{ f.unavailableReason }}</p>
      }
    </section>

    <dl class="ct-meta">
      <div>
        <dt>Paramètre</dt>
        <dd>
          <span class="ct-prov-chip" [class.admin]="!isDefault()">{{ prov() }}</span>
          <code class="ct-tech">{{ f.parameter.key }}</code>
        </dd>
      </div>
      <div>
        <dt>Période</dt>
        <dd>
          @if (f.period; as p) {
            {{ p.label }}
            <span class="muted">({{ p.start | shortDate }} → {{ p.end | shortDate }}{{ periodStatus(p.status) }})</span>
          } @else {
            <span class="muted">Sans période (cycle à configurer ou chiffre hors période)</span>
          }
        </dd>
      </div>
    </dl>
    <p class="ct-edit">
      <a class="ct-edit-link" [routerLink]="['/admin/calculs', f.key]">Voir / modifier la formule</a>
    </p>

    <section class="ct-inputs" aria-label="Entrées du calcul">
      <h3 class="ct-h">Entrées du calcul</h3>
      @if (f.inputs.length) {
        <ul class="ct-tree root">
          @for (i of f.inputs; track i.name + $index) {
            <li appCalcInput [node]="i" [depth]="0" [compact]="compact()"></li>
          }
        </ul>
      } @else {
        <p class="ct-empty">Cette formule n'utilise aucune donnée (valeur constante).</p>
      }
    </section>
  `,
  styles: [SHARED_CSS, TRACE_CSS],
})
export class CalcTrace {
  readonly figure = input.required<FigureEvaluation>();
  readonly compact = input(false);

  protected tokens = computed(() => {
    const f = this.figure();
    const labels = new Map(f.inputs.map((i) => [i.name, i.label] as [string, string]));
    return tokenizeFormula(f.formula, labels);
  });
  protected prov = computed(() => provenance(this.figure().parameter));
  protected isDefault = computed(() => {
    const p = this.figure().parameter;
    return !p || p.isDefault !== false || p.origin !== 'administration';
  });

  protected periodStatus(status: string | undefined) {
    return status && PERIOD_STATUS[status] ? ` · ${PERIOD_STATUS[status]}` : '';
  }
}
