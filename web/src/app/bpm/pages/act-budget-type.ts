import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiError, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { Cadence, Direction, Recurrence } from '../../core/bpm-models';
import { cents, CentsPipe, parseAmount, ShortDatePipe, signedCents } from '../../core/format';
import { MetricTile, MetricTilesComponent } from '../../shared/metric-tiles.component';
import { bpmLoader, BpmRefresh, BpmState, newRequestKey } from '../ui';
import { localToday } from './act-due';

type RecCadence = Exclude<Cadence, 'once'>;
const CADENCE_LABEL: Record<RecCadence, string> = { weekly: 'Hebdomadaire', monthly: 'Mensuelle', yearly: 'Annuelle' };

interface RowDraft {
  id: string;
  direction: Direction;
  centerLabel: string | null;
  firstDate: string;
  label: string;
  amount: string;
  cadence: RecCadence;
  averageCents: number | null;
  orig: { label: string; amountCents: number; cadence: RecCadence };
  revision: number;
  error: string | null;
  /** Brouillon conservé après un échec : n'est pas écrasé par la relecture. */
  kept: boolean;
}
interface NewDraft {
  key: string;
  direction: Direction;
  label: string;
  amount: string;
  cadence: RecCadence;
  firstDate: string;
  center: string;
  error: string | null;
}

const euroText = (c: number) => String(c / 100).replace('.', ',');
const toCents = (raw: string) => {
  const a = parseAmount(raw);
  return typeof a === 'number' ? Math.round(a * 100) : null;
};

/**
 * Panneau « Budget type » du Budget du projet de vie : lignes récurrentes éditables (libellé, montant,
 * rythme) mises à jour sans recréation (révision attendue), ajout de nouvelles lignes, totaux moyens
 * enregistrés et plafonds facultatifs par centre. Rien n'est écrit avant « Enregistrer ».
 */
