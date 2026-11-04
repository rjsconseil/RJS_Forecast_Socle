// Corrections C01 à C11 et exemples financiers de recette (§15) : un test par exigence,
// sur un socle complet et un fichier de stockage réel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { createSocle } from '../src/socle/index.mjs';
import { SOCLE_MODULES } from '../src/modules/index.mjs';
import { at, camille, key, makeSocle, makeUser, operation, rejects } from './helpers.mjs';

const RESULT = 'bpm.resultatPeriode';
const close = (socle, ctx, periodKey, extra = {}) => socle.modules.bpm.closePeriod(ctx, { requestKey: key('clo'), periodKey, ...extra });
const value = (socle, ctx, k, periodKey) => socle.modules.bpm.figure(ctx, k, { periodKey }).value;

/** Lecture d'une archive ZIP « stored » (sans compression), telle que produite par zipStore. */
function unzip(buf) {
  const files = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString('utf8');
    const start = i + 30 + nameLen + extraLen;
    files[name] = buf.subarray(start, start + size).toString('utf8');
    i = start + size;
  }
  return files;
}

// ---------- C01 : une période close montre les résultats enregistrés ----------

test('C01 période close : chiffres enregistrés à la clôture, recalcul comparatif séparé', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  await operation(socle, ctx, { direction: 'income', amount: 3000, date: '2026-08-10' });
  await operation(socle, ctx, { direction: 'charge', amount: 1250, date: '2026-08-12' });
  await close(socle, ctx, '2026-08');
  await socle.modules.administration.setParameter(`metric.${RESULT}`, { value: 'bpm.revenus - bpm.charges - 100', expectedRevision: 0 });

  const d = socle.modules.bpm.dashboard(ctx, { periodKey: '2026-08' });
  assert.equal(d.figures[RESULT].value, 1750, 'valeur enregistrée, pas la formule courante');
  assert.equal(d.figures[RESULT].recorded, true);
  assert.equal(d.figures[RESULT].formula, 'bpm.revenus - bpm.charges');
  assert.equal(d.figures['bpm.revenus'].value, 3000);
  const cmp = d.comparison.find((c) => c.key === RESULT);
  assert.deepEqual([cmp.recorded, cmp.recomputed, cmp.currentFormula], [1750, 1650, 'bpm.revenus - bpm.charges - 100']);
  const f = socle.modules.bpm.figure(ctx, RESULT, { periodKey: '2026-08' });
  assert.deepEqual([f.value, f.recorded, f.comparison.recomputed], [1750, true, 1650]);
  // Une période ouverte suit la formule courante, sans comparaison.
  const sept = socle.modules.bpm.dashboard(ctx, { periodKey: '2026-09' });
  assert.equal(sept.figures[RESULT].recorded, undefined);
  assert.deepEqual(sept.comparison, []);
});

// ---------- C02 : un seul contrat pour l'aperçu et la commande ----------

test('C02 confirmation de clôture : montant capitalisé indépendant de l’ordre des cartes, relecture si les données changent', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const bpm = socle.modules.bpm;
  await operation(socle, ctx, { direction: 'income', amount: 3000, date: '2026-08-10' });
  await operation(socle, ctx, { direction: 'charge', amount: 1250, date: '2026-08-12' });
  const before = bpm.closingPreview(ctx, '2026-08');
  assert.deepEqual([before.resultCents, before.stockBefore, before.stockAfter, before.capitalizationDate], [175000, 12000, 13750, '2026-08-31']);

  // Ordre des sections et des cartes inversé : l'aperçu ne bouge pas.
  const sections = structuredClone(bpm.dashboard(ctx).sections).reverse().map((s) => ({ ...s, metrics: [...s.metrics].reverse() }));
  await socle.modules.administration.setParameter('bpm.tableauDeBord', { value: sections, expectedRevision: 0 });
  assert.deepEqual(bpm.dashboard(ctx, { periodKey: '2026-08' }).closing.preview, before);

  // Donnée modifiée après l'aperçu : la commande refuse et renvoie l'aperçu à relire.
  await operation(socle, ctx, { direction: 'charge', amount: 50, date: '2026-08-20' });
  const err = await rejects(close(socle, ctx, '2026-08', { expectedResultCents: before.resultCents }), 'CLOSING_PREVIEW_STALE');
  assert.equal(err.details.preview.resultCents, 170000);
  assert.equal(Object.keys(socle.state.closures).length, 0, 'rien n’est clôturé');

  const fresh = bpm.closingPreview(ctx, '2026-08');
  const r = await close(socle, ctx, '2026-08', { expectedResultCents: fresh.resultCents });
  assert.equal(r.closure.resultCents, fresh.resultCents);
  assert.equal(socle.state.capitalizations[r.closure.capitalizationId].amountCents, fresh.resultCents);
});

