import { Component, computed, input, signal } from '@angular/core';
import { BpmImpact } from '../../core/bpm-models';
import { cents, signedCents } from '../../core/format';
import { axisCents } from '../ui';

// Graphes propres à « Graphiques et chiffres », sur la structure du pilotage des flux de la référence
// (`fp-bars`, `fp-projects`) : liaison réalisé → attendu (deux états comparés, sans axe temporel) et
// impact des projets par Budget sur une échelle commune.

export interface FlowMeasure {
  key: string;
  label: string;
  /** Couleur de la mesure (token `--s-*`), reprise dans le tableau des valeurs. */
  color: string;
  realizedCents: number | null;
  expectedCents: number | null;
  signed?: boolean;
  /** Nature de la mesure : une charge se trace sous l'axe, le net porte la couleur d'accent. */
  kind?: 'income' | 'expense' | 'net';
}

/** Courbe entre deux colonnes, coupée en son milieu (partie réalisée, partie prévue). */
function curvePath(x1: number, y1: number, x2: number, y2: number, part: 'all' | 'actual' | 'forecast' = 'all') {
  const dx = x2 - x1;
  const midY = (y1 + y2) / 2;
  if (part === 'actual') return `M ${x1} ${y1} C ${x1 + dx * 0.125} ${y1}, ${x1 + dx * 0.3125} ${(3 * y1 + y2) / 4}, ${x1 + dx / 2} ${midY}`;
  if (part === 'forecast') return `M ${x1 + dx / 2} ${midY} C ${x1 + dx * 0.6875} ${(y1 + 3 * y2) / 4}, ${x1 + dx * 0.875} ${y2}, ${x2} ${y2}`;
  return `M ${x1} ${y1} C ${x1 + dx * 0.25} ${y1}, ${x1 + dx * 0.75} ${y2}, ${x2} ${y2}`;
}

/**
 * « Réalisé vers prévu » : pour chaque mesure, une colonne réalisée (au calcul) et une colonne attendue
 * (à la clôture) reliées par une courbe. Ce n'est pas une chronologie : l'écart horizontal ne
 * représente aucune durée. Une valeur inconnue n'est pas tracée (jamais un zéro).
 */
