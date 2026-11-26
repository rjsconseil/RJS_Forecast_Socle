// Contrôle statique du code de l'API (JavaScript sans compilation) : aucun nom inconnu, aucune importation ni variable
// locale inutilisée. S'appuie sur le vérificateur TypeScript du site (web/node_modules), en mode JavaScript, sans
// exiger de types : seules ces familles d'erreurs sont retenues.
//
//   npm run api:check
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : name.endsWith('.mjs') ? [path] : [];
});
const RULES = {
  TS2304: 'nom inconnu', TS2552: 'nom inconnu', TS2448: 'variable utilisée avant sa déclaration',
  TS6133: 'déclaré mais jamais lu', TS6192: 'importation inutilisée', TS6198: 'éléments déstructurés inutilisés',
};
const NODE_GLOBALS = /Cannot find name '(process|Buffer)'/;
let output = '';
try {
  execFileSync(join(root, 'web/node_modules/.bin/tsc'), ['--allowJs', '--checkJs', '--noEmit', '--noUnusedLocals', '--target', 'es2022',
    '--module', 'nodenext', '--moduleResolution', 'nodenext', '--skipLibCheck', ...files(join(root, 'api/src'))], { cwd: root, encoding: 'utf8' });
} catch (err) {
  output = String(err.stdout ?? '');
}
const found = output.split('\n').filter((line) => Object.keys(RULES).some((code) => line.includes(`error ${code}:`)) && !NODE_GLOBALS.test(line));
const count = files(join(root, 'api/src')).length;
if (found.length) {
  console.error(`✗ ${found.length} écart(s) dans ${count} fichiers de l'API :\n- ${found.join('\n- ')}`);
  process.exit(1);
}
console.log(`✓ API : ${count} fichiers, aucun nom inconnu, aucune importation ni variable inutilisée.`);
