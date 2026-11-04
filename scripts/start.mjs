// `npm start` : démarre ensemble l'API locale (http://localhost:3410) et le site (http://localhost:4300),
// comme le site de référence. Aucune dépendance : Node lance les deux serveurs, préfixe leurs messages et les
// arrête ensemble (Ctrl+C, ou dès que l'un s'arrête). La réinitialisation de recette n'est pas activée ici :
// pour les jeux d'essai (`npm run seed`), lancer l'API avec `npm run api`.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiPort = Number(process.env.J1_API_PORT ?? 3410);
const webPort = 4300;
const ng = join(root, 'web', 'node_modules', '@angular', 'cli', 'bin', 'ng.js');

function stop(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 22)) stop(`Node ${process.versions.node} est trop ancien : installez Node 22.22 ou plus récent (24 ou 26 conviennent).`);
if (!existsSync(ng)) stop('Les dépendances du site manquent. Depuis ce dossier, lancez d’abord :\n\n    npm install --prefix web');

/** Un port déjà pris par un lancement précédent donne sinon une erreur peu lisible dans les serveurs. */
const listens = (port, host) =>
  new Promise((resolve) => {
    const probe = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => probe.close(() => resolve(true)))
      .listen(port, host);
  });
// Vérifié sur toutes les adresses et sur 127.0.0.1 : le site écoute en local seulement.
const portFree = async (port) => (await listens(port)) && (await listens(port, '127.0.0.1'));
for (const port of [apiPort, webPort]) {
  if (!(await portFree(port))) stop(`Le port ${port} est déjà utilisé : arrêtez le lancement précédent (Ctrl+C dans son terminal) puis relancez npm start.`);
}

const children = [];
let stopping = false;

function run(name, command, args, options) {
  const child = spawn(command, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  const prefix = (stream, out) => {
    let rest = '';
    stream.on('data', (chunk) => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop();
      for (const line of lines) out.write(`[${name}] ${line}\n`);
    });
    stream.on('end', () => rest && out.write(`[${name}] ${rest}\n`));
  };
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`\n[${name}] s’est arrêté (${signal ?? `code ${code}`}) : arrêt de l’autre serveur.`);
    shutdown(code ?? 1);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 400);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('api', process.execPath, [join(root, 'api', 'src', 'server.mjs')]);
run('site', process.execPath, [ng, 'serve'], { cwd: join(root, 'web'), env: { ...process.env, NG_CLI_ANALYTICS: 'false' } });

console.log(`RJS Forecast démarre : site http://localhost:${webPort} · API http://localhost:${apiPort} (Ctrl+C pour arrêter)`);
