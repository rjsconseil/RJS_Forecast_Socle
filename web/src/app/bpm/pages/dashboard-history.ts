import { Component, computed, inject, input, signal } from '@angular/core';
import { BpmApi } from '../../core/bpm-api.service';
import { HistoryRow } from '../../core/bpm-models';
import { CentsPipe, SignedCentsPipe } from '../../core/format';
import { BpmPageContext, BpmSeriesChart, BpmShareChart, BpmState, bpmLoader, ChartSeries, SeriesFormat, ShareItem } from '../ui';

const HISTORY_STATUS: Record<HistoryRow['status'], { label: string; tone: string }> = {
  closed: { label: 'Enregistrée', tone: 'recorded' },
  ended: { label: 'Terminée, à clôturer', tone: 'warn' },
  current: { label: 'En cours', tone: 'accent' },
  future: { label: 'Prévision', tone: 'estimate' },
};

/**
 * Historique des périodes du tableau de bord, sur le cadre source `dh-history` : variante Flux ou
 * Patrimoine (gardée dans l'URL), périodes closes enregistrées et période ouverte estimée,
 * répartition d'une période choisie et pagination vers les périodes plus anciennes.
 * Le contexte de page (`BpmPageContext`) est celui du tableau de bord parent.
 */
@Component({
  selector: 'bpm-dashboard-history',
  imports: [BpmState, BpmSeriesChart, BpmShareChart, CentsPipe, SignedCentsPipe],
  styleUrl: '../ref-styles/bpm-dashboard-history.component.scss',
  template: `
    <section class="dh-history" aria-labelledby="bm-history-title" [attr.aria-busy]="history.loading()">
      <header class="dh-heading">
        <div>
          <span class="dh-eyebrow"><span aria-hidden="true">▥</span> Graphique</span>
          <h2 id="bm-history-title">Historique des périodes</h2>
          <p>Périodes closes enregistrées, période ouverte estimée.</p>
        </div>
        @if (history.data(); as h) {
          <span class="dh-cadence">{{ rows().length }} période(s) sur {{ h.total }}</span>
        }
      </header>

      <bpm-state [loading]="history.loading() && !history.data()" [error]="history.error()" (retry)="history.reload()" [empty]="!!history.data() && !rows().length" emptyText="Aucune période à afficher." />

      @if (rows().length) {
        <div class="dh-workspace" data-bpm-frame="chart">
          <p class="dh-chart-help">
            {{ variant() === 'flux' ? 'Entrées et dépenses par période, avec le net ; la période ouverte est une estimation.' : 'Patrimoine connu par période, série séparée des flux : enregistré puis estimé.' }}
          </p>
          <div class="dh-toolbar">
            <strong>{{ variant() === 'flux' ? 'Flux de chaque période' : 'Patrimoine de chaque période' }}</strong>
            <div class="dh-chart-actions">
              <span class="segmented" role="group" aria-label="Variante de l'historique">
                <button type="button" [attr.aria-pressed]="variant() === 'flux'" (click)="setVariant('flux')">Flux</button>
                <button type="button" [attr.aria-pressed]="variant() === 'patrimoine'" (click)="setVariant('patrimoine')">Patrimoine</button>
              </span>
            </div>
          </div>
          @if (variant() === 'flux') {
            <bpm-series-chart
              title="Entrées, dépenses et net par période"
              [categories]="categories()"
              [series]="fluxSeries()"
              [formats]="fluxFormats"
              initialFormat="combined"
              (select)="selIndex.set($event)"
            />
          } @else {
            <bpm-series-chart
              title="Patrimoine connu par période (série séparée des flux)"
              [categories]="categories()"
              [series]="patSeries()"
              [formats]="patFormats"
              initialFormat="lines"
              emptyText="Patrimoine inconnu sur ces périodes : stock à renseigner."
              (select)="selIndex.set($event)"
            />
          }
        </div>

        <div class="dh-presets" role="group" aria-label="Statut des périodes affichées">
          @for (r of rows(); track r.periodKey; let i = $index) {
            <button type="button" class="dh-preset" [attr.aria-pressed]="selIndex() === i" (click)="selIndex.set(i)">
              <strong>{{ r.label }}</strong>
              <small class="chip" [class]="statusTone(r)">{{ statusLabel(r) }}</small>
            </button>
          }
        </div>

        @if (selected(); as r) {
          <section class="dh-detail" aria-labelledby="dh-detail-title">
            <header class="dh-detail-heading">
              <div>
                <small>{{ statusLabel(r) }}</small>
                <h3 id="dh-detail-title">{{ r.label }}</h3>
              </div>
              @if (r.periodKey !== currentKey()) {
                <button type="button" class="btn btn-secondary" (click)="goPeriod(r.periodKey)">Lire cette période</button>
              }
            </header>
            @if (variant() === 'flux') {
              @if (r.receivedCents === null || r.spentCents === null) {
                <p class="dh-notice">Répartition non calculable : entrées ou dépenses inconnues.</p>
              } @else {
                <bpm-share-chart
                  [title]="'Mouvements de ' + r.label"
                  [items]="splitItems(r)"
                  [base]="splitBase(r)"
                  [baseLabel]="r.receivedCents > 0 && r.receivedCents >= r.spentCents ? 'Entrées' : 'Dépenses'"
                  [formats]="['pie', 'donut', 'bar']"
                  [clickable]="false"
                />
                @if (r.spentCents > r.receivedCents) {
                  <p class="dh-scope">Part des dépenses non couverte par les entrées : {{ r.spentCents - r.receivedCents | cents }} (déficit, jamais représenté comme un secteur).</p>
                }
              }
            } @else {
              <p>Patrimoine {{ r.patrimoineKind }} : <span class="num">{{ r.patrimoineCents === null ? 'Inconnu' : (r.patrimoineCents | signedCents) }}</span>
                @if (r.capitalizedCents !== null) { · résultat capitalisé {{ r.capitalizedCents | signedCents }} }
              </p>
            }
          </section>
        }

        <div class="dh-toolbar">
          <p class="dh-scale">{{ rows().length }} période(s) sur {{ history.data()?.total }} · périodes closes enregistrées, période ouverte estimée</p>
          <div class="dh-chart-actions">
            @if (history.data()?.nextBefore !== null && history.data()?.nextBefore !== undefined) {
              <button type="button" class="btn btn-secondary" (click)="older()">‹ Périodes précédentes</button>
            }
            @if (before()) {
              <button type="button" class="btn btn-secondary" (click)="newest()">Périodes les plus récentes ›</button>
            }
          </div>
        </div>
      }
    </section>
  `,
  styles: `
    .dh-presets { display: grid; gap: var(--ecart-8); grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr)); }
    .dh-preset .chip { justify-self: start; }
  `,
})
export class BpmDashboardHistory {
  private ctx = inject(BpmPageContext);
  private bpm = inject(BpmApi);

