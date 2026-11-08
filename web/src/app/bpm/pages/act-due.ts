import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiError, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmDue, RegisterLine } from '../../core/bpm-models';
import { Operation } from '../../core/models';
import { cents, CentsPipe, parseAmount, shortDate, ShortDatePipe, SignedCentsPipe } from '../../core/format';
import { BpmRefresh, BpmState, Loader, newRequestKey } from '../ui';

/** Date locale du jour (AAAA-MM-JJ). */
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Dernier règlement fait depuis ce panneau : son annulation reste proposée selon les règles. */
export interface SettledNotice {
  label: string;
  direction: 'income' | 'charge';
  operation: Operation;
}

/**
 * Ligne d'échéance à traiter : valeurs réelles saisies en ligne, action Payé/Reçu.
 * La clé de commande est stable pour ce brouillon : un double clic ou une réponse perdue
 * ne produit jamais un second règlement (l'API refuse aussi une occurrence déjà réglée).
 */
@Component({
  selector: 'bpm-act-due-row',
  host: { '[class.is-done]': 'done()' },
  imports: [FormsModule, CentsPipe, ShortDatePipe],
  styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-vision.page.scss'],
  template: `
    <span class="bp-pending-date">Prévue · {{ line().plannedDate | shortDate }}</span>
    <div class="what">
      <strong>{{ line().label }}</strong>
      <small>
        <span class="chip" [class]="line().status">{{ line().statusLabel }}</span>
        {{ line().direction === 'income' ? 'Entrée' : 'Charge' }}
        · {{ line().budgetRole === 'life' ? 'Budget du projet de vie' : line().budgetName }}
        @if (line().costCenterLabel) { · {{ line().costCenterLabel }} } @else { · <span class="chip warn">Centre à préciser</span> }
      </small>
    </div>
    <span class="bp-pending-amount" [attr.data-sign]="line().direction === 'income' ? 'positive' : 'negative'">{{ line().direction === 'income' ? '+' : '−' }}{{ line().plannedCents | cents }}</span>
    <div class="ops">
      @if (done()) {
        <span class="chip settled">{{ line().direction === 'income' ? 'Reçu' : 'Payé' }}</span>
      } @else {
        <form class="settle" (ngSubmit)="settle()" [attr.aria-label]="'Régler : ' + line().label">
          <label class="field"><span>Date réelle</span><input type="date" name="d" [(ngModel)]="realDate" [max]="today" /></label>
          <label class="field"><span>Montant réel (€)</span><input name="a" inputmode="decimal" class="num" [(ngModel)]="realAmount" /></label>
          <button type="submit" class="btn btn-primary small" [disabled]="busy()">{{ busy() ? '…' : line().direction === 'income' ? 'Reçu' : 'Payé' }}</button>
        </form>
      }
      <button type="button" class="btn btn-secondary small" (click)="open.emit(line())">Détail</button>
    </div>
    @if (error(); as e) {
      <p class="bpm-error" role="alert">{{ e.message }} Votre saisie est conservée.</p>
    }
  `,
  styles: `
    :host { display: grid; grid-template-columns: 5.5rem minmax(0, 1fr) auto; align-items: center; gap: var(--ecart-8) var(--ecart-12); }
    :host(.is-done) { opacity: 0.7; }
    .what { display: grid; gap: var(--ecart-2); min-width: 0; }
    .what strong { color: var(--ink); overflow-wrap: anywhere; }
    .what small { color: var(--muted); }
    .bp-pending-amount { white-space: nowrap; }
    .ops, .settle { display: flex; flex-wrap: wrap; gap: var(--ecart-8); align-items: flex-end; }
    .ops { grid-column: 1 / -1; justify-content: flex-end; }
    .settle .field { flex: 1 1 8rem; }
    .bpm-error { grid-column: 1 / -1; }
    @media (max-width: 640px) { :host { grid-template-columns: minmax(0, 1fr) auto; } .bp-pending-date { grid-column: 1 / -1; } }
  `,
})
export class BpmActDueRow implements OnInit {
  private bpm = inject(BpmApi);
  private refresh = inject(BpmRefresh);
  readonly line = input.required<RegisterLine>();
  readonly open = output<RegisterLine>();
  readonly settled = output<SettledNotice>();

  protected today = localToday();
  protected realDate = signal(this.today);
  protected realAmount = signal('');
  protected busy = signal(false);
  protected done = signal(false);
  protected error = signal<ApiError | null>(null);
  private key = newRequestKey('settle');

  ngOnInit() {
    this.realAmount.set(String(this.line().plannedCents / 100).replace('.', ','));
  }

