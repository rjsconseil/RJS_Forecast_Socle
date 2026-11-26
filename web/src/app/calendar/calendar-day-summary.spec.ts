import { describe, expect, it } from 'vitest';
import { dayMostlyDone, dayNeedsAttention, dayNetAmount, dominantElement, formatDraftOf, moveDraftField, saveDraftInto, toggleDraftField } from './calendar-day-summary';
import { CalendarEvent, CalendarFormat } from './calendar.models';

const ev = (over: Partial<CalendarEvent>) => ({ key: Math.random().toString(), element: 'a', done: false, amountCents: null, direction: null, ...over }) as unknown as CalendarEvent;
const fmt = (over: Partial<CalendarFormat> = {}) => ({ id: 'standard', label: 'Standard', layout: 'list', fields: ['title', 'amount'], perCell: 3, builtIn: true, own: false, ...over }) as unknown as CalendarFormat;

describe('lecture d’une journée du calendrier', () => {
  it('total signé des flux, sans flux : rien', () => {
    expect(dayNetAmount([ev({ amountCents: 1000, direction: 'entree' }), ev({ amountCents: 2500, direction: 'sortie' })])?.sign).toBe('negative');
    expect(dayNetAmount([ev({ amountCents: 500, direction: 'entree' })])?.sign).toBe('positive');
    expect(dayNetAmount([ev({})])).toBeNull();
  });
  it('attention : un retard ou cinq repères à faire ; plutôt faite : autant de faits que d’autres', () => {
    expect(dayNeedsAttention([ev({ urgent: 'overdue' } as Partial<CalendarEvent>)])).toBe(true);
    expect(dayNeedsAttention(Array.from({ length: 4 }, () => ev({})))).toBe(false);
    expect(dayNeedsAttention(Array.from({ length: 5 }, () => ev({})))).toBe(true);
    expect(dayMostlyDone([ev({ done: true }), ev({})])).toBe(true);
    expect(dayMostlyDone([ev({ done: true }), ev({}), ev({})])).toBe(false);
    expect(dayMostlyDone([])).toBe(false);
  });
  it('élément dominant : le plus présent', () => {
    expect(dominantElement([ev({ element: 'a' }), ev({ element: 'b' }), ev({ element: 'b' })])).toBe('b');
    expect(dominantElement([])).toBeUndefined();
  });
});

describe('brouillon d’un format d’affichage', () => {
  it('nouveau format depuis celui en cours ; modification d’un format à soi', () => {
    expect(formatDraftOf(null, fmt())).toMatchObject({ id: null, label: 'Mon format', fields: ['title', 'amount'] });
    expect(formatDraftOf(fmt({ id: 'mien', label: 'Le mien', own: true }), fmt())).toMatchObject({ id: 'mien', label: 'Le mien' });
  });
  it('champs : ajout, retrait, ordre (sans effet aux bords)', () => {
    const d = formatDraftOf(null, fmt());
    expect(toggleDraftField(d, 'title' as never).fields).toEqual(['amount']);
    expect(toggleDraftField(d, 'total' as never).fields).toEqual(['title', 'amount', 'total']);
    expect(moveDraftField(d, 'amount' as never, -1).fields).toEqual(['amount', 'title']);
    expect(moveDraftField(d, 'title' as never, -1)).toBe(d);
  });
  it('enregistrement : ajout, ou remplacement du format modifié', () => {
    const own = [fmt({ id: 'mien', label: 'Le mien', own: true, builtIn: false })];
    expect(saveDraftInto(own, { ...formatDraftOf(null, fmt()), label: ' Autre ' }, 'autre').map((f) => f.label)).toEqual(['Le mien', 'Autre']);
    expect(saveDraftInto(own, { ...formatDraftOf(own[0], fmt()), label: 'Renommé' }, 'mien').map((f) => f.label)).toEqual(['Renommé']);
  });
});
