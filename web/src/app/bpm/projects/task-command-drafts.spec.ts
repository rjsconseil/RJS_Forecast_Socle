import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import type { BpmTaskCard } from '../data/bpm-projects.models';
import { TaskCommandDrafts, type CommandEnvelope } from './task-command-drafts';

const card = (id: string, revision = 1, shareCents: number | null = 20000) =>
  ({ task: { id, revision, plannedHours: 10, spentHours: 2 }, budget: { shareCents } }) as unknown as BpmTaskCard;

function setup() {
  const task = signal<BpmTaskCard | null>(card('t1'));
  const envelope = signal<CommandEnvelope | null>({ revision: 3, allocationCents: 100000, regime: 'strict' });
  return { task, envelope, d: new TaskCommandDrafts(() => task(), () => envelope()) };
}

describe('brouillons du centre de commande', () => {
  it('lit les valeurs enregistrées tant qu’aucun brouillon n’existe', () => {
    const { d } = setup();
    expect(d.timeValues()).toEqual({ plannedHours: 10, spentHours: 2 });
    expect(d.sharePercent()).toBe(20);
    expect(d.shareAmount()).toBe(20000);
    expect(d.timeMax()).toBe(40);
  });

  it('garde un brouillon par tâche, arrondi, et ignore une valeur hors bornes', () => {
    const { d, task } = setup();
    d.changeTime('plannedHours', 12.3456);
    d.changeTime('spentHours', -1);
    expect(d.timeValues()).toEqual({ revision: 1, plannedHours: 12.35, spentHours: 2 });
    task.set(card('t2'));
    expect(d.timeDraft()).toBeNull();
    task.set(card('t1'));
    expect(d.timeDraft()?.plannedHours).toBe(12.35);
    d.resetTime();
    expect(d.timeDraft()).toBeNull();
  });

  it('une part se règle en pourcentage de l’enveloppe et se périme si l’enveloppe change', () => {
    const { d, envelope } = setup();
    d.changeShare(35);
    expect(d.shareAmount()).toBe(35000);
    expect(d.shareStale()).toBe(false);
    envelope.set({ revision: 4, allocationCents: 120000, regime: 'strict' });
    expect(d.shareStale()).toBe(true);
  });

  it('pas de part sans régime, sur un projet abandonné ou sans enveloppe', () => {
    const { d, envelope } = setup();
    envelope.set({ revision: 3, allocationCents: 100000, regime: 'strict', abandoned: { at: '2026-11-01' } });
    d.changeShare(10);
    envelope.set({ revision: 3, allocationCents: 0, regime: 'strict' });
    d.changeShare(10);
    expect(d.shareDraft()).toBeNull();
  });

  it('une tâche modifiée ailleurs rend le brouillon de temps périmé ; tout tombe au changement de projet', () => {
    const { d, task } = setup();
    d.changeTime('spentHours', 5);
    task.set(card('t1', 2));
    expect(d.timeStale()).toBe(true);
    d.changeShare(50);
    d.clear();
    expect(d.timeDraft()).toBeNull();
    expect(d.shareDraft()).toBeNull();
  });
});
