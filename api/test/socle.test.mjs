// Socle : Object Management, persistance, registre, noyau (niveau 1) et parcours, sur un
// fichier JSON réel. Reprend les comportements des anciens tests du service J1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSocle, makeUser, key, rejects, operation } from './helpers.mjs';
import { Registry } from '../src/socle/registry.mjs';

const project = (socle, ctx, title = 'Préparer mon installation', extra = {}) => socle.modules.core.createCoreProject(ctx, { requestKey: key('p'), title, ...extra });
const task = (socle, ctx, extra = {}) => socle.modules.core.createTask(ctx, { requestKey: key('t'), title: 'Tâche', ...extra });
const rev = (r) => r.task.revision;
const collectionSizes = (state, socle) => Object.fromEntries(socle.registry.collections().map((c) => [c, Object.keys(state[c]).length]));

// ---------- politique d'identité ----------

test('T-OM-01 IDs : préfixe de la nature déclarée au registre, identifiant opaque', async () => {
  const { socle } = await makeSocle();
  const { ctx, bundle } = await makeUser(socle);
  const expected = { userId: 'user', coreProjectId: 'coreProject', budgetId: 'budget', patrimoineId: 'patrimoine', bpmCompositionId: 'bpmComposition', cycleLinkId: 'cycleLink' };
  for (const [field, kind] of Object.entries(expected)) {
    const id = bundle[field];
    const prefix = socle.registry.kind(kind).prefix;
    assert.match(id, new RegExp(`^${prefix}_[0-9a-f-]{36}$`), `${field} = ${id}`);
    assert.equal(socle.registry.kindOfId(id), kind);
    assert.equal(socle.om.find(socle.state, id).kind, kind);
  }
  const prefixes = [...socle.registry.kinds.values()].map((k) => k.prefix);
  assert.equal(new Set(prefixes).size, prefixes.length, 'un préfixe par nature');
  const a = await project(socle, ctx, 'Même nom');
  const b = await project(socle, ctx, 'Même nom');
  assert.notEqual(a.project.id, b.project.id, 'un libellé n’est jamais une clé');
  assert.equal(a.view.statusLabel, 'À faire');
  assert.equal(a.view.completionPercent, 0);
});

test('T-OM-01 renommer, changer l’état, déplacer conservent l’ID', async () => {
  const { socle } = await makeSocle();
  const core = socle.modules.core;
  const { ctx } = await makeUser(socle);
  const A = await project(socle, ctx, 'A');
  const B = await project(socle, ctx, 'B');
  let t = await task(socle, ctx, { projectId: A.project.id, plannedHours: 3 });
  const id = t.task.id;
  t = await core.updateTask(ctx, id, { expectedRevision: rev(t), title: 'Renommée' });
  t = await core.changeTaskStatus(ctx, id, { expectedRevision: rev(t), status: 'doing' });
  t = await core.attachTask(ctx, id, { expectedRevision: rev(t), projectId: B.project.id });
  assert.equal(t.task.id, id);
  assert.equal(t.task.revision, 4);
  assert.equal(t.task.title, 'Renommée');
  assert.equal(t.task.plannedHours, 3);
});

// ---------- idempotence des créations ----------

test('T-OM-03 même clé + même contenu : mêmes IDs, replayed, y compris après redémarrage', async () => {
  const { socle, reload } = await makeSocle();
  const input = { requestKey: key('u'), label: 'Camille', userType: 'individuel', openingStock: 1000 };
  const first = await socle.modules.users.createUser(input);
  assert.equal(first.replayed, false);
  const again = await socle.modules.users.createUser(input);
  assert.equal(again.replayed, true);
  for (const f of ['userId', 'coreProjectId', 'budgetId', 'patrimoineId', 'bpmCompositionId', 'cycleLinkId']) assert.equal(again[f], first[f]);
  assert.equal(Object.keys(socle.state.users).length, 1);

  const ctx = { userId: first.userId };
  const pInput = { requestKey: key('p'), title: 'Unique' };
  const p1 = await socle.modules.core.createCoreProject(ctx, pInput);
  const socle2 = await reload();
  const p2 = await socle2.modules.core.createCoreProject(ctx, pInput);
  assert.equal(p2.replayed, true);
  assert.equal(p2.project.id, p1.project.id);
  assert.equal(socle2.modules.core.listProjects(ctx).filter((p) => p.project.title === 'Unique').length, 1);
});

