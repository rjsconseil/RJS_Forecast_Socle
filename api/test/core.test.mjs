// T-NOY-01 / T-NOY-03 : table de cas métier (oracle écrit à la main, pas une copie de l'algorithme).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveProjectStatus, completionPercent, timeAggregates, explainProjectStatus } from '../src/modules/core/rules.mjs';

const CASES = [
  [[], 'planned', 'todo'],
  [['todo'], 'planned', 'todo'],
  [['todo', 'todo'], 'planned', 'todo'],
  [['doing'], 'active', 'doing'],
  [['doing', 'todo'], 'active', 'doing'],
  [['doing', 'blocked'], 'active', 'doing'],
  [['done'], 'done', 'done'],
  [['done', 'done'], 'done', 'done'],
  [['blocked'], 'paused', 'blocked'],
  [['blocked', 'todo'], 'paused', 'blocked'],
  [['done', 'todo'], 'onHold', 'todo'],
  [['done', 'todo', 'todo'], 'onHold', 'todo'],
  [['done', 'blocked'], 'toResume', 'blocked'],
  [['done', 'blocked', 'todo'], 'toResume', 'blocked'],
  [['done', 'doing'], 'toFinish', 'doing'],
  [['done', 'doing', 'blocked', 'todo'], 'toFinish', 'doing'],
];

const COLUMN = { planned: 'todo', onHold: 'todo', active: 'doing', toFinish: 'doing', done: 'done', paused: 'blocked', toResume: 'blocked' };

for (const [statuses, expected, column] of CASES) {
  test(`état projet [${statuses.join(', ') || 'vide'}] → ${expected} (${column})`, () => {
    const s = deriveProjectStatus(statuses);
    assert.equal(s, expected);
    assert.equal(COLUMN[s], column);
  });
}

test('les sept états projet sont atteints par la table', () => {
  assert.equal(new Set(CASES.map((c) => c[1])).size, 7);
});

test('complétude : terminées / total, arrondi, 0 % si vide', () => {
  assert.equal(completionPercent([]), 0);
  assert.equal(completionPercent(['done', 'doing']), 50);
  assert.equal(completionPercent(['done', 'doing', 'todo']), 33);
  assert.equal(completionPercent(['done', 'done']), 100);
});

test('temps : somme des estimations connues, couverture et consommé', () => {
  const a = timeAggregates([
    { plannedHours: 10, spentHours: 4 },
    { plannedHours: 5, spentHours: 5 },
    { plannedHours: null, spentHours: 2 },
  ]);
  assert.equal(a.plannedHoursKnown, 15);
  assert.equal(a.estimatedTaskCount, 2);
  assert.equal(a.missingEstimateCount, 1);
  assert.equal(a.plannedIsPartial, true);
  assert.equal(a.spentHoursTotal, 11);
  assert.equal(a.spentToPlannedPercent, null, 'pas de rapport sur une estimation partielle');
});

test('temps : décimales exactes et projet vide', () => {
  assert.equal(timeAggregates([{ plannedHours: 0.1, spentHours: 0.2 }, { plannedHours: 0.2, spentHours: 0.1 }]).plannedHoursKnown, 0.3);
  const empty = timeAggregates([]);
  assert.equal(empty.plannedHoursKnown, 0);
  assert.equal(empty.spentHoursTotal, 0);
  assert.equal(empty.spentToPlannedPercent, null);
});

test('explication lisible', () => {
  assert.equal(explainProjectStatus(['done', 'doing'], 'toFinish'), '1 tâche terminée, 1 tâche en cours : À finir');
  assert.equal(explainProjectStatus([], 'planned'), 'Aucune tâche : À faire');
});
