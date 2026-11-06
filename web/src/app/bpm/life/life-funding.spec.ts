import { describe, expect, it } from 'vitest';
import { LifeFunding, LifeFundingRow } from '../../core/bpm-projects.models';
import { fundingMarks, fundingPeriodWindow } from './life-funding';

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

  it('garde la période historique consultée dans la fenêtre sans déformer la chronologie', () => {
    const periods: LifeFunding['periods'] = Array.from({ length: 11 }, (_, i) => ({
      key: `2026-${String(i + 1).padStart(2, '0')}`, label: `Période ${i + 1}`, start: '', end: '', status: 'ended',
    }));
    expect(fundingPeriodWindow(periods, '2026-02').map((p) => p.key)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
    expect(fundingPeriodWindow(periods, '2026-05').map((p) => p.key)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']);
    expect(fundingPeriodWindow(periods, '2026-11')).toEqual(periods.slice(-6));
    expect(fundingPeriodWindow(periods, null)).toEqual(periods.slice(-6));
    expect(fundingPeriodWindow(periods, 'inconnue')).toEqual(periods.slice(-6));
    expect(fundingPeriodWindow(periods, '2026-02', true)).toBe(periods);
    expect(fundingPeriodWindow([], null)).toEqual([]);
  });
});
