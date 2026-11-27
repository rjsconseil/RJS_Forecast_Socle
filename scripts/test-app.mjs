// Tests d'une application autonome seulement : ses tests et ceux de ses fonctionnalités par section, la vérification
// de son inscription dans BPM-Astra, puis les gardes (trois étages, contrat figé du grand noyau, mode des PR).
// Boucle courte de débogage ; la PR, elle, rejoue toute la non-régression sur GitHub.
//
//   npm run test:app -- projets
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { inscriptionOf, root } from './inscriptions.mjs';

const app = await inscriptionOf(process.argv[2]);
const source = app.dossier.replace(/^web\/src\//, '');
const include = [source];
// Les fonctionnalités de la section (une application hybride n'en a pas à elle).
const fonctionnalites = source.replace(/\/application$/, '/fonctionnalites');
if (fonctionnalites !== source && existsSync(join(root, 'web/src', fonctionnalites))) include.push(fonctionnalites);
// L'inscription : menu, onglets et gestes de BPM-Astra.
include.push('app/astra/astra-parts.spec.ts', 'app/navigation/navigation-engine.spec.ts');

const ng = join(root, 'web/node_modules/@angular/cli/bin/ng.js');
if (!existsSync(ng)) { console.error('✖ Les dépendances du site manquent : npm install --prefix web'); process.exit(1); }
console.log(`Application « ${app.cle} » : ${include.join(', ')}`);
const site = spawnSync(process.execPath, [ng, 'test', '--watch=false', ...include.map((i) => `--include=${i}`)],
  { cwd: join(root, 'web'), stdio: 'inherit', env: { ...process.env, NG_CLI_ANALYTICS: 'false' } });
const guards = spawnSync(process.execPath, ['--test', 'api/test/application-isolation.test.mjs', 'api/test/contrat-socle.test.mjs', 'api/test/mode-pr.test.mjs'],
  { cwd: root, stdio: 'inherit' });
const ok = site.status === 0 && guards.status === 0;
console.log(ok ? `\n✓ Application « ${app.cle} » : tests et gardes au vert.` : `\n✗ Application « ${app.cle} » : ${site.status ? 'tests du site' : ''}${site.status && guards.status ? ' et ' : ''}${guards.status ? 'gardes' : ''} en échec.`);
process.exit(ok ? 0 : 1);
