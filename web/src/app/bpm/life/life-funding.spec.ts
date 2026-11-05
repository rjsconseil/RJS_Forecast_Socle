import { describe, expect, it } from 'vitest';
import { LifeFundingRow } from '../../core/bpm-projects.models';
import { fundingMarks } from './life-funding';

const row = (o: Partial<LifeFundingRow> = {}): LifeFundingRow => ({
  budgetId: 'bud_1', coreProjectId: 'prj_1', name: 'Voyage', regime: true, state: 'ok',
  allocationCents: 100000, initialAllocationCents: 100000, allocationDate: '2026-11-02', allocationPeriodKey: '2026-11',
  approvedOverrunCents: 0, billedOverrunCents: 0, pendingOverrunCents: 0, paidCents: 20000, remainingCents: 80000,
  byPeriod: { '2026-10': 0, '2026-11': 20000 }, overruns: [], ...o,
});

describe('Financement des projets de la vie', () => {
  it('marque la période d’attribution de l’enveloppe', () => {
    expect(fundingMarks(row(), '2026-11').allocation).toBe(true);
    expect(fundingMarks(row(), '2026-10').allocation).toBe(false);
  });

  it('place chaque dépassement dans sa période de décision', () => {
    const r = row({ overruns: [{ id: 'o1', status: 'approved', statusLabel: 'Autorisé', amountCents: 5000, periodKey: '2026-10', billingDate: '2026-10-31' }] });
    expect(fundingMarks(r, '2026-10').overruns).toHaveLength(1);
    expect(fundingMarks(r, '2026-10').overruns[0].amount).toMatch(/^50,00\s€$/);
    expect(fundingMarks(r, '2026-11').overruns).toHaveLength(0);
  });
});
