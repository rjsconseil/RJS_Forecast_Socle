// Couche HTTP : limites et en-têtes de sécurité, quelle que soit la route (rapport final du 26 novembre 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { BODY_LIMIT, createHttpHandler, SECURITY_HEADERS } from '../src/http.mjs';
import { makeSocle } from './helpers.mjs';

async function serve() {
  const { socle, dataFile } = await makeSocle();
  const server = createServer(createHttpHandler(socle, { dataFile, authMode: 'local' }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: async () => { server.close(); await socle.close(); } };
}

test('http · en-têtes de sécurité sur une réponse, une erreur et une route inconnue', async () => {
  const { base, close } = await serve();
  try {
    for (const path of ['/api/users', '/api/route-inconnue']) {
      const res = await fetch(base + path);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers.get(name), value, `${path} : ${name}`);
      await res.arrayBuffer();
    }
  } finally {
    await close();
  }
});

test('http · un corps au-delà de la limite est refusé (413) sans être lu en entier', async () => {
  const { base, close } = await serve();
  try {
    const big = JSON.stringify({ label: 'x'.repeat(BODY_LIMIT + 10) });
    const res = await fetch(base + '/api/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: big });
    assert.equal(res.status, 413);
    assert.equal((await res.json()).error.code, 'PAYLOAD_TOO_LARGE');
    const ok = await fetch(base + '/api/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.notEqual(ok.status, 413, 'un petit corps passe toujours');
    await ok.arrayBuffer();
  } finally {
    await close();
  }
});

// Faiblesse n° 1 du rapport « architecture et faiblesses » : une page d'un autre site ne doit rien pouvoir écrire.
async function serveRecette(authMode = 'local') {
  const { socle, dataFile } = await makeSocle();
  socle.config = { recetteReset: true };
  const server = createServer(createHttpHandler(socle, { dataFile, authMode }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { base: `http://127.0.0.1:${port}`, port, socle, close: async () => { server.close(); await socle.close(); } };
}

/** Requête brute (fetch impose son propre Host) : méthode, chemin, en-têtes, corps. */
async function raw(port, method, path, headers = {}, body = '') {
  const { request } = await import('node:http');
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { 'content-length': Buffer.byteLength(body), ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('http · une page d’un autre site ne peut ni remettre la recette à zéro ni écrire (Origin, Sec-Fetch-Site, type)', async () => {
  const { port, close } = await serveRecette();
  try {
    const host = `127.0.0.1:${port}`;
    const evil = await raw(port, 'POST', '/api/_recette/reset', { host, origin: 'https://evil.example', 'content-type': 'text/plain' });
    assert.equal(evil.status, 403);
    const cross = await raw(port, 'POST', '/api/_recette/reset', { host, 'sec-fetch-site': 'cross-site' });
    assert.equal(cross.status, 403);
    const opaque = await raw(port, 'POST', '/api/_recette/reset', { host, origin: 'null' });
    assert.equal(opaque.status, 403);
    const plain = await raw(port, 'POST', '/api/users', { host, 'content-type': 'text/plain' }, '{"label":"x"}');
    assert.equal(plain.status, 415);
    const form = await raw(port, 'POST', '/api/users', { host, 'content-type': 'application/x-www-form-urlencoded' }, 'label=x');
    assert.equal(form.status, 415);
    // Le site lui-même (même origine) et les scripts du poste (sans Origin) passent.
    const same = await raw(port, 'POST', '/api/_recette/reset', { host, origin: `http://${host}`, 'content-type': 'application/json' });
    assert.equal(same.status, 200);
    const script = await raw(port, 'POST', '/api/_recette/reset', { host, 'content-type': 'application/json' });
    assert.equal(script.status, 200);
  } finally {
    await close();
  }
});

test('http · mode local : un nom d’hôte étranger (DNS rebinding) est refusé, même en lecture', async () => {
  const { port, close } = await serveRecette();
  try {
    assert.equal((await raw(port, 'GET', '/api/users', { host: `evil.example:${port}` })).status, 403);
    assert.equal((await raw(port, 'GET', '/api/users', { host: `localhost:${port}` })).status, 200);
  } finally {
    await close();
  }
});
