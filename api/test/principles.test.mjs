// Principes d'architecture du socle (src/socle/principles.mjs) : chacun est vérifié ici, par le
// comportement du socle (refus levés) et par la lecture du code des modules (imports, accès aux données).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { makeSocle, camille, key } from './helpers.mjs';
import { SOCLE_MODULES } from '../src/modules/index.mjs';
import { PRINCIPLES } from '../src/socle/principles.mjs';

const fails = (code) => (error) => error.code === code;
const byId = Object.fromEntries(SOCLE_MODULES.map((m) => [m.id, m]));
const sourcesOf = async (id) => {
  const dir = new URL(`../src/modules/${id}/`, import.meta.url);
  return Promise.all((await readdir(dir)).filter((f) => f.endsWith('.mjs')).map(async (f) => ({ file: `${id}/${f}`, source: await readFile(new URL(f, dir), 'utf8') })));
};

test('principes : chacun est nommé, avec sa règle, son mécanisme et son refus', () => {
  assert.deepEqual(PRINCIPLES.map((p) => p.id), ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
  for (const p of PRINCIPLES) for (const field of ['code', 'name', 'rule', 'mechanism', 'refusal']) assert.ok(p[field], `${p.id}.${field}`);
});

test('P1 · Sens unique : un module ne voit que les modules qu’il déclare', async () => {
  const { socle } = await makeSocle();
  for (const mod of SOCLE_MODULES) {
    const scope = socle.scopeOf(mod.id);
    for (const other of SOCLE_MODULES) {
      const allowed = other.id === mod.id || (mod.dependsOn ?? []).includes(other.id);
      if (allowed) assert.ok(scope.modules[other.id] !== undefined, `${mod.id} → ${other.id}`);
      else assert.throws(() => scope.modules[other.id], fails('LAYER_VIOLATION'), `${mod.id} ne doit pas voir ${other.id}`);
    }
  }
  // Le noyau ignore les middlewares et l'application ; un middleware ignore l'application.
  assert.throws(() => socle.scopeOf('core').modules.budget, fails('LAYER_VIOLATION'));
  assert.throws(() => socle.scopeOf('core').modules.bpm, fails('LAYER_VIOLATION'));
  assert.throws(() => socle.scopeOf('budget').modules.bpm, fails('LAYER_VIOLATION'));
  assert.throws(() => socle.scopeOf('budget').modules.patrimoine, fails('LAYER_VIOLATION'));
  await socle.close();
});

test('P1 · Sens unique : aucune dépendance déclarée ne monte, et aucun import ne sort des dépendances', async () => {
  for (const mod of SOCLE_MODULES) {
    for (const dep of mod.dependsOn ?? []) {
      assert.ok(byId[dep], `${mod.id} dépend d’un module inconnu : ${dep}`);
      assert.ok(byId[dep].level <= mod.level, `${mod.id} (N${mod.level}) dépend de ${dep} (N${byId[dep].level})`);
    }
    for (const { file, source } of await sourcesOf(mod.id)) {
      for (const match of source.matchAll(/from\s+'\.\.\/([\w-]+)\//g)) {
        assert.ok((mod.dependsOn ?? []).includes(match[1]), `${file} importe ${match[1]}, absent des dépendances de ${mod.id}`);
      }
    }
  }
});

test('P2 · Écriture unique : l’état publié est gelé, hors transaction rien ne s’écrit', async () => {
  const { socle } = await makeSocle();
  const { ctx, bundle } = await camille(socle);
  assert.ok(Object.isFrozen(socle.state));
  assert.throws(() => { socle.state.budgets[bundle.budgetId].name = 'Autre'; }, TypeError);
  assert.throws(() => { socle.state.budgets.bud_intrus = {}; }, TypeError);
  assert.throws(() => { delete socle.state.users[ctx.userId]; }, TypeError);
  await socle.close();
});

test('P2 · Écriture unique : seul le propriétaire d’une nature crée et modifie ses objets', async () => {
  const { socle } = await makeSocle();
  const { ctx, bundle } = await camille(socle);
  const bpm = socle.scopeOf('bpm');
  const budget = socle.scopeOf('budget');
  // L'application ne crée ni ne modifie un objet d'un middleware ou du noyau.
  await assert.rejects(bpm.om.command('test', ctx, { requestKey: key() }, (tx) => bpm.om.create(tx, 'operation', {}), { creation: true }), fails('WRITE_OUTSIDE_DOMAIN'));
  await assert.rejects(bpm.om.command('test', ctx, {}, (tx) => bpm.om.update(tx, tx.draft.budgets[bundle.budgetId], { name: 'X' })), fails('WRITE_OUTSIDE_DOMAIN'));
  await assert.rejects(budget.om.command('test', ctx, {}, (tx) => budget.om.update(tx, tx.draft.coreProjects[bundle.coreProjectId], { title: 'X' })), fails('WRITE_OUTSIDE_DOMAIN'));
  // Un module n'a pas d'écrivain du stockage.
  assert.equal(bpm.store.mutate, undefined);
  assert.equal(socle.state.budgets[bundle.budgetId].name, 'Projet de vie');
  await socle.close();
});

test('P2 · Écriture unique : un objet apparu ou disparu sans om.create est refusé à la sortie de la transaction', async () => {
  const { socle } = await makeSocle();
  const { ctx, bundle } = await camille(socle);
  const budget = socle.scopeOf('budget');
  const revision = socle.state.revision;
  await assert.rejects(budget.om.command('test', ctx, {}, (tx) => { tx.draft.budgets.bud_fantome = { id: 'bud_fantome' }; return {}; }), fails('UNTRACKED_WRITE'));
  await assert.rejects(budget.om.command('test', ctx, {}, (tx) => { delete tx.draft.budgets[bundle.budgetId]; return {}; }), fails('UNTRACKED_WRITE'));
  assert.equal(socle.state.revision, revision, 'rien n’est enregistré');
  await socle.close();
});

test('P3 · Façade publique : entre modules, on n’importe que `api.mjs`', async () => {
  for (const mod of SOCLE_MODULES) {
    for (const { file, source } of await sourcesOf(mod.id)) {
      for (const match of source.matchAll(/from\s+'\.\.\/([\w-]+)\/([\w.-]+)'/g)) {
        assert.equal(match[2], 'api.mjs', `${file} importe le fichier interne ${match[1]}/${match[2]}`);
      }
    }
  }
});

test('P4 · Lecture déclarée : un module ne lit que ses natures et celles qu’il déclare', async () => {
  const kindOwner = new Map(); const kindOfCollection = new Map();
  for (const m of SOCLE_MODULES) for (const [kind, def] of Object.entries(m.kinds ?? {})) { kindOwner.set(kind, m.id); kindOfCollection.set(def.collection, kind); }
  for (const mod of SOCLE_MODULES) {
    const allowed = new Set([...Object.keys(mod.kinds ?? {}), ...(mod.reads ?? [])]);
    for (const kind of mod.reads ?? []) assert.ok(kindOwner.get(kind) === mod.id || mod.dependsOn.includes(kindOwner.get(kind)), `${mod.id} lit ${kind} hors de ses dépendances`);
    for (const { file, source } of await sourcesOf(mod.id)) {
      const used = new Set();
      for (const m of source.matchAll(/\b(?:state|draft|s|d|st)\.(\w+)\b/g)) if (kindOfCollection.has(m[1])) used.add(kindOfCollection.get(m[1]));
      for (const m of source.matchAll(/om\.(?:get|list|owned)\(\s*[\w.]+,\s*'(\w+)'/g)) if (kindOwner.has(m[1])) used.add(m[1]);
      for (const kind of used) assert.ok(allowed.has(kind), `${file} lit « ${kind} » (${kindOwner.get(kind)}) sans le déclarer dans reads`);
    }
  }
});

test('P4 · Lecture déclarée : le registre refuse une lecture hors dépendances', async () => {
  const { Registry } = await import('../src/socle/registry.mjs');
  const registry = new Registry();
  registry.register({ id: 'a', level: 2, dependsOn: [], kinds: { chose: { collection: 'choses', prefix: 'cho', label: 'Chose' } } });
  assert.throws(() => registry.register({ id: 'b', level: 2, dependsOn: [], reads: ['chose'] }), /Lecture interdite/);
  registry.register({ id: 'c', level: 3, dependsOn: ['a'], reads: ['chose'] });
});

test('P5 · Données gérées : un schéma par module, une base SQLite rangée par section du site', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { socle, dataFile, reload } = await makeSocle();
  const { ctx, bundle } = await camille(socle);
  const described = await socle.data.describe();
  assert.deepEqual(described.spaces, ['socle', 'application.bpm']);
  assert.deepEqual(described.engines.map((e) => [e.id, e.coded, e.active]), [['sqlite', true, true], ['sgbd', true, false]]);
  const schema = (name) => described.schemas.find((s) => s.name === name);
  assert.equal(schema('application.bpm').space, 'application.bpm');
  for (const name of ['technique.socle', 'technique.users', 'noyau.core', 'middleware.budget', 'middleware.patrimoine']) assert.equal(schema(name).space, 'socle', name);
  // Une table par collection, préfixée par la section du site qui la porte ; l'espace de stockage reste noté.
  const db = new DatabaseSync(dataFile.replace(/\.json$/, '.sqlite'));
  const tables = Object.fromEntries(db.prepare('SELECT collection, table_name, section, space FROM SY_tables').all().map((t) => [t.collection, [t.table_name, t.section, t.space]]));
  assert.deepEqual(tables.operations, ['MQ_operations', 'MQ', 'socle']);
  assert.deepEqual(tables.tasks, ['MP_tasks', 'MP', 'socle']);
  assert.deepEqual(tables.recurrences, ['MB_recurrences', 'MB', 'socle']);
  assert.deepEqual(tables.patrimoines, ['PT_patrimoines', 'PT', 'socle']);
  assert.deepEqual(tables.bpmCompositions, ['CL_bpm_compositions', 'CL', 'application.bpm']);
  assert.deepEqual(tables.users, ['SY_users', 'SY', 'socle']);
  const row = db.prepare('SELECT user_id, revision, data FROM CL_bpm_compositions WHERE id = ?').get(bundle.bpmCompositionId);
  assert.equal(row.user_id, ctx.userId);
  assert.equal(JSON.parse(row.data).id, bundle.bpmCompositionId);
  // Une écriture n'écrit que les objets qu'elle change ; le journal ne fait que s'allonger.
  const journal = db.prepare('SELECT count(*) n FROM SY_journal').get().n;
  await socle.modules.budget.createOperation(ctx, { requestKey: key(), direction: 'charge', label: 'Courses', amount: 12, date: '2026-11-02', costCenterRef: 'std:alimentation' });
  assert.equal(db.prepare('SELECT revision FROM CL_bpm_compositions WHERE id = ?').get(bundle.bpmCompositionId).revision, row.revision);
  // La ligne porte la révision de sa partition (celle du user), pas celle de toute la base.
  assert.equal(db.prepare("SELECT revision FROM MQ_operations WHERE json_extract(data, '$.label') = 'Courses'").get().revision, db.prepare('SELECT revision FROM SY_partitions WHERE user_id = ?').get(ctx.userId).revision);
  assert.equal(db.prepare('SELECT count(*) n FROM SY_journal').get().n, journal + 1);
  db.close();
  // Rechargement : l'état logique est reconstitué à l'identique.
  const before = JSON.stringify(socle.state);
  const again = await reload();
  assert.equal(JSON.stringify(again.state), before);
  await again.close();
});
test('P5 · Données gérées : le moteur se choisit ; SQLite en service, PostgreSQL déclaré mais pas encore codé', async () => {
  const { createSocle } = await import('../src/socle/index.mjs');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'socle-engine-'));
  await assert.rejects(createSocle({ dataFile: join(dir, 'a.json'), modules: SOCLE_MODULES, dataEngine: 'sgbd' }), fails('DATA_ENGINE_UNAVAILABLE'));
  await assert.rejects(createSocle({ dataFile: join(dir, 'b.json'), modules: SOCLE_MODULES, dataEngine: 'inconnu' }), fails('DATA_ENGINE_UNAVAILABLE'));
  await assert.rejects(createSocle({ dataFile: join(dir, 'c.json'), modules: SOCLE_MODULES, dataEngine: 'json-fichiers' }), fails('DATA_ENGINE_UNAVAILABLE'), 'les fichiers JSON ne sont plus un moteur');
  const socle = await createSocle({ dataFile: join(dir, 'd.json'), modules: SOCLE_MODULES });
  assert.equal((await socle.data.describe()).engine.id, 'sqlite');
  await socle.close();
});
test('P5 · Données gérées : un stockage JSON d’un seul bloc est repris dans la base au premier démarrage, puis archivé', async () => {
  const { writeFile: write, access, readdir: list } = await import('node:fs/promises');
  const { dirname, join } = await import('node:path');
  const { createSocle } = await import('../src/socle/index.mjs');
  const { removeStore } = await import('../src/socle/store.mjs');
  const { socle, dataFile } = await makeSocle();
  const { ctx, bundle } = await camille(socle);
  const monolithic = JSON.stringify(socle.state);
  await socle.close();
  await removeStore(dataFile);
  await write(dataFile, monolithic);
  const reopened = await createSocle({ dataFile, modules: SOCLE_MODULES });
  assert.equal(JSON.stringify(reopened.state), monolithic, 'reprise à l’identique');
  assert.equal((await reopened.data.describe()).engine.importedFromJson.revision, JSON.parse(monolithic).revision);
  await access(dataFile.replace(/\.json$/, '.sqlite'));
  await assert.rejects(access(dataFile), 'le fichier JSON quitte sa place');
  const archives = join(dirname(dataFile), 'store.archives');
  const [copy] = await list(archives);
  assert.match(copy, /^json-avant-sqlite-/);
  assert.deepEqual(await list(join(archives, copy)), ['store.json']);
  await reopened.modules.budget.createOperation(ctx, { requestKey: key(), direction: 'charge', label: 'Courses', amount: 12, date: '2026-11-02', costCenterRef: 'std:alimentation' });
  assert.ok(reopened.state.bpmCompositions[bundle.bpmCompositionId]);
  await reopened.close();
});
test('P6 · Middlewares typés : métier, technique et transverse, chacun à sa place', async () => {
  const { socle } = await makeSocle();
  const roles = Object.fromEntries(socle.registry.describe().filter((m) => m.level === 2).map((m) => [m.id, m.role]));
  assert.deepEqual(roles, { cycle: 'technique', calendar: 'transverse', navigation: 'metier', budget: 'metier', patrimoine: 'metier' });
  // Les middlewares métier sont indépendants : aucun ne dépend d'un autre, ni ne lit ses données.
  const metier = SOCLE_MODULES.filter((m) => m.level === 2 && (m.role ?? 'metier') === 'metier');
  for (const a of metier) for (const b of metier) if (a !== b) {
    assert.ok(!(a.dependsOn ?? []).includes(b.id), `${a.id} dépend de ${b.id}`);
    assert.throws(() => socle.scopeOf(a.id).modules[b.id], fails('LAYER_VIOLATION'));
  }
  // Patrimoine connaît l'ancre de vie par extension, sans voir Budget.
  const { ctx, bundle } = await camille(socle);
  assert.equal(socle.state.patrimoines[bundle.patrimoineId].principalBudgetId, bundle.budgetId);
  assert.equal(socle.inspector.checks(socle.state).find((c) => c.rule === 'PAT-01').result, 'passed');
  await socle.close();
});

