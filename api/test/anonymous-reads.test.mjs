// Sans utilisateur choisi, le site n'envoie pas les lectures qui en exigent un (web/src/app/core/api.service.ts).
// Ce test garde la liste du site alignée sur le serveur : toute lecture refusée sans utilisateur y figure,
// et aucune lecture ouverte n'est retenue à tort.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeSocle } from './helpers.mjs';
import { SOCLE_MODULES } from '../src/modules/index.mjs';

test('lectures sans utilisateur : la règle du site correspond aux refus du serveur', async () => {
  const source = await readFile(new URL('../../web/src/app/core/api.service.ts', import.meta.url), 'utf8');
  const list = (name) => JSON.parse(new RegExp(`${name} = (\\[[^\\]]*\\])`).exec(source)[1].replaceAll("'", '"'));
  const bound = list('USER_BOUND_READS');
  const openCalendar = list('OPEN_CALENDAR_READS');
  const needsUser = (path) => path.startsWith('/api/calendar') ? !openCalendar.includes(path)
    : bound.some((prefix) => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : prefix + '/'));

  const { socle } = await makeSocle();
  for (const mod of SOCLE_MODULES) for (const [method, path, handler] of socle.routesOf(mod)) {
    if (method !== 'GET') continue;
    const params = Object.fromEntries([...path.matchAll(/:(\w+)/g)].map((m) => [m[1], mod.id === 'calendar' ? 'noyau' : 'x']));
    const concrete = path.replace(/:(\w+)/g, (_, name) => params[name]);
    let code = null;
    try { await handler({ ctx: { userId: null }, params, body: {}, query: new URLSearchParams() }); } catch (error) { code = error.code; }
    assert.equal(needsUser(concrete), code === 'CONTEXT_REQUIRED', `${path} : ${code ?? 'ouverte'}`);
  }
  await socle.close();
});
