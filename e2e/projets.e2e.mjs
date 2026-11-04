// Test de bout en bout des projets de la vie : le site construit et l'API réelle, pilotés par un vrai navigateur.
// Le scénario de api/scripts/project-scenarios.mjs est rejoué de mai au 30 novembre 2026 : six mois clos et tout
// novembre. Les gestes des projets passent par les pages (création dans le noyau, financement, montant attribué,
// parts des tâches, demandes de dépassement et décisions du budget de vie, validation des règlements, retours,
// glisser-déposer des tâches, facturation de fin de cycle) ; la vie courante du budget (salaires, loyer, courses,
// clôtures) passe par l'API. L'horloge de recette de l'API et celle du navigateur avancent ensemble. Les chiffres
// affichés à la fin sont comparés aux attendus recalculés à part.
//
// Prérequis : `npm run build` (site construit) et Playwright avec Chromium (`npm i -D playwright && npx playwright
// install chromium`, déjà présents dans l'environnement de recette). Usage : `npm run e2e:projets [-- --jusqu-au 2026-11-30]`.
// Tout tourne sur des ports et un stockage temporaires : les données du poste ne sont jamais touchées.
import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, stat } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { httpDriver, runScenario } from '../api/scripts/project-scenarios.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'web/dist/web/browser');
const API_PORT = 3491;
const WEB_PORT = 4391;
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const UNTIL = arg('jusqu-au', '2026-11-30');
const SHOTS = arg('captures', null);
if (SHOTS) await mkdir(SHOTS, { recursive: true });

let playwright;
try {
  playwright = await import('playwright');
} catch {
  // Installation globale (NODE_PATH) : seul `require` la trouve.
  try {
    playwright = createRequire(import.meta.url)('playwright');
  } catch {
    playwright = null;
  }
}
if (!playwright) {
  console.error('\n✖ Playwright est absent : npm i -D playwright && npx playwright install chromium\n');
  process.exit(1);
}
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('\n✖ Site non construit : lancez d’abord npm run build\n');
  process.exit(1);
}

