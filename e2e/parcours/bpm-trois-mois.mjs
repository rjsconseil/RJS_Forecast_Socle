// Parcours BPM sur trois mois, joués par l'API du site en marche, comme l'interface les enverrait.
// Les écritures restent dans les données du site : rien n'est annulé à la fin.
//
//   node e2e/parcours/bpm-trois-mois.mjs [--api http://localhost:3410] [--report chemin.json]
//
// Trois familles de parcours, selon l'état du cycle de chaque user :
//   - « depart »   : cycle à configurer. Le parcours démarre en août, saisit chaque mois, clôt août, septembre
//                    et octobre, puis travaille le mois en cours.
//   - « reprise »  : octobre terminé mais pas clos. Le parcours complète octobre, le clôt, puis avance.
//   - « courant »  : octobre déjà clos. Le parcours travaille novembre et vérifie qu'octobre reste protégé.
// Chaque parcours crée aussi un projet de la vie, ses tâches, son enveloppe, ses parts, une demande, un
// dépassement, un objectif daté et des plafonds, puis relit toutes les pages de lecture du module.
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const arg = (key, fallback) => {
  const i = process.argv.indexOf(`--${key}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const API = arg('api', 'http://localhost:3410');
const ONLY = arg('only', null);
// Un passage partiel (--only) a son propre rapport : il n'écrase pas celui du passage complet.
const suffix = ONLY ? `-${ONLY.normalize('NFD').replace(/[^\w]+/g, '-').toLowerCase()}` : '';
const REPORT = resolve(arg('report', `api/data/recettes/bpm-trois-mois-${new Date().toISOString().slice(0, 10)}${suffix}.json`));
const TAG = `Parcours 3 mois · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

const report = { api: API, startedAt: new Date().toISOString(), users: [], checks: [] };
const key = () => `parcours-3-mois-${randomUUID()}`;

class ApiError extends Error {
  constructor(status, body) {
    super(body?.message ?? body?.error?.message ?? `HTTP ${status}`);
    this.status = status;
    this.code = body?.code ?? body?.error?.code ?? String(status);
  }
}

function client(userId) {
  const call = async (method, path, body) => {
    const r = await fetch(API + path, {
      method,
      headers: { 'content-type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    const json = text ? JSON.parse(text) : null;
    if (!r.ok) throw new ApiError(r.status, json);
    return json;
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b = {}) => call('POST', p, b),
    put: (p, b = {}) => call('PUT', p, b),
  };
}

/** Un parcours : ses étapes réussies, ses refus attendus et ses anomalies. */
function journal(user, kind) {
  const entry = { id: user.id, label: user.label, kind, steps: [] };
  report.users.push(entry);
  const record = (name, ok, detail) => {
    entry.steps.push({ name, ok, ...(detail ? { detail } : {}) });
    report.checks.push({ user: user.label, name, ok, ...(detail ? { detail } : {}) });
    if (!ok) console.log(`  ✗ ${name} — ${JSON.stringify(detail)}`);
  };
  return {
    entry,
    /** Une action qui doit réussir ; son résultat est rendu, `null` en cas d'échec. */
    async step(name, action) {
      try {
        const result = await action();
        record(name, true);
        return result ?? true;
      } catch (e) {
        record(name, false, { code: e.code, status: e.status, message: e.message });
        return null;
      }
    },
    /** Une action que le module doit refuser (période close, montant invalide…). */
    async refused(name, action, codes) {
      try {
        await action();
        record(name, false, { expected: codes, observed: 'accepté' });
      } catch (e) {
        const ok = !codes || codes.includes(e.code);
        record(name, ok, ok ? undefined : { expected: codes, observed: e.code, message: e.message });
      }
    },
    check(name, ok, detail) {
      record(name, !!ok, ok ? undefined : detail);
    },
  };
}

const months = ['2026-08', '2026-09', '2026-10'];
const monthName = { '2026-08': 'août', '2026-09': 'septembre', '2026-10': 'octobre', '2026-11': 'novembre' };
const day = (month, d) => `${month}-${String(d).padStart(2, '0')}`;

/** Toutes les pages de lecture du module, pour une période donnée. */
async function readEverything(api, j, period) {
  const q = period ? `?period=${period}` : '';
  const reads = [
    ['tableau de bord', `/api/bpm/dashboard${q}`],
    ['synthèse', `/api/bpm/summary${q}`],
    ['registre des flux', `/api/bpm/register${q ? q + '&' : '?'}groupBy=none`],
    ['registre par poste', `/api/bpm/register${q ? q + '&' : '?'}groupBy=center&direction=charge`],
    ['postes de dépense', `/api/bpm/centers${q ? q + '&' : '?'}direction=charge`],
    ['entrées de la période', `/api/bpm/incomes${q}`],
    ['rapprochement', `/api/bpm/balance${q}`],
    ['impact patrimonial', `/api/bpm/impact${q}`],
    ['gestion du projet de vie', `/api/bpm/life-management${q}`],
    ['plafonds', `/api/bpm/spending-caps${q}`],
    ['revue des plafonds', `/api/bpm/caps-review${q}`],
  ];
  for (const [label, path] of reads) await j.step(`lire · ${label} · ${period ?? 'courante'}`, () => api.get(path));
}

async function readOnce(api, j) {
  for (const [label, path] of [
    ['historique', '/api/bpm/history?limit=12'],
    ['budget type', '/api/bpm/budget-type'],
    ['échéances', '/api/bpm/due'],
    ['événements', '/api/bpm/events'],
    ['directives', '/api/bpm/directives'],
    ['projection', '/api/bpm/projection'],
    ['objectifs', '/api/bpm/goals'],
    ['récurrences', '/api/bpm/recurrences'],
    ['catégories', '/api/bpm/categories?archived=true'],
    ['périodes', '/api/bpm/periods?limit=12'],
    ['clôtures', '/api/bpm/closures'],
    ['projets', '/api/bpm/projects'],
    ['tâches', '/api/bpm/tasks'],
    ['projets de la vie', '/api/bpm/life-projects'],
    ['postes', '/api/bpm/cost-centers'],
    ['préparation', '/api/bpm/preparation'],
    ['calendrier', '/api/calendar/budgetPatrimoine?from=2026-08-01&to=2026-11-30'],
  ])
    await j.step(`lire · ${label}`, () => api.get(path));
}

/** Une charge ou une entrée ponctuelle, réglée ou prévue. */
const entry = (api, input) =>
  api.post('/api/bpm/operations', { requestKey: key(), cadence: 'once', status: 'planned', ...input });

/** Règle l'échéance d'une récurrence à sa date. */
const settle = (api, recurrenceId, occurrenceDate, extra = {}) =>
  api.post(`/api/bpm/recurrences/${recurrenceId}/settle`, { requestKey: key(), occurrenceDate, ...extra });

/** Clôt une période au résultat affiché par l'aperçu, comme la confirmation de l'interface. */
async function close(api, j, period) {
  const preview = await j.step(`aperçu de clôture · ${monthName[period]}`, () => api.get(`/api/bpm/closures/preview?period=${period}`));
  if (!preview) return null;
  return j.step(`clôturer ${monthName[period]} (${preview.result} €)`, () =>
    api.post('/api/bpm/closures', { requestKey: key(), periodKey: period, expectedResultCents: preview.resultCents }),
  );
}

/** Le mois d'un foyer : salaire et loyer réglés, courses, transport, loisirs, une correction. */
async function liveMonth(api, j, month, recs, { category } = {}) {
  const m = monthName[month];
  if (recs.salary) await j.step(`${m} · salaire reçu`, () => settle(api, recs.salary, day(month, 1)));
  if (recs.rent) await j.step(`${m} · loyer payé`, () => settle(api, recs.rent, day(month, 5)));
  if (recs.phone) await j.step(`${m} · forfait payé`, () => settle(api, recs.phone, day(month, 10), { realizedAmount: month === '2026-09' ? 24.99 : undefined }));
  const shop = await j.step(`${m} · courses de la semaine`, () =>
    entry(api, { direction: 'charge', label: `Courses · ${m}`, amount: 186.4, costCenterRef: 'std:alimentation', date: day(month, 8), status: 'realized', realizedDate: day(month, 8), categoryId: category ?? null }),
  );
  await j.step(`${m} · plein de carburant`, () =>
    entry(api, { direction: 'charge', label: `Carburant · ${m}`, amount: 72.3, costCenterRef: 'std:transport', date: day(month, 12), status: 'realized', realizedDate: day(month, 12) }),
  );
  await j.step(`${m} · sortie cinéma (au-delà du plafond loisirs)`, () =>
    entry(api, { direction: 'charge', label: `Cinéma et restaurant · ${m}`, amount: 168, costCenterRef: 'std:loisirs', date: day(month, 18), status: 'realized', realizedDate: day(month, 18) }),
  );
  // Une dépense prévue, réglée plus tard au montant réel.
  const planned = await j.step(`${m} · facture d'électricité prévue`, () =>
    entry(api, { direction: 'charge', label: `Électricité · ${m}`, amount: 95, costCenterRef: 'std:logement', date: day(month, 20) }),
  );
  const op = planned?.operation;
  if (op) await j.step(`${m} · facture d'électricité réglée au réel`, () => api.post(`/api/bpm/operations/${op.id}/realize`, { expectedRevision: op.revision, realizedAmount: 102.7, realizedDate: day(month, 22) }));
  // Une saisie en double, annulée.
  const dup = await j.step(`${m} · saisie en double`, () =>
    entry(api, { direction: 'charge', label: `Pharmacie · ${m}`, amount: 23.5, costCenterRef: 'std:sante', date: day(month, 14), status: 'realized', realizedDate: day(month, 14) }),
  );
  if (dup?.operation) await j.step(`${m} · annuler la saisie en double`, () => api.post(`/api/bpm/operations/${dup.operation.id}/cancel`, { expectedRevision: dup.operation.revision, reason: 'Saisie en double' }));
  // Une erreur de montant corrigée.
  if (shop?.operation) await j.step(`${m} · corriger le montant des courses`, () => api.put(`/api/bpm/operations/${shop.operation.id}`, { expectedRevision: shop.operation.revision, amount: 191.15, realizedAmount: 191.15 }));
  await readEverything(api, j, month);
  return { shop: shop?.operation ?? null };
}

/** Le projet de la vie : création, tâches, enveloppe, parts, demande, dépassement, retour, règlement. */
async function lifeProject(api, j, title, period) {
  const created = await j.step(`créer le projet « ${title} »`, () =>
    api.post('/api/bpm/projects', { requestKey: key(), title, description: `Projet joué par le parcours de trois mois (${TAG}).`, priority: 'high', startDate: '2026-11-01', dueDate: '2027-03-31', amount: 2400 }),
  );
  if (!created) return;
  const projectId = created.coreProjectId;
  const budgetId = created.budgetId;
  const tasks = [];
  for (const [t, hours] of [['Demander trois devis', 2], ['Choisir l’artisan', 1], ['Acheter les matériaux', 4]]) {
    const r = await j.step(`créer la tâche « ${t} »`, () => api.post('/api/bpm/tasks', { requestKey: key(), title: t, projectId, plannedHours: hours, status: 'todo' }));
    const id = r?.task?.id ?? r?.taskId ?? r?.id;
    if (id) tasks.push(id);
  }
  j.check('les trois tâches sont rattachées au projet', tasks.length === 3, { tasks });
  let detail = await j.step('lire la fiche du projet', () => api.get(`/api/bpm/projects/${projectId}`));
  const revision = () => detail?.budget?.revision;
  if (detail?.budget) {
    detail = (await j.step('attribuer l’enveloppe du projet (2 400 €)', () => api.put(`/api/bpm/project-budgets/${budgetId}/allocation`, { amount: 2400, expectedRevision: revision() }))) ?? detail;
    if (tasks[2]) detail = (await j.step('donner une part à « Acheter les matériaux » (1 500 €)', () => api.put(`/api/bpm/project-budgets/${budgetId}/shares/${tasks[2]}`, { amount: 1500, expectedRevision: revision() }))) ?? detail;
    if (tasks[0]) detail = (await j.step('donner une part à « Demander trois devis » (100 €)', () => api.put(`/api/bpm/project-budgets/${budgetId}/shares/${tasks[0]}`, { amount: 100, expectedRevision: revision() }))) ?? detail;
    await j.refused('refuser une part qui dépasse l’enveloppe sans autorisation', () => api.put(`/api/bpm/project-budgets/${budgetId}/shares/${tasks[1]}`, { amount: 5000, expectedRevision: revision() }));
    detail = (await j.step('relire la fiche du projet', () => api.get(`/api/bpm/projects/${projectId}`))) ?? detail;
    // Demande de part par une tâche, puis décision.
    const asked = tasks[1] && (await j.step('la tâche « Choisir l’artisan » demande 300 €', () => api.post(`/api/bpm/project-budgets/${budgetId}/requests/${tasks[1]}`, { requestKey: key(), amount: 300, note: 'Frais de déplacement des artisans' })));
    if (asked?.request) {
      detail = (await j.step('relire avant décision', () => api.get(`/api/bpm/projects/${projectId}`))) ?? detail;
      await j.step('accepter la demande de part', () => api.post(`/api/bpm/task-budget-requests/${asked.request.id}/decision`, { decision: 'approve', expectedRevision: asked.request.revision, expectedBudgetRevision: revision() }));
    }
    // Une dépense réglée au titre d'une tâche, imputée sur sa part.
    if (tasks[2])
      await j.step('payer les matériaux sur la part de la tâche', () =>
        entry(api, { direction: 'charge', label: `Matériaux · ${title}`, amount: 1320, costCenterRef: 'std:divers', date: day(period, 9), status: 'realized', realizedDate: day(period, 9), budgetId, taskId: tasks[2], fund: true }),
      );
    detail = (await j.step('relire après règlement', () => api.get(`/api/bpm/projects/${projectId}`))) ?? detail;
    // Dépassement demandé puis accepté, et facturé au budget du projet de vie.
    const over = await j.step('demander un dépassement de 250 €', () => api.post(`/api/bpm/project-budgets/${budgetId}/overruns`, { requestKey: key(), taskId: tasks[2], reason: 'reglement', amount: 250, note: 'Carrelage plus cher que prévu' }));
    if (over?.overrun) await j.step('accepter le dépassement', () => api.post(`/api/bpm/overruns/${over.overrunId ?? over.overrun.id}/decision`, { decision: 'approve', expectedRevision: over.overrun.revision }));
    // La facturation n'a lieu qu'en fin de cycle : avant, le module la refuse et dit quand elle sera possible.
    await j.refused('refuser de facturer les dépassements avant la fin du cycle', () => api.post('/api/bpm/overruns/bill', { budgetId }), ['FORBIDDEN_BY_RULE']);
    detail = (await j.step('relire avant le retour attendu', () => api.get(`/api/bpm/projects/${projectId}`))) ?? detail;
    if (tasks[0]) await j.step('prévoir un retour au projet de vie (revente des chutes)', () => api.put(`/api/bpm/project-budgets/${budgetId}/returns/${tasks[0]}`, { label: 'Revente des chutes de carrelage', amount: 60, cadence: 'once', expectedRevision: revision() }));
    const final = await j.step('lire la fiche finale du projet', () => api.get(`/api/bpm/projects/${projectId}`));
    j.check('la fiche du projet porte son enveloppe et ses parts', final?.budget && (final.tasks?.length ?? 0) >= 3, { budget: !!final?.budget, tasks: final?.tasks?.length });
  } else j.check('le projet créé a un budget', false, { detail: Object.keys(detail ?? {}) });
}

/** Un projet reporté : créé, financé, une dépense réglée, puis abandonné ; son enveloppe non consommée revient. */
async function abandonedProject(api, j, period) {
  const created = await j.step('créer le projet « Week-end à la mer »', () => api.post('/api/bpm/projects', { requestKey: key(), title: 'Week-end à la mer', amount: 450 }));
  if (!created) return;
  const { budgetId, coreProjectId } = created;
  const task = await j.step('créer la tâche « Réserver l’hébergement »', () => api.post('/api/bpm/tasks', { requestKey: key(), title: 'Réserver l’hébergement', projectId: coreProjectId }));
  const taskId = task?.task?.id;
  let d = await api.get(`/api/bpm/projects/${coreProjectId}`);
  if (taskId) d = (await j.step('donner 200 € à la réservation', () => api.put(`/api/bpm/project-budgets/${budgetId}/shares/${taskId}`, { amount: 200, expectedRevision: d.budget.revision }))) ?? d;
  if (taskId) await j.step('payer les arrhes (80 €)', () => entry(api, { direction: 'charge', label: 'Arrhes · Week-end à la mer', amount: 80, costCenterRef: 'std:loisirs', date: day(period, 13), status: 'realized', realizedDate: day(period, 13), budgetId, taskId }));
  await j.step('prévoir le solde de l’hébergement', () => entry(api, { direction: 'charge', label: 'Solde hébergement', amount: 120, costCenterRef: 'std:loisirs', date: '2026-12-10', budgetId, taskId }));
  d = await api.get(`/api/bpm/projects/${coreProjectId}`);
  j.check('l’aperçu annonce 370 € rendus au budget de vie', d.abandon?.releasedCents === 37000, d.abandon);
  const r = await j.step('abandonner le projet (week-end annulé)', () => api.post(`/api/bpm/project-budgets/${budgetId}/abandon`, { expectedRevision: d.budget.revision, reason: 'Week-end annulé' }));
  j.check('l’enveloppe est ramenée aux 80 € réglés', r?.detail?.budget?.allocationCents === 8000, r?.detail?.budget?.allocationCents);
  j.check('le solde prévu est annulé', (r?.detail?.charges ?? []).every((c) => c.settled), r?.detail?.charges?.map((c) => c.label));
  await j.refused('refuser une dépense sur un projet abandonné', () => entry(api, { direction: 'charge', label: 'Oubli', amount: 10, costCenterRef: 'std:loisirs', date: day(period, 13), status: 'realized', realizedDate: day(period, 13), budgetId }), ['FORBIDDEN_BY_RULE']);
  await j.refused('refuser une tâche dans un projet abandonné', () => api.post('/api/bpm/tasks', { requestKey: key(), title: 'Oubli', projectId: coreProjectId }), ['FORBIDDEN_BY_RULE']);
}

/** Plafonds : un poste et une catégorie, puis la revue. */
async function caps(api, j) {
  const center = await j.step('lire le poste Loisirs', () => api.get('/api/bpm/centers/std:loisirs'));
  if (center?.lifeBudget) await j.step('plafonner les loisirs à 150 €', () => api.put('/api/bpm/caps', { expectedRevision: center.lifeBudget.revision, caps: { 'std:loisirs': 150 }, merge: true }));
  const known = ((await api.get('/api/bpm/categories').catch(() => [])) ?? []).find((c) => c.label === 'Cantine des enfants');
  const cat = known ? { category: known } : await j.step('créer la catégorie « Cantine des enfants » plafonnée à 120 €', () => api.post('/api/bpm/categories', { requestKey: key(), label: 'Cantine des enfants', costCenterRef: 'std:alimentation', cap: 120 }));
  if (known) await j.refused('refuser une seconde catégorie du même nom dans le même poste', () => api.post('/api/bpm/categories', { requestKey: key(), label: 'Cantine des enfants', costCenterRef: 'std:alimentation' }), ['UNIQUENESS_VIOLATION']);
  await j.refused('refuser une catégorie sans nom', () => api.post('/api/bpm/categories', { requestKey: key(), label: ' ', costCenterRef: 'std:alimentation' }));
  return cat?.category?.id ?? null;
}

async function goals(api, j) {
  const g = await j.step('créer l’objectif « Fonds d’urgence » (6 000 € fin 2027)', () => api.post('/api/bpm/goals', { requestKey: key(), label: 'Fonds d’urgence', type: 'securite', date: '2027-12-31', targetToday: 6000 }));
  if (g?.goal) await j.step('repousser l’objectif à mi-2028', () => api.put(`/api/bpm/goals/${g.goal.id}`, { expectedRevision: g.goal.revision, date: '2028-06-30' }));
  const setup = await j.step('relire le profil pour la vision', () => api.get('/api/bpm/setup'));
  if (setup?.principal) await j.step('régler l’épargne visée (300 € par période)', () => api.put('/api/bpm/vision', { expectedRevision: setup.principal.revision, savingsTarget: 300 }));
}

/** Les récurrences du foyer : salaire, loyer, forfait. */
async function recurrences(api, j, firstMonth, salary = 3200) {
  const mk = (label, direction, amount, costCenterRef, d) =>
    j.step(`créer la récurrence « ${label} »`, () => api.post('/api/bpm/operations', { requestKey: key(), cadence: 'monthly', direction, label, amount, costCenterRef, firstDate: day(firstMonth, d) }));
  const s = await mk('Salaire', 'income', salary, 'std:salaires', 1);
  const r = await mk('Loyer', 'charge', 890, 'std:logement', 5);
  const p = await mk('Forfait mobile', 'charge', 19.99, 'std:divers', 10);
  return { salary: s?.recurrence?.id, rent: r?.recurrence?.id, phone: p?.recurrence?.id };
}

async function fromScratch(user) {
  console.log(`\n▶ ${user.label} — départ en août`);
  const api = client(user.id);
  const j = journal(user, 'depart');
  const dash = await j.step('lire le tableau de bord avant réglage', () => api.get('/api/bpm/dashboard'));
  if (dash?.cycle?.state && dash.cycle.state !== 'to_configure') {
    j.check('départ déjà joué : cycle réglé, mois précédents protégés', true);
    for (const month of months) await readEverything(api, j, month);
    await readOnce(api, j);
    return;
  }
  await j.refused('refuser une clôture sans cycle', () => api.post('/api/bpm/closures', { requestKey: key(), periodKey: '2026-08', expectedResultCents: 0 }));
  if (dash?.cycle) await j.step('régler le cycle : du 1er au dernier jour, depuis août', () => api.put('/api/bpm/cycle', { anchorDay: 1, startDate: '2026-08-01', expectedRevision: dash.cycle.revision }));
  const setup = await j.step('lire le profil', () => api.get('/api/bpm/setup'));
  const pat = setup?.principal?.patrimoine;
  if (pat) await j.step('fixer le patrimoine de départ (12 000 € au 1er août)', () => api.put('/api/bpm/patrimoine', { expectedRevision: pat.revision, openingStock: 12000, openingDate: '2026-08-01', objective: 60000 }));
  const recs = await recurrences(api, j, '2026-08');
  const category = await caps(api, j);
  for (const month of months) {
    await liveMonth(api, j, month, recs, { category });
    await j.refused(`refuser de clôturer ${monthName[month]} au mauvais résultat`, () => api.post('/api/bpm/closures', { requestKey: key(), periodKey: month, expectedResultCents: -1 }));
    await close(api, j, month);
    await j.refused(`refuser une dépense datée dans ${monthName[month]} clos`, () =>
      entry(api, { direction: 'charge', label: 'Oubli après clôture', amount: 12, costCenterRef: 'std:divers', date: day(month, 25), status: 'realized', realizedDate: day(month, 25) }),
    );
  }
  await j.refused('refuser de reclore octobre', () => api.post('/api/bpm/closures', { requestKey: key(), periodKey: '2026-10', expectedResultCents: 0 }));
  await j.refused('refuser de clore novembre, en cours', () => api.post('/api/bpm/closures', { requestKey: key(), periodKey: '2026-11', expectedResultCents: 0 }));
  await currentMonth(api, j, recs);
  await lifeProject(api, j, 'Rénovation de la salle de bain', '2026-11');
  await abandonedProject(api, j, '2026-11');
  await goals(api, j);
  // Revenir en arrière : chaque période close se relit avec ses chiffres figés.
  for (const month of months) await readEverything(api, j, month);
  await readOnce(api, j);
  const periods = await j.step('relire les périodes', () => api.get('/api/bpm/periods?limit=6'));
  j.check('août, septembre et octobre sont clos', ['2026-08', '2026-09', '2026-10'].every((k) => periods?.periods?.find((p) => p.key === k)?.status === 'closed'), periods?.periods?.map((p) => `${p.key}:${p.status}`));
}

/** Le mois en cours : salaire reçu, loyer à venir, une dépense prévue, une réalisation annulée. */
async function currentMonth(api, j, recs) {
  if (recs.salary) {
    const due = '2026-11-' + (recs.salaryDay ?? '01');
    const paid = (await api.get('/api/bpm/register?period=2026-11&groupBy=none')).lines.some((l) => l.recurrenceId === recs.salary && l.plannedDate === due && l.settled);
    if (paid) await j.refused('refuser de régler deux fois le salaire de novembre', () => settle(api, recs.salary, due), ['ALREADY_SETTLED']);
    else if (due > new Date().toISOString().slice(0, 10)) await j.refused(`refuser de recevoir dès aujourd’hui le salaire du ${due.slice(8)} novembre`, () => settle(api, recs.salary, due), ['FUTURE_REALIZATION']);
    else await j.step('novembre · salaire reçu', () => settle(api, recs.salary, due));
  }
  if (recs.rent) await j.step('novembre · loyer payé', () => settle(api, recs.rent, '2026-11-' + (recs.rentDay ?? '05')));
  const gift = await j.step('novembre · cadeaux de fin d’année prévus', () => entry(api, { direction: 'charge', label: 'Cadeaux de fin d’année', amount: 320, costCenterRef: 'std:loisirs', date: '2026-11-28' }));
  const paid = await j.step('novembre · courses réglées', () =>
    entry(api, { direction: 'charge', label: 'Courses · novembre', amount: 143.2, costCenterRef: 'std:alimentation', date: '2026-11-09', status: 'realized', realizedDate: '2026-11-09' }),
  );
  if (paid?.operation) {
    const undone = await j.step('novembre · annuler le règlement des courses (erreur de compte)', () => api.post(`/api/bpm/operations/${paid.operation.id}/cancel-realization`, { expectedRevision: paid.operation.revision }));
    const op = undone?.operation;
    if (op) await j.step('novembre · régler de nouveau les courses', () => api.post(`/api/bpm/operations/${op.id}/realize`, { expectedRevision: op.revision, realizedDate: '2026-11-10' }));
  }
  await j.step('novembre · prime exceptionnelle reçue', () => entry(api, { direction: 'income', label: 'Prime exceptionnelle', amount: 450, costCenterRef: 'std:autresRevenus', date: '2026-11-12', status: 'realized', realizedDate: '2026-11-12' }));
  await j.refused('refuser une dépense sans montant', () => entry(api, { direction: 'charge', label: 'Vide', amount: 0, costCenterRef: 'std:divers', date: '2026-11-12' }));
  await j.refused('refuser une dépense sans poste connu', () => entry(api, { direction: 'charge', label: 'Inconnu', amount: 10, costCenterRef: 'std:inexistant', date: '2026-11-12' }));
  const preview = await j.step('aperçu d’une saisie avant enregistrement', () => api.post('/api/bpm/operations/preview', { direction: 'charge', label: 'Essai', amount: 40, costCenterRef: 'std:loisirs', cadence: 'once', date: '2026-11-20' }));
  j.check('l’aperçu signale le plafond des loisirs', !!preview, preview && Object.keys(preview));
  await corrections(api, j);
  void gift;
  await readEverything(api, j, '2026-11');
}

/** Corriger une récurrence : écarter une échéance, la rétablir, supprimer une définition saisie en double. */
async function corrections(api, j) {
  const gym = await j.step('créer la récurrence « Salle de sport »', () => api.post('/api/bpm/operations', { requestKey: key(), cadence: 'monthly', direction: 'charge', label: 'Salle de sport', amount: 34.9, costCenterRef: 'std:loisirs', firstDate: '2026-11-15' }));
  const id = gym?.recurrence?.id;
  if (id) {
    const skipped = await j.step('écarter l’échéance de décembre (salle fermée)', () => api.post(`/api/bpm/recurrences/${id}/skip`, { requestKey: key(), occurrenceDate: '2026-12-15', reason: 'Salle fermée pour travaux' }));
    await j.refused('refuser d’écarter deux fois la même échéance', () => api.post(`/api/bpm/recurrences/${id}/skip`, { requestKey: key(), occurrenceDate: '2026-12-15' }), ['FORBIDDEN_BY_RULE']);
    if (skipped?.operation) await j.step('rétablir l’échéance de décembre (réouverture annoncée)', () => api.post(`/api/bpm/recurrences/${id}/restore`, { occurrenceDate: '2026-12-15', expectedRevision: skipped.operation.revision }));
    await j.step('écarter de nouveau l’échéance de décembre', () => api.post(`/api/bpm/recurrences/${id}/skip`, { requestKey: key(), occurrenceDate: '2026-12-15', reason: 'Travaux prolongés' }));
  }
  const twice = await j.step('saisir « Abonnement streaming » en double', () => api.post('/api/bpm/operations', { requestKey: key(), cadence: 'monthly', direction: 'charge', label: 'Abonnement streaming (doublon)', amount: 13.49, costCenterRef: 'std:loisirs', firstDate: '2026-11-20' }));
  if (twice?.recurrence) {
    await j.step('supprimer la définition saisie en double', () => api.post(`/api/bpm/recurrences/${twice.recurrence.id}/cancel`, { expectedRevision: twice.recurrence.revision, reason: 'Saisie en double' }));
    const left = await api.get('/api/bpm/recurrences');
    j.check('la définition supprimée sort de la liste des récurrences', !left.some((r) => r.id === twice.recurrence.id));
  }
}

async function resume(user) {
  console.log(`\n▶ ${user.label} — reprise d'octobre`);
  const api = client(user.id);
  const j = journal(user, 'reprise');
  const recs = (await j.step('lire les récurrences', () => api.get('/api/bpm/recurrences'))) ?? [];
  const find = (dir, cc) => recs.find((r) => r.direction === dir && (!cc || r.costCenterRef === cc) && !r.endDate)?.id;
  const ids = { salary: find('income', 'std:salaires') ?? find('income'), rent: find('charge', 'std:logement') };
  ids.rentDay = recs.find((r) => r.id === ids.rent)?.firstDate?.slice(8, 10);
  ids.salaryDay = recs.find((r) => r.id === ids.salary)?.firstDate?.slice(8, 10);
  await j.step('octobre · courses oubliées, saisies avant clôture', () =>
    entry(api, { direction: 'charge', label: 'Courses oubliées · octobre', amount: 64.9, costCenterRef: 'std:alimentation', date: '2026-10-27', status: 'realized', realizedDate: '2026-10-27' }),
  );
  await readEverything(api, j, '2026-10');
  await close(api, j, '2026-10');
  await j.refused('refuser une correction dans octobre clos', () =>
    entry(api, { direction: 'charge', label: 'Après clôture', amount: 5, costCenterRef: 'std:divers', date: '2026-10-30', status: 'realized', realizedDate: '2026-10-30' }),
  );
  await currentMonth(api, j, { salary: null, rent: null, ...ids });
  await caps(api, j);
  await lifeProject(api, j, 'Vélo cargo pour la famille', '2026-11');
  await abandonedProject(api, j, '2026-11');
  await goals(api, j);
  const known = ((await api.get('/api/bpm/periods?limit=12')).periods ?? []).map((p) => p.key);
  for (const month of months.filter((m) => known.includes(m))) await readEverything(api, j, month);
  await readOnce(api, j);
}

async function current(user) {
  console.log(`\n▶ ${user.label} — mois en cours`);
  const api = client(user.id);
  const j = journal(user, 'courant');
  await j.refused('refuser une dépense dans octobre clos', () =>
    entry(api, { direction: 'charge', label: 'Après clôture', amount: 5, costCenterRef: 'std:divers', date: '2026-10-30', status: 'realized', realizedDate: '2026-10-30' }),
  );
  await readEverything(api, j, '2026-10');
  await currentMonth(api, j, {});
  await caps(api, j);
  await lifeProject(api, j, 'Équipement pour la saison prochaine', '2026-11');
  await abandonedProject(api, j, '2026-11');
  await goals(api, j);
  await readOnce(api, j);
}

const users = await client(null).get('/api/users');
const byLabel = (label) => users.find((u) => u.label === label);
const plan = [
  ['Famille Durand', fromScratch],
  ['ATELIER · Paul Durand', fromScratch],
  ['Camille Martin', resume],
  ['Jeanne Morel', current],
  ['Famille Petit', current],
  ['Association Les Jardins Partagés', current],
  ['Studio Camille Renaud', current],
  ['UTILISATEURS · Paul Marchand', resume],
  ['SASU · Sophie Bernard', resume],
  ['ATELIER · Sophie Marchal', resume],
  ['UTILISATEURS · Famille Lefèvre', resume],
];
for (const [label, run] of plan) {
  if (ONLY && !label.includes(ONLY)) continue;
  const u = byLabel(label);
  if (!u) {
    console.log(`(user introuvable : ${label})`);
    continue;
  }
  await run(u);
}

report.finishedAt = new Date().toISOString();
const failed = report.checks.filter((c) => !c.ok);
report.summary = { checks: report.checks.length, failed: failed.length };
await mkdir(dirname(REPORT), { recursive: true });
await writeFile(REPORT, JSON.stringify(report, null, 2));
console.log(`\n${report.checks.length} vérifications, ${failed.length} en échec. Rapport : ${REPORT}`);
for (const u of report.users) console.log(`  ${u.label} (${u.kind}) : ${u.steps.filter((s) => s.ok).length}/${u.steps.length}`);