  /** Clé de la période lue par le tableau de bord. */
  readonly currentKey = input<string | null | undefined>(null);

  protected before = this.ctx.q('avant');
  private variantParam = this.ctx.q('historique');
  protected history = bpmLoader(() => this.before(), (b) => this.bpm.history({ limit: 6, before: b ? Number(b) : undefined }));

  protected readonly fluxFormats: SeriesFormat[] = ['combined', 'lines', 'bars', 'area'];
  protected readonly patFormats: SeriesFormat[] = ['lines', 'bars', 'area'];
  protected variant = computed(() => (this.variantParam() === 'patrimoine' ? 'patrimoine' : 'flux'));
  protected selIndex = signal<number | null>(null);
  /** Chronologique (l'API renvoie de la plus récente à la plus ancienne). */
  protected rows = computed(() => [...(this.history.data()?.rows ?? [])].reverse());
  protected categories = computed(() => this.rows().map((r) => r.label));
  protected selected = computed(() => {
    const i = this.selIndex();
    return i === null ? null : (this.rows()[i] ?? null);
  });

  protected fluxSeries = computed<ChartSeries[]>(() => {
    const rows = this.rows();
    const series: ChartSeries[] = [
      { key: 'in', label: 'Entrées', color: 'var(--s-income)', values: rows.map((r) => r.receivedCents), kind: 'bar' },
      { key: 'out', label: 'Dépenses', color: 'var(--s-charge)', values: rows.map((r) => r.spentCents), kind: 'bar' },
      { key: 'net', label: 'Net', color: 'var(--s-net)', values: rows.map((r) => r.netCents), kind: 'line' },
    ];
    if (rows.some((r) => r.expectedCents !== null)) {
      series.push({ key: 'expected', label: 'Solde prévu à la clôture (période ouverte)', color: 'var(--s-expected)', values: rows.map((r) => r.expectedCents), kind: 'line', dashed: true });
    }
    return series;
  });

  protected patSeries = computed<ChartSeries[]>(() => {
    const rows = this.rows();
    const firstEstimate = rows.findIndex((r) => !r.recorded);
    return [{ key: 'pat', label: 'Patrimoine (enregistré puis estimé)', color: 'var(--s-patrimoine)', values: rows.map((r) => r.patrimoineCents), kind: 'line', forecastFrom: firstEstimate < 0 ? null : firstEstimate }];
  });

  protected statusLabel = (r: HistoryRow) => HISTORY_STATUS[r.status]?.label ?? r.status;
  protected statusTone = (r: HistoryRow) => HISTORY_STATUS[r.status]?.tone ?? '';

  /** Base des parts : les entrées si elles sont positives et couvrent les dépenses ; sinon les dépenses. */
  protected splitBase(r: HistoryRow) {
    const inc = r.receivedCents ?? 0;
    const out = r.spentCents ?? 0;
    return inc > 0 && inc >= out ? inc : out;
  }
  protected splitItems(r: HistoryRow): ShareItem[] {
    const inc = r.receivedCents ?? 0;
    const out = r.spentCents ?? 0;
    if (inc > 0 && inc >= out) {
      return [
        { key: 'out', label: 'Dépenses', cents: out, color: 'var(--s-charge)' },
        { key: 'rest', label: 'Reste (entrées non dépensées)', cents: inc - out, color: 'var(--s-rest)' },
      ];
    }
    return [{ key: 'in', label: 'Dépenses couvertes par les entrées', cents: inc, color: 'var(--s-income)' }];
  }

  protected setVariant(v: 'flux' | 'patrimoine') {
    this.ctx.setQuery({ historique: v === 'flux' ? null : v }, { replace: true });
  }
  protected older() {
    const nb = this.history.data()?.nextBefore;
    if (nb !== null && nb !== undefined) {
      this.selIndex.set(null);
      this.ctx.setQuery({ avant: nb });
    }
  }
  protected newest() {
    this.selIndex.set(null);
    this.ctx.setQuery({ avant: null });
  }
  protected goPeriod(key: string) {
    this.ctx.setQuery({ period: key });
  }
}
