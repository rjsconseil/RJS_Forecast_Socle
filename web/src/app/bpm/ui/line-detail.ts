import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiError, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { LineDetail, RegisterLine } from '../../core/bpm-models';
import { cents, parseAmount, shortDate, signedCents } from '../../core/format';
import { ModalComponent } from '../../shared/modal.component';
import { bpmLoader, BpmRefresh, newRequestKey } from './page-context';
import { BpmState } from './state';

/**
 * Détail d'une échéance ou d'une opération (panneau partagé) : identité, prévu/réel, différence,
 * statut, définition récurrente, historique des règlements et actions de pointage autorisées.
 * La modification ouvre l'éditeur BPM partagé (sortie `edit`).
 * Présentation de la référence : fenêtre `rjs-modal` et fiche `.bpm-guide` (`bpm-settlement`, `bpm-workspace-nav`).
 */
@Component({
  selector: 'bpm-line-detail',
  imports: [FormsModule, BpmState, ModalComponent],
  styleUrls: ['../ref-styles/bpm-context.scss', '../ref-styles/bpm-pages.scss', './line-detail.scss'],
  template: `
    <rjs-modal [open]="true" [headed]="true" [title]="d()?.line?.label ?? 'Détail de l’échéance'" [busy]="busy()" (closed)="closed.emit()">
      <div class="bpm-guide">
        <bpm-state [loading]="loader.loading() && !d()" [error]="loader.error()" (retry)="loader.reload()" />
        @if (message()) {
          <p class="bld-saved" role="status">{{ message() }}</p>
        }
        @if (actionError(); as e) {
          <p class="bpm-error" role="alert">{{ e.message }} <small>Votre saisie est conservée.</small></p>
        }
        @if (d(); as v) {
          <header>
            <small>{{ v.line.direction === 'income' ? 'Entrée' : 'Charge' }} · {{ v.line.cadenceLabel }}</small>
            <p class="bld-tags">
              <span class="chip" [class]="v.line.status">{{ v.line.statusLabel }}</span>
              @if (!v.line.centerKnown) {
                <span class="chip warn">Centre à préciser</span>
              }
            </p>
          </header>
          <section>
            <h3>Prévu et réel</h3>
            <dl>
              <div><dt>Budget / projet</dt><dd>{{ v.line.budgetRole === 'life' ? 'Budget du projet de vie' : v.line.budgetName }}</dd></div>
              <div><dt>Centre</dt><dd>{{ v.line.costCenterLabel ?? 'À préciser' }}</dd></div>
              <div><dt>Tâche</dt><dd>{{ v.line.taskTitle ?? '—' }}</dd></div>
              <div><dt>Date prévue</dt><dd>{{ date(v.line.plannedDate) }}</dd></div>
              <div><dt>Montant prévu</dt><dd class="num">{{ c(v.line.plannedCents) }}</dd></div>
              <div><dt>Date réelle</dt><dd>{{ v.line.realizedDate ? date(v.line.realizedDate) : '—' }}</dd></div>
              <div><dt>Montant réel</dt><dd class="num">{{ v.line.realizedCents === null ? '—' : c(v.line.realizedCents) }}</dd></div>
              <div><dt>Différence (réel − prévu)</dt><dd class="num">{{ v.line.differenceCents === null ? '—' : s(v.line.differenceCents) }}</dd></div>
            </dl>
          </section>
          @if (v.definition; as def) {
            <section>
              <h3>Définition récurrente</h3>
              <dl>
                <div><dt>Répétition</dt><dd>{{ def.cadenceLabel }}</dd></div>
                <div><dt>Première échéance</dt><dd>{{ date(def.firstDate) }}</dd></div>
                <div><dt>Dernière échéance</dt><dd>{{ def.endDate ? date(def.endDate) : 'Sans fin' }}</dd></div>
                <div><dt>Montant par échéance</dt><dd class="num">{{ c(def.amountCents) }}</dd></div>
              </dl>
            </section>
          }
          @if (v.line.note) {
            <p><strong>Note :</strong> {{ v.line.note }}</p>
          }

          @if (v.actions.canSettle) {
            <section>
              <h3>{{ v.line.direction === 'income' ? 'Marquer reçu' : 'Marquer payé' }}</h3>
              <div class="bld-fields">
                <label>Date réelle<input type="date" [(ngModel)]="realDate" name="realDate" /></label>
                <label>Montant réel (€)<input inputmode="decimal" [(ngModel)]="realAmount" name="realAmount" /></label>
              </div>
              <p class="bpm-help">{{ v.actions.settlementPolicy }}</p>
              <div class="bpm-actions">
                <button type="button" class="btn btn-primary" (click)="settle(v)" [disabled]="busy()">{{ v.line.direction === 'income' ? 'Reçu' : 'Payé' }}</button>
              </div>
            </section>
          }
          @if (v.actions.canCancelSettlement && v.line.operationId) {
            <div class="bpm-actions">
              <button type="button" class="btn btn-danger" (click)="cancel(v)" [disabled]="busy()">Annuler le règlement</button>
            </div>
          } @else if (v.line.settled) {
            <p class="bpm-help">Règlement compris dans une période close : il n'est plus annulable.</p>
          }

          <section>
            <h3>Historique des règlements</h3>
            @if (v.settlements.length) {
              <div class="table-scroll">
                <table class="data-table">
                  <thead>
                    <tr><th>Échéance</th><th>Réglé le</th><th class="num">Prévu</th><th class="num">Réel</th><th></th></tr>
                  </thead>
                  <tbody>
                    @for (r of v.settlements; track r.operationId) {
                      <tr>
                        <td>{{ r.occurrenceDate ? date(r.occurrenceDate) : '—' }}</td>
                        <td>{{ date(r.realizedDate) }}</td>
                        <td class="num">{{ c(r.plannedCents) }}</td>
                        <td class="num">{{ c(r.realizedCents) }}</td>
                        <td>@if (r.outsidePeriod) {<span class="chip">hors période</span>}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="bpm-help">Aucun règlement enregistré.</p>
            }
          </section>
          <details class="bld-ids">
            <summary>Détails techniques</summary>
            <dl>
              <div><dt>Ligne</dt><dd>{{ v.ids.lineId }}</dd></div>
              <div><dt>Opération</dt><dd>{{ v.ids.operationId ?? '—' }}</dd></div>
              <div><dt>Définition récurrente</dt><dd>{{ v.ids.recurrenceId ?? '—' }}</dd></div>
              <div><dt>Budget</dt><dd>{{ v.ids.budgetId }}</dd></div>
              <div><dt>Tâche</dt><dd>{{ v.ids.taskId ?? '—' }}</dd></div>
            </dl>
          </details>
        }
        <div class="bpm-actions">
          @if (d(); as v) {
            @if (v.actions.canEdit) {
              <button type="button" class="btn btn-primary" (click)="edit.emit(v.line)">Modifier</button>
            } @else {
              <p class="bpm-help">Opération d'une période close : modification financière protégée.</p>
            }
          }
          <button type="button" class="btn btn-secondary" (click)="closed.emit()">Fermer</button>
        </div>
      </div>
    </rjs-modal>
  `,
})
export class BpmLineDetail {
  private bpm = inject(BpmApi);
  private refresh = inject(BpmRefresh);
  readonly lineId = input.required<string>();
  readonly period = input<string | undefined>(undefined);
  readonly closed = output<void>();
  readonly edit = output<RegisterLine>();

