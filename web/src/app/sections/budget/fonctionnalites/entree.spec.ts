import type { PatrimoineRead } from '../../../platform/grand-noyau';
import { entreeBudget } from './entree';

const lecture = (openingStockCents: number | null, capitalized: number[]): PatrimoineRead => ({
  patrimoine: { openingStockCents, openingDate: '2026-11-01', objectiveCents: null, coreProjectId: 'prj_vie' },
  capitalizations: capitalized.map((amountCents) => ({ amountCents })),
}) as unknown as PatrimoineRead;

describe('Mon budget · entrée', () => {
  it('le disponible est le constitué moins les engagements futurs ; inconnu tant que les engagements ne sont pas lus', () => {
    expect(entreeBudget(lecture(1000000, [50000, -20000]))).toEqual({ constitueCents: 1030000, engagesCents: null, disponibleCents: null, depuis: '2026-11-01' });
    expect(entreeBudget(lecture(1000000, [50000]), 300000).disponibleCents).toBe(750000);
    expect(entreeBudget(lecture(100000, []), 300000).disponibleCents).toBe(0);
    expect(entreeBudget(lecture(null, [])).constitueCents).toBeNull();
  });
});