// ---------- C03 : aucune réalisation future ----------

test('C03 réalisation future refusée à la création et à la réalisation, revenus et charges, brouillon conservé', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const n = () => Object.keys(socle.state.operations).length;
  for (const direction of ['income', 'charge']) {
    const err = await rejects(operation(socle, ctx, { direction, amount: 10, date: '2026-11-03', realizedDate: '2026-11-04' }), 'FUTURE_REALIZATION');
    assert.equal(err.details.field, 'realizedDate');
    assert.match(err.message, /futur/);
  }
  assert.equal(n(), 0);
  const planned = await operation(socle, ctx, { direction: 'charge', amount: 80, date: '2026-11-20', status: 'planned' });
  const id = planned.operation.id;
  await rejects(socle.modules.budget.realizeOperation(ctx, id, { expectedRevision: 1 }), 'FUTURE_REALIZATION');
  await rejects(socle.modules.budget.realizeOperation(ctx, id, { expectedRevision: 1, realizedDate: '2026-12-01' }), 'FUTURE_REALIZATION');
  const op = socle.state.operations[id];
  assert.deepEqual([op.status, op.revision, op.realizedDate], ['planned', 1, null], 'aucun changement de statut silencieux');
  // Réglée aujourd'hui : acceptée, puis un second règlement est refusé.
  await socle.modules.budget.realizeOperation(ctx, id, { expectedRevision: 1, realizedDate: '2026-11-03' });
  await rejects(socle.modules.budget.realizeOperation(ctx, id, { expectedRevision: 2, realizedDate: '2026-11-03' }), 'ALREADY_SETTLED');
});

// ---------- C04 : net réalisé et solde attendu ----------

test('C04 net réalisé = reçu − payé ; solde attendu = net + à recevoir − à payer ; budget initial distinct', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  await operation(socle, ctx, { direction: 'income', amount: 100, realizedAmount: 120, date: '2026-11-02' });
  await operation(socle, ctx, { direction: 'charge', amount: 50, date: '2026-11-20', status: 'planned' });
  const f = (k) => value(socle, ctx, k);
  assert.equal(f(RESULT), 120);
  assert.equal(f('bpm.soldeAttendu'), 70);
  assert.equal(f('bpm.resultatPrevu'), 50, 'budget initial : référence distincte');
});

test('§15 exemples : net 1000 / attendu 800 ; net −200 / attendu +50', async () => {
  const { socle } = await makeSocle();
  const a = (await camille(socle)).ctx;
  await operation(socle, a, { direction: 'income', amount: 1000, date: '2026-11-01' });
  await operation(socle, a, { direction: 'charge', amount: 200, date: '2026-11-25', status: 'planned' });
  assert.deepEqual([value(socle, a, RESULT), value(socle, a, 'bpm.soldeAttendu')], [1000, 800]);

  const b = (await makeUser(socle, { label: 'B', anchorDay: 1, cycleStartDate: '2026-08-01' })).ctx;
  await operation(socle, b, { direction: 'charge', amount: 200, date: '2026-11-02' });
  await operation(socle, b, { direction: 'income', amount: 250, date: '2026-11-28', status: 'planned' });
  assert.deepEqual([value(socle, b, RESULT), value(socle, b, 'bpm.soldeAttendu')], [-200, 50]);
});

