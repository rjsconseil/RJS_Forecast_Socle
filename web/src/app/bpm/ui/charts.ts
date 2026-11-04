import { Component, computed, input, linkedSignal, output, signal } from '@angular/core';
import { cents, percentText, signedCents } from '../../core/format';

// Graphes SVG accessibles : chaque valeur est atteignable au clic et au clavier (Tab, flèches),
// affichée dans un lecteur sous le graphe et reprise dans un tableau associé. Une valeur inconnue
// interrompt la série ; elle n'est jamais dessinée comme un zéro.

export interface ChartSeries {
  key: string;
  label: string;
  /** Couleur de la mesure (token `--s-*`) : identique d'un graphe et d'un format à l'autre. */
  color: string;
  values: (number | null)[];
  kind?: 'bar' | 'line';
  /** Index à partir duquel les valeurs sont prévisionnelles (tracé différencié). */
  forecastFrom?: number | null;
  dashed?: boolean;
}
export type SeriesFormat = 'combined' | 'lines' | 'bars' | 'area';
export const FORMAT_LABEL: Record<string, string> = { combined: 'Combiné', lines: 'Courbes', bars: 'Barres', area: 'Aire', pie: 'Camembert', donut: 'Anneau', bar: 'Barre 100 %' };

const W = 640;
const PAD = { l: 64, r: 12, t: 12, b: 34 };

/** Montant compact pour les axes (centimes → « 1,2 k€ »). */
export function axisCents(v: number) {
  const e = v / 100;
  const a = Math.abs(e);
  if (a >= 1e6) return (e / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' M€';
  if (a >= 1e3) return (e / 1e3).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' k€';
  return e.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
}

function niceTicks(min: number, max: number, count = 4) {
  if (min === max) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step / 2; v += step) ticks.push(Math.round(v));
  return ticks;
}