@Component({
  selector: 'bpm-flow-link',
  styleUrls: ['../ref-styles/bpm-flow-pilot.component.scss'],
  template: `
    @if (!hasData()) {
      <p class="fp-warning">Aucune valeur connue à relier.</p>
    } @else {
      <ol class="fp-bars" [attr.aria-label]="title() + ' — deux états comparés, valeurs dans le tableau associé'">
        @for (m of geo().items; track m.key) {
          <li
            [class.fp-negative]="m.kind === 'expense'"
            [class.fp-result]="m.kind === 'net'"
            [class.fp-deficit]="m.kind === 'net' && (m.realizedCents ?? 0) < 0"
            [class.is-selected]="sel() === m.key"
            tabindex="0"
            [attr.aria-label]="describe(m)"
            (click)="sel.set(m.key)"
            (focus)="sel.set(m.key)"
            (keydown.enter)="sel.set(m.key)"
          >
            <div class="fp-row">
              <strong>{{ m.label }}</strong
              ><span class="fp-values"
                ><span class="fp-value"><small>Réalisé</small><b>{{ m.realText }}</b></span
                ><span class="fp-value is-forecast"><small>Attendu à la clôture</small><b>{{ m.expText }}</b></span></span
              >
            </div>
            <div class="fp-curve-caption">
              <span>Réalisé vers attendu</span><strong>Écart {{ gap(m) }}</strong>
            </div>
            <svg class="fp-comparison-plot" viewBox="0 0 640 212" aria-hidden="true">
              <line class="fp-grid-line" x1="70" x2="590" y1="18" y2="18" />
              <line class="fp-comparison-axis" x1="70" x2="590" y1="90" y2="90" />
              <line class="fp-grid-line" x1="70" x2="590" y1="162" y2="162" />
              <text class="fp-tick-label" x="58" y="23" text-anchor="end">{{ tick(geo().max) }}</text>
              <text class="fp-tick-label" x="58" y="95" text-anchor="end">0 €</text>
              <text class="fp-tick-label" x="58" y="167" text-anchor="end">{{ tick(-geo().max) }}</text>
              @if (m.yr !== null) {
                <rect class="fp-column is-real" x="190" width="88" rx="5" [attr.y]="Math.min(90, m.yr)" [attr.height]="Math.abs(90 - m.yr)" />
              }
              @if (m.ye !== null) {
                <rect class="fp-column is-forecast" x="410" width="88" rx="5" [attr.y]="Math.min(90, m.ye)" [attr.height]="Math.abs(90 - m.ye)" />
              }
              @if (m.yr !== null && m.ye !== null) {
                <path class="fp-curve-halo" [attr.d]="curve(m.yr, m.ye, 'all')" />
                <path class="fp-overlay-curve" [attr.d]="curve(m.yr, m.ye, 'actual')" />
                <path class="fp-overlay-curve is-forecast" [attr.d]="curve(m.yr, m.ye, 'forecast')" />
              }
              <text class="fp-category-label" x="234" y="202" text-anchor="middle">Réalisé</text>
              <text class="fp-category-label" x="454" y="202" text-anchor="middle">Attendu</text>
            </svg>
          </li>
        }
      </ol>
      <div class="fp-chart-legend">
        <span class="is-real">Colonne pleine : réalisé au calcul</span><span class="is-forecast">Colonne claire : attendu à la clôture</span>
      </div>
      <p class="fp-readout" aria-live="polite">
        @if (selected(); as m) {
          <strong>{{ m.label }}</strong> · réalisé <span class="num">{{ fmt(m, m.realizedCents) }}</span> → attendu <span class="num">{{ fmt(m, m.expectedCents) }}</span> · écart <span class="num">{{ gap(m) }}</span>
        } @else {
          Cliquez ou tabulez sur une mesure pour lire ses deux états.
        }
      </p>
    }
    <div class="table-scroll">
      <table class="data-table">
        <caption class="visually-hidden">{{ title() }} : valeurs</caption>
        <thead><tr><th>Mesure</th><th class="num">Réalisé</th><th class="num">Attendu à la clôture</th><th class="num">Écart (attendu − réalisé)</th></tr></thead>
        <tbody>
          @for (m of measures(); track m.key) {
            <tr [class.selected]="sel() === m.key">
              <td><i class="sw" [style.background]="m.color"></i>{{ m.label }}</td>
              <td class="num">{{ fmt(m, m.realizedCents) }}</td>
              <td class="num">{{ fmt(m, m.expectedCents) }}</td>
              <td class="num">{{ gap(m) }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    :host { display: grid; gap: var(--ecart-12); min-width: 0; }
    .fp-bars li { cursor: pointer; outline: none; }
    .fp-bars li:focus-visible, .fp-bars li.is-selected { border-color: var(--app-accent); box-shadow: inset 0 0 0 1px var(--app-accent); }
    .fp-readout { min-height: 1.3em; font-size: var(--fs-sm); }
    .sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: middle; }
  `,
})
export class BpmFlowLink {
  protected readonly Math = Math;
  readonly title = input('Réalisé vers prévu');
  readonly measures = input.required<FlowMeasure[]>();
  protected sel = signal<string | null>(null);
  protected hasData = computed(() => this.measures().some((m) => m.realizedCents !== null || m.expectedCents !== null));
  protected selected = computed(() => this.measures().find((m) => m.key === this.sel()) ?? null);

  protected geo = computed(() => {
    const ms = this.measures();
    const max = Math.max(1, ...ms.flatMap((m) => [m.realizedCents, m.expectedCents]).filter((v): v is number => v !== null).map(Math.abs));
    const y = (m: FlowMeasure, v: number | null) => (v === null ? null : 90 - ((m.kind === 'expense' ? -Math.abs(v) : v) / max) * 72);
    return {
      max,
      items: ms.map((m) => ({ ...m, yr: y(m, m.realizedCents), ye: y(m, m.expectedCents), realText: this.fmt(m, m.realizedCents), expText: this.fmt(m, m.expectedCents) })),
    };
  });

