import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNavigation } from '../src/modules/navigation/index.mjs';
import { makeSocle, rejects } from './helpers.mjs';
test('navigation validates presentation only, never destinations or arbitrary CSS', () => {
  const config = style => ({ version: 1, scopes: { site: { styles: { primary: { section: style } } } } });
  validateNavigation(config({ size: 18, color: '#123abc', activeColor: '#ffffff', spacing: 4 }));
  for (const style of [{ size: 11 }, { size: 29 }, { spacing: -1 }, { color: 'red;display:none' }, { fontFamily: 'serif' }, { href: '/other' }]) assert.throws(() => validateNavigation(config(style)), { code: 'VALIDATION' });
  assert.throws(() => validateNavigation({ version: 1, scopes: { site: { routes: {} } } }), { code: 'VALIDATION' });
  assert.throws(() => validateNavigation({ version: 1, scopes: { site: { labels: [] } } }), { code: 'VALIDATION' });
});
test('navigation settings persist globally and reject concurrent lost updates', async () => {
  const { socle, reload } = await makeSocle();
  const key = 'navigation.presentation';
  const value = { version: 1, scopes: { 'module:bpm': { labels: { '/tableau-de-bord': 'Mon budget' } }, 'page:/vision': { styles: { secondary: { detail: { size: 18 } } } } } };
  const result = await socle.modules.navigation.write({ expectedRevision: 0, value });
  assert.equal(result.parameter.revision, 1);
  await rejects(socle.modules.navigation.write({ expectedRevision: 0, value }), 'STALE_VERSION');
  const next = await reload();
  try { assert.deepEqual(next.modules.navigation.read().value, value); }
  finally { await next.close(); }
});
