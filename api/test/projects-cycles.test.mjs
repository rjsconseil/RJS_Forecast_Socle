// Cas d'essai des projets de la vie sur sept périodes (six mois clos et le mois en cours, rempli sur tout le mois),
// scénario de api/scripts/project-scenarios.mjs rejoué par les services du socle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSocle, TODAY } from './helpers.mjs';
import { runProjectScenarios } from '../scripts/project-scenarios.mjs';

test('cycles de projets : dix projets sur six mois clos et un mois en cours complet', async () => {
  const { socle } = await makeSocle();
  const r = await runProjectScenarios(socle, { start: '2026-05', until: '2026-11-30' });
  for (const c of r.checks) assert.ok(c.ok, `${c.name} : attendu ${JSON.stringify(c.expected)}, observé ${JSON.stringify(c.observed)}`);
  assert.equal(r.played, r.total, 'tous les événements jusqu’au 30 novembre sont joués');
  assert.equal(r.checks.length, 26);
  assert.equal(process.env.SOCLE_TODAY, TODAY, 'la date de test est rétablie');
  assert.deepEqual(Object.values(socle.state.closures).filter((c) => c.userId === r.userId).map((c) => c.periodKey), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
});

test('cycles de projets arrêtés au 4 novembre : la suite du mois reste prévue, rien n’est réglé dans le futur', async () => {
  const { socle } = await makeSocle();
  const r = await runProjectScenarios(socle, { start: '2026-05', until: '2026-11-04' });
  for (const c of r.checks) assert.ok(c.ok, `${c.name} : attendu ${JSON.stringify(c.expected)}, observé ${JSON.stringify(c.observed)}`);
  assert.ok(r.played < r.total);
  const future = Object.values(socle.state.operations).filter((o) => o.userId === r.userId && o.status === 'realized' && o.realizedDate > '2026-11-04');
  assert.deepEqual(future, []);
  const planned = Object.values(socle.state.operations).filter((o) => o.userId === r.userId && o.status === 'planned' && o.date > '2026-11-04' && o.date <= '2026-11-30');
  assert.ok(planned.length >= 6, `${planned.length} dépenses prévues dans la suite du mois`);
});
