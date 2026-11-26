import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at, camille, key, makeSocle, makeUser, operation } from './helpers.mjs';

async function fixture(t, source = 'cycle') {
  const { socle: s } = await makeSocle(); t.after(() => s.close());
  const { ctx } = await camille(s);
  const p = await at('2026-09-01', () => s.modules.bpm.projects.createProject(ctx, { requestKey: key(), title: 'Cuisine', amount: 1000, fundingSource: source }));
  const task = await s.modules.bpm.projects.createTask(ctx, { requestKey: key(), title: 'Installer', projectId: p.coreProjectId, plannedHours: 10 });
  await s.modules.bpm.projects.setTaskShare(ctx, p.budgetId, task.task.id, { expectedRevision: s.state.budgets[p.budgetId].revision, amount: 1000 });
  const input = { budgetId: p.budgetId, taskId: task.task.id, direction: 'charge', label: 'Matériel', amount: 100, date: '2026-10-10', realizedDate: '2026-10-20', accountingDate: '2026-11-02', status: 'realized', costCenterRef: 'std:logement' };
  const create = changes => s.modules.budget.createEntry(ctx, { ...input, ...changes, requestKey: key() });
  return { s, ctx, p, task, input, create, reads: s.modules.bpm.reads };
}

test('projets : cycle annoncé et cycle payé gardent la trace ; seul le cycle imputé compte le flux', async t => {
  const { s, ctx, create, reads, p, task } = await fixture(t);
  await create({ date: '2026-09-20' });
  const rev = s.state.revision;
  const sept = reads.projectFlows(ctx, { period: '2026-09' });
  const oct = reads.projectFlows(ctx, { period: '2026-10' });
  const nov = reads.projectFlows(ctx, { period: '2026-11' });
  assert.equal(sept.totals.paidCents, 0); assert.equal(sept.announcementTrace.length, 1); assert.equal(sept.paymentTrace.length, 0);
  assert.equal(oct.totals.paidCents, 0); assert.equal(oct.paymentTrace.length, 1);
  assert.equal(nov.totals.paidCents, 10000); assert.equal(nov.lines[0].project.coreProjectId, p.coreProjectId); assert.equal(nov.lines[0].taskId, task.task.id);
  assert.equal(reads.register(ctx, { period: '2026-09' }).announcementTrace.length, 1);
  for (const periodKey of ['2026-08', '2026-09']) await s.modules.bpm.closePeriod(ctx, { requestKey: key(), periodKey });
  assert.equal(s.modules.bpm.bilans.detail(ctx, '2026-09').bilan.announcementTrace.length, 1);
  assert.equal(s.state.revision, rev + 2, 'les seules écritures sont les deux clôtures');
});

test('aperçu : patrimoine immédiatement débité, cycle inchangé, aucune écriture', async t => {
  const { s, ctx, input, reads, create } = await fixture(t, 'patrimoine');
  const revision = s.state.revision;
  const preview = reads.previewEntry(ctx, input);
  assert.equal(preview.source, 'patrimoine');
  assert.equal(preview.after.netCents, preview.before.netCents);
  assert.equal(preview.after.stockCents, preview.before.stockCents - 10000);
  assert.equal(s.state.revision, revision);
  await create({});
  assert.equal(reads.summary(ctx).figures['bpm.patrimoineDisponible'].valueCents, preview.after.stockCents);
  assert.equal(reads.projectFlows(ctx, { source: 'patrimoine' }).totals.netCents, -10000);
  assert.equal(reads.projectFlows(ctx, { source: 'cycle' }).totals.count, 0);
});

test('aperçu : le cycle d’imputation est celui de la validation, pas celui de l’ouverture du formulaire', async t => {
  const { ctx, input, reads } = await fixture(t);
  const preview = reads.previewEntry(ctx, { ...input, accountingDate: '2026-10-22' });
  assert.equal(preview.context.period.key, '2026-10');
  assert.equal(preview.after.netCents, preview.before.netCents - 10000);
});

test('prévisions : tâches, quotidien et patrimoine séparés, sans double compte à la validation ni à la clôture', async t => {
  const { s, ctx, reads, create } = await fixture(t);
  await operation(s, ctx, { direction: 'income', amount: 1000, date: '2026-11-02' });
  await operation(s, ctx, { direction: 'income', amount: 200, date: '2026-10-02' });
  await create({ date: '2026-11-10', status: 'planned' });
  const wealth = await at('2026-09-01', () => s.modules.bpm.projects.createProject(ctx, { requestKey: key(), title: 'Voyage', amount: 500, fundingSource: 'patrimoine' }));
  const wt = await s.modules.bpm.projects.createTask(ctx, { requestKey: key(), title: 'Billets', projectId: wealth.coreProjectId });
  await create({ budgetId: wealth.budgetId, taskId: wt.task.id, date: '2026-11-12', amount: 50, status: 'planned' });
  let forecast = reads.financialOutlook(ctx);
  assert.equal(forecast.waitingCents, 20000);
  const cycle = forecast.cycles[0];
  assert.equal(cycle.actualCents, 100000);
  assert.equal(cycle.expectedCents, 90000);
  assert.equal(cycle.wealthChargeCents, 5000);
  assert.equal(cycle.stockAfterCents, 1305000);
  assert.deepEqual(cycle.projects.map(x => [x.name, x.cycleCents, x.patrimoineCents]), [['Cuisine', -10000, 0], ['Voyage', 0, -5000]]);
  const pending = forecast.pending.find(l => l.project.name === 'Cuisine');
  await s.modules.budget.realizeOperation(ctx, pending.operationId, { expectedRevision: pending.revision, realizedDate: '2026-11-03', accountingDate: '2026-11-03' });
  forecast = reads.financialOutlook(ctx);
  assert.equal(forecast.cycles[0].actualCents, 90000);
  assert.equal(forecast.cycles[0].projectChargeCents, 0);
  assert.equal(forecast.cycles[0].stockAfterCents, 1305000);
  for (const periodKey of ['2026-08', '2026-09', '2026-10']) await s.modules.bpm.closePeriod(ctx, { requestKey: key(), periodKey });
  forecast = reads.financialOutlook(ctx);
  assert.equal(forecast.waitingCents, 0);
  assert.equal(forecast.cycles[0].stockAfterCents, 1305000);
});

test('lectures : gains positifs, annulations exclues, isolement entre utilisateurs et patrimoine sans cycle', async t => {
  const { s, ctx, reads, create } = await fixture(t, 'patrimoine');
  const expense = await create({});
  await create({ direction: 'income', costCenterRef: 'std:autresRevenus', amount: 30, label: 'Remboursement' });
  assert.deepEqual([reads.projectFlows(ctx, { source: 'patrimoine' }).totals.paidCents, reads.projectFlows(ctx, { source: 'patrimoine' }).totals.netCents], [10000, -7000]);
  await s.modules.budget.cancelOperation(ctx, expense.operation.id, { expectedRevision: expense.operation.revision });
  assert.equal(reads.projectFlows(ctx, { source: 'patrimoine' }).totals.netCents, 3000);
  const other = await makeUser(s, { openingStock: 500 });
  assert.deepEqual(reads.projectFlows(other.ctx, { source: 'all' }).lines, []);
  assert.equal(reads.financialOutlook(other.ctx).stockCents, 50000);
  assert.deepEqual(reads.financialOutlook(other.ctx).cycles, []);
});
