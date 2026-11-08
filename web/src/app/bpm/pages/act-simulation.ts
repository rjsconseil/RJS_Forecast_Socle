import { Component, computed, inject, linkedSignal, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BpmApi } from '../../core/bpm-api.service';
import { Cadence } from '../../core/bpm-models';
import { cents, CentsPipe, parseAmount, percentText, SignedCentsPipe } from '../../core/format';
import { bpmLoader, BpmPageContext, BpmSeriesChart, BpmState, ChartSeries } from '../ui';

const CADENCE_TEXT: Record<string, string> = { weekly: 'semaine', monthly: 'mois', yearly: 'année' };

export interface SimulationAdoption { contributionCents: number; cadence: Exclude<Cadence, 'once'>; }

/**
 * Panneau « Simulation » : effort supplémentaire par période → Patrimoine futur et écart au scénario
 * de base (lecture `projection?extra=`, aucune écriture). L'effort appliqué est gardé dans l'URL
 * (`?effort=`). Retenir un scénario préremplit les hypothèses ; seule leur confirmation les enregistre.
 */
@Component({
  selector: 'bpm-act-simulation',
  imports: [RouterLink, BpmState, BpmSeriesChart, CentsPipe, SignedCentsPipe],
  styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-vision.page.scss'],
  template: `
    <section class="bv-card" aria-labelledby="bp-sim-title" data-ui-pattern="panel">
      <h2 id="bp-sim-title">Simulation</h2>
      <p>Effort supplémentaire par période et Patrimoine futur, sans écriture.</p>
      <form class="sim" (submit)="apply($event)" aria-label="Simulation d'un effort supplémentaire">
        <label class="bp-sim-label">
          Effort supplémentaire par période (€)
          <input name="effort" inputmode="decimal" class="num" [value]="draft()" (input)="draft.set($any($event.target).value)" placeholder="ex. 100" [attr.aria-invalid]="draftError() ? 'true' : null" aria-describedby="sim-help" />
          @if (draftError()) { <span class="err">{{ draftError() }}</span> }
          <span id="sim-help" class="bpm-help">Période = rythme de l'apport de projection{{ cadenceText() ? ' (' + cadenceText() + ')' : '' }}. Simulation sans écriture.</span>
        </label>
        <div class="bpm-actions">
          <button type="submit" class="btn btn-primary">Simuler</button>
          @if (effort()) { <button type="button" class="btn btn-secondary" (click)="clear()">Effacer</button> }
        </div>
      </form>

      @if (!effort()) {
        <p class="bv-empty">Saisissez un effort par période pour comparer le Patrimoine futur au scénario de base.</p>
      } @else {
        <bpm-state [loading]="sim.loading() && !sim.data()" [error]="sim.error()" (retry)="sim.reload()" />
        @if (sim.data(); as p) {
          @if (p.status === 'missing-hypothesis' || !p.keyFigures) {
            <p class="bpm-missing" role="status">
              Non calculable : {{ p.reason ?? 'hypothèses de projection incomplètes.' }}
              <a routerLink="/vision/projection">Compléter dans Objectifs et avenir →</a>
            </p>
          } @else {
            @if (p.hypotheses.startCents === null) {
              <p class="bpm-missing" role="status">Stock initial à renseigner{{ p.hypotheses.stockReason ? ' (' + p.hypotheses.stockReason + ')' : '' }} : cette projection n'est pas fiable.</p>
            }
            <div class="bv-table-scroll">
              <table class="bp-compare">
                <caption class="visually-hidden">Patrimoine futur en {{ horizonYear() }} : scénario de base et simulation</caption>
                <thead>
                  <tr>
                    <th scope="col"></th>
                    <th scope="col">Scénario de base</th>
                    <th scope="col">Avec l’effort <span class="chip estimate">Estimation</span></th>
                    <th scope="col">Écart</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Patrimoine futur en {{ horizonYear() }} (nominal)</th>
                    <td>{{ p.baseline?.keyFigures?.nominalAtHorizonCents ?? null | cents }}</td>
                    <td>{{ p.keyFigures.nominalAtHorizonCents | cents }}</td>
                    <td [attr.data-sign]="sign(lastDiff()?.nominalCents ?? null)">{{ lastDiff()?.nominalCents ?? null | signedCents }}</td>
                  </tr>
                  <tr>
                    <th scope="row">En euros d’aujourd’hui</th>
                    <td>{{ p.baseline?.rows?.at(-1)?.realCents ?? null | cents }}</td>
                    <td>{{ p.rows.at(-1)?.realCents ?? null | cents }}</td>
                    <td [attr.data-sign]="sign(lastDiff()?.realCents ?? null)">{{ lastDiff()?.realCents ?? null | signedCents }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="bpm-help">Mêmes hypothèses pour les deux scénarios ; seul l’effort simulé change. Une valeur inconnue s’affiche « Inconnu ».</p>
            <bpm-series-chart title="Patrimoine projeté : simulation et base" [categories]="years()" [series]="series()" [formats]="['lines', 'area']" initialFormat="lines" categoryLabel="Année" />
            <details class="bpm-limited">
              <summary>Hypothèses de la simulation</summary>
              <dl class="bpm-recap">
                <div><dt>Horizon</dt><dd>{{ p.hypotheses.horizonYears }} an(s)</dd></div>
                <div><dt>Rendement annuel</dt><dd>{{ pct(p.hypotheses.ratePct) }}</dd></div>
                <div><dt>Inflation</dt><dd>{{ pct(p.hypotheses.inflationPct) }} ({{ p.hypotheses.inflationSource }})</dd></div>
                <div><dt>Apport de base</dt><dd>{{ p.hypotheses.contributionCents | signedCents }} par {{ cadenceText() }} — {{ p.hypotheses.contributionSource }}</dd></div>
                <div><dt>Effort simulé</dt><dd>{{ (p.hypotheses.extraCents ?? 0) | signedCents }} par {{ cadenceText() }}</dd></div>
                <div><dt>Stock de départ</dt><dd>{{ p.hypotheses.startCents === null ? 'À renseigner' : (p.hypotheses.startCents | cents) }}</dd></div>
              </dl>
            </details>

            <section class="adopt" aria-labelledby="bp-adopt-title">
              <h3 id="bp-adopt-title">Retenir ce scénario</h3>
              <p>Apport proposé : <strong>{{ (p.hypotheses.contributionCents ?? 0) + (p.hypotheses.extraCents ?? 0) | cents }}</strong> par {{ cadenceText() }}.</p>
              <p class="bpm-help">Relisez les hypothèses avant de les enregistrer. Cette action ajuste la projection ; elle ne crée ni dépense ni transfert.</p>
              <button type="button" class="btn btn-secondary" [disabled]="sim.loading() || !!sim.error()" (click)="adopt()">Reprendre cet apport dans les hypothèses</button>
            </section>
          }
        }
      }
    </section>
  `,
  styles: `
    .sim { display: grid; gap: var(--ecart-12); max-width: 32rem; }
    .sim .err { color: var(--status-danger); font-weight: 400; font-size: var(--fs-sm); }
    .bp-sim-label .bpm-help { font-weight: 400; font-size: var(--fs-sm); }
    .adopt { display: grid; gap: var(--ecart-12); padding: var(--ecart-16); border: 1px solid var(--card-border); border-radius: var(--rayon-12); background: var(--soft); }
    .adopt > button { justify-self: start; }
  `,
})
export class BpmActSimulation {
  private bpm = inject(BpmApi);
  private ctx = inject(BpmPageContext);
  readonly adoptRequest = output<SimulationAdoption>();

