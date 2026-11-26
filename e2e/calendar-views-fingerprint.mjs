// Empreinte du calendrier dans chacune de ses vues (mois, semaine, année), dans Astra et hors Astra, à 1440 et 375 px.
// node e2e/calendar-views-fingerprint.mjs save|compare <fichier.json> — complète e2e/style-fingerprint.mjs (vue par défaut seulement).
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
const [mode, file] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const out = {};
for (const width of [1440, 375]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const users = await (await ctx.request.get('http://localhost:4300/api/users')).json();
  const uid = (users.find(u => u.entryCount > 0) ?? users[0]).id;
  await ctx.addInitScript(id => localStorage.setItem('rjs.activeUserId', id), uid);
  const page = await ctx.newPage();
  for (const path of ['/bpm-astra/calendrier', '/calendrier']) {
    for (const view of ['Mois', 'Semaine', 'Année', 'Agenda', 'Jour']) {
      await page.goto('http://localhost:4300' + path, { waitUntil: 'networkidle' });
      const choice = page.locator('.cal-view-options label, .calendar-view-switch button, [role=radiogroup] label').filter({ hasText: new RegExp('^\\s*' + view) }).first();
      if (!(await choice.count())) continue;
      await choice.click({ force: true }).catch(() => {});
      await page.waitForTimeout(700);
      out[`${width}:${path}:${view}`] = await page.evaluate(() => [...document.querySelectorAll('.app-shell *')].filter(e => !e.closest('svg')).map(e => {
        const cs = getComputedStyle(e);
        return e.tagName + '.' + (typeof e.className === 'string' ? e.className.split(' ').slice(0, 2).join('.') : '') + '|' +
          ['display', 'grid-template-columns', 'grid-row', 'width', 'height', 'padding-top', 'padding-left', 'min-width', 'overflow-x', 'flex-grow', 'animation-name'].map(p => cs.getPropertyValue(p)).join(';');
      }));
    }
  }
  await ctx.close();
}
await browser.close();
if (mode === 'save') { writeFileSync(file, JSON.stringify(out)); console.log('vues :', Object.keys(out).join(', ')); }
else {
  const before = JSON.parse(readFileSync(file, 'utf8')); let n = 0;
  for (const [k, v] of Object.entries(before)) { const w = out[k] ?? []; const d = v.length !== w.length ? [`${v.length} → ${w.length} éléments`] : v.flatMap((x, i) => x === w[i] ? [] : [x.split('|')[0] + ' : ' + x.split('|')[1] + ' → ' + w[i].split('|')[1]]); if (d.length) { n++; console.log(k, d.length, '\n  ' + d.slice(0, Number(process.env.N ?? 4)).join('\n  ')); } }
  console.log(n ? `✗ ${n} vue(s) différente(s)` : '✓ identique');
}
