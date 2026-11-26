// Parcours de bout en bout côté API, sans navigateur : sur un profil rempli (cycle clos, projet financé, tâche
// avec dépense validée, objectif), chaque adresse de lecture de BPM répond sans erreur et sans rien modifier.
// Il complète les scénarios Playwright (e2e/), qui demandent un navigateur et ne tournent pas dans `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { at, camille, key, makeSocle, operation } from './helpers.mjs';
import { SOCLE_MODULES } from '../src/modules/index.mjs';

test('parcours des lectures BPM : chaque adresse répond sur un profil rempli, sans écrire', async () => {
  const { socle: s } = await makeSocle();
  const { ctx } = await camille(s);
  const P = s.modules.bpm.projects;
  await at('2026-09-02', () => operation(s, ctx, { direction: 'income', label: 'Salaire', amount: 2000, date: '2026-09-02' }));
  await at('2026-09-10', () => operation(s, ctx, { direction: 'charge', label: 'Courses', amount: 300, date: '2026-09-10', costCenterRef: 'std:alimentation' }));
  const p = await at('2026-09-05', () => P.createProject(ctx, { requestKey: key(), title: 'Cuisine', amount: 800 }));
  const t = await P.createTask(ctx, { requestKey: key(), title: 'Plan de travail', projectId: p.coreProjectId, dueDate: '2026-11-20' });
  await at('2026-09-20', () => s.modules.budget.createOperation(ctx, { requestKey: key(), budgetId: p.budgetId, taskId: t.task.id, direction: 'charge', label: 'Plan', amount: 450, date: '2026-09-20', status: 'realized', costCenterRef: 'std:logement', fund: true }));
  for (const periodKey of ['2026-08', '2026-09']) await s.modules.bpm.closePeriod(ctx, { requestKey: key(), periodKey });

  const courses = Object.values(s.state.operations).find((o) => o.label === 'Courses');
  const values = { periodKey: '2026-09', ref: 'std:alimentation', key: 'bpm.revenus' };
  const idFor = (path) => (path.startsWith('/api/bpm/lines/') ? courses.id : path.startsWith('/api/bpm/projects/') ? p.coreProjectId : 'x');
  const revision = s.state.revision ?? JSON.stringify(Object.keys(s.state)).length;
  const QUERY = { '/api/bpm/closures/preview': { period: '2026-10' } };
  const answered = [];
  const bpm = SOCLE_MODULES.find((m) => m.id === 'bpm');
  for (const [method, path, handler] of s.routesOf(bpm)) {
    if (method !== 'GET') continue;
    const params = Object.fromEntries([...path.matchAll(/:(\w+)/g)].map((m) => [m[1], m[1] === 'id' ? idFor(path) : values[m[1]] ?? 'x']));
    if (Object.values(params).includes('x')) continue; // identifiant sans valeur connue dans ce parcours
    let result;
    try { result = await handler({ ctx, params, body: {}, query: new URLSearchParams(QUERY[path] ?? {}) }); } catch (e) { assert.fail(`${path} : ${e.code} ${e.message}`); }
    assert.ok(result !== undefined, `${path} répond`);
    answered.push(path);
  }
  assert.ok(answered.length >= 30, `au moins 30 lectures parcourues (${answered.length})`);
  for (const must of ['/api/bpm/meteo', '/api/bpm/bilans', '/api/bpm/bilans/:periodKey', '/api/bpm/life-management', '/api/bpm/projects/:id', '/api/bpm/lines/:id', '/api/bpm/tasks'])
    assert.ok(answered.includes(must), `${must} parcourue`);
  assert.equal(s.state.revision ?? JSON.stringify(Object.keys(s.state)).length, revision, 'aucune lecture n’écrit');
  await s.close();
});
