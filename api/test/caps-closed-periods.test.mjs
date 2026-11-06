import { test } from "node:test";
import assert from "node:assert/strict";
import { camille, key, makeSocle, operation, TODAY } from "./helpers.mjs";

async function fixture(t) {
  const setup = await makeSocle();
  let socle = setup.socle;
  t.after(() => socle.close());
  const { ctx } = await camille(socle);
  const budget = socle.modules.budget;
  const life = budget.lifeBudgetOf(socle.state, ctx.userId);
  await budget.setCaps(ctx, life.id, {
    expectedRevision: life.revision,
    caps: { "std:loisirs": 50 },
  });
  const { category } = await budget.createCategory(ctx, {
    requestKey: key(),
    label: "Cinéma",
    costCenterRef: "std:loisirs",
    cap: 30,
  });
  const { operation: paid } = await operation(socle, ctx, {
    direction: "charge",
    label: "Payé en septembre",
    amount: 20,
    date: "2026-09-10",
    costCenterRef: "std:loisirs",
    categoryId: category.id,
  });
  const { operation: pending } = await operation(socle, ctx, {
    direction: "charge",
    label: "Ponctuel non réalisé",
    amount: 70,
    date: "2026-09-15",
    status: "planned",
    costCenterRef: "std:loisirs",
    categoryId: category.id,
  });
  const { recurrence } = await budget.createRecurrence(ctx, {
    requestKey: key(),
    direction: "charge",
    label: "Échéance non réalisée",
    amount: 10,
    cadence: "monthly",
    firstDate: "2026-09-05",
    endDate: "2026-09-05",
    costCenterRef: "std:loisirs",
    categoryId: category.id,
  });
  const reads = socle.modules.bpm.reads;
  assert.equal(
    reads
      .capsReview(ctx, { period: "2026-09" })
      .centers.find((c) => c.ref === "std:loisirs").engagedCents,
    10000,
  );
  for (const periodKey of ["2026-08", "2026-09", "2026-10"])
    await socle.modules.bpm.closePeriod(ctx, { requestKey: key(), periodKey });
  return {
    socle,
    ctx,
    category,
    paid,
    pending,
    recurrence,
    reload: async () => {
      socle = await setup.reload();
      return socle;
    },
  };
}

test("période close : poste, catégorie et revue excluent les échéances non réalisées sans effacer leur historique", async (t) => {
  const f = await fixture(t);
  for (const socle of [f.socle, await f.reload()]) {
    const reads = socle.modules.bpm.reads;
    const detail = reads.centerDetail(f.ctx, "std:loisirs", {
      period: "2026-09",
    });
    const review = reads.capsReview(f.ctx, { period: "2026-09" });
    const center = review.centers.find((c) => c.ref === "std:loisirs");
    const category = review.categories.find((c) => c.id === f.category.id);
    assert.deepEqual(
      [
        detail.center.paidCents,
        detail.center.remainingCents,
        detail.center.marginCents,
      ],
      [2000, 0, 3000],
    );
    assert.deepEqual(
      [
        detail.cap.paidCents,
        detail.cap.toPayCents,
        detail.cap.engagedCents,
        detail.cap.marginCents,
        detail.cap.over,
      ],
      [2000, 0, 2000, 3000, false],
    );
    assert.deepEqual(
      [center.engagedCents, center.marginCents, center.chargeIds],
      [2000, 3000, [f.paid.id]],
    );
    assert.deepEqual(
      [
        category.engagedCents,
        category.marginCents,
        category.over,
        category.chargeIds,
      ],
      [2000, 1000, false, [f.paid.id]],
    );
    assert.equal(review.totals.overCount, 0);
    assert.deepEqual(
      detail.unrealizedLines.map((l) => l.plannedCents).sort((a, b) => a - b),
      [1000, 7000],
    );
    assert.equal(detail.totals.unrealizedCents, 8000);
    assert.equal(
      socle.state.operations[f.pending.id].status,
      "planned",
      "La clôture ne supprime ni ne règle la prévision",
    );
    assert.equal(
      reads.register(f.ctx, { period: "2026-09" }).caps.centers["std:loisirs"]
        .engagedCents,
      2000,
    );
  }
});

test("règlement tardif après clôture : les plafonds consomment uniquement la période réelle et gardent les prévisions ouvertes", async (t) => {
  const { socle, ctx, recurrence, category } = await fixture(t);
  const reads = socle.modules.bpm.reads;
  const budget = socle.modules.budget;
  await operation(socle, ctx, {
    direction: "charge",
    label: "Prévision encore ouverte",
    amount: 25,
    date: TODAY,
    status: "planned",
    costCenterRef: "std:loisirs",
    categoryId: category.id,
  });
  const input = {
    direction: "charge",
    amount: 10,
    date: "2026-09-05",
    costCenterRef: "std:loisirs",
    categoryId: category.id,
    settle: true,
    recurrenceId: recurrence.id,
    occurrenceDate: "2026-09-05",
    realizedDate: TODAY,
  };
  const before = JSON.stringify(socle.state);
  const preview = reads.previewCaps(ctx, input);
  assert.equal(preview.period.key, "2026-11");
  assert.deepEqual(
    [
      preview.before.center.engagedCents,
      preview.after.center.paidCents,
      preview.after.center.toPayCents,
      preview.after.center.engagedCents,
    ],
    [2500, 1000, 2500, 3500],
  );
  assert.deepEqual(
    preview.alerts.map((a) => [a.level, a.overCents]),
    [["category", 500]],
  );
  assert.equal(JSON.stringify(socle.state), before);
  await budget.settleOccurrence(ctx, recurrence.id, {
    requestKey: key(),
    occurrenceDate: "2026-09-05",
    realizedDate: TODAY,
  });
  const historic = reads.capsReview(ctx, { period: "2026-09" });
  const current = reads.capsReview(ctx);
  assert.equal(
    historic.centers.find((c) => c.ref === "std:loisirs").engagedCents,
    2000,
  );
  assert.equal(
    current.centers.find((c) => c.ref === "std:loisirs").engagedCents,
    preview.after.center.engagedCents,
  );
  assert.equal(
    current.categories.find((c) => c.id === category.id).engagedCents,
    preview.after.category.engagedCents,
  );
});

test("aperçus de plafonds sur période close : ni le budget principal ni la branche projet ne réintroduisent les non-réalisés", async (t) => {
  const { socle, ctx, category } = await fixture(t);
  const project = await socle.modules.bpm.projects.createProject(ctx, {
    requestKey: key(),
    title: "Projet de simulation",
    amount: 100,
  });
  const snapshot = JSON.stringify(socle.state);
  for (const budgetId of [undefined, project.budgetId]) {
    const preview = socle.modules.bpm.reads.previewCaps(ctx, {
      budgetId,
      direction: "charge",
      amount: 15,
      date: "2026-09-20",
      costCenterRef: "std:loisirs",
      categoryId: category.id,
    });
    assert.deepEqual(
      [
        preview.before.center.engagedCents,
        preview.after.center.engagedCents,
        preview.after.center.toPayCents,
      ],
      [2000, 2000, 0],
    );
    assert.deepEqual(
      [
        preview.before.category.engagedCents,
        preview.after.category.engagedCents,
      ],
      [2000, 2000],
    );
    assert.deepEqual(preview.alerts, []);
  }
  assert.equal(JSON.stringify(socle.state), snapshot);
});
