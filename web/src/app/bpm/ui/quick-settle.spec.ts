import { describe, expect, it } from 'vitest';
import { RegisterLine } from '../data/bpm-models';
import { isSettleable } from './quick-settle';

const line = (patch: Partial<RegisterLine>): RegisterLine => ({ kind: 'operation', settled: false, status: 'due', ...patch }) as RegisterLine;

describe('règlement en un geste', () => {
  it('se propose pour une échéance prévue, du jour ou en retard', () => {
    for (const status of ['pending', 'due', 'late'] as const) expect(isSettleable(line({ status }))).toBe(true);
    expect(isSettleable(line({ kind: 'occurrence', status: 'late' }))).toBe(true);
  });
  it('se propose aussi pour une échéance allégée, sans nature de ligne', () => {
    expect(isSettleable({ id: 'x', label: 'Loyer', direction: 'charge', settled: false, status: 'late' })).toBe(true);
  });
  it('ne se propose ni pour une ligne réglée, ni hors période ouverte, ni pour une charge spéciale de projet', () => {
    expect(isSettleable(line({ settled: true, status: 'settled' }))).toBe(false);
    expect(isSettleable(line({ status: 'unrealized' }))).toBe(false);
    expect(isSettleable(line({ kind: 'projectAllocation', status: 'project' }))).toBe(false);
    expect(isSettleable(line({ kind: 'projectOverrun', status: 'due' }))).toBe(false);
  });
});