@Component({
  selector: 'bpm-act-budget-type',
  imports: [RouterLink, BpmState, MetricTilesComponent, CentsPipe, ShortDatePipe],
  styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-month-type.component.scss'],
  template: `
    <section class="bm-month" data-bpm-frame="form" id="budget-type" aria-labelledby="bm-month-title">
      <header class="bm-head">
        <div>
          <h2 id="bm-month-title">Budget type</h2>
          <p>Revenus et charges récurrents du Budget du projet de vie, totaux moyens et plafonds.</p>
          @if (bt.data(); as d) {
            <p class="bpm-help">{{ d.label }}. Totaux enregistrés : ils se mettent à jour après l'enregistrement.</p>
          }
        </div>
      </header>

      <bpm-state [loading]="bt.loading() && !bt.data()" [error]="bt.error()" (retry)="bt.reload()" />
      @if (bt.data(); as d) {
        <rjs-metric-tiles label="Totaux moyens du budget type" [tiles]="tiles()" />

        @if (message()) { <p class="bm-saved" role="status">{{ message() }}</p> }

        @if (!rows().length && !news().length) {
          <p class="bpm-missing">Aucune ligne récurrente active dans le Budget du projet de vie.</p>
        }

        <div class="bm-form">
          @for (dir of directions; track dir) {
            @if (rowsOf(dir).length || newsOf(dir).length) {
              <fieldset>
                <legend>{{ dir === 'income' ? 'Entrées' : 'Charges' }}</legend>
                <div class="bm-table" role="table" [attr.aria-label]="dir === 'income' ? 'Entrées récurrentes' : 'Charges récurrentes'">
                  <div class="bm-row bm-row-head" role="row" [class.bm-income]="dir === 'income'">
                    <span role="columnheader">Libellé</span>
                    <span role="columnheader">Première date</span>
                    <span role="columnheader">Montant par occurrence (€)</span>
                    <span role="columnheader">Rythme</span>
                    <span role="columnheader">Centre</span>
                  </div>
                  @for (r of rowsOf(dir); track r.id) {
                    <div class="bm-row" role="row" [class.bm-income]="dir === 'income'" [class.is-dirty]="isDirty(r)">
                      <div role="cell"><input [value]="r.label" (input)="patch(r.id, { label: $any($event.target).value })" [attr.aria-label]="'Libellé de ' + r.orig.label" maxlength="200" /></div>
                      <div role="cell" class="bm-fixed">{{ r.firstDate | shortDate }}</div>
                      <div role="cell"><input class="num" inputmode="decimal" [value]="r.amount" (input)="patch(r.id, { amount: $any($event.target).value })" [attr.aria-label]="'Montant de ' + r.orig.label" /></div>
                      <div role="cell">
                        <select [value]="r.cadence" (change)="patch(r.id, { cadence: $any($event.target).value })" [attr.aria-label]="'Rythme de ' + r.orig.label">
                          @for (c of cadences; track c) { <option [value]="c" [selected]="c === r.cadence">{{ cadenceLabel[c] }}</option> }
                        </select>
                      </div>
                      <div role="cell" class="bm-fixed">{{ r.centerLabel ?? 'À préciser' }}</div>
                      <div role="cell" class="bm-row-note">
                        <span>Moyenne / mois : <strong class="num">{{ r.averageCents | cents }}</strong></span>
                        @if (r.error) {
                          <span class="bpm-error" role="alert">{{ r.error }}</span>
                          <button type="button" class="btn btn-secondary small" (click)="resetRow(r.id)">Reprendre la version enregistrée</button>
                        } @else if (isDirty(r)) {
                          <span class="chip warn">modifiée</span>
                        }
                      </div>
                    </div>
                  }
                  @for (n of newsOf(dir); track n.key) {
                    <div class="bm-row is-new" role="row" [class.bm-income]="dir === 'income'">
                      <div role="cell"><input [value]="n.label" (input)="patchNew(n.key, { label: $any($event.target).value })" placeholder="Nouvelle ligne" aria-label="Libellé de la nouvelle ligne" maxlength="200" /></div>
                      <div role="cell"><input type="date" [value]="n.firstDate" (change)="patchNew(n.key, { firstDate: $any($event.target).value })" aria-label="Première date de la nouvelle ligne" /></div>
                      <div role="cell"><input class="num" inputmode="decimal" [value]="n.amount" (input)="patchNew(n.key, { amount: $any($event.target).value })" aria-label="Montant de la nouvelle ligne" /></div>
                      <div role="cell">
                        <select [value]="n.cadence" (change)="patchNew(n.key, { cadence: $any($event.target).value })" aria-label="Rythme de la nouvelle ligne">
                          @for (c of cadences; track c) { <option [value]="c" [selected]="c === n.cadence">{{ cadenceLabel[c] }}</option> }
                        </select>
                      </div>
                      <div role="cell">
                        <select [value]="n.center" (change)="patchNew(n.key, { center: $any($event.target).value })" aria-label="Centre de la nouvelle ligne">
                          @for (c of centersOf(dir); track c.ref) { <option [value]="c.ref" [selected]="c.ref === n.center">{{ c.label }}</option> }
                        </select>
                      </div>
                      <div role="cell" class="bm-row-note">
                        <span>Moyenne / mois : après enregistrement</span>
                        @if (n.error) { <span class="bpm-error" role="alert">{{ n.error }}</span> }
                        <button type="button" class="btn btn-secondary small" (click)="dropNew(n.key)" aria-label="Retirer cette nouvelle ligne du brouillon">Retirer</button>
                      </div>
                    </div>
                  }
                </div>
                <button type="button" class="bm-add" (click)="addLine(dir)">+ {{ dir === 'income' ? 'Entrée récurrente' : 'Charge récurrente' }}</button>
              </fieldset>
            }
          }

          <div class="bpm-actions">
            @for (dir of directions; track dir) {
              @if (!rowsOf(dir).length && !newsOf(dir).length) {
                <button type="button" class="bm-add" (click)="addLine(dir)">+ {{ dir === 'income' ? 'Entrée récurrente' : 'Charge récurrente' }}</button>
              }
            }
            <span class="spacer"></span>
            @if (pendingCount()) { <span class="bpm-help">{{ pendingCount() }} changement(s) non enregistré(s)</span> }
            <button type="button" class="btn btn-primary" (click)="saveAll()" [disabled]="busy() || !pendingCount()">{{ busy() ? 'Enregistrement…' : 'Enregistrer le budget type' }}</button>
          </div>
          <p class="bpm-help">Chaque ligne existante est mise à jour en gardant son identité (pas de recréation). La portée porte sur les occurrences encore attendues ; les règlements déjà enregistrés ne changent pas. Le rythme et la première date sont figés dès qu'une occurrence est réglée. Pour une fin, une note ou un centre, ouvrez la ligne depuis le registre.</p>
        </div>

        <details class="bpm-limited">
          <summary>Plafonds par centre (facultatifs, par période)</summary>
          <div class="bm-form">
            @if (capsError(); as e) { <p class="bpm-error" role="alert">{{ e.message }} Saisie conservée.</p> }
            @if (capsMessage()) { <p class="bm-saved" role="status">{{ capsMessage() }}</p> }
            <fieldset>
              <legend>Plafond par période</legend>
              <div class="caps-grid">
                @for (c of centersOf('charge'); track c.ref) {
                  <label class="bm-start">
                    {{ c.label }}{{ c.standard ? '' : ' (personnel)' }}
                    <input class="num" inputmode="decimal" [value]="capDraft()[c.ref] ?? ''" (input)="setCap(c.ref, $any($event.target).value)" placeholder="Sans plafond" />
                  </label>
                }
              </div>
            </fieldset>
            <p class="bpm-help">Un champ vide retire le plafond. Les plafonds s'appliquent au Budget du projet de vie ; la marge = plafond − payé − restant prévu. Un dépassement est signalé en rouge, jamais bloquant.</p>
            <p class="bpm-help">Plafonds plus fins, par catégorie de dépense rangée dans un centre : <a routerLink="/plafonds">Plafonds &amp; catégories →</a></p>
            <div class="bpm-actions">
              <button type="button" class="btn btn-secondary" (click)="saveCaps()" [disabled]="capsBusy() || !capsDirty()">{{ capsBusy() ? 'Enregistrement…' : 'Enregistrer les plafonds' }}</button>
            </div>
          </div>
        </details>
      }
    </section>
  `,
  styles: `
    .bm-row-note { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: var(--ecart-8); color: var(--muted); font-size: var(--fs-sm); }
    .bm-row-note .bpm-error { flex: 1 1 100%; }
    .bm-row.is-dirty { padding: var(--ecart-6); border-radius: var(--rayon-8); background: var(--app-accent-soft); }
    .bm-row.is-new { padding: var(--ecart-6); border-radius: var(--rayon-8); background: var(--soft); }
    .bm-row select, .bm-row input { width: 100%; }
    .bm-fixed { color: var(--ink); overflow-wrap: anywhere; }
    .bpm-actions { align-items: center; }
    .spacer { flex: 1 1 auto; }
    .caps-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12.5rem), 1fr)); gap: var(--ecart-12); }
    .caps-grid .bm-start { max-width: none; }
    .caps-grid input { min-height: 2.75rem; }
  `,
})
export class BpmActBudgetType {
  private bpm = inject(BpmApi);
  private refresh = inject(BpmRefresh);