test('T-OM-03 même clé avec un autre contenu : IDEMPOTENCY_CONFLICT nommant l’action', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await makeUser(socle);
  const requestKey = key();
  await socle.modules.core.createCoreProject(ctx, { requestKey, title: 'X' });
  const err = await rejects(socle.modules.core.createCoreProject(ctx, { requestKey, title: 'Y' }), 'IDEMPOTENCY_CONFLICT');
  assert.equal(err.action, 'createCoreProject');
  const uKey = key();
  await socle.modules.users.createUser({ requestKey: uKey, label: 'A' });
  await rejects(socle.modules.users.createUser({ requestKey: uKey, label: 'B' }), 'IDEMPOTENCY_CONFLICT');
});

test('T-OM-03 créations concurrentes avec la même clé : un seul objet', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await makeUser(socle);
  const input = { requestKey: key(), title: 'Double clic' };
  const [a, b] = await Promise.all([socle.modules.core.createCoreProject(ctx, input), socle.modules.core.createCoreProject(ctx, input)]);
  assert.equal(a.project.id, b.project.id);
  assert.equal([a.replayed, b.replayed].filter(Boolean).length, 1);
});

// ---------- concurrence ----------

test('version périmée : STALE_VERSION, rien d’écrasé', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await makeUser(socle);
  const p = await project(socle, ctx, 'Original');
  await socle.modules.core.updateCoreProject(ctx, p.project.id, { expectedRevision: 1, title: 'Plus récent' });
  const err = await rejects(socle.modules.core.updateCoreProject(ctx, p.project.id, { expectedRevision: 1, title: 'Ancien' }), 'STALE_VERSION');
  assert.equal(err.details.currentRevision, 2);
  assert.equal(err.details.current.title, 'Plus récent');
  assert.equal(socle.modules.core.readProjectDetail(ctx, p.project.id).project.title, 'Plus récent');
  await rejects(socle.modules.core.updateCoreProject(ctx, p.project.id, { title: 'Sans version' }), 'VALIDATION');
});

