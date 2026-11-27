// Authentification (chantier 5) : inscription, connexion, jetons signés, révocation, limitation des essais, et ce
// que la connexion exigée change à l'API (chacun dans sa partition, administration réservée). Passe par la vraie couche
// HTTP (http.mjs) sur un port local.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHttpHandler } from '../src/http.mjs';
import { authSecret, clientAddress, createSessions, createThrottle, hashPassword, memoryThrottleStore, verifyPassword } from '../src/socle/auth.mjs';
import { key, makeSocle } from './helpers.mjs';

async function serve(authMode) {
  const { socle, dataFile } = await makeSocle();
  const server = createServer(createHttpHandler(socle, { dataFile, authMode }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  /** Un navigateur minimal : garde son cookie de session. */
  const browser = () => {
    let cookie = '';
    return async (method, path, body, headers = {}) => {
      const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => null), setCookie: set };
    };
  };
  return { socle, base, browser, close: async () => { server.close(); await socle.close(); } };
}

const signup = (call, email, label = 'Camille') => call('POST', '/api/auth/register', {
  requestKey: key('inscription'), email, password: 'mot de passe solide', label, userType: 'individuel', anchorDay: 1, cycleStartDate: '2026-08-01',
});

test('auth · empreinte scrypt salée, jeton signé : falsifié, expiré ou d’une autre clé = refusé', () => {
  const rec = hashPassword('mot de passe solide');
  assert.equal(rec.algo, 'scrypt');
  assert.ok(!JSON.stringify(rec).includes('solide'), 'le mot de passe n’est jamais enregistré');
  assert.notEqual(hashPassword('mot de passe solide').salt, rec.salt, 'un sel par empreinte');
  assert.equal(verifyPassword('mot de passe solide', rec), true);
  assert.equal(verifyPassword('mot de passe faux!', rec), false);
  const sessions = createSessions({ secret: 'secret-a', ttlHours: 1 });
  const token = sessions.issue('usr_1', 1_000);
  assert.equal(sessions.verify(token, 2_000).userId, 'usr_1');
  assert.equal(sessions.verify(token, 1_000 + 3600_000 + 1), null, 'expiré');
  assert.equal(createSessions({ secret: 'secret-b' }).verify(token, 2_000), null, 'autre secret');
  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ u: 'usr_2', iat: 1_000, exp: 9e15 })).toString('base64url');
  assert.equal(sessions.verify(`${forged}.${sig}`, 2_000), null, 'charge modifiée');
  assert.equal(sessions.verify(`${payload}.x${sig}`, 2_000), null, 'signature modifiée');
});

test('auth · connexion exigée : inscription, profil à soi seul, déconnexion, refus sans jeton', async (t) => {
  const app = await serve('required');
  t.after(app.close);
  const anon = app.browser();
  assert.equal((await anon('GET', '/api/bpm/summary')).body.error.code, 'AUTH_REQUIRED');
  assert.equal((await anon('GET', '/api/bpm/summary', null, { 'x-user-id': 'usr_quelconque' })).status, 401, 'l’en-tête ne suffit plus');
  assert.equal((await anon('POST', '/api/users', { requestKey: key(), label: 'X' })).status, 401);

  const camille = app.browser();
  const created = await signup(camille, 'Camille@Example.org');
  assert.equal(created.status, 201);
  assert.match(created.setCookie, /HttpOnly; SameSite=Lax/);
  const status = await camille('GET', '/api/auth/status');
  assert.deepEqual([status.body.mode, status.body.user.label, status.body.account.email], ['required', 'Camille', 'camille@example.org']);
  assert.equal((await camille('GET', '/api/bpm/summary')).status, 200);

  const bruno = app.browser();
  await signup(bruno, 'bruno@example.org', 'Bruno');
  const list = await bruno('GET', '/api/users');
  assert.deepEqual(list.body.map((u) => u.label), ['Bruno'], 'l’annuaire ne montre que son propre profil');
  assert.ok(!JSON.stringify(list.body).includes('scrypt'), 'aucune empreinte dans les lectures');
  // Le profil de Camille n'est pas lisible par Bruno, même en le nommant.
  const camilleId = status.body.user.id;
  const peek = await bruno('GET', '/api/bpm/summary', null, { 'x-user-id': camilleId });
  assert.ok(!JSON.stringify(peek.body).includes('Camille'));

  // Même adresse : refusée. Administration : réservée.
  assert.equal((await signup(app.browser(), 'camille@example.org')).body.error.code, 'UNIQUENESS_VIOLATION');
  assert.equal((await camille('GET', '/api/admin/journal')).status, 403);

  await camille('POST', '/api/auth/logout');
  assert.equal((await camille('GET', '/api/bpm/summary')).status, 401);
});

