import { describe, expect, it } from 'vitest';
import { inRange, monthDays, periodLabel, rangeFrom, shiftPeriod, validDate, weekDays, yearMonths } from './calendar';

describe('calendrier miniature', () => {
  it('couvre un mois par six semaines commençant un lundi', () => {
    const days = monthDays('2026-11');
    expect(days).toHaveLength(42);
    expect(days[0]).toBe('2026-10-26');
    expect(days.indexOf('2026-11-01')).toBe(6);
    expect(days[41]).toBe('2026-12-06');
  });

  it('situe une semaine du lundi au dimanche et une année en douze mois', () => {
    expect(weekDays('2026-11-04')).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
    expect(yearMonths('2026-11-04').map((m) => m.key)).toEqual(
      Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`),
    );
  });

  it('avance et recule d’une période selon la vue', () => {
    expect(shiftPeriod('2026-11-04', 'week', 1)).toBe('2026-11-09');
    expect(shiftPeriod('2026-11-04', 'month', -1)).toBe('2026-10-01');
    expect(shiftPeriod('2026-01-31', 'month', 1)).toBe('2026-02-01');
    expect(shiftPeriod('2026-11-04', 'year', 1)).toBe('2027-01-01');
  });

  it('nomme la période affichée', () => {
    expect(periodLabel('2026-11-04', 'month')).toBe('Nov. 2026');
    expect(periodLabel('2026-11-04', 'year')).toBe('2026');
    expect(periodLabel('2026-11-04', 'week')).toBe('Semaine du 2 nov. au 8 nov.');
  });

  it('ne lit dans l’URL qu’un créneau de deux dates valides et ordonnées', () => {
    expect(rangeFrom('2026-11-01', '2026-11-30')).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(rangeFrom('2026-11-30', '2026-11-01')).toBeNull();
    expect(rangeFrom('2026-02-30', '2026-03-01')).toBeNull();
    expect(rangeFrom('2026-11-01', null)).toBeNull();
    expect(validDate('2026-11-04')).toBe(true);
    expect(validDate('04/11/2026')).toBe(false);
  });

  it('applique la règle du créneau : date de démarrage comprise, bornes incluses, sans date masquée', () => {
    const range = { start: '2026-11-01', end: '2026-11-30' };
    expect(inRange('2026-11-01', range)).toBe(true);
    expect(inRange('2026-11-30', range)).toBe(true);
    expect(inRange('2026-12-01', range)).toBe(false);
    expect(inRange(null, range)).toBe(false);
    expect(inRange(null, null)).toBe(true);
  });
});