test('§15 stock négatif : −500 puis résultat −200 → −700, capitalisé une seule fois', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await makeUser(socle, { openingStock: -500, anchorDay: 1, cycleStartDate: '2026-08-01' });
  await operation(socle, ctx, { direction: 'charge', amount: 200, date: '2026-08-15' });
  const r = await close(socle, ctx, '2026-08');
  assert.equal(r.closure.resultCents, -20000);
  assert.equal(value(socle, ctx, 'bpm.patrimoineConstitue', '2026-09'), -700);
  await rejects(close(socle, ctx, '2026-08'), 'UNIQUENESS_VIOLATION');
  assert.equal(Object.keys(socle.state.capitalizations).length, 1);
});

test('§15 stock inconnu : chiffre « à renseigner » (inconnu), jamais 0', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await makeUser(socle, { anchorDay: 1, cycleStartDate: '2026-08-01' });
  const f = socle.modules.bpm.figure(ctx, 'bpm.patrimoineConstitue');
  assert.deepEqual([f.value, f.status], [null, 'unavailable']);
});

// ---------- C05 : anomalies de références ----------

test('C05 références invalides : IDs et messages séparés, ligne de la tâche et contrôle global en échec', async () => {
  const { socle } = await makeSocle();
  const { ctx, bundle } = await camille(socle);
  const other = await makeUser(socle, { label: 'Autre' });
  const t = await socle.modules.core.createTask(ctx, { requestKey: key('t'), title: 'Tâche', projectId: bundle.coreProjectId });
  const op = await operation(socle, ctx, { direction: 'charge', amount: 10, date: '2026-11-01' });
  const before = socle.inspector.checks(socle.state).find((c) => c.rule === 'OM-REF-01');
  assert.equal(before.result, 'passed');

  await socle.store.mutate((d) => {
    d.tasks[t.task.id].projectId = 'prj_absent';
    d.budgets[bundle.budgetId].coreProjectId = t.task.id; // nature incompatible
    d.patrimoines[bundle.patrimoineId].principalBudgetId = other.bundle.budgetId; // autre user
    d.cycleLinks[bundle.cycleLinkId].bpmCompositionId = null; // obligatoire absente
    delete d.operations[op.operation.id]; // objet d'une demande de création disparu
  });

  const checks = socle.inspector.checks(socle.state);
  const ref = checks.find((c) => c.rule === 'OM-REF-01');
  assert.equal(ref.result, 'failed');
  assert.ok(ref.ids.every((id) => !/\s/.test(id)), 'ids : des identifiants seulement');
  const problem = (id) => ref.anomalies.filter((a) => a.id === id).map((a) => a.problem);
  assert.deepEqual(problem(t.task.id), ['target-absent']);
  assert.deepEqual(problem(bundle.budgetId), ['incompatible-kind']);
  assert.deepEqual(problem(bundle.patrimoineId), ['other-user']);
  assert.deepEqual(problem(bundle.cycleLinkId), ['missing-required']);
  const req = checks.find((c) => c.rule === 'OM-REQ-01');
  assert.deepEqual([req.result, req.anomalies[0].problem, req.anomalies[0].id], ['failed', 'created-object-missing', op.operation.id]);

  const row = socle.inspector.inventory(socle.state).find((r) => r.id === t.task.id);
  assert.equal(row.control, 'failed');
  assert.match(row.anomalies[0], /OM-REF-01/);
  assert.equal(socle.inspector.inspectObject(socle.state, t.task.id).diagnostic.control, 'failed');
  // Non exécuté reste distinct de réussi.
  const notRun = checks.find((c) => c.rule === 'C05');
  assert.deepEqual([notRun.result, notRun.execution], ['not-run', 'not-run']);
});

// ---------- C06 : exactement un de chaque, préparation explicite ----------

