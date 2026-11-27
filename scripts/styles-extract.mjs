// Feuille d'un composant tirée des feuilles de son hôte : seules les règles qui peuvent s'appliquer à son gabarit.
//
// Un composant sorti d'une page (fenêtre d'une tâche, encadré de personnalisation du calendrier) gardait les feuilles
// entières de la page pour ne pas changer le rendu. Avec l'encapsulation d'Angular, chaque partie d'un sélecteur ne
// vise que les éléments du gabarit du composant : une règle qui nomme une classe absente de ce gabarit ne s'y applique
// jamais. Ce script compile les feuilles de l'hôte et ne garde que les règles dont toutes les classes exigées figurent
// dans le gabarit (les classes sous :not, :is, :where, :has et :host() sont tenues pour facultatives ; ::ng-deep, :host
// seul et @keyframes sont toujours gardés). Le rendu ne change donc pas, et les feuilles de l'hôte restent la seule source.
//
//   node scripts/styles-extract.mjs          réécrit les feuilles tirées (EXTRACTS ci-dessous)
//   node scripts/styles-extract.mjs --check  sortie 1 si une feuille tirée n'est plus à jour (CI)
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(join(repo, 'web/package.json'));
const sass = req('sass');
const postcss = req('postcss');
const web = (p) => join(repo, 'web/src/app', p);

export const EXTRACTS = [
  {
    template: 'bpm/projects/project-task-panel.html',
    out: 'bpm/projects/project-task-panel.host.scss',
    sheets: ['bpm/projects/projects.page.scss', 'bpm/projects/project.page.scss'],
  },
  {
    template: 'calendar/calendar-personalization.html',
    out: 'calendar/calendar-personalization.host.scss',
    sheets: ['calendar/calendar-skin.scss', 'calendar/calendar-skin-views.scss', 'calendar/calendar-skin-compact.scss', 'calendar/calendar-skin-design.scss', 'calendar/calendar-skin-effects.scss'],
  },
];

/** Tous les mots du gabarit : classes statiques, [class.x], chaînes de classes. Large par prudence. */
const words = (html) => new Set(html.match(/[A-Za-z_][\w-]*/g));

/** Retire le contenu des pseudo-classes fonctionnelles (classes facultatives pour la correspondance). */
function stripFunctional(selector) {
  let out = '';
  for (let i = 0; i < selector.length; i++) {
    const m = /^:(not|is|where|has|nth-child|nth-last-child)\(/.exec(selector.slice(i));
    if (!m) { out += selector[i]; continue; }
    let depth = 0, j = i + m[0].length - 1;
    for (; j < selector.length; j++) { if (selector[j] === '(') depth++; else if (selector[j] === ')' && --depth === 0) break; }
    out += ':' + m[1] + '()';
    i = j;
  }
  return out;
}

const canMatch = (selector, known) => {
  if (/::ng-deep/.test(selector)) return true;
  // :host vise l'hôte du composant (sans classe ni boîte ici) : seules comptent les classes qui suivent.
  const rest = stripFunctional(selector.replace(/:host(-context)?(\([^)]*\))?/g, ''));
  if (!rest.trim()) return true;
  const required = rest.match(/\.(-?[_a-zA-Z][\w-]*)/g) ?? [];
  return required.every((c) => known.has(c.slice(1)));
};

function prune(container, known) {
  container.each((node) => {
    if (node.type === 'rule') {
      if (node.parent?.type === 'atrule' && /keyframes$/.test(node.parent.name)) return;
      const kept = node.selectors.filter((s) => canMatch(s, known));
      if (!kept.length) node.remove(); else node.selectors = kept;
    } else if (node.type === 'atrule' && node.nodes && !/keyframes$|font-face/.test(node.name)) {
      prune(node, known);
      if (!node.nodes.length) node.remove();
    }
  });
}

export function extract({ template, out, sheets }) {
  const known = words(readFileSync(web(template), 'utf8'));
  const parts = sheets.map((sheet) => {
    const root = postcss.parse(sass.compile(web(sheet), { style: 'expanded' }).css);
    prune(root, known);
    return `/* ---- ${sheet.split('/').pop()} ---- */\n${root.toString().trim()}\n`;
  });
  return `// Généré par scripts/styles-extract.mjs à partir des feuilles de l'hôte : ne pas modifier à la main.\n` +
    `// Règles de ${sheets.map((s) => s.split('/').pop()).join(', ')} qui peuvent s'appliquer à ${template.split('/').pop()}.\n` +
    parts.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const e of EXTRACTS) {
    const text = extract(e);
    const path = web(e.out);
    let current = '';
    try { current = readFileSync(path, 'utf8'); } catch { /* absente */ }
    if (current === text) continue;
    if (check) { console.error(`✗ ${relative(repo, path)} n'est plus à jour : node scripts/styles-extract.mjs`); stale++; }
    else { writeFileSync(path, text); console.log(`✓ ${relative(repo, path)} (${Buffer.byteLength(text)} octets)`); }
  }
  if (check) { if (stale) process.exit(1); console.log('✓ Feuilles tirées des hôtes à jour.'); }
}
