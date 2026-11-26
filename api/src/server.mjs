// API locale du socle : expose en HTTP/JSON les routes déclarées par chaque module.
// Aucune règle métier ici.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createSocle } from './socle/index.mjs';
import { SOCLE_MODULES } from './modules/index.mjs';
import { DomainError, ERROR_HTTP } from './socle/errors.mjs';

const PORT = Number(process.env.J1_API_PORT ?? 3410);
const DATA_FILE = resolve(process.env.J1_DATA_FILE ?? new URL('../data/store.sqlite', import.meta.url).pathname);

const socle = await createSocle({
  dataFile: DATA_FILE,
  modules: SOCLE_MODULES,
  faultInjection: process.env.J1_ENABLE_FAULT_INJECTION === '1',
});
socle.config = { dataFile: DATA_FILE, recetteReset: process.env.J1_ENABLE_RECETTE_RESET === '1', startedAt: new Date().toISOString() };

const routes = [];
for (const m of socle.registry.modules.values()) {
  for (const [method, pattern, handler] of socle.routesOf(m)) {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
    routes.push({ method, re, keys, handler, module: m.id });
  }
}

// ---------- Flux des changements (technique, sans règle métier) ----------
// Chaque écriture réussie est annoncée aux pages ouvertes de son user (Server-Sent Events) : révision de sa
// partition, user de la commande et onglet d'origine (`x-client-id`), pour qu'un affichage se relise sans attendre.
// Une page sans user (administration) reçoit toutes les annonces.
const listeners = new Set();
function announce(change) {
  const line = `event: change\ndata: ${JSON.stringify(change)}\n\n`;
  for (const l of listeners) if (!l.userId || !change.userId || l.userId === change.userId) l.res.write(line);
}
async function openChanges(req, res, url) {
  const userId = url.searchParams.get('user') || null;
  const revision = userId ? await socle.store.within(userId, () => socle.store.state.revision).catch(() => null) : null;
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write(`event: ready\ndata: ${JSON.stringify({ revision })}\n\n`);
  const listener = { res, userId };
  listeners.add(listener);
  const alive = setInterval(() => res.write(': ok\n\n'), 25000);
  req.on('close', () => { clearInterval(alive); listeners.delete(listener); });
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DomainError('VALIDATION', 'Corps de requête JSON invalide.');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/api/changes') return openChanges(req, res, url);
  const send = (status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(payload));
  };
  const match = routes.filter((r) => r.method === req.method).map((r) => ({ r, m: r.re.exec(url.pathname) })).find((x) => x.m);
  if (!match) return send(404, { error: { code: 'NOT_FOUND', message: 'Route inconnue.' } });
  try {
    const params = Object.fromEntries(match.r.keys.map((k, i) => [k, decodeURIComponent(match.m[i + 1])]));
    const body = req.method === 'GET' ? {} : await readBody(req);
    const ctx = { userId: req.headers['x-user-id'] || null };
    // La requête travaille dans la partition de son user : l'état lu par les modules est sa vue, revalidée contre la base.
    const revision = () => (ctx.userId ? socle.store.viewOf(ctx.userId).revision : null);
    const { result, before, after } = await socle.store.within(ctx.userId, async () => {
      const before = revision();
      const result = await match.r.handler({ ctx, params, body, query: url.searchParams });
      return { result, before, after: revision() };
    });
    const created = !ctx.userId && result?.userId && result?.replayed === false;
    if (req.method !== 'GET' && (before !== after || created)) {
      announce({ revision: after, userId: ctx.userId ?? (created ? result.userId : null), clientId: req.headers['x-client-id'] || null, module: match.r.module });
    }
    if (result?.__download) {
      res.writeHead(200, { 'content-type': result.__type, 'content-disposition': `attachment; filename="${result.__download}"`, 'cache-control': 'no-store' });
      return res.end(result.__body);
    }
    send(req.method === 'POST' && result?.replayed === false ? 201 : 200, result ?? null);
  } catch (err) {
    if (err instanceof DomainError) return send(ERROR_HTTP[err.code] ?? 400, { error: err.toJSON() });
    console.error(err);
    send(500, { error: { code: 'INTERNAL', message: 'Erreur interne inattendue.' } });
  }
});

server.listen(PORT, () => {
  console.log(`RJS Forecast — socle sur http://localhost:${PORT} (données : ${DATA_FILE}, partitions par user)`);
  console.log(`Modules : ${socle.registry.describe().map((m) => `${m.id}(N${m.level})`).join(', ')}`);
});