// ---------- API de recette et site construit, sur des ports temporaires ----------
const dir = await mkdtemp(join(tmpdir(), 'rjs-e2e-'));
const api = spawn(process.execPath, [join(ROOT, 'api/src/server.mjs')], {
  env: { ...process.env, J1_API_PORT: String(API_PORT), J1_DATA_FILE: join(dir, 'store.json'), J1_ENABLE_RECETTE_RESET: '1', SOCLE_TODAY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
api.stderr.on('data', (c) => process.stderr.write(`[api] ${c}`));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const web = createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    const p = request({ host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    req.pipe(p);
    return;
  }
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path);
  const isFile = await stat(file).then((s) => s.isFile(), () => false);
  if (!isFile) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => web.listen(WEB_PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${WEB_PORT}`;
const API = `http://127.0.0.1:${API_PORT}`;
for (let i = 0; i < 100; i++) {
  if (await fetch(`${API}/api/users`).then((r) => r.ok, () => false)) break;
  await new Promise((r) => setTimeout(r, 100));
}

// ---------- navigateur ----------
const browser = await playwright.chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && consoleErrors.push(`${page.url()} : ${m.text().slice(0, 200)}`));
page.on('pageerror', (e) => consoleErrors.push(`${page.url()} : ${e.message.slice(0, 200)}`));
const gestures = { ui: 0, dragged: 0, dragFallback: 0 };

const http = httpDriver(API);
const notice = async () => ((await page.locator('.bpm-feedback, .board-move-feedback').first().textContent({ timeout: 8000 }).catch(() => '')) || '').replace(/\s+/g, ' ').trim();
const open = async (path) => {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
};
/** Attend la fin d'une écriture : un message, ou l'encart de dépassement à décider. */
async function settled() {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(150);
}
/** Encart « Budget du projet dépassé » : demande au budget de vie puis décision ; renvoie le dépassement demandé. */
async function overrunFlow(prj, decision) {
  const flow = page.locator('section.bpm-overrun', { hasText: 'Budget du projet dépassé' });
  if (!(await flow.isVisible().catch(() => false))) return 0;
  await flow.getByRole('button', { name: /Demander l’autorisation/ }).click();
  await page.locator('bpm-overrun-request').first().waitFor();
  const d = await http.projectDetail(prj);
  const pending = d.overruns.find((o) => o.status === 'pending');
  await page.locator('bpm-overrun-request').first().getByRole('button', { name: decision === 'approve' ? 'Autoriser le dépassement' : 'Refuser' }).click();
  await settled();
  gestures.ui += 2;
  return pending?.amountCents ?? 0;
}
const row = (title) => page.locator('section[aria-labelledby=shares-title] .bpm-table tbody tr', { hasText: title }).first();

/** Pilote navigateur : les gestes des projets par les pages, le reste par l'API. */
const ui = {
  ...http,
  name: 'navigateur',
  async go(date) {
    await http.go(date);
    await page.clock.setFixedTime(new Date(`${date}T10:00:00`));
  },
  async createUser(input) {
    const u = await http.createUser(input);
    await context.addInitScript((id) => localStorage.setItem('rjs.activeUserId', id), u.userId);
    return u;
  },
  async createProject(title, tasks) {
    await open('/projects/new');
    await page.locator('[formcontrolname=title]').fill(title);
    await page.locator('[formcontrolname=description]').fill(`Cas d'essai de bout en bout : ${title}.`);
    await page.locator('button[type=submit]').click();
    await page.waitForURL(/\/projects\/prj_[^/]+$/);
    const projectId = page.url().split('/').pop();
    const ids = {};
    for (const t of tasks) {
      await open(`/tasks/new?projectId=${projectId}`);
      await page.locator('[formcontrolname=title]').fill(t);
      await page.locator('button[type=submit]').click();
      await page.waitForURL(new RegExp(`/projects/${projectId}$`));
      const all = await http.call('GET', '/api/tasks');
      ids[t] = all.find((x) => x.task.title === t && x.task.projectId === projectId)?.task.id;
      if (!ids[t]) throw new Error(`Tâche « ${t} » non rattachée au projet par le formulaire du noyau.`);
    }
    gestures.ui += 1 + tasks.length;
    return { projectId, tasks: ids };
  },
  async adopt(prj) {
    await open('/app/projets');
    await page.locator('.bpm-adopt select').selectOption(prj.projectId);
    await page.locator('.bpm-adopt button[type=submit]').click();
    await settled();
    if (!(await notice()).includes('projet standard du budget de vie')) throw new Error(`Financement de « ${prj.title} » : ${await notice()}`);
    gestures.ui += 1;
    return (await http.projectDetail(prj)).budget.budgetId;
  },
  async allocate(prj, amount) {
    await open(`/app/projets/${prj.projectId}`);
    const form = page.locator('form.bpm-inline-form', { has: page.locator('input.bpm-amount-input') }).first();
    await form.locator('input.bpm-amount-input').fill(String(amount));
    await form.locator('button[type=submit]').click();
    await settled();
    if (!(await notice()).includes('Montant attribué')) throw new Error(`Attribution « ${prj.title} » : ${await notice()}`);
    gestures.ui += 1;
  },
  async share(prj, task, amount, decision = 'approve') {
    await open(`/app/projets/${prj.projectId}`);
    await row(task).locator('input[name=share]').fill(String(amount).replace('.', ','));
    await row(task).getByRole('button', { name: 'OK' }).click();
    await settled();
    gestures.ui += 1;
    const overrunCents = await overrunFlow(prj, decision);
    const d = await http.projectDetail(prj);
    return { saved: d.budget.shares[prj.tasks[task]] === Math.round(amount * 100), overrunCents };
  },
  async setReturn(prj, task, { label, amount, cadence }) {
    await open(`/app/projets/${prj.projectId}`);
    await row(task).getByRole('button', { name: 'Prévoir un retour' }).click();
    await row(task).locator('input[name=label]').fill(label);
    await row(task).locator('input[name=amount]').fill(String(amount));
    await row(task).locator('select[name=cadence]').selectOption(cadence);
    await row(task).getByRole('button', { name: 'Enregistrer' }).click();
    await settled();
    if (!(await notice()).includes('Retour')) throw new Error(`Retour « ${task} » : ${await notice()}`);
    gestures.ui += 1;
  },
  async pay(prj, opId, amount, date, decision = 'approve') {
    const label = (await http.call('GET', `/api/bpm/lines/${opId}`)).line.label;
    await open(`/app/projets/${prj.projectId}`);
    const r = page.locator('section[aria-labelledby=charges-title] .bpm-table tbody tr', { hasText: label }).first();
    await r.getByRole('button', { name: 'Valider le règlement' }).click();
    await r.locator('input[name=date]').fill(date);
    await r.locator('input[name=amount]').fill(String(amount).replace('.', ','));
    await r.getByRole('button', { name: 'Valider', exact: true }).click();
    await settled();
    gestures.ui += 1;
    const overrunCents = await overrunFlow(prj, decision);
    const line = (await http.call('GET', `/api/bpm/lines/${opId}`)).line;
    return { saved: line.settled, overrunCents };
  },
  async status(prj, task, status) {
    await open(`/app/taches?project=${prj.projectId}`);
    const card = page.locator('.task-card', { hasText: task }).first();
    const before = await notice();
    const grip = await card.locator('.grip').boundingBox();
    const target = await page.locator(`.board-column[data-column=${status}] .board-column-content`).boundingBox();
    if (grip && target) {
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(grip.x + 30, grip.y + 10, { steps: 4 });
      await page.mouse.move(target.x + target.width / 2, target.y + 30, { steps: 12 });
      await page.mouse.up();
    }
    // Le dépôt s'anime avant l'appel au noyau : on attend son écriture (3 s au plus) avant de juger.
    let t = await http.call('GET', `/api/tasks/${prj.tasks[task]}`);
    for (let i = 0; i < 30 && t.task.status !== status; i++) {
      await page.waitForTimeout(100);
      t = await http.call('GET', `/api/tasks/${prj.tasks[task]}`);
    }
    await settled();
    if (t.task.status === status) gestures.dragged += 1;
    else {
      // Repli : le sélecteur « Déplacer vers » de la même carte (même commande du noyau).
      await card.locator('label.status-change select').selectOption(status);
      await settled();
      gestures.dragFallback += 1;
      t = await http.call('GET', `/api/tasks/${prj.tasks[task]}`);
      if (t.task.status !== status) throw new Error(`État de « ${task} » : ${await notice()}`);
    }
    gestures.ui += 1;
    const n = await notice();
    return n !== before && n.includes('Retour au budget de vie') ? [n.slice(n.indexOf('Retour au budget de vie'))] : [];
  },
  async bill() {
    const before = await http.call('GET', '/api/bpm/projects');
    await open('/app/projets');
    await page.getByRole('button', { name: 'Facturer au budget de vie' }).click();
    await settled();
    gestures.ui += 1;
    const after = await http.call('GET', '/api/bpm/projects');
    return after.projects
      .map((p) => ({ p, b: before.projects.find((x) => x.project.id === p.project.id) }))
      .filter(({ p, b }) => p.budget.billedOverrunCents > (b?.budget.billedOverrunCents ?? 0))
      .map(({ p, b }) => ({ name: p.budget.name, billedOverrunCents: p.budget.billedOverrunCents - (b?.budget.billedOverrunCents ?? 0), allocationCents: p.budget.allocationCents }));
  },
};

// ---------- jeu ----------
let r;
const started = Date.now();
try {
  r = await runScenario(ui, { start: '2026-05', until: UNTIL, label: 'E2E · Famille Laurent', log: (l) => process.stdout.write(`\r${l.slice(0, 110).padEnd(110)}`) });
  process.stdout.write('\n');

  // ---------- ce que les pages affichent ----------
  const fmt = (c) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(c / 100).replace(/\s/g, ' ');
  const text = async () => (await page.locator('main, body').first().innerText()).replace(/\s/g, ' ');
  const shows = [];
  const show = (name, ok, detail) => shows.push({ name, ok, detail });
  const cur = UNTIL.slice(0, 7);
  const l = r.ledger[cur];
  await open('/tableau-de-bord');
  await page.waitForTimeout(500);
  const dash = await text();
  show(`Tableau de bord ${cur} : reçu ${fmt(l.income)}`, dash.includes(fmt(l.income)), '');
  show(`Tableau de bord ${cur} : dépensé ${fmt(l.lifeCharges + l.projectCharges)} (budget de vie + projets validés)`, dash.includes(fmt(l.lifeCharges + l.projectCharges)), '');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e2e-tableau-de-bord.png'), fullPage: true });
  await open('/app/projets');
  const red = (await page.locator('.task-card[data-budget-state=deficit] h4').allInnerTexts()).map((s) => s.trim()).sort();
  const expectRed = UNTIL >= '2026-11-26' ? ['Noël en famille', 'Week-end à Lyon'] : null;
  if (expectRed) show('Projets de la vie : en rouge, les projets en dépassement à facturer en fin de cycle', JSON.stringify(red) === JSON.stringify(expectRed), red.join(', '));
  const panel = (await page.locator('.bpm-life-panel').innerText()).replace(/\s/g, ' ');
  if (expectRed) show(`Panneau du budget de vie : dépassements autorisés ${fmt(11000)}`, panel.includes(fmt(11000)), '');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e2e-projets.png'), fullPage: true });
  await open(`/depenses?period=${cur}`);
  await page.waitForTimeout(500);
  const specials = (await page.locator('.expense-row').allInnerTexts()).flatMap((t) => t.split('\n').map((x) => x.trim()).filter((x) => /^(Budget attribué|Dépassement) · /.test(x))).sort();
  if (expectRed) show('Dépenses de novembre : charges spéciales des projets présentées hors totaux', JSON.stringify(specials) === JSON.stringify(['Budget attribué · Noël en famille', 'Dépassement · Noël en famille · Décoration', 'Dépassement · Week-end à Lyon · Restaurants']), specials.join(' | '));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e2e-depenses.png'), fullPage: true });
  const p10 = r.projects.P10;
  if (p10?.projectId) {
    await open(`/app/projets/${p10.projectId}`);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e2e-noel.png'), fullPage: true });
  }
  for (const path of ['/app/taches', '/calendrier-budget', '/piloter', '/app/reglages']) await open(path);
  show('Aucune erreur dans la console du navigateur', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  // ---------- rapport ----------
  console.log(`\nBout en bout — ${r.months[0]} → ${r.until} : ${r.played}/${r.total} événements, ${gestures.ui} gestes dans les pages (${gestures.dragged} glisser-déposer, ${gestures.dragFallback} replis sur le sélecteur), ${Math.round((Date.now() - started) / 1000)} s\n`);
  for (const s of r.steps) console.log(`  ${s.date}  ${s.text}`);
  console.log('\nAttendus recalculés (API) :');
  for (const c of r.checks) console.log(`  ${c.ok ? '✓' : '✖'} ${c.name}${c.ok ? '' : ` — attendu ${JSON.stringify(c.expected)}, observé ${JSON.stringify(c.observed)}`}`);
  console.log('\nCe que les pages affichent :');
  for (const s of shows) console.log(`  ${s.ok ? '✓' : '✖'} ${s.name}${s.ok || !s.detail ? '' : ` — ${s.detail}`}`);
  const all = [...r.checks, ...shows];
  console.log(`\n${all.filter((c) => c.ok).length}/${all.length} vérifications réussies.\n`);
  process.exitCode = all.every((c) => c.ok) ? 0 : 1;
} catch (err) {
  process.stdout.write('\n');
  console.error(`\n✖ ${err.message}\n  page : ${page.url()}\n  message affiché : ${await notice()}`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'e2e-echec.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  web.close();
  api.kill('SIGTERM');
}
