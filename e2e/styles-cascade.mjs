// Déclarations de la feuille globale qui ne gagnent la cascade sur aucun élément, dans aucune vue mesurée (Astra,
// fiches, fenêtres de saisie, pages du site, vues du calendrier ; 1440, 1024, 768 et 375 px). La cascade est calculée
// dans la page entre les règles de la feuille globale seulement : une déclaration que seuls les styles d'un composant
// ou un style en ligne écrasent compte comme gagnante, par prudence. Une règle qui ne s'applique à rien (survol,
// états ouverts, écrans non visités) n'est jamais touchée.
//
// 1. cd web && npx ng build --configuration development   (styles.css et sa carte des sources)
// 2. BPM_BASE_URL=… node e2e/styles-cascade.mjs mesure <perdantes.json>
// 3. node e2e/styles-cascade.mjs retire <perdantes.json> <feuille.scss>…   (une ligne SCSS n'est retirée que si
//    toutes les déclarations CSS qu'elle produit perdent partout ; les règles vidées sont retirées)
// 4. Reconstruire en production et comparer : e2e/style-fingerprint.mjs (Astra, et FP_PATHS pour le site) et
//    e2e/calendar-views-fingerprint.mjs. Le rendu doit rester identique.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(join(repo, 'web/package.json'));
const { chromium } = createRequire(join(repo, 'package.json'))('playwright-core');
const postcss = req('postcss');
const scss = req('postcss-scss');
const [mode, out, ...files] = process.argv.slice(2);
if (mode === 'retire') { prune(out, files); process.exit(0); }
if (mode !== 'mesure' || !out) { console.error('Usage : node e2e/styles-cascade.mjs mesure <perdantes.json> | retire <perdantes.json> <feuille.scss>…'); process.exit(2); }
const { SourceMapConsumer } = req('source-map-js');
const base = process.env.BPM_BASE_URL ?? 'http://localhost:4300';
const chrome = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/opt/pw-browsers/chromium'].find(existsSync) ?? chromium.executablePath();
const dist = join(repo, 'web/dist/web/browser/');
const css = fs.readFileSync(dist + 'styles.css', 'utf8');
const map = new SourceMapConsumer(JSON.parse(fs.readFileSync(dist + 'styles.css.map', 'utf8')));
const rules = []; const decls = [];
postcss.parse(css).walkRules((rule) => {
  const chain = []; let p = rule.parent; let skip = false;
  while (p && p.type !== 'root') {
    if (p.type === 'atrule') {
      if (p.name === 'media') chain.push(['media', p.params]);
      else if (p.name === 'supports') chain.push(['supports', p.params]);
      else skip = true;
    } else skip = true;
    p = p.parent;
  }
  if (skip) return;
  const ds = [];
  rule.each((d) => {
    if (d.type !== 'decl') return;
    const o = map.originalPositionFor({ line: d.source.start.line, column: d.source.start.column - 1 });
    const id = decls.length;
    decls.push({ prop: d.prop, value: d.value, important: !!d.important, source: o.source, line: o.line, matched: 0, won: 0 });
    ds.push([id, d.prop, d.value, !!d.important]);
  });
  if (ds.length) rules.push([rule.selector, chain, ds]);
});
console.log(`${rules.length} règles, ${decls.length} déclarations dans la feuille globale`);

const SLUGS = ['', 'mouvements', 'mouvements/echeances', 'calendrier', 'calendrier/agenda', 'projets', 'financement/enveloppes', 'taches', 'budget', 'plafonds',
  'plafonds/postes', 'objectif', 'objectif/echeances', 'patrimoine', 'patrimoine/reglages', 'cloture', 'cloture/reglages', 'bilans'];
