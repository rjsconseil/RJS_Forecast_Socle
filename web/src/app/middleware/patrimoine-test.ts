import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api, ApiError, RecetteContext, toApiError } from '../core/api.service';
import { PatrimoineRead } from '../core/models';
import { euros, EurosPipe, parseAmount } from '../core/format';
import { AppHeroComponent, HeroChip } from '../shared/app-hero.component';
import { MetricTile, MetricTilesComponent } from '../shared/metric-tiles.component';

/** Interface de test du niveau 2 (Patrimoine Management) : lecture brute et mise à jour du Patrimoine. */
@Component({
  selector: 'app-patrimoine-test',
  imports: [JsonPipe, RouterLink, EurosPipe, AppHeroComponent, MetricTilesComponent],
  styleUrl: './patrimoine-test.scss',
  template: `
    <div class="page page-wide management-page psy" data-tone="budget">
      <!-- En-tête de la référence (rjs-app-hero, ambiance Patrimoine) : la coquille le fige sous la barre du haut. -->
      <rjs-app-hero
        tone="lagoon"
        headingId="patrimoine-test-title"
        kicker="Patrimoine Management · Interface de test (niveau 2)"
        title="Patrimoine — middleware"
        lead="Lecture brute du Patrimoine du user actif et de ses capitalisations. Les capitalisations ne sont créées que par les clôtures de période BPM (niveau 3) ; les sommes ci-dessous sont brutes, les chiffres présentés à l'utilisateur passent par les métriques."
        [chips]="chips()"
        toolsLabel="Commandes du middleware"
      >
        <button heroActions type="button" class="app-hero-action" (click)="load()" [disabled]="!ctx.userId()">Relire</button>
      </rjs-app-hero>

      @if (!ctx.userId()) {
        <section class="plan-empty" role="status">
          <p>Choisir un user de test dans l'en-tête : le Patrimoine est propre à un user.</p>
        </section>
      } @else {
        @if (loadError(); as e) {
          <section class="plan-empty" role="alert">
            <div class="psy-error"><span><strong>{{ e.body.code }}</strong> — {{ e.message }}</span><pre>{{ e.body.details | json }}</pre></div>
            <button class="btn btn-secondary" type="button" (click)="load()">Relire les données</button>
          </section>
        }
        @if (data(); as d) {
          <rjs-metric-tiles label="Sommes brutes du Patrimoine (raw)" [tiles]="tiles()" />

          <div class="management-columns">
            <section class="management-panel" aria-labelledby="patrimoine-test-object-title" data-ui-pattern="panel">
              <h2 id="patrimoine-test-object-title">Objet Patrimoine · {{ d.patrimoine.label }}</h2>
              <p>Valeurs enregistrées par le middleware, révision {{ d.patrimoine.revision }}.</p>
              <dl class="management-totals">
                <div>
                  <dt>Stock d'ouverture</dt>
                  <dd>
                    @if (d.patrimoine.openingStock === null) {
                      <span class="psy-unknown">inconnu</span> <small><code>null</code></small>
                    } @else {
                      {{ d.patrimoine.openingStock | euros }} <small><code>{{ d.patrimoine.openingStockCents }}</code> centimes</small>
                    }
                  </dd>
                </div>
                <div>
                  <dt>Objectif</dt>
                  <dd>
                    @if (d.patrimoine.objective === null) {
                      <span class="psy-unknown">inconnu</span> <small><code>null</code></small>
                    } @else {
                      {{ d.patrimoine.objective | euros }} <small><code>{{ d.patrimoine.objectiveCents }}</code> centimes</small>
                    }
                  </dd>
                </div>
              </dl>
              <ul class="management-records">
                <li>
                  <div><strong>{{ d.patrimoine.label }}</strong><small><code>{{ d.patrimoine.id }}</code></small></div>
                  <a class="btn btn-secondary" [routerLink]="['/object-management']" [queryParams]="{ inspect: d.patrimoine.id }">Inspecter</a>
                </li>
                <li>
                  <div><strong>Projet noyau (racine)</strong><small><code>{{ d.patrimoine.coreProjectId }}</code></small></div>
                  <a class="btn btn-secondary" [routerLink]="['/object-management']" [queryParams]="{ inspect: d.patrimoine.coreProjectId }">Inspecter</a>
                </li>
                <li>
                  <div><strong>Budget principal</strong><small><code>{{ d.patrimoine.principalBudgetId }}</code></small></div>
                  <a class="btn btn-secondary" [routerLink]="['/object-management']" [queryParams]="{ inspect: d.patrimoine.principalBudgetId }">Inspecter</a>
                </li>
                <li><div><strong>Date d'ouverture</strong><small>{{ d.patrimoine.openingDate ?? 'null' }}</small></div></li>
                <li><div><strong>Révision {{ d.patrimoine.revision }}</strong><small><code>{{ d.patrimoine.provenance.command }}</code> · {{ d.patrimoine.updatedAt }}</small></div></li>
              </ul>
            </section>

            <section class="management-panel" aria-labelledby="patrimoine-test-update-title" data-ui-pattern="panel">
              <h2 id="patrimoine-test-update-title">Modifier · {{ d.patrimoine.label }}</h2>
              <p>Commande du middleware (test brut) ; version attendue : révision {{ d.patrimoine.revision }}.</p>
              <form class="management-form" (submit)="$event.preventDefault(); save(d)" [attr.aria-busy]="busy()">
                <label>
                  Stock d'ouverture (€)
                  <input [value]="openingStock()" (input)="openingStock.set($any($event.target).value)" inputmode="decimal" placeholder="vide = inconnu (null)" />
                  <small class="psy-hint">Signé ; vide envoie <code>null</code> (inconnu, distinct de 0).</small>
                </label>
                <label>
                  Date d'ouverture
                  <input type="date" [value]="openingDate()" (input)="openingDate.set($any($event.target).value)" />
                  <small class="psy-hint">Vide envoie <code>null</code>.</small>
                </label>
                <label>
                  Objectif (€), facultatif
                  <input [value]="objective()" (input)="objective.set($any($event.target).value)" inputmode="decimal" placeholder="vide = inconnu (null)" />
                  <small class="psy-hint">Vide envoie <code>null</code>.</small>
                </label>
                @if (saveError(); as e) {
                  <div class="psy-error" role="alert">
                    <span><strong>{{ e.body.code }}</strong> — {{ e.message }}</span><pre>{{ e.body.details | json }}</pre>
                    @if (e.isConflict) {
                      <p>Le Patrimoine a été modifié entre-temps. Votre saisie est conservée.</p>
                      <button type="button" class="btn btn-secondary" (click)="reloadKeepingInput()">Relire la version actuelle</button>
                    }
                  </div>
                }
                @if (savedNote()) {
                  <p role="status" class="management-message">{{ savedNote() }}</p>
                }
                <div class="bw-actions">
                  <button class="btn btn-primary" type="submit" [disabled]="busy()">{{ busy() ? 'Enregistrement…' : 'Enregistrer les modifications' }}</button>
                  <button class="btn btn-secondary" type="button" (click)="fill(d)">Rétablir les valeurs lues</button>
                </div>
              </form>
            </section>
          </div>

          <section class="psy-panel" aria-labelledby="patrimoine-test-caps-title" data-ui-pattern="panel">
            <header>
              <p class="psy-kicker">Capitalisations · {{ d.capitalizations.length }}</p>
              <h2 id="patrimoine-test-caps-title">Les clôtures reçues dans le stock</h2>
              <p>Elles naissent des clôtures de période BPM. Aucune somme « stock » n'est calculée ici : le stock présenté est la métrique administrable correspondante côté BPM.</p>
            </header>
            @if (d.capitalizations.length) {
              <ul class="psy-projects">
                @for (c of d.capitalizations; track c.id) {
                  <li>
                    <div>
                      <strong>{{ c.label }}</strong>
                      <small>
                        {{ c.date }} · <code>{{ c.amountCents }}</code> centimes · rév. {{ c.revision }} ·
                        @if (c.source) {
                          source {{ c.source.kind }}
                          <a [routerLink]="['/object-management']" [queryParams]="{ inspect: c.source.id }"><code>{{ c.source.id }}</code></a>
                        } @else {
                          source <code>null</code>
                        }
                      </small>
                    </div>
                    <span [attr.data-tone]="c.amount < 0 ? 'danger' : c.amount > 0 ? 'success' : null">{{ c.amount | euros }}</span>
                    <a [routerLink]="['/object-management']" [queryParams]="{ inspect: c.id }">Inspecter</a>
                  </li>
                }
              </ul>
            } @else {
              <p class="psy-state">Aucune capitalisation (elles naissent des clôtures de période BPM).</p>
            }
          </section>

          <details class="psy-json app-disclosure">
            <summary>JSON brut</summary>
            <pre>{{ d | json }}</pre>
          </details>
        } @else if (!loadError()) {
          <p class="psy-state" role="status">Lecture du patrimoine…</p>
        }
      }
    </div>
  `,
})
export class PatrimoineTest {
  private api = inject(Api);
  protected ctx = inject(RecetteContext);

