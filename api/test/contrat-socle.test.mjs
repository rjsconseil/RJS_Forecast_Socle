// Contrat figé du grand noyau : l'interface côté site (grand-noyau.ts, cadre BPM-Astra) et les routes de l'API
// doivent correspondre à la photo rangée dans api/test/contrat/. Une différence veut dire que le socle a changé :
// c'est permis seulement en mode socle, dans une PR du socle qui met la photo à jour (npm run contrat -- --maj).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiRoutes, differences, root, siteInterface, SNAPSHOTS } from '../../scripts/contrat-socle.mjs';

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
const hint = '\nÉvolution voulue du socle ? PR en mode socle, puis npm run contrat -- --maj.';

test('contrat du grand noyau : les routes de l’API sont celles de la photo', async () => {
  assert.deepEqual(differences('Routes de l’API', await apiRoutes(), read(SNAPSHOTS.routes)), [], hint);
});

test('contrat du grand noyau : l’interface côté site (grand-noyau.ts, cadre.ts) est celle de la photo', { skip: !existsSync(join(root, 'web/node_modules/typescript')) && 'dépendances du site absentes (npm install --prefix web)' }, () => {
  assert.deepEqual(differences('Interface du site', siteInterface(), read(SNAPSHOTS.interface)), [], hint);
});