test('mutations concurrentes sérialisées : aucune écriture perdue, une seule gagnante par version', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await makeUser(socle);
  const startRev = socle.state.revision;
  const created = await Promise.all(Array.from({ length: 12 }, (_, i) => task(socle, ctx, { title: `T${i}` })));
  assert.equal(new Set(created.map((c) => c.task.id)).size, 12);
  assert.equal(socle.state.revision, startRev + 12, 'une révision du stockage par écriture');
  const id = created[0].task.id;
  const results = await Promise.allSettled([
    socle.modules.core.changeTaskStatus(ctx, id, { expectedRevision: 1, status: 'doing' }),
    socle.modules.core.changeTaskStatus(ctx, id, { expectedRevision: 1, status: 'blocked' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'STALE_VERSION');
  assert.equal(socle.state.tasks[id].revision, 2);
});

// ---------- interruption injectée ----------

test('T-OM-03 / J1-OM-05 interruption avant enregistrement : rien de publié, puis reprise', async () => {
  const { socle, reload } = await makeSocle({ faultInjection: true });
  const requestKey = key();
  const empty = collectionSizes(socle.state, socle);
  await rejects(socle.modules.users.createUser({ requestKey, label: 'U1', _fault: 'before-commit' }), 'INJECTED_INTERRUPTION');
  let s2 = await reload();
  assert.deepEqual(collectionSizes(s2.state, s2), empty, 'aucun ensemble partiel publié');
  assert.equal(Object.keys(s2.state.creationRequests).length, 0);
  const r = await s2.modules.users.createUser({ requestKey, label: 'U1' });
  assert.equal(r.replayed, false);
  s2 = await reload();
  for (const c of ['users', 'coreProjects', 'budgets', 'patrimoines', 'bpmCompositions', 'cycleLinks']) assert.equal(Object.keys(s2.state[c]).length, 1, c);
});

test('interruption injectée refusée si l’injection n’est pas activée', async () => {
  const { socle } = await makeSocle({ faultInjection: false });
  await rejects(socle.modules.users.createUser({ requestKey: key(), label: 'U1', _fault: 'before-commit' }), 'VALIDATION');
  assert.equal(Object.keys(socle.state.users).length, 0);
});

test('T-OM-03 interruption pendant un projet de la vie puis reprise idempotente', async () => {
  const { socle, reload } = await makeSocle();
  const { ctx } = await makeUser(socle);
  const input = { requestKey: key(), name: 'Installation', tasks: [{ title: 'Signer le bail' }] };
  await rejects(socle.modules.bpm.createLifeProject(ctx, { ...input, _fault: 'before-commit' }), 'INJECTED_INTERRUPTION');
  const s2 = await reload();
  assert.equal(Object.values(s2.state.budgets).filter((b) => b.role === 'standard').length, 0);
  await s2.modules.bpm.createLifeProject(ctx, input);
  const again = await s2.modules.bpm.createLifeProject(ctx, input);
  assert.equal(again.replayed, true);
  assert.equal(Object.values(s2.state.budgets).filter((b) => b.role === 'standard').length, 1);
  assert.equal(Object.keys(s2.state.tasks).length, 1);
});

// ---------- triplet et composition ----------

test('T-OM-02 chaîne principale : IDs distincts, racine noyau commune, type porté par le Budget', async () => {
  const { socle } = await makeSocle();
  const { bundle } = await makeUser(socle);
  const st = socle.state;
  const b = st.budgets[bundle.budgetId];
  const p = st.patrimoines[bundle.patrimoineId];
  const root = st.coreProjects[bundle.coreProjectId];
  assert.notEqual(b.id, p.id);
  assert.equal(b.coreProjectId, root.id);
  assert.equal(p.coreProjectId, root.id);
  assert.equal(b.role, 'life');
  assert.equal(b.name, 'Projet de vie');
  assert.equal(root.role, undefined, 'aucun type de Budget porté par le projet noyau');
  assert.equal(st.bpmCompositions[bundle.bpmCompositionId].patrimoineId, p.id);
});

test('J1-OM-04 unicité du triplet : second Budget « Projet de vie » ou second Patrimoine refusés', async () => {
  const { socle } = await makeSocle();
  const { ctx, bundle } = await makeUser(socle);
  const { budget, patrimoine } = socle.modules;
  const before = structuredClone(socle.state);
  await rejects(socle.om.command('essai', ctx, {}, (tx) => budget.buildLifeBudget(tx, { coreProjectId: bundle.coreProjectId })), 'UNIQUENESS_VIOLATION');
  await rejects(
    socle.om.command('essai', ctx, {}, (tx) => patrimoine.buildPatrimoine(tx, { coreProjectId: bundle.coreProjectId, principalBudgetId: bundle.budgetId, openingStock: 10 })),
    'UNIQUENESS_VIOLATION',
  );
  assert.deepEqual(socle.state, before);
});

test('composition atomique : un échec en cours de composition ne publie aucun objet', async () => {
  const { socle, reload } = await makeSocle();
  const empty = collectionSizes(socle.state, socle);
  await rejects(socle.modules.users.createUser({ requestKey: key(), label: 'X', userType: 'inconnu' }), 'VALIDATION');
  // L'objectif invalide échoue après user, projet noyau et Budget dans le brouillon.
  await rejects(socle.modules.users.createUser({ requestKey: key(), label: 'Y', objective: -5 }), 'VALIDATION');
  await rejects(socle.modules.users.createUser({ requestKey: key(), label: 'Z', anchorDay: 31 }), 'VALIDATION');
  assert.deepEqual(collectionSizes(socle.state, socle), empty);
  assert.equal(socle.state.journal.length, 0);
  assert.equal(Object.keys(socle.state.creationRequests).length, 0);
  const s2 = await reload();
  assert.deepEqual(collectionSizes(s2.state, s2), empty);
});

test('T-OM-02 J1-OM-07 deux projets de la vie : racines propres, même père, un seul Patrimoine', async () => {
  const { socle } = await makeSocle();
  const { ctx, bundle } = await makeUser(socle);
  const mk = (name) => socle.modules.bpm.createLifeProject(ctx, { requestKey: key(), name, tasks: [{ title: `${name} - tâche` }] });
  const b2 = await mk('Installation');
  const b3 = await mk('Voyage');
  assert.notEqual(b2.coreProjectId, b3.coreProjectId);
  assert.notEqual(b2.coreProjectId, bundle.coreProjectId);
  assert.equal(b2.parentBudgetId, bundle.budgetId);
  assert.equal(socle.state.budgets[b2.budgetId].parentBudgetId, bundle.budgetId);
  assert.equal(Object.keys(socle.state.patrimoines).length, 1);
  const t = socle.modules.core.listTasks(ctx).find((x) => x.task.id === b2.taskIds[0]);
  assert.equal(t.qualification.code, 'budgetedProjectTask');
  assert.equal(t.qualification.budgetIdDerived, b2.budgetId);
  assert.equal(t.task.budgetId, undefined, 'pas de Budget stocké dans la tâche');
  assert.ok(socle.inspector.checks(socle.state).every((c) => c.result !== 'failed'));
});

test('projet de la vie : au moins une tâche, père = Budget « Projet de vie »', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await makeUser(socle);
  await rejects(socle.modules.bpm.createLifeProject(ctx, { requestKey: key(), name: 'Vide', tasks: [] }), 'VALIDATION');
  await rejects(socle.modules.bpm.createLifeProject(ctx, { requestKey: key(), name: 'Sans tâches' }), 'VALIDATION');
  assert.equal(Object.values(socle.state.budgets).filter((b) => b.role === 'standard').length, 0);
  const b2 = await socle.modules.bpm.createLifeProject(ctx, { requestKey: key(), name: 'B', tasks: [{ title: 't' }] });
  await rejects(
    socle.om.command('essai', ctx, {}, (tx) => {
      const root = socle.modules.core.buildProject(tx, { title: 'C' });
      return socle.modules.budget.buildStandardBudget(tx, { coreProjectId: root.id, parentBudgetId: b2.budgetId, name: 'C' });
    }),
    'INCOMPATIBLE_REFERENCE',
  );
});

// ---------- références ----------

test('T-OM-04 référence absente, mauvaise nature, autre user : refus sans mutation', async () => {
  const { socle } = await makeSocle();
  const core = socle.modules.core;
  const { ctx, bundle } = await makeUser(socle, { label: 'U1' });
  const { ctx: ctx2 } = await makeUser(socle, { label: 'U2' });
  const other = await project(socle, ctx2, 'Projet de U2');
  const t = await task(socle, ctx, { plannedHours: 4, spentHours: 1 });
  const before = structuredClone(socle.state);
  await rejects(core.attachTask(ctx, t.task.id, { expectedRevision: 1, projectId: 'prj_inexistant' }), 'REFERENCE_NOT_FOUND');
  await rejects(core.attachTask(ctx, t.task.id, { expectedRevision: 1, projectId: bundle.budgetId }), 'INCOMPATIBLE_REFERENCE');
  await rejects(core.attachTask(ctx, t.task.id, { expectedRevision: 1, projectId: other.project.id }), 'INCOMPATIBLE_REFERENCE');
  await rejects(task(socle, ctx, { projectId: other.project.id }), 'INCOMPATIBLE_REFERENCE');
  await rejects(task(socle, ctx, { projectId: 'prj_00000000-0000-0000-0000-000000000000' }), 'REFERENCE_NOT_FOUND');
  await rejects(task(socle, ctx, { projectId: bundle.patrimoineId }), 'INCOMPATIBLE_REFERENCE');
  assert.deepEqual(socle.state, before);
  await rejects(async () => core.readTask(ctx2, t.task.id), 'NOT_FOUND');
  await rejects(async () => core.listProjects({ userId: null }), 'CONTEXT_REQUIRED');
});

// ---------- noyau : états dérivés et temps ----------

test('T-NOY-02 séquence lisible des états sur A et B (J1-DATA-02)', async () => {
  const { socle } = await makeSocle();
  const core = socle.modules.core;
  const { ctx } = await makeUser(socle);
  const A = (await project(socle, ctx, 'A')).project.id;
  const B = (await project(socle, ctx, 'B')).project.id;
  let t1 = await task(socle, ctx, { title: 'T1', projectId: A });
  let t2 = await task(socle, ctx, { title: 'T2', projectId: A });
  const label = (id) => core.readProjectDetail(ctx, id).view.statusLabel;
  assert.equal(label(A), 'À faire');
  t1 = await core.changeTaskStatus(ctx, t1.task.id, { expectedRevision: rev(t1), status: 'done' });
  assert.equal(label(A), 'En pause');
  t2 = await core.changeTaskStatus(ctx, t2.task.id, { expectedRevision: rev(t2), status: 'blocked' });
  assert.equal(label(A), 'À reprendre');
  t2 = await core.changeTaskStatus(ctx, t2.task.id, { expectedRevision: rev(t2), status: 'doing' });
  assert.equal(label(A), 'À finir');
  t2 = await core.attachTask(ctx, t2.task.id, { expectedRevision: rev(t2), projectId: B });
  assert.equal(label(A), 'Terminée');
  assert.equal(label(B), 'En cours');
  assert.deepEqual(t2.affectedProjects.map((p) => p.project.id).sort(), [A, B].sort());
  t2 = await core.detachTask(ctx, t2.task.id, { expectedRevision: rev(t2) });
  assert.equal(label(B), 'À faire');
  assert.equal(t2.task.projectId, null);
  assert.equal(t2.task.status, 'doing');
  assert.equal(t2.qualification.code, 'standalone');
});

test('T-NOY-02 tâche autonome sans effet sur les projets', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await makeUser(socle);
  const A = (await project(socle, ctx, 'A')).project.id;
  const t = await task(socle, ctx);
  await socle.modules.core.changeTaskStatus(ctx, t.task.id, { expectedRevision: 1, status: 'done' });
  assert.equal(socle.modules.core.readProjectDetail(ctx, A).view.statusLabel, 'À faire');
});

