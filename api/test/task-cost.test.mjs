// Budget restant d'une tâche, deux calculs au choix du projet (fiche projet de BPM-Astra) :
// - selon le temps restant (par défaut) : part × (temps prévu − temps passé) / temps prévu ;
// - selon le temps consommé : taux horaire du projet × heures passées sur la tâche.
import test from 'node:test';
import assert from 'node:assert/strict';
import { key, makeSocle, makeUser } from './helpers.mjs';

async function setup() {
  const { socle } = await makeSocle();
  const { ctx } = await makeUser(socle, { label: 'Taux', openingStock: 5000, anchorDay: 1, cycleStartDate: '2026-11-01' });
  const P = socle.modules.bpm.projects;
  const p = await P.createProject(ctx, { requestKey: key(), title: 'Cuisine', amount: 2000 });
  const { task } = await P.createTask(ctx, { requestKey: key(), projectId: p.coreProjectId, title: 'Pose', plannedHours: 10 });
  await P.setTaskShare(ctx, p.budgetId, task.id, { expectedRevision: socle.state.budgets[p.budgetId].revision, amount: 500 });
  const t = socle.state.tasks[task.id];
  await socle.modules.core.updateTask(ctx, task.id, { expectedRevision: t.revision, spentHours: 4 });
  const detail = () => P.projectDetail(ctx, p.coreProjectId);
  const budget = (d) => d.tasks.find((x) => x.task.id === task.id).budget;
  return { socle, ctx, P, p, task, detail, budget };
}

test('par défaut, le budget restant suit le temps restant', async () => {
  const t = await setup();
  const d = t.detail();
  assert.equal(d.budget.taskCost.mode, 'time-left');
  const b = t.budget(d);
  assert.equal(b.restMode, 'time-left');
  assert.equal(b.restCents, 30000, '500 € × 6 h restantes / 10 h');
  assert.equal(b.spentCostCents, null, 'pas de taux horaire');
});

test('selon le temps consommé : taux horaire du projet × heures passées, appliqué à toutes les tâches', async () => {
  const t = await setup();
  const rev = () => t.socle.state.budgets[t.p.budgetId].revision;
  let d = await t.P.setTaskCost(t.ctx, t.p.budgetId, { expectedRevision: rev(), mode: 'time-spent', hourlyRate: 35 });
  assert.deepEqual(d.budget.taskCost, { mode: 'time-spent', hourlyRateCents: 3500 });
  const b = t.budget(d);
  assert.equal(b.restMode, 'time-spent');
  assert.equal(b.restCents, 14000, '35 €/h × 4 h');
  assert.equal(b.remainingCents, 30000, 'le calcul selon le temps restant reste lisible');
  // Retour au temps restant : le taux reste enregistré pour plus tard.
  d = await t.P.setTaskCost(t.ctx, t.p.budgetId, { expectedRevision: rev(), mode: 'time-left' });
  assert.equal(t.budget(d).restCents, 30000);
  assert.equal(d.budget.taskCost.hourlyRateCents, 3500);
});

test('réglage refusé : mode inconnu, taux négatif, rien à changer', async () => {
  const t = await setup();
  const rev = () => t.socle.state.budgets[t.p.budgetId].revision;
  await assert.rejects(t.P.setTaskCost(t.ctx, t.p.budgetId, { expectedRevision: rev(), mode: 'autre' }), (e) => e.code === 'VALIDATION');
  await assert.rejects(t.P.setTaskCost(t.ctx, t.p.budgetId, { expectedRevision: rev(), hourlyRate: -5 }), (e) => e.code === 'VALIDATION');
  await assert.rejects(t.P.setTaskCost(t.ctx, t.p.budgetId, { expectedRevision: rev() }), (e) => e.code === 'VALIDATION');
});
