import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at, camille, key, makeSocle, operation, rejects } from './helpers.mjs';

async function projectWithTask(s, ctx, input) {
  const project = await s.modules.bpm.projects.createProject(ctx, { requestKey: key('projet'), ...input });
  const { task } = await s.modules.bpm.projects.createTask(ctx, {
    requestKey: key('tâche'), projectId: project.coreProjectId, title: input.title + ' · tâche',
  });
  return { ...project, taskId: task.id };
}

test('le registre quotidien et projets partage les postes et les lignes sans double imputation', async t => {
  const { socle: s } = await makeSocle();
  t.after(() => s.close());
  const { ctx } = await camille(s);
  const { ctx: other } = await camille(s, { label: 'Autre profil' });
  const { budget, bpm } = s.modules;
  const trip = await at('2026-10-01', () => projectWithTask(s, ctx, { title: 'Voyage au Japon', amount: 1500, fundingSource: 'cycle' }));
  const sale = await projectWithTask(s, ctx, { title: 'Vide-grenier' });
  const transport = { direction: 'charge', date: '2026-11-02', costCenterRef: 'std:transport' };
  const own = await operation(s, ctx, { ...transport, label: 'Billet du quotidien', amount: 20 });
  await operation(s, other, { direction: 'charge', date: '2026-11-02', label: 'Billet privé', amount: 500, costCenterRef: 'std:transport' });
  const ticket = await operation(s, ctx, { ...transport, budgetId: trip.budgetId, taskId: trip.taskId, label: 'Billet pour le Japon', amount: 450, fund: true, fundingSource: 'patrimoine' });
  const recurring = await budget.createRecurrence(ctx, {
    ...transport, budgetId: trip.budgetId, taskId: trip.taskId, label: 'Navette du projet',
    requestKey: key(), amount: 35, cadence: 'monthly', firstDate: '2026-11-03', fundingSource: 'patrimoine',
  });
  const gain = await operation(s, ctx, {
    budgetId: sale.budgetId, taskId: sale.taskId, direction: 'income',
    label: 'Encaissement du vide-grenier', date: '2026-11-03', costCenterRef: 'std:autresRevenus', amount: 1200,
  });

  const read = (query = {}) => bpm.reads.register(ctx, { period: '2026-11', scope: 'life-with-projects', ...query });
  const all = read();
  const ids = all.groups.find(g => g.key === 'std:transport').lineIds;
  assert.deepEqual(ids, [own.operation.id, ticket.operation.id, recurring.recurrence.id + '@2026-11-03']);
  assert.deepEqual(read({ center: 'std:transport' }).lines.map(l => l.id), ids);
  const planned = all.lines.find(l => l.recurrenceId === recurring.recurrence.id);
  assert.deepEqual([planned.project.name, planned.fundingSource, planned.projectPosting], ['Voyage au Japon', 'patrimoine', 'planned']);
  assert.equal(all.lines.length, 4);
  assert.equal(all.totals.netSettledCents, 73000);
  assert.equal(read({ q: 'Voyage au Japon' }).lines.length, 2);
  assert.deepEqual(read({ budgetId: sale.budgetId }).lines.map(l => l.id), [gain.operation.id]);
  assert.deepEqual(bpm.life.lifeManagement(ctx).projects.projects.map(p => p.coreProjectId).sort(), [sale.coreProjectId, trip.coreProjectId].sort());

  const cycle = bpm.reads.register(ctx, { period: '2026-11', dateBasis: 'realized' });
  assert.deepEqual(cycle.lines.map(l => l.id), [own.operation.id, gain.operation.id]);
  assert.equal(cycle.totals.netSettledCents, 118000);
  assert.equal(bpm.figure(ctx, 'bpm.revenusProjets', { periodKey: '2026-11' }).value, 1200);
  assert.equal(bpm.figure(ctx, 'bpm.prelevementsProjets', { periodKey: '2026-11' }).value, 450);

  const { operation: shuttle } = await budget.settleOccurrence(ctx, recurring.recurrence.id, {
    requestKey: key(), occurrenceDate: '2026-11-03', fund: true,
  });
  assert.equal(shuttle.fundingSource, 'patrimoine');
  assert.deepEqual(read({ q: 'Navette du projet' }).lines.map(l => l.id), [shuttle.id]);
  assert.equal(bpm.figure(ctx, 'bpm.prelevementsProjets', { periodKey: '2026-11' }).value, 485);
  assert.equal(bpm.figure(ctx, 'bpm.resultatPeriode', { periodKey: '2026-11' }).value, 1180);
});

