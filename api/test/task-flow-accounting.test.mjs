import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at, camille, key, makeSocle } from './helpers.mjs';

async function setup() {
  const { socle: s } = await makeSocle();
  const { ctx } = await camille(s);
  const p = await at('2026-09-01', () => s.modules.bpm.projects.createProject(ctx, { requestKey: key(), title: 'Cuisine', amount: 1000 }));
  const t = await s.modules.bpm.projects.createTask(ctx, { requestKey: key(), title: 'Poser le plan', projectId: p.coreProjectId, plannedHours: 10 });
  await s.modules.bpm.projects.setTaskShare(ctx, p.budgetId, t.task.id, { expectedRevision: s.state.budgets[p.budgetId].revision, amount: 1000 });
  const create = (input = {}) => s.modules.budget.createOperation(ctx, { requestKey: key(), budgetId: p.budgetId, taskId: t.task.id, direction: 'charge', label: 'Plan de travail', amount: 100, date: '2026-09-20', realizedDate: '2026-09-20', accountingDate: '2026-10-02', fundingSource: 'cycle', status: 'realized', costCenterRef: 'std:logement', fund: true, ...input });
  const value = (metric, periodKey) => s.modules.bpm.figure(ctx, metric, { periodKey }).value;
  return { s, ctx, p, t, create, value };
}

test('paiement septembre, imputation octobre : trace bancaire séparée, charge comptée une fois et bilan conservé', async t => {
  const { s, ctx, p, create, value } = await setup(); t.after(() => s.close());
  const op = await create();
  assert.equal(value('bpm.charges', '2026-09'), 0);
  assert.equal(value('bpm.charges', '2026-10'), 100);
  const sept = s.modules.bpm.reads.register(ctx, { period: '2026-09', dateBasis: 'realized' });
  assert.equal(sept.totals.paidCents, 0);
  assert.equal(sept.lines.length, 0);
  assert.equal(sept.paymentTrace.length, 1);
  assert.equal(sept.paymentTrace[0].accountingDate, '2026-10-02');
  assert.equal(sept.paymentTrace[0].realizedDate, '2026-09-20');
  const oct = s.modules.bpm.reads.register(ctx, { period: '2026-10', dateBasis: 'realized' });
  assert.equal(oct.lines.filter(l => l.budgetId === p.budgetId).length, 1);
  assert.equal(oct.totals.paidCents, 10000);
  assert.deepEqual(oct.paymentTrace, []);
  const detail = s.modules.bpm.reads.lineDetail(ctx, op.operation.id);
  assert.equal(detail.timing.realizedPeriod.key, '2026-09');
  assert.equal(detail.timing.accountingPeriod.key, '2026-10');
  for (const periodKey of ['2026-08', '2026-09']) await s.modules.bpm.closePeriod(ctx, { requestKey: key(), periodKey });
  const bilan = s.modules.bpm.bilans.detail(ctx, '2026-09').bilan;
  assert.equal(bilan.flows.spentCents, 0);
  assert.equal(bilan.paymentTrace.length, 1);
  assert.ok(bilan.highlights.some(h => h.kind === 'payment-trace'));
});

test('un projet peut valider des dépenses au cycle et au patrimoine, avec gains dans leur sens réel', async t => {
  const { s, ctx, p, create, value } = await setup(); t.after(() => s.close());
  await create();
  await create({ label: 'Service payé sur patrimoine', amount: 50, fundingSource: 'patrimoine' });
  await create({ label: 'Vente du matériel', amount: 20, direction: 'income', costCenterRef: 'std:autresRevenus' });
  assert.equal(value('bpm.charges', '2026-10'), 100);
  assert.equal(value('bpm.revenus', '2026-10'), 20);
  assert.equal(value('bpm.prelevementsProjets', '2026-10'), 50);
  const reg = s.modules.bpm.reads.register(ctx, { period: '2026-10', dateBasis: 'realized' });
  assert.equal(reg.lines.find(l => l.label === 'Vente du matériel').direction, 'income');
  assert.equal(reg.lines.some(l => l.label === 'Service payé sur patrimoine'), false);
  assert.equal(reg.totals.netSettledCents, -8000);
  const bilan = s.modules.bpm.bilans.detail(ctx, '2026-10').bilan;
  assert.equal(bilan.patrimoine.projectsCents, 8000);
  assert.equal(bilan.patrimoine.withdrawnCents, 5000);
  assert.deepEqual(bilan.projects.filter(x => x.budgetId === p.budgetId).map(x => [x.fundingSource, x.paidCents]).sort(), [['cycle', 8000], ['patrimoine', 5000]]);
});


