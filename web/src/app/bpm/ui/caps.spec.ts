import { TestBed } from '@angular/core/testing';
import { cents } from '../../core/format';
import { BpmCapGauge, capAlertText, capEuroText, capGaugeText, capInput, capLevel, capLevelLegend, withCapAlerts } from './caps';

/** Seuils rendus par Budget (`levels` des lectures) : les tests les reçoivent comme le site. */
const LEVELS = { mid: 50, high: 75, near: 90 };

// Plafonds de dépenses : un plafond par poste, jamais bloquant.
describe('plafonds de dépenses', () => {
  const m = (capCents: number | null, engagedCents: number) => ({
    capCents,
    engagedCents,
    marginCents: capCents === null ? null : capCents - engagedCents,
    usedPct: capCents ? Math.round((engagedCents / capCents) * 1000) / 10 : null,
    over: capCents !== null && engagedCents > capCents,
    near: capCents !== null && engagedCents <= capCents && engagedCents >= capCents * 0.9,
    level: capLevel({ capCents, engagedCents }, LEVELS),
  });

  it('colore selon le niveau consommé : vert < 50 %, bleu 50–75 %, jaune 75–90 %, orange 90–100 %, rouge au-delà', () => {
    expect(capLevel(m(null, 5000), LEVELS)).toBe('none');
    expect(capLevel(m(10000, 0), LEVELS)).toBe('low');
    expect(capLevel(m(10000, 4999), LEVELS)).toBe('low');
    expect(capLevel(m(10000, 5000), LEVELS)).toBe('mid');
    expect(capLevel(m(10000, 7499), LEVELS)).toBe('mid');
    expect(capLevel(m(10000, 7500), LEVELS)).toBe('high');
    expect(capLevel(m(10000, 8999), LEVELS)).toBe('high');
    expect(capLevel(m(10000, 9000), LEVELS)).toBe('near');
    expect(capLevel(m(10000, 10000), LEVELS)).toBe('near');
    expect(capLevel(m(10000, 10001), LEVELS)).toBe('over');
    // Les seuils viennent de Budget : d'autres seuils donnent d'autres couleurs, la légende les reprend.
    expect(capLevel(m(10000, 8000), { mid: 40, high: 60, near: 80 })).toBe('near');
    expect(capLevelLegend(LEVELS).map((l) => l.label)).toEqual(['Moins de 50 %', '50 à 75 %', '75 à 90 %', '90 à 100 %', 'Au-delà de 100 %']);
  });

  it('lit la saisie en euros : vide = sans plafond, invalide refusé', () => {
    expect(capInput('')).toBeNull();
    expect(capInput(' 120,50 € ')).toBe(120.5);
    expect(capInput('1 250')).toBe(1250);
    expect(capInput('0')).toBeUndefined();
    expect(capInput('-3')).toBeUndefined();
    expect(capInput('abc')).toBeUndefined();
    expect(capEuroText(12050)).toBe('120,5');
    expect(capEuroText(null)).toBe('');
  });

  it('annonce la marge ou le dépassement, et garde l’action enregistrée', () => {
    expect(capGaugeText(m(null, 0))).toBe('Sans plafond');
    expect(capGaugeText(m(10000, 2500))).toBe(`Reste ${cents(7500)} sur ${cents(10000)}`);
    expect(capGaugeText(m(10000, 11500))).toBe(`Dépassé de ${cents(1500)} · plafond ${cents(10000)}`);
    const alert = { level: 'center' as const, ref: 'std:loisirs', id: null, label: 'Loisirs', capCents: 3000, engagedCents: 3500, overCents: 500 };
    expect(capAlertText(alert)).toBe(`poste « Loisirs » : ${cents(3500)} engagés pour un plafond de ${cents(3000)} (+${cents(500)})`);
    expect(withCapAlerts('Charge ajoutée.', [])).toBe('Charge ajoutée.');
    const msg = withCapAlerts('Charge ajoutée.', [alert]);
    expect(msg.startsWith('Charge ajoutée. Attention, plafond dépassé')).toBe(true);
    expect(msg).toContain('poste « Loisirs »');
    expect(msg.endsWith('La dépense est bien enregistrée.')).toBe(true);
  });

  it('jauge : rouge au-delà du plafond, barre bornée à 100 %', () => {
    const f = TestBed.createComponent(BpmCapGauge);
    f.componentRef.setInput('measure', m(10000, 11500));
    f.componentRef.setInput('label', 'Plafond du poste');
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.cap-gauge')!.getAttribute('data-tone')).toBe('over');
    expect((el.querySelector('.cap-gauge-bar > span') as HTMLElement).style.width).toBe('100%');
    expect(el.textContent).toContain('Plafond du poste');
    f.componentRef.setInput('measure', m(null, 0));
    f.detectChanges();
    expect(el.querySelector('.cap-gauge-bar')).toBeNull();
    expect(el.textContent).toContain('Sans plafond');
  });
});
