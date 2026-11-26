// Les réponses de recette utilisées par les tests des écrans BPM (web/src/app/bpm/testing/api-fixtures.json) sont
// celles de l'API d'aujourd'hui : un contrat qui change côté serveur doit être régénéré (npm run fixtures:web),
// et les tests des écrans le voient.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

test('réponses de recette des écrans : à jour avec l’API', async () => {
  const out = join(await mkdtemp(join(tmpdir(), 'fixtures-')), 'api-fixtures.json');
  await promisify(execFile)(process.execPath, [new URL('../scripts/web-fixtures.mjs', import.meta.url).pathname], { env: { ...process.env, WEB_FIXTURES_OUT: out } });
  const fresh = await readFile(out, 'utf8');
  const committed = await readFile(new URL('../../web/src/app/bpm/testing/api-fixtures.json', import.meta.url), 'utf8');
  assert.equal(fresh, committed, 'contrat de l’API changé : lancer « npm run fixtures:web » et relire les tests des écrans');
});