  async settle() {
    if (this.busy() || this.done()) return;
    const l = this.line();
    const amount = parseAmount(this.realAmount());
    if (typeof amount !== 'number' || amount <= 0) {
      this.error.set(new ApiError(400, { code: 'VALIDATION', action: null, message: 'Montant réel positif attendu (ex. 120,50).' }));
      return;
    }
    if (!this.realDate()) {
      this.error.set(new ApiError(400, { code: 'VALIDATION', action: null, message: 'Date réelle attendue.' }));
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const body = { realizedDate: this.realDate(), realizedAmount: amount };
      let op: Operation;
      if (l.kind === 'occurrence' && l.recurrenceId && l.occurrenceDate) {
        op = (await this.bpm.settleOccurrence(l.recurrenceId, { requestKey: this.key, occurrenceDate: l.occurrenceDate, ...body })).operation;
      } else {
        op = (await this.bpm.realizeOperation(l.operationId ?? l.id, { expectedRevision: l.revision ?? 0, ...body })).operation;
      }
      this.done.set(true);
      this.settled.emit({ label: l.label, direction: l.direction, operation: op });
      this.refresh.bump();
    } catch (e) {
      this.error.set(toApiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}

/**
 * Panneau « Échéances à traiter » : échéances en retard ou du jour (tous les Budgets du user),
 * règlement en ligne ou ouverture du détail ; annulation du dernier règlement tant que sa période
 * n'est pas close (règle vérifiée par l'API).
 */
@Component({
  selector: 'bpm-act-due',
  imports: [BpmState, BpmActDueRow, SignedCentsPipe],
  styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-vision.page.scss', '../ref-styles/bpm-pilot-charts.scss'],
  template: `
    <div class="bp-pending-section">
      <section class="bv-card" aria-labelledby="bp-pending-title" data-ui-pattern="panel">
        <h2 id="bp-pending-title">Échéances à traiter</h2>
        <p>En retard ou du jour : marquez-les payées ou reçues avec leurs valeurs réelles.</p>
        <p class="bpm-help">Indiquez la date et le montant figurant sur votre compte. Les échéances futures restent dans le calendrier.</p>

        @if (notice(); as n) {
          <p class="bv-saved" role="status">
            {{ n.direction === 'income' ? 'Entrée reçue' : 'Charge payée' }} : « {{ n.label }} », {{ amount(n.operation.realizedAmountCents) }} le {{ date(n.operation.realizedDate) }}.
            @if (!cancelled()) {
              <button type="button" class="bv-undo" (click)="cancel(n)" [disabled]="busy()">Annuler ce règlement</button>
            } @else {
              <strong>Règlement annulé : l'échéance redevient attendue.</strong>
            }
            <button type="button" class="bv-undo" (click)="notice.set(null)">Fermer</button>
          </p>
        }
        @if (cancelError(); as e) { <p class="bpm-error" role="alert">{{ e.message }}</p> }

        <bpm-state [loading]="loader().loading() && !loader().data()" [error]="loader().error()" (retry)="loader().reload()" [empty]="!!loader().data() && !rows().length" emptyText="Aucune échéance en retard ou du jour : rien à régler aujourd'hui." />
        @if (loader().data(); as d) {
          @if (rows().length) {
            <p class="bpm-help">
              {{ rows().length }} échéance(s) à traiter · solde net des échéances <strong class="num">{{ d.totalCents | signedCents }}</strong>
              (entrées en +, charges en −)
            </p>
            <ul class="bp-pending">
              @for (l of rows(); track l.id) {
                <li><bpm-act-due-row [line]="l" (open)="open.emit($event)" (settled)="onSettled($event)" /></li>
              }
            </ul>
          }
          @if (unrealized().length) {
            <details class="bpm-limited">
              <summary>{{ unrealized().length }} échéance(s) non réalisée(s) de périodes closes</summary>
              <p class="bpm-help">Elles sont restées sans règlement à la clôture. Un règlement tardif reste possible depuis le détail : il compte à sa date réelle, sans modifier l'historique clos.</p>
              <ul class="bp-pending">
                @for (l of unrealized(); track l.id) {
                  <li><bpm-act-due-row [line]="l" (open)="open.emit($event)" (settled)="onSettled($event)" /></li>
                }
              </ul>
            </details>
          }
        }
      </section>
    </div>
  `,
  styles: `
    /* La ligne d'échéance porte elle-même sa grille (formulaire de règlement en ligne). */
    .bp-pending > li { display: block; }
    .bv-saved { display: flex; flex-wrap: wrap; align-items: center; gap: var(--ecart-8); }
    details > .bp-pending { margin-top: var(--ecart-12); }
  `,
})
export class BpmActDue {
  private bpm = inject(BpmApi);
  private refresh = inject(BpmRefresh);
  readonly loader = input.required<Loader<BpmDue>>();
  readonly open = output<RegisterLine>();

  protected rows = computed(() => (this.loader().data()?.lines ?? []).filter((l) => l.status !== 'unrealized'));
  protected unrealized = computed(() => (this.loader().data()?.lines ?? []).filter((l) => l.status === 'unrealized'));
  protected notice = signal<SettledNotice | null>(null);
  protected cancelled = signal(false);
  protected busy = signal(false);
  protected cancelError = signal<ApiError | null>(null);
  protected amount = cents;
  protected date = shortDate;

  protected onSettled(n: SettledNotice) {
    this.notice.set(n);
    this.cancelled.set(false);
    this.cancelError.set(null);
  }

  async cancel(n: SettledNotice) {
    this.busy.set(true);
    this.cancelError.set(null);
    try {
      await this.bpm.cancelRealization(n.operation.id, n.operation.revision);
      this.cancelled.set(true);
      this.refresh.bump();
    } catch (e) {
      this.cancelError.set(toApiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
