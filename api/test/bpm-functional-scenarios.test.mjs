import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSocle, camille } from "./helpers.mjs";
import { runBpmFunctionalScenarios } from "../scripts/bpm-functional-scenarios.mjs";

test("recette persistante additive : tous les cas métier passent et les profils existants sont préservés", async () => {
  const { socle: s } = await makeSocle();
  await camille(s);
  const before = structuredClone(s.state);
  const report = await runBpmFunctionalScenarios(s);
  assert.equal(
    report.ok,
    true,
    JSON.stringify(report.checks.filter((c) => !c.ok)),
  );
  assert.equal(report.profiles.length, 4);
  assert.equal(report.checks.length, 39);
  for (const [collection, entries] of Object.entries(before)) {
    if (!entries || Array.isArray(entries) || typeof entries !== "object")
      continue;
    for (const [id, value] of Object.entries(entries))
      assert.deepEqual(
        s.state[collection][id],
        value,
        `${collection}/${id} doit rester inchangé`,
      );
  }
  const after = structuredClone(s.state);
  const replay = await runBpmFunctionalScenarios(s);
  assert.equal(
    replay.ok,
    false,
    "Ignorer des profils ne constitue pas une nouvelle recette réussie",
  );
  assert.equal(replay.checks.length, 0);
  assert.equal(
    replay.profiles.every((u) => u.existing),
    true,
  );
  assert.deepEqual(
    s.state,
    after,
    "Un second lancement ne change aucune donnée",
  );
});