@Component({
  selector: 'bpm-series-chart',
  template: `
    <figure class="chart">
      <figcaption>
        <span class="title">{{ title() }}</span>
        @if (formats().length > 1) {
          <span class="segmented" role="group" [attr.aria-label]="'Options de représentation — ' + title()">
            @for (f of formats(); track f) {
              <button type="button" [attr.aria-pressed]="format() === f" (click)="setFormat(f)">{{ label(f) }}</button>
            }
          </span>
        }
      </figcaption>
      @if (!hasData()) {
        <p class="bm-empty">{{ emptyText() }}</p>
      } @else {
        <svg [attr.viewBox]="'0 0 ' + W + ' ' + height()" role="img" [attr.aria-label]="title() + ' — valeurs dans le tableau associé'" preserveAspectRatio="xMidYMid meet">
          @for (t of geo().ticks; track t.v) {
            <line class="grid" [attr.x1]="PAD.l" [attr.x2]="W - PAD.r" [attr.y1]="t.y" [attr.y2]="t.y" [class.zero]="t.v === 0" />
            <text class="tick" [attr.x]="PAD.l - 6" [attr.y]="t.y + 4" text-anchor="end">{{ unit() === 'pct' ? t.v + ' %' : axis(t.v) }}</text>
          }
          @for (b of geo().bars; track b.id) {
            <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" [attr.fill]="b.color" [attr.opacity]="b.forecast ? 0.4 : 0.9" [attr.stroke]="b.forecast ? b.color : null" [attr.stroke-dasharray]="b.forecast ? '3 2' : null" rx="2" />
          }
          @for (a of geo().areas; track a.key) {
            <path [attr.d]="a.d" [attr.fill]="a.color" opacity="0.16" />
          }
          @for (l of geo().lines; track l.id) {
            <path [attr.d]="l.d" fill="none" [attr.stroke]="l.color" stroke-width="2.2" [attr.stroke-dasharray]="l.dashed ? '6 4' : null" stroke-linejoin="round" />
          }
          @for (p of geo().points; track p.id) {
            <circle [attr.cx]="p.x" [attr.cy]="p.y" r="3.2" [attr.fill]="p.forecast ? 'var(--c-surface)' : p.color" [attr.stroke]="p.color" stroke-width="1.6" />
          }
          @for (m of markers(); track m.index + m.label) {
            @if (geo().cx[m.index] !== undefined) {
              <line class="marker" [attr.x1]="geo().cx[m.index]" [attr.x2]="geo().cx[m.index]" [attr.y1]="PAD.t" [attr.y2]="height() - PAD.b" />
              <text class="marker-label" [attr.x]="geo().cx[m.index] + 3" [attr.y]="PAD.t + 10">{{ m.short ?? '◆' }}</text>
            }
          }
          @for (c of categories(); track $index) {
            @if (showLabel($index)) {
              <text class="tick" [attr.x]="geo().cx[$index]" [attr.y]="height() - PAD.b + 16" text-anchor="middle">{{ c }}</text>
            }
          }
          @for (c of categories(); track $index) {
            <rect class="hit" [class.on]="sel() === $index" [attr.x]="geo().cx[$index] - geo().slot / 2" [attr.y]="PAD.t" [attr.width]="geo().slot" [attr.height]="height() - PAD.t - PAD.b"
              tabindex="0" role="button" [attr.aria-label]="describe($index)" (click)="pick($index)" (focus)="sel.set($index)" (keydown)="key($event, $index)" />
          }
        </svg>
        <div class="legend">
          @for (s of series(); track s.key) {
            <span class="item"><i [style.background]="s.color" [class.dash]="s.dashed"></i>{{ s.label }}</span>
          }
          @if (hasForecast()) {
            <span class="item"><i class="hollow"></i>Prévision (tracé clair ou pointillé)</span>
          }
        </div>
        <p class="readout" aria-live="polite">
          @if (sel() !== null) {
            <strong>{{ categories()[sel()!] }}</strong>
            @for (s of series(); track s.key) {
              <span> · {{ s.label }} : <span class="num">{{ fmt(s.values[sel()!]) }}</span></span>
            }
          } @else {
            <span class="muted">Cliquez ou tabulez sur une colonne pour lire ses valeurs.</span>
          }
        </p>
      }
      <details class="table-details">
        <summary>Tableau des valeurs</summary>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>{{ categoryLabel() }}</th>@for (s of series(); track s.key) {<th class="num">{{ s.label }}</th>}</tr></thead>
            <tbody>
              @for (c of categories(); track $index; let i = $index) {
                <tr [class.selected]="sel() === i"><td>{{ c }}@if (isForecast(i)) { <span class="chip estimate">prévision</span> }</td>@for (s of series(); track s.key) {<td class="num">{{ fmt(s.values[i]) }}</td>}</tr>
              }
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .bm-empty { margin: 0; padding: var(--ecart-16); border: var(--trait-1) dashed var(--card-border); border-radius: var(--card-radius); color: var(--muted); }
    .chart { margin: 0; }
    figcaption { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; }
    .title { color: var(--ink); font-weight: var(--fw-semibold); font-size: var(--fs-sm); }
    svg { width: 100%; height: auto; display: block; overflow: visible; }
    .grid { stroke: var(--c-rule); stroke-width: 1; }
    .grid.zero { stroke: var(--c-text-3); }
    .tick { font: 11px var(--f-num); fill: var(--c-text-2); }
    .hit { fill: transparent; cursor: pointer; outline: none; }
    .hit:hover, .hit.on { fill: var(--c-accent); fill-opacity: 0.07; }
    .hit:focus-visible { stroke: var(--c-focus); stroke-width: 2; }
    .marker { stroke: var(--c-text-3); stroke-dasharray: 2 3; }
    .marker-label { font-size: 10px; fill: var(--c-text-2); }
    .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 0.8rem; color: var(--c-text-2); margin-top: 4px; }
    .legend i { display: inline-block; width: 12px; height: 4px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }
    .legend i.dash { height: 0; border-top: 3px dashed currentColor; background: none !important; }
    .legend i.hollow { border: 1px dashed var(--c-text-2); height: 8px; }
    .readout { font-size: 0.84rem; margin: 6px 0 0; min-height: 1.3em; }
    .table-details { margin-top: 6px; font-size: 0.85rem; }
  `,
})
export class BpmSeriesChart {
  protected readonly W = W;
  protected readonly PAD = PAD;
  readonly title = input.required<string>();
  readonly categories = input.required<string[]>();
  readonly series = input.required<ChartSeries[]>();
  readonly formats = input<SeriesFormat[]>(['combined']);
  readonly initialFormat = input<SeriesFormat>('combined');
  readonly unit = input<'cents' | 'pct'>('cents');
  readonly categoryLabel = input('Période');
  readonly markers = input<{ index: number; label: string; short?: string }[]>([]);
  readonly height = input(240);
  readonly emptyText = input('Aucune valeur connue à représenter.');
  readonly formatChange = output<SeriesFormat>();
  readonly select = output<number>();

