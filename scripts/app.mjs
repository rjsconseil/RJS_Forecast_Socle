// Poste de travail d'une application autonome : le site complet, sur une base temporaire remplie des jeux d'essai
// (le jeu commun, puis ceux que l'application déclare dans son inscription). Tes vraies données ne sont jamais lues
// ni écrites ; la base temporaire disparaît à l'arrêt (Ctrl+C).
//
//   npm run app -- projets            API sur http://localhost:3410, site sur http://localhost:4300
//
// L'API redémarre seule quand api/src change, le site se recharge seul : on code et on débogue l'application,
// puis on rejoue ses tests (npm run test:app -- projets) et ses parcours (npm run e2e:app -- projets).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inscriptionOf, root } from './inscriptions.mjs';

const app = await inscriptionOf(process.argv[2]);
const apiPort = Number(process.env.J1_API_PORT ?? 3410);
const webPort = 4300;
const ng = join(root, 'web/node_modules/@angular/cli/bin/ng.js');
const stop = (message) => { console.error(`\n✖ ${message}\n`); process.exit(1); };
if (!existsSync(ng)) stop('Les dépendances du site manquent. Depuis ce dossier, lancez d’abord :\n\n    npm install --prefix web');
const listens = (port, host) => new Promise((res) => { const s = createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(port, host); });
for (const port of [apiPort, webPort]) {
  if (!(await listens(port)) || !(await listens(port, '127.0.0.1'))) stop(`Le port ${port} est déjà utilisé : arrêtez le lancement précédent (npm start ou npm run app) puis relancez.`);
}

const dir = await mkdtemp(join(tmpdir(), `socle-app-${app.cle}-`));
const dataFile = join(dir, 'essai.sqlite');
const apiEnv = { ...process.env, J1_API_PORT: String(apiPort), J1_DATA_FILE: dataFile, J1_ENABLE_RECETTE_RESET: '1' };
const children = [];
let stopping = false;
const prefix = (name, child) => {
  for (const [stream, out] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    let rest = '';
    stream?.on('data', (chunk) => { const lines = (rest + chunk).split('\n'); rest = lines.pop(); for (const l of lines) out.write(`[${name}] ${l}\n`); });
  }
};
const start = (name, args, options = {}) => {
  const child = spawn(process.execPath, args, { cwd: root, env: apiEnv, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  prefix(name, child);
  child.on('exit', (code, signal) => { if (!stopping && child.keep) { console.error(`\n[${name}] s’est arrêté (${signal ?? `code ${code}`}).`); shutdown(code ?? 1); } });
  children.push(child);
  return child;
};
const run = (label, args, env = apiEnv) => new Promise((res, rej) => {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'inherit'] });
  child.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${label} (code ${code})`))));
});
const waitFor = async (url, ms = 20000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 200))) {
    try { if ((await fetch(url)).ok) return; } catch { /* pas encore prêt */ }
  }
  throw new Error(`Injoignable : ${url}`);
};
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 600));
  await rm(dir, { recursive: true, force: true });
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

try {
  console.log(`Application « ${app.cle} » (${app.dossier}) sur une base temporaire : ${dataFile}`);
  // 1. Jeu commun, par les contrats HTTP (API de recette), puis les jeux de l'application, API arrêtée (un seul écrivain).
  let api = start('api', ['api/src/server.mjs']);
  await waitFor(`http://127.0.0.1:${apiPort}/api/health`);
  await run('Jeu d’essai commun', ['api/scripts/seed.mjs'], { ...apiEnv, J1_API_URL: `http://127.0.0.1:${apiPort}` });
  if (app.essais?.length) {
    await new Promise((r) => { api.once('exit', r); api.kill('SIGTERM'); });
    for (const essai of app.essais) await run(`Jeu d’essai ${essai}`, [essai, '--data', dataFile]);
  }
  // 2. Le poste de travail : l'API qui redémarre quand api/src change, le site qui se recharge seul.
  api = start('api', ['--watch-path=' + join(root, 'api/src'), '--watch-preserve-output', 'api/src/server.mjs']);
  api.keep = true;
  await waitFor(`http://127.0.0.1:${apiPort}/api/health`);
  const site = start('site', [ng, 'serve'], { cwd: join(root, 'web'), env: { ...process.env, NG_CLI_ANALYTICS: 'false' } });
  site.keep = true;
  const first = app.pages[0]?.slug;
  console.log(`\n✓ Prêt dans un instant : http://localhost:${webPort}/bpm-astra${first ? '/' + first : ''}`
    + `\n  Pages de l'application : ${app.pages.map((p) => p.label).join(', ') || 'aucune'}`
    + `\n  Tests : npm run test:app -- ${app.cle}   ·   Parcours : npm run e2e:app -- ${app.cle}   ·   Arrêt : Ctrl+C\n`);
} catch (err) {
  console.error(`✖ ${err.message}`);
  await shutdown(1);
}