test('C06 user créé sans BPM puis BPM activé : diagnostic précis, aucune initialisation à la lecture, préparation explicite', async () => {
  const { socle, dataFile } = await makeSocle();
  await socle.close();
  const coreOnly = SOCLE_MODULES.filter((m) => !['budget', 'patrimoine', 'bpm'].includes(m.id));
  const s1 = await createSocle({ dataFile, modules: coreOnly });
  const { userId } = await s1.modules.users.createUser({ requestKey: key('u'), label: 'Socle seul' });
  await s1.close();

  const s2 = await createSocle({ dataFile, modules: SOCLE_MODULES });
  const ctx = { userId };
  const rev = s2.state.revision;
  const bpm01 = s2.inspector.checks(s2.state).find((c) => c.rule === 'BPM-01');
  assert.equal(bpm01.result, 'failed');
  assert.equal(bpm01.preparation, 'to-prepare');
  assert.deepEqual(bpm01.anomalies.map((a) => a.field), ['lifeBudget', 'patrimoine', 'bpmComposition']);
  assert.match(bpm01.observed, /Budget « Projet de vie », Patrimoine, Composition BPM/);
  const err = await rejects(async () => s2.modules.bpm.dashboard(ctx), 'FORBIDDEN_BY_RULE');
  assert.equal(err.details.preparation.status, 'to-prepare');
  assert.equal(s2.modules.users.listUsers()[0].bpmPreparation, 'to-prepare');
  assert.equal(s2.state.revision, rev, 'aucune écriture pendant le diagnostic');

  const requestKey = key('prep');
  const r = await s2.modules.bpm.prepareComposition(ctx, { requestKey });
  assert.deepEqual(r.created, ['coreProject', 'lifeBudget', 'patrimoine', 'bpmComposition', 'cycleLink']);
  assert.equal(r.preparation.status, 'ready');
  assert.equal((await s2.modules.bpm.prepareComposition(ctx, { requestKey })).replayed, true);
  const again = await s2.modules.bpm.prepareComposition(ctx, { requestKey: key('prep') });
  assert.deepEqual(again.created, [], 'rien de recréé');
  assert.equal(s2.inspector.checks(s2.state).find((c) => c.rule === 'BPM-01').result, 'passed');
  await s2.close();
});

// ---------- C07 : dossier de preuve sur un instantané figé ----------

test('C07 export de preuve : JSON et CSV du même instantané (snapshotId, révision, date, périmètre)', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  await operation(socle, ctx, { direction: 'income', amount: 3000, date: '2026-08-10' });
  await close(socle, ctx, '2026-08');
  const state = socle.state;
  const { manifest, zip } = socle.inspector.exportArchive(state, 'all');
  // Une écriture après l'export ne change rien à l'archive déjà produite.
  await operation(socle, ctx, { direction: 'charge', amount: 1, date: '2026-11-01' });

  const files = unzip(zip);
  assert.deepEqual(Object.keys(files).sort(), ['manifest.json', 'debug.json', ...socle.inspector.csvFiles().map((f) => `csv/${f}`)].sort());
  const dbg = JSON.parse(files['debug.json']);
  assert.deepEqual([dbg.snapshotId, dbg.storeRevision, dbg.generatedAt, dbg.scope], [manifest.snapshotId, manifest.storeRevision, manifest.generatedAt, 'all']);
  assert.equal(manifest.storeRevision, state.revision);
  for (const f of manifest.files) assert.equal(createHash('sha256').update(files[f.name]).digest('hex'), f.sha256, f.name);
  for (const name of Object.keys(files).filter((n) => n.endsWith('.csv'))) {
    const [head, ...rows] = files[name].trim().split('\n');
    const cols = head.split(',');
    for (const c of ['snapshotId', 'storeRevision', 'generatedAt', 'scope']) assert.ok(cols.includes(c), `${name} : colonne ${c}`);
    const i = cols.indexOf('snapshotId');
    for (const r of rows) assert.ok(r.includes(manifest.snapshotId) && r.includes(manifest.generatedAt), `${name} : ${r.split(',')[i]}`);
  }
});

// ---------- C08 : vocabulaire ----------

