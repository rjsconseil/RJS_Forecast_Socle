// Météo BPM : une seule règle pour la météo d'un ensemble de signaux, les deux sections, les prévisions et les tendances.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { at, camille, key, makeSocle, operation } from './helpers.mjs';
import { weatherOf } from '../src/modules/bpm/meteo.mjs';

const P = (s) => s.modules.bpm.projects;
const meteo = (s, ctx) => s.modules.bpm.meteo.report(ctx);
const sig = (...hs) => hs.map((health) => ({ health }));

test('règle de la météo : deux alertes = orage, une = nuages, à surveiller = éclaircies, sinon soleil', () => {
  assert.equal(weatherOf(sig('alert', 'alert', 'ok')).key, 'orage');
  assert.equal(weatherOf(sig('alert', 'watch')).key, 'nuages');
  assert.equal(weatherOf(sig('watch', 'ok')).key, 'eclaircies');
  assert.equal(weatherOf(sig('unknown')).key, 'eclaircies');
  assert.equal(weatherOf(sig('ok', 'ok')).key, 'soleil');
  assert.deepEqual(weatherOf(sig('alert', 'watch', 'ok', 'ok')).counts, { ok: 2, watch: 1, alert: 1, unknown: 0 });
});

test('météo des deux sections : volets du projet de vie, tâches en retard et bloquées de la gestion de projet', async () => {
  const { socle: s } = await makeSocle();
  const { ctx } = await camille(s);
  await at('2026-11-02', () => operation(s, ctx, { direction: 'income', label: 'Salaire', amount: 2000, date: '2026-11-02' }));
  const p = await P(s).createProject(ctx, { requestKey: key(), title: 'Cuisine', amount: 800 });
  await P(s).createTask(ctx, { requestKey: key(), title: 'Devis', projectId: p.coreProjectId, dueDate: '2026-10-20' });
  const b = await P(s).createTask(ctx, { requestKey: key(), title: 'Pose', projectId: p.coreProjectId, dueDate: '2026-11-08' });
  await s.modules.core.changeTaskStatus(ctx, b.task.id, { expectedRevision: b.task.revision, status: 'blocked' });
  await P(s).createProject(ctx, { requestKey: key(), title: 'Voyage' });

  const m = meteo(s, ctx);
  assert.deepEqual(m.sections.map((x) => x.key), ['projet-de-vie', 'gestion-de-projet', 'patrimoine']);
  const [life, mgmt] = m.sections;
  assert.deepEqual(life.signals.map((x) => x.key), ['cycle', 'indispensable', 'courante', 'projets', 'resultats', 'echeances']);
  assert.equal(life.signals.find((x) => x.key === 'resultats').health, 'alert', 'les cycles terminés non clos sont en alerte');
  assert.equal(life.signals.find((x) => x.key === 'resultats').link, '/projet-de-vie/cloture');

  const g = Object.fromEntries(mgmt.signals.map((x) => [x.key, x]));
  assert.equal(g.retards.health, 'alert');
  assert.match(g.retards.text, /Devis/);
  assert.equal(g.bloquees.health, 'watch');
  assert.equal(g.enveloppes.health, 'unknown', 'un projet sans enveloppe est à renseigner');
  assert.match(g.enveloppes.text, /Voyage/);
  assert.equal(g.avancement.health, 'watch', 'un projet sans tâche est à surveiller');
  assert.equal(mgmt.weather.key, 'nuages');

  const cuisine = mgmt.projects.find((x) => x.title === 'Cuisine');
  assert.equal(cuisine.weather.key, 'nuages', 'un retard et une tâche bloquée');
  assert.equal(mgmt.projects[0].title, 'Cuisine', 'les projets les plus exposés en premier');
  const voyage = mgmt.projects.find((x) => x.title === 'Voyage');
  assert.equal(voyage.weather.key, 'eclaircies', 'un projet sans tâche ni enveloppe n’est pas au beau fixe');
  assert.ok(voyage.reasons.some((r) => /Aucune tâche/.test(r)));
  assert.equal(m.overall.counts.alert, m.sections.reduce((n, s) => n + s.weather.counts.alert, 0));
});

test('prévisions : tâches et fin de cycle dans les 30 jours ; tendances : un cycle déficitaire est orageux', async () => {
  const { socle: s } = await makeSocle();
  const { ctx } = await camille(s);
  await at('2026-09-02', () => operation(s, ctx, { direction: 'charge', label: 'Réparation', amount: 400, date: '2026-09-02', costCenterRef: 'std:logement' }));
  await at('2026-11-02', () => operation(s, ctx, { direction: 'income', label: 'Salaire', amount: 2000, date: '2026-11-02' }));
  const p = await P(s).createProject(ctx, { requestKey: key(), title: 'Cuisine', amount: 800 });
  await P(s).createTask(ctx, { requestKey: key(), title: 'Pose', projectId: p.coreProjectId, dueDate: '2026-11-20' });
  await P(s).createTask(ctx, { requestKey: key(), title: 'Plus tard', projectId: p.coreProjectId, dueDate: '2027-02-01' });

  const { forecast, trends } = meteo(s, ctx);
  assert.deepEqual(forecast.items.map((x) => [x.kind, x.label]), [['tache', 'Pose'], ['cycle', 'Fin du cycle Novembre 2026']]);
  assert.equal(forecast.horizons[1].tasks, 1);
  const sept = trends.rows.find((x) => x.period.key === '2026-09');
  assert.equal(sept.weather.key, 'orage');
  assert.equal(trends.rows.find((x) => x.period.key === '2026-11').weather.key, 'soleil');
  assert.equal(trends.rows.find((x) => x.period.key === '2026-10').weather, null, 'un cycle sans mouvement n’a pas de météo');
});