test('T-NOY-03 scénarios chiffrés du temps (§22)', async () => {
  const { socle } = await makeSocle();
  const core = socle.modules.core;
  const { ctx } = await makeUser(socle);
  const A = (await project(socle, ctx, 'A')).project.id;
  let t1 = await task(socle, ctx, { title: 'T1', projectId: A, plannedHours: 10, spentHours: 4, status: 'doing' });
  await task(socle, ctx, { title: 'T2', projectId: A, plannedHours: 5, spentHours: 5, status: 'done' });
  let d = core.readProjectDetail(ctx, A);
  assert.deepEqual([d.view.time.plannedHoursKnown, d.view.time.spentHoursTotal, d.view.completionPercent, d.view.statusLabel, d.view.column], [15, 9, 50, 'À finir', 'doing']);
  assert.equal(d.view.time.spentToPlannedPercent, 60);

  t1 = await core.setTaskTime(ctx, t1.task.id, { expectedRevision: rev(t1), spentHours: 12 });
  d = core.readProjectDetail(ctx, A);
  assert.deepEqual([d.view.time.spentHoursTotal, d.view.completionPercent, d.view.statusLabel], [17, 50, 'À finir']);
  assert.equal(t1.task.status, 'doing', 'aucun changement automatique d’état');

  const replay = await core.setTaskTime(ctx, t1.task.id, { expectedRevision: rev(t1), spentHours: 12 });
  assert.equal(replay.written, false, 'rejouer une saisie n’ajoute rien');

  t1 = await core.setTaskTime(ctx, t1.task.id, { expectedRevision: rev(t1), spentHours: 3 });
  d = core.readProjectDetail(ctx, A);
  assert.deepEqual([d.view.time.spentHoursTotal, d.view.time.plannedHoursKnown, d.view.statusLabel], [8, 15, 'À finir']);

  await task(socle, ctx, { title: 'T3', projectId: A, spentHours: 2 });
  d = core.readProjectDetail(ctx, A);
  assert.deepEqual(
    [d.view.time.plannedHoursKnown, d.view.time.estimatedTaskCount, d.view.time.taskCount, d.view.time.spentHoursTotal, d.view.completionPercent, d.view.statusLabel],
    [15, 2, 3, 10, 33, 'À finir'],
  );
  assert.equal(d.view.time.plannedIsPartial, true);
});