  protected data = signal<PatrimoineRead | null>(null);
  protected loadError = signal<ApiError | null>(null);
  protected openingStock = signal('');
  protected openingDate = signal('');
  protected objective = signal('');
  protected busy = signal(false);
  protected saveError = signal<ApiError | null>(null);
  protected savedNote = signal<string | null>(null);

  /** Pastilles du bandeau : valeurs lues, sans calcul. */
  protected chips = computed<HeroChip[]>(() => {
    const d = this.data();
    if (!this.ctx.userId() || !d) return [];
    return [
      { label: 'Révision', value: String(d.patrimoine.revision) },
      { label: "Date d'ouverture", value: d.patrimoine.openingDate ?? 'null' },
      { label: 'Capitalisations', value: String(d.capitalizations.length) },
    ];
  });

  /** Tuiles des sommes brutes (raw) renvoyées par le middleware ; aucune somme n'est recalculée ici. */
  protected tiles = computed<MetricTile[]>(() => {
    const d = this.data();
    if (!d) return [];
    return [
      {
        id: 'opening',
        label: "Stock d'ouverture",
        value: d.raw.openingStock === null ? 'Inconnu' : euros(d.raw.openingStock),
        tone: d.raw.openingStock === null ? 'warning' : null,
        emphasis: true,
        note: d.raw.openingStock === null ? 'raw.openingStock · null (inconnu, distinct de 0).' : 'raw.openingStock',
      },
      { id: 'capitalized', label: 'Capitalisé', value: euros(d.raw.capitalized), note: 'raw.capitalized · somme brute des capitalisations.' },
      { id: 'caps', label: 'Capitalisations', value: String(d.capitalizations.length), note: 'Nées des clôtures de période BPM.' },
    ];
  });

