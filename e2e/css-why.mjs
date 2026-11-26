// Pourquoi cette valeur ? Règles qui posent une propriété sur un élément, de la gagnante à la plus faible, avec leur spécificité.
// node e2e/css-why.mjs <chemin> <sélecteur> <propriété> [touches]   (CLICK=Semaine pour choisir une vue du calendrier, WIDTH=375)
import { chromium } from 'playwright-core';
const [path, selector, prop, keys] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const users = await (await ctx.request.get('http://localhost:4300/api/users')).json();
const uid = (users.find(u => u.entryCount > 0) ?? users[0]).id;
await ctx.addInitScript(id => localStorage.setItem('rjs.activeUserId', id), uid);
const page = await ctx.newPage();
await page.goto('http://localhost:4300' + path, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
if (keys) { for (const k of keys.split(',')) { await page.keyboard.press(k); await page.waitForTimeout(200); } await page.waitForTimeout(500); }
if (process.env.CLICK) { await page.locator('.cal-view-options label, .calendar-view-switch button').filter({ hasText: new RegExp('^\\s*' + process.env.CLICK) }).first().click({ force: true }); await page.waitForTimeout(700); }
if (process.env.WIDTH) await page.setViewportSize({ width: Number(process.env.WIDTH), height: 900 });
const cdp = await ctx.newCDPSession(page);
await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
if (!nodeId) { console.log('élément introuvable'); process.exit(1); }
const m = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
const out = [];
for (const r of m.matchedCSSRules ?? []) {
  for (const p of r.rule.style.cssProperties) if ((p.name === prop || prop.startsWith(p.name + '-') || (prop === 'margin-bottom' && p.name === 'margin-block') || (prop === 'margin-bottom' && p.name === 'margin-block-end') || (prop === 'margin-top' && p.name === 'margin-block-start') || (p.name === 'margin-block' && prop === 'margin-top') || (p.name === 'padding-block' && prop === 'padding-top')) && p.text) {
    const sel = r.rule.selectorList.selectors.map((s, i) => (r.matchingSelectors.includes(i) ? '▶' : ' ') + s.text + ' [' + (s.specificity ? `${s.specificity.a},${s.specificity.b},${s.specificity.c}` : '?') + ']').filter(s => s.startsWith('▶')).join(' | ');
    out.push(`${p.important ? "!IMP " : "     "}${(p.name + ": " + p.value).padEnd(40)} ${sel.slice(0, 230)}`);
  }
}
console.log(out.reverse().join('\n') || 'aucune règle');
await browser.close();
