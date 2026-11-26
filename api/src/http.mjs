// Couche HTTP du socle : expose en JSON les routes déclarées par chaque module, établit l'identité de chaque requête
// (authentification), la fait travailler dans la partition de son user et annonce les changements aux pages ouvertes.
// Aucune règle métier ici : les comptes et leurs règles sont dans le module users, les outils dans socle/auth.mjs.
import { DomainError, ERROR_HTTP, fail } from './socle/errors.mjs';
import { AUTH_MODES, authSecret, cookieOf, createSessions, createThrottle, SESSION_COOKIE } from './socle/auth.mjs';

/** Adresses réservées à l'administration quand la connexion est exigée. */
const ADMIN_PATHS = /^\/api\/(admin|om|_recette)(\/|$)/;
/** Taille maximale d'un corps de requête JSON (octets) : 1 Mo par défaut, `SOCLE_BODY_LIMIT` pour la changer. */
export const BODY_LIMIT = Number(process.env.SOCLE_BODY_LIMIT) || 1024 * 1024;
/** En-têtes de sécurité de toutes les réponses de l'API (JSON, flux, téléchargements). */
export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
};
/** Adresses ouvertes sans connexion quand la connexion est exigée. */
const PUBLIC_PATHS = new Set(['GET /api/users/types']);
/** Méthodes sans effet : seules à échapper au contrôle de l'origine et du type de contenu. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Noms d'hôte du poste : seuls acceptés en mode local, sauf liste explicite (`SOCLE_ALLOWED_HOSTS`). */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const listOf = (value) => String(value ?? '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
/** Nom d'hôte d'un en-tête `Host` (sans le port). */
export function hostnameOf(host) {
  const h = String(host ?? '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0];
}

/**
 * Garde contre les requêtes venues d'un autre site (CSRF) et le « DNS rebinding » :
 * - `Host` : en mode local, le poste seul (localhost, 127.0.0.1, ::1) ; sinon la liste `SOCLE_ALLOWED_HOSTS` si elle
 *   est fixée (le domaine du site en ligne) ;
 * - écriture (toute méthode hors GET/HEAD/OPTIONS) : refusée si le navigateur la dit venue d'un autre site
 *   (`Sec-Fetch-Site: cross-site`), ou si son `Origin` n'est ni celui de la requête ni dans `SOCLE_ALLOWED_ORIGINS` ;
 *   son corps, s'il y en a un, doit être déclaré `application/json` (un formulaire ou un `text/plain` d'une autre page
 *   ne passe plus).
 */
export function createRequestGuard({ required, env = process.env } = {}) {
  const hosts = listOf(env.SOCLE_ALLOWED_HOSTS);
  const origins = new Set(listOf(env.SOCLE_ALLOWED_ORIGINS));
  return function check(req) {
    const host = hostnameOf(req.headers.host);
    if (hosts.length ? !hosts.includes(host) && !LOOPBACK_HOSTS.has(host) : !required && !LOOPBACK_HOSTS.has(host)) {
      fail('FORBIDDEN', 'Adresse du site non reconnue.', { host });
    }
    if (SAFE_METHODS.has(req.method)) return;
    if (String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') fail('FORBIDDEN', 'Requête venue d’un autre site : refusée.');
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      let o;
      try { o = new URL(origin); } catch { fail('FORBIDDEN', 'Origine de la requête invalide.'); }
      const same = o.host.toLowerCase() === String(req.headers.host ?? '').toLowerCase();
      if (!same && !origins.has(o.origin.toLowerCase())) fail('FORBIDDEN', 'Requête venue d’un autre site : refusée.', { origin: o.origin });
    } else if (origin === 'null') fail('FORBIDDEN', 'Requête d’origine opaque : refusée.');
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const hasBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'] !== undefined;
    if ((type && type !== 'application/json') || (hasBody && !type)) {
      fail('UNSUPPORTED_MEDIA_TYPE', 'Le corps d’une requête doit être du JSON (content-type: application/json).', { contentType: type || null });
    }
  };
}

export function createHttpHandler(socle, { dataFile, authMode = process.env.SOCLE_AUTH || 'local' } = {}) {
  if (!AUTH_MODES.includes(authMode)) throw new Error(`SOCLE_AUTH inconnu : ${authMode} (attendu : ${AUTH_MODES.join(', ')})`);
  const required = authMode === 'required';
  const sessions = createSessions({ secret: authSecret(dataFile) });
  const throttle = createThrottle();
  const users = socle.modules.users;
  const checkRequest = createRequestGuard({ required });

  const routes = [];
  for (const m of socle.registry.modules.values()) {
    for (const [method, pattern, handler] of socle.routesOf(m)) {
      const keys = [];
      const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
      routes.push({ method, re, keys, handler, module: m.id });
    }
  }

  // ---------- identité ----------

  /** Le user d'un jeton valide (signature, expiration, pas révoqué par « se déconnecter partout »), sinon `null`. */
  async function identityOf(req) {
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const token = bearer ?? cookieOf(req.headers.cookie, SESSION_COOKIE);
    const session = sessions.verify(token);
    if (!session) return null;
    const account = await socle.store.within(session.userId, () => users.accountOf(session.userId));
    if (!account || session.issuedAt < account.sessionsFrom) return null;
    return { userId: session.userId, role: account.role, email: account.email };
  }

  /** Mode local : le jeton s'il y en a un, sinon le profil choisi sur le poste (`x-user-id`). Mode exigé : le jeton seul. */
  async function contextOf(req) {
    const identity = await identityOf(req);
    if (identity) return { userId: identity.userId, identity };
    return { userId: required ? null : req.headers['x-user-id'] || null, identity: null };
  }

  function guard(method, path, ctx) {
    if (!required || path.startsWith('/api/auth/') || PUBLIC_PATHS.has(`${method} ${path}`)) return;
    if (!ctx.userId) fail('AUTH_REQUIRED', 'Connexion requise.');
    if (ADMIN_PATHS.test(path) && ctx.identity?.role !== 'admin') fail('FORBIDDEN', 'Réservé à l’administration.');
    if (method === 'POST' && path === '/api/users') fail('FORBIDDEN', 'La création d’un profil passe par l’inscription.');
  }

  const secure = (req) => process.env.SOCLE_COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https';
  const sessionCookie = (req, token, maxAge) =>
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`;

  // ---------- routes de connexion (posent ou retirent le cookie de session) ----------

  async function authRoute(req, path, body, ctx) {
    const login = (userId) => ({ cookie: sessionCookie(req, sessions.issue(userId), sessions.ttlSeconds) });
    const logout = { cookie: sessionCookie(req, '', 0) };
    const status = (userId) => (!userId ? { mode: authMode, user: null, account: null } : socle.store.within(userId, () => {
      const u = socle.state.users[userId];
      const a = users.accountOf(userId);
      return { mode: authMode, user: u ? { id: u.id, label: u.label } : null, account: a ? { email: a.email, role: a.role } : null };
    }));
    switch (`${req.method} ${path}`) {
      case 'GET /api/auth/status':
        return { payload: await status(ctx.identity?.userId ?? (required ? null : ctx.userId)) };
      case 'POST /api/auth/register': {
        const result = await users.register(body);
        return { status: result.replayed ? 200 : 201, payload: { userId: result.userId, replayed: result.replayed }, ...login(result.userId), created: result };
      }
      case 'POST /api/auth/login': {
        const keys = [`login:${String(body.email ?? '').trim().toLowerCase()}`, `ip:${req.socket.remoteAddress}`];
        throttle.check(keys);
        try {
          const { userId } = await users.authenticate(body.email, body.password);
          throttle.succeeded(keys);
          return { payload: await status(userId), ...login(userId) };
        } catch (err) {
          if (err instanceof DomainError && err.code === 'AUTH_INVALID') throttle.failed(keys);
          throw err;
        }
      }
      case 'POST /api/auth/logout':
        return { payload: { mode: authMode, user: null }, ...logout };
      case 'POST /api/auth/logout-all':
        if (!ctx.userId) fail('AUTH_REQUIRED', 'Connexion requise.');
        await socle.store.within(ctx.userId, () => users.revokeSessions(ctx));
        return { payload: { mode: authMode, user: null }, ...logout };
      case 'POST /api/auth/credentials': {
        if (!ctx.userId) fail('AUTH_REQUIRED', 'Connexion requise.');
        const result = await socle.store.within(ctx.userId, () => users.setCredentials(ctx, body));
        return { payload: result, ...login(ctx.userId) };
      }
      default:
        return null;
    }
  }

  // ---------- flux des changements ----------
  // Chaque écriture réussie est annoncée aux pages ouvertes de son user (Server-Sent Events) : révision de sa
  // partition, user de la commande et onglet d'origine (`x-client-id`). Une page sans user (administration, mode
  // local) reçoit toutes les annonces.
  const listeners = new Set();
  function announce(change) {
    const line = `event: change\ndata: ${JSON.stringify(change)}\n\n`;
    for (const l of listeners) if (!l.userId || !change.userId || l.userId === change.userId) l.res.write(line);
  }
  async function openChanges(req, res, url, ctx) {
    const userId = required ? ctx.userId : url.searchParams.get('user') || ctx.userId || null;
    if (required && !userId) {
      res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'Connexion requise.' } }));
    }
    const revision = userId ? await socle.store.within(userId, () => socle.store.state.revision).catch(() => null) : null;
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(`event: ready\ndata: ${JSON.stringify({ revision })}\n\n`);
    const listener = { res, userId };
    listeners.add(listener);
    const alive = setInterval(() => res.write(': ok\n\n'), 25000);
    req.on('close', () => { clearInterval(alive); listeners.delete(listener); });
  }

  async function readBody(req) {
    const declared = Number(req.headers['content-length']);
    if (declared > BODY_LIMIT) tooLarge();
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > BODY_LIMIT) tooLarge();
      chunks.push(c);
    }
    if (!chunks.length) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new DomainError('VALIDATION', 'Corps de requête JSON invalide.');
    }
  }

  function tooLarge() {
    fail('PAYLOAD_TOO_LARGE', `Requête trop volumineuse : ${Math.round(BODY_LIMIT / 1024)} Ko au plus.`, { limit: BODY_LIMIT });
  }

  // ---------- requêtes ----------

  return async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    const send = (status, payload, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
      res.end(JSON.stringify(payload));
    };
    try {
      checkRequest(req);
      const ctxFull = await contextOf(req);
      const ctx = { userId: ctxFull.userId };
      if (req.method === 'GET' && url.pathname === '/api/changes') return await openChanges(req, res, url, ctxFull);
      if (url.pathname.startsWith('/api/auth/')) {
        const body = req.method === 'GET' ? {} : await readBody(req);
        const out = await authRoute(req, url.pathname, body, ctxFull);
        if (!out) return send(404, { error: { code: 'NOT_FOUND', message: 'Route inconnue.' } });
        if (out.created?.replayed === false) announce({ revision: null, userId: out.created.userId, clientId: req.headers['x-client-id'] || null, module: 'users' });
        return send(out.status ?? 200, out.payload, out.cookie ? { 'set-cookie': out.cookie } : {});
      }
      const match = routes.filter((r) => r.method === req.method).map((r) => ({ r, m: r.re.exec(url.pathname) })).find((x) => x.m);
      if (!match) return send(404, { error: { code: 'NOT_FOUND', message: 'Route inconnue.' } });
      guard(req.method, url.pathname, ctxFull);
      // Connexion exigée : l'annuaire ne montre que son propre profil.
      if (required && req.method === 'GET' && url.pathname === '/api/users') {
        return send(200, [await socle.store.within(ctx.userId, () => users.userSummary(ctx.userId))].filter(Boolean));
      }
      const params = Object.fromEntries(match.r.keys.map((k, i) => [k, decodeURIComponent(match.m[i + 1])]));
      const body = req.method === 'GET' ? {} : await readBody(req);
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
  };
}
