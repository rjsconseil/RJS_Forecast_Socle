// Outils communs des tests de parcours BPM, joués EN PRODUCTION sur ce poste : le site construit
// (`npm run build` puis `npm run start:production`, http://localhost:4300) et l'API réelle avec les données
// du poste. Chaque parcours crée son propre utilisateur par l'interface et le LAISSE en place, avec ses données :
// elles servent de trace et de jeu d'essai. Un rapport JSON est écrit dans api/data/recettes/.
//
// Usage d'un parcours : `node e2e/parcours/p03-saisir-une-depense.mjs` (ou `npm run e2e:parcours` pour tous).
// Variables : BPM_BASE_URL (défaut http://localhost:4300), HEADED=1 pour voir le navigateur,
// PLAYWRIGHT_MODULE=/chemin/vers/playwright/index.js si Playwright n'est pas installé dans le projet.
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BASE = process.env.BPM_BASE_URL ?? 'http://localhost:4300';
/** Date du jour du poste (AAAA-MM-JJ, heure locale) : les parcours se jouent sur le vrai calendrier. */
export const TODAY = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
/** Horodatage court pour des libellés uniques et lisibles. */
export const STAMP = new Date().toISOString().slice(0, 16).replace('T', ' ');

/** Décale une date ISO de n jours (n peut être négatif). */
export function shiftDate(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** Texte affiché normalisé : espaces fines et insécables deviennent des espaces simples. */
export const norm = (text) => String(text ?? '').replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
/** Montant en euros tel que l'affiche le site (« 1 250,00 € »), après normalisation. */
export const euros = (value) =>
  norm(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value));

export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    /* Pas installé dans le projet : on cherche une installation existante du poste. */
  }
  const npx = join(homedir(), '.npm', '_npx');
  const cached = existsSync(npx) ? readdirSync(npx).map((d) => join(npx, d, 'node_modules', 'playwright', 'index.js')) : [];
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    ...cached,
    '/usr/lib/chatgpt/resources/cua_node/lib/node_modules/playwright/index.js',
  ].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate)) return createRequire(import.meta.url)(candidate);
  throw new Error('Playwright introuvable : `npm i -D playwright` ou PLAYWRIGHT_MODULE=/chemin/vers/playwright/index.js');
}

/**
 * Joue un parcours : navigateur isolé (son propre stockage, donc son propre utilisateur actif), relevé des
 * erreurs JavaScript, des erreurs serveur (5xx) et des refus métier (4xx, gardés pour information),
 * capture d'écran en cas d'échec, rapport JSON dans api/data/recettes/.
 *
 * `run(t)` reçoit l'outil `t` : t.page, t.check(nom), t.step(nom, fn), t.user (une fois créé)…
 */
