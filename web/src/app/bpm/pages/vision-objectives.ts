import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiError, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmDirectives, BpmSummary, SetupProfile, Vision } from '../../core/bpm-models';
import { CentsPipe, PercentPipe, SignedCentsPipe, parseAmount, signedCents } from '../../core/format';
import { BpmProgress, BpmRefresh, BpmState, Loader } from '../ui';

/** Nombre saisi (virgule acceptée) : null si vide, NaN si invalide. */
export function num(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, '').replace(',', '.');
  return s === '' ? null : Number(s);
}
export const euroText = (c: number | null) => (c === null ? '' : String(c / 100).replace('.', ','));

/**
 * Les deux objectifs d'Objectifs et avenir, sur la structure source `rjs-bpm-objectives` : l'objectif
 * budgétaire (épargne visée, objectif d'excédent cumulé et son formulaire) et le cap patrimonial
 * (stock enregistré face à l'objectif de stock). Deux cibles distinctes, jamais additionnées.
 */
@Component({
  selector: 'bpm-vision-objectives',
  imports: [FormsModule, RouterLink, BpmState, BpmProgress, CentsPipe, SignedCentsPipe, PercentPipe],
  host: { class: 'is-compact' },
  styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-objectives.component.scss'],
  template: `
    <section class="objectives objectives-budget" data-bpm-frame="metrics" data-ui-pattern="panel" aria-labelledby="budget-objectives-title" id="objectifs-budgetaires">
      <header data-ui-pattern="section-heading">
        <span class="objectives-eyebrow">À chaque période</span>
        <h2 id="budget-objectives-title">Objectif budgétaire</h2>
        <p>Épargne et excédent par période. Son enregistrement ne modifie pas directement le stock patrimonial.</p>
      </header>
      <bpm-state [loading]="directives().loading() && !directives().data()" [error]="directives().error()" (retry)="directives().reload()" />
      <dl class="objectives-summary">
        <div>
          <dt>Épargne visée</dt>
          <dd>{{ vision()?.savingsTargetCents === null || !vision() ? 'Non renseignée' : (vision()!.savingsTargetCents | cents) + ' / période' }}</dd>
        </div>
        <div>
          <dt>Apport par période (projection)</dt>
          <dd>{{ contribution() }}</dd>
        </div>
        @if (surplus(); as sp) {
          <div>
            <dt>Cible cumulée</dt>
            <dd>{{ sp.targetCents | cents }}</dd>
            <small>{{ sp.periods }} périodes dès {{ sp.startKey }}</small>
          </div>
        }
      </dl>
      @if (surplus(); as sp) {
        <dl class="objectives-metrics">
          <div>
            <dt>Excédent cumulé · {{ sp.closedPeriods }} clôture(s)</dt>
            <dd>{{ sp.cumulatedCents | signedCents }}</dd>
          </div>
          <div>
            <dt>Effort nécessaire</dt>
            <dd>{{ sp.perPeriodCents | cents }} / période</dd>
          </div>
          <div>
            <dt>Progression</dt>
            <dd>{{ sp.progressPct | pct }}</dd>
          </div>
        </dl>
        <bpm-progress label="Excédent cumulé face à sa cible" [value]="sp.cumulatedCents" [target]="sp.targetCents" [detail]="'Somme des résultats clôturés depuis ' + sp.startKey + '.'" />
      } @else if (directives().data()) {
        <p class="objectives-callout">Aucun objectif d’excédent budgétaire défini. Son enregistrement ne modifie pas directement le stock patrimonial.</p>
      }
      <details class="objectives-settings" [open]="surplusOpen()" (toggle)="surplusOpen.set($any($event.target).open)">
        <summary>{{ surplus() ? 'Modifier l’objectif d’excédent' : 'Définir un objectif d’excédent' }}</summary>
        @if (surplusError(); as e) {
          <p class="bpm-error" role="alert">{{ e.message }} Votre saisie est conservée.</p>
        }
        <form (ngSubmit)="saveSurplus()" (input)="surplusDirty = true" (change)="surplusDirty = true" novalidate>
          <div class="objectives-fields">
            <label>
              Montant cible cumulé (€)
              <input name="sTarget" inputmode="decimal" [(ngModel)]="sTarget" [attr.aria-invalid]="surplusErr('surplus.target') ? 'true' : null" />
              @if (surplusErr('surplus.target')) { <span class="bpm-error">{{ surplusErr('surplus.target') }}</span> }
            </label>
            <label>
              Nombre de périodes
              <input name="sPeriods" inputmode="numeric" [(ngModel)]="sPeriods" [attr.aria-invalid]="surplusErr('surplus.periods') ? 'true' : null" />
              @if (surplusErr('surplus.periods')) { <span class="bpm-error">{{ surplusErr('surplus.periods') }}</span> }
            </label>
            <label>
              Période de départ
              <input name="sStart" type="month" [(ngModel)]="sStart" [attr.aria-invalid]="surplusErr('surplus.startKey') ? 'true' : null" />
              @if (surplusErr('surplus.startKey')) { <span class="bpm-error">{{ surplusErr('surplus.startKey') }}</span> }
            </label>
          </div>
          <div class="bpm-actions">
            <button type="submit" class="btn btn-primary" [disabled]="surplusBusy() || !profile().data()">Enregistrer l’objectif</button>
            @if (surplus()) {
              <button type="button" class="btn btn-secondary" (click)="clearSurplus()" [disabled]="surplusBusy() || !profile().data()">Retirer l’objectif d’excédent</button>
            }
          </div>
        </form>
      </details>
    </section>

    <section class="objectives objectives-wealth" data-bpm-frame="metrics" data-ui-pattern="panel" aria-labelledby="wealth-objectives-title" id="cap-patrimonial">
      <header data-ui-pattern="section-heading">
        <span class="objectives-eyebrow">Sur toute votre vie</span>
        <h2 id="wealth-objectives-title">Cap patrimonial</h2>
        <p>Objectif de stock du Patrimoine unique. Atteindre le cap ne ferme ni le user ni son projet de vie.</p>
      </header>
      <bpm-state [loading]="summary().loading() && !summary().data()" [error]="summary().error()" (retry)="summary().reload()" />
      @if (summary().data()) {
        <div class="objectives-wealth-route">
          @if (wealthPercent() !== null) {
            <div class="objectives-route-heading">
              <strong>{{ wealthPercent() }} %</strong>
              <span>de l’objectif de stock atteint</span>
            </div>
          }
          <dl class="objectives-wealth-landmarks">
            <div class="objectives-landmark objectives-landmark-current">
              <dt>
                <span class="objectives-landmark-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7"></circle><circle cx="12" cy="12" r="2"></circle></svg>
                </span>Stock enregistré
              </dt>
              <dd>{{ stock() === null ? 'À renseigner' : signed(stock()) }}</dd>
              @if (stock() === null && stockReason()) { <small>{{ stockReason() }}</small> }
            </div>
            <div class="objectives-landmark objectives-landmark-target">
              <dt>
                <span class="objectives-landmark-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none"><path d="M6 21V4m0 0c4-4 8 4 12 0v9c-4 4-8-4-12 0"></path></svg>
                </span>Objectif de stock
              </dt>
              <dd>{{ objective() === null ? 'Non défini' : (objective() | cents) }}</dd>
            </div>
            <div class="objectives-landmark-gap">
              <dt>{{ capGap() !== null && capGap()! < 0 ? 'Dépassement' : 'Manque' }}</dt>
              <dd>{{ capGap() === null ? 'Non calculable' : (capGapAbs() | cents) }}</dd>
              @if (capReason()) { <small>{{ capReason() }}</small> }
            </div>
          </dl>
        </div>
        <dl class="objectives-summary">
          <div>
            <dt>Estimation après la période</dt>
            <dd>{{ stockAfter() | signedCents }}</dd>
            <small>Estimation</small>
          </div>
        </dl>
        <bpm-progress
          label="Stock enregistré face à l’objectif de stock"
          [value]="stock()"
          [target]="objective()"
          [detail]="stock() === null ? 'Stock à renseigner.' : objective() === null ? 'Objectif de stock non défini.' : 'Estimation après la période : ' + signed(stockAfter()) + '.'"
        />
      }
      <p class="bpm-help">L’objectif de stock se règle à l’étape Patrimoine de <a routerLink="/creer">Partir de zéro</a>.</p>
    </section>
  `,
})
export class BpmVisionObjectives {
  private readonly bpm = inject(BpmApi);
  private readonly refresh = inject(BpmRefresh);