  protected readonly directions: Direction[] = ['income', 'charge'];
  protected readonly cadences: RecCadence[] = ['weekly', 'monthly', 'yearly'];
  protected readonly cadenceLabel = CADENCE_LABEL;

  protected bt = bpmLoader(() => 0, () => this.bpm.budgetType());
  private centersRead = bpmLoader(() => 0, () => this.bpm.costCenters());
  private life = computed(() => this.bt.data()?.context.budgets.find((b) => b.role === 'life') ?? null);

  /** Totaux moyens enregistrés du budget type, en tuiles de chiffres clés. */
  protected tiles = computed<MetricTile[]>(() => {
    const d = this.bt.data();
    if (!d) return [];
    return [
      { id: 'income', label: 'Entrées moyennes / mois', value: cents(d.averageIncomeCents), symbol: 'income', tone: 'success' },
      { id: 'charge', label: 'Charges moyennes / mois', value: cents(d.averageChargeCents), symbol: 'expense', tone: 'danger' },
      { id: 'net', label: 'Solde type / mois', value: signedCents(d.averageNetCents), symbol: 'balance', note: 'Épargne naturelle moyenne', emphasis: true, tone: d.averageNetCents < 0 ? 'danger' : d.averageNetCents > 0 ? 'success' : null },
    ];
  });