test('ajouter des moyens conserve les dates des flux et une révision périmée ne peut pas écraser l’enveloppe', async t => {
  const { socle: s } = await makeSocle();
  t.after(() => s.close());
  const { ctx } = await camille(s);
  const { bpm } = s.modules;
  const p = await at('2026-09-01', () => projectWithTask(s, ctx, { title: 'Rénovation', amount: 8000, fundingSource: 'patrimoine' }));
  const read = () => bpm.projects.projectDetail(ctx, p.coreProjectId).budget;
  const { revision, allocationDate } = read();
  await at('2026-10-07', () => bpm.projects.allocate(ctx, p.budgetId, { expectedRevision: revision, amount: 8500, fundingSource: 'patrimoine' }));
  await rejects(bpm.projects.allocate(ctx, p.budgetId, { expectedRevision: revision, amount: 9000 }), 'STALE_VERSION');
  assert.deepEqual([read().allocationCents, read().allocationDate, read().fundingSource], [850000, allocationDate, 'patrimoine']);
  assert.equal(bpm.reads.register(ctx, { period: '2026-10', scope: 'life-with-projects' }).totals.lineCount, 0);
  assert.equal(bpm.figure(ctx, 'bpm.patrimoineDisponible').value, 12000);
});

test('projection Astra : dernier patrimoine clôturé, épargne par cycle, objectifs datés et inflation paramétrable', async t => {
  const { socle: s } = await makeSocle();
  t.after(() => s.close());
  const { ctx } = await camille(s, { openingDate: '2026-08-01' });
  const { bpm } = s.modules;
  const basis = { basis: 'savings-goal' };
  assert.equal(bpm.reads.projection(ctx, basis).status, 'missing-hypothesis');
  await bpm.updateVision(ctx, { expectedRevision: 1, horizonYears: 2, savingsTarget: 100, contribution: 999, annualReturnPct: 0, inflationPct: 0 });
  await operation(s, ctx, { direction: 'income', amount: 500, date: '2026-08-10' });
  const draft = bpm.reads.projection(ctx, basis);
  assert.deepEqual([draft.hypotheses.startCents, draft.hypotheses.startPeriodKey], [1200000, null]);
  await bpm.closePeriod(ctx, { requestKey: key(), periodKey: '2026-08' });

  const p = await at('2026-09-01', () => projectWithTask(s, ctx, { title: 'Mobilier', amount: 500, fundingSource: 'patrimoine' }));
  await operation(s, ctx, { direction: 'charge', amount: 50, date: '2026-09-02', budgetId: p.budgetId, taskId: p.taskId, fund: true });
  assert.equal(bpm.figure(ctx, 'bpm.patrimoineDisponible').value, 12450);
  const proj = bpm.reads.projection(ctx, basis);
  assert.deepEqual([proj.hypotheses.startCents, proj.hypotheses.startDate, proj.hypotheses.startPeriodKey, proj.hypotheses.contributionCents],
    [1250000, '2026-08-31', '2026-08', 10000]);
  assert.deepEqual(proj.rows.slice(0, 2).map(r => [r.date, r.nominalCents]), [
    ['2026-08-31', 1250000], ['2027-08-31', 1370000],
  ]);
  const inflated = bpm.reads.projection(ctx, { ...basis, inflation: '3' });
  assert.equal(inflated.rows[1].nominalCents, proj.rows[1].nominalCents);
  assert.ok(inflated.rows[1].realCents < proj.rows[1].realCents);

  // Dès septembre, l’objectif daté peut mobiliser l’épargne de septembre, avant le premier point annuel.
  await bpm.createGoal(ctx, { requestKey: key(), label: 'Achat', type: 'achat', date: '2026-10-02', targetToday: 12600 });
  const withGoal = bpm.reads.projection(ctx, basis);
  assert.equal(withGoal.goals[0].coveredCents, 1260000);
  assert.equal(withGoal.rows[1].nominalCents, 110000);
  assert.equal(bpm.reads.projection(ctx, { ...basis, extra: '25' }).difference[1].nominalCents, 30000);
});

test('un gain sans enveloppe reste soumis à la clôture de son cycle d’imputation', async t => {
  const { socle: s } = await makeSocle();
  t.after(() => s.close());
  const { ctx } = await camille(s);
  const { bpm } = s.modules;
  const sale = await at('2026-08-01', () => projectWithTask(s, ctx, { title: 'Marché' }));
  const input = { direction: 'income', costCenterRef: 'std:autresRevenus', amount: 100, budgetId: sale.budgetId, taskId: sale.taskId, date: '2026-08-05' };
  const { operation: gain } = await operation(s, ctx, input);
  assert.equal(bpm.figure(ctx, 'bpm.resultatPeriode', { periodKey: '2026-08' }).value, 100);
  await bpm.closePeriod(ctx, { requestKey: key(), periodKey: '2026-08' });
  assert.equal(bpm.reads.lineDetail(ctx, gain.id).actions.canCancelSettlement, false);
  await rejects(s.modules.budget.cancelRealization(ctx, gain.id, { expectedRevision: gain.revision }), 'PERIOD_CLOSED');
  await rejects(operation(s, ctx, input), 'PERIOD_CLOSED');
});