test('C08 vocabulaire : « tâche d’un projet budgétisé », Budget « Projet de vie » distinct des projets de la vie', async () => {
  const { socle } = await makeSocle();
  const { ctx, bundle } = await camille(socle);
  const r = await socle.modules.bpm.createLifeProject(ctx, { requestKey: key('lp'), name: 'Voyage', tasks: [{ title: 'Réserver' }] });
  const task = socle.state.tasks[r.taskIds[0]];
  assert.equal(socle.modules.core.qualificationOf(socle.state, task).label, "Tâche d'un projet budgétisé");
  assert.deepEqual([socle.state.budgets[bundle.budgetId].role, socle.state.budgets[bundle.budgetId].name], ['life', 'Projet de vie']);
  assert.deepEqual([socle.state.budgets[r.budgetId].role, socle.state.budgets[r.budgetId].parentBudgetId], ['standard', bundle.budgetId]);
  assert.equal(Object.keys(socle.state.patrimoines).length, 1, 'aucun nouveau Patrimoine');
});

// ---------- C09 : dates civiles strictes ----------

test('C09 dates civiles strictes (31 février refusé, années bissextiles), erreur par champ', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const cases = [
    () => operation(socle, ctx, { direction: 'charge', amount: 1, date: '2026-02-31', status: 'planned' }),
    () => operation(socle, ctx, { direction: 'charge', amount: 1, date: '2027-02-29', status: 'planned' }),
    () => operation(socle, ctx, { direction: 'charge', amount: 1, date: '2026-04-31', status: 'planned' }),
    () => socle.modules.core.createTask(ctx, { requestKey: key('t'), title: 'T', dueDate: '2026-06-31' }),
    () => socle.modules.core.createCoreProject(ctx, { requestKey: key('p'), title: 'P', startDate: '2026-13-01' }),
    () => socle.modules.bpm.configureCycle(ctx, { anchorDay: 1, startDate: '2026-02-30', expectedRevision: 1 }),
  ];
  const fields = [];
  for (const c of cases) fields.push((await rejects(c, 'VALIDATION')).details.field);
  assert.deepEqual(fields, ['date', 'date', 'date', 'dueDate', 'startDate', 'startDate']);
  const ok = await operation(socle, ctx, { direction: 'charge', amount: 1, date: '2028-02-29', status: 'planned' });
  assert.equal(ok.operation.date, '2028-02-29');
  await rejects(socle.modules.budget.realizeOperation(ctx, ok.operation.id, { expectedRevision: 1, realizedDate: '2026-02-29' }), 'VALIDATION');
});

// ---------- C10 : aucune limite de périodes ----------

test('C10 cycle de janvier 2026 lu en janvier 2078 : période courante en 2078, historique paginé', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await makeUser(socle, { anchorDay: 1, cycleStartDate: '2026-01-01' });
  await at('2078-01-15', async () => {
    const d = socle.modules.bpm.dashboard(ctx);
    assert.equal(d.period.key, '2078-01');
    assert.equal(d.cycle.periodsTotal, 625);
    assert.equal(d.cycle.periods.length, 24);
    assert.equal(d.cycle.periods[0].key, '2078-01');
    let page = socle.modules.bpm.periods(ctx, { limit: 240 });
    const keys = [...page.periods.map((p) => p.key)];
    while (page.nextBefore !== null) {
      page = socle.modules.bpm.periods(ctx, { before: page.nextBefore, limit: 240 });
      keys.push(...page.periods.map((p) => p.key));
    }
    assert.equal(keys.length, 625);
    assert.deepEqual([keys[0], keys.at(-1)], ['2078-01', '2026-01']);
    assert.equal(new Set(keys).size, 625);
    assert.equal(value(socle, ctx, 'bpm.revenus', '2050-06'), 0);
  });
});

// ---------- C11 : un seul écrivain, aucun écrasement silencieux ----------