test('auth · connexion, mauvais mot de passe sans indice, limitation des essais, « se déconnecter partout »', async (t) => {
  const app = await serve('required');
  t.after(app.close);
  await signup(app.browser(), 'camille@example.org');
  const wrong = await app.browser()('POST', '/api/auth/login', { email: 'camille@example.org', password: 'pas le bon mot' });
  const unknown = await app.browser()('POST', '/api/auth/login', { email: 'personne@example.org', password: 'pas le bon mot' });
  assert.deepEqual([wrong.status, wrong.body.error.message], [unknown.status, unknown.body.error.message], 'même refus : rien ne dit si l’adresse existe');

  const phone = app.browser();
  const laptop = app.browser();
  assert.equal((await phone('POST', '/api/auth/login', { email: ' CAMILLE@example.org ', password: 'mot de passe solide' })).status, 200);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((await laptop('POST', '/api/auth/login', { email: 'camille@example.org', password: 'mot de passe solide' })).status, 200);
  assert.equal((await laptop('POST', '/api/auth/logout-all')).status, 200);
  assert.equal((await phone('GET', '/api/bpm/summary')).status, 401, 'les jetons émis avant sont refusés');

  // Huit échecs sur une adresse : les essais suivants sont refusés, même avec le bon mot de passe.
  for (let i = 0; i < 8; i += 1) await app.browser()('POST', '/api/auth/login', { email: 'camille@example.org', password: `faux ${i} mot de passe` });
  const blocked = await app.browser()('POST', '/api/auth/login', { email: 'camille@example.org', password: 'mot de passe solide' });
  assert.equal(blocked.body.error.code, 'AUTH_THROTTLED');
  assert.equal(blocked.status, 429);
});

test('auth · mode local (poste de travail) : le profil choisi suffit ; un profil existant reçoit ses identifiants', async (t) => {
  const app = await serve('local');
  t.after(app.close);
  const user = await app.socle.modules.users.createUser({ requestKey: key('user'), label: 'Sur le poste', userType: 'individuel', anchorDay: 1, cycleStartDate: '2026-08-01' });
  const call = app.browser();
  assert.equal((await call('GET', '/api/bpm/summary', null, { 'x-user-id': user.userId })).status, 200, 'comme avant : aucun mot de passe sur le poste');
  const set = await call('POST', '/api/auth/credentials', { email: 'poste@example.org', password: 'mot de passe solide' }, { 'x-user-id': user.userId });
  assert.equal(set.status, 200);
  const status = await call('GET', '/api/auth/status');
  assert.equal(status.body.account.email, 'poste@example.org', 'connecté par le cookie posé');
  // Changer d'identifiants exige le mot de passe actuel.
  const change = await call('POST', '/api/auth/credentials', { email: 'poste@example.org', password: 'nouveau mot de passe', currentPassword: 'faux mot de passe' });
  assert.equal(change.body.error.code, 'AUTH_INVALID');
});

// Faiblesses n° 5, 6 et 9 du rapport « architecture et faiblesses ».
test('auth · se déconnecter révoque le jeton de cet appareil, même copié ; les autres appareils restent connectés', async (t) => {
  const app = await serve('required');
  t.after(app.close);
  await signup(app.browser(), 'camille@example.org');
  const phone = app.browser();
  const laptop = app.browser();
  const login = await phone('POST', '/api/auth/login', { email: 'camille@example.org', password: 'mot de passe solide' });
  await laptop('POST', '/api/auth/login', { email: 'camille@example.org', password: 'mot de passe solide' });
  const stolen = login.setCookie.split(';')[0];
  assert.equal((await phone('POST', '/api/auth/logout')).status, 200);
  const replay = await app.browser()('GET', '/api/bpm/summary', null, { cookie: stolen });
  assert.equal(replay.status, 401, 'le jeton copié avant la déconnexion est refusé');
  assert.equal((await laptop('GET', '/api/bpm/summary')).status, 200, 'l’autre appareil reste connecté');
});

test('auth · limitation des essais : adresse réelle derrière le proxy du site, compteurs purgés, succès sans effacer l’adresse', async () => {
  const req = (remote, xff) => ({ socket: { remoteAddress: remote }, headers: xff ? { 'x-forwarded-for': xff } : {} });
  assert.equal(clientAddress(req('127.0.0.1', '203.0.113.5')), '203.0.113.5', 'proxy du poste : adresse transmise');
  assert.equal(clientAddress(req('198.51.100.7', '203.0.113.5'), {}), '198.51.100.7', 'proxy inconnu : en-tête ignoré');
  assert.equal(clientAddress(req('198.51.100.7', '10.0.0.1, 203.0.113.5'), { SOCLE_TRUST_PROXY: '1' }), '203.0.113.5', 'proxy de confiance : dernière adresse ajoutée');
  const store = memoryThrottleStore();
  const throttle = createThrottle({ max: 2, windowMs: 1000, store });
  await throttle.failed(['a'], 0);
  await throttle.failed(['a'], 10);
  await assert.rejects(throttle.check(['a'], 20), { code: 'AUTH_THROTTLED' });
  await throttle.check(['a'], 2000);
  await throttle.failed(['b'], 2000);
  assert.deepEqual([...store.failures.keys()], ['b'], 'les compteurs échus sont purgés');
});

test('auth · secret des jetons : exigé avec une base partagée, assez long', () => {
  const saved = process.env.SOCLE_AUTH_SECRET;
  try {
    delete process.env.SOCLE_AUTH_SECRET;
    assert.throws(() => authSecret('/tmp/x.sqlite', { shared: true }), /SOCLE_AUTH_SECRET/);
    process.env.SOCLE_AUTH_SECRET = 'court';
    assert.throws(() => authSecret('/tmp/x.sqlite'), /trop court/);
    process.env.SOCLE_AUTH_SECRET = 'x'.repeat(40);
    assert.equal(authSecret('/tmp/x.sqlite', { shared: true }), 'x'.repeat(40));
  } finally {
    if (saved === undefined) delete process.env.SOCLE_AUTH_SECRET;
    else process.env.SOCLE_AUTH_SECRET = saved;
  }
});