export async function journey(id, title, run, { viewport = { width: 1440, height: 1000 }, userId = null } = {}) {
  const playwright = await loadPlaywright();
  const browser = await playwright.chromium.launch({ headless: !process.env.HEADED });
  const context = await browser.newContext({ viewport, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  if (userId) await context.addInitScript((id) => localStorage.setItem('rjs.activeUserId', id), userId);
  const page = await context.newPage();
  page.setDefaultTimeout(Number(process.env.BPM_TIMEOUT ?? 10000));
  const problems = [];
  const refusals = [];
  const checks = [];
  page.on('pageerror', (error) => problems.push({ kind: 'erreur JavaScript', url: page.url(), message: error.message }));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text()))
      problems.push({ kind: 'console', url: page.url(), message: message.text().slice(0, 500) });
  });
  page.on('response', async (response) => {
    if (!response.url().includes('/api/')) return;
    if (response.status() >= 500) problems.push({ kind: `HTTP ${response.status()}`, url: response.url() });
    else if (response.status() >= 400) {
      const body = await response.text().catch(() => '');
      refusals.push({ status: response.status(), url: response.url().replace(BASE, ''), body: body.slice(0, 400) });
    }
  });
  const t = {
    id,
    page,
    context,
    browser,
    user: userId ? { id: userId, label: null } : null,
    problems,
    refusals,
    checks,
    /** Une vérification réussie, nommée comme l'utilisateur la vivrait. */
    check(name, details = {}) {
      checks.push({ name, ...details });
      console.log(`  ✓ ${name}`);
    },
    /** Une étape du parcours : son nom apparaît dans le rapport si elle échoue. */
    async step(name, fn) {
      t.current = name;
      const result = await fn();
      return result;
    },
    current: 'démarrage',
  };
  console.log(`▶ ${id} · ${title}`);
  const started = Date.now();
  let failure = null;
  try {
    await run(t);
    assert.deepEqual(problems, [], `Erreurs relevées pendant le parcours : ${JSON.stringify(problems, null, 2)}`);
  } catch (error) {
    failure = { step: t.current, message: error.message.slice(0, 2000), url: page.url() };
    const shot = join(ROOT, 'api', 'data', 'recettes', 'captures', `${id}-${TODAY}.png`);
    await mkdir(dirname(shot), { recursive: true });
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    failure.screenshot = shot;
    console.error(`  ✗ ${t.current} : ${error.message.split('\n')[0]}`);
  } finally {
    const report = {
      id,
      title,
      at: new Date().toISOString(),
      base: BASE,
      seconds: Math.round((Date.now() - started) / 1000),
      user: t.user,
      result: failure ? 'échec' : 'réussi',
      failure,
      checks,
      problems,
      refusals,
    };
    const directory = join(ROOT, 'api', 'data', 'recettes', 'parcours');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${id}-${TODAY}.json`), JSON.stringify(report, null, 2) + '\n');
    await browser.close();
    console.log(failure ? `✗ ${id} échoué à « ${failure.step} »` : `✓ ${id} réussi · ${checks.length} contrôles`);
    if (failure) process.exitCode = 1;
  }
}

/** Ouvre une adresse du site et attend que la page soit posée. */
export async function open(page, path) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.locator('main h1').first().waitFor();
}

/** Attend que l'adresse réponde au test (chemin seul, ou fonction sur l'URL). */
export async function waitPath(page, test) {
  await page.waitForURL((url) => (typeof test === 'string' ? url.pathname === test : test(url)));
}

/** Lecture de l'API telle que la voit l'utilisateur actif de la page. */
export async function api(page, path) {
  const userId = await page.evaluate(() => localStorage.getItem('rjs.activeUserId'));
  const response = await page.request.get(BASE + path, { headers: { 'x-user-id': userId } });
  assert(response.ok(), `${path} : ${response.status()} ${await response.text()}`);
  return response.json();
}

/** La barre de parcours de la page (« ← Retour / Suivant → ») ou celle d'une fenêtre ouverte. */
export function bar(page, { modal = false } = {}) {
  const root = modal ? page.locator('dialog[open] .modal-journey') : page.locator('main > bpm-navigation');
  return {
    root,
    back: () => root.locator('.nav-back').click(),
    forward: () => root.locator('.nav-forward').click(),
    last: () => root.locator('.nav-last').click(),
    backEnabled: () => root.locator('.nav-back').isEnabled(),
    forwardEnabled: () => root.locator('.nav-forward').isEnabled(),
    /** Les étapes enregistrées (sessionStorage) et le curseur. */
    trail: () =>
      page.evaluate(() => {
        const key = Object.keys(sessionStorage).find((k) => k.startsWith('bpm-navigation:'));
        return key ? JSON.parse(sessionStorage.getItem(key)) : null;
      }),
  };
}

/** Le dernier message de confirmation ou d'état visible (barre de parcours, bandeau, statut). */
export async function notices(page) {
  const texts = await page
    .locator('.bpm-navigation-notice, [role=status], [role=alert]')
    .evaluateAll((elements) => elements.filter((e) => e.offsetParent).map((e) => e.innerText));
  return texts.map(norm).filter(Boolean);
}

/** Attend qu'un message visible contienne le texte (ou réponde à l'expression). */
export async function expectNotice(page, expected, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let seen = [];
  while (Date.now() < deadline) {
    seen = await notices(page);
    if (seen.some((text) => (expected instanceof RegExp ? expected.test(text) : text.includes(expected)))) return seen;
    await page.waitForTimeout(150);
  }
  throw new Error(`Message attendu « ${expected} » ; vus : ${JSON.stringify(seen)}`);
}

/**
 * Crée un utilisateur par le formulaire « Nouvel utilisateur » (/utilisateurs/nouveau), comme un utilisateur
 * lambda, et le rend actif dans ce navigateur. Les champs facultatifs vides restent « à configurer plus tard ».
 */
export async function createUser(t, { label, type = 'Famille', stock = null, stockDate = null, objective = null, anchorDay = null, cycleStart = null }) {
  const { page } = t;
  await open(page, '/utilisateurs/nouveau');
  const form = page.locator('form.us-form');
  await form.getByLabel('Libellé').fill(label);
  await form.getByLabel('Type d’utilisateur').selectOption({ label: type });
  if (stock !== null) await form.getByLabel('Stock d\'ouverture (€)').fill(String(stock));
  if (stockDate) await form.getByLabel('À la date du').fill(stockDate);
  if (objective !== null) await form.getByLabel('Objectif initial du patrimoine (€)').fill(String(objective));
  if (anchorDay !== null) await form.getByLabel('Jour de début de période').fill(String(anchorDay));
  if (cycleStart) await form.getByLabel('Premier cycle à partir du').fill(cycleStart);
  await form.getByRole('button', { name: 'Créer et utiliser cet utilisateur' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/utilisateurs'));
  const id = await page.evaluate(() => localStorage.getItem('rjs.activeUserId'));
  assert(id, 'Aucun utilisateur actif après la création');
  t.user = { id, label };
  return t.user;
}
