import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BpmApi } from '../../core/bpm-api.service';
import { EntryInput, RegisterLine } from '../../core/bpm-models';
import { cents, CentsPipe, parseAmount, ShortDatePipe, signedCents, SignedCentsPipe } from '../../core/format';
import { MetricTile, MetricTilesComponent } from '../../shared/metric-tiles.component';
import { BpmOperationEditor, BpmPageContext, BpmPageFrame, BpmState, bpmLoader } from '../ui';
import { BpmSetupNeeded, setupProblem } from './dashboard-parts';

/**
 * Détail du solde (/argent/reste), sur la page dédiée source `bpm-money-detail` : chiffres clés
 * (reçu, payé, net réalisé, solde prévu à la clôture), décomposition des montants, effet patrimonial
 * et vérification avec le compte. Le rapprochement (soldes saisis gardés dans l'URL) calcule l'écart
 * et propose une saisie relue, jamais une création automatique.
 */
@Component({
  selector: 'bpm-page-balance',
  providers: [BpmPageContext],
  imports: [FormsModule, RouterLink, BpmPageFrame, BpmState, BpmOperationEditor, BpmSetupNeeded, MetricTilesComponent, CentsPipe, SignedCentsPipe, ShortDatePipe],
  styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-money.scss', '../ref-styles/bpm-money-detail.page.scss', './bpm-money-page.scss'],
  template: `
    <bpm-page
      kicker="Tableau de bord"
      title="Solde de la période"
      pageClass="bpm-money bpm-money-detail"
      lead="Le solde rejoint le patrimoine."
      [context]="b()?.context"
      [periodKey]="period()"
      [periodNav]="true"
      (periodChange)="ctx.setQuery({ period: $event })"
    >
      <a actions class="app-hero-action" routerLink="/tableau-de-bord" [queryParams]="carry()">← Retour au tableau de bord</a>
      <button actions type="button" class="app-hero-action is-secondary" (click)="openCreate()" [disabled]="!budgets().length">＋ Ajouter une entrée ou une charge</button>
      <a actions class="bpm-link" routerLink="/depenses" [queryParams]="carry()">Dépenses de la période →</a>

      <div class="bpm-money bpm-money-body bpm-money-detail" data-tone="budget">
        @if (problem(); as p) {
          <bpm-setup-needed [kind]="p" [message]="loader.error()?.message ?? ''" />
        } @else if (!b()) {
          <bpm-state [loading]="loader.loading()" [error]="loader.error()" [lines]="4" (retry)="loader.reload()" />
        } @else {
          @let v = b()!;
          <section data-bpm-frame="metrics" aria-label="Chiffres de la ligne">
            <rjs-metric-tiles variant="instrument" label="Chiffres de la ligne" [tiles]="tiles()" />
          </section>

          @if (notice()) {
            <p class="bmd-message" role="status">{{ notice() }}</p>
          }

          @if (loader.error(); as e) {
            <p class="bmd-message" data-state="danger" role="alert">{{ e.message }} Les chiffres affichés sont ceux de la dernière lecture réussie.</p>
          }
          @if (!v.context.period) {
            <p class="bmd-note-banner" role="note">Cycle à configurer : le solde de période est inconnu. <a routerLink="/creer">Configurer le cycle</a></p>
          } @else if (v.closed) {
            <p class="bmd-note-banner">Période clôturée : les montants ne changent plus. Chiffres enregistrés à la clôture, non recalculés.</p>
          } @else if (v.closingDate) {
            <p class="bmd-note-banner">Clôture prévue le {{ v.closingDate | shortDate }} : le réalisé suit la date de règlement, le restant la date prévue.</p>
          }

          <section class="bm-statement" aria-labelledby="bmd-rest-title" data-ui-pattern="panel">
            <h2 id="bmd-rest-title">Le calcul du reste</h2>
            <table class="bmd-rest">
              <caption class="visually-hidden">Du reçu au solde prévu à la clôture</caption>
              <tbody>
                <tr><th scope="row"><span aria-hidden="true">+</span> Entrées reçues (date de règlement dans la période)</th><td><a routerLink="/argent/entrees" [queryParams]="carry()">{{ plus(v.receivedCents) }}</a></td></tr>
                <tr><th scope="row"><span aria-hidden="true">−</span> Sorties payées (date de règlement dans la période)</th><td><a routerLink="/depenses" [queryParams]="carry()">{{ minus(v.paidCents) }}</a></td></tr>
                <tr class="is-total"><th scope="row"><span aria-hidden="true">=</span> Reste de la période (net réalisé)</th><td>{{ v.netCents === null ? 'Inconnu' : (v.netCents | signedCents) }}</td></tr>
                <tr><th scope="row"><span aria-hidden="true">+</span> Encore à recevoir (échéances non réglées)</th><td>{{ plus(v.toReceiveCents) }}</td></tr>
                <tr><th scope="row"><span aria-hidden="true">−</span> Encore à payer (échéances non réglées)</th><td>{{ minus(v.toPayCents) }}</td></tr>
                <tr class="is-total"><th scope="row"><span aria-hidden="true">=</span> Solde prévu à la clôture</th><td>{{ v.expectedCents === null ? 'Inconnu' : (v.expectedCents | signedCents) }}</td></tr>
              </tbody>
            </table>
            @if (check() !== null && check() !== v.expectedCents) {
              <p class="bmd-message" data-state="warning">La somme des lignes ({{ check() | signedCents }}) diffère du solde prévu lu ({{ v.expectedCents | signedCents }}) : les deux valeurs sont affichées sans correction.</p>
            }
            <p class="bpm-help">Une échéance déjà réglée compte dans le réalisé et ne reste pas une seconde fois dans le restant. Les montants « à recevoir / à payer » suivent la date prévue ; le réalisé suit la date réelle.</p>
            @if (v.initialBudgetCents !== null) {
              <p class="bpm-help">Référence distincte — budget initial de la période : <strong>{{ v.initialBudgetCents | signedCents }}</strong> (ne remplace pas le solde prévu).</p>
            }
            <details class="bm-calculation">
              <summary>Comprendre le calcul du reste</summary>
              <ul class="bmd-rest-lines">
                @for (k of formulaKeys; track k) {
                  @if (v.figures[k]; as f) {
                    <li><span><strong>{{ f.label }}</strong>@if (f.recorded) { <span class="chip recorded">enregistré</span> }</span><code>{{ f.formula }}</code></li>
                  }
                }
              </ul>
            </details>
          </section>

          <section class="bm-statement" aria-labelledby="bmd-wealth-title" data-ui-pattern="panel">
            <h2 id="bmd-wealth-title">Comment le reste rejoint le patrimoine</h2>
            <ul class="bmd-rest-lines">
              <li><span>Stock enregistré (avant la période)</span><span>{{ v.patrimoine.stockCents === null ? 'À renseigner' : (v.patrimoine.stockCents | signedCents) }}</span></li>
              <li><span>Effet signé de la période</span><span [class.pos]="(v.patrimoine.effectCents ?? 0) > 0" [class.neg]="(v.patrimoine.effectCents ?? 0) < 0">{{ v.patrimoine.effectCents === null ? 'Inconnu' : (v.patrimoine.effectCents | signedCents) }}</span></li>
              <li><span>{{ v.closed ? 'Après clôture (enregistré)' : 'Estimation après période' }}</span><span>{{ v.patrimoine.afterCents === null ? (v.patrimoine.stockCents === null ? 'À renseigner' : 'Inconnu') : (v.patrimoine.afterCents | signedCents) }}</span></li>
              <li><span>Date de clôture</span><span>{{ v.closingDate ? (v.closingDate | shortDate) : 'Inconnue' }}</span></li>
            </ul>
            @if (v.patrimoine.stockCents === null) {
              <p class="bmd-message" data-state="warning">Stock initial à renseigner : <a routerLink="/creer">compléter le Patrimoine</a>. Aucune estimation n'est calculée à partir d'un faux zéro.</p>
            }
            <p class="bpm-help">À la clôture, le résultat signé de la période est capitalisé une seule fois dans le Patrimoine, même s'il est nul ou négatif. <a routerLink="/tableau-de-bord" [queryParams]="carry()" fragment="bm-wealth">Patrimoine au tableau de bord →</a></p>
          </section>

          <section class="bm-statement" id="verifier" aria-labelledby="bmd-check-title" data-ui-pattern="panel">
            <h2 id="bmd-check-title">Vérifier avec mon compte</h2>
            <p class="bpm-help">Saisissez le solde du compte au début de la période et aujourd'hui. Variation = actuel − initial ; écart = variation − net réalisé. Rien n'est enregistré.</p>
            <form class="bmd-check" (ngSubmit)="reconcile()" novalidate>
              <div class="bmd-check-fields">
                <label class="bmd-field">
                  <span>Solde initial (€)</span>
                  <input name="initial" inputmode="decimal" class="num" [(ngModel)]="initial" [attr.aria-invalid]="recError() === 'initial' ? 'true' : null" />
                </label>
                <label class="bmd-field">
                  <span>Solde actuel (€)</span>
                  <input name="current" inputmode="decimal" class="num" [(ngModel)]="current" [attr.aria-invalid]="recError() === 'current' ? 'true' : null" />
                </label>
              </div>
              @if (recError()) {
                <p class="bmd-message" data-state="danger" role="alert">Montant attendu dans le champ {{ recError() === 'initial' ? 'Solde initial' : 'Solde actuel' }} (ex. 1 250,40 ou −80).</p>
              }
              <div class="bmd-actions">
                <button type="submit" class="bmd-primary">Calculer l'écart</button>
                @if (v.reconciliation) {
                  <button type="button" class="btn btn-secondary" (click)="clearReconciliation()">Effacer</button>
                }
              </div>
            </form>
            @if (v.reconciliation; as r) {
              <ul class="bmd-rest-lines">
                <li><span>Variation du compte</span><span>{{ r.variationCents | signedCents }}</span></li>
                <li><span>Net réalisé calculé</span><span>{{ r.netCents === null ? 'Inconnu' : (r.netCents | signedCents) }}</span></li>
                <li><span><strong>Écart</strong></span><strong [class.pos]="(r.gapCents ?? 0) > 0" [class.neg]="(r.gapCents ?? 0) < 0">{{ r.gapCents === null ? 'Non calculable' : (r.gapCents | signedCents) }}</strong></li>
              </ul>
              <p class="bpm-help"><code>{{ r.formula }}</code></p>
              <p class="bmd-message" [attr.data-state]="r.gapCents === 0 ? 'success' : 'warning'">{{ r.suggestion }}</p>
              @if (r.gapCents !== null && r.gapCents !== 0) {
                <div class="bmd-actions">
                  <button type="button" class="bmd-primary" (click)="fillGap(r.gapCents)">Saisir l'opération manquante…</button>
                </div>
                <p class="bpm-help">L'éditeur s'ouvre prérempli ({{ r.gapCents < 0 ? 'charge' : 'entrée' }} de {{ abs(r.gapCents) | cents }}) ; rien n'est créé tant que vous n'enregistrez pas.</p>
              }
            }
          </section>
        }
      </div>
    </bpm-page>

    @if (editorOpen() && budgets().length) {
      <bpm-operation-editor [budgets]="budgets()" [line]="editLine()" [defaults]="defaults()" (closed)="closeEditor()" (saved)="onSaved($event)" />
    }
  `,
  styles: `
    :host { display: block; }
    .bmd-rest td a { color: inherit; }
    .bmd-check { display: grid; gap: var(--ecart-12); }
    .bmd-rest-lines code { overflow-wrap: anywhere; }
  `,
})
export class BpmBalancePage {
  protected ctx = inject(BpmPageContext);
  private bpm = inject(BpmApi);

