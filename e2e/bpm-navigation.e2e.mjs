import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.BPM_BASE_URL ?? 'http://localhost:4300';
const userId = process.env.BPM_USER_ID;
assert(userId, 'BPM_USER_ID doit désigner un profil de recette existant. Le site et ses données restent en place.');
let playwright;
try { playwright = await import('playwright'); }
catch { playwright = createRequire(import.meta.url)('/usr/lib/chatgpt/resources/cua_node/lib/node_modules/playwright/index.js'); }
const browser = await playwright.chromium.launch({
  headless: true, args: ['--no-sandbox'],
  executablePath: process.env.CHROMIUM_PATH ?? (existsSync('/opt/google/chrome/chrome') ? '/opt/google/chrome/chrome' : undefined),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(id => localStorage.setItem('rjs.activeUserId', id), userId);
const page = await context.newPage();
page.setDefaultTimeout(8000);
const errors = [], checks = [];
page.on('pageerror', error => errors.push({ url: page.url(), message: error.message }));
const open = path => page.goto(base + path, { waitUntil: 'networkidle' });
const check = (name, details = {}) => { checks.push({ name, ...details }); console.log(`✓ ${name}`); };
const api = async path => {
  const response = await page.request.get(base + path, { headers: { 'x-user-id': userId } });
  assert(response.ok(), await response.text()); return response.json();
};

try {
  const users = await api('/api/users');
  const user = users.find(user => user.id === userId);
  assert(user, 'Profil de recette introuvable');
  const parents = ['/creer', '/tableau-de-bord', '/projet-de-vie', '/plafonds', '/vision', '/app/projets', '/app/gestion-projet', '/app/taches', '/app/reglages'];
  const catalog = await readFile(join(root, 'web/src/app/shared/page-workspaces.ts'), 'utf8');
  const children = [...catalog.matchAll(/view\(\s*'([^']+)'\s*,\s*'([^']+)'/g)]
    .filter(match => parents.includes(match[2]) && !match[1].includes(':')).map(match => '/' + match[1]);
  const paths = [...new Set([...parents, ...children, '/depenses', '/argent/entrees', '/argent/reste', '/argent/postes/std%3Aalimentation', '/calendrier-budget', '/calendrier-budget/agenda'])];
  const mobile = ['/tableau-de-bord', '/projet-de-vie', '/projet-de-vie/budget-type', '/projet-de-vie/cloture', '/plafonds/reglages', '/vision', '/vision/projection', '/app/gestion-projet', '/app/taches/rattacher', '/app/reglages/postes', '/calendrier-budget', '/calendrier-budget/agenda'];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const path of width === 1440 ? paths : mobile) {
      await open(path);
      await page.locator('main h1').waitFor();
      assert.equal(await page.locator('.section-pages a[aria-current="page"]').count(), 1, `Menu actif : ${path}`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Débordement horizontal : ${path}, ${width}`);
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(200);
      const heights = await page.evaluate(async () => {
        const values = [];
        for (let i = 0; i < 8; i++) {
          values.push(document.querySelector('[data-page-hero]')?.getBoundingClientRect().height ?? 0);
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
        return values;
      });
      assert(Math.max(...heights) - Math.min(...heights) < 2, `Le bandeau oscille pendant le défilement : ${path}`);
      if (path === '/calendrier-budget/agenda') {
        assert(await page.locator('.calendar-agenda-list').evaluate(element => element.getBoundingClientRect().height > 0), 'Agenda tronqué');
      }
      check(`${width} px · ${path}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open('/projet-de-vie/cloture?period=2026-10');
  await page.getByRole('link', { name: 'Vérifier le compte avant la clôture', exact: true }).click();
  await page.waitForURL(url => url.pathname.endsWith('/rapprochement'));
  const tools = page.locator('bpm-page-banner .bpm-toolbar-toggle');
  if (await tools.getAttribute('aria-expanded') === 'false') await tools.click();
  const balance = await api('/api/bpm/balance?period=2026-10');
  await page.locator('input[name=initial]').fill('2000');
  const current = String((200000 + balance.netCents) / 100);
  await page.locator('input[name=current]').fill(current);
  await page.getByRole('button', { name: 'Calculer l’écart', exact: true }).click();
  await page.waitForURL(url => url.searchParams.get('current') === current);
  await page.locator('main > bpm-navigation .nav-back').click();
  await page.waitForURL(url => url.pathname === '/projet-de-vie/cloture');
  await page.locator('main > bpm-navigation .nav-forward').click();
  await page.waitForURL(url => url.pathname.endsWith('/rapprochement'));
  assert.equal(await page.locator('input[name=current]').inputValue(), current);
  check('Rapprochement : un seul retour vers la clôture et calcul conservé en avant');

  const overview = await api('/api/bpm/projects');
  const project = overview.projects.find(project => project.budget?.role !== 'life' && project.budget?.regime);
  assert(project, 'La recette doit comporter un projet financé');
  const id = project.project.id;
  const projectPath = `/app/gestion-projet/${id}/taches`;
  await open(projectPath);
  await page.locator('bpm-page-banner').getByRole('button', { name: /Créer (?:la première|une) tâche/ }).click();
  await page.waitForURL(url => url.searchParams.get('editTask') === 'new');
  await page.locator('bpm-task-editor input[name=title]').fill('Brouillon de navigation · recette');
  await page.locator('bpm-task-editor input[name=plannedHours]').fill('2.5');
  await page.locator('bpm-task-editor .modal-journey .nav-back').click();
  await page.waitForURL(url => !url.searchParams.has('editTask'));
  await page.locator('main > bpm-navigation .nav-forward').click();
  await page.waitForURL(url => url.searchParams.get('editTask') === 'new');
  assert.equal(await page.locator('bpm-task-editor input[name=title]').inputValue(), 'Brouillon de navigation · recette');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('bpm-task-editor input[name=plannedHours]').inputValue(), '2.5');
  await page.goBack({ waitUntil: 'networkidle' });
  await page.goForward({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('bpm-task-editor input[name=title]').inputValue(), 'Brouillon de navigation · recette');
  await page.locator('bpm-task-editor .modal-close').click();
  await page.waitForURL(url => !url.searchParams.has('editTask'));
  check('Formulaire de tâche : retour, suivant, rechargement et historique natif');

  const detail = await api('/api/bpm/projects/' + id);
  const task = detail.tasks.find(task => task.task.status !== 'done' && !task.budget?.request);
  assert(task, 'Une tâche disponible est nécessaire pour la demande de part');
  await open(projectPath + '?task=' + task.task.id);
  await page.locator('dialog[open]').getByRole('button', { name: 'Demander un montant', exact: true }).click();
  await page.waitForURL(url => url.searchParams.has('demande'));
  await page.locator('form.task-funding-box input[name=amount]').fill('135');
  await page.locator('form.task-funding-box input[name=note]').fill('Brouillon : aucun financement demandé par ce test');
  await page.locator('dialog[open] .modal-journey .nav-back').click();
  await page.waitForURL(url => !url.searchParams.has('demande'));
  await page.locator('dialog[open] .modal-journey .nav-forward').click();
  await page.waitForURL(url => url.searchParams.has('demande'));
  assert.equal(await page.locator('form.task-funding-box input[name=amount]').inputValue(), '135');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('form.task-funding-box input[name=amount]').inputValue(), '135');
  await page.locator('form.task-funding-box').getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.waitForURL(url => !url.searchParams.has('demande'));
  check('Demande de part : montant et motif conservés entre étapes et après rechargement');

  await open('/calendrier-budget/agenda?jour=2026-11-07&vue=mois');
  const plan = page.locator('.calendar-agenda-actions').getByRole('button', { name: 'Replanifier', exact: true }).first();
  await plan.click();
  await page.waitForURL(url => url.searchParams.has('calPlan'));
  await page.locator('.calendar-plan input').fill('2026-11-10');
  await page.waitForURL(url => url.searchParams.get('calDate') === '2026-11-10');
  await page.locator('main > bpm-navigation .nav-back').click();
  await page.waitForURL(url => !url.searchParams.has('calPlan'));
  await page.locator('main > bpm-navigation .nav-forward').click();
  await page.waitForURL(url => url.searchParams.has('calPlan'));
  assert.equal(await page.locator('.calendar-plan input').inputValue(), '2026-11-10');
  await page.getByRole('button', { name: 'Enregistrer la date', exact: true }).click({ trial: true });
  await page.locator('.calendar-plan').getByRole('button', { name: 'Annuler', exact: true }).click();
  check('Agenda : événements accessibles, reprise de la date et commande stable');

  await open('/tableau-de-bord');
  await page.locator('bpm-page-banner').getByRole('link', { name: 'Entrées de la période', exact: true }).click();
  await page.waitForURL(url => url.pathname.endsWith('/entrees'));
  await page.locator('bpm-page-banner').getByRole('link', { name: 'Graphiques et chiffres', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/piloter');
  await page.locator('main > bpm-navigation .nav-back').click();
  await page.waitForURL(url => url.pathname.endsWith('/entrees'));
  await page.locator('main > bpm-navigation .nav-back').click();
  await page.waitForURL(url => url.pathname === '/tableau-de-bord');
  await page.locator('main > bpm-navigation .nav-last').click();
  await page.waitForURL(url => url.pathname === '/piloter');
  await open('/projects');
  await page.goBack({ waitUntil: 'networkidle' });
  assert.equal(new URL(page.url()).pathname, '/piloter');
  assert(await page.locator('main > bpm-navigation .nav-back').isEnabled());
  check('Plusieurs retours, dernière étape et excursion hors de BPM');

  for (const path of ['/tableau-de-bord', '/piloter/agir']) {
    await open(path);
    const toggle = page.locator('bpm-page-banner .bpm-toolbar-toggle');
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    await page.locator('bpm-page-banner').getByRole('button', { name: '＋ Saisir une entrée', exact: true }).click();
    await page.waitForURL(url => url.searchParams.get('entryDirection') === 'income');
    await page.locator('bpm-operation-editor input[name=label]').fill('Entrée en préparation · navigation');
    await page.locator('bpm-operation-editor input[name=amount]').fill('50');
    await page.locator('dialog[open] .modal-journey .nav-back').click();
    await page.waitForURL(url => !url.searchParams.has('entry'));
    await page.locator('main > bpm-navigation .nav-forward').click();
    await page.waitForURL(url => url.searchParams.get('entry') === 'new');
    await page.reload({ waitUntil: 'networkidle' });
    assert(await page.locator('bpm-operation-editor input[name=direction][value=income]').isChecked());
    assert.equal(await page.locator('bpm-operation-editor input[name=amount]').inputValue(), '50');
    await page.locator('dialog[open] .modal-close').click();
    await page.waitForURL(url => !url.searchParams.has('entry'));
    assert(!new URL(page.url()).searchParams.has('entryDirection'));
    check(`Saisie d’entrée : sens et brouillon conservés en arrière, en avant et au rechargement · ${path}`);
  }

  const legacy = [
    ['?panneau=budget-type', '/projet-de-vie/budget-type', null],
    ['#bp-dir-title', '/vision/reperes', '#bp-dir-title'],
    ['?panneau=objectif', '/vision/reperes', '#bp-target-title'],
    ['?panneau=simulation&effort=100', '/vision/projection', '#bp-sim-title'],
    ['#saisie-des-flux', '/depenses/registre', null],
  ];
  for (const [suffix, path, hash] of legacy) {
    await open('/piloter/agir' + suffix);
    await page.waitForURL(url => url.pathname === path);
    if (hash) {
      assert.equal(new URL(page.url()).hash, hash);
      await page.locator(hash).waitFor({ state: 'visible' });
    }
    if (suffix.includes('simulation')) assert.equal(new URL(page.url()).searchParams.get('effort'), '100');
    if (suffix.includes('saisie')) await page.locator('bpm-operation-editor').waitFor({ state: 'visible' });
    check(`Ancien accès conservé : ${suffix} → ${path}`);
  }
  assert.deepEqual(errors, []);
  const directory = join(root, 'api/data/recettes');
  await mkdir(directory, { recursive: true });
  const report = { at: new Date().toISOString(), base, userId, user: user.label, checks, errors };
  await writeFile(join(directory, `bpm-navigation-production-${report.at.slice(0, 10)}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(`${checks.length} contrôles réussis · profil ${user.label}`);
} catch (error) {
  await page.screenshot({ path: '/tmp/bpm-navigation-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); }
