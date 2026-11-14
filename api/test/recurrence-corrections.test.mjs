import { test } from "node:test";
import assert from "node:assert/strict";
import { camille, key, makeSocle } from "./helpers.mjs";

// Une échéance qui n'aura pas lieu s'écarte et se rétablit ; une définition saisie par erreur se supprime.
test("écarter puis rétablir une échéance : elle sort des sommes, la définition continue", async (t) => {
  const { socle } = await makeSocle();
  t.after(() => socle.close());
  const { ctx } = await camille(socle);
  const budget = socle.modules.budget;
  const reads = socle.modules.bpm.reads;
  const toPay = () => reads.summary(ctx, { period: "2026-11" }).figures["bpm.resteAPayer"].valueCents;
  const { recurrence } = await budget.createRecurrence(ctx, { requestKey: key(), direction: "charge", label: "Salle de sport", amount: 39, cadence: "monthly", firstDate: "2026-08-20", costCenterRef: "std:loisirs" });
  const before = toPay();

  const { operation: skipped } = await budget.skipOccurrence(ctx, recurrence.id, { requestKey: key(), occurrenceDate: "2026-11-20", reason: "Abonnement suspendu" });
  assert.equal(skipped.status, "cancelled");
  assert.equal(skipped.cancelReason, "Abonnement suspendu");
  assert.equal(toPay(), before - 3900, "l'échéance écartée ne reste plus à payer");
  assert.ok(!reads.register(ctx, { period: "2026-11", groupBy: "none" }).lines.some((l) => l.recurrenceId === recurrence.id && l.plannedDate === "2026-11-20"));
  await assert.rejects(budget.skipOccurrence(ctx, recurrence.id, { requestKey: key(), occurrenceDate: "2026-11-20" }), { code: "FORBIDDEN_BY_RULE" });
  await assert.rejects(budget.skipOccurrence(ctx, recurrence.id, { requestKey: key(), occurrenceDate: "2026-11-21" }), { code: "VALIDATION" });

  // Le détail d'une autre échéance de la série montre l'échéance écartée, qui se rétablit.
  const detail = reads.lineDetail(ctx, `${recurrence.id}@2026-10-20`, { periodKey: "2026-10" });
  assert.deepEqual(detail.skipped.map((s) => s.occurrenceDate), ["2026-11-20"]);
  assert.equal(detail.actions.canSkipOccurrence, true);
  await budget.restoreOccurrence(ctx, recurrence.id, { occurrenceDate: "2026-11-20", expectedRevision: detail.skipped[0].revision });
  assert.equal(toPay(), before, "l'échéance rétablie est de nouveau attendue");
  await assert.rejects(budget.restoreOccurrence(ctx, recurrence.id, { occurrenceDate: "2026-11-20" }), { code: "FORBIDDEN_BY_RULE" });

  // Une échéance réglée ne s'écarte qu'après l'annulation de son règlement.
  const { operation: paid } = await budget.settleOccurrence(ctx, recurrence.id, { requestKey: key(), occurrenceDate: "2026-11-20", realizedDate: "2026-11-02" });
  await assert.rejects(budget.skipOccurrence(ctx, recurrence.id, { requestKey: key(), occurrenceDate: "2026-11-20" }), { code: "ALREADY_SETTLED" });
  await budget.cancelRealization(ctx, paid.id, { expectedRevision: paid.revision });
  await budget.skipOccurrence(ctx, recurrence.id, { requestKey: key(), occurrenceDate: "2026-11-20" });
  assert.equal(toPay(), before - 3900);
});