test('T-NOY-03 déplacement puis détachement : temps conservés', async () => {
  const { socle } = await makeSocle();
  const core = socle.modules.core;
  const { ctx } = await makeUser(socle);
  const A = (await project(socle, ctx, 'A')).project.id;
  const B = (await project(socle, ctx, 'B')).project.id;
  let t1 = await task(socle, ctx, { title: 'T1', projectId: A, plannedHours: 10, spentHours: 4, status: 'doing' });
  await task(socle, ctx, { title: 'T2', projectId: A, plannedHours: 5, spentHours: 5, status: 'done' });
  t1 = await core.attachTask(ctx, t1.task.id, { expectedRevision: rev(t1), projectId: B });
  const a = core.readProjectDetail(ctx, A).view;
  const b = core.readProjectDetail(ctx, B).view;
  assert.deepEqual([a.time.plannedHoursKnown, a.time.spentHoursTotal, a.completionPercent, a.statusLabel], [5, 5, 100, 'Terminée']);
  assert.deepEqual([b.time.plannedHoursKnown, b.time.spentHoursTotal, b.completionPercent, b.statusLabel], [10, 4, 0, 'En cours']);
  t1 = await core.detachTask(ctx, t1.task.id, { expectedRevision: rev(t1) });
  const b2 = core.readProjectDetail(ctx, B).view;
  assert.deepEqual([b2.time.taskCount, b2.completionPercent, b2.statusLabel], [0, 0, 'À faire']);
  assert.deepEqual([t1.task.plannedHours, t1.task.spentHours], [10, 4]);
});

