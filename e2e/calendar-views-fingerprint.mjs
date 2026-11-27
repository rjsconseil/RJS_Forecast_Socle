// Empreinte du calendrier dans chacune de ses vues (mois, semaine, année), dans Astra et hors Astra, à 1440 et 375 px.
// node e2e/calendar-views-fingerprint.mjs save|compare <fichier.json> — complète e2e/style-fingerprint.mjs (vue par défaut seulement).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
const [mode, file] = process.argv.slice(2);
// Mêmes réglages que style-fingerprint.mjs : BPM_BASE_URL et CHROME_PATH (Chrome du poste par défaut).
const base = process.env.BPM_BASE_URL ?? 'http://localhost:4300';
const chrome = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/opt/pw-browsers/chromium'].find(existsSync) ?? chromium.executablePath();
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const out = {};
for (const width of [1440, 375]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const users = await (await ctx.request.get(base + '/api/users')).json();
  const uid = (users.find(u => u.entryCount > 0) ?? users[0]).id;
  await ctx.addInitScript(id => localStorage.setItem('rjs.activeUserId', id), uid);
  const page = await ctx.newPage();
  for (const path of ['/bpm-astra/calendrier', '/calendrier']) {
    for (const view of ['Mois', 'Semaine', 'Année', 'Agenda', 'Jour']) {
      await page.goto(base + path, { waitUntil: 'networkidle' });
      const choice = page.locator('.cal-view-options label, .calendar-view-switch button, [role=radiogroup] label').filter({ hasText: new RegExp('^\\s*' + view) }).first();
      if (!(await choice.count())) continue;
      await choice.click({ force: true }).catch(() => {});
      await page.waitForTimeout(700);
      // FP_IGNORE=rjs-x,bpm-y : éléments hôtes sans boîte (display: contents) ajoutés en découpant un gabarit, ignorés.
      out[`${width}:${path}:${view}`] = await page.evaluate((ignore) => [...document.querySelectorAll('.app-shell *')].filter(e => !e.closest('svg') && !ignore.includes(e.tagName.toLowerCase())).map(e => {
        const cs = getComputedStyle(e);
        return e.tagName + '.' + (typeof e.className === 'string' ? e.className.split(' ').slice(0, 2).join('.') : '') + '|' +
          ['display', 'grid-template-columns', 'grid-row', 'width', 'height', 'padding-top', 'padding-left', 'min-width', 'overflow-x', 'flex-grow', 'animation-name'].map(p => cs.getPropertyValue(p)).join(';');
      }), (process.env.FP_IGNORE ?? '').split(',').filter(Boolean));
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
