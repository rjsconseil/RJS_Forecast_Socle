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
// Fonctionnalités par section et applications autonomes (`sections/`, `hybrides/`) vivent dans BPM-Astra.
const HOSTED = { sections: 'astra', hybrides: 'astra' };

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

// Trois étages : le grand noyau (socle), les fonctionnalités par section, les applications autonomes.
const GRAND_NOYAU = 'platform/grand-noyau.ts';
const CADRE = 'astra/cadre.ts';
const FONCTIONNALITES = /^sections\/[^/]+\/fonctionnalites\//;
const APP_ROOT = (rel) => rel.match(/^(sections\/[^/]+\/application|hybrides\/[^/]+)\//)?.[1] ?? null;
// Toute forme d'import relatif : `from '…'`, `import '…'` (effet de bord) et `import('…')`.
const relativeImports = (text) => [...text.matchAll(/(?:from\s+|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
const resolveTs = (file, spec) => { const t = relative(app, join(file, '..', spec)); return /\.(ts|json|scss|html)$/.test(t) ? t : t + '.ts'; };

test('trois étages : chaque fichier de sections/ et hybrides/ est dans les fonctionnalités d’une section ou dans une application autonome', async () => {
  const stray = (await files(app)).map((f) => relative(app, f))
    .filter((rel) => /^(sections|hybrides)\//.test(rel) && !FONCTIONNALITES.test(rel) && !APP_ROOT(rel));
  assert.deepEqual(stray, []);
});

test('fonctionnalités par section : sans écran, elles n’appellent que le grand noyau et d’autres fonctionnalités par section', async () => {
  const found = [];
  for (const file of await files(app)) {
    const rel = relative(app, file);
    if (!FONCTIONNALITES.test(rel)) continue;
    if (!rel.endsWith('.ts')) { found.push(`${rel} : fichier d’écran`); continue; }
    const text = await readFile(file, 'utf8');
    if (/@Component\s*\(/.test(text)) found.push(`${rel} : composant d’écran`);
    for (const spec of relativeImports(text)) {
      const target = resolveTs(file, spec);
      if (target !== GRAND_NOYAU && !FONCTIONNALITES.test(target)) found.push(`${rel} → ${spec}`);
    }
  }
  assert.deepEqual(found, []);
});

test('applications autonomes : elles appellent le grand noyau, les fonctionnalités par section et le cadre BPM-Astra, jamais une autre application', async () => {
  const found = [];
  for (const file of await files(app)) {
    const rel = relative(app, file);
    const own = APP_ROOT(rel);
    if (!own || !rel.endsWith('.ts')) continue;
    const text = await readFile(file, 'utf8');
    for (const spec of relativeImports(text)) {
      const target = resolveTs(file, spec);
      if (target === GRAND_NOYAU || target === CADRE || FONCTIONNALITES.test(target) || target.startsWith(own + '/')) continue;
      found.push(`${rel} → ${spec}`);
    }
  }
  assert.deepEqual(found, []);
});
