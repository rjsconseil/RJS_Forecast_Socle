// Contrôle d'ordre de la cascade quand des règles quittent la feuille globale pour être chargées avec un écran
// (composant sans encapsulation) : mêmes sélecteurs, donc même spécificité, mais une autre place dans la cascade.
// Seules les égalités de spécificité peuvent changer de gagnant. Ce script les cherche dans les pages ouvertes :
// pour chaque règle déplacée M et chaque règle X dont l'ordre relatif à M s'est inversé, il signale X si elle a la
// même spécificité, la même importance, une propriété commune et un élément commun. Les états (survol, focus, case
// cochée, élément désactivé…) sont tous tenus pour vrais : une égalité qui ne jouerait qu'au survol est signalée.
//
//   BPM_BASE_URL=… node e2e/styles-order-check.mjs <feuille déplacée.scss[,suite.scss…]> <1re feuille globale qui la suivait.scss> [adresses…]
// Plusieurs feuilles déplacées ensemble (séparées par des virgules) gardent leur ordre entre elles : seules
// leurs inversions avec le reste sont cherchées.
// Sortie 0 sans égalité inversée, 1 sinon. Lecture seule.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(join(repo, 'web/package.json'));
const sass = req('sass');
const postcss = req('postcss');
const { chromium } = createRequire(join(repo, 'package.json'))('playwright-core');
const [movedSheet, nextSheet, ...paths] = process.argv.slice(2);
if (!movedSheet || !nextSheet) { console.error('Usage : node e2e/styles-order-check.mjs <déplacée.scss> <suivante.scss> [adresses…]'); process.exit(2); }
const base = process.env.BPM_BASE_URL ?? 'http://localhost:4300';
const chrome = process.env.CHROME_PATH ?? ['/opt/pw-browsers/chromium'].find(existsSync) ?? chromium.executablePath();
const loadPaths = [join(repo, 'web/src/styles'), join(repo, 'web/src')];
const compile = (f) => postcss.parse(sass.compile(resolve(f), { loadPaths, style: 'expanded' }).css);

const moved = movedSheet.split(',').map((f) => { const set = new Set(); compile(f).walkRules((r) => { if (!/keyframes/.test(r.parent?.name ?? '')) set.add(r.selector.replace(/\s+/g, ' ')); }); return [...set]; });
let nextFirst = null;
compile(nextSheet).walkRules((r) => { nextFirst ??= r.selector.replace(/\s+/g, ' '); });