  readonly profile = input.required<Loader<SetupProfile>>();
  readonly directives = input.required<Loader<BpmDirectives>>();
  readonly summary = input.required<Loader<BpmSummary>>();
  /** Apport par période de la projection, déjà rédigé par la page. */
  readonly contribution = input.required<string>();
  readonly saved = output<string>();

  protected vision = computed<Vision | null>(() => this.profile().data()?.principal.vision ?? null);
  protected surplus = computed(() => this.directives().data()?.surplus ?? null);
  protected signed = (v: number | null) => (v === null ? 'Inconnu' : signedCents(v));

  // ---------- cap patrimonial ----------
  private fig(key: string) {
    return this.summary().data()?.figures[key] ?? null;
  }
  protected objective = computed(() => this.profile().data()?.principal.patrimoine.objectiveCents ?? null);
  protected stock = computed(() => this.fig('bpm.patrimoineConstitue')?.valueCents ?? null);
  protected stockReason = computed(() => this.fig('bpm.patrimoineConstitue')?.unavailableReason ?? null);
  protected stockAfter = computed(() => this.fig('bpm.patrimoineFinPeriode')?.valueCents ?? null);
  /** Écart signé objectif − stock enregistré : positif = manque, négatif = dépassement. */
  protected capGap = computed(() => (this.objective() === null || this.stock() === null ? null : this.objective()! - this.stock()!));
  protected capGapAbs = computed(() => Math.abs(this.capGap() ?? 0));
  protected capReason = computed(() => (this.objective() === null ? 'Objectif de stock non défini.' : this.stock() === null ? 'Stock à renseigner.' : null));
  protected wealthPercent = computed(() => {
    const s = this.stock();
    const o = this.objective();
    return s === null || !o ? null : Math.round((s / o) * 1000) / 10;
  });