  readonly format = linkedSignal(() => this.initialFormat());
  protected sel = signal<number | null>(null);

  protected label = (f: string) => FORMAT_LABEL[f] ?? f;
  protected axis = axisCents;
  protected hasData = computed(() => this.series().some((s) => s.values.some((v) => v !== null && v !== undefined)) && this.categories().length > 0);
  protected hasForecast = computed(() => this.series().some((s) => s.forecastFrom !== null && s.forecastFrom !== undefined));
  protected isForecast = (i: number) => this.series().some((s) => s.forecastFrom !== null && s.forecastFrom !== undefined && i >= s.forecastFrom);

  protected geo = computed(() => {
    const cats = this.categories();
    const n = Math.max(cats.length, 1);
    const H = this.height();
    const fmt = this.format();
    const kindOf = (s: ChartSeries): 'bar' | 'line' => (fmt === 'bars' ? 'bar' : fmt === 'lines' || fmt === 'area' ? 'line' : (s.kind ?? 'line'));
    const all = this.series().flatMap((s) => s.values.filter((v): v is number => v !== null && v !== undefined));
    const lo = Math.min(0, ...all);
    const hi = Math.max(0, ...all);
    const ticks = niceTicks(lo, hi === lo ? lo + 100 : hi);
    const yMin = Math.min(lo, ticks[0]);
    const yMax = Math.max(hi, ticks.at(-1)!);
    const plotH = H - PAD.t - PAD.b;
    const y = (v: number) => PAD.t + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
    const slot = (W - PAD.l - PAD.r) / n;
    const cx = cats.map((_, i) => PAD.l + slot * (i + 0.5));
    const barSeries = this.series().filter((s) => kindOf(s) === 'bar');
    const bw = Math.min(28, (slot * 0.76) / Math.max(barSeries.length, 1));
    const bars: { id: string; x: number; y: number; w: number; h: number; color: string; forecast: boolean }[] = [];
    barSeries.forEach((s, k) => {
      s.values.forEach((v, i) => {
        if (v === null || v === undefined) return;
        const x = cx[i] - (bw * barSeries.length) / 2 + k * bw;
        const y0 = y(0);
        const y1 = y(v);
        bars.push({ id: s.key + i, x, y: Math.min(y0, y1), w: Math.max(bw - 2, 1), h: Math.max(Math.abs(y1 - y0), 1), color: s.color, forecast: s.forecastFrom != null && i >= s.forecastFrom });
      });
    });
    const lines: { id: string; d: string; color: string; dashed: boolean }[] = [];
    const points: { id: string; x: number; y: number; color: string; forecast: boolean }[] = [];
    const areas: { key: string; d: string; color: string }[] = [];
    for (const s of this.series().filter((x) => kindOf(x) === 'line')) {
      // Une valeur inconnue interrompt la courbe ; la partie prévisionnelle est tracée en pointillé.
      let real = '';
      let fc = '';
      let prev = null as { x: number; y: number; forecast: boolean } | null;
      s.values.forEach((v, i) => {
        if (v === null || v === undefined) {
          prev = null;
          return;
        }
        const p = { x: cx[i], y: y(v), forecast: s.forecastFrom != null && i >= s.forecastFrom };
        if (p.forecast) fc += prev ? `M${prev.x},${prev.y}L${p.x},${p.y}` : `M${p.x},${p.y}`;
        else real += prev ? `L${p.x},${p.y}` : `M${p.x},${p.y}`;
        points.push({ id: s.key + i, x: p.x, y: p.y, color: s.color, forecast: p.forecast });
        prev = p;
      });
      lines.push({ id: s.key + 'r', d: real, color: s.color, dashed: !!s.dashed });
      if (fc) lines.push({ id: s.key + 'f', d: fc, color: s.color, dashed: true });
      if (fmt === 'area') {
        const pts = s.values.map((v, i) => (v === null || v === undefined ? null : `${cx[i]},${y(v)}`));
        // Aire par segment continu, fermée sur la ligne de zéro.
        let seg: string[] = [];
        let first = -1;
        const flush = (last: number) => {
          if (seg.length > 1) areas.push({ key: s.key + first, d: `M${cx[first]},${y(0)}L${seg.join('L')}L${cx[last]},${y(0)}Z`, color: s.color });
          seg = [];
        };
        pts.forEach((p, i) => {
          if (p === null) return flush(i - 1);
          if (!seg.length) first = i;
          seg.push(p);
          if (i === pts.length - 1) flush(i);
        });
      }
    }
    return { ticks: ticks.map((v) => ({ v, y: y(v) })), bars, lines, points, areas, cx, slot };
  });