const users = await (await fetch(base + '/api/users')).json();
const userId = process.env.BPM_USER_ID ?? (users.find((u) => u.entryCount > 0) ?? users[0])?.id;
const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
const found = new Map();
const tried = new Set();
const matched = new Set();
for (const width of [1440, 375]) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript((id) => localStorage.setItem('rjs.activeUserId', id), userId);
  const page = await context.newPage();
  for (const entry of paths) {
    // « adresse|Libellé » : ouvre l'adresse puis clique le premier choix qui porte ce libellé (vue, onglet, volet).
    const [path, ...clicks] = entry.split('|');
    await page.goto(base + path, { waitUntil: 'networkidle' });
    // « hover:sélecteur » et « click:sélecteur » : survol ou clic du premier élément (fenêtres de survol, éditeurs).
    for (const step of clicks) {
      const [, verb, target] = /^(hover|click):(.+)$/.exec(step) ?? [];
      const loc = verb ? page.locator(target).first() : page.locator('button, label, summary, a, [role=tab]').filter({ hasText: new RegExp('^\\s*' + step) }).first();
      await (verb === 'hover' ? loc.hover({ force: true, timeout: 3000 }) : loc.click({ force: true, timeout: 3000 })).catch(() => {});
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(600);
    const out = await page.evaluate(({ moved, nextFirst }) => {
      const movedSets = moved.map((m) => new Set(m));
      const norm = (s) => s.replace(/\s+/g, ' ').trim();
      // Spécificité [id, classe, type] ; :is/:not/:has prennent leur argument le plus fort, :where compte zéro.
      const spec = (sel) => {
        let a = 0, b = 0, c = 0, i = 0;
        const args = (start) => { let d = 0, j = start; for (; j < sel.length; j++) { if (sel[j] === '(') d++; else if (sel[j] === ')' && --d === 0) break; } return [sel.slice(start + 1, j), j]; };
        const split = (s) => { const parts = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { parts.push(cur); cur = ''; } else cur += ch; } parts.push(cur); return parts; };
        while (i < sel.length) {
          const ch = sel[i];
          if (ch === '#') { a++; i++; while (i < sel.length && /[\w-]/.test(sel[i])) i++; }
          else if (ch === '.') { b++; i++; while (i < sel.length && /[\w-]/.test(sel[i])) i++; }
          else if (ch === '[') { b++; while (i < sel.length && sel[i] !== ']') i++; i++; }
          else if (ch === ':') {
            if (sel[i + 1] === ':') { c++; i += 2; while (i < sel.length && /[\w-]/.test(sel[i])) i++; continue; }
            const m = /^:([\w-]+)/.exec(sel.slice(i)); i += m[0].length;
            if (sel[i] === '(') {
              const [inner, end] = args(i); i = end + 1;
              if (['is', 'not', 'has', 'matches'].includes(m[1])) { const best = split(inner).map(spec).sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]).pop(); a += best[0]; b += best[1]; c += best[2]; }
              else if (m[1] !== 'where') b++;
            } else if (['before', 'after', 'first-line', 'first-letter'].includes(m[1])) c++;
            else b++;
          } else if (/[a-zA-Z*]/.test(ch)) { if (ch !== '*') c++; while (i < sel.length && /[\w-]/.test(sel[i])) i++; if (ch === '*') i++; }
          else i++;
        }
        return [a, b, c];
      };
      const STATES = /:(hover|focus|focus-visible|focus-within|active|visited|checked|disabled|enabled|target|placeholder-shown|invalid|valid|open|popover-open|modal|user-invalid|indeterminate)(?![\w-])/g;
      const pseudoEl = (s) => (s.match(/::?(before|after|placeholder|marker|backdrop|selection|-webkit-[\w-]+)\b/) ?? [''])[0].replace(/^:+/, '');
      const probe = (s) => s.replace(/::?(before|after|placeholder|marker|backdrop|selection|-webkit-[\w-]+)\b/g, '').replace(STATES, '').trim() || '*';
      const rules = [];
      // Toutes les règles, dans l'ordre ; celles d'un @media ou @supports qui ne s'applique pas sont inactives.
      const visit = (list, sheetIndex, active) => {
        for (const r of list) {
          if (r instanceof CSSStyleRule) rules.push({ r, sheetIndex, active });
          else if (r instanceof CSSMediaRule) visit(r.cssRules, sheetIndex, active && matchMedia(r.conditionText).matches);
          else if (r instanceof CSSSupportsRule) visit(r.cssRules, sheetIndex, active && CSS.supports(r.conditionText));
          else if (r.cssRules && !(r instanceof CSSKeyframesRule)) visit(r.cssRules, sheetIndex, active);
        }
      };
      const sheets = [...document.styleSheets];
      sheets.forEach((sh, k) => { try { visit(sh.cssRules, k, true); } catch { /* feuille d'une autre origine */ } });
      const globalIdx = sheets.findIndex((sh) => sh.ownerNode?.tagName === 'LINK' && /styles-/.test(sh.href ?? ''));
      // La feuille déplacée : celle (hors feuille globale) dont les règles sont celles de la feuille compilée.
      const movedIdxs = new Set();
      for (const movedSet of movedSets) {
        const counts = new Map();
        for (const x of rules) if (x.sheetIndex !== globalIdx && movedSet.has(norm(x.r.selectorText))) counts.set(x.sheetIndex, (counts.get(x.sheetIndex) ?? 0) + 1);
        const idx = [...counts].sort((p, q) => q[1] - p[1])[0]?.[0];
        if (idx === undefined) return { missing: true };
        movedIdxs.add(idx);
      }
      const movedIdx = Math.min(...movedIdxs);
      const globalRules = rules.filter((x) => x.sheetIndex === globalIdx);
      const firstAfter = globalRules.findIndex((x) => norm(x.r.selectorText) === nextFirst);
      const cutoff = firstAfter < 0 ? null : globalRules[firstAfter].r;
      const flipped = new Set();
      // Sans repère, toutes les règles globales sont tenues pour inversées (comparaison large, par prudence).
      let after = !cutoff;
      for (const x of globalRules) { if (x.r === cutoff) after = true; if (after) flipped.add(x.r); }
      for (const x of rules) if (x.sheetIndex !== globalIdx && x.sheetIndex < movedIdx) flipped.add(x.r);
      const props = (r) => { const m = new Map(); for (let i = 0; i < r.style.length; i++) m.set(r.style[i], r.style.getPropertyPriority(r.style[i])); return m; };
      const conflicts = [], tried = [], matched = [];
      const candidates = rules.filter((x) => x.active && flipped.has(x.r)).flatMap((x) => x.r.selectorText.split(/,(?![^(]*\))/).map((s) => ({ s: s.trim(), r: x.r })));
      const candSpec = candidates.map((c) => ({ ...c, sp: spec(c.s).join(','), pe: pseudoEl(c.s), pr: props(c.r), q: probe(c.s) }));
      for (const m of rules.filter((x) => x.active && movedIdxs.has(x.sheetIndex))) {
        const mp = props(m.r);
        for (const s of m.r.selectorText.split(/,(?![^(]*\))/).map((t) => t.trim())) {
          let els; try { els = [...document.querySelectorAll(probe(s))]; } catch { continue; }
          tried.push(s);
          if (!els.length) continue;
          matched.push(s);
          const sp = spec(s).join(','), pe = pseudoEl(s);
          for (const c of candSpec) {
            if (c.sp !== sp || c.pe !== pe) continue;
            const shared = [...mp].filter(([p, imp]) => c.pr.has(p) && c.pr.get(p) === imp).map(([p]) => p);
            if (!shared.length) continue;
            let hit; try { hit = els.find((e) => e.matches(c.q)); } catch { continue; }
            if (hit) conflicts.push(`${s}  ⇄  ${c.s}  [${shared.slice(0, 4).join(', ')}]`);
          }
        }
      }
      return { conflicts, tried, matched, cutoffFound: !!cutoff };
    }, { moved, nextFirst });
    if (out.missing) { console.log(`  ${width}:${entry} : feuille déplacée absente (page sans l'écran)`); continue; }
    if (!out.cutoffFound) console.log(`  ${width}:${entry} : première règle suivante introuvable, comparaison large`);
    for (const c of out.conflicts) found.set(c, (found.get(c) ?? new Set()).add(`${width}:${entry}`));
    out.tried.forEach((t) => tried.add(t)); out.matched.forEach((t) => matched.add(t));
  }
  await context.close();
}
await browser.close();
const blind = [...tried].filter((t) => !matched.has(t));
console.log(`${paths.length} adresse(s) × 2 largeurs · ${tried.size} sélecteurs déplacés, ${matched.size} vérifiés sur des éléments`);
if (blind.length) { console.log(`  ${blind.length} sans élément dans ces pages (non vérifiables ici)`); if (process.env.SHOW_BLIND) console.log(blind.map((b) => '    ' + b).join('\n')); }
if (!found.size) { console.log('✓ Aucune égalité de spécificité inversée.'); process.exit(0); }
console.log(`✗ ${found.size} égalité(s) inversée(s) :`);
for (const [c, where] of found) console.log(`- ${c}  (${[...where].slice(0, 3).join(' ; ')})`);
process.exit(1);
