import { computed, Directive, input } from '@angular/core';

export type BpmAmountTone = 'success' | 'danger' | 'warning' | 'info';
export type BpmAmountFlow = 'income' | 'expense' | 'charge';

/** La direction d'un mouvement prime sur son montant absolu ; un remboursement inverse le sens. */
export function amountSemantics(value: number | null | undefined, flow?: BpmAmountFlow | null, override?: BpmAmountTone | null) {
  const known = typeof value === 'number' && Number.isFinite(value);
  const signed = known ? value * (flow === 'expense' || flow === 'charge' ? -1 : 1) : null;
  const direction = flow && signed !== null && signed !== 0 ? signed > 0 ? 'income' : 'expense' : null;
  const tone = override ?? (signed === null || signed === 0 ? 'info' : signed > 0 ? 'success' : 'danger');
  return { tone, direction, arrow: direction === 'income' ? '↑' : direction === 'expense' ? '↓' : null };
}

/** Présentation explicite d'un montant : aucun calcul métier, lecture de texte ou modification du montant. */
@Directive({
  selector: '[bpmAmount]',
  host: {
    'data-bpm-amount': '',
    '[attr.data-bpm-value-tone]': 'semantic().tone',
    '[attr.data-bpm-flow]': 'semantic().direction',
    '[attr.data-bpm-arrow]': 'semantic().arrow',
  },
})
export class BpmAmount {
  readonly bpmAmount = input.required<number | null | undefined>();
  readonly bpmFlow = input<BpmAmountFlow | null | undefined>(null);
  readonly bpmTone = input<BpmAmountTone | null | undefined>(null);
  protected readonly semantic = computed(() => amountSemantics(this.bpmAmount(), this.bpmFlow(), this.bpmTone()));
}