  protected showLabel(i: number) {
    const n = this.categories().length;
    const every = Math.ceil(n / 12);
    return i % every === 0 || i === n - 1;
  }
  protected fmt(v: number | null | undefined) {
    if (v === null || v === undefined) return 'Inconnu';
    return this.unit() === 'pct' ? percentText(v) : cents(v);
  }
  protected describe(i: number) {
    return `${this.categories()[i]} : ` + this.series().map((s) => `${s.label} ${this.fmt(s.values[i])}`).join(', ');
  }
  protected pick(i: number) {
    this.sel.set(i);
    this.select.emit(i);
  }
  protected key(e: KeyboardEvent, i: number) {
    const n = this.categories().length;
    let j = i;
    if (e.key === 'ArrowRight') j = Math.min(n - 1, i + 1);
    else if (e.key === 'ArrowLeft') j = Math.max(0, i - 1);
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      return this.pick(i);
    } else return;
    e.preventDefault();
    const target = (e.target as SVGElement).parentNode?.querySelectorAll('.hit')[j] as SVGElement | undefined;
    target?.focus();
  }
  protected setFormat(f: SeriesFormat) {
    this.format.set(f);
    this.formatChange.emit(f);
  }
}

export interface ShareItem {
  key: string;
  label: string;
  cents: number | null;
  color: string;
}

/**
 * Répartition : barre 100 %, camembert ou anneau, avec lecture « sur 100 € ». Aucun secteur ne
 * représente une valeur négative ou inconnue ; une base nulle ne produit aucune part.
 */