test("une échéance d'une période close s'écarte sans changer le résultat clos", async (t) => {
  const { socle } = await makeSocle();
  t.after(() => socle.close());
  const { ctx } = await camille(socle);
  const budget = socle.modules.budget;
  const bpm = socle.modules.bpm;
  const { recurrence } = await budget.createRecurrence(ctx, { requestKey: key(), direction: "charge", label: "Cotisation club", amount: 25, cadence: "monthly", firstDate: "2026-08-12", costCenterRef: "std:loisirs" });
  for (const periodKey of ["2026-08", "2026-09"]) await bpm.closePeriod(ctx, { requestKey: key(), periodKey });
  const closed = bpm.closures(ctx).map((c) => [c.periodKey, c.resultCents]);
  await budget.skipOccurrence(ctx, recurrence.id, { requestKey: key(), occurrenceDate: "2026-08-12" });
  assert.deepEqual(bpm.closures(ctx).map((c) => [c.periodKey, c.resultCents]), closed);
  assert.ok(!bpm.reads.due(ctx).lines.some((l) => l.recurrenceId === recurrence.id && l.plannedDate === "2026-08-12"), "l'échéance écartée n'est plus en retard");
});

test("supprimer une définition saisie par erreur, refusé dès qu'une échéance est réglée", async (t) => {
  const { socle } = await makeSocle();
  t.after(() => socle.close());
  const { ctx } = await camille(socle);
  const budget = socle.modules.budget;
  const reads = socle.modules.bpm.reads;
  const income = () => reads.summary(ctx, { period: "2026-11" }).figures["bpm.resteARecevoir"].valueCents;
  const before = income();
  const { recurrence: twice } = await budget.createRecurrence(ctx, { requestKey: key(), direction: "income", label: "Salaire (doublon)", amount: 2500, cadence: "monthly", firstDate: "2026-08-28", costCenterRef: "std:salaires" });
  assert.equal(income(), before + 250000);
  const paid = await budget.settleOccurrence(ctx, twice.id, { requestKey: key(), occurrenceDate: "2026-10-28" });
  let rec = socle.state.recurrences[twice.id];
  await assert.rejects(budget.cancelRecurrence(ctx, twice.id, { expectedRevision: rec.revision }), { code: "FORBIDDEN_BY_RULE" });
  await budget.cancelRealization(ctx, paid.operation.id, { expectedRevision: paid.operation.revision });
  rec = socle.state.recurrences[twice.id];
  const { recurrence: gone } = await budget.cancelRecurrence(ctx, twice.id, { expectedRevision: rec.revision, reason: "Saisi deux fois" });
  assert.ok(gone.cancelledAt);
  assert.equal(income(), before, "plus aucune échéance attendue");
  assert.ok(!budget.recurrences(ctx).some((r) => r.id === twice.id), "la définition sort de la liste");
  assert.ok(!reads.register(ctx, { period: "2026-10", groupBy: "none" }).lines.some((l) => l.recurrenceId === twice.id), "ni l'échéance d'octobre, matérialisée puis annulée");
  await assert.rejects(budget.skipOccurrence(ctx, twice.id, { requestKey: key(), occurrenceDate: "2026-11-28" }), { code: "FORBIDDEN_BY_RULE" });
});

test("renommer un projet de la vie renomme son budget dans les listes et le registre", async (t) => {
  const { socle } = await makeSocle();
  t.after(() => socle.close());
  const { ctx } = await camille(socle);
  const P = socle.modules.bpm.projects;
  const p = await P.createProject(ctx, { requestKey: key(), title: "Salle de bain", amount: 500 });
  const project = socle.state.coreProjects[p.coreProjectId];
  await socle.modules.core.updateCoreProject(ctx, project.id, { expectedRevision: project.revision, title: "Rénovation de la cuisine" });
  assert.equal(socle.state.budgets[p.budgetId].name, "Rénovation de la cuisine");
  const lines = socle.modules.bpm.reads.register(ctx, { period: "2026-11", groupBy: "none" }).lines;
  assert.ok(lines.some((l) => l.label === "Budget attribué · Rénovation de la cuisine"));
  assert.ok(!lines.some((l) => l.label.includes("Salle de bain")));
});
