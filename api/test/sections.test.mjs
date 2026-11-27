// Évolution 1 du socle (vision « cinq sections autonomes, un seul site ») : la section est une notion commune.
// Catalogue unique (sections.json), section propriétaire de chaque nature, tables rangées par section,
// flux entre sections, horloge commune du cycle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Registry } from '../src/socle/registry.mjs';
import { applicationSectionOf, SECTION_FLOWS, SECTION_LIST, sectionOfCollection } from '../src/socle/sections.mjs';
import { sectionPrefixOfTable, tableName, tableOf } from '../src/socle/data/engines/tables.mjs';
import { at, makeSocle, makeUser } from './helpers.mjs';

test('catalogue : cinq sections du site et le système, neuf flux entre sections', () => {
  assert.deepEqual(SECTION_LIST.map((s) => s.key), ['quotidien', 'projets', 'budget', 'patrimoine', 'cycles', 'systeme']);
  assert.deepEqual(SECTION_LIST.map((s) => s.prefix), ['MQ', 'MP', 'MB', 'PT', 'CL', 'SY']);
  for (const s of SECTION_LIST.filter((x) => x.key !== 'systeme')) {
    assert.ok(s.promise && s.decides && s.verb, `${s.key} : promesse, responsabilité et verbe`);
    assert.equal(s.tone, `astra-${s.key}`);
  }
  assert.equal(SECTION_FLOWS.length, 9);
  assert.deepEqual(SECTION_FLOWS.map((f) => f.n), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // Chaque section du site reçoit et donne au moins un flux : interdépendantes.
  for (const s of SECTION_LIST.filter((x) => x.key !== 'systeme')) {
    assert.ok(SECTION_FLOWS.some((f) => f.to === s.key), `${s.key} reçoit`);
    assert.ok(SECTION_FLOWS.some((f) => f.from === s.key), `${s.key} donne`);
  }
});

test('les tables gardent leurs noms : le préfixe vient du catalogue', () => {
  assert.equal(tableOf('operations'), 'MQ_operations');
  assert.equal(tableOf('taskBudgetRequests'), 'MP_task_budget_requests');
  assert.equal(tableOf('recurrences'), 'MB_recurrences');
  assert.equal(tableOf('lifeGoals'), 'PT_life_goals');
  assert.equal(tableOf('cycleLinks'), 'CL_cycle_links');
  assert.equal(tableOf('credentials'), 'SY_credentials');
  assert.equal(tableOf('inconnue'), 'SY_inconnue');
});

test('applications autonomes : leurs tables prennent « AA_ » devant le préfixe de la section (AA_MP_, AA_SY_)', () => {
  assert.equal(tableName('MP', 'planItems', { application: true }), 'AA_MP_plan_items');
  assert.equal(tableName('SY', 'autonomousJobs', { application: true }), 'AA_SY_autonomous_jobs');
  assert.equal(tableName('MP', 'projects'), 'MP_projects');
  assert.equal(sectionPrefixOfTable('AA_MP_plan_items'), 'MP');
  assert.equal(sectionPrefixOfTable('MP_projects'), 'MP');
  assert.equal(sectionPrefixOfTable('AA_SY_autonomous_jobs'), 'SY');
});

test('un fait, une section propriétaire : chaque nature du site est rangée dans une section du catalogue', async () => {
  const { socle } = await makeSocle();
  const catalogued = new Set(SECTION_LIST.flatMap((s) => s.collections));
  for (const def of socle.registry.kinds.values()) {
    // Une nature du grand noyau est rangée dans sections.json ; celle d'une application autonome, par sa déclaration.
    const application = applicationSectionOf(def.collection);
    assert.ok(catalogued.has(def.collection) || application, `${def.kind} (${def.collection}) doit être rangée dans sections.json`);
    assert.equal(def.section, sectionOfCollection(def.collection));
    assert.equal(sectionPrefixOfTable(tableOf(def.collection)), SECTION_LIST.find((s) => s.key === def.section).prefix, `${def.kind} : table et section concordent`);
    if (application) assert.match(tableOf(def.collection), /^AA_/);
  }
  assert.equal(socle.registry.sectionOf('coreProject'), 'projets');
  assert.equal(socle.registry.sectionOf('task'), 'projets');
  assert.equal(socle.registry.sectionOf('operation'), 'quotidien');
  assert.equal(socle.registry.sectionOf('recurrence'), 'budget');
  assert.equal(socle.registry.sectionOf('lifeGoal'), 'patrimoine');
  assert.equal(socle.registry.sectionOf('closure'), 'cycles');
  assert.equal(socle.registry.sectionOf('user'), 'systeme');
});

test('le registre refuse une nature qui se déclare dans une autre section que sa collection', () => {
  const r = new Registry();
  assert.throws(() => r.register({ id: 'x', level: 1, kinds: { t: { collection: 'tasks', prefix: 'zzt', label: 'T', section: 'budget' } } }), /rangée dans projets/);
  assert.throws(() => r.register({ id: 'y', level: 1, kinds: { u: { collection: 'us', prefix: 'zzu', label: 'U', section: 'nulle-part' } } }), /Section inconnue/);
  r.register({ id: 'z', level: 1, kinds: { v: { collection: 'tasks', prefix: 'zzv', label: 'V', section: 'projets' } } });
  assert.equal(r.sectionOf('v'), 'projets');
});

test('GET /api/navigation/sections : catalogue, natures de chaque section et flux', async () => {
  const { socle } = await makeSocle();
  const route = socle.modules.navigation && socle.registry.modules.get('navigation').routes(socle).find(([m, p]) => m === 'GET' && p === '/api/navigation/sections');
  const r = await route[2]({});
  const projets = r.sections.find((s) => s.key === 'projets');
  assert.deepEqual(projets.kinds.map((k) => k.kind).sort(), ['coreProject', 'projectOverrun', 'task', 'taskBudgetRequest']);
  assert.ok(Array.isArray(projets.applicationKinds), 'les natures des applications autonomes sont listées à part');
  assert.equal(r.flows.length, 9);
  assert.equal(r.sections.at(-1).key, 'systeme');
});

test('horloge commune : phase, période, jours restants et verrou, la même pour toutes les sections', async () => {
  const { socle } = await makeSocle({ closingLock: true });
  const { ctx } = await makeUser(socle, { label: 'Horloge', anchorDay: 1, cycleStartDate: '2026-11-01' });
  let c = socle.modules.bpm.cycleClock(ctx);
  assert.equal(c.phase, 'running');
  assert.equal(c.period.key, '2026-11');
  assert.equal(c.current.key, '2026-11');
  assert.equal(c.daysLeft, 28, 'du 3 au 30 novembre inclus');
  assert.equal(c.lock.active, false);
  c = await at('2026-12-02', () => socle.modules.bpm.cycleClock(ctx));
  assert.equal(c.phase, 'to_close');
  assert.equal(c.period.key, '2026-11', 'la période en clôture');
  assert.equal(c.current.key, '2026-12');
  assert.deepEqual([c.lock.enabled, c.lock.active, c.lock.from, c.lock.periodKey], [true, true, '2026-12-01', '2026-11']);
  const { ctx: bare } = await makeUser(socle, { label: 'Sans cycle' });
  assert.equal(socle.modules.bpm.cycleClock(bare).phase, 'to_configure');
});

test('le site lit le même catalogue que le socle (aucune copie)', () => {
  const web = readFileSync(new URL('../../web/src/app/platform/sections.ts', import.meta.url), 'utf8');
  assert.match(web, /from '\.\.\/\.\.\/\.\.\/\.\.\/api\/src\/socle\/sections\.json'/);
});
