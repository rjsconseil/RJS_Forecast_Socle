// Garde de la lecture sans copie (ARCHITECTURE §16.3) : dans une commande, un parcours complet d'une collection du
// brouillon (`Object.values(tx.draft.x)`) copie chaque objet lu. Les commandes passent par `om.list` ou `om.by`.
// Seules les migrations (qui travaillent sur toute la base, une fois) parcourent le brouillon entier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../src/modules/', import.meta.url).pathname;
const FULL_SCAN = /(Object\.(values|keys|entries)\(\s*tx\.draft\.|for\s*\(\s*const\s+\w+\s+(in|of)\s+tx\.draft\.)/;

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.mjs') ? [join(dir, e.name)] : []));
}

test('aucune commande ne parcourt toute une collection du brouillon', () => {
  const found = [];
  for (const f of files(ROOT)) {
    if (f.endsWith('migrations.mjs')) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (FULL_SCAN.test(line)) found.push(`${relative(ROOT, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(found, [], `Parcours complet du brouillon (préférer om.list ou om.by) : ${found.join(', ')}`);
});
