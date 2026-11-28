import type { Operation, Period } from '../../../platform/grand-noyau';

/**
 * Entrée de l'application autonome Mes cycles : le comportement financier du quotidien, cycle par cycle. Pour chaque
 * cycle, ce qui a été reçu et dépensé (mouvements réglés du budget de vie, à leur date réelle) et ce qu'il reste en
 * épargne. L'application l'analyse pour améliorer le taux d'épargne à chaque cycle. La sortie reste à définir.
 */
export interface CycleObserve {
  cle: string;
  libelle: string;
  debut: string;
  fin: string;
  recuCents: number;
  depenseCents: number;
  epargneCents: number;
  /** Épargne ÷ reçu, en % à une décimale ; null sans entrée. */
  tauxEpargnePct: number | null;
  mouvements: number;
}

export function entreeCycles(periodes: Period[], operations: Operation[]): CycleObserve[] {
  const regles = operations.filter((o) => o.status === 'realized' && o.realizedDate);
  return periodes
    .filter((p) => p.status !== 'future')
    .map((p) => {
      const du = regles.filter((o) => o.realizedDate! >= p.start && o.realizedDate! <= p.end);
      const somme = (sens: Operation['direction']) => du.filter((o) => o.direction === sens).reduce((t, o) => t + (o.realizedAmountCents ?? o.amountCents), 0);
      const recuCents = somme('income');
      const depenseCents = somme('charge');
      const epargneCents = recuCents - depenseCents;
      return {
        cle: p.key, libelle: p.label, debut: p.start, fin: p.end, recuCents, depenseCents, epargneCents,
        tauxEpargnePct: recuCents ? Math.round((epargneCents / recuCents) * 1000) / 10 : null,
        mouvements: du.length,
      };
    })
    .sort((a, b) => a.debut.localeCompare(b.debut));
}