@Component({
  selector: 'bpm-share-chart',
  template: `
    <figure class="chart">
      <figcaption>
        <span class="title">{{ title() }}</span>
        @if (formats().length > 1) {
          <span class="segmented" role="group" [attr.aria-label]="'Options — ' + title()">
            @for (f of formats(); track f) {
              <button type="button" [attr.aria-pressed]="format() === f" (click)="format.set(f)">{{ label(f) }}</button>
            }
          </span>
        }
      </figcaption>
      @if (base() <= 0) {
        <p class="bm-empty">{{ zeroText() }}</p>
      } @else {
        @if (format() === 'bar') {
          <div class="bar100" role="list" [attr.aria-label]="title()">
            @for (p of parts(); track p.key) {
              <button type="button" class="seg" role="listitem" [style.flex-basis.%]="p.pct" [style.background]="p.color" [attr.aria-label]="p.label + ' : ' + per100(p.cents) + ' sur 100 €'" (click)="pick.emit(p.key)" [title]="p.label"></button>
            }
          </div>
        } @else {
          <svg viewBox="-110 -110 220 220" class="pie" role="img" [attr.aria-label]="title() + ' — valeurs dans la liste'">
            @for (a of arcs(); track a.key) {
              <path [attr.d]="a.d" [attr.fill]="a.color" stroke="var(--c-surface)" stroke-width="1.5" tabindex="0" role="button" [attr.aria-label]="a.label + ' : ' + a.pctText" (click)="pick.emit(a.key)" (keydown.enter)="pick.emit(a.key)" />
            }
            @if (format() === 'donut') {
              <circle r="56" fill="var(--c-surface)" />
              <text text-anchor="middle" y="-2" class="center">{{ baseLabel() }}</text>
              <text text-anchor="middle" y="16" class="center num">{{ fmtBase() }}</text>
            }
          </svg>
        }
        <ul class="share-list">
          @for (p of parts(); track p.key) {
            <li>
              <i [style.background]="p.color"></i>
              @if (clickable()) {
                <button type="button" class="linkish" (click)="pick.emit(p.key)">{{ p.label }}</button>
              } @else {
                <span>{{ p.label }}</span>
              }
              <span class="num amt">{{ cents(p.cents) }}</span>
              <span class="num per">{{ per100(p.cents) }} <span class="muted">/ 100 €</span></span>
            </li>
          }
        </ul>
        @if (excluded().length) {
          <p class="small muted">Non représentés (valeur négative ou inconnue) : {{ excluded().join(', ') }}.</p>
        }
        <p class="small muted">Base : {{ baseLabel() }} = {{ fmtBase() }}.</p>
      }
    </figure>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .bm-empty { margin: 0; padding: var(--ecart-16); border: var(--trait-1) dashed var(--card-border); border-radius: var(--card-radius); color: var(--muted); }
    .chart { margin: 0; }
    figcaption { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
    .title { color: var(--ink); font-weight: var(--fw-semibold); font-size: var(--fs-sm); }
    .bar100 { display: flex; height: 26px; border-radius: 6px; overflow: hidden; background: var(--c-surface-3); }
    .seg { border: 0; padding: 0; min-width: 2px; cursor: pointer; border-right: 1px solid var(--c-surface); }
    .seg:focus-visible { outline: 2px solid var(--c-focus); outline-offset: -2px; }
    .pie { width: min(220px, 100%); display: block; margin: 0 auto; }
    .pie path { cursor: pointer; outline: none; }
    .pie path:focus-visible { stroke: var(--c-focus); stroke-width: 3; }
    .center { font-size: 11px; fill: var(--c-text-2); }
    .center.num { font-size: 14px; fill: var(--c-text); font-family: var(--f-num); }
    .share-list { list-style: none; padding: 0; margin: 10px 0 0; display: grid; gap: 4px; font-size: 0.86rem; }
    .share-list li { display: grid; grid-template-columns: 12px 1fr auto auto; gap: 8px; align-items: center; }
    .share-list i { width: 10px; height: 10px; border-radius: 3px; }
    .amt { color: var(--c-text-2); }
    .per { min-width: 92px; text-align: right; }
    .linkish { background: none; border: 0; padding: 0; color: var(--c-accent); font: inherit; text-align: left; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
  `,
})
export class BpmShareChart {
  readonly title = input.required<string>();
  readonly items = input.required<ShareItem[]>();
  /** Base des parts (centimes) : entrées si elles couvrent les dépenses, sinon dépenses. */
  readonly base = input.required<number>();
  readonly baseLabel = input('Base');
  readonly formats = input<('bar' | 'pie' | 'donut')[]>(['bar']);
  readonly clickable = input(true);
  readonly zeroText = input('Base nulle : aucune part n\'est calculée.');
  readonly pick = output<string>();
  readonly format = linkedSignal<'bar' | 'pie' | 'donut'>(() => this.formats()[0]);
  protected label = (f: string) => FORMAT_LABEL[f] ?? f;
  protected cents = cents;
  protected fmtBase = computed(() => cents(this.base()));
  protected parts = computed(() =>
    this.items()
      .filter((i) => i.cents !== null && i.cents > 0)
      .map((i) => ({ ...i, cents: i.cents!, pct: (i.cents! / this.base()) * 100 })),
  );
  protected excluded = computed(() => this.items().filter((i) => i.cents === null || i.cents < 0).map((i) => i.label));
  protected per100 = (c: number) => ((c / this.base()) * 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  protected arcs = computed(() => {
    const total = this.parts().reduce((s, p) => s + p.cents, 0);
    const ref = Math.max(total, this.base());
    let a0 = -Math.PI / 2;
    return this.parts().map((p) => {
      const frac = p.cents / ref;
      const a1 = a0 + frac * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const r = 100;
      const d = frac >= 0.9999 ? `M0,-${r}A${r},${r} 0 1 1 -0.01,-${r}Z` : `M0,0L${r * Math.cos(a0)},${r * Math.sin(a0)}A${r},${r} 0 ${large} 1 ${r * Math.cos(a1)},${r * Math.sin(a1)}Z`;
      a0 = a1;
      return { key: p.key, label: p.label, color: p.color, d, pctText: percentText(p.pct) };
    });
  });
}

export interface CapRow {
  key: string;
  label: string;
  paidCents: number;
  remainingCents: number;
  capCents: number | null;
}

/** Plafonds et marges : payé, restant prévu, plafond facultatif et dépassement par centre. */
@Component({
  selector: 'bpm-cap-chart',
  template: `
    <div class="caps" role="list" [attr.aria-label]="title()">
      @for (r of rows(); track r.key) {
        <button type="button" class="row" role="listitem" (click)="pick.emit(r.key)" [attr.aria-label]="describe(r)">
          <span class="lbl">{{ r.label }}</span>
          <span class="track">
            <span class="paid" [style.width.%]="pct(r.paidCents)"></span>
            <span class="rem" [style.width.%]="pct(r.remainingCents)"></span>
            @if (r.capCents !== null) {
              <span class="cap" [style.left.%]="pct(r.capCents)" aria-hidden="true"></span>
            }
          </span>
          <span class="num val">{{ cents(r.paidCents) }}@if (r.remainingCents) { <span class="muted"> + {{ cents(r.remainingCents) }}</span> }</span>
          <span class="num margin" [class.neg]="margin(r) !== null && margin(r)! < 0" [class.pos]="margin(r) !== null && margin(r)! >= 0">
            {{ margin(r) === null ? 'Sans plafond' : margin(r)! < 0 ? 'Dépassement ' + cents(-margin(r)!) : 'Marge ' + cents(margin(r)!) }}
          </span>
        </button>
      }
    </div>
    <div class="legend">
      <span><i class="paid"></i>{{ paidLabel() }}</span><span><i class="rem"></i>Restant prévu</span><span><i class="capk"></i>Plafond</span>
    </div>
  `,
  styles: `
    :host { display: block; }
    .caps { display: grid; gap: 6px; }
    .row { display: grid; grid-template-columns: minmax(90px, 1.1fr) 2fr auto auto; gap: 10px; align-items: center; border: 0; background: none; padding: 6px 4px; border-radius: var(--r-sm); font: inherit; color: inherit; text-align: left; cursor: pointer; }
    .row:hover { background: var(--c-surface-2); }
    .lbl { font-size: 0.86rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .track { position: relative; display: flex; height: 12px; background: var(--c-surface-3); border-radius: 6px; overflow: visible; }
    .paid { background: var(--s-charge); border-radius: 6px 0 0 6px; }
    .rem { background: var(--s-remaining); opacity: 0.55; background-image: repeating-linear-gradient(45deg, transparent 0 3px, rgba(255,255,255,.5) 3px 6px); }
    .cap { position: absolute; top: -4px; bottom: -4px; width: 2px; background: var(--s-cap); }
    .val { font-size: 0.82rem; white-space: nowrap; }
    .margin { font-size: 0.78rem; white-space: nowrap; min-width: 120px; text-align: right; }
    .legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 0.78rem; color: var(--c-text-2); margin-top: 6px; }
    .legend i { display: inline-block; width: 12px; height: 8px; margin-right: 4px; border-radius: 2px; }
    .legend i.paid { background: var(--s-charge); }
    .legend i.rem { background: var(--s-remaining); opacity: .6; }
    .legend i.capk { width: 2px; height: 12px; background: var(--s-cap); }
    @media (max-width: 600px) { .row { grid-template-columns: 1fr auto; } .track { grid-column: 1 / -1; order: 3; } .margin { min-width: 0; } }
  `,
})
export class BpmCapChart {
  readonly title = input('Plafonds et marges');
  readonly rows = input.required<CapRow[]>();
  readonly paidLabel = input('Payé');
  readonly pick = output<string>();
  protected cents = cents;
  private max = computed(() => Math.max(1, ...this.rows().map((r) => Math.max(r.paidCents + r.remainingCents, r.capCents ?? 0))));
  protected pct = (v: number) => Math.max(0, (v / this.max()) * 100);
  protected margin = (r: CapRow) => (r.capCents === null ? null : r.capCents - r.paidCents - r.remainingCents);
  protected describe(r: CapRow) {
    const m = this.margin(r);
    return `${r.label} : payé ${cents(r.paidCents)}, restant prévu ${cents(r.remainingCents)}, ` + (m === null ? 'sans plafond' : m < 0 ? `dépassement ${cents(-m)}` : `marge ${cents(m)}`);
  }
}

/** Progression vers une cible (montant) ou temps écoulé (pourcentage) : deux mesures distinctes. */
@Component({
  selector: 'bpm-progress',
  template: `
    <div class="progress">
      <div class="head">
        <span class="lbl">{{ label() }}</span>
        <span class="num">{{ text() }}</span>
      </div>
      <div class="track" role="progressbar" [attr.aria-valuenow]="pctValue()" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="label()" [attr.aria-valuetext]="text()">
        <span class="fill" [class.time]="kind() === 'time'" [class.neg]="(value() ?? 0) < 0" [style.width.%]="clamped()"></span>
      </div>
      @if (detail()) {
        <span class="hint">{{ detail() }}</span>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .head { display: flex; justify-content: space-between; gap: 8px; font-size: 0.86rem; margin-bottom: 4px; }
    .lbl { font-weight: 600; }
    .track { height: 10px; background: var(--c-surface-3); border-radius: 5px; overflow: hidden; }
    .fill { display: block; height: 100%; background: var(--c-pos); border-radius: 5px; }
    .fill.time { background: var(--c-text-3); }
    .fill.neg { background: var(--c-neg); }
  `,
})
export class BpmProgress {
  readonly label = input.required<string>();
  readonly kind = input<'money' | 'time'>('money');
  /** Pour `money` : valeur et cible en centimes. Pour `time` : `pct` direct. */
  readonly value = input<number | null>(null);
  readonly target = input<number | null>(null);
  readonly pct = input<number | null>(null);
  readonly detail = input<string | null>(null);
  protected pctValue = computed(() => {
    if (this.kind() === 'time') return this.pct();
    const v = this.value();
    const t = this.target();
    return v === null || !t ? null : Math.round((v / t) * 1000) / 10;
  });
  protected clamped = computed(() => Math.max(0, Math.min(100, this.pctValue() ?? 0)));
  protected text = computed(() => {
    const p = this.pctValue();
    if (this.kind() === 'time') return p === null ? 'Inconnu' : percentText(p);
    if (this.value() === null) return 'Inconnu';
    if (!this.target()) return `${signedCents(this.value())} · cible non définie`;
    return `${signedCents(this.value())} / ${cents(this.target())} · ${percentText(p)}`;
  });
}