  protected rows = signal<RowDraft[]>([]);
  protected news = signal<NewDraft[]>([]);
  protected busy = signal(false);
  protected message = signal<string | null>(null);

  constructor() {
    // Relecture : les lignes enregistrées remplacent les brouillons, sauf ceux conservés après un échec.
    effect(() => {
      const lines = this.bt.data()?.lines ?? [];
      untracked(() => {
        const kept = new Map(this.rows().filter((r) => r.kept).map((r) => [r.id, r] as const));
        this.rows.set(lines.map((l) => kept.get(l.id) ?? this.fromLine(l)));
      });
    });
    effect(() => {
      const caps = this.life()?.capsCents ?? {};
      untracked(() => {
        if (this.capsDirty()) return;
        this.capDraft.set(Object.fromEntries(Object.entries(caps).map(([k, v]) => [k, euroText(v)])));
        this.capsBase.set({ ...this.capDraft() });
      });
    });
  }

  private fromLine(l: Recurrence): RowDraft {
    return {
      id: l.id,
      direction: l.direction,
      centerLabel: l.costCenterLabel,
      firstDate: l.firstDate,
      label: l.label,
      amount: euroText(l.amountCents),
      cadence: l.cadence,
      averageCents: l.monthlyAverageCents ?? null,
      orig: { label: l.label, amountCents: l.amountCents, cadence: l.cadence },
      revision: l.revision,
      error: null,
      kept: false,
    };
  }

  protected rowsOf = (d: Direction) => this.rows().filter((r) => r.direction === d);
  protected newsOf = (d: Direction) => this.news().filter((n) => n.direction === d);
  protected centersOf = (d: Direction) => (this.centersRead.data() ?? []).filter((c) => c.direction === d);

  protected isDirty(r: RowDraft) {
    return r.label.trim() !== r.orig.label || toCents(r.amount) !== r.orig.amountCents || r.cadence !== r.orig.cadence;
  }
  protected pendingCount = computed(() => this.rows().filter((r) => this.isDirty(r)).length + this.news().length);

