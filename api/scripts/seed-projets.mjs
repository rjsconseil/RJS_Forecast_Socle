// Jeu d'essai des projets de la vie : ajoute au stockage un foyer d'essai dont les dix projets sont rejoués sur les six
// mois qui précèdent le mois en cours (clos) et sur le mois en cours jusqu'à aujourd'hui (voir project-scenarios.mjs) :
// budgets attribués et ventilés, dépassements autorisés ou refusés, facturation de fin de cycle, retours, clôtures.
// La suite du mois en cours reste prévue (dépenses, échéances, loisirs) : aucun règlement n'est daté dans le futur.
// Usage : API arrêtée (un seul écrivain), puis
//   npm run seed:projets -- [--nom "TEST PROJETS · Famille Laurent"] [--data <store.json>]
// Le stockage existant est sauvegardé à côté avant l'écriture ; les autres users ne sont pas touchés.
import { access, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createSocle } from '../src/socle/index.mjs';
import { SOCLE_MODULES } from '../src/modules/index.mjs';
import { runProjectScenarios } from './project-scenarios.mjs';

const API_DIR = resolve(import.meta.dirname, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const DATA_FILE = resolve(arg('data', process.env.J1_DATA_FILE ?? join(API_DIR, 'data/store.json')));
const LABEL = arg('nom', 'TEST PROJETS · Famille Laurent');

function refuse(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
const until = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const start = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}`;

let socle;
try {
  socle = await createSocle({ dataFile: DATA_FILE, modules: SOCLE_MODULES });
} catch (err) {
  if (err.code === 'STORE_LOCKED') refuse('L’API est lancée sur ce stockage : arrêtez-la (Ctrl+C dans le terminal de npm start), puis relancez.');
  throw err;
}
try {
  if (Object.values(socle.state.users).some((u) => u.label === LABEL)) refuse(`Un user « ${LABEL} » existe déjà. Choisissez un autre nom : npm run seed:projets -- --nom "TEST PROJETS · autre foyer"`);
  if (await access(DATA_FILE).then(() => true, () => false)) {
    const backup = join(DATA_FILE, '..', `store.before-seed-projets-${now.toISOString().replace(/[:.]/g, '-')}.json`);
    await copyFile(DATA_FILE, backup);
    console.log(`Sauvegarde : ${backup}`);
  }
  const r = await runProjectScenarios(socle, { start, until, label: LABEL });
  console.log(`\nFoyer d'essai « ${r.label} » — périodes ${r.months.join(', ')} (la dernière en cours, jouée jusqu'au ${r.until} : ${r.played}/${r.total} événements)\n`);
  for (const s of r.steps) console.log(`  ${s.date}  ${s.text}`);
  console.log('\nContrôles :');
  for (const c of r.checks) console.log(`  ${c.ok ? '✓' : '✖'} ${c.name}${c.ok ? '' : ` — attendu ${JSON.stringify(c.expected)}, observé ${JSON.stringify(c.observed)}`}`);
  console.log(`\n${r.checks.filter((c) => c.ok).length}/${r.checks.length} contrôles réussis. Ouvrez Budget/Patrimoine › Projets de la vie avec ce user.\n`);
  if (!r.ok) process.exitCode = 1;
} finally {
  await socle.close();
}
