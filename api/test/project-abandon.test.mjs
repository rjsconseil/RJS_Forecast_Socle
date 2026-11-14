import { test } from "node:test";
import assert from "node:assert/strict";
import { camille, key, makeSocle, operation } from "./helpers.mjs";

// Abandonner un projet de la vie : l'enveloppe revient à ce qui a été réglé, le prévu s'arrête, le réglé reste.
async function setup(t, amount) {
  const { socle } = await makeSocle();
  t.after(() => socle.close());
  const { ctx } = await camille(socle);
  const P = socle.modules.bpm.projects;
  const p = await P.createProject(ctx, { requestKey: key(), title: "Cuisine", amount });
  const task = async (title) => (await P.createTask(ctx, { requestKey: key(), projectId: p.coreProjectId, title })).task;
  const budget = () => socle.state.budgets[p.budgetId];
  const detail = () => P.projectDetail(ctx, p.coreProjectId);
  return { socle, ctx, P, p, task, budget, detail };
}

test("abandonner un projet : l'enveloppe non consommée revient au budget de vie, le prévu est annulé", async (t) => {
  const { socle, ctx, P, p, task, budget, detail } = await setup(t, 2400);
  const B = socle.modules.budget;
  const reads = socle.modules.bpm.reads;
  const [works, tiles, extra] = [await task("Travaux"), await task("Carrelage"), await task("Électroménager")];
  await P.setTaskShare(ctx, p.budgetId, works.id, { expectedRevision: budget().revision, amount: 1500 });
  await P.setTaskShare(ctx, p.budgetId, tiles.id, { expectedRevision: budget().revision, amount: 300 });
  await operation(socle, ctx, { budgetId: p.budgetId, taskId: works.id, direction: "charge", label: "Acompte artisan", amount: 600, date: "2026-11-03", fund: true });
  const { operation: planned } = await B.createOperation(ctx, { requestKey: key(), budgetId: p.budgetId, taskId: tiles.id, direction: "charge", label: "Carreaux", amount: 200, date: "2026-11-20", costCenterRef: "std:divers", status: "planned" });
  const { recurrence } = await B.createRecurrence(ctx, { requestKey: key(), budgetId: p.budgetId, direction: "charge", label: "Location benne", amount: 80, cadence: "monthly", firstDate: "2026-11-25", costCenterRef: "std:divers" });
  const { request } = await P.requestTaskBudget(ctx, p.budgetId, extra.id, { requestKey: key(), amount: 900 });
  const { overrun } = await P.requestOverrun(ctx, p.budgetId, { requestKey: key(), reason: "reglement", amount: 150 });
  const spent = () => reads.summary(ctx, { period: "2026-11" }).figures["bpm.charges"].valueCents;
  const spentBefore = spent();

  const preview = detail().abandon;
  assert.deepEqual(
    { paid: preview.paidCents, before: preview.allocationBeforeCents, after: preview.allocationAfterCents, released: preview.releasedCents, entries: preview.cancelledEntries, recurrences: preview.stoppedRecurrences, requests: preview.cancelledRequests, overruns: preview.cancelledOverruns },
    { paid: 60000, before: 240000, after: 60000, released: 180000, entries: 1, recurrences: 1, requests: 1, overruns: 1 },
  );

  const r = await P.abandonProject(ctx, p.budgetId, { expectedRevision: budget().revision, reason: "Déménagement" });
  assert.equal(r.abandonment.releasedCents, 180000);
  const d = r.detail;
  assert.equal(d.budget.abandoned.reason, "Déménagement");
  assert.equal(d.budget.allocationCents, 60000);
  assert.deepEqual(d.budget.shares, { [works.id]: 60000 }, "chaque part ramenée au réglé de sa tâche");
  assert.equal(d.abandon, null);
  assert.equal(socle.state.operations[planned.id].status, "cancelled");
  assert.ok(socle.state.recurrences[recurrence.id].cancelledAt, "la récurrence jamais réglée est supprimée");
  assert.equal(socle.state.taskBudgetRequests[request.id].status, "cancelled");
  assert.equal(socle.state.projectOverruns[overrun.id].status, "refused");
  assert.equal(spent(), spentBefore, "le réglé du projet reste dans le Dépensé du budget de vie");
  assert.equal(d.budget.toPayCents, 0, "plus rien à payer sur le projet");

  // Fermé aux écritures tant qu'il n'est pas repris.
  await assert.rejects(B.createOperation(ctx, { requestKey: key(), budgetId: p.budgetId, direction: "charge", label: "Oubli", amount: 10, date: "2026-11-03", costCenterRef: "std:divers" }), { code: "FORBIDDEN_BY_RULE" });
  await assert.rejects(B.createRecurrence(ctx, { requestKey: key(), budgetId: p.budgetId, direction: "charge", label: "Oubli", amount: 10, cadence: "monthly", firstDate: "2026-12-01", costCenterRef: "std:divers" }), { code: "FORBIDDEN_BY_RULE" });
  await assert.rejects(P.allocate(ctx, p.budgetId, { expectedRevision: budget().revision, amount: 3000 }), { code: "FORBIDDEN_BY_RULE" });
  await assert.rejects(P.createTask(ctx, { requestKey: key(), projectId: p.coreProjectId, title: "Peinture" }), { code: "FORBIDDEN_BY_RULE" });
  await assert.rejects(P.abandonProject(ctx, p.budgetId, { expectedRevision: budget().revision }), { code: "FORBIDDEN_BY_RULE" });

  // Reprise : le projet se rouvre, son enveloppe se réattribue.
  await P.resumeProject(ctx, p.budgetId, { expectedRevision: budget().revision });
  assert.equal(detail().budget.abandoned, null);
  await P.allocate(ctx, p.budgetId, { expectedRevision: budget().revision, amount: 1000 });
  assert.equal(budget().allocationCents, 100000);
  await assert.rejects(P.resumeProject(ctx, p.budgetId, { expectedRevision: budget().revision }), { code: "FORBIDDEN_BY_RULE" });
});

