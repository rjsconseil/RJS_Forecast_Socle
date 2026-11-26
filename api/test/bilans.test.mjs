// Bilans des cycles : faits enregistrés à la clôture, coût des projets pour chaque cycle et pour le patrimoine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at, camille, key, makeSocle, operation, TODAY } from './helpers.mjs';

const P = (s) => s.modules.bpm.projects;
const B = (s) => s.modules.budget;

async function fixture() {
  const { socle: s } = await makeSocle();
  const { ctx } = await camille(s);
  // Septembre : un salaire, des courses, et un projet financé qui règle une dépense.
  await at('2026-09-02', () => operation(s, ctx, { direction: 'income', label: 'Salaire', amount: 2000, date: '2026-09-02' }));
  await at('2026-09-10', () => operation(s, ctx, { direction: 'charge', label: 'Courses', amount: 300, date: '2026-09-10', costCenterRef: 'std:alimentation' }));
  const p = await at('2026-09-05', () => P(s).createProject(ctx, { requestKey: key(), title: 'Cuisine', amount: 800 }));
  const t = await P(s).createTask(ctx, { requestKey: key(), title: 'Plan de travail', projectId: p.coreProjectId });
  await at('2026-09-20', () => B(s).createOperation(ctx, { requestKey: key(), budgetId: p.budgetId, taskId: t.task.id, direction: 'charge', label: 'Plan de travail', amount: 450, date: '2026-09-20', status: 'realized', costCenterRef: 'std:logement', fund: true }));
  return { s, ctx, p };
}

test('bilan : à la clôture, les faits et les faits marquants sont enregistrés, avec le coût des projets', async () => {
  const { s, ctx } = await fixture();
  for (const periodKey of ['2026-08', '2026-09']) await s.modules.bpm.closePeriod(ctx, { requestKey: key(), periodKey });
  const closure = Object.values(s.state.closures).find((c) => c.periodKey === '2026-09');
  const bilan = closure.bilan;
  assert.ok(bilan, 'le bilan est figé dans la clôture');
  assert.deepEqual([bilan.flows.receivedCents, bilan.flows.spentCents, bilan.patrimoine.capitalizedCents], [200000, 75000, 125000]);
  assert.equal(bilan.natures.find((n) => n.key === 'projet').paidCents, 45000);
  assert.deepEqual(bilan.projects.map((x) => [x.name, x.paidCents, x.allocatedInPeriod]), [['Cuisine', 45000, true]]);
  assert.equal(bilan.patrimoine.projectsCents, 45000);
  assert.deepEqual(bilan.projectCenters.map((c) => [c.ref, c.paidCents, c.projects]), [['std:logement', 45000, ['Cuisine']]]);
  assert.equal(bilan.patrimoine.stockAfterCents, bilan.patrimoine.stockBeforeCents + 125000);
  const kinds = bilan.highlights.map((x) => x.kind);
  for (const k of ['result', 'projects', 'allocation', 'biggest']) assert.ok(kinds.includes(k), k);
  assert.match(bilan.highlights.find((x) => x.kind === 'result').text, /versés au patrimoine/);

  // Le bilan enregistré ne change plus, même si les données bougent ensuite.
  const detail = s.modules.bpm.bilans.detail(ctx, '2026-09').bilan;
  assert.equal(detail.source, 'enregistré');
  assert.deepEqual(detail.flows, bilan.flows);
});

test('bilans : historique du plus récent au plus ancien, provisoire pour la période en cours, coût des projets par cycle', async () => {
  const { s, ctx } = await fixture();
  await s.modules.bpm.closePeriod(ctx, { requestKey: key(), periodKey: '2026-08' });
  await s.modules.bpm.closePeriod(ctx, { requestKey: key(), periodKey: '2026-09' });
  const list = s.modules.bpm.bilans.list(ctx);
  assert.deepEqual(list.bilans.map((x) => [x.period.key, x.status, x.source]), [
    ['2026-11', 'current', 'provisoire'],
    ['2026-10', 'ended', 'provisoire'],
    ['2026-09', 'closed', 'enregistré'],
    ['2026-08', 'closed', 'enregistré'],
  ]);
  assert.equal(list.totals.projectsClosedCents, 45000);
  const cuisine = list.projects.find((x) => x.name === 'Cuisine');
  assert.deepEqual(cuisine.cycles.map((c) => [c.periodKey, c.paidCents]), [['2026-09', 45000]]);
  assert.equal(cuisine.closedCents, 45000);
  assert.equal(TODAY, '2026-11-03');
  assert.equal(s.modules.bpm.bilans.detail(ctx, 'current').bilan.period.key, '2026-11');
});
