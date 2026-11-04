// Jeux d'essai RJS Forecast, préparés par les contrats réels (HTTP) après réinitialisation de recette.
// Usage : API lancée avec J1_ENABLE_RECETTE_RESET=1 (`npm run api`), puis `npm run seed`.
// Port : J1_API_PORT (défaut 3410) ou URL complète J1_API_URL.
// Les dates sont relatives à la date réelle du jour (locale), pas à SOCLE_TODAY.
import { randomUUID } from 'node:crypto';

const BASE = process.env.J1_API_URL ?? `http://localhost:${process.env.J1_API_PORT ?? 3410}`;
const key = (label) => `seed-${label}-${randomUUID()}`;

async function call(method, path, body, userId) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json.error)}`);
  return json;
}

// ---------- dates relatives au jour ----------

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const todayDay = now.getDate();

/** Mois décalé de `offset` par rapport au mois courant : { y, m (1-12), key, last }. */
function month(offset) {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return { y, m, key: `${y}-${pad(m)}`, last: new Date(y, m, 0).getDate() };
}
const dayOf = (mo, day) => `${mo.key}-${pad(Math.min(Math.max(day, 1), mo.last))}`;

// ---------- réinitialisation ----------

await call('POST', '/api/_recette/reset');

// ---------- user 1 : Camille Martin (individuel, cycle au 1er, stock et objectif connus) ----------

const M3 = month(-3);
const M2 = month(-2);
const M1 = month(-1);
const M0 = month(0);

const camille = await call('POST', '/api/users', {
  requestKey: key('camille'),
  label: 'Camille Martin',
  userType: 'individuel',
  openingStock: 12000,
  objective: 50000,
  anchorDay: 1,
  cycleStartDate: dayOf(M3, 1),
});
const C = camille.userId;

const op = (mo, day, direction, label, amount, costCenterRef, { planned = false } = {}) => {
  const date = dayOf(mo, day);
  return call('POST', '/api/bpm/operations', { requestKey: key('op'), direction, label, amount, date, status: planned ? 'planned' : 'realized', costCenterRef }, C);
};

// Trois mois terminés : salaire, loyer, courses, transport, loisirs.
const pastMonths = [
  { mo: M3, salaire: 3200, courses: [112.4, 96.8, 134.2, 88.5], loisirs: [['Cinéma', 24], ['Concert', 58]], extra: null },
  { mo: M2, salaire: 3200, courses: [128.9, 102.3, 91.75, 117.6], loisirs: [['Restaurant entre amis', 72.5]], extra: ['Remboursement mutuelle', 85] },
  { mo: M1, salaire: 3250, courses: [99.4, 141.1, 87.3, 109.9, 64.2], loisirs: [['Abonnement salle de sport', 39.9], ['Week-end à la mer', 210]], extra: ['Vente d’un vélo', 180] },
];
for (const { mo, salaire, courses, loisirs, extra } of pastMonths) {
  await op(mo, 1, 'income', 'Salaire', salaire, 'std:salaires');
  await op(mo, 3, 'charge', 'Passe navigo', 86.4, 'std:transport');
  await op(mo, 5, 'charge', 'Loyer', 950, 'std:logement');
  let day = 6;
  for (const amount of courses) {
    await op(mo, day, 'charge', 'Courses alimentaires', amount, 'std:alimentation');
    day += 6;
  }
  for (const [i, [label, amount]] of loisirs.entries()) await op(mo, 14 + i * 7, 'charge', label, amount, 'std:loisirs');
  if (extra) await op(mo, 20, 'income', extra[0], extra[1], 'std:autresRevenus');
}

// Mois courant : réalisé jusqu'à aujourd'hui, prévu ensuite.
const current = [
  [1, 'income', 'Salaire', 3250, 'std:salaires'],
  [2, 'charge', 'Passe navigo', 86.4, 'std:transport'],
  [3, 'charge', 'Courses alimentaires', 76.3, 'std:alimentation'],
  [5, 'charge', 'Loyer', 950, 'std:logement'],
  [10, 'charge', 'Courses alimentaires', 110, 'std:alimentation'],
  [17, 'charge', 'Courses alimentaires', 110, 'std:alimentation'],
  [22, 'charge', 'Dîner d’anniversaire', 65, 'std:loisirs'],
];
for (const [day, direction, label, amount, cc] of current) await op(M0, day, direction, label, amount, cc, { planned: day > todayDay });
// Toujours prévues, datées au plus tôt aujourd'hui, dans la période courante.
const later = (day) => Math.max(day, todayDay);
await op(M0, later(25), 'income', 'Prime trimestrielle', 400, 'std:autresRevenus', { planned: true });
await op(M0, later(26), 'charge', 'Assurance habitation', 28.5, 'std:logement', { planned: true });
await op(M0, later(28), 'charge', 'Révision de la voiture', 180, 'std:transport', { planned: true });

// Clôture des deux périodes terminées les plus anciennes ; la plus récente reste ouverte.
const closures = [];
for (const mo of [M3, M2]) closures.push((await call('POST', '/api/bpm/closures', { requestKey: key('clo'), periodKey: mo.key }, C)).closure);

// Projets de la vie (Budget standard + projet noyau + tâches).
const japon = await call('POST', '/api/bpm/life-projects', {
  requestKey: key('japon'),
  name: 'Voyage au Japon',
  project: { title: 'Voyage au Japon', description: 'Trois semaines entre Tokyo, Kyoto et Hokkaido.', priority: 'high' },
  tasks: [
    { title: 'Réserver les vols', plannedHours: 3 },
    { title: "Choisir l'itinéraire", plannedHours: 5 },
    { title: 'Demander le visa' },
  ],
}, C);
const cuisine = await call('POST', '/api/bpm/life-projects', {
  requestKey: key('cuisine'),
  name: 'Rénovation de la cuisine',
  project: { title: 'Rénovation de la cuisine', description: 'Nouveaux meubles, plan de travail et électroménager.' },
  tasks: [
    { title: 'Devis artisans', plannedHours: 4 },
    { title: 'Choisir les matériaux', plannedHours: 6 },
  ],
}, C);

const setStatus = async (taskId, status) => {
  const t = await call('GET', `/api/tasks/${taskId}`, null, C);
  return call('POST', `/api/tasks/${taskId}/status`, { expectedRevision: t.task.revision, status }, C);
};
const setTime = async (taskId, spentHours) => {
  const t = await call('GET', `/api/tasks/${taskId}`, null, C);
  return call('POST', `/api/tasks/${taskId}/time`, { expectedRevision: t.task.revision, spentHours }, C);
};
// Voyage : vols réservés, itinéraire en cours → « À finir ». Cuisine : devis à prioriser → « À prioriser ».
await setStatus(japon.taskIds[0], 'done');
await setTime(japon.taskIds[0], 3.5);
await setStatus(japon.taskIds[1], 'doing');
await setTime(japon.taskIds[1], 2);
await setStatus(cuisine.taskIds[0], 'blocked');

// Projets noyau génériques (démo J1) : exemple temps et complétude, homonymes, tâches autonomes, sept états.
const project = (title, extra = {}) => call('POST', '/api/projects', { requestKey: key('p'), title, ...extra }, C).then((r) => r.project.id);
const task = (title, extra = {}) => call('POST', '/api/tasks', { requestKey: key('t'), title, ...extra }, C).then((r) => r.task.id);

const exemple = await project('Exemple temps et complétude', {
  description: 'Exemple du contrat §9 : 15 h prévues, 9 h consommées, 50 % de tâches terminées, état À finir.',
});
await task('T1 — rédiger le plan', { projectId: exemple, plannedHours: 10, spentHours: 4, status: 'doing' });
await task('T2 — relire', { projectId: exemple, plannedHours: 5, spentHours: 5, status: 'done' });

await project('Préparer mon installation', { description: 'Premier projet homonyme (identité distincte).' });
await project('Préparer mon installation', { description: 'Second projet homonyme (identité distincte).' });
await task('Tâche autonome à rattacher', { plannedHours: 1.5 });
await task('Tâche autonome sans estimation', { status: 'blocked' });

const states = [
  ['État — À faire (vide)', []],
  ['État — En cours', ['doing', 'todo']],
  ['État — Terminée', ['done', 'done']],
  ['État — À prioriser', ['blocked', 'todo']],
  ['État — En pause', ['done', 'todo']],
  ['État — À reprendre', ['done', 'blocked']],
  ['État — À finir', ['done', 'doing']],
];
for (const [title, statuses] of states) {
  const pid = await project(title, { priority: 'low' });
  let i = 1;
  for (const status of statuses) await task(`${title.replace('État — ', '')} / tâche ${i++}`, { projectId: pid, status, plannedHours: 2, spentHours: status === 'done' ? 2 : 0 });
}

// ---------- user 2 : Famille Durand (stock inconnu, cycle à configurer) ----------

const durand = await call('POST', '/api/users', {
  requestKey: key('durand'),
  label: 'Famille Durand',
  userType: 'famille',
  objective: 80000,
});
const D = durand.userId;
const cantine = await call('POST', '/api/bpm/cost-centers', { requestKey: key('cc'), label: 'Cantine scolaire', direction: 'charge' }, D);
await call('POST', '/api/bpm/operations', { requestKey: key('op'), direction: 'charge', label: 'Cantine du mois', amount: 96, date: dayOf(M0, later(15)), status: 'planned', costCenterRef: cantine.costCenterId }, D);
await call('POST', '/api/bpm/operations', { requestKey: key('op'), direction: 'income', label: 'Allocations familiales', amount: 141.99, date: dayOf(M0, later(20)), status: 'planned', costCenterRef: 'std:allocations' }, D);
await call('POST', '/api/bpm/operations', { requestKey: key('op'), direction: 'charge', label: 'Fournitures scolaires', amount: 64.5, date: dayOf(M0, later(12)), status: 'planned', costCenterRef: 'std:enfants' }, D);

// ---------- résumé ----------

const dash = await call('GET', '/api/bpm/dashboard', null, C);
const checks = await call('GET', '/api/om/checks');
const count = (r) => checks.filter((c) => c.result === r).length;
const fmt = (f) => (f.value === null ? `inconnu (${f.unavailableReason})` : `${f.value} ${f.unit === '%' ? '%' : '€'}`);

console.log(`Jeux d'essai RJS Forecast créés sur ${BASE} (jour : ${TODAY}).`);
console.log(`  Camille Martin   ${C}  (individuel, cycle au 1er depuis ${dayOf(M3, 1)})`);
console.log(`    Budget « Projet de vie » ${camille.budgetId} · Patrimoine ${camille.patrimoineId}`);
console.log(`    Périodes closes : ${closures.map((c) => `${c.periodLabel} (${c.result} €)`).join(', ')} ; ${M1.key} terminée, à clôturer.`);
console.log(`    Projets de la vie : Voyage au Japon ${japon.coreProjectId}, Rénovation de la cuisine ${cuisine.coreProjectId}`);
console.log(`    Période ${dash.period?.label} : résultat ${fmt(dash.figures['bpm.resultatPeriode'])}, patrimoine constitué ${fmt(dash.figures['bpm.patrimoineConstitue'])}`);
console.log(`  Famille Durand   ${D}  (famille, stock inconnu, cycle à configurer)`);
console.log(`  Contrôles Object Management : ${count('passed')} réussis, ${count('warning')} avertissements, ${count('failed')} en échec, ${count('not-run')} non exécutés.`);
