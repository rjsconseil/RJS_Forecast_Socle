// Lexique des actions de BPM (docs/LORE-BPM.md) : aucun bouton ni action déclarée de BPM ne commence
// par un verbe écarté. La liste vient de web/src/app/bpm/ui/lexicon.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../web/src/app/bpm/', import.meta.url));
const sources = async (dir) => (await Promise.all((await readdir(dir)).map(async (name) => {
  const path = join(dir, name);
  if ((await stat(path)).isDirectory()) return sources(path);
  return /\.(ts|html)$/.test(name) && !name.endsWith('.spec.ts') && name !== 'lexicon.ts' ? [path] : [];
}))).flat();

test('lexique BPM : aucun bouton ni action ne commence par un verbe écarté', async () => {
  const lexicon = await readFile(join(root, 'ui/lexicon.ts'), 'utf8');
  const block = /BPM_RETIRED_VERBS[^{]*\{([\s\S]*?)\};/.exec(lexicon)[1];
  const retired = [...block.matchAll(/'?([A-ZÀ-Ü][\p{L} ]*?)'?\s*:/gu)].map((m) => m[1]).filter((verb) => verb !== 'Financer');
  assert.ok(retired.length > 8, 'verbes écartés lus dans le lexique');
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:class="[^"]*btn[^"]*"[^>]*>\\s*(?:＋\\s*)?|label: ')(${retired.map(escape).join('|')})(?![\\p{L}])`, 'gu');
  const found = [];
  for (const file of await sources(root)) for (const m of (await readFile(file, 'utf8')).matchAll(pattern)) found.push(`${file.slice(root.length)} : ${m[1]}`);
  assert.deepEqual(found, []);
});
