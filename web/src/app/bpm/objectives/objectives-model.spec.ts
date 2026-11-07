import { describe, expect, it } from 'vitest';
import { BpmProjection, LifeGoal } from '../../core/bpm-models';
import { objectiveRows, objectivesView } from './objectives-model';

const goal: LifeGoal = { id: 'g1', label: 'Études', type: 'etudes', date: '2030-09-01', targetTodayCents: 100000, removed: false, revision: 1 };
describe('lecture des objectifs', () => {
  it('distingue une couverture inconnue de zéro euro disponible', () => {
    expect(objectiveRows([goal], null, '2026-11-06')[0]).toMatchObject({ status: 'unknown', gapCents: null, meter: null });
    const projection = { goals: [{ goalId: 'g1', status: 'unfunded', nominalTargetCents: 110000, coveredCents: 0, coveragePct: 0 }] } as BpmProjection;
    expect(objectiveRows([goal], projection, '2026-11-06')[0]).toMatchObject({ status: 'unfunded', gapCents: 110000, meter: 0 });
  });
  it('sépare cible actuelle et manque nominal dans le scénario', () => {
    const projection = { goals: [{ goalId: 'g1', status: 'partial', nominalTargetCents: 120000, coveredCents: 60000, coveragePct: 50 }] } as BpmProjection;
    expect(objectiveRows([goal], projection, '2026-11-06')[0]).toMatchObject({ goal: { targetTodayCents: 100000 }, gapCents: 60000, meter: 50 });
  });
  it('une date dépassée ne signifie pas que l’objectif est réalisé', () => {
    const projection = { goals: [{ goalId: 'g1', status: 'funded', nominalTargetCents: 100000, coveredCents: 100000, coveragePct: 100 }] } as BpmProjection;
    expect(objectiveRows([{ ...goal, date: '2026-10-01' }], projection, '2026-11-06')[0]).toMatchObject({ overdue: true, statusLabel: 'Couvert dans le scénario' });
    expect(objectiveRows([{ ...goal, removed: true }], projection, '2026-11-06')).toEqual([]);
  });
  it('les liens directs ouvrent le bon espace malgré un ancien onglet dans l’URL', () => {
    expect(objectivesView('suivi', 'cap-patrimonial')).toBe('reperes');
    expect(objectivesView('suivi', 'hypotheses')).toBe('projection');
    expect(objectivesView('projection', 'life-dated-goals')).toBe('suivi');
    expect(objectivesView('inconnu', null)).toBe('suivi');
  });
});
