// Cas d'essai des projets de la vie sur quatre périodes de cycle (scénario de api/scripts/project-scenarios.mjs) :
// budgets attribués et ventilés, dépassements autorisés ou refusés, facturation de fin de cycle, retours, clôtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSocle, TODAY } from './helpers.mjs';
import { runProjectScenarios } from '../scripts/project-scenarios.mjs';

test('cycles de projets : sept projets sur quatre périodes, chaque attendu recalculé à part', async () => {
  const { socle } = await makeSocle();
  const r = await runProjectScenarios(socle, { start: '2026-08' });
  for (const c of r.checks) assert.ok(c.ok, `${c.name} : attendu ${JSON.stringify(c.expected)}, observé ${JSON.stringify(c.observed)}`);
  assert.equal(r.checks.length, 18);
  assert.equal(process.env.SOCLE_TODAY, TODAY, 'la date de test est rétablie');
  assert.deepEqual(Object.values(socle.state.closures).filter((c) => c.userId === r.userId).map((c) => c.periodKey), ['2026-08', '2026-09', '2026-10']);
});
