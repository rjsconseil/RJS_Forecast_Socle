import { computed, inject, signal } from '@angular/core';
import { ApiError, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { RegisterLine } from '../../core/bpm-models';
import { parseAmount, shortDate } from '../../core/format';
import { localToday } from '../../calendar/calendar-dates';
import { capAlertText, withCapAlerts } from './caps';
import { BpmRefresh, newRequestKey } from './page-context';

/** Avertissement propre à la ligne : une date réelle très antérieure à la date prévue est rarement voulue. */
export function settleDateWarnings(line: RegisterLine, realDate: string): string[] {
  if (!realDate || line.direction !== 'charge') return [];
  const gap = (Date.parse(line.plannedDate) - Date.parse(realDate)) / 86400000;
  return gap > 90 ? [`La date réelle précède de plus de trois mois la date prévue (${shortDate(line.plannedDate)}) : vérifiez le jour, le mois et l’année.`] : [];
}

/**
 * Règlement d'une échéance, commun à la ligne rapide et à la fiche détaillée (audit ARCH-02) :
 * même vérification des plafonds, même confirmation liée à la saisie, mêmes alertes après écriture
 * et même refus à résoudre. À créer dans un contexte d'injection, une instance par ligne affichée.
 */
export class Settlement {
  private bpm = inject(BpmApi);
  private refresh = inject(BpmRefresh);
  readonly realDate = signal(localToday());
  readonly realAmount = signal('');
  readonly busy = signal(false);
  readonly message = signal<string | null>(null);
  readonly error = signal<ApiError | null>(null);
  /** Alerte en attente de confirmation : elle ne vaut que pour la saisie qui l'a produite. */
  readonly confirmation = signal<string | null>(null);
  private refusedFor = signal<string | null>(null);
  private key = newRequestKey('settle');

  constructor(private readonly lineId: () => string) {}

  private signature() {
    return JSON.stringify({ lineId: this.lineId(), date: this.realDate(), amount: this.realAmount() });
  }
  /** Refus de la saisie affichée : il ne vaut jamais pour une autre date ou un autre montant. */
  readonly refusal = computed(() => (this.refusedFor() === this.signature() ? this.error() : null));
  /** Refus que le budget de vie peut lever : part de tâche insuffisante ou dépassement à autoriser. */
  readonly fundable = computed(() => {
    const body = this.refusal()?.body;
    return body?.code === 'OVERRUN_AUTHORIZATION_REQUIRED' || (body?.details as { reason?: string } | undefined)?.reason === 'task-share';
  });

  /**
   * Règle l'échéance et renvoie la réponse, ou `null` si une confirmation ou une correction est attendue.
   * `fund` : la part et le dépassement nécessaires sont accordés par le middleware dans la même écriture.
   */
  async settle(line: RegisterLine, { warnings = settleDateWarnings(line, this.realDate()), fund }: { warnings?: string[]; fund?: { notice: string } } = {}) {
    if (this.busy()) return null;
    const signatureAtStart = this.signature();
    // Une autorisation proposée pour un montant ne vaut jamais pour une autre saisie.
    const fundCurrent = !!fund && this.refusedFor() === signatureAtStart;
    const amount = this.realAmount() ? parseAmount(this.realAmount()) : undefined;
    if (amount === 'invalid' || (typeof amount === 'number' && amount <= 0) || !this.realDate()) {
      this.error.set(new ApiError(400, { code: 'VALIDATION', action: null, message: this.realDate() ? 'Montant réel positif attendu (ex. 120,50).' : 'Date réelle attendue.' }));
      return null;
    }
    const occurrence = line.kind === 'occurrence' && line.recurrenceId && line.occurrenceDate ? { recurrenceId: line.recurrenceId, occurrenceDate: line.occurrenceDate } : null;
    this.busy.set(true);
    this.error.set(null);
    try {
      const body = { realizedDate: this.realDate(), ...(typeof amount === 'number' ? { realizedAmount: amount } : {}) };
      if (line.direction === 'charge') {
        const input = {
          budgetId: line.budgetId, direction: line.direction, label: line.label,
          amount: line.plannedCents / 100, date: line.plannedDate,
          costCenterRef: line.costCenterRef ?? undefined, categoryId: line.categoryId,
          settle: true, ...body,
          ...(occurrence ?? { replaceId: line.operationId ?? line.id }),
        };
        let signature: string | null = warnings.length ? JSON.stringify({ input, warnings }) : null;
        if (warnings.length) this.message.set(warnings.join(' ') + ' Confirmez ce règlement si ces dates sont voulues.');
        try {
          const preview = await this.bpm.previewCaps(input);
          if (preview.alerts.length) {
            signature = JSON.stringify({ input, warnings, alerts: preview.alerts });
            this.message.set(`${warnings.join(' ')} Attention avant paiement (${preview.period.label}) : ${preview.alerts.map(capAlertText).join(' ; ')}. Le paiement reste autorisé.`);
          }
        } catch {
          signature = JSON.stringify({ input, unavailable: true });
          this.message.set('Vérification des plafonds indisponible. Vous pouvez confirmer le paiement sans cette vérification.');
        }
        if (signature && signature !== this.confirmation()) {
          this.confirmation.set(signature);
          return null;
        }
      }
      if (signatureAtStart !== this.signature()) {
        this.message.set('La saisie a changé pendant la vérification. Vérifiez la date et le montant, puis relancez le règlement.');
        return null;
      }
      const r = occurrence
        ? await this.bpm.settleOccurrence(occurrence.recurrenceId, { requestKey: this.key, occurrenceDate: occurrence.occurrenceDate, ...body, fund: fundCurrent })
        : await this.bpm.realizeOperation(line.operationId ?? line.id, { expectedRevision: line.revision ?? 0, ...body, fund: fundCurrent });
      // Un plafond dépassé est signalé, jamais bloquant : le règlement est enregistré.
      const done = line.direction === 'income' ? 'Entrée marquée reçue.' : 'Charge marquée payée.';
      this.message.set(withCapAlerts(fundCurrent ? `${fund!.notice} ${done}` : done, r.capAlerts));
      this.confirmation.set(null);
      this.key = newRequestKey('settle');
      this.refresh.bump();
      return r;
    } catch (e) {
      this.error.set(toApiError(e));
      this.refusedFor.set(signatureAtStart);
      return null;
    } finally {
      this.busy.set(false);
    }
  }
}