test("un projet qui a dépassé son enveloppe garde seulement le dépassement qui couvre ses règlements", async (t) => {
  const { socle, ctx, P, p, task, budget } = await setup(t, 500);
  const works = await task("Travaux");
  await P.setTaskShare(ctx, p.budgetId, works.id, { expectedRevision: budget().revision, amount: 500 });
  const { overrun } = await P.requestOverrun(ctx, p.budgetId, { requestKey: key(), reason: "ventilation", amount: 300, approve: true });
  await operation(socle, ctx, { budgetId: p.budgetId, taskId: works.id, direction: "charge", label: "Facture", amount: 700, date: "2026-11-03", fund: true });
  const r = await P.abandonProject(ctx, p.budgetId, { expectedRevision: budget().revision });
  assert.equal(budget().allocationCents, 50000, "l'enveloppe ne descend pas sous ce qui a été réglé dans son cadre");
  assert.equal(socle.state.projectOverruns[overrun.id].status, "approved");
  assert.equal(socle.state.projectOverruns[overrun.id].amountCents, 20000, "le dépassement est ramené au réglé au-delà de l'enveloppe");
  assert.equal(r.abandonment.releasedCents, 10000);
  assert.equal(r.detail.budget.ceilingCents, 70000);
  assert.deepEqual(r.detail.budget.shares, { [works.id]: 70000 });
});

test("une récurrence déjà réglée s'arrête à sa dernière échéance réglée ; ses échéances attendues sont écartées", async (t) => {
  const { socle, ctx, P, p, task, budget } = await setup(t, 1000);
  const B = socle.modules.budget;
  const works = await task("Travaux");
  await P.setTaskShare(ctx, p.budgetId, works.id, { expectedRevision: budget().revision, amount: 1000 });
  const { recurrence } = await B.createRecurrence(ctx, { requestKey: key(), budgetId: p.budgetId, taskId: works.id, direction: "charge", label: "Échafaudage", amount: 50, cadence: "weekly", firstDate: "2026-10-06", costCenterRef: "std:divers" });
  await B.settleOccurrence(ctx, recurrence.id, { requestKey: key(), occurrenceDate: "2026-10-20", fund: true });
  await P.abandonProject(ctx, p.budgetId, { expectedRevision: budget().revision });
  const rec = socle.state.recurrences[recurrence.id];
  assert.equal(rec.endDate, "2026-10-20");
  assert.ok(!rec.cancelledAt);
  const lines = B.budgetLines(socle.state, [p.budgetId], { from: "2026-10-01", to: "2027-01-31", by: "planned" });
  assert.deepEqual(lines.filter((l) => l.recurrenceId === recurrence.id).map((l) => [l.plannedDate, l.settled]), [["2026-10-20", true]]);
});
