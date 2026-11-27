// Seuil de couverture du site : la CI échoue si la couverture des lignes du code du site (src/app, hors tests) baisse
// sous le plancher. Le plancher suit la mesure (on le remonte quand des tests s'ajoutent, jamais on ne le baisse).
//   node scripts/coverage-threshold.mjs web/coverage/web/coverage-summary.json
import { readFileSync } from 'node:fs';

const FLOORS = { lines: 70, statements: 66, functions: 62, branches: 60 };
const file = process.argv[2] ?? 'web/coverage/web/coverage-summary.json';
const total = JSON.parse(readFileSync(file, 'utf8')).total;
const misses = Object.entries(FLOORS).filter(([k, floor]) => total[k].pct < floor);
for (const [k, floor] of Object.entries(FLOORS)) console.log(`${misses.some(([m]) => m === k) ? '✖' : '✓'} ${k} : ${total[k].pct} % (plancher ${floor} %)`);
if (misses.length) {
  console.error('Couverture du site sous le plancher.');
  process.exitCode = 1;
}
