import { describe, expect, it } from 'vitest';
import { bpmCompanion, companionQuery, BPM_COMPANIONS } from './compass-model';
import { BPM_SCREEN_WORKSPACES } from '../bpm.screens';
import { postingCycle } from './posting-impact';

describe('repères transverses BPM', () => {
  it('couvre chaque sous-page de travail, sans ajouter de commande aux liens de lecture', () => {
    for (const w of BPM_SCREEN_WORKSPACES) {
      if (w.path.startsWith('creer/')) continue;
      expect(bpmCompanion('/' + w.path.replace(':id', 'prj_test')), w.path).toBeTruthy();
    }
    for (const c of Object.values(BPM_COMPANIONS)) expect(c.links.length).toBeGreaterThan(0);
  });
  it('transmet seulement la période utile et laisse les commandes dans leur page', () => {
    expect(companionQuery({label:'Cycle',path:'/projet-de-vie/cloture',period:true},{period:'2026-10',entry:'new',task:'x'})).toEqual({period:'2026-10'});
    expect(companionQuery({label:'Stock',path:'/vision'},{period:'2026-10',entry:'new'})).toEqual({});
  });
  it('situe les dates dans les cycles ancrés, y compris les mois courts', () => {
    expect(postingCycle('2026-11-05',15)).toBe('octobre 2026');
    expect(postingCycle('2026-11-15',15)).toBe('novembre 2026');
    expect(postingCycle('2026-02-28',31)).toBe('février 2026');
    expect(postingCycle('2026-02-30',1)).toBeNull();
    expect(postingCycle('2026-11-05',null)).toBeNull();
  });
});
