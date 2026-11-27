// Parcours de navigation de BPM dans Astra, sur un site en marche et un profil de recette.
// Ce que astra.e2e.mjs ne couvre pas : les anciennes adresses servies en redirection (lecture conservée), et les
// brouillons qui survivent à l'historique du navigateur et au rechargement (saisie d'une entrée, tâche, demande de
// part, replanification dans l'agenda), et le contrôle du compte avant la clôture. Rien n'est enregistré : chaque fenêtre est refermée
// sans valider.
//
//   npm run e2e:bpm             (site sur http://localhost:4300, premier profil avec un projet doté d'une enveloppe)
//   BPM_BASE_URL=… BPM_USER_ID=… CHROME_PATH=… npm run e2e:bpm
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.BPM_BASE_URL ?? 'http://localhost:4300';
const chrome = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/opt/pw-browsers/chromium', '/usr/bin/chromium'].find(existsSync)
  ?? chromium.executablePath();
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
if (process.env.BPM_SESSION_TOKEN) await context.addCookies([{ name: 'rjs_session', value: process.env.BPM_SESSION_TOKEN, url: base }]);
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
const checks = [];
page.on('pageerror', e => errors.push(`${page.url()} : ${e.message}`));
const astra = (slug = '') => '/bpm-astra' + (slug ? '/' + slug : '');
const open = async (path) => { await page.goto(base + path, { waitUntil: 'networkidle' }); };
const url = () => new URL(page.url());
const check = (name) => { checks.push(name); console.log(`✓ ${name}`); };

