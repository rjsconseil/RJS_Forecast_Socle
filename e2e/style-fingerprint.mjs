// Empreinte des styles calculés de BPM-Astra : sert à nettoyer les feuilles de style sans changer le rendu.
// 1. node e2e/style-fingerprint.mjs save avant.json   (avant de toucher aux styles)
// 2. node e2e/style-fingerprint.mjs compare avant.json (après : liste les éléments dont le rendu a changé)
// Lecture seule ; mêmes réglages que e2e/astra.e2e.mjs (BPM_BASE_URL, BPM_USER_ID, CHROME_PATH).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [mode, file] = process.argv.slice(2);
if (!['save', 'compare'].includes(mode) || !file) {
  console.error('Usage : node e2e/style-fingerprint.mjs save|compare <fichier.json>');
  process.exit(2);
}
const base = process.env.BPM_BASE_URL ?? 'http://localhost:4300';
const chrome = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/opt/pw-browsers/chromium', '/usr/bin/chromium'].find(existsSync);
const SLUGS = ['', 'mouvements', 'mouvements/echeances', 'calendrier', 'calendrier/agenda', 'projets', 'financement/enveloppes', 'taches', 'budget', 'plafonds',
  'plafonds/postes', 'objectif', 'objectif/echeances', 'patrimoine', 'patrimoine/reglages', 'cloture', 'cloture/reglages', 'bilans'];
const PROPS = ['display', 'position', 'color', 'background-color', 'font-size', 'font-weight', 'line-height', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-left', 'border-top-width', 'border-top-style', 'border-top-color', 'border-left-width', 'border-radius', 'gap', 'grid-template-columns', 'flex-direction',
  'justify-content', 'align-items', 'box-shadow', 'opacity', 'text-transform', 'white-space', 'overflow-x', 'width', 'height'];

const cspErrors = new Set();
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const result = {};
try {
  for (const width of [1440, 375]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const users = await (await context.request.get(base + '/api/users')).json();
    const userId = process.env.BPM_USER_ID ?? (users.find(u => u.entryCount > 0) ?? users[0])?.id;
    await context.addInitScript(id => localStorage.setItem('rjs.activeUserId', id), userId);
    const page = await context.newPage();
    // Toute violation de la CSP (feuille ou script refusés) fausserait la mesure : elle est relevée.
    page.on('console', m => { if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) cspErrors.add(m.text().slice(0, 160)); });
    // Fiches (premier projet, premier poste plafonné) et fenêtres de saisie : mesurées comme les pages.
    const life = await (await context.request.get(base + '/api/bpm/life-management', { headers: { 'x-user-id': userId } })).json().catch(() => null);
    const project = life?.projects?.projects?.[0]?.coreProjectId;
    const fiches = project ? ['projets/' + project, 'projets/' + project + '/budget', 'projets/' + project + '/taches'] : [];
    // FP_PATHS=/calendrier,/modules : mesure ces adresses du site (hors Astra) au lieu des pages d'Astra.
    const extra = process.env.FP_PATHS?.split(',').filter(Boolean);
    const views = extra ? extra.map(p => ({ path: p, name: p })) : [...SLUGS.map(slug => ({ slug })), ...fiches.map(slug => ({ slug, name: slug.replace(project, ':id') })),
      { slug: '', name: '(fenêtre Dépense)', keys: ['+', 'D'] }, { slug: 'projets', name: '(fenêtre Projet)', keys: ['+', 'P'] },
      // Fenêtre d'une tâche de la fiche projet (ouverte par le titre de la première carte).
      ...(project ? [{ slug: 'projets/' + project + '/taches', name: 'projets/:id/taches (fenêtre Tâche)', click: '.task-title-link' }] : [])];
    for (const { slug, name, keys, path, click } of views) {
      await page.goto(base + (path ?? '/bpm-astra' + (slug ? '/' + slug : '')), { waitUntil: 'networkidle' });
      await page.locator(path ? 'main h1' : 'astra-part .astra-tabs a.is-current').first().waitFor();
      if (keys) {
        await page.evaluate(() => document.activeElement?.blur?.());
        for (const key of keys) { await page.keyboard.press(key); await page.waitForTimeout(150); }
        await page.locator('dialog[open]').first().waitFor();
      }
      if (click) {
        await page.locator(click).first().click();
        await page.locator('dialog[open]').first().waitFor();
      }
      await page.waitForTimeout(400);
      // FP_IGNORE=bpm-x,bpm-y : éléments hôtes sans boîte (display: contents) ajoutés en découpant un écran, ignorés.
      result[`${width}:/${name ?? slug}`] = await page.evaluate(([props, ignore]) => [...document.querySelectorAll('.app-shell *')]
        .filter(e => !e.closest('svg, .astra-toast') && !ignore.includes(e.tagName.toLowerCase()))
        .map(e => {
          const cs = getComputedStyle(e);
          const id = e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
          return [id, props.map(p => cs.getPropertyValue(p)).join(';')];
        }), [PROPS, (process.env.FP_IGNORE ?? '').split(',').filter(Boolean)]);
    }
    await context.close();
  }
} finally {
  await browser.close();
}

if (mode === 'save') {
  writeFileSync(file, JSON.stringify(result));
  if (cspErrors.size) console.log(`✗ Violations de la CSP :\n  ${[...cspErrors].join('\n  ')}`);
  console.log(`Empreinte enregistrée : ${Object.keys(result).length} vues, ${Object.values(result).reduce((n, v) => n + v.length, 0)} éléments.`);
} else {
  const before = JSON.parse(readFileSync(file, 'utf8'));
  let changed = 0;
  for (const [view, els] of Object.entries(before)) {
    const now = result[view] ?? [];
    if (now.length !== els.length) { console.log(`${view} : ${els.length} → ${now.length} éléments`); changed++; continue; }
    const diffs = els.flatMap(([id, v], i) => {
      if (now[i][1] === v) return [];
      const a = v.split(';'), b = now[i][1].split(';');
      // Bruit connu : une liste de période grisée le temps de son chargement (opacité seule).
      const changedProps = PROPS.filter((_, k) => a[k] !== b[k]);
      if (/^(select|option)\b/.test(id) && changedProps.join() === 'opacity') return [];
      return [`${id} : ${PROPS.filter((_, k) => a[k] !== b[k]).map(p => `${p} ${a[PROPS.indexOf(p)]} → ${b[PROPS.indexOf(p)]}`).join(', ')}`];
    });
    if (diffs.length) { changed++; console.log(`${view} :\n  ${diffs.slice(0, 6).join('\n  ')}${diffs.length > 6 ? `\n  … +${diffs.length - 6}` : ''}`); }
  }
  if (cspErrors.size) { console.log(`✗ Violations de la CSP :\n  ${[...cspErrors].join('\n  ')}`); changed++; }
  console.log(changed ? `\n✗ ${changed} vue(s) au rendu changé.` : '\n✓ Rendu identique sur toutes les vues.');
  process.exit(changed ? 1 : 0);
}