  protected period = this.ctx.period;
  private initialParam = this.ctx.q('initial');
  private currentParam = this.ctx.q('current');
  protected carry = computed(() => this.ctx.carry() as Record<string, string>);

  protected loader = bpmLoader(
    () => ({ period: this.period(), initial: this.initialParam() || undefined, current: this.currentParam() || undefined }),
    (k) => this.bpm.balance(k),
  );
  protected b = computed(() => this.loader.data());
  protected problem = computed(() => setupProblem(this.loader.error()));
  protected budgets = computed(() => this.b()?.context.budgets ?? []);
  protected readonly formulaKeys = ['bpm.revenus', 'bpm.charges', 'bpm.resultatPeriode', 'bpm.resteARecevoir', 'bpm.resteAPayer', 'bpm.soldeAttendu', 'bpm.resultatPrevu', 'bpm.patrimoineFinPeriode'];

  protected why = (key: string) => {
    const f = this.b()?.figures[key];
    return f && f.valueCents === null ? (f.unavailableReason ?? 'Non calculable') : null;
  };
  /** Tuiles source : inconnu reste « Inconnu » avec sa raison, jamais un zéro. */
  protected tiles = computed<MetricTile[]>(() => {
    const v = this.b();
    if (!v) return [];
    const query = this.carry();
    const money = (c: number | null) => (c === null ? 'Inconnu' : cents(c));
    const sgn = (c: number | null) => (c === null ? 'Inconnu' : signedCents(c));
    const rec = v.closed ? ' Chiffre enregistré à la clôture.' : '';
    const tone = (c: number | null) => (c === null ? null : c < 0 ? 'danger' : 'success');
    return [
      { id: 'in', label: 'Entrées reçues', value: money(v.receivedCents), tone: v.receivedCents === null ? null : 'success', note: (this.why('bpm.revenus') ?? 'Entrées réglées dans la période.') + rec, link: '/argent/entrees', query },
      { id: 'out', label: 'Sorties payées', value: money(v.paidCents), tone: v.paidCents === null ? null : 'danger', note: (this.why('bpm.charges') ?? 'Charges réglées dans la période.') + rec, link: '/depenses', query },
      { id: 'rest', label: 'Reste de la période', value: sgn(v.netCents), tone: tone(v.netCents), emphasis: true, note: (this.why('bpm.resultatPeriode') ?? 'Reçu − payé, à date de règlement.') + rec },
      {
        id: 'expected',
        label: 'Solde prévu à la clôture',
        value: sgn(v.expectedCents),
        tone: tone(v.expectedCents),
        details: [
          { label: 'À recevoir', value: money(v.toReceiveCents), tone: 'success' },
          { label: 'À payer', value: money(v.toPayCents), tone: 'warning' },
        ],
        note: this.why('bpm.soldeAttendu') ?? 'Net réalisé + à recevoir − à payer.',
      },
    ];
  });
  /** Contrôle de cohérence de la décomposition (affiché seulement en cas de différence). */
  protected check = computed(() => {
    const v = this.b();
    if (!v || v.netCents === null || v.toReceiveCents === null || v.toPayCents === null || v.expectedCents === null) return null;
    return v.netCents + v.toReceiveCents - v.toPayCents;
  });
  protected plus = (c: number | null) => (c === null ? 'Inconnu' : `+ ${cents(c)}`);
  protected minus = (c: number | null) => (c === null ? 'Inconnu' : `− ${cents(c)}`);
  protected abs = Math.abs;

