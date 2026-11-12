import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)('/usr/lib/chatgpt/resources/cua_node/lib/node_modules/playwright/index.js');
const base = process.env.BPM_BASE_URL ?? 'http://localhost:4300';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/opt/google/chrome/chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const endpoint = base + '/api/navigation/settings';
const original = await (await context.request.get(endpoint)).json();
let wrote = false;
const open = async path => { await page.goto(base + path, { waitUntil: 'networkidle' }); await page.locator('main h1').first().waitFor(); };
const css = async (selector, property) => page.locator(selector).first().evaluate((el, property) => getComputedStyle(el).getPropertyValue(property), property);
try {
  await open('/');
  assert.equal(await page.locator('.portal-band[data-band="technical"]').getByRole('link', { name: 'Navigation system', exact: true }).count(), 1);
  await page.locator('.portal-band[data-band="technical"]').getByRole('link', { name: 'Navigation system', exact: true }).click();
  await page.getByRole('link', { name: /Présentation et libellés/ }).first().click();
  await page.waitForURL('**/navigation');
  await page.getByRole('heading', { name: 'Navigation system', exact: true }).waitFor();
  // Three independent settings: global section text, BPM module page text, detail style on one page.
  await page.getByLabel('Taille du texte (px)', { exact: true }).nth(0).fill('19');
  await page.getByRole('button', { name: 'Enregistrer les réglages', exact: true }).click(); wrote = true;
  await page.getByRole('status').filter({ hasText: 'Réglages enregistrés et appliqués' }).waitFor();
  await page.getByLabel('Portée', { exact: true }).selectOption('module');
  await page.getByLabel('Module', { exact: true }).selectOption('bpm');
  await page.getByLabel('Taille du texte (px)', { exact: true }).nth(1).fill('21');
  await page.getByLabel('Libellé : Tableau de bord (/tableau-de-bord)', { exact: true }).fill('Mon budget quotidien');
  await page.getByRole('button', { name: 'Enregistrer les réglages', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Réglages enregistrés et appliqués' }).waitFor();
  await page.getByLabel('Portée', { exact: true }).selectOption('page');
  await page.getByLabel('Page', { exact: true }).selectOption('/vision');
  await page.getByLabel('Taille du texte (px)', { exact: true }).nth(1).fill('24');
  await page.getByRole('button', { name: 'Enregistrer les réglages', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Réglages enregistrés et appliqués' }).waitFor();
  const users = await (await context.request.get(base + '/api/users')).json();
  assert(users.length, 'Un profil existant est nécessaire pour vérifier BPM');
  await context.addInitScript(id => localStorage.setItem('rjs.activeUserId', id), process.env.BPM_USER_ID ?? users[0].id);
  await open('/tableau-de-bord');
  assert.equal(await page.locator('.section-page-link[href="/tableau-de-bord"] span').last().innerText(), 'Mon budget quotidien');
  assert.equal(await css('.section-page-link[href="/tableau-de-bord"]', 'font-size'), '21px');
  assert.equal(await page.locator('.topbar-current').innerText(), 'Mon budget quotidien');
  assert.equal(await css('.section-switch-entry', 'font-size'), '19px');
  const headingSize = await css('main h1', 'font-size');
  assert.notEqual(headingSize, '21px', 'Le contenu ne doit pas adopter la taille de navigation');
  await page.locator('.section-page-link[href="/vision"]').click();
  await page.waitForURL('**/vision');
  await page.locator('bpm-navigation .nav-back').first().click();
  await page.waitForURL('**/tableau-de-bord');
  await page.locator('bpm-navigation .nav-forward').first().click();
  await page.waitForURL('**/vision');
  assert.equal(await css('.section-page-link', 'font-size'), '24px');
  await open('/socle/budget');
  assert.notEqual(await css('.section-page-link', 'font-size'), '21px');
  assert.equal(await css('.section-switch-entry', 'font-size'), '19px');
  for (const module of ['bpm', 'budget', 'patrimoine', 'noyau', 'administration', 'navigation']) {
    await open('/zones/' + module);
    assert.equal(await page.locator('.navigation-module-switcher a').count(), 6);
    console.log('✓ Accès module ' + module);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await open('/navigation');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Débordement sur mobile');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('.navigation-module-switcher summary').click();
  await page.locator('.navigation-module-switcher a[href="/zones/budget"]').click();
  await page.waitForURL('**/zones/budget');
  assert.equal(await page.locator('#workspace-navigation').evaluate(el => el.matches(':popover-open')), false);
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open('/navigation');
  await mkdir('/tmp/navigation-qa', { recursive: true });
  await page.screenshot({ path: '/tmp/navigation-qa/settings.png', fullPage: false });
  console.log('✓ Réglages UI, persistance, héritage site/module/page, libellés, isolation CSS et menu mobile');
} finally {
  if (wrote) {
    const latest = await (await context.request.get(endpoint)).json();
    const restored = await context.request.put(endpoint, { data: { expectedRevision: latest.revision, value: original.value } });
    assert(restored.ok(), 'Rétablissement des réglages initiaux');
  }
  await browser.close();
}
