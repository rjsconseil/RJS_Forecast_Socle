// Parcours d'une application autonome seulement, dans Chromium, sur le site construit (base et API temporaires,
// jeux d'essai), comme sur GitHub : la partie de BPM-Astra qui l'accueille à 1440 px, et ses pages à 375 px.
//
//   npm run e2e:app -- projets               reconstruit le site, puis rejoue les parcours
//   npm run e2e:app -- projets --sans-build  rejoue sur le site déjà construit
import { spawnSync } from 'node:child_process';
import { inscriptionOf, root } from './inscriptions.mjs';

const app = await inscriptionOf(process.argv[2]);
const step = (label, args, env = process.env) => {
  console.log(`\n— ${label}`);
  if (spawnSync(args[0], args.slice(1), { cwd: root, stdio: 'inherit', env }).status !== 0) { console.error(`✖ ${label}`); process.exit(1); }
};
if (!process.argv.includes('--sans-build')) step('Construction du site', ['npm', 'run', 'build']);
step(`Parcours de l'application « ${app.cle} »`, [process.execPath, 'scripts/e2e-ci.mjs'], { ...process.env, E2E_APP: app.cle });
console.log(`\n✓ Application « ${app.cle} » : parcours conformes.`);
