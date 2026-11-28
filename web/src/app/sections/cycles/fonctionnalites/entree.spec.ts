import type { Operation, Period } from '../../../platform/grand-noyau';
import { entreeCycles } from './entree';

const op = (o: Partial<Operation>): Operation => ({ id: 'op', direction: 'charge', amountCents: 0, status: 'realized', realizedAmountCents: null, realizedDate: null, ...o }) as Operation;
const periodes: Period[] = [
  { key: '2026-11', label: 'Novembre 2026', start: '2026-11-01', end: '2026-11-30', status: 'current' },
  { key: '2026-10', label: 'Octobre 2026', start: '2026-10-01', end: '2026-10-31', status: 'closed' },
  { key: '2026-12', label: 'Décembre 2026', start: '2026-12-01', end: '2026-12-31', status: 'future' },
];

describe('Mes cycles · entrée', () => {
  it('reçu, dépensé, épargne et taux d’épargne de chaque cycle, du plus ancien au plus récent', () => {
    const c = entreeCycles(periodes, [
      op({ direction: 'income', amountCents: 200000, realizedAmountCents: 200000, realizedDate: '2026-10-01' }),
      op({ amountCents: 150000, realizedAmountCents: 150000, realizedDate: '2026-10-10' }),
      op({ direction: 'income', amountCents: 200000, realizedAmountCents: 200000, realizedDate: '2026-11-01' }),
      op({ amountCents: 100000, realizedAmountCents: 120000, realizedDate: '2026-11-03' }),
      op({ amountCents: 5000, status: 'planned', date: '2026-11-20' } as Partial<Operation>),
    ]);
    expect(c.map((x) => [x.cle, x.recuCents, x.depenseCents, x.epargneCents, x.tauxEpargnePct])).toEqual([
      ['2026-10', 200000, 150000, 50000, 25],
      ['2026-11', 200000, 120000, 80000, 40],
    ]);
  });
});