test('P6 · Middlewares typés : le registre refuse les dépendances hors rôle', async () => {
  const { Registry } = await import('../src/socle/registry.mjs');
  const base = () => { const r = new Registry(); r.register({ id: 'm1', level: 2, role: 'metier', dependsOn: [] }); r.register({ id: 't1', level: 2, role: 'technique', dependsOn: [] }); r.register({ id: 'x1', level: 2, role: 'transverse', dependsOn: [] }); return r; };
  assert.throws(() => base().register({ id: 'm2', level: 2, dependsOn: ['m1'] }), /Middlewares indépendants/);
  assert.throws(() => base().register({ id: 'app', level: 3, dependsOn: ['t1'] }), /sert les middlewares métier/);
  assert.throws(() => base().register({ id: 't2', level: 2, role: 'technique', dependsOn: ['m1'] }), /niveau du dessous/);
  assert.throws(() => base().register({ id: 'bad', level: 1, role: 'technique', dependsOn: [] }), /Rôle de middleware invalide/);
  const ok = base();
  ok.register({ id: 'm2', level: 2, dependsOn: ['t1', 'x1'] });
  ok.register({ id: 'app', level: 3, dependsOn: ['m1', 'm2', 'x1'] });
});

test('P5 · Données gérées : un stockage JSON « un fichier par espace » est repris, ses fichiers archivés ensemble', async () => {
  const { writeFile: write, readdir: list, access } = await import('node:fs/promises');
  const { dirname, join, basename } = await import('node:path');
  const { createSocle } = await import('../src/socle/index.mjs');
  const { removeStore } = await import('../src/socle/store.mjs');
  const { socle, dataFile } = await makeSocle();
  const { ctx, bundle } = await camille(socle);
  const state = JSON.parse(JSON.stringify(socle.state));
  await socle.close();
  await removeStore(dataFile);
  const appKeys = ['bpmCompositions', 'cycleLinks', 'closures'];
  const spaceFile = basename(dataFile).replace(/\.json$/, '') + '.application.bpm.r1-abcdef.json';
  await write(join(dirname(dataFile), spaceFile), JSON.stringify({ space: 'application.bpm', revision: state.revision, collections: Object.fromEntries(appKeys.map((k) => [k, state[k]])) }));
  const main = Object.fromEntries(Object.entries(state).filter(([k]) => !appKeys.includes(k)));
  main.storage = { engine: 'json-fichiers', layout: 1, spaces: { 'application.bpm': { file: spaceFile, revision: state.revision } } };
  await write(dataFile, JSON.stringify(main));
  const reopened = await createSocle({ dataFile, modules: SOCLE_MODULES });
  assert.deepEqual(Object.keys(reopened.state).sort(), Object.keys(state).sort());
  for (const k of Object.keys(state)) assert.equal(JSON.stringify(reopened.state[k]), JSON.stringify(state[k]), k);
  await assert.rejects(access(join(dirname(dataFile), spaceFile)), 'le fichier d’espace part aux archives');
  const archives = join(dirname(dataFile), 'store.archives');
  const [copy] = await list(archives);
  assert.deepEqual((await list(join(archives, copy))).sort(), [basename(dataFile), spaceFile].sort());
  await reopened.modules.budget.createOperation(ctx, { requestKey: key(), direction: 'charge', label: 'Courses', amount: 12, date: '2026-11-02', costCenterRef: 'std:alimentation' });
  const final = JSON.stringify(reopened.state);
  await reopened.close();
  const again = await createSocle({ dataFile, modules: SOCLE_MODULES });
  assert.equal(JSON.stringify(again.state), final, 'rechargement à l’identique depuis la base');
  assert.ok(again.state.bpmCompositions[bundle.bpmCompositionId]);
  await again.close();
});
test('P5 · Données gérées : une transaction ne copie que les collections qu’elle touche', async () => {
  const { socle } = await makeSocle();
  const { ctx } = await camille(socle);
  const goals = socle.state.lifeGoals;
  const users = socle.state.users;
  await socle.modules.budget.createOperation(ctx, { requestKey: key(), direction: 'charge', label: 'Courses', amount: 12, date: '2026-11-02', costCenterRef: 'std:alimentation' });
  assert.equal(socle.state.lifeGoals, goals, 'collection non touchée : même objet publié, ni copiée ni réécrite');
  assert.ok(Object.isFrozen(socle.state.operations) && Object.values(socle.state.operations).some((o) => o.label === 'Courses'));
  assert.throws(() => { socle.state.operations.x = 1; }, TypeError, 'l’état publié reste gelé');
  assert.ok(Object.isFrozen(users));
});

test('P5 · Données gérées : copie d’un seul bloc pour les scripts, relisible telle quelle, et effacement propre', async () => {
  const { access } = await import('node:fs/promises');
  const { createSocle, } = await import('../src/socle/index.mjs');
  const { snapshotStore, removeStore, readStoredState } = await import('../src/socle/store.mjs');
  const { socle, dataFile } = await makeSocle();
  await camille(socle);
  const expected = JSON.stringify(socle.state);
  await socle.close();
  const copy = dataFile.replace(/\.json$/, '.copie.json');
  await snapshotStore(dataFile, copy);
  assert.equal(JSON.stringify(await readStoredState(copy)), expected, 'la copie porte tout l’état');
  await removeStore(dataFile);
  await assert.rejects(access(dataFile.replace(/\.json$/, '.sqlite')), 'la base est effacée');
  const restored = await createSocle({ dataFile: copy, modules: SOCLE_MODULES });
  assert.equal(JSON.stringify(restored.state), expected, 'la copie se rouvre comme un stockage');
  await restored.close();
});