  // ---------- rapprochement (saisie gardée dans l'URL, aucune écriture) ----------

  protected initial = linkedSignal(() => this.initialParam());
  protected current = linkedSignal(() => this.currentParam());
  protected recError = signal<'initial' | 'current' | null>(null);

  protected reconcile() {
    const i = parseAmount(this.initial());
    const c = parseAmount(this.current());
    if (typeof i !== 'number') return this.recError.set('initial');
    if (typeof c !== 'number') return this.recError.set('current');
    this.recError.set(null);
    this.ctx.setQuery({ initial: String(i), current: String(c) });
  }
  protected clearReconciliation() {
    this.recError.set(null);
    this.ctx.setQuery({ initial: null, current: null });
  }

  // ---------- éditeur partagé ----------

  protected editorOpen = signal(false);
  protected editLine = signal<RegisterLine | null>(null);
  protected defaults = signal<Partial<EntryInput>>({});
  protected notice = signal<string | null>(null);

  protected openCreate() {
    this.editLine.set(null);
    this.defaults.set({});
    this.editorOpen.set(true);
  }
  /** Préremplit l'éditeur à partir de l'écart, sans rien créer : l'utilisateur relit puis enregistre. */
  protected fillGap(gapCents: number) {
    this.editLine.set(null);
    this.defaults.set({ direction: gapCents < 0 ? 'charge' : 'income', amount: Math.abs(gapCents) / 100, label: gapCents < 0 ? 'Dépense manquante (rapprochement)' : 'Entrée manquante (rapprochement)', note: 'Saisie issue du rapprochement de compte.' });
    this.editorOpen.set(true);
  }
  protected closeEditor() {
    this.editorOpen.set(false);
    this.editLine.set(null);
  }
  protected onSaved(message: string) {
    this.closeEditor();
    this.notice.set(message + ' Le solde et l’écart éventuel sont relus.');
  }
}