const SITE = ['/', '/admin', '/admin/calculs', '/calendrier', '/compte', '/modules', '/navigation', '/object-management', '/projects', '/projects/new',
  '/socle/budget', '/socle/cycle', '/socle/patrimoine', '/tasks', '/tasks/new', '/utilisateurs'];
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const t0 = Date.now(); let views = 0;
for (const width of (process.env.WIDTHS ?? '1440,1024,768,375').split(',').map(Number)) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const users = await (await ctx.request.get(base + '/api/users')).json();
  const uid = (users.find(u => u.entryCount > 0) ?? users[0]).id;
  await ctx.addInitScript(id => localStorage.setItem('rjs.activeUserId', id), uid);
  const life = await (await ctx.request.get(base + '/api/bpm/life-management', { headers: { 'x-user-id': uid } })).json().catch(() => null);
  const project = life?.projects?.projects?.[0]?.coreProjectId;
  const page = await ctx.newPage();
  const list = [...SLUGS.map(s => ({ url: '/bpm-astra' + (s ? '/' + s : '') })),
    ...(project ? ['', '/budget', '/taches'].map(x => ({ url: '/bpm-astra/projets/' + project + x })) : []),
    { url: '/bpm-astra', keys: ['+', 'D'] }, { url: '/bpm-astra/projets', keys: ['+', 'P'] },
    ...SITE.map(url => ({ url })),
    ...['/bpm-astra/calendrier', '/calendrier'].flatMap(url => ['Semaine', 'Année', 'Agenda', 'Jour'].map(view => ({ url, view })))];
  for (const v of list) {
    await page.goto(base + v.url, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(400);
    if (v.keys) { await page.evaluate(() => document.activeElement?.blur?.()); for (const k of v.keys) { await page.keyboard.press(k); await page.waitForTimeout(150); } await page.waitForTimeout(400); }
    if (v.view) {
      const c = page.locator('.cal-view-options label, .calendar-view-switch button, [role=radiogroup] label').filter({ hasText: new RegExp('^\\s*' + v.view) }).first();
      if (!(await c.count())) continue;
      await c.click({ force: true }).catch(() => {}); await page.waitForTimeout(700);
    }
    const r = await page.evaluate(cascade, rules);
    for (const id of r.matched) decls[id].matched++;
    for (const id of r.won) decls[id].won++;
    views++;
    console.log(`${width} ${v.url}${v.view ? ' ' + v.view : ''}${v.keys ? ' (fenêtre)' : ''} : ${r.elements} éléments, ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  await ctx.close();
}
await browser.close();
// Une ligne SCSS peut produire plusieurs déclarations CSS (listes, boucles) : perdante seulement si toutes perdent.
const by = new Map();
for (const d of decls) { if (!d.source) continue; const k = d.source.replace(/^.*?\bsrc\//, 'src/') + ':' + d.line; if (!by.has(k)) by.set(k, []); by.get(k).push(d); }
const dead = [...by].filter(([, ds]) => ds.every(d => d.matched && !d.won)).map(([key, ds]) => ({ key, prop: ds[0].prop }));
fs.writeFileSync(out, JSON.stringify({ views, dead }, null, 1));
console.log(`${views} vues ; ${dead.length} lignes SCSS dont les déclarations perdent partout`);

function prune(list, sheets) {
  const { dead } = JSON.parse(fs.readFileSync(list, 'utf8'));
  for (const file of sheets) {
    const rel = file.replace(/^.*?\bsrc\//, 'src/');
    const lines = new Map(dead.filter(d => d.key.startsWith(rel + ':')).map(d => [Number(d.key.split(':').pop()), d.prop]));
    const src = fs.readFileSync(file, 'utf8');
    // Syntaxe SCSS (commentaires `//`, variables, interpolations) : postcss-scss la lit et la réécrit telle quelle.
    const root = scss.parse(src);
    let removed = 0;
    root.walkDecls(d => { if (lines.get(d.source.start.line) === d.prop) { d.remove(); removed++; } });
    let again = true;
    while (again) { again = false; root.walk(n => { if ((n.type === 'rule' || (n.type === 'atrule' && n.nodes)) && !n.nodes.some(c => c.type !== 'comment')) { n.remove(); again = true; } }); }
    root.walkRules(r => { r.raws.semicolon = true; });
    const text = root.toString(scss.stringify);
    fs.writeFileSync(file, text);
    console.log(`${rel} : ${removed} déclarations retirées, ${src.split('\n').length} → ${text.split('\n').length} lignes`);
  }
}

function cascade(rules) {
  // Spécificité d'un sélecteur complexe : [ids, classes/attributs/pseudo-classes, types/pseudo-éléments].
  const split = (s) => { const out = []; let depth = 0, cur = '', q = null; for (const ch of s) { if (q) { cur += ch; if (ch === q) q = null; continue; } if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; } if (ch === '(' || ch === '[') depth++; if (ch === ')' || ch === ']') depth--; if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const spec = (sel) => {
    let s = [0, 0, 0]; let i = 0;
    while (i < sel.length) {
      const c = sel[i];
      if (c === '#') { s[0]++; i++; while (i < sel.length && /[\w-]/.test(sel[i])) i++; }
      else if (c === '.') { s[1]++; i++; while (i < sel.length && /[\w-]/.test(sel[i])) i++; }
      else if (c === '[') { s[1]++; let d = 0; for (; i < sel.length; i++) { if (sel[i] === '[') d++; if (sel[i] === ']' && !--d) { i++; break; } } }
      else if (c === ':') {
        const el = sel[i + 1] === ':'; i += el ? 2 : 1; let name = ''; while (i < sel.length && /[\w-]/.test(sel[i])) name += sel[i++];
        let arg = null; if (sel[i] === '(') { let d = 0, st = i; for (; i < sel.length; i++) { if (sel[i] === '(') d++; if (sel[i] === ')' && !--d) { i++; break; } } arg = sel.slice(st + 1, i - 1); }
        if (el || ['before', 'after', 'first-line', 'first-letter', 'placeholder', 'marker', 'selection', 'backdrop'].includes(name)) s[2]++;
        else if (name === 'where') {}
        else if (['is', 'not', 'has', 'matches'].includes(name) && arg) s = add(s, split(arg).map(spec).reduce((m, x) => (cmp(x, m) > 0 ? x : m), [0, 0, 0]));
        else if (/^nth-/.test(name) && arg && / of /.test(arg)) { s[1]++; s = add(s, split(arg.split(' of ')[1]).map(spec).reduce((m, x) => (cmp(x, m) > 0 ? x : m), [0, 0, 0])); }
        else s[1]++;
      }
      else if (/[a-zA-Z*]/.test(c)) { let t = ''; while (i < sel.length && /[\w*-]/.test(sel[i])) t += sel[i++]; if (t !== '*') s[2]++; }
      else i++;
    }
    return s;
  };
  const PSEUDO = /::?(before|after|placeholder|marker|selection|backdrop|first-line|first-letter|-webkit-[\w-]+|-moz-[\w-]+)\b(\([^)]*\))?/;
  const longCache = new Map(); const probe = document.createElement('div');
  const longhands = (prop, value) => {
    if (prop.startsWith('--')) return [prop];
    const k = prop + ':' + value; if (longCache.has(k)) return longCache.get(k);
    probe.style.cssText = ''; probe.style.setProperty(prop, value.includes('var(') || value.includes('#{') ? 'inherit' : value);
    let l = [...probe.style]; if (!l.length) l = [prop];
    longCache.set(k, l); return l;
  };
  const ok = (chain) => chain.every(([t, p]) => { try { return t === 'media' ? matchMedia(p).matches : CSS.supports(p); } catch { return false; } });
  const best = new Map(); // élément(+pseudo) → Map(longhand → [important, spec, order, declId])
  const targets = new Map(); let tid = 0;
  const key = (el, pseudo) => { if (!targets.has(el)) targets.set(el, ++tid); return targets.get(el) + (pseudo || ''); };
  const matched = new Set(); const won = new Set();
  rules.forEach(([selector, chain, ds], order) => {
    if (!ok(chain)) return;
    for (const complex of split(selector)) {
      const pm = complex.match(PSEUDO); const pseudo = pm ? pm[0].replace(/^:+/, '::') : '';
      const base = pm ? complex.replace(PSEUDO, '') || '*' : complex;
      let els; try { els = document.querySelectorAll(base.trim().endsWith('>') ? base + '*' : base); } catch { continue; }
      if (!els.length) continue;
      const sp = spec(complex);
      for (const el of els) {
        if (!el.closest('body')) continue;
        const k = key(el, pseudo); if (!best.has(k)) best.set(k, new Map());
        const m = best.get(k);
        for (const [id, prop, value, imp] of ds) {
          matched.add(id);
          for (const l of longhands(prop, value)) {
            const cur = m.get(l); const cand = [imp ? 1 : 0, sp, order, id];
            // Règles parcourues dans l'ordre de la feuille : à importance et spécificité égales, la plus tardive gagne.
            if (!cur || cand[0] > cur[0] || (cand[0] === cur[0] && cmp(cand[1], cur[1]) >= 0)) m.set(l, cand);
          }
        }
      }
    }
  });
  for (const m of best.values()) for (const [, , , id] of m.values()) won.add(id);
  return { matched: [...matched], won: [...won], elements: targets.size };
}