test('C11 deux instances sur le même fichier : la seconde est refusée (même processus et autre processus)', async () => {
  const { socle, dataFile } = await makeSocle();
  await rejects(createSocle({ dataFile, modules: SOCLE_MODULES }), 'STORE_LOCKED');
  const script = `import('${new URL('../src/socle/index.mjs', import.meta.url).href}').then(async ({ createSocle }) => {
    const { SOCLE_MODULES } = await import('${new URL('../src/modules/index.mjs', import.meta.url).href}');
    try { await createSocle({ dataFile: ${JSON.stringify(dataFile)}, modules: SOCLE_MODULES }); console.log('OPENED'); process.exit(0); }
    catch (e) { console.log(e.code); process.exit(0); }
  });`;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script]);
  assert.equal(stdout.trim(), 'STORE_LOCKED');
  await socle.close();
  const reopened = await createSocle({ dataFile, modules: SOCLE_MODULES });
  await reopened.close();
});

test('C11 écritures concurrentes dans une instance : toutes sérialisées, aucune perdue, relues après redémarrage', async () => {
  const { socle, reload } = await makeSocle();
  const { ctx } = await camille(socle);
  const rev = socle.state.revision;
  await Promise.all(Array.from({ length: 20 }, (_, i) => operation(socle, ctx, { direction: 'charge', amount: i + 1, date: '2026-11-01' })));
  assert.equal(socle.state.revision, rev + 20);
  assert.equal(Object.keys(socle.state.operations).length, 20);
  const s2 = await reload();
  assert.equal(Object.keys(s2.state.operations).length, 20);
  assert.equal(s2.state.revision, rev + 20);
  await s2.close();
});

test('C11 fichier modifié par un autre écrivain : écriture refusée, rien n’est écrasé', async () => {
  const { socle, dataFile } = await makeSocle();
  const { ctx } = await camille(socle);
  const foreign = JSON.parse(await readFile(dataFile, 'utf8'));
  foreign.updatedAt = 'modifié ailleurs';
  await writeFile(dataFile, JSON.stringify(foreign) + '\n'.repeat(3));
  await rejects(operation(socle, ctx, { direction: 'charge', amount: 1, date: '2026-11-01' }), 'PERSISTENCE_CONFLICT');
  assert.equal(JSON.parse(await readFile(dataFile, 'utf8')).updatedAt, 'modifié ailleurs');
  await socle.close();
});

// ---------- migration explicite des données existantes ----------

test('migration j1-store/0.2 → socle-store/0.5 : IDs conservés, changements enregistrés, rejouable', async () => {
  const { socle, dataFile } = await makeSocle();
  await socle.close();
  await copyFile(new URL('./fixtures/j1-store-0.2.json', import.meta.url), dataFile);
  const legacy = JSON.parse(await readFile(dataFile, 'utf8'));
  const legacyIds = ['users', 'coreProjects', 'tasks', 'budgets', 'patrimoines', 'bpmCompositions'].flatMap((c) => Object.keys(legacy[c]));

  const s1 = await createSocle({ dataFile, modules: SOCLE_MODULES });
  assert.equal(s1.state.schemaVersion, 'socle-store/0.5');
  for (const id of legacyIds) assert.ok(s1.om.find(s1.state, id), id);
  const m = s1.state.migrations.at(-1);
  assert.equal(m.from, 'j1-store/0.2');
  assert.deepEqual(m.steps.map((s) => s.id).sort(), ['bpm-composition-et-cycle', 'bpm-vision', 'budget-recurrences-et-plafonds', 'patrimoine-champs-stock', 'users-type-par-defaut']);
  for (const u of Object.values(s1.state.users)) assert.ok(u.userType);
  const checks = s1.inspector.checks(s1.state);
  assert.equal(checks.find((c) => c.rule === 'OM-REF-01').result, 'passed', JSON.stringify(checks.find((c) => c.rule === 'OM-REF-01').anomalies));
  assert.ok(checks.filter((c) => c.rule === 'BPM-01').every((c) => c.result === 'passed'));
  const rev = s1.state.revision;
  await s1.close();
  const s2 = await createSocle({ dataFile, modules: SOCLE_MODULES });
  assert.equal(s2.state.revision, rev, 'aucune seconde migration');
  assert.equal(s2.state.migrations.length, 1);
  await s2.close();
});
