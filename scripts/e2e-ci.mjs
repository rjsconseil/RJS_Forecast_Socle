// Tests d'interface en intégration continue (et dans le cloud) : le site construit, servi comme en production
// (scripts/site-server.mjs, avec ses en-têtes de sécurité et sa CSP), une API de recette et une base temporaires,
// les jeux d'essai, puis les tests d'interface dans Chromium : Astra, parcours de navigation de BPM, réglages de la
// navigation, et le scénario des projets de la vie de bout en bout.
//   npm run build && npm run e2e:ci
// Navigateur : CHROME_PATH, sinon celui de playwright-core (`npx playwright-core install chromium`).
// Aucune donnée réelle n'est lue ni écrite.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
assert(existsSync(join(root, 'web/dist/web/browser/index.html')), 'Site non construit : lancer d’abord npm run build.');
delete process.env.SOCLE_TODAY;
const chrome = process.env.CHROME_PATH ?? ['/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync)
  ?? (await import('playwright-core')).chromium.executablePath();
assert(chrome && existsSync(chrome), 'Navigateur introuvable : CHROME_PATH, ou npx playwright-core install chromium.');

const dir = await mkdtemp(join(tmpdir(), 'socle-e2e-'));
const freePort = () => new Promise((res) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const children = [];
const start = (args, env) => {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'inherit'] });
  children.push(child);
  return child;
};
const run = (label, args, env) => new Promise((res, rej) => {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit' });
  child.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${label} (code ${code})`))));
});
async function waitFor(url, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Injoignable : ${url}`);
}

try {
  const apiPort = await freePort();
  const sitePort = await freePort();
  const apiEnv = { J1_API_PORT: String(apiPort), J1_DATA_FILE: join(dir, 'e2e.sqlite'), J1_ENABLE_RECETTE_RESET: '1', SOCLE_DATA_ENGINE: 'sqlite', SOCLE_PG_URL: '', SOCLE_AUTH: 'local', SOCLE_HOST: '127.0.0.1' };
  let api = start(['api/src/server.mjs'], apiEnv);
  start(['scripts/site-server.mjs'], { J1_API_PORT: String(apiPort), SOCLE_SITE_PORT: String(sitePort), SOCLE_SITE_HOST: '127.0.0.1' });
  // Adresses en IPv4 explicite : sur les machines de CI, « localhost » peut désigner ::1, où rien n'écoute.
  const site = `http://127.0.0.1:${sitePort}`;
  await waitFor(`${site}/api/health`);
  await run('Jeux d’essai', ['api/scripts/seed.mjs'], { J1_API_URL: `http://127.0.0.1:${apiPort}` });
  // Puis le foyer des projets de la vie (dix projets financés), écrit API arrêtée (un seul écrivain).
  await new Promise((r) => { api.once('exit', r); api.kill('SIGTERM'); });
  await run('Jeu d’essai des projets', ['api/scripts/seed-projets.mjs', '--data', join(dir, 'e2e.sqlite')]);
  api = start(['api/src/server.mjs'], apiEnv);
  await waitFor(`${site}/api/health`);
  // Le site envoie ses en-têtes de sécurité, et l'API refuse une écriture venue d'un autre site à travers le proxy.
  const page = await fetch(site + '/');
  const csp = page.headers.get('content-security-policy') ?? '';
  assert.match(csp, /frame-ancestors 'none'/, 'CSP du site absente');
  // Balises <style> : seulement avec le nonce de la page, neuf à chaque envoi et recopié sur <app-root ngCspNonce>.
  const nonce = /style-src-elem 'self' 'nonce-([^']+)'/.exec(csp)?.[1];
  assert.ok(nonce && !/style-src(-elem)? [^;]*'unsafe-inline'/.test(csp), 'styles en ligne sans nonce acceptés');
  assert.ok((await page.text()).includes(`ngcspnonce="${nonce}"`), 'nonce absent de la page');
  const again = (await fetch(site + '/')).headers.get('content-security-policy') ?? '';
  assert.ok(!again.includes(nonce), 'le nonce doit changer à chaque envoi');
  const evil = await fetch(site + '/api/_recette/reset', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'text/plain' } });
  assert.equal(evil.status, 403, 'une écriture d’un autre site doit être refusée');
  console.log('✓ En-têtes du site (nonce des styles) et refus des écritures d’un autre site');
  const browserEnv = { BPM_BASE_URL: site, CHROME_PATH: chrome };
  // npm run e2e:app -- <clé> : la seule application autonome demandée (E2E_APP), sans les autres parcours du socle.
  if (process.env.E2E_APP) {
    await run(`Tests d’interface de l’application ${process.env.E2E_APP}`, ['e2e/astra.e2e.mjs'], browserEnv);
  } else {
    await run('Tests d’interface Astra', ['e2e/astra.e2e.mjs'], browserEnv);
    await run('Parcours de navigation de BPM', ['e2e/bpm-navigation.e2e.mjs'], browserEnv);
    await run('Réglages de la navigation', ['e2e/navigation-system.e2e.mjs'], browserEnv);
    // Scénario des projets de mai à novembre : sa propre API et son propre site, sur d'autres ports.
    await run('Projets de la vie, de bout en bout', ['e2e/projets.e2e.mjs'], { CHROME_PATH: chrome, E2E_API_PORT: String(await freePort()), E2E_WEB_PORT: String(await freePort()) });
  }
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exitCode = 1;
} finally {
  for (const c of children) c.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  await rm(dir, { recursive: true, force: true });
}