test('T-NOY-03 valeurs invalides refusées, estimation absente distincte de 0', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await makeUser(socle);
  await rejects(task(socle, ctx, { plannedHours: -1 }), 'VALIDATION');
  await rejects(task(socle, ctx, { spentHours: Number.NaN }), 'VALIDATION');
  await rejects(task(socle, ctx, { plannedHours: '3' }), 'VALIDATION');
  await rejects(task(socle, ctx, { title: '   ' }), 'VALIDATION');
  await rejects(task(socle, ctx, { status: 'perdue' }), 'VALIDATION');
  await rejects(task(socle, ctx, { startDate: '2026-11-10', dueDate: '2026-11-01' }), 'VALIDATION');
  await rejects(task(socle, ctx, { requestKey: 'court' }), 'VALIDATION');
  const t = await task(socle, ctx);
  assert.equal(t.task.plannedHours, null);
  assert.equal(t.task.spentHours, 0);
  const z = await task(socle, ctx, { plannedHours: 0 });
  assert.equal(z.task.plannedHours, 0);
});

// ---------- parcours ----------

test('T-PARC-01 parcours : racine principale, branche budgétisée, projet générique', async () => {
  const { socle } = await makeSocle();
  const core = socle.modules.core;
  const { ctx, bundle } = await makeUser(socle);
  const root = core.readProjectDetail(ctx, bundle.coreProjectId);
  assert.equal(root.pathways.canAddTask, false);
  assert.equal(root.pathways.isTaskDestination, false);
  assert.equal(root.pathways.tasksCanChangeProject, false);
  assert.equal(root.enrichment.kind, 'life');
  assert.equal(root.view.statusLabel, 'À faire');

  const life = await socle.modules.bpm.createLifeProject(ctx, { requestKey: key(), name: 'Voyage', tasks: [{ title: 'Billets' }] });
  const branch = core.readProjectDetail(ctx, life.coreProjectId);
  assert.equal(branch.enrichment.kind, 'standard');
  assert.equal(branch.pathways.canAddTask, true);
  // Règle du 4 novembre 2026 : le rattachement se fait depuis le noyau comme depuis BPM ; une tâche qui porte des
  // données du budget de son projet est retenue par la garde `taskMoveGuard` (voir projects.test.mjs).
  assert.equal(branch.pathways.tasksCanChangeProject, true);
  assert.equal(branch.tasks[0].pathways.canChangeProject, true);
  assert.equal(core.readProjectDetail(ctx, bundle.coreProjectId).branches.length, 1);

  const generic = await project(socle, ctx, 'Générique');
  assert.deepEqual(
    [generic.pathways.canAddTask, generic.pathways.isTaskDestination, generic.pathways.tasksCanChangeProject],
    [true, true, true],
  );
  assert.equal(generic.enrichment, null);

  assert.ok(socle.inspector.checks(socle.state).every((c) => c.result === 'passed' || c.result === 'not-run'));
  // Essai bas niveau explicite : le stockage n'est jamais interdit par un parcours.
  const t = await task(socle, ctx, { projectId: bundle.coreProjectId });
  assert.equal(t.qualification.code, 'principalRootTask');
  const checks = socle.inspector.checks(socle.state);
  assert.ok(checks.some((c) => c.rule === 'P-IHM-01' && c.result === 'warning' && c.ids.includes(t.task.id)));
  assert.ok(checks.every((c) => c.result !== 'failed'), 'écart de parcours, pas corruption');
  assert.equal(socle.inspector.inventory(socle.state).find((r) => r.id === t.task.id).control, 'warning');
});

test('fin d’un projet de la vie : racine Terminée, principal inchangé', async () => {
  const { socle } = await makeSocle();
  const core = socle.modules.core;
  const { ctx, bundle } = await makeUser(socle);
  const br = await socle.modules.bpm.createLifeProject(ctx, { requestKey: key(), name: 'B', tasks: [{ title: 't1' }, { title: 't2' }] });
  for (const id of br.taskIds) await core.changeTaskStatus(ctx, id, { expectedRevision: 1, status: 'done' });
  assert.equal(core.readProjectDetail(ctx, br.coreProjectId).view.statusLabel, 'Terminée');
  assert.equal(socle.state.budgets[bundle.budgetId].revision, 1);
  assert.equal(socle.state.patrimoines[bundle.patrimoineId].revision, 1);
  assert.equal(core.readProjectDetail(ctx, bundle.coreProjectId).view.statusLabel, 'À faire');
});

// ---------- Object Management : inspection, contrôles, exports ----------