  constructor() {
    effect(() => {
      const userId = this.ctx.userId();
      untracked(() => {
        this.data.set(null);
        if (userId) this.load();
      });
    });
  }

  async load() {
    this.loadError.set(null);
    try {
      const d = await this.api.patrimoine();
      this.data.set(d);
      this.fill(d);
    } catch (err) {
      this.loadError.set(toApiError(err));
    }
  }

  /** Relit la version actuelle sans écraser la saisie (nouvelle base pour expectedRevision). */
  async reloadKeepingInput() {
    try {
      this.data.set(await this.api.patrimoine());
      this.saveError.set(null);
    } catch (err) {
      this.saveError.set(toApiError(err));
    }
  }

  fill(d: PatrimoineRead) {
    this.openingStock.set(d.patrimoine.openingStock === null ? '' : String(d.patrimoine.openingStock));
    this.openingDate.set(d.patrimoine.openingDate ?? '');
    this.objective.set(d.patrimoine.objective === null ? '' : String(d.patrimoine.objective));
  }

  async save(d: PatrimoineRead) {
    this.saveError.set(null);
    this.savedNote.set(null);
    const stock = parseAmount(this.openingStock());
    const objective = parseAmount(this.objective());
    const invalid = (field: string, message: string) => this.saveError.set(new ApiError(400, { code: 'VALIDATION', action: 'local', message, details: { field } }));
    if (stock === 'invalid') return invalid('openingStock', "Stock d'ouverture : montant en euros attendu, ou vide.");
    if (objective === 'invalid') return invalid('objective', 'Objectif : montant en euros attendu, ou vide.');
    this.busy.set(true);
    try {
      const fresh = await this.api.updatePatrimoine(d.patrimoine.id, {
        expectedRevision: d.patrimoine.revision,
        openingStock: stock,
        openingDate: this.openingDate() || null,
        objective,
      });
      this.data.set(fresh);
      this.fill(fresh);
      this.savedNote.set(`Enregistré : révision ${fresh.patrimoine.revision}.`);
    } catch (err) {
      this.saveError.set(toApiError(err));
    } finally {
      this.busy.set(false);
    }
  }
}
