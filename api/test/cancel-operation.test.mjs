import { test } from "node:test";
import assert from "node:assert/strict";
import { camille, key, makeSocle, operation } from "./helpers.mjs";

// Annulation d'une saisie ponctuelle (doublon) : hors de toutes les sommes, refusée dans une période close.
test("annuler une saisie en double : elle sort des sommes, pas d'une période close", async (t) => {
  const { socle } = await makeSocle();
  t.after(() => socle.close());
  const { ctx } = await camille(socle);
  const budget = socle.modules.budget;
  const bpm = socle.modules.bpm;
  const spent = (periodKey) => bpm.reads.summary(ctx, { period: periodKey }).figures["bpm.charges"].valueCents;

  const { operation: old } = await operation(socle, ctx, { direction: "charge", label: "Pharmacie", amount: 30, date: "2026-09-10", costCenterRef: "std:sante" });
  await operation(socle, ctx, { direction: "charge", label: "Pharmacie", amount: 30, date: "2026-11-02", costCenterRef: "std:sante" });
  const { operation: twice } = await operation(socle, ctx, { direction: "charge", label: "Pharmacie", amount: 30, date: "2026-11-02", costCenterRef: "std:sante" });
  const before = spent("2026-11");

  const { operation: cancelled } = await budget.cancelOperation(ctx, twice.id, { expectedRevision: twice.revision, reason: "Doublon" });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(spent("2026-11"), before - 3000);
  assert.ok(!bpm.reads.due(ctx).lines.some((l) => l.operationId === twice.id));
  await assert.rejects(budget.realizeOperation(ctx, twice.id, { expectedRevision: cancelled.revision }), { code: "FORBIDDEN_BY_RULE" });
  await assert.rejects(budget.cancelOperation(ctx, twice.id, { expectedRevision: cancelled.revision }), { code: "FORBIDDEN_BY_RULE" });

  for (const periodKey of ["2026-08", "2026-09", "2026-10"]) await bpm.closePeriod(ctx, { requestKey: key(), periodKey });
  await assert.rejects(budget.cancelOperation(ctx, old.id, { expectedRevision: old.revision }), { code: "PERIOD_CLOSED" });
  assert.equal(socle.state.operations[old.id].status, "realized");
});

// Remboursement reçu par un projet financé : il se déduit de ses charges réglées et du Dépensé du budget de vie.
test("remboursement d'un projet : déduit de sa tâche, du projet et du Dépensé du budget de vie", async (t) => {
  const { socle } = await makeSocle();
  t.after(() => socle.close());
  const { ctx } = await camille(socle);
  const P = socle.modules.bpm.projects;
  const spent = () => socle.modules.bpm.life.lifeManagement(ctx, { periodKey: "2026-11" }).cycle.flows;
  const p = await P.createProject(ctx, { requestKey: key(), title: "Week-end", amount: 300 });
  const { task } = await P.createTask(ctx, { requestKey: key(), projectId: p.coreProjectId, title: "Sorties" });
  let b = socle.state.budgets[p.budgetId];
  await P.allocate(ctx, b.id, { expectedRevision: b.revision, amount: 300 });
  b = socle.state.budgets[p.budgetId];
  await P.setTaskShare(ctx, b.id, task.id, { expectedRevision: b.revision, amount: 300 });
  await operation(socle, ctx, { budgetId: b.id, taskId: task.id, direction: "charge", label: "Bateau", amount: 90, date: "2026-11-03", costCenterRef: "std:loisirs", fund: true });
  const before = spent();
  await operation(socle, ctx, { budgetId: b.id, taskId: task.id, direction: "income", label: "Remboursement bateau", amount: 90, date: "2026-11-03", costCenterRef: "std:autresRevenus" });
  const after = spent();
  assert.equal(after.projectsPaidCents, before.projectsPaidCents - 9000);
  assert.equal(after.paidCents, before.paidCents - 9000);
  assert.equal(after.receivedCents, before.receivedCents, "le remboursement n'est pas un revenu du budget de vie");
  const d = P.projectDetail(ctx, p.coreProjectId);
  assert.equal(d.budget.paidCents, 0);
  assert.equal(d.tasks.find((x) => (x.task?.id ?? x.id) === task.id).budget.paidCents, 0);
  const loisirs = socle.modules.bpm.reads.capsReview(ctx, { period: "2026-11" }).centers.find((c) => c.ref === "std:loisirs");
  assert.equal(loisirs?.engagedCents ?? 0, 0, "le remboursement revient sur le poste de la charge remboursée");
});