async function seedLike() {
  const made = await makeSocle();
  const { socle } = made;
  const { ctx, bundle } = await makeUser(socle, { label: 'Camille', openingStock: 12000, objective: 50000, anchorDay: 1, cycleStartDate: '2026-08-01' });
  await makeUser(socle, { label: 'Famille Durand', userType: 'famille', objective: 80000 });
  await operation(socle, ctx, { direction: 'income', label: 'Salaire', amount: 3200, date: '2026-08-01' });
  await operation(socle, ctx, { direction: 'charge', label: 'Loyer', amount: 950, date: '2026-08-05', costCenterRef: 'std:logement' });
  await operation(socle, ctx, { direction: 'charge', label: 'Courses', amount: 120, date: '2026-11-20', status: 'planned', costCenterRef: 'std:alimentation' });
  const streaming = await socle.modules.budget.createCategory(ctx, { requestKey: key(), label: 'Streaming', costCenterRef: 'std:loisirs', cap: 20 });
  await socle.modules.budget.createRecurrence(ctx, { requestKey: key(), direction: 'charge', label: 'Abonnement', amount: 15, cadence: 'monthly', firstDate: '2026-09-10', costCenterRef: 'std:loisirs', categoryId: streaming.category.id });
  await socle.modules.bpm.closePeriod(ctx, { requestKey: key(), periodKey: '2026-08' });
  const life = await socle.modules.bpm.createLifeProject(ctx, { requestKey: key(), name: 'Voyage au Japon', tasks: [{ title: 'Réserver les vols', plannedHours: 3 }, { title: 'Demander le visa' }] });
  const generic = await project(socle, ctx, 'Exemple');
  await task(socle, ctx, { projectId: generic.project.id, plannedHours: 10, spentHours: 4, status: 'doing' });
  await task(socle, ctx, { title: 'Autonome' });
  return { ...made, ctx, bundle, life };
}

test('Object Management : contrôles tous réussis sur un scénario propre', async () => {
  const { socle } = await seedLike();
  const checks = socle.inspector.checks(socle.state);
  for (const c of checks) {
    if (c.category === 'not-implemented') assert.equal(c.result, 'not-run', `${c.rule} non exécuté ≠ réussi`);
    else assert.equal(c.result, 'passed', `${c.rule} : ${c.observed}`);
  }
  for (const rule of ['OM-ID-01', 'OM-REF-01', 'OM-REQ-01', 'VIE-01', 'PAT-01', 'BPM-01', 'CLO-01', 'BUD-CC-01']) assert.ok(checks.some((c) => c.rule === rule), rule);
});

test('Object Management : inventaire par niveau, inspection d’un objet et relations', async () => {
  const { socle, bundle, life } = await seedLike();
  const inv = socle.inspector.inventory(socle.state);
  const levelOf = (kind) => [...new Set(inv.filter((r) => r.kind === kind).map((r) => r.level))];
  assert.deepEqual(levelOf('user'), [0]);
  assert.deepEqual(levelOf('coreProject'), [1]);
  assert.deepEqual(levelOf('task'), [1]);
  assert.deepEqual(levelOf('budget'), [2]);
  assert.deepEqual(levelOf('operation'), [2]);
  assert.deepEqual(levelOf('patrimoine'), [2]);
  assert.deepEqual(levelOf('capitalization'), [2]);
  assert.deepEqual(levelOf('bpmComposition'), [3]);
  assert.deepEqual(levelOf('closure'), [3]);
  assert.equal(inv.find((r) => r.kind === 'closure').levelLabel, 'Niveau 3 · Application');
  const scoped = socle.inspector.inventory(socle.state, { scope: bundle.userId });
  assert.ok(scoped.length > 0 && scoped.every((r) => r.userId === bundle.userId));
  assert.ok(scoped.length < inv.length);
  assert.ok(socle.inspector.inventory(socle.state, { kind: 'budget' }).every((r) => r.kind === 'budget'));
  assert.deepEqual(socle.inspector.inventory(socle.state, { q: 'japon' }).map((r) => r.id).sort(), [life.budgetId, life.coreProjectId].sort());

  const ins = socle.inspector.inspectObject(socle.state, life.budgetId);
  assert.equal(ins.nature.kind, 'budget');
  assert.equal(ins.nature.level, 2);
  assert.ok(ins.outgoing.some((r) => r.relation === 'parentBudgetId' && r.targetId === bundle.budgetId));
  assert.ok(ins.creationRequest.createdObjects.some((c) => c.id === life.budgetId));
  assert.ok(ins.journal.length >= 1);
  const insRoot = socle.inspector.inspectObject(socle.state, bundle.coreProjectId);
  assert.ok(insRoot.incoming.some((r) => r.sourceId === bundle.budgetId));
  assert.equal(insRoot.coreProject.enrichment.kind, 'life');
  assert.equal(socle.inspector.inspectObject(socle.state, 'prj_inexistant'), null);
});

