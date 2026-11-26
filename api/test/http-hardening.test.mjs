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
