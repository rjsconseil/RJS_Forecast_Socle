// Jeu de réponses de l'API pour les tests des écrans BPM du site : un profil de recette construit par les vraies
// commandes (salaire, courses, définitions récurrentes, un projet de la vie financé, deux cycles clôturés), puis les
// lectures que les pages font, passées par les routes HTTP déclarées. Les identifiants et les horodatages sont
// normalisés pour que le fichier ne change que si un contrat change.
//
//   node api/scripts/web-fixtures.mjs     → web/src/app/bpm/testing/api-fixtures.json
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { at, camille, key, makeSocle, operation } from '../test/helpers.mjs';

const target = process.env.WEB_FIXTURES_OUT || new URL('../../web/src/app/bpm/testing/api-fixtures.json', import.meta.url).pathname;
process.env.SOCLE_TODAY = '2026-11-20';

const { socle } = await makeSocle();
const { ctx } = await camille(socle);
const { budget, bpm } = socle.modules;
const P = bpm.projects;

// Août à novembre : salaire, courses, loyer récurrent ; un projet de la vie financé, avec une tâche et un règlement.
await budget.createRecurrence(ctx, { requestKey: key(), direction: 'charge', label: 'Loyer', amount: 900, cadence: 'monthly', firstDate: '2026-08-05', costCenterRef: 'std:logement' });
await budget.createRecurrence(ctx, { requestKey: key(), direction: 'income', label: 'Salaire', amount: 2600, cadence: 'monthly', firstDate: '2026-08-28', costCenterRef: 'std:salaires' });
for (const [day, label, amount] of [['2026-08-12', 'Courses', 220], ['2026-09-10', 'Courses', 260], ['2026-10-09', 'Courses', 240], ['2026-11-07', 'Courses', 180]]) {
  await at(day, () => operation(socle, ctx, { direction: 'charge', label, amount, date: day, costCenterRef: 'std:alimentation' }));
}
const project = await at('2026-09-05', () => P.createProject(ctx, { requestKey: key(), title: 'Cuisine', description: 'Refaire la cuisine', amount: 1200 }));
const task = await P.createTask(ctx, { requestKey: key(), title: 'Plan de travail', projectId: project.coreProjectId, plannedHours: 6 });
await at('2026-09-20', () => budget.createOperation(ctx, { requestKey: key(), budgetId: project.budgetId, taskId: task.task.id, direction: 'charge', label: 'Plan de travail', amount: 450, date: '2026-09-20', status: 'realized', costCenterRef: 'std:logement', fund: true }));
await at('2026-11-15', () => budget.createOperation(ctx, { requestKey: key(), direction: 'charge', label: 'Électricien', amount: 160, date: '2026-11-25', status: 'planned', costCenterRef: 'std:logement' }));
for (const periodKey of ['2026-08', '2026-09']) await bpm.closePeriod(ctx, { requestKey: key(), periodKey });

// Les routes du site, comme le serveur les appelle.
const routes = [...socle.registry.modules.values()].flatMap((m) => socle.routesOf(m).map(([method, pattern, handler]) => {
  const keys = [];
  return { method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`), keys, handler };
}));
async function get(path) {
  const url = new URL(path, 'http://recette');
  const route = routes.find((r) => r.method === 'GET' && r.re.test(url.pathname));
  const m = route.re.exec(url.pathname);
  const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  return socle.store.within(ctx.userId, () => route.handler({ ctx, params, body: {}, query: url.searchParams }));
}

const register = await get('/api/bpm/register?period=2026-11');
const firstLine = register.lines.find((l) => l.kind === 'occurrence') ?? register.lines[0];
const fixtures = {
  register: register,
  costCenters: await get('/api/bpm/cost-centers'),
  tasks: await get('/api/tasks'),
  budgetType: await get('/api/bpm/budget-type'),
  lifeManagement: await get('/api/bpm/life-management?period=2026-11'),
  bilans: await get('/api/bpm/bilans'),
  bilan: await get('/api/bpm/bilans/2026-09'),
  projectDetail: await get(`/api/bpm/projects/${project.coreProjectId}`),
  line: await get(`/api/bpm/lines/${encodeURIComponent(firstLine.id)}?period=2026-11`),
  closing: await get('/api/bpm/closing'),
};
await socle.close();

// Normalisation : identifiants stables (préfixe conservé), horodatages ramenés au jour de recette.
const ids = new Map();
const json = JSON.stringify(fixtures, null, 1)
  .replace(/\b([a-z]{2,3})_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, (id, prefix) => {
    if (!ids.has(id)) ids.set(id, `${prefix}_${String(ids.size + 1).padStart(3, '0')}`);
    return ids.get(id);
  })
  .replace(/\b(req|op|user|seed)-[0-9a-f-]{36}\b/g, '$1-recette')
  .replace(/"(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}\.\d{3}Z"/g, '"$1T09:00:00.000Z"');
await mkdir(dirname(target), { recursive: true });
await writeFile(target, json + '\n');
console.log(`Réponses de recette écrites : ${target} (${Object.keys(fixtures).length} lectures, ${ids.size} identifiants normalisés)`);
