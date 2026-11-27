// Réglages de la navigation (page /navigation) sur un site en marche : l'arborescence de BPM-Astra, la modification
// d'un libellé et d'un style dans le brouillon, l'aperçu, l'annulation, l'enregistrement, puis l'effet dans Astra.
// Les réglages d'origine sont toujours rétablis à la fin, même en cas d'échec.
//
//   npm run e2e:navigation                         (site sur http://localhost:4300)
//   BPM_BASE_URL=… BPM_USER_ID=… CHROME_PATH=… npm run e2e:navigation
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.BPM_BASE_URL ?? 'http://localhost:4300';
const chrome = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/opt/pw-browsers/chromium', '/usr/bin/chromium'].find(existsSync)
  ?? chromium.executablePath();
const browser = await chromium.launch({ headless: true, executablePath: chrome });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
if (process.env.BPM_SESSION_TOKEN) await context.addCookies([{ name: 'rjs_session', value: process.env.BPM_SESSION_TOKEN, url: base }]);
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', e => errors.push(`${page.url()} : ${e.message}`));
// Toute violation de la CSP (script ou feuille refusés), dans la page ou dans le cadre de l'aperçu, est une erreur.
page.on('console', m => { if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) errors.push(`CSP : ${m.text()}`); });
const endpoint = base + '/api/navigation/settings';
const original = await (await context.request.get(endpoint)).json();
let wrote = false;
const open = async (path) => { await page.goto(base + path, { waitUntil: 'networkidle' }); };
const check = (name) => console.log(`✓ ${name}`);
const LABEL = 'Mes mouvements (essai)';

try {
  const users = await (await context.request.get(base + '/api/users')).json();
  const userId = process.env.BPM_USER_ID ?? (users.find(u => u.entryCount > 0) ?? users[0])?.id;
  assert(userId, 'Aucun profil sur ce site.');
  // L'aperçu de la navigation tourne dans un cadre isolé, sans stockage : le profil n'y est pas posé.
  await context.addInitScript(id => { try { localStorage.setItem('rjs.activeUserId', id); } catch { /* cadre isolé */ } }, userId);

  // 1. L'arborescence montre les cinq parties d'Astra et leurs pages, dans l'ordre du menu.
  await open('/navigation');
  await page.getByRole('heading', { name: 'Composez votre navigation.' }).waitFor();
  const tree = await page.evaluate(() => [...document.querySelectorAll('main button')].map(b => b.textContent.replace(/\s+/g, ' ').trim()).filter(t => /(Section|Page)$/.test(t)));
  for (const part of ['Mon quotidien', 'Mes projets', 'Mon budget', 'Patrimoine', 'Cycles']) assert(tree.includes(part + 'Section'), `Arborescence : « ${part} » absent`);
  assert(tree.indexOf('Mon quotidienSection') < tree.indexOf('MouvementsPage') && tree.indexOf('MouvementsPage') < tree.indexOf('Mes projetsSection'), 'Arborescence : ordre du menu');
  check('Arborescence : les cinq parties d’Astra et leurs pages, dans l’ordre du menu');

  // 2. Un libellé modifié dans le brouillon, puis annulé.
  const node = (name) => page.locator('main button', { hasText: new RegExp(`^\\s*${name}\\s*Page\\s*$`) }).first();
  await node('Mouvements').click();
  const label = page.getByLabel('Libellé du lien');
  await label.fill(LABEL);
  await node(LABEL.replace(/[()]/g, '\\$&')).waitFor();
  await page.getByRole('button', { name: '↶ Annuler' }).click();
  await node('Mouvements').waitFor();
  assert.equal(await label.inputValue(), '', 'Annuler : le libellé du brouillon reste');
  check('Brouillon : libellé modifié puis annulé');

  // 3. Enregistré : la configuration est relue par l'API, et le menu d'Astra prend le nouveau libellé.
  await label.fill(LABEL);
  await page.getByRole('button', { name: 'Enregistrer la configuration' }).click(); wrote = true;
  await page.getByRole('status').filter({ hasText: /enregistr/i }).first().waitFor();
  const saved = await (await context.request.get(endpoint)).json();
  assert(JSON.stringify(saved.value).includes(LABEL), 'Le libellé n’est pas enregistré');
  await open('/bpm-astra');
  const menu = await page.locator('.astra-nav').innerText();
  assert(menu.includes(LABEL), 'Le menu d’Astra ne reprend pas le libellé enregistré');
  check('Enregistrement : relu par l’API et repris par le menu d’Astra');

  // 4. Simulation : l'aperçu tourne dans son cadre isolé, sous la CSP du site (script autorisé par son empreinte).
  await open('/navigation');
  await page.getByRole('button', { name: 'Simuler' }).click();
  const frame = await (await page.waitForSelector('iframe[title="Aperçu interactif du module BPM"]')).contentFrame();
  await frame.waitForSelector('.simulation-hero h1');
  const title = () => frame.evaluate(() => document.querySelector('.current-title')?.textContent ?? '');
  const before = await title();
  const links = frame.locator('.section-pages [data-key]');
  assert((await links.count()) > 1, 'Simulation : aucune page dans le menu de l’aperçu');
  await links.last().click();
  await frame.waitForFunction((b) => document.querySelector('.current-title')?.textContent !== b, before);
  check('Simulation : l’aperçu s’affiche et navigue, sans violation de la CSP');

  // 5. Écran étroit : la page de réglages ne déborde pas.
  await page.setViewportSize({ width: 390, height: 844 });
  await open('/navigation');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Débordement de côté à 390 px');
  check('Écran étroit : aucun débordement à 390 px');

  assert.deepEqual(errors, [], `Erreurs dans la page :\n  ${errors.join('\n  ')}`);
  console.log('\n✓ Réglages de la navigation conformes ; réglages d’origine rétablis.');
} catch (error) {
  console.error(`\n✖ ${error.message}\n  page : ${page.url()}`);
  process.exitCode = 1;
} finally {
  if (wrote) {
    const latest = await (await context.request.get(endpoint)).json();
    const restored = await context.request.put(endpoint, { data: { expectedRevision: latest.revision, value: original.value } });
    if (!restored.ok()) { console.error('✖ Réglages d’origine NON rétablis : ' + await restored.text()); process.exitCode = 1; }
  }
  await browser.close();
}
