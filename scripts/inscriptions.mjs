// Lecture, depuis Node, des applications autonomes inscrites dans BPM-Astra (web/src/app/sections/inscriptions.ts).
// Chaque inscription (`sections/<clé>/application/inscription.ts`, `hybrides/<nom>/inscription.ts`) ne contient que des
// données et des imports de types : Node la lit directement (types effacés), sans construire le site.
// Utilisé par `npm run app`, `npm run test:app`, `npm run e2e:app` et les tests d'interface d'Astra.
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const root = resolve(import.meta.dirname, '..');
const app = join(root, 'web/src/app');

/** Fichiers d'inscription présents dans le dépôt, relatifs à web/src/app. */
export function inscriptionFiles() {
  const list = (dir) => (existsSync(join(app, dir)) ? readdirSync(join(app, dir), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []);
  return [
    ...list('sections').map((k) => `sections/${k}/application/inscription.ts`),
    ...list('hybrides').map((n) => `hybrides/${n}/inscription.ts`),
  ].filter((rel) => existsSync(join(app, rel)));
}

// Le site n'a pas de "type": "module" : Node relit le fichier en module ES et le signale une fois. Ce n'est pas une erreur.
const quiet = (warning) => warning.code === 'MODULE_TYPELESS_PACKAGE_JSON';
const emit = process.emitWarning;
process.emitWarning = (warning, ...rest) => (quiet(typeof warning === 'object' ? warning : { code: rest[0]?.code ?? rest[1] }) ? undefined : emit.call(process, warning, ...rest));

/** Les inscriptions, avec leur dossier : [{ cle, section, pages, actions, essais, dossier }]. */
export async function inscriptions() {
  const found = [];
  for (const rel of inscriptionFiles()) {
    const { INSCRIPTION } = await import(pathToFileURL(join(app, rel)).href);
    found.push({ ...INSCRIPTION, dossier: 'web/src/app/' + rel.replace(/\/inscription\.ts$/, '') });
  }
  return found;
}

/** L'inscription d'une application par sa clé, ou un arrêt lisible qui liste les applications connues. */
export async function inscriptionOf(cle) {
  const all = await inscriptions();
  const found = all.find((a) => a.cle === cle);
  if (!found) {
    console.error(`✖ Application « ${cle ?? ''} » inconnue. Applications inscrites : ${all.map((a) => a.cle).join(', ') || 'aucune'}.\n  Exemple : npm run app -- projets`);
    process.exit(1);
  }
  return found;
}
