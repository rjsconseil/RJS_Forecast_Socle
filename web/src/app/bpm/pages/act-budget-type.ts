import { BpmAmount } from '../ui/amount';
import { Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { toApiError } from '../../core/api.service';
import { BpmApi } from '../data/bpm-api.service';
import { Cadence, Direction, Recurrence } from '../data/bpm-models';
import { cents, CentsPipe, parseAmount, ShortDatePipe, signedCents } from '../../core/format';
import { MetricTile, MetricTilesComponent } from '../../shared/metric-tiles.component';
import { bpmLoader, BpmRefresh, BpmState, newRequestKey } from '../ui';
import { BpmDrafts } from '../ui/drafts';
import { localToday, shiftDate } from '../../calendar/calendar-dates';

type RecCadence = Exclude<Cadence, 'once'>;
const CADENCE_LABEL: Record<RecCadence, string> = { weekly: 'Hebdomadaire', monthly: 'Mensuelle', yearly: 'Annuelle' };

interface RowDraft {
  id: string;
  direction: Direction;
  centerLabel: string | null;
  firstDate: string;
  /** Dernière échéance prévue : posée par une suppression, la ligne quitte le budget au cycle suivant. */
  endDate: string | null;
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
 * Panneau « Budget type » du Budget du projet de vie. À l'arrivée, le budget récurrent est figé : une lecture
 * par groupe (entrées, charges). « Modifier » ouvre l'édition : libellé, montant et rythme des lignes (mis à jour
 * sans recréation, révision attendue), ajout et suppression de lignes. Chaque ligne s'enregistre seule
 * (« Enregistrer » sur la ligne) ou toutes ensemble (« Enregistrer tout », en bas). Rien n'est écrit avant.
 */
@Component({
  selector: 'bpm-act-budget-type',
  imports: [BpmAmount, BpmState, MetricTilesComponent, CentsPipe, ShortDatePipe],
  styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-month-type.component.scss'],
  template: `
    <section class="bm-month" data-bpm-frame="form" id="budget-type" aria-labelledby="bm-month-title">
      <header class="bm-head">
        <div>
          <h2 id="bm-month-title">Budget type</h2>
          <p>Revenus et charges récurrents du budget du projet de vie, avec leurs totaux moyens.</p>
          @if (bt.data(); as d) {
            <p class="bpm-help">{{ d.label }}. Totaux enregistrés : ils se mettent à jour après l'enregistrement.</p>
          }
        </div>
        @if (bt.data()) {
          <div class="bt-mode">
            @if (!editing()) {
              <button type="button" class="btn btn-secondary bt-edit" (click)="startEditing()">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg>Modifier
              </button>
            } @else {
              <span class="bt-mode-chip" role="status">Mode modification</span>
              <button type="button" class="btn btn-secondary" (click)="stopEditing()" [disabled]="busy()">{{ pendingCount() ? 'Annuler les modifications' : 'Terminer' }}</button>
            }
          </div>
        }
      </header>

      <bpm-state [loading]="bt.loading() && !bt.data()" [error]="bt.error()" (retry)="bt.reload()" />
      @if (bt.data(); as d) {
        <rjs-metric-tiles label="Totaux moyens du budget type" [tiles]="tiles()" />

        @if (message()) { <p class="bm-saved" role="status">{{ message() }}</p> }

        @if (editing() && !rows().length && !news().length) {
          <p class="bpm-missing">Aucune ligne récurrente active dans le Budget du projet de vie.</p>
        }

        @if (!editing()) {
          <!-- Lecture figée : les lignes telles qu'enregistrées, sans champ à saisir. -->
          <div class="bt-read">
            @for (dir of directions; track dir) {
              <section class="bt-group" [class.bm-income]="dir === 'income'" [attr.aria-labelledby]="'bt-' + dir">
                <h3 [id]="'bt-' + dir">{{ dir === 'income' ? 'Entrées' : 'Charges' }}<span>{{ rowsOf(dir).length }} ligne{{ rowsOf(dir).length > 1 ? 's' : '' }}</span></h3>
                @if (rowsOf(dir).length) {
                  <table class="bt-table">
                    <thead>
                      <tr><th scope="col">Libellé</th><th scope="col">Rythme</th><th scope="col" class="num">Montant</th><th scope="col" class="num">Moyenne / mois</th><th scope="col">Poste</th><th scope="col">Depuis le</th></tr>
                    </thead>
                    <tbody>
                      @for (r of rowsOf(dir); track r.id) {
                        <tr [class.is-leaving]="isLeaving(r)">
                          <th scope="row">{{ r.orig.label }}@if (isLeaving(r)) { <span class="chip warn">Retirée</span> }</th>
                          <td>{{ cadenceLabel[r.orig.cadence] }}</td>
                          <td class="num">{{ r.orig.amountCents | cents }}</td>
                          <td class="num"><strong [bpmAmount]="r.averageCents" [bpmFlow]="r.direction">{{ r.averageCents | cents }}</strong></td>
                          <td>{{ r.centerLabel ?? 'À préciser' }}</td>
                          <td>{{ r.firstDate | shortDate }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                } @else {
                  <p class="bt-empty">Aucune {{ dir === 'income' ? 'entrée' : 'charge' }} récurrente. « Modifier » pour en ajouter.</p>
                }
              </section>
            }
          </div>
        } @else {
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
                    <span role="columnheader" class="bm-sr">Supprimer</span>
                  </div>
                  @for (r of rowsOf(dir); track r.id) {
                    <div class="bm-row" role="row" [class.bm-income]="dir === 'income'" [class.is-dirty]="isDirty(r)">
                      <div role="cell" data-field="Libellé"><input [value]="r.label" (input)="patch(r.id, { label: $any($event.target).value })" [attr.aria-label]="'Libellé de ' + r.orig.label" maxlength="200" /></div>
                      <div role="cell" class="bm-fixed" data-field="Première date">{{ r.firstDate | shortDate }}</div>
                      <div role="cell" data-field="Montant par occurrence (€)"><input class="num" inputmode="decimal" [value]="r.amount" (input)="patch(r.id, { amount: $any($event.target).value })" [attr.aria-label]="'Montant de ' + r.orig.label" /></div>
                      <div role="cell" data-field="Rythme">
                        <select [value]="r.cadence" (change)="patch(r.id, { cadence: $any($event.target).value })" [attr.aria-label]="'Rythme de ' + r.orig.label">
                          @for (c of cadences; track c) { <option [value]="c" [selected]="c === r.cadence">{{ cadenceLabel[c] }}</option> }
                        </select>
                      </div>
                      <div role="cell" class="bm-fixed" data-field="Centre">{{ r.centerLabel ?? 'À préciser' }}</div>
                      <div role="cell" class="bm-row-del">
                        @if (!isLeaving(r)) {
                          <button type="button" class="bm-del" (click)="askRemove(r.id)" [disabled]="busy() || removing() === r.id" [attr.aria-pressed]="confirmRemove() === r.id" [attr.aria-label]="'Supprimer la ligne ' + r.orig.label" title="Supprimer la ligne">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" /></svg>
                          </button>
                        }
                      </div>
                      <div role="cell" class="bm-row-note">
                        <span>Moyenne / mois : <strong class="num" [bpmAmount]="r.averageCents" [bpmFlow]="r.direction">{{ r.averageCents | cents }}</strong></span>
                        @if (isLeaving(r)) {
                          <span class="chip warn">Retirée · dernière échéance le {{ r.endDate! | shortDate }}</span>
                          <button type="button" class="btn btn-secondary small" (click)="keepLine(r)" [disabled]="busy() || removing() === r.id">Annuler la suppression</button>
                        }
                        @if (confirmRemove() === r.id) {
                          <span class="bm-confirm" role="status">{{ removalNotice(r) }}</span>
                          <button type="button" class="btn btn-danger small" (click)="removeLine(r)" [disabled]="removing() === r.id">{{ removing() === r.id ? 'Suppression…' : 'Confirmer la suppression' }}</button>
                          <button type="button" class="btn btn-secondary small" (click)="confirmRemove.set(null)" [disabled]="removing() === r.id">Garder la ligne</button>
                        }
                        @if (r.error) {
                          <span class="bpm-error" role="alert">{{ r.error }}</span>
                          <button type="button" class="btn btn-secondary small" (click)="resetRow(r.id)">Reprendre la version enregistrée</button>
                        } @else if (isDirty(r)) {
                          <span class="chip warn">modifiée</span>
                        }
                        @if (isDirty(r)) {
                          <span class="bt-row-actions">
                            <button type="button" class="btn btn-secondary small" (click)="resetRow(r.id)" [disabled]="busy() || savingRow() === r.id">Annuler</button>
                            <button type="button" class="btn btn-primary small" (click)="saveRow(r)" [disabled]="busy() || savingRow() === r.id" [attr.aria-label]="'Enregistrer la ligne ' + r.orig.label">{{ savingRow() === r.id ? 'Enregistrement…' : 'Enregistrer' }}</button>
                          </span>
                        }
                      </div>
                    </div>
                  }
                  @for (n of newsOf(dir); track n.key) {
                    <div class="bm-row is-new" role="row" [class.bm-income]="dir === 'income'">
                      <div role="cell" data-field="Libellé"><input [value]="n.label" (input)="patchNew(n.key, { label: $any($event.target).value })" placeholder="Nouvelle ligne" aria-label="Libellé de la nouvelle ligne" maxlength="200" /></div>
                      <div role="cell" data-field="Première date"><input type="date" [value]="n.firstDate" (change)="patchNew(n.key, { firstDate: $any($event.target).value })" aria-label="Première date de la nouvelle ligne" /></div>
                      <div role="cell" data-field="Montant par occurrence (€)"><input class="num" inputmode="decimal" [value]="n.amount" (input)="patchNew(n.key, { amount: $any($event.target).value })" aria-label="Montant de la nouvelle ligne" /></div>
                      <div role="cell" data-field="Rythme">
                        <select [value]="n.cadence" (change)="patchNew(n.key, { cadence: $any($event.target).value })" aria-label="Rythme de la nouvelle ligne">
                          @for (c of cadences; track c) { <option [value]="c" [selected]="c === n.cadence">{{ cadenceLabel[c] }}</option> }
                        </select>
                      </div>
                      <div role="cell" data-field="Centre">
                        <select [value]="n.center" (change)="patchNew(n.key, { center: $any($event.target).value })" aria-label="Centre de la nouvelle ligne">
                          @for (c of centersOf(dir); track c.ref) { <option [value]="c.ref" [selected]="c.ref === n.center">{{ c.label }}</option> }
                        </select>
                      </div>
                      <div role="cell" class="bm-row-del">
                        <button type="button" class="bm-del" (click)="dropNew(n.key)" aria-label="Retirer cette nouvelle ligne du brouillon" title="Retirer la ligne du brouillon">
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" /></svg>
                        </button>
                      </div>
                      <div role="cell" class="bm-row-note">
                        <span>Moyenne / mois : après enregistrement</span>
                        @if (n.error) { <span class="bpm-error" role="alert">{{ n.error }}</span> }
                        <span class="bt-row-actions">
                          <button type="button" class="btn btn-primary small" (click)="saveNewLine(n)" [disabled]="busy() || savingRow() === n.key" aria-label="Enregistrer la nouvelle ligne">{{ savingRow() === n.key ? 'Enregistrement…' : 'Enregistrer' }}</button>
                        </span>
                      </div>
                    </div>
                  }
                </div>
                <button type="button" class="bm-add" (click)="addLine(dir)">＋ {{ dir === 'income' ? 'Entrée récurrente' : 'Dépense récurrente' }}</button>
              </fieldset>
            }
          }

          <div class="bpm-actions">
            @for (dir of directions; track dir) {
              @if (!rowsOf(dir).length && !newsOf(dir).length) {
                <button type="button" class="bm-add" (click)="addLine(dir)">＋ {{ dir === 'income' ? 'Entrée récurrente' : 'Dépense récurrente' }}</button>
              }
            }
            <span class="spacer"></span>
            @if (pendingCount()) { <span class="bpm-help">{{ pendingCount() }} changement(s) non enregistré(s)</span> }
            <button type="button" class="btn btn-primary" (click)="saveAll()" [disabled]="busy() || !pendingCount()">{{ busy() ? 'Enregistrement…' : 'Enregistrer tout' }}</button>
          </div>
          <p class="bpm-help">Chaque ligne s'enregistre seule (« Enregistrer » sur la ligne) ou avec les autres (« Enregistrer tout »), en gardant son identité (pas de recréation). La portée porte sur les occurrences encore attendues ; les règlements déjà enregistrés ne changent pas. Le rythme et la première date sont figés dès qu'une occurrence est réglée. Pour une fin, une note ou un centre, ouvrez la ligne depuis le registre.</p>
        </div>
        }

      }
    </section>
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
      { id: 'income', label: 'Entrées moyennes / mois', value: cents(d.averageIncomeCents), amountCents: d.averageIncomeCents, symbol: 'income', tone: 'success' },
      { id: 'charge', label: 'Charges moyennes / mois', value: cents(d.averageChargeCents), amountCents: d.averageChargeCents, symbol: 'expense', tone: 'danger' },
      { id: 'net', label: 'Solde type / mois', value: signedCents(d.averageNetCents), amountCents: d.averageNetCents, symbol: 'balance', note: 'Épargne naturelle moyenne', emphasis: true, tone: d.averageNetCents < 0 ? 'danger' : d.averageNetCents > 0 ? 'success' : null },
    ];
  });

  protected rows = signal<RowDraft[]>([]);
  protected news = signal<NewDraft[]>([]);
  protected busy = signal(false);
  /** Mode d'édition : à l'arrivée le budget est figé ; « Modifier » l'ouvre. Une ligne en cours d'enregistrement seule. */
  readonly editing = signal(false);
  protected savingRow = signal<string | null>(null);
  protected message = signal<string | null>(null);
  /** Ligne dont la suppression attend sa confirmation, puis ligne en cours de suppression. */
  protected confirmRemove = signal<string | null>(null);
  protected removing = signal<string | null>(null);

  readonly pendingChanges = computed(() => this.pendingCount());
  readonly saving = computed(() => this.busy());
  readonly feedback = computed(() => this.message());
  readonly ready = computed(() => !!this.bt.data());
  addRecurring(direction: Direction) { this.addLine(direction); }
  startEditing() { this.message.set(null); this.editing.set(true); }
  /** Quitte l'édition en abandonnant les brouillons : le budget revient à sa version enregistrée. */
  stopEditing() {
    const lines = this.bt.data()?.lines ?? [];
    this.rows.set(lines.map((l) => this.fromLine(l)));
    this.news.set([]);
    this.confirmRemove.set(null);
    this.editing.set(false);
  }

  constructor() {
    inject(BpmDrafts).connect('budget-type',
      () => ({ rows: this.rows().filter(row => this.isDirty(row) || row.kept), news: this.news() }),
      draft => {
        this.rows.set(draft.rows);
        this.news.set(draft.news);
        // Des changements non enregistrés retrouvés : l'édition reprend où elle s'était arrêtée.
        if (draft.rows.length || draft.news.length) this.editing.set(true);
      },
      inject(DestroyRef));
    // Relecture : les lignes enregistrées remplacent les brouillons, sauf ceux conservés après un échec.
    effect(() => {
      const data = this.bt.data();
      if (!data) return;
      const lines = data.lines;
      untracked(() => {
        const kept = new Map(this.rows().filter((r) => r.kept || this.isDirty(r)).map((r) => [r.id, r] as const));
        this.rows.set(lines.map((l) => kept.get(l.id) ?? this.fromLine(l)));
      });
    });
  }

  private fromLine(l: Recurrence): RowDraft {
    return {
      id: l.id,
      direction: l.direction,
      centerLabel: l.costCenterLabel,
      firstDate: l.firstDate,
      endDate: l.endDate,
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
    this.editing.set(true);
    this.news.update((ns) => [...ns, { key: newRequestKey('budget-type'), direction, label: '', amount: '', cadence: 'monthly', firstDate: localToday(), center: this.centersOf(direction)[0]?.ref ?? '', error: null }]);
  }

  /** Une ligne supprimée a une dernière échéance : elle ne revient plus (elle quitte la liste le lendemain). */
  protected isLeaving(r: RowDraft) {
    return !!r.endDate;
  }
  /** La ligne n'a encore eu aucune échéance (première date aujourd'hui ou plus tard) : elle peut être retirée entièrement. */
  private notStarted(r: RowDraft) {
    return r.firstDate >= localToday();
  }
  protected removalNotice(r: RowDraft) {
    if (this.notStarted(r)) return `« ${r.orig.label} » n'a encore aucune échéance : elle sera retirée du budget récurrent dès maintenant.`;
    return `« ${r.orig.label} » sera retirée dès maintenant : ses prochaines échéances disparaissent du cycle en cours et des suivants. Ce qui a déjà été réglé reste enregistré.`;
  }
  protected askRemove(id: string) {
    this.message.set(null);
    this.confirmRemove.set(this.confirmRemove() === id ? null : id);
  }

  /**
   * Supprime une ligne du budget récurrent, tout de suite : sa dernière échéance devient la veille (aucune échéance
   * à venir, ni dans le cycle en cours ni après). Ce qui est réglé reste : si une échéance a été réglée en avance,
   * la fin se pose sur elle. Une ligne qui n'a encore eu aucune échéance est retirée entièrement.
   */
  async removeLine(r: RowDraft) {
    if (this.removing()) return;
    this.removing.set(r.id);
    const end = async (endDate: string) => {
      const { recurrence } = await this.bpm.updateRecurrence(r.id, { expectedRevision: r.revision, endDate });
      this.patch(r.id, { endDate: recurrence.endDate, revision: recurrence.revision, error: null });
    };
    try {
      if (this.notStarted(r)) {
        await this.bpm.cancelRecurrence(r.id, r.revision, 'Supprimée depuis le budget récurrent');
      } else {
        try {
          await end(shiftDate(localToday(), -1));
        } catch (e) {
          // Une échéance déjà réglée après la veille : la dernière échéance devient celle-là.
          const lastSettled = toApiError(e).body.details?.['lastSettled'];
          if (typeof lastSettled !== 'string') throw e;
          await end(lastSettled);
        }
      }
      this.message.set(`« ${r.orig.label} » est retirée du budget récurrent : ses prochaines échéances ne sont plus prévues.`);
      this.confirmRemove.set(null);
      this.refresh.bump();
    } catch (e) {
      const err = toApiError(e);
      this.patch(r.id, { error: err.isConflict ? 'Modifiée ailleurs entre-temps : reprenez la version enregistrée.' : err.message });
    } finally {
      this.removing.set(null);
    }
  }

  /** Annule une suppression programmée : la ligne revient dans les cycles suivants. */
  async keepLine(r: RowDraft) {
    if (this.removing()) return;
    this.removing.set(r.id);
    try {
      const { recurrence } = await this.bpm.updateRecurrence(r.id, { expectedRevision: r.revision, endDate: null });
      this.patch(r.id, { endDate: recurrence.endDate, revision: recurrence.revision, error: null });
      this.message.set(`« ${r.orig.label} » reste dans le budget récurrent.`);
      this.refresh.bump();
    } catch (e) {
      this.patch(r.id, { error: toApiError(e).message });
    } finally {
      this.removing.set(null);
    }
  }

  /** Met à jour une ligne existante modifiée. Vrai si elle est enregistrée ; sinon son brouillon reste, avec l'erreur. */
  private async persistRow(r: RowDraft): Promise<boolean> {
    const amountCents = toCents(r.amount);
    if (amountCents === null || amountCents <= 0) {
      this.patch(r.id, { error: 'Montant positif attendu (ex. 120,50).', kept: true });
      return false;
    }
    const body: Record<string, unknown> & { expectedRevision: number } = { expectedRevision: r.revision };
    if (r.label.trim() !== r.orig.label) body['label'] = r.label.trim();
    if (amountCents !== r.orig.amountCents) body['amount'] = amountCents / 100;
    if (r.cadence !== r.orig.cadence) body['cadence'] = r.cadence;
    try {
      const { recurrence } = await this.bpm.updateRecurrence(r.id, body);
      this.patch(r.id, { error: null, kept: false, revision: recurrence?.revision ?? r.revision, orig: { label: r.label.trim(), amountCents, cadence: r.cadence } });
      return true;
    } catch (e) {
      const err = toApiError(e);
      this.patch(r.id, { error: err.isConflict ? 'Modifiée ailleurs entre-temps : reprenez la version enregistrée.' : err.message, kept: true });
      return false;
    }
  }

  /** Crée une nouvelle ligne (création rejouable par sa clé). Vrai si elle est enregistrée. */
  private async persistNew(n: NewDraft): Promise<boolean> {
    const amount = parseAmount(n.amount);
    if (!n.label.trim() || typeof amount !== 'number' || amount <= 0 || !n.firstDate || !n.center) {
      this.patchNew(n.key, { error: 'Libellé, montant positif, première date et centre requis.' });
      return false;
    }
    try {
      await this.bpm.createEntry({ requestKey: n.key, budgetId: this.life()?.id, direction: n.direction, label: n.label.trim(), amount, costCenterRef: n.center, cadence: n.cadence, firstDate: n.firstDate, endDate: null, status: 'planned' });
      this.dropNew(n.key);
      return true;
    } catch (e) {
      this.patchNew(n.key, { error: toApiError(e).message });
      return false;
    }
  }

  /** Enregistre une seule ligne modifiée (bouton « Enregistrer » de la ligne). */
  async saveRow(r: RowDraft) {
    if (this.busy() || this.savingRow()) return;
    this.savingRow.set(r.id);
    this.message.set(null);
    const ok = await this.persistRow(r);
    this.savingRow.set(null);
    if (ok) {
      this.refresh.bump();
      this.message.set(`« ${r.label.trim()} » enregistrée.`);
    }
  }

  /** Enregistre une seule nouvelle ligne. */
  async saveNewLine(n: NewDraft) {
    if (this.busy() || this.savingRow()) return;
    this.savingRow.set(n.key);
    this.message.set(null);
    const ok = await this.persistNew(n);
    this.savingRow.set(null);
    if (ok) {
      this.refresh.bump();
      this.message.set(`« ${n.label.trim()} » ajoutée au budget récurrent.`);
    }
  }

  /**
   * Enregistre tout (bouton du bas) : les lignes modifiées (mise à jour) puis les nouvelles (création rejouable).
   * Quand tout est enregistré, le budget redevient figé ; un échec garde l'édition ouverte sur son brouillon.
   */
  async saveAll() {
    if (this.busy()) return;
    this.busy.set(true);
    this.message.set(null);
    let updated = 0;
    let created = 0;
    let failed = 0;
    for (const r of this.rows().filter((x) => this.isDirty(x))) {
      if (await this.persistRow(r)) updated++;
      else failed++;
    }
    for (const n of this.news()) {
      if (await this.persistNew(n)) created++;
      else failed++;
    }
    this.busy.set(false);
    if (updated || created) this.refresh.bump();
    if (!failed) this.editing.set(false);
    this.message.set(
      [updated ? `${updated} ligne(s) mise(s) à jour` : '', created ? `${created} ligne(s) ajoutée(s)` : '', failed ? `${failed} non enregistrée(s) : brouillon conservé` : ''].filter(Boolean).join(' · ') || null,
    );
  }

  protected readonly fmt = cents;
}
