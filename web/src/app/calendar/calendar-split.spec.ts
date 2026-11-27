import { describe, expect, it } from 'vitest';
import { arrowTarget, daySelector, fallbackDaySelector, peekDetailsPlacement } from './calendar-grid-keys';
import { CalendarHighlights } from './calendar-highlights';
import { CalendarFormatEditor } from './calendar-format-editor';
import { CalendarEvent, CalendarFormat } from './calendar.models';

describe('règles de la grille', () => {
  it('déplace d’un jour ou d’une semaine, et saute aux jours à repères dans l’année', () => {
    const none = () => [];
    expect(arrowTarget('ArrowRight', '2026-11-30', 'month', none)).toBe('2026-12-01');
    expect(arrowTarget('ArrowUp', '2026-11-05', 'week', none)).toBe('2026-10-29');
    expect(arrowTarget('Enter', '2026-11-05', 'month', none)).toBeUndefined();
    const days = () => ['2026-03-02', '2026-01-10', '2026-06-01'];
    expect(arrowTarget('ArrowRight', '2026-01-10', 'year', days)).toBe('2026-03-02');
    expect(arrowTarget('ArrowLeft', '2026-03-02', 'year', days)).toBe('2026-01-10');
    expect(arrowTarget('ArrowDown', '2026-06-01', 'year', days)).toBeUndefined();
  });
  it('vise la case de l’année ou le numéro du jour', () => {
    expect(daySelector('year', '2026-01-02')).toBe('.calendar-year-day[data-day="2026-01-02"]');
    expect(daySelector('month', '2026-01-02')).toBe('.calendar-day[data-day="2026-01-02"] .calendar-day-number');
    expect(fallbackDaySelector('year')).toBe('.calendar-year-day.has-events');
    expect(fallbackDaySelector('week')).toBe('.calendar-day-number');
  });
  it('place le détail à droite de l’aperçu s’il y a la place, sinon à gauche, dans l’écran', () => {
    const viewport = { width: 1440, height: 900 };
    expect(peekDetailsPlacement({ left: 100, right: 400, top: 50 }, 1, viewport)).toEqual({ left: 410, top: 50, maxHeight: 838 });
    expect(peekDetailsPlacement({ left: 900, right: 1200, top: 800 }, 1, viewport)).toEqual({ left: 550, top: 680, maxHeight: 208 });
    expect(peekDetailsPlacement({ left: 10, right: 300, top: 0 }, 1, { width: 375, height: 700 }).left).toBe(12);
  });
});

describe('mise en évidence', () => {
  const events = [{ key: 'a', date: '2026-11-02' }, { key: 'b', date: '2026-11-02' }] as CalendarEvent[];
  it('garde les repères choisis, ajoute le survolé, et compte ceux d’un jour', () => {
    const h = new CalendarHighlights((day) => events.filter((e) => e.date === day));
    h.toggle('a');
    h.hover('b');
    expect([h.isPinned('a'), h.isPinned('b'), h.isHighlighted('b')]).toEqual([true, false, true]);
    expect(h.countIn('2026-11-02')).toBe(2);
    h.toggle('a');
    expect(h.isDayHighlighted('2026-11-02')).toBe(false);
    h.only('b');
    h.clear();
    expect(h.pinned().size).toBe(0);
  });
});

describe('éditeur de formats', () => {
  const standard = { id: 'standard', label: 'Standard', layout: 'list', fields: ['label', 'amount'], perCell: null } as unknown as CalendarFormat;
  it('crée un format à partir du format en cours, le choisit, puis le supprime', () => {
    const saved: CalendarFormat[][] = [];
    const chosen: string[] = [];
    let reset = 0;
    const editor: CalendarFormatEditor = new CalendarFormatEditor({
      formats: (): CalendarFormat[] => [standard, ...editor.own()],
      current: () => standard,
      allowed: () => true,
      chosen: () => chosen.at(-1),
      choose: (id) => chosen.push(id),
      resetChoice: () => reset++,
      changed: (next) => saved.push(next),
    });
    editor.edit();
    editor.update({ label: '  Montants  ' });
    editor.moveField('amount' as never, -1);
    editor.save();
    expect(editor.draft()).toBeNull();
    expect(editor.own()).toHaveLength(1);
    const id = editor.own()[0].id;
    expect(chosen).toEqual([id]);
    expect(editor.own()[0].fields.slice(0, 2)).toEqual(['amount', 'label']);
    editor.remove(id);
    expect([editor.own(), saved.length, reset]).toEqual([[], 2, 1]);
  });
  it('ne s’ouvre pas quand la configuration fige les champs', () => {
    const editor = new CalendarFormatEditor({
      formats: () => [standard], current: () => standard, allowed: () => false,
      chosen: () => undefined, choose: () => {}, resetChoice: () => {}, changed: () => {},
    });
    editor.edit();
    expect(editor.draft()).toBeNull();
  });
});
