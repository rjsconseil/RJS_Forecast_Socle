import { TestBed } from '@angular/core/testing';
import { cents } from '../../core/format';
import { BpmCapGauge, capAlertText, capEuroText, capGaugeText, capInput, capTone, withCapAlerts } from './caps';

// Plafonds de dépenses : deux niveaux (centre, catégorie) lus indépendamment, jamais bloquants.
describe('plafonds de dépenses', () => {
  const m = (capCents: number | null, engagedCents: number) => ({
    capCents,
    engagedCents,
    marginCents: capCents === null ? null : capCents - engagedCents,
    usedPct: capCents ? Math.round((engagedCents / capCents) * 1000) / 10 : null,
    over: capCents !== null && engagedCents > capCents,
  });

  it('classe un niveau : sans plafond, dans le plafond, proche (≥ 85 %), dépassé', () => {
    expect(capTone(m(null, 5000))).toBe('none');
    expect(capTone(m(10000, 5000))).toBe('ok');
    expect(capTone(m(10000, 8500))).toBe('near');
    expect(capTone(m(10000, 10000))).toBe('near');
    expect(capTone(m(10000, 10001))).toBe('over');
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
    const alert = { level: 'category' as const, ref: 'std:loisirs', id: 'cat_1', label: 'Cinéma', capCents: 3000, engagedCents: 3500, overCents: 500 };
    expect(capAlertText(alert)).toBe(`catégorie « Cinéma » : ${cents(3500)} engagés pour un plafond de ${cents(3000)} (+${cents(500)})`);
    expect(withCapAlerts('Charge ajoutée.', [])).toBe('Charge ajoutée.');
    const msg = withCapAlerts('Charge ajoutée.', [alert, { ...alert, level: 'center', id: null, label: 'Loisirs' }]);
    expect(msg.startsWith('Charge ajoutée. Attention, plafond dépassé')).toBe(true);
    expect(msg).toContain('centre « Loisirs »');
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
