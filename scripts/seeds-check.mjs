// Contrôle des jeux d'essai : les quatre scripts tournent de bout en bout sur des bases temporaires, comme en recette.
//   npm run seeds:check
// 1. API de recette sur un port et une base temporaires : `seed` (contrats HTTP réels), puis `seed:plafonds` deux fois
//    (la seconde doit conserver le jeu) ; le verrou du cycle suivant doit être actif à la fin (règle de production).
// 2. API arrêtée : `seed:projets` et `seed:bpm-functional` (scénarios dans le processus) sur leurs propres bases.
// Aucune donnée réelle n'est lue ni écrite. Sortie en échec dès qu'un script échoue.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
// Les jeux d'essai datent leurs saisies du jour réel : aucune date de recette héritée.
delete process.env.SOCLE_TODAY;
const dir = await mkdtemp(join(tmpdir(), 'socle-seeds-'));
const freePort = () => new Promise((res) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

function run(label, args, env = {}) {
  return new Promise((res, rej) => {
    const started = Date.now();
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.on('exit', (code) => {
      if (code === 0) { console.log(`✓ ${label} (${((Date.now() - started) / 1000).toFixed(1)} s)`); res(out); }
      else { console.error(`✖ ${label} (code ${code})\n${out.split('\n').filter((l) => !/ExperimentalWarning|trace-warnings/.test(l)).slice(-25).join('\n')}`); rej(new Error(label)); }
    });
  });
}

async function waitFor(url, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`API de recette injoignable : ${url}`);
}

let api;
try {
  const port = await freePort();
  const env = { J1_API_PORT: String(port), J1_DATA_FILE: join(dir, 'recette.sqlite'), J1_ENABLE_RECETTE_RESET: '1', SOCLE_DATA_ENGINE: 'sqlite', SOCLE_PG_URL: '', SOCLE_AUTH: 'local' };
  api = spawn(process.execPath, ['api/src/server.mjs'], { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' });
  await waitFor(`http://localhost:${port}/api/health`);
  const seed = await run('npm run seed (API de recette)', ['api/scripts/seed.mjs'], { J1_API_PORT: String(port) });
  if (!/Verrou du cycle suivant : actif/.test(seed)) throw new Error('seed : le verrou du cycle suivant n’a pas été rétabli');
  if (!/0 en échec/.test(seed)) throw new Error('seed : des contrôles Object Management échouent');
  await run('npm run seed:plafonds', ['api/scripts/seed-plafonds.mjs'], { J1_API_PORT: String(port) });
  const again = await run('npm run seed:plafonds (second lancement)', ['api/scripts/seed-plafonds.mjs'], { J1_API_PORT: String(port) });
  if (!/existe déjà/.test(again)) throw new Error('seed:plafonds : le second lancement aurait dû conserver le jeu');
  api.kill('SIGTERM');
  api = null;
  await run('npm run seed:projets (API arrêtée)', ['api/scripts/seed-projets.mjs', '--data', join(dir, 'projets.sqlite')]);
  await run('npm run seed:bpm-functional (API arrêtée)', ['api/scripts/seed-bpm-functional.mjs', '--data', join(dir, 'bpm.sqlite'), '--report', join(dir, 'bpm-rapport.json')]);
  console.log('Jeux d’essai : tous passent.');
} catch (err) {
  console.error(`Jeux d’essai en échec : ${err.message}`);
  process.exitCode = 1;
} finally {
  api?.kill('SIGTERM');
  await rm(dir, { recursive: true, force: true });
}