test('validation patrimoine : stock disponible immédiatement diminué, cycle et stock avant période inchangés', async t => {
  const { s, ctx, p, create, value } = await setup(); t.after(() => s.close());
  assert.equal(value('bpm.patrimoineDisponible', '2026-11'), 12000);
  await create({ label: 'Service hors cycle', amount: 50, fundingSource: 'patrimoine', accountingDate: '2026-11-03', realizedDate: '2026-11-03' });
  assert.equal(value('bpm.patrimoineDisponible', '2026-11'), 11950);
  assert.equal(value('bpm.patrimoineConstitue', '2026-11'), 12000);
  assert.equal(value('bpm.charges', '2026-11'), 0);
  assert.equal(s.modules.bpm.reads.summary(ctx).figures['bpm.patrimoineDisponible'].valueCents, 1195000);
  assert.equal(s.modules.bpm.life.lifeManagement(ctx).patrimoine.stockCents, 1195000);
  const life = s.modules.bpm.projects.overview(ctx).lifeProject;
  assert.equal(life.budget.life.patrimoine.stockCents, 1195000);
  assert.equal(s.modules.bpm.bilans.detail(ctx, '2026-11').bilan.patrimoine.stockBeforeCents, 1200000);
});

test('source choisie sur l’enveloppe du projet : une tâche qui règle une dépense sans préciser la source impute cette source', async t => {
  const { s, ctx, p, create, value } = await setup(); t.after(() => s.close());
  // Sur la fiche du projet : l'enveloppe est financée par le patrimoine.
  await s.modules.bpm.projects.allocate(ctx, p.budgetId, { amount: 1000, fundingSource: 'patrimoine', expectedRevision: s.state.budgets[p.budgetId].revision });
  assert.equal(s.state.budgets[p.budgetId].fundingSource, 'patrimoine');
  const stock = value('bpm.patrimoineDisponible', '2026-10');
  // Dépense de la tâche réglée sans source : elle va au patrimoine, pas au cycle.
  await create({ label: 'Plan de travail', amount: 100, fundingSource: undefined });
  assert.equal(value('bpm.charges', '2026-10'), 0);
  assert.equal(value('bpm.prelevementsProjets', '2026-10'), 100);
  assert.equal(value('bpm.patrimoineDisponible', '2026-10'), stock - 100);
  // Dépense prévue puis réglée plus tard, toujours sans source : même imputation.
  const planned = await create({ label: 'Évier', amount: 40, status: 'planned', realizedDate: undefined, accountingDate: undefined, fundingSource: undefined, date: '2026-10-10' });
  const op = s.state.operations[planned.operation.id];
  await s.modules.budget.realizeOperation(ctx, op.id, { expectedRevision: op.revision, realizedDate: '2026-10-12', accountingDate: '2026-10-12', fund: true });
  assert.equal(s.state.operations[op.id].fundingSource, 'patrimoine');
  assert.equal(value('bpm.charges', '2026-10'), 0);
  assert.equal(value('bpm.patrimoineDisponible', '2026-10'), stock - 140);
  // Retour au cycle sur une enveloppe sans règlement : impossible une fois des règlements imputés.
  await assert.rejects(() => s.modules.bpm.projects.allocate(ctx, p.budgetId, { amount: 1000, fundingSource: 'cycle', expectedRevision: s.state.budgets[p.budgetId].revision }), /déjà servi/);
});
