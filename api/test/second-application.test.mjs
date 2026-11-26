// Une deuxième application de niveau 3, sur un autre sujet que BPM, s'ajoute sans toucher au socle,
// au noyau ni aux middlewares : côté serveur par sa seule déclaration de module, côté site par sa
// seule déclaration d'application (web/src/app/platform/application.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSocle } from '../src/socle/index.mjs';
import { SOCLE_MODULES } from '../src/modules/index.mjs';
import { camille, key } from './helpers.mjs';

const fails = (code) => (error) => error.code === code;

/** Un carnet de santé : ses propres objets, ses commandes, ses routes. Rien d'autre n'est modifié. */
const santeModule = {
  id: 'sante',
  label: 'Carnet de santé',
  level: 3,
  dependsOn: ['users', 'core'],
  reads: ['user'],
  kinds: { healthRecord: { collection: 'healthRecords', prefix: 'dos', label: 'Dossier médical' } },
  setup(socle) {
    const om = socle.om;
    return {
      createRecord: (ctx, input) => om.command('createHealthRecord', ctx, input, (tx) => ({ recordId: om.create(tx, 'healthRecord', { label: input.label }).id }), { creation: true }),
      records: (ctx) => om.list(socle.state, 'healthRecord').filter((record) => record.userId === ctx.userId),
      // Tentative interdite : écrire un objet d'un autre domaine.
      renameUser: (ctx) => om.command('santeRenameUser', ctx, {}, (tx) => { om.update(tx, om.owned(tx.draft, 'user', ctx.userId, ctx.userId), { label: 'X' }); return {}; }),
    };
  },
  routes: (socle) => [['GET', '/api/sante/dossiers', ({ ctx }) => socle.modules.sante.records(ctx)]],
};

test('deuxième application · serveur : un module de niveau 3 se branche à côté de BPM par sa déclaration', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'socle-app2-'));
  const dataFile = join(dir, 'store.json');
  const socle = await createSocle({ dataFile, modules: [...SOCLE_MODULES, santeModule] });
  const { ctx, bundle } = await camille(socle);

  // Ses objets naissent par le chemin d'écriture commun, chez leur propriétaire.
  const { recordId } = await socle.modules.sante.createRecord(ctx, { requestKey: key(), label: 'Cardiologie' });
  assert.match(recordId, /^dos_/);
  assert.deepEqual(socle.modules.sante.records(ctx).map((record) => record.label), ['Cardiologie']);

  // Les principes s'appliquent à elle comme à BPM, sans réglage.
  const scope = socle.scopeOf('sante');
  assert.ok(scope.modules.core);
  assert.throws(() => scope.modules.budget, fails('LAYER_VIOLATION'), 'elle ne voit que ce qu’elle déclare');
  assert.throws(() => socle.scopeOf('bpm').modules.sante, fails('LAYER_VIOLATION'), 'BPM ne la voit pas');
  assert.throws(() => socle.scopeOf('budget').modules.sante, fails('LAYER_VIOLATION'), 'le dessous ignore le dessus');
  await assert.rejects(socle.modules.sante.renameUser(ctx), fails('WRITE_OUTSIDE_DOMAIN'));

  // Ses données ont leur propre schéma et leur propre espace de stockage, à côté de celui de BPM.
  const schema = socle.data.describe().schemas.find((entry) => entry.module === 'sante');
  assert.deepEqual([schema.name, schema.space, schema.collections.map((collection) => collection.name)], ['application.sante', 'application.sante', ['healthRecords']]);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dataFile.replace(/\.json$/, '.sqlite'));
  const spaces = db.prepare('SELECT collection, table_name, space FROM SY_tables').all();
  db.close();
  assert.ok(spaces.some((t) => t.space === 'application.bpm'));
  assert.deepEqual(spaces.filter((t) => t.space === 'application.sante').map((t) => [t.collection, t.table_name]), [['healthRecords', 'SY_health_records']], 'hors des cinq sections du site : table système');

  // Ses routes sont servies, et BPM fonctionne comme avant.
  assert.ok(socle.routesOf(santeModule).some(([method, path]) => method === 'GET' && path === '/api/sante/dossiers'));
  assert.ok(socle.state.bpmCompositions[bundle.bpmCompositionId]);
  await socle.close();
});

test('deuxième application · site : les fichiers centraux ne nomment plus aucune application', async () => {
  const web = new URL('../../web/src/app/', import.meta.url);
  const central = ['plan/site-plan.ts', 'plan/page-workspaces.ts', 'plan/tab-links.ts', 'navigation/content-section-catalog.ts', 'plan/application-navigation.ts',
    'plan/navigation-adapter.ts', 'plan/quick-nav.ts', 'home/zone-home.ts', 'app.routes.ts', 'platform/application.ts', 'platform/install-application.ts',
    'navigation/navigation-settings.page.ts', 'navigation/navigation-static-preview.ts'];
  for (const file of central) {
    // Exception connue et nommée : l'écran « Utilisateurs » de l'administration est encore celui de BPM (bpm/onboarding).
    const source = (await readFile(new URL(file, web), 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').replaceAll("/bpm/onboarding'", "/onboarding'");
    assert.doesNotMatch(source, /['"`/]bpm['"`/]|from '[^']*\/bpm\//, `${file} nomme BPM en dur`);
  }
  // Le seul point d'inscription : une entrée par application dans le registre (BPM-Astra, l'application BPM).
  const registry = await readFile(new URL('platform/applications.ts', web), 'utf8');
  assert.match(registry, /export const APPLICATIONS: ApplicationDeclaration\[\] = \[[A-Z_]+_APPLICATION(, [A-Z_]+_APPLICATION)*\];/);
});
