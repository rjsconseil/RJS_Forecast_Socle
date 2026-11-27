// Isolation des applications côté site : le code commun (core, shared, plan, navigation, platform, admin…) ne
// dépend d'aucune application. Seul le registre `platform/applications.ts` inscrit les déclarations d'applications.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../../web/src/app/', import.meta.url));
// Dossier de chaque application ; `builtOn` : l'application dont elle présente les écrans (seule dépendance admise).
const APPLICATIONS = ['bpm', 'astra'];
const BUILT_ON = { astra: 'bpm' };
const REGISTRY = 'platform/applications.ts';
// Les écrans propres aux sections (`sections/<clé>/`) sont des pages de BPM-Astra : ils relèvent de cette application.
const HOSTED = { sections: 'astra' };

const files = async (dir) => (await Promise.all((await readdir(dir)).map(async (name) => {
  const path = join(dir, name);
  if ((await stat(path)).isDirectory()) return files(path);
  return /\.(ts|scss|html)$/.test(name) && !name.endsWith('.spec.ts') ? [path] : [];
}))).flat();
const applicationOf = (rel) => APPLICATIONS.find((a) => rel === a || rel.startsWith(a + '/'))
  ?? Object.entries(HOSTED).find(([dir]) => rel === dir || rel.startsWith(dir + '/'))?.[1] ?? null;
const inApplication = (rel) => applicationOf(rel) !== null;

test('isolation : le code commun du site n’importe aucune application', async () => {
  const found = [];
  for (const file of await files(app)) {
    const rel = relative(app, file);
    if (inApplication(rel) || rel === REGISTRY) continue;
    const text = await readFile(file, 'utf8');
    for (const m of text.matchAll(/(?:from\s+|import\(\s*)['"]([^'"]+)['"]/g)) {
      const target = relative(app, join(file, '..', m[1]));
      if (APPLICATIONS.some((a) => target === a || target.startsWith(a + '/'))) found.push(`${rel} → ${m[1]}`);
    }
  }
  assert.deepEqual(found, []);
});

test('isolation : aucun fichier propre à une application n’est rangé dans le code commun', async () => {
  const named = (rel) => APPLICATIONS.some((a) => rel.split('/').pop().startsWith(a + '-'));
  const misplaced = (await files(app)).map((f) => relative(app, f)).filter((rel) => !inApplication(rel) && named(rel));
  assert.deepEqual(misplaced, []);
});

test('isolation : les composants communs de page n’importent ni ne nomment de type d’application', async () => {
  for (const f of ['shared/page-toolbar.component.ts', 'shared/page-banner.component.ts', 'shared/page-heading.component.ts']) {
    const text = await readFile(join(app, f), 'utf8');
    assert.doesNotMatch(text, /bpm-toolbar|bpm-context-toolbar|bpm-focus-mark|BpmContextInfo|projet de vie/, f);
  }
});

test('isolation : la création d’utilisateur passe par le point d’extension des applications', async () => {
  const routes = await readFile(join(app, 'app.routes.ts'), 'utf8');
  assert.match(routes, /path: 'utilisateurs'[^\n]*loadComponent: loadUserCreation/);
});

test('isolation : une application ne dépend que de l’application qu’elle déclare présenter (builtOn)', async () => {
  const declared = await readFile(join(app, 'astra/astra.application.ts'), 'utf8');
  assert.match(declared, /builtOn: 'bpm'/, 'BPM-Astra déclare présenter les écrans de BPM');
  const found = [];
  for (const file of await files(app)) {
    const rel = relative(app, file);
    const own = applicationOf(rel);
    if (!own) continue;
    const text = await readFile(file, 'utf8');
    for (const m of text.matchAll(/(?:from\s+|import\(\s*)['"]([^'"]+)['"]/g)) {
      const target = applicationOf(relative(app, join(file, '..', m[1])));
      if (target && target !== own && BUILT_ON[own] !== target) found.push(`${rel} → ${m[1]}`);
    }
  }
  assert.deepEqual(found, [], 'BPM ne dépend pas de BPM-Astra, et aucune autre dépendance entre applications');
});
