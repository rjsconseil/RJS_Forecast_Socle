// Audit des feuilles de style : classes visées qui n'existent plus dans le code, et `!important` par fichier.
// Lecture seule. `npm run styles:audit` ; code de sortie 1 s'il reste des classes mortes (hors bibliothèques).
// Pour retirer des styles sans changer le rendu : node e2e/style-fingerprint.mjs save|compare.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const code = [...walk(path.join(root, 'web/src/app')).filter((f) => /\.(ts|html)$/.test(f) && !f.endsWith('.spec.ts')), path.join(root, 'web/src/index.html'),
  ...walk(path.join(root, 'api/src')).filter((f) => f.endsWith('.mjs'))].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
// Classes posées par les bibliothèques ou construites à l'exécution (préfixe + valeur) : jamais comptées mortes.
const LIBRARY = /^(cdk-|ng-|mat-)/;
const alive = (c) => LIBRARY.test(c) || code.includes(c) || code.includes(c.replace(/-[^-]+$/, '-'));
const all = [...walk(path.join(root, 'web/src/styles')), ...walk(path.join(root, 'web/src/app'))].filter((f) => f.endsWith('.scss'));
// Copies faites par le système de fichiers (« nom 2.scss ») : jamais chargées, signalées à part.
const copies = all.filter((f) => / \d+\.scss$/.test(f));
/**
 * `!important` admis, et seulement ceux-là : les préférences de l'utilisateur qui doivent primer sur tout habillage
 * (mouvement réduit, « sans animation », réglages administrés de la navigation) et les utilitaires d'accessibilité ([hidden], .visually-hidden).
 * Tout autre `!important` est un conflit à régler à la source.
 */
function forcedOf(file, text) {
  if (file.endsWith(path.join('app', 'navigation', 'navigation.scss'))) return [];
  const lines = text.split('\n'); const out = []; let depth = 0, reducedAt = -1;
  lines.forEach((line, i) => {
    // Blocs de préférence de mouvement : réglage système (mouvement réduit) ou choix « sans animation » du calendrier.
    if (/prefers-reduced-motion|\.cal-fx-still/.test(line) && reducedAt < 0) reducedAt = depth;
    const inReduced = reducedAt >= 0;
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (inReduced && depth <= reducedAt) reducedAt = -1;
    if (/!important/.test(line) && !inReduced && !/\[hidden\]|\.visually-hidden/.test(line)) out.push(i + 1);
  });
  return out;
}
const sheets = all.filter((f) => !copies.includes(f));
const rows = sheets.map((f) => {
  const s = fs.readFileSync(f, 'utf8').replace(/meta\.load-css\([^)]*\)/g, '').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\([^)]*\)/g, '');
  const classes = [...new Set([...s.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))];
  return { file: path.relative(root, f), dead: classes.filter((c) => !alive(c)), important: (s.match(/!important/g) ?? []).length, forced: forcedOf(f, s), lines: s.split('\n').length };
});
const dead = rows.filter((r) => r.dead.length);
for (const r of dead) console.log(`${r.file} : ${r.dead.length} classe(s) morte(s) — ${r.dead.slice(0, 8).join(' ')}${r.dead.length > 8 ? ' …' : ''}`);
const total = (k) => rows.reduce((n, r) => n + (Array.isArray(r[k]) ? r[k].length : r[k]), 0);
for (const r of rows.filter((x) => x.forced.length)) console.log(`${r.file} : !important à régler à la source, ligne(s) ${r.forced.join(', ')}`);
const forced = total('forced');
console.log(`\n${rows.length} feuilles · ${total('lines')} lignes · ${total('important')} !important (dont ${forced} hors exceptions admises) · ${total('dead')} classe(s) morte(s)`);
// Déclarations toujours écrasées : même sélecteur (même contexte), même propriété, redéfinie plus loin dans une autre
// règle avec une importance égale ou supérieure, pour chacun des sélecteurs de sa règle (CSS global compilé).
const web = createRequire(path.join(root, 'web/package.json'));
const sass = web('sass'), postcss = web('postcss');
const css = sass.compile(path.join(root, 'web/src/styles.scss'), { loadPaths: [path.join(root, 'web/src/styles')], style: 'expanded', silenceDeprecations: ['import'] }).css;
const decls = [];
postcss.parse(css).walkDecls((d) => {
  const r = d.parent; if (r.type !== 'rule') return;
  let ctx = ''; for (let p = r.parent; p && p.type === 'atrule'; p = p.parent) ctx = '@' + p.name + p.params + '|' + ctx;
  for (const sel of r.selectors) decls.push({ key: ctx + sel.trim() + '::' + d.prop, d, rule: r, imp: !!d.important });
});
const later = new Map(), deadSel = new Set();
for (let i = decls.length - 1; i >= 0; i--) { const x = decls[i], l = later.get(x.key); if (l && l.rule !== x.rule && (l.imp || !x.imp)) deadSel.add(x); if (!l || x.imp) later.set(x.key, x); }
const per = new Map(); for (const x of decls) per.set(x.d, (per.get(x.d) ?? true) && deadSel.has(x));
const overridden = [...per].filter(([, v]) => v).map(([d]) => d);
for (const d of overridden) console.log(`écrasée : ${d.parent.selector.split('\n')[0].slice(0, 80)} { ${d.prop} }`);
console.log(`${overridden.length} déclaration(s) toujours écrasée(s) dans le CSS global`);
if (copies.length) console.log(`${copies.length} copie(s) système non chargée(s) : ${copies.map((f) => path.relative(root, f)).join(', ')}`);
process.exit(dead.length || overridden.length || forced ? 1 : 0);
