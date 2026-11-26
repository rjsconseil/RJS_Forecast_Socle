import { BpmAmount } from './amount';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CentsPipe, ShortDatePipe } from '../../core/format';

/** Cycle d'une date, y compris les ancrages en fin de mois. Ne calcule aucun montant. */
export function postingCycle(date: string, anchor: number | null | undefined): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !anchor || anchor < 1 || anchor > 31) return null;
  const day = new Date(date + 'T12:00:00Z');
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date) return null;
  let y = day.getUTCFullYear(), m = day.getUTCMonth();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  if (day.getUTCDate() < Math.min(anchor, last)) { m--; if (m < 0) { m = 11; y--; } }
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m, 1)));
}

@Component({
  selector: 'bpm-posting-impact',
  imports: [BpmAmount, CentsPipe, ShortDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './posting-impact.scss',
  template: `
    <section class="posting-impact" [attr.data-source]="source()" aria-label="Destination et effet de cette opération" aria-live="polite">
      <div class="posting-title"><span>{{ validated() ? 'À la validation' : 'Prévision, sans débit validé' }}</span><strong>{{ source() === 'patrimoine' ? 'Patrimoine · hors cycle' : 'Cycle budgétaire' }} @if (amountCents() !== null) { · <span [bpmAmount]="amountCents()" [bpmFlow]="direction()">{{ amountCents() | cents }}</span> }</strong></div>
      @if (project() || task()) { <p class="posting-origin">{{ project() }}@if (task()) { → {{ task() }} }</p> }
      <ol><li><small>Annoncé</small><strong>{{ announced() | shortDate }}</strong><span>{{ announcedCycle() ? 'Cycle ' + announcedCycle() : 'Date prévue' }}</span></li><li><small>{{ direction() === 'charge' ? 'Paiement' : 'Encaissement' }}</small><strong>{{ paid() | shortDate }}</strong><span>{{ paidCycle() ? 'Cycle ' + paidCycle() + ' · trace' : 'Date réelle à confirmer' }}</span></li><li class="posting-destination"><small>Imputation {{ validated() ? 'à confirmer' : 'proposée' }}</small><strong>{{ effectiveDate() | shortDate }}</strong><span>{{ source() === 'patrimoine' ? 'Stock de patrimoine' : chargedCycle() ? 'Cycle ' + chargedCycle() : 'Cycle de cette date' }}</span></li></ol>
      <p>@if (!validated()) { Cette opération reste annoncée : elle n’affecte pas encore les montants validés. }
        @if (source() === 'patrimoine') { {{ direction() === 'charge' ? 'La validation réduira le patrimoine' : 'La validation augmentera le patrimoine' }}. Aucun cycle ne porte ce montant dans ses charges ou revenus. }
        @else { Seul le cycle d’imputation {{ direction() === 'charge' ? 'portera la charge' : 'recevra le gain' }}. Les autres cycles gardent une trace, sans double compte. Le résultat rejoindra le patrimoine à la clôture. }
      </p>
    </section>
  `,
})
export class BpmPostingImpact {
  readonly source = input<'cycle' | 'patrimoine'>('cycle');
  readonly direction = input<'income' | 'charge'>('charge');
  readonly amountCents = input<number | null>(null);
  readonly announced = input('');
  readonly paid = input('');
  readonly accounting = input('');
  readonly anchorDay = input<number | null | undefined>(null);
  readonly validated = input(false);
  readonly project = input('');
  readonly task = input('');
  protected readonly effectiveDate = computed(() => this.accounting() || this.paid() || this.announced());
  protected readonly announcedCycle = computed(() => postingCycle(this.announced(), this.anchorDay()));
  protected readonly paidCycle = computed(() => postingCycle(this.paid(), this.anchorDay()));
  protected readonly chargedCycle = computed(() => postingCycle(this.effectiveDate(), this.anchorDay()));
}
