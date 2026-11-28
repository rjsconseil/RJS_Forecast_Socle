import type { Operation } from '../../../platform/grand-noyau';
import { entreeQuotidien } from './entree';

const op = (o: Partial<Operation>): Operation => ({ id: 'op', label: 'Ligne', direction: 'charge', amountCents: 1000, date: '2026-11-05', status: 'planned', realizedAmountCents: null, realizedDate: null, costCenterRef: 'std:divers', costCenterLabel: 'Divers', ...o }) as Operation;

describe('Mon quotidien · entrée', () => {
  it('lit les mouvements du budget de vie de la période : réglés à leur date réelle, prévus à leur date prévue', () => {
    const e = entreeQuotidien([
      op({ id: 'a', label: 'Salaire', direction: 'income', amountCents: 200000, date: '2026-11-01', status: 'realized', realizedAmountCents: 200000, realizedDate: '2026-11-02' }),
      op({ id: 'b', label: 'Courses', amountCents: 8000, date: '2026-11-03', status: 'realized', realizedAmountCents: 9000, realizedDate: '2026-11-03' }),
      op({ id: 'c', label: 'Loyer', amountCents: 70000, date: '2026-11-25' }),
      op({ id: 'd', label: 'Hors période', amountCents: 500, date: '2026-12-02' }),
    ], '2026-11-01', '2026-11-30');
    expect(e.mouvements.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect([e.recuCents, e.payeCents, e.aRecevoirCents, e.aPayerCents]).toEqual([200000, 9000, 0, 70000]);
    expect(e.agenda).toBeNull();
  });
});