  protected patch(id: string, p: Partial<RowDraft>) {
    this.rows.update((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }
  protected resetRow(id: string) {
    const l = this.bt.data()?.lines.find((x) => x.id === id);
    if (l) this.rows.update((rs) => rs.map((r) => (r.id === id ? this.fromLine(l) : r)));
  }
  protected patchNew(key: string, p: Partial<NewDraft>) {
    this.news.update((ns) => ns.map((n) => (n.key === key ? { ...n, ...p } : n)));
  }
  protected dropNew(key: string) {
    this.news.update((ns) => ns.filter((n) => n.key !== key));
  }
  protected addLine(direction: Direction) {
    this.news.update((ns) => [...ns, { key: newRequestKey('budget-type'), direction, label: '', amount: '', cadence: 'monthly', firstDate: localToday(), center: this.centersOf(direction)[0]?.ref ?? '', error: null }]);
  }

  /** Enregistre les lignes modifiées (mise à jour) puis les nouvelles (création rejouable). */
  async saveAll() {
    if (this.busy()) return;
    this.busy.set(true);
    this.message.set(null);
    let updated = 0;
    let created = 0;
    let failed = 0;
    for (const r of this.rows().filter((x) => this.isDirty(x))) {
      const amountCents = toCents(r.amount);
      if (amountCents === null || amountCents <= 0) {
        this.patch(r.id, { error: 'Montant positif attendu (ex. 120,50).', kept: true });
        failed++;
        continue;
      }
      const body: Record<string, unknown> & { expectedRevision: number } = { expectedRevision: r.revision };
      if (r.label.trim() !== r.orig.label) body['label'] = r.label.trim();
      if (amountCents !== r.orig.amountCents) body['amount'] = amountCents / 100;
      if (r.cadence !== r.orig.cadence) body['cadence'] = r.cadence;
      try {
        await this.bpm.updateRecurrence(r.id, body);
        this.patch(r.id, { error: null, kept: false });
        updated++;
      } catch (e) {
        const err = toApiError(e);
        this.patch(r.id, { error: err.isConflict ? 'Modifiée ailleurs entre-temps : reprenez la version enregistrée.' : err.message, kept: true });
        failed++;
      }
    }
    const budgetId = this.life()?.id;
    for (const n of this.news()) {
      const amount = parseAmount(n.amount);
      if (!n.label.trim() || typeof amount !== 'number' || amount <= 0 || !n.firstDate || !n.center) {
        this.patchNew(n.key, { error: 'Libellé, montant positif, première date et centre requis.' });
        failed++;
        continue;
      }
      try {
        await this.bpm.createEntry({ requestKey: n.key, budgetId, direction: n.direction, label: n.label.trim(), amount, costCenterRef: n.center, cadence: n.cadence, firstDate: n.firstDate, endDate: null, status: 'planned' });
        this.dropNew(n.key);
        created++;
      } catch (e) {
        this.patchNew(n.key, { error: toApiError(e).message });
        failed++;
      }
    }
    this.busy.set(false);
    if (updated || created) this.refresh.bump();
    this.message.set(
      [updated ? `${updated} ligne(s) mise(s) à jour` : '', created ? `${created} ligne(s) ajoutée(s)` : '', failed ? `${failed} non enregistrée(s) : brouillon conservé` : ''].filter(Boolean).join(' · ') || null,
    );
  }

  // ---------- plafonds ----------

  protected capDraft = signal<Record<string, string>>({});
  private capsBase = signal<Record<string, string>>({});
  protected capsBusy = signal(false);
  protected capsError = signal<ApiError | null>(null);
  protected capsMessage = signal<string | null>(null);
  protected capsDirty = computed(() => {
    const d = this.capDraft();
    const base = this.capsBase();
    const keys = new Set([...Object.keys(d), ...Object.keys(base)]);
    return [...keys].some((k) => (d[k] ?? '').trim() !== (base[k] ?? '').trim());
  });
  protected setCap(ref: string, v: string) {
    this.capDraft.update((d) => ({ ...d, [ref]: v }));
  }

  async saveCaps() {
    const life = this.life();
    if (!life || this.capsBusy()) return;
    const caps: Record<string, number | null> = {};
    for (const c of this.centersOf('charge')) {
      const raw = (this.capDraft()[c.ref] ?? '').trim();
      if (!raw) {
        caps[c.ref] = null;
        continue;
      }
      const a = parseAmount(raw);
      if (typeof a !== 'number' || a <= 0) {
        this.capsError.set(new ApiError(400, { code: 'VALIDATION', action: null, message: `Plafond « ${c.label} » : montant positif attendu.` }));
        return;
      }
      caps[c.ref] = a;
    }
    this.capsBusy.set(true);
    this.capsError.set(null);
    this.capsMessage.set(null);
    try {
      await this.bpm.setCaps({ expectedRevision: life.revision, caps });
      this.capsBase.set({ ...this.capDraft() });
      this.capsMessage.set(`Plafonds enregistrés (${Object.values(caps).filter((v) => v !== null).length} centre(s) plafonné(s)).`);
      this.refresh.bump();
    } catch (e) {
      this.capsError.set(toApiError(e));
    } finally {
      this.capsBusy.set(false);
    }
  }

  protected readonly fmt = cents;
}