test('T-DATA-01 exportDebug : lecture sans mutation, instantané stable, non exécuté ≠ réussi', async () => {
  const { socle } = await seedLike();
  const before = JSON.stringify(socle.state);
  const a = socle.inspector.exportDebug(socle.state);
  const b = socle.inspector.exportDebug(socle.state);
  assert.equal(JSON.stringify(socle.state), before);
  assert.equal(a.snapshotId, b.snapshotId);
  assert.equal(a.schemaVersion, 'socle-debug/0.3');
  assert.equal(a.storeRevision, socle.state.revision);
  for (const c of socle.registry.collections()) assert.ok(Array.isArray(a.objects[c]), c);
  for (const v of ['tachesProjets', 'projets', 'budgets', 'operations', 'capitalisations', 'assemblages', 'clotures']) assert.ok(Array.isArray(a.views[v]), v);
  assert.equal(a.views.assemblages[0].coreProjectShared, true);
  assert.deepEqual(a.modules.map((m) => m.id), ['navigation', 'users', 'administration', 'object-management', 'calendar', 'core', 'budget', 'patrimoine', 'bpm']);
  assert.ok(a.parameters.some((p) => p.key === 'metric.bpm.resultatPeriode'));
  assert.ok(a.relations.length > 0 && a.relations.some((r) => r.derived));
  assert.ok(a.creationReceipts.length > 0);
  assert.equal(a.checks.find((c) => c.category === 'not-implemented').result, 'not-run');
  assert.deepEqual(a.review, { decision: 'pending', reviewer: null });
});

test('exports CSV : chaque fichier déclaré s’exporte avec un en-tête', async () => {
  const { socle, bundle } = await seedLike();
  const files = socle.inspector.csvFiles();
  for (const f of ['objets.csv', 'relations.csv', 'taches-projets.csv', 'budgets.csv', 'operations.csv', 'capitalisations.csv', 'assemblages.csv', 'clotures.csv']) assert.ok(files.includes(f), f);
  for (const f of files) {
    for (const scope of ['all', bundle.userId]) {
      const csv = socle.inspector.exportCsv(socle.state, f, scope);
      assert.equal(typeof csv, 'string', f);
      const [header, ...rows] = csv.trimEnd().split('\n');
      assert.ok(header.split(',').includes('snapshotId'), `${f} : en-tête ${header}`);
      if (scope === 'all') assert.ok(rows.length > 0, `${f} non vide`);
    }
  }
  assert.equal(socle.inspector.exportCsv(socle.state, 'inconnu.csv'), null);
});

test('persistance : rechargement depuis le disque à l’identique', async () => {
  const { socle, reload } = await seedLike();
  const s2 = await reload();
  assert.deepEqual(s2.state, socle.state);
  assert.deepEqual(s2.inspector.checks(s2.state), socle.inspector.checks(socle.state));
});

// ---------- registre ----------

test('registre : dépendance vers un niveau supérieur, préfixe ou nature en double refusés', () => {
  const r = new Registry();
  r.register({ id: 'base', level: 1, kinds: { a: { collection: 'as', prefix: 'aa', label: 'A' } } });
  r.register({ id: 'app', level: 3, dependsOn: ['base'], kinds: {} });
  assert.throws(() => r.register({ id: 'mid', level: 2, dependsOn: ['app'] }), /Dépendance interdite/);
  assert.throws(() => r.register({ id: 'avant', level: 2, dependsOn: ['absent'] }), /absent/);
  assert.throws(() => r.register({ id: 'dup', level: 2, kinds: { b: { collection: 'bs', prefix: 'aa', label: 'B' } } }), /Préfixe/);
  assert.throws(() => r.register({ id: 'dup2', level: 2, kinds: { a: { collection: 'as2', prefix: 'zz', label: 'A' } } }), /Nature/);
  assert.throws(() => r.register({ id: 'base', level: 1 }), /déjà enregistré/);
  // Un module transverse (niveau 0) peut être une dépendance de n'importe quel niveau.
  r.register({ id: 'trans', level: 0 });
  assert.doesNotThrow(() => r.register({ id: 'n1', level: 1, dependsOn: ['trans', 'base'] }));
  assert.equal(r.kindOfId('aa_123'), 'a');
  assert.equal(r.kindOfId('zz_123'), null);
});
