import { describe, expect, it } from 'vitest';
import {
  PRINCE2_LIVRABLES, PRINCE2_PROCESSUS, PRINCE2_THEMES, SEQUENCE, livrablesDuProcessus, livrablesDuTheme, processusDuTheme,
  reperePrince2, themePrince2, themesDuProcessus, type LivrableId,
} from './prince2';

describe('Mes projets · référentiel PRINCE2', () => {
  it('7 thèmes numérotés dans l’ordre, 7 processus, 29 livrables nommés en français et en anglais', () => {
    expect(PRINCE2_THEMES.map((t) => t.numero)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(PRINCE2_THEMES.map((t) => t.anglais)).toEqual(['Business Case', 'Organization', 'Quality', 'Plans', 'Risk', 'Change', 'Progress']);
    expect(PRINCE2_PROCESSUS.map((p) => p.id)).toEqual(SEQUENCE);
    expect(new Set(SEQUENCE).size).toBe(7);
    const all = Object.values(PRINCE2_LIVRABLES);
    expect(all).toHaveLength(29);
    for (const l of all) expect(l.nom && l.anglais, l.id).toBeTruthy();
  });

  it('chaque livrable cité par un thème ou un processus existe', () => {
    const known = new Set(Object.keys(PRINCE2_LIVRABLES));
    const cited: LivrableId[] = [...PRINCE2_PROCESSUS.flatMap((p) => p.livrables), ...PRINCE2_THEMES.flatMap((t) => [...t.livrables, ...t.usages.flatMap((u) => u.livrables)])];
    for (const id of cited) expect(known.has(id), id).toBe(true);
    // Chaque livrable sert au moins un thème.
    const used = new Set(PRINCE2_THEMES.flatMap((t) => livrablesDuTheme(t.id).map((l) => l.id)));
    expect([...known].filter((id) => !used.has(id))).toEqual([]);
  });

  it('les processus d’un thème suivent l’ordre de la séquence, numérotés depuis 1', () => {
    for (const t of PRINCE2_THEMES) {
      const steps = processusDuTheme(t.id);
      expect(steps.length, t.id).toBeGreaterThan(2);
      expect(steps.map((s) => s.etape)).toEqual(steps.map((_, i) => i + 1));
      const order = steps.map((s) => SEQUENCE.indexOf(s.processus.id));
      expect(order, t.id).toEqual([...order].sort((a, b) => a - b));
    }
    expect(processusDuTheme('risque').map((s) => s.processus.id)).toEqual(['SU', 'DP', 'IP', 'CS', 'SB']);
  });

  it('livrables d’un thème sans doublon, livrables d’un processus, thèmes d’un processus', () => {
    const progression = livrablesDuTheme('progression').map((l) => l.id);
    expect(new Set(progression).size).toBe(progression.length);
    expect(livrablesDuTheme('cas-affaire').map((l) => l.nom)).toContain('Cas d’affaire');
    expect(livrablesDuProcessus('SU').map((l) => l.anglais)).toContain('Project Brief');
    expect(themesDuProcessus('IP').length).toBe(6);
    expect(themePrince2('inconnu')).toBeNull();
    expect(livrablesDuTheme('inconnu' as never)).toEqual([]);
  });

  it('repère indicatif d’un projet, lu dans son état', () => {
    expect(reperePrince2({ status: 'planned', taskCount: 0 }).processus).toBe('SU');
    expect(reperePrince2({ status: 'planned', taskCount: 2 }).processus).toBe('IP');
    expect(reperePrince2({ status: 'active', taskCount: 2 }).processus).toBe('CS');
    expect(reperePrince2({ status: 'paused', taskCount: 2 }).processus).toBe('SB');
    expect(reperePrince2({ status: 'toFinish', taskCount: 2 }).processus).toBe('CP');
    expect(reperePrince2({ status: 'done', taskCount: 2 })).toEqual({ processus: null, label: 'Projet clos' });
  });
});