  /** Effort appliqué (euros, URL). */
  protected effort = computed(() => this.ctx.q('effort')());
  protected draft = linkedSignal(() => this.effort().replace('.', ','));
  protected draftError = computed(() => {
    const v = this.draft().trim();
    if (!v) return null;
    const a = parseAmount(v);
    return typeof a === 'number' ? null : 'Montant attendu (ex. 100 ou 75,50).';
  });
  protected extraEuros = computed(() => {
    const a = parseAmount(this.effort());
    return typeof a === 'number' ? a : null;
  });
  protected extraCents = computed(() => (this.extraEuros() === null ? null : Math.round(this.extraEuros()! * 100)));

  protected sim = bpmLoader(
    () => this.extraEuros(),
    (extra) => (extra === null || extra === 0 ? Promise.resolve(null) : this.bpm.projection({ extra })),
  );

  protected cadenceText = computed(() => CADENCE_TEXT[this.sim.data()?.hypotheses.cadence ?? ''] ?? '');
  protected years = computed(() => (this.sim.data()?.rows ?? []).map((r) => String(r.year)));
  protected horizonYear = computed(() => this.sim.data()?.rows.at(-1)?.year ?? '');
  protected lastDiff = computed(() => this.sim.data()?.difference?.at(-1) ?? null);
  protected series = computed<ChartSeries[]>(() => {
    const p = this.sim.data();
    if (!p) return [];
    const out: ChartSeries[] = [{ key: 'sim', label: 'Avec l’effort (nominal)', color: 'var(--s-patrimoine)', values: p.rows.map((r) => r.nominalCents), kind: 'line' }];
    if (p.baseline) out.push({ key: 'base', label: 'Scénario de base (nominal)', color: 'var(--s-nominal)', values: p.baseline.rows.map((r) => r.nominalCents), kind: 'line', dashed: true });
    return out;
  });
  protected pct = percentText;
  protected sign(v: number | null) {
    return v === null ? null : v < 0 ? 'negative' : v > 0 ? 'positive' : null;
  }

  protected apply(e: Event) {
    e.preventDefault();
    if (this.draftError()) return;
    const a = parseAmount(this.draft());
    this.ctx.setQuery({ effort: typeof a === 'number' && a !== 0 ? String(a) : null }, { replace: true });
  }
  protected clear() {
    this.ctx.setQuery({ effort: null }, { replace: true });
  }

  protected adopt() {
    const projection = this.sim.data();
    if (!projection || projection.status !== 'estimate' || this.sim.loading() || this.sim.error()) return;
    const h = projection.hypotheses;
    this.adoptRequest.emit({ contributionCents: (h.contributionCents ?? 0) + (h.extraCents ?? 0), cadence: h.cadence });
  }
}
