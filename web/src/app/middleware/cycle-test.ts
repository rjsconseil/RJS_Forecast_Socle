import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AppHeroComponent } from '../shared/app-hero.component';
import { MetricTile, MetricTilesComponent } from '../shared/metric-tiles.component';

interface CyclePeriod { key: string; index: number; start: string; end: string; label: string; shift: number }
interface CycleProbe {
  today: string; anchorDay: number; date: string; current: CyclePeriod; periods: CyclePeriod[];
  cadences: { id: string; label: string; perYear: number; monthlyAverageCents: number; yearlyCents: number }[];
}
const euros = (cents: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const fr = (ymd: string) => new Date(ymd + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Interface de test du middleware technique « Cycle et temps » : périodes d'un cycle et cadences, en lecture pure. */
@Component({
  selector: 'app-cycle-test',
  imports: [FormsModule, AppHeroComponent, MetricTilesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .cy-form { display: flex; flex-wrap: wrap; gap: 16px; align-items: end; }
    .cy-form label { display: grid; gap: 4px; font-size: 13px; font-weight: 600; }
    .cy-form input { min-height: 40px; padding: 6px 10px; border: 1px solid var(--control-line, #cbd4e0); border-radius: 8px; font: inherit; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 9px 12px; border-bottom: 1px solid var(--line, #e2e7ef); text-align: left; }
    th { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted, #627086); }
    tr.is-current td { font-weight: 700; background: var(--app-accent-soft, #edf4fc); }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .cy-error { color: var(--status-danger, #b63248); font-weight: 600; }
  `,
  template: `
    <div class="page page-wide management-page" data-tone="core">
      <rjs-app-hero
        tone="lagoon"
        headingId="cycle-test-title"
        kicker="Cycle et temps · Middleware technique (niveau 2)"
        title="Cycle et temps — middleware"
        lead="Les règles du temps partagées par les middlewares métier : périodes d’un cycle selon son jour d’ancrage, et cadences des répétitions. Lecture pure : ce middleware ne porte aucun objet et n’écrit rien."
        toolsLabel="Commandes du middleware"
      >
        <button heroActions type="button" class="app-hero-action" (click)="load()">Relire</button>
      </rjs-app-hero>

      <section class="management-panel" aria-labelledby="cy-params-title" data-ui-pattern="panel">
        <h2 id="cy-params-title">Paramètres d’essai</h2>
        <div class="cy-form">
          <label>Jour d’ancrage du cycle (1 à 28)<input type="number" min="1" max="28" [ngModel]="anchorDay()" (ngModelChange)="anchorDay.set(+$event)" /></label>
          <label>Date à situer<input type="date" [ngModel]="date()" (ngModelChange)="date.set($event)" /></label>
          <label>Montant par occurrence (€)<input type="number" min="0" step="1" [ngModel]="amount()" (ngModelChange)="amount.set(+$event)" /></label>
        </div>
        @if (error(); as e) { <p class="cy-error" role="alert">{{ e }}</p> }
      </section>

      @if (data(); as d) {
        <rjs-metric-tiles label="Période qui contient la date" [tiles]="tiles()" />

        <section class="management-panel" aria-labelledby="cy-periods-title" data-ui-pattern="panel">
          <h2 id="cy-periods-title">Périodes voisines</h2>
          <p>Du jour d’ancrage à la veille du suivant ; la période porte la clé du mois de son début.</p>
          <table>
            <thead><tr><th>Clé</th><th>Période</th><th>Début (inclus)</th><th>Fin (incluse)</th></tr></thead>
            <tbody>
              @for (p of d.periods; track p.key) {
                <tr [class.is-current]="p.shift === 0"><td>{{ p.key }}</td><td>{{ p.label }}</td><td>{{ day(p.start) }}</td><td>{{ day(p.end) }}</td></tr>
              }
            </tbody>
          </table>
        </section>

        <section class="management-panel" aria-labelledby="cy-cadences-title" data-ui-pattern="panel">
          <h2 id="cy-cadences-title">Cadences</h2>
          <p>Le vocabulaire commun des répétitions : récurrences de Budget, apports de Patrimoine.</p>
          <table>
            <thead><tr><th>Cadence</th><th>Code</th><th class="num">Occurrences par an</th><th class="num">Moyenne mensuelle</th><th class="num">Total annuel</th></tr></thead>
            <tbody>
              @for (c of d.cadences; track c.id) {
                <tr><td>{{ c.label }}</td><td>{{ c.id }}</td><td class="num">{{ c.perYear }}</td><td class="num">{{ money(c.monthlyAverageCents) }}</td><td class="num">{{ money(c.yearlyCents) }}</td></tr>
              }
            </tbody>
          </table>
        </section>
      }
    </div>
  `,
})
export class CycleTest {
  private readonly http = inject(HttpClient);
  protected readonly anchorDay = signal(25);
  protected readonly date = signal(new Date().toISOString().slice(0, 10));
  protected readonly amount = signal(100);
  protected readonly data = signal<CycleProbe | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly day = fr;
  protected readonly money = euros;
  protected readonly tiles = computed<MetricTile[]>(() => {
    const d = this.data();
    if (!d) return [];
    return [
      { id: 'period', label: 'Période', value: d.current.label, emphasis: true },
      { id: 'key', label: 'Clé de période', value: d.current.key },
      { id: 'start', label: 'Début', value: fr(d.current.start) },
      { id: 'end', label: 'Fin', value: fr(d.current.end) },
      { id: 'today', label: 'Date du jour du socle', value: fr(d.today) },
    ];
  });
  constructor() {
    effect(() => {
      this.anchorDay(); this.date(); this.amount();
      void this.load();
    });
  }
  async load() {
    try {
      const params = { anchorDay: String(this.anchorDay()), date: this.date(), amount: String(this.amount() || 0) };
      this.data.set(await firstValueFrom(this.http.get<CycleProbe>('/api/cycle', { params })));
      this.error.set(null);
    } catch (e) {
      this.error.set((e as { error?: { error?: { message?: string } } }).error?.error?.message ?? 'Lecture impossible.');
    }
  }
}