  protected curve(yr: number, ye: number, part: 'all' | 'actual' | 'forecast') {
    return curvePath(234, yr, 454, ye, part);
  }
  protected tick = axisCents;
  protected fmt(m: FlowMeasure, v: number | null) {
    return m.signed ? signedCents(v) : cents(v);
  }
  protected gap(m: FlowMeasure) {
    return m.realizedCents === null || m.expectedCents === null ? 'Inconnu' : signedCents(m.expectedCents - m.realizedCents);
  }
  protected describe(m: FlowMeasure) {
    return `${m.label} : réalisé ${this.fmt(m, m.realizedCents)}, attendu ${this.fmt(m, m.expectedCents)}, écart ${this.gap(m)}`;
  }
}

type ImpactRow = BpmImpact['rows'][number];

/**
 * Impact des projets : entrées et charges de chaque Budget, réalisées et attendues, et leur solde, sur
 * une échelle commune à tous les Budgets (classés par charges attendues). Aucun total consolidé n'est
 * calculé (financement père/enfants non défini).
 */
@Component({
  selector: 'bpm-impact-chart',
  styleUrls: ['../ref-styles/bpm-flow-pilot.component.scss'],
  template: `
    <div class="fp-project-legend">
      <span class="is-income">Entrées</span><span class="is-expense">Charges</span>
    </div>
    <ol class="fp-projects" aria-label="Impact des projets par Budget">
      @for (b of ranked(); track b.budgetId; let rank = $index) {
        <li tabindex="0" [attr.aria-label]="describe(b)">
          <div class="fp-row">
            <span class="fp-rank">{{ rank + 1 }}</span
            ><span class="fp-name">{{ b.name }} <span class="chip">{{ b.role === 'life' ? 'Principal' : 'Projet de la vie' }}</span></span
            ><strong>{{ money(b.spentCents + b.toPayCents) }}</strong>
          </div>
          <div class="fp-curve-caption is-balance"><span>Solde : réalisé puis attendu</span></div>
          <svg class="fp-project-plot" viewBox="0 0 640 252" aria-hidden="true">
            <line class="fp-grid-line" x1="70" x2="608" y1="30" y2="30" />
            <line class="fp-comparison-axis" x1="70" x2="608" [attr.y1]="y(0)" [attr.y2]="y(0)" />
            <text class="fp-tick-label" x="58" y="35" text-anchor="end">{{ tick(domain().max) }}</text>
            <text class="fp-tick-label" x="58" [attr.y]="y(0) + 4" text-anchor="end">0 €</text>
            @if (domain().min < 0) {
              <line class="fp-grid-line" x1="70" x2="608" y1="184" y2="184" />
              <text class="fp-tick-label" x="58" y="188" text-anchor="end">{{ tick(domain().min) }}</text>
            }
            <rect class="fp-project-column is-income is-real" x="108" width="62" rx="4" [attr.y]="top(b.receivedCents)" [attr.height]="height(b.receivedCents)" />
            <rect class="fp-project-column is-expense is-real" x="216" width="62" rx="4" [attr.y]="top(b.spentCents)" [attr.height]="height(b.spentCents)" />
            <rect class="fp-project-column is-income is-forecast" x="378" width="62" rx="4" [attr.y]="top(b.receivedCents + b.toReceiveCents)" [attr.height]="height(b.receivedCents + b.toReceiveCents)" />
            <rect class="fp-project-column is-expense is-forecast" x="486" width="62" rx="4" [attr.y]="top(b.spentCents + b.toPayCents)" [attr.height]="height(b.spentCents + b.toPayCents)" />
            <path class="fp-curve-halo" [attr.d]="balance(b, 'all')" />
            <path class="fp-overlay-curve is-balance" [attr.d]="balance(b, 'actual')" />
            <path class="fp-overlay-curve is-balance is-forecast" [attr.d]="balance(b, 'forecast')" />
            <text class="fp-curve-value" x="193" [attr.y]="y(b.netCents) - 12" text-anchor="middle">{{ signedTick(b.netCents) }}</text>
            <text class="fp-curve-value" x="463" [attr.y]="y(b.expectedNetCents) - 12" text-anchor="middle">{{ signedTick(b.expectedNetCents) }}</text>
            <text class="fp-category-label is-income" x="139" y="213" text-anchor="middle">Reçu</text>
            <text class="fp-category-label is-expense" x="247" y="213" text-anchor="middle">Payé</text>
            <text class="fp-category-label is-income" x="409" y="213" text-anchor="middle">Entrées</text>
            <text class="fp-category-label is-expense" x="517" y="213" text-anchor="middle">Charges</text>
            <text class="fp-category-label" x="193" y="245" text-anchor="middle">Réalisé</text>
            <text class="fp-category-label" x="463" y="245" text-anchor="middle">Attendu</text>
          </svg>
          <div class="fp-project-balance">
            <span>Net réalisé <strong>{{ signed(b.netCents) }}</strong></span
            ><span>Net attendu à la clôture <strong>{{ signed(b.expectedNetCents) }}</strong></span>
          </div>
          <div class="fp-row fp-caption">
            <span class="fp-project-numbers"
              ><span class="is-expense">Payé {{ money(b.spentCents) }} · encore à payer {{ money(b.toPayCents) }}</span
              ><span class="is-income">Reçu {{ money(b.receivedCents) }} · encore à recevoir {{ money(b.toReceiveCents) }}</span></span
            >
          </div>
        </li>
      }
    </ol>
    <div class="fp-chart-legend">
      <span class="is-real">Colonne pleine : réalisé</span><span class="is-forecast">Colonne claire : attendu à la clôture</span>
      <span>Échelle commune : {{ scaleText() }}</span>
    </div>
  `,
  styles: `
    :host { display: grid; gap: var(--ecart-12); min-width: 0; }
    .fp-projects li { outline: none; }
    .fp-projects li:focus-visible { border-color: var(--app-accent); box-shadow: inset 0 0 0 1px var(--app-accent); }
    .fp-projects .fp-row > .fp-name { flex: 1; min-width: 7.5rem; font-weight: 600; display: flex; flex-wrap: wrap; gap: var(--ecart-8); align-items: center; }
    .fp-projects .fp-row > strong { color: var(--status-danger); font-size: var(--fs-lg); font-variant-numeric: tabular-nums; }
    .fp-chart-legend > span:last-child::before { display: none; }
  `,
})
export class BpmImpactChart {
  readonly rows = input.required<ImpactRow[]>();