  protected loader = bpmLoader(
    () => ({ id: this.lineId(), period: this.period() }),
    (k) => this.bpm.line(k.id, k.period),
  );
  protected d = computed(() => this.loader.data());
  protected busy = signal(false);
  protected message = signal<string | null>(null);
  protected actionError = signal<ApiError | null>(null);
  protected realDate = signal(new Date().toISOString().slice(0, 10));
  protected realAmount = signal('');
  private settleKey = newRequestKey('settle');

  protected c = cents;
  protected s = signedCents;
  protected date = shortDate;

  async settle(v: LineDetail) {
    const amount = this.realAmount() ? parseAmount(this.realAmount()) : undefined;
    if (amount === 'invalid' || (typeof amount === 'number' && amount <= 0)) {
      this.actionError.set(new ApiError(400, { code: 'VALIDATION', action: null, message: 'Montant réel positif attendu.' }));
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    try {
      const body = { realizedDate: this.realDate(), ...(typeof amount === 'number' ? { realizedAmount: amount } : {}) };
      if (v.line.kind === 'occurrence' && v.line.recurrenceId && v.line.occurrenceDate) {
        await this.bpm.settleOccurrence(v.line.recurrenceId, { requestKey: this.settleKey, occurrenceDate: v.line.occurrenceDate, ...body });
      } else {
        await this.bpm.realizeOperation(v.line.operationId ?? v.line.id, { expectedRevision: v.line.revision ?? 0, ...body });
      }
      this.message.set(v.line.direction === 'income' ? 'Entrée marquée reçue.' : 'Charge marquée payée.');
      this.settleKey = newRequestKey('settle');
      this.refresh.bump();
    } catch (e) {
      this.actionError.set(toApiError(e));
    } finally {
      this.busy.set(false);
    }
  }

  async cancel(v: LineDetail) {
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await this.bpm.cancelRealization(v.line.operationId!, v.line.revision ?? 0);
      this.message.set('Règlement annulé : l’échéance redevient attendue.');
      this.refresh.bump();
    } catch (e) {
      this.actionError.set(toApiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
