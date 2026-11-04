import { describe, expect, it } from 'vitest';
import { CalendarElement, CalendarEvent } from './calendar.models';
import { dayStats, detailRows, formatAmount, groupByDay, groupsOf, periodSummary, toneColor } from './calendar-model';
import { gridWindow, periodBounds } from './calendar-dates';

const element = (id: string, nature: string, marker: CalendarElement['marker'], names: [string, string]): CalendarElement => ({
  id,
  label: id,
  nature,
  tone: 'bleu',
  marker,
  visible: true,
  objectLabel: { one: names[0], many: names[1] },
  hover: [],
  reschedulable: false,
});

const event = (partial: Partial<CalendarEvent> & Pick<CalendarEvent, 'element' | 'nature' | 'objectId'>): CalendarEvent => ({
  key: `${partial.element}:${partial.objectId}:${partial.date ?? '2026-11-12'}`,
  revision: 1,
  date: '2026-11-12',
  title: partial.objectId,
  done: false,
  status: null,
  statusLabel: null,
  urgent: null,
  groupId: null,
  groupLabel: null,
  amountCents: null,
  direction: null,
  link: null,
  details: [],
  reschedule: null,
  ...partial,
});

const ELEMENTS = [
  element('projet-debut', 'coreProject', 'start', ['projet', 'projets']),
  element('tache-echeance', 'task', 'due', ['tâche', 'tâches']),
  element('depense', 'operation', 'point', ['dépense', 'dépenses']),
];

describe('module Calendrier : lecture des repères', () => {
  it('montre les montants signés selon leur sens', () => {
    const plain = (s: string) => s.replace(/[  ]/g, ' ');
    expect(plain(formatAmount(8000, 'sortie'))).toBe('−80,00 €');
    expect(plain(formatAmount(250000, 'entree'))).toBe('+2 500,00 €');
    expect(plain(formatAmount(-1500))).toBe('−15,00 €');
    expect(toneColor('rouge')).toBe('var(--red-600)');
    expect(toneColor('inconnue')).toBe('var(--blue-600)');
  });

  it('résume une journée selon les indicateurs paramétrés', () => {
    const events = [
      event({ element: 'projet-debut', nature: 'coreProject', objectId: 'p1' }),
      event({ element: 'tache-echeance', nature: 'task', objectId: 't1', urgent: 'overdue' }),
      event({ element: 'tache-echeance', nature: 'task', objectId: 't2', done: true }),
      event({ element: 'depense', nature: 'operation', objectId: 'o1', amountCents: 8000, direction: 'sortie', done: true }),
    ];
    const stats = dayStats(events, ELEMENTS, [
      { key: 'elements', label: 'Éléments' },
      { key: 'dates', label: 'Dates' },
      { key: 'suivi', label: 'Suivi' },
      { key: 'solde', label: 'Solde' },
    ]);
    expect(stats.map((s) => s.key)).toEqual(['elements', 'dates', 'suivi', 'solde']);
    expect(stats[0].lines.map((l) => l.text)).toEqual(['1 projet', '2 tâches', '1 dépense']);
    expect(stats[1].lines.map((l) => l.text)).toEqual(['1 début', '2 échéances']);
    expect(stats[1].lines[1].tone).toBe('alert');
    expect(stats[2].lines.map((l) => l.text)).toEqual(['2 à suivre', '2 terminés']);
    expect(stats[3].lines[0].text.replace(/[  ]/g, ' ')).toBe('−80,00 € solde');
    expect(stats[3].lines[1].text).toBe('1/1 réglés');
  });

  it('détaille un indicateur, regroupe par jour, par regroupement et pour la période', () => {
    const events = [
      event({ element: 'depense', nature: 'operation', objectId: 'o1', date: '2026-11-02', amountCents: 2000, direction: 'sortie', groupId: 'b1', groupLabel: 'Budget du projet de vie' }),
      event({ element: 'depense', nature: 'operation', objectId: 'o2', date: '2026-11-02', amountCents: 500, direction: 'entree', groupId: 'b1', groupLabel: 'Budget du projet de vie' }),
      event({ element: 'tache-echeance', nature: 'task', objectId: 't1', date: '2026-11-05', groupLabel: 'Sans projet' }),
    ];
    expect([...groupByDay(events).keys()]).toEqual(['2026-11-02', '2026-11-05']);
    expect(detailRows(events, ELEMENTS, 'suivi').map((r) => r.label)).toEqual(['À suivre ·', 'À suivre ·', 'À suivre ·']);
    expect(groupsOf(events).map((g) => [g.label, g.events.length])).toEqual([
      ['Budget du projet de vie', 2],
      ['Sans projet', 1],
    ]);
    const summary = periodSummary(events, ELEMENTS);
    expect([summary.markers, summary.inCents, summary.outCents, summary.netCents, summary.hasAmounts]).toEqual([3, 500, 2000, -1500, true]);
  });

  it('lit la bonne fenêtre pour chacune des trois vues', () => {
    expect(gridWindow('2026-11-04', 'month')).toEqual({ start: '2026-10-26', end: '2026-12-06' });
    expect(gridWindow('2026-11-04', 'week')).toEqual({ start: '2026-11-02', end: '2026-11-08' });
    expect(gridWindow('2026-11-04', 'year')).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(periodBounds('2026-02-10', 'month')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });
});