  protected ranked = computed(() => [...this.rows()].sort((a, b) => b.spentCents + b.toPayCents - (a.spentCents + a.toPayCents)));
  protected domain = computed(() => {
    const all = this.rows().flatMap((r) => [r.receivedCents, r.receivedCents + r.toReceiveCents, r.spentCents, r.spentCents + r.toPayCents, r.netCents, r.expectedNetCents]);
    return { min: Math.min(0, ...all), max: Math.max(1, ...all) };
  });
  protected y(n: number) {
    const { min, max } = this.domain();
    return 184 - ((n - min) / (max - min)) * 154;
  }
  protected top(n: number) {
    return Math.min(this.y(0), this.y(n));
  }
  protected height(n: number) {
    return Math.abs(this.y(n) - this.y(0));
  }
  protected balance(b: ImpactRow, part: 'all' | 'actual' | 'forecast') {
    return curvePath(193, this.y(b.netCents), 463, this.y(b.expectedNetCents), part);
  }
  protected money = cents;
  protected signed = signedCents;
  protected tick = axisCents;
  protected signedTick(n: number) {
    return `${n > 0 ? '+' : ''}${axisCents(n)}`;
  }
  protected describe(b: ImpactRow) {
    return `${b.name} — entrées : réalisé ${cents(b.receivedCents)}, attendu ${cents(b.receivedCents + b.toReceiveCents)} ; charges : réalisé ${cents(b.spentCents)}, attendu ${cents(b.spentCents + b.toPayCents)} ; net : réalisé ${signedCents(b.netCents)}, attendu ${signedCents(b.expectedNetCents)}`;
  }
  protected scaleText = computed(() => `${axisCents(this.domain().min)} à ${axisCents(this.domain().max)}`);
}