  // ---------- formulaire de l'objectif d'excédent ----------
  protected surplusOpen = signal(false);
  protected surplusBusy = signal(false);
  protected surplusError = signal<ApiError | null>(null);
  private surplusLocal = signal<{ field: string; message: string } | null>(null);
  protected surplusDirty = false;
  protected sTarget = signal('');
  protected sPeriods = signal('');
  protected sStart = signal('');

  constructor() {
    // Brouillon initialisé depuis la version enregistrée, sans écraser une saisie en cours.
    effect(() => {
      const v = this.vision();
      const period = this.summary().data()?.context.period?.key ?? '';
      if (!v || this.surplusDirty) return;
      untracked(() => {
        this.sTarget.set(v.surplus ? euroText(v.surplus.targetCents) : '');
        this.sPeriods.set(v.surplus ? String(v.surplus.periods) : '');
        this.sStart.set(v.surplus?.startKey ?? period);
      });
    });
  }

  protected surplusErr(field: string) {
    const l = this.surplusLocal();
    if (l && l.field === field) return l.message;
    const e = this.surplusError();
    return e && e.body.details?.['field'] === field ? e.message : null;
  }

  protected saveSurplus() {
    this.surplusLocal.set(null);
    const target = parseAmount(this.sTarget());
    const periods = num(this.sPeriods());
    const bad = (field: string, message: string) => this.surplusLocal.set({ field, message });
    if (typeof target !== 'number' || target <= 0) return bad('surplus.target', 'Montant positif en euros attendu.');
    if (periods === null || !Number.isInteger(periods) || periods < 1 || periods > 600) return bad('surplus.periods', 'Nombre entier de périodes entre 1 et 600.');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(this.sStart())) return bad('surplus.startKey', 'Période de départ AAAA-MM attendue.');
    return this.writeSurplus({ target, periods, startKey: this.sStart() }, 'Objectif d’excédent enregistré ; le stock patrimonial n’est pas modifié.');
  }
  protected clearSurplus() {
    return this.writeSurplus(null, 'Objectif d’excédent retiré.');
  }
  private async writeSurplus(surplus: { target: number; periods: number; startKey: string } | null, ok: string) {
    const p = this.profile().data();
    if (!p) return;
    this.surplusDirty = true;
    this.surplusBusy.set(true);
    this.surplusError.set(null);
    try {
      await this.bpm.updateVision({ expectedRevision: p.principal.revision, surplus });
      this.surplusDirty = false;
      this.surplusOpen.set(false);
      this.saved.emit(ok);
      this.refresh.bump();
    } catch (e) {
      this.surplusError.set(toApiError(e));
    } finally {
      this.surplusBusy.set(false);
    }
  }
}