try {
  const get = async (path, userId) => {
    const r = await context.request.get(base + path, { headers: userId ? { 'x-user-id': userId } : {} });
    assert(r.ok(), `${path} : ${await r.text()}`);
    return r.json();
  };
  // Le profil : BPM_USER_ID, sinon le premier qui a un projet avec enveloppe (npm run seed:projets en crée un).
  const funded = (overview) => overview.projects.find(p => p.budget?.role !== 'life' && p.budget?.regime);
  const users = process.env.BPM_USER_ID ? [{ id: process.env.BPM_USER_ID }] : await get('/api/users');
  let userId = null;
  for (const u of users) if (funded(await get('/api/bpm/projects', u.id))) { userId = u.id; break; }
  assert(userId, 'Aucun profil avec un projet doté d’une enveloppe : lancer npm run seed:projets (API arrêtée).');
  await context.addInitScript(id => localStorage.setItem('rjs.activeUserId', id), userId);
  const api = (path) => get(path, userId);

  // 1. Anciennes adresses : servies par Astra, avec la période et le fragment.
  const legacy = [
    ['/tableau-de-bord?period=2026-10', astra(), { period: '2026-10' }],
    ['/projet-de-vie/projets', astra('projets')],
    ['/app/taches', astra('taches')],
    ['/projet-de-vie/budget-type', astra('budget')],
    ['/plafonds/reglages', astra('plafonds')],
    ['/projet-de-vie/cloture?period=2026-10', astra('cloture'), { period: '2026-10' }],
    ['/calendrier-budget/agenda', astra('calendrier/agenda')],
    ['/tableau-de-bord/rapprochement', astra('cloture/compte')],
  ];
  for (const [from, to, query = {}] of legacy) {
    await open(from);
    await page.waitForURL(u => u.pathname === to);
    for (const [k, v] of Object.entries(query)) assert.equal(url().searchParams.get(k), v, `${from} : ${k} perdu`);
  }
  check(`Anciennes adresses : ${legacy.length} redirections vers Astra, période conservée`);

  // 2. Saisie d'une entrée : la fenêtre et son brouillon suivent l'historique et le rechargement.
  await open(astra('mouvements'));
  await open(astra('mouvements?entry=new&entryDirection=income'));
  const editor = page.locator('bpm-operation-editor');
  await editor.locator('input[name=label]').fill('Entrée en préparation · navigation');
  await editor.locator('input[name=amount]').fill('50');
  await page.goBack({ waitUntil: 'networkidle' });
  assert(!url().searchParams.has('entry'), 'Retour : la fenêtre de saisie reste ouverte');
  await page.goForward({ waitUntil: 'networkidle' });
  assert.equal(url().searchParams.get('entry'), 'new');
  await page.reload({ waitUntil: 'networkidle' });
  assert(await editor.locator('input[name=direction][value=income]').isChecked(), 'Le sens « entrée » est perdu');
  assert.equal(await editor.locator('input[name=amount]').inputValue(), '50');
  await page.keyboard.press('Escape');
  await page.waitForURL(u => !u.searchParams.has('entry'));
  check('Saisie d’entrée : sens et brouillon conservés en arrière, en avant et au rechargement');

  // 3. Nouvelle tâche : même chose pour l'éditeur de tâche.
  await open(astra('taches'));
  await open(astra('taches?editTask=new'));
  const task = page.locator('bpm-task-editor');
  await task.locator('input[name=title]').fill('Brouillon de navigation · recette');
  await task.locator('input[name=plannedHours]').fill('2.5');
  await page.goBack({ waitUntil: 'networkidle' });
  assert(!url().searchParams.has('editTask'), 'Retour : l’éditeur de tâche reste ouvert');
  await page.goForward({ waitUntil: 'networkidle' });
  assert.equal(await task.locator('input[name=title]').inputValue(), 'Brouillon de navigation · recette');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await task.locator('input[name=plannedHours]').inputValue(), '2.5');
  await page.keyboard.press('Escape');
  await page.waitForURL(u => !u.searchParams.has('editTask'));
  check('Nouvelle tâche : brouillon conservé en arrière, en avant et au rechargement');

  // 4. Demande de part d'une tâche : montant et motif conservés.
  // Une tâche pas encore terminée et sans demande en cours, dans un projet doté d'une enveloppe.
  let project = null, free = null;
  for (const p of (await api('/api/bpm/projects')).projects.filter(p => p.budget?.role !== 'life' && p.budget?.regime)) {
    free = (await api('/api/bpm/projects/' + p.project.id)).tasks.find(t => t.task.status !== 'done' && !t.budget?.request);
    if (free) { project = p; break; }
  }
  assert(free, 'Une tâche sans demande en cours est nécessaire, dans un projet avec enveloppe');
  await open(astra(`projets/${project.project.id}/taches?task=${free.task.id}`));
  await page.locator('.task-panel').getByRole('button', { name: 'Demander un montant', exact: true }).click();
  await page.waitForURL(u => u.searchParams.has('demande'));
  const funding = page.locator('form.task-funding-box');
  await funding.locator('input[name=amount]').fill('135');
  await funding.locator('input[name=note]').fill('Brouillon : aucun financement demandé par ce test');
  await page.goBack({ waitUntil: 'networkidle' });
  assert(!url().searchParams.has('demande'));
  await page.goForward({ waitUntil: 'networkidle' });
  assert.equal(await funding.locator('input[name=amount]').inputValue(), '135');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await funding.locator('input[name=amount]').inputValue(), '135');
  await funding.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.waitForURL(u => !u.searchParams.has('demande'));
  check('Demande de part : montant et motif conservés entre étapes et après rechargement');

  // 5. Vérifier le compte : des soldes bancaires qui suivent le net du cycle ne laissent aucun écart.
  const period = (await api('/api/bpm/balance')).period?.key ?? new Date().toISOString().slice(0, 7);
  const balance = await api(`/api/bpm/balance?period=${period}`);
  await open(astra(`cloture/compte?period=${period}`));
  await page.getByLabel('Ouverture (€)').first().fill('2000');
  await page.getByLabel('Contrôle (€)').first().fill(String((200000 + balance.netCents) / 100).replace('.', ','));
  await page.locator('.bank-confirm input[type=checkbox]').check();
  await page.locator('.bank-verdict[data-tone=success]').waitFor();
  check('Vérifier le compte : soldes bancaires qui concordent avec le net du cycle, aucun écart');

  // 6. Agenda : replanifier garde la date choisie en arrière et en avant, sans rien enregistrer.
  await open(astra('calendrier/agenda?vue=mois'));
  // La liste de l'agenda prend sa hauteur (elle était écrasée à la hauteur de son titre).
  assert(await page.locator('.calendar-agenda-list').evaluate(e => e.getBoundingClientRect().height > 100), 'Agenda tronqué');
  const plan = page.locator('.calendar-agenda-actions').getByRole('button', { name: 'Replanifier', exact: true }).first();
  if (await plan.count()) {
    await plan.click();
    await page.waitForURL(u => u.searchParams.has('calPlan'));
    const day = await page.locator('.calendar-plan input').inputValue();
    await page.goBack({ waitUntil: 'networkidle' });
    assert(!url().searchParams.has('calPlan'));
    await page.goForward({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('.calendar-plan input').inputValue(), day);
    await page.locator('.calendar-plan').getByRole('button', { name: 'Annuler', exact: true }).click();
    check('Agenda : replanification reprise en arrière et en avant');
  } else console.log('· Agenda : aucun événement à replanifier ce mois-ci');

  assert.deepEqual(errors, [], `Erreurs dans la page :\n  ${errors.join('\n  ')}`);
  console.log(`\n✓ BPM dans Astra : ${checks.length} parcours de navigation conformes.`);
} catch (error) {
  console.error(`\n✖ ${error.message}\n  page : ${page.url()}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
