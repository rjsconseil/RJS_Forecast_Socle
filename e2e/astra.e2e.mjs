// Tests d'interface de BPM-Astra sur le site en marche (lecture seule : rien n'est enregistré).
// Pour chaque page du menu et ses écrans, à 1440 px et à 375 px : un seul onglet courant, les onglets de la section
// d'abord et toujours les mêmes, un onglet qui porte le nom de sa page, aucun débordement de côté, aucune erreur,
// aucune navigation répétée dans la boîte à outils. Puis les gestes : création en fenêtre sans quitter la page,
// menu « Nouveau » au clavier, onglets précédent / suivant.
//
//   npm run e2e:astra                      (site sur http://localhost:4300, premier profil qui a des données)
//   BPM_BASE_URL=… BPM_USER_ID=… CHROME_PATH=… npm run e2e:astra
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const base = process.env.BPM_BASE_URL ?? 'http://localhost:4300';
const chrome = process.env.CHROME_PATH ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/opt/pw-browsers/chromium', '/usr/bin/chromium'].find(existsSync);
assert(chrome, 'Navigateur introuvable : indiquez CHROME_PATH.');

// Les pages d'Astra et leur section (même déclaration que le menu : web/src/app/astra/astra-parts.ts).
const PAGES = {
  quotidien: ['', 'mouvements', 'mouvements/echeances', 'calendrier', 'calendrier/agenda'],
  projets: ['projets', 'financement/enveloppes', 'taches'],
  budget: ['budget', 'plafonds', 'plafonds/postes'],
  patrimoine: ['objectif', 'objectif/echeances', 'patrimoine', 'patrimoine/reglages'],
  cycles: ['cloture/compte', 'cloture', 'cloture/reglages', 'bilans'],
};
const MOBILE = ['', 'mouvements', 'projets', 'budget', 'objectif', 'cloture', 'bilans'];

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const users = await (await context.request.get(base + '/api/users')).json();
  const userId = process.env.BPM_USER_ID ?? (users.find(u => u.entryCount > 0) ?? users[0])?.id;
  assert(userId, 'Aucun profil sur ce site.');
  await context.addInitScript(id => localStorage.setItem('rjs.activeUserId', id), userId);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', e => errors.push(`${page.url()} : ${e.message}`));

  const open = async (slug) => {
    await page.goto(base + '/bpm-astra' + (slug ? '/' + slug : ''), { waitUntil: 'networkidle' });
    await page.locator('astra-part .astra-tabs a.is-current').waitFor();
  };
  /** Ce que la page montre de son cadre : onglets, titre, débordement, navigations répétées. */
  const read = () => page.evaluate(() => {
    const visible = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
    const tabs = [...document.querySelectorAll('.astra-tabs a:not(.astra-tab-step)')].map(a => ({
      label: a.textContent.replace(/^\d+/, '').trim(), current: a.classList.contains('is-current'), other: a.classList.contains('is-other'),
    }));
    return {
      tabs,
      title: document.querySelector('.astra-titlebar h1')?.textContent.trim() ?? null,
      overflow: document.documentElement.scrollWidth - innerWidth,
      repeated: [...document.querySelectorAll('.astra-rail [data-astra-tab]')].filter(visible).length,
      primary: [...document.querySelectorAll('.astra-bar-primary :is(a, button)')].filter(visible).map(e => e.textContent.trim()),
    };
  });

  // 1. Structure de chaque page, à 1440 px.
  const report = [];
  for (const [part, slugs] of Object.entries(PAGES)) {
    let ownTabs = null;
    for (const slug of slugs) {
      await open(slug);
      const v = await read();
      const where = `/${slug || '(accueil)'}`;
      const current = v.tabs.filter(t => t.current);
      check(current.length === 1, `${where} : ${current.length} onglet(s) courant(s)`);
      if (v.title) check(v.title.startsWith(current[0]?.label ?? '¤'), `${where} : l'onglet « ${current[0]?.label} » ne porte pas le nom de la page « ${v.title} »`);
      const own = v.tabs.filter(t => !t.other).map(t => t.label);
      const firstOther = v.tabs.findIndex(t => t.other);
      check(firstOther === -1 || v.tabs.slice(firstOther).every(t => t.other), `${where} : les onglets de la section ne sont pas en tête`);
      ownTabs ??= own;
      check(JSON.stringify(own) === JSON.stringify(ownTabs), `${where} : onglets de « ${part} » différents (${own.join(', ')})`);
      check(v.overflow <= 1, `${where} : débordement de côté de ${v.overflow}px`);
      check(v.repeated === 0, `${where} : ${v.repeated} lien(s) de la boîte à outils répètent un onglet`);
      report.push(`${where.padEnd(24)} ${String(v.tabs.length).padStart(2)} onglets · action principale : ${v.primary.join(' / ') || '—'}`);
    }
  }

  // 2. Écran étroit : aucun débordement, l'onglet courant reste visible.
  await page.setViewportSize({ width: 375, height: 812 });
  for (const slug of MOBILE) {
    await open(slug);
    const r = await page.evaluate(() => {
      const nav = document.querySelector('.astra-tabs').getBoundingClientRect();
      const cur = document.querySelector('.astra-tabs a.is-current').getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth - innerWidth, visible: cur.left >= nav.left - 1 && cur.right <= nav.right + 1 };
    });
    check(r.overflow <= 1, `/${slug} à 375px : débordement de ${r.overflow}px`);
    check(r.visible, `/${slug} à 375px : l'onglet courant est hors de la barre`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // 3. Gestes : créer en fenêtre sans quitter la page, puis fermer sans rien enregistrer.
  await open('');
  const home = page.url();
  const primary = page.locator('.astra-bar-primary :is(a, button)').first();
  if (/Saisir une dépense/.test(await primary.textContent())) {
    await primary.click();
    await page.locator('dialog[open], .modal, [role="dialog"]').first().waitFor();
    check(page.url() === home, 'Accueil : « Saisir une dépense » a quitté la page au lieu d’ouvrir la fenêtre');
    await page.keyboard.press('Escape');
  }
  // « + » ouvre le menu Nouveau ; Échap le referme.
  await page.locator('dialog[open], [role="dialog"]').first().waitFor({ state: 'detached' }).catch(() => {});
  await page.evaluate(() => (document.activeElement)?.blur?.());
  await page.keyboard.press('+');
  // Le menu se dessine au rendu suivant : on l'attend un court instant.
  const menuOpened = await page.locator('.astra-new-menu').waitFor({ timeout: 3000 }).then(() => true, () => false);
  check(menuOpened, 'Touche + : le menu « Nouveau » ne s’ouvre pas');
  await page.keyboard.press('Escape');
  // Flèche « suivant » des onglets : mène à l'onglet suivant.
  await open('cloture/compte');
  await page.locator('.astra-tabs .astra-tab-step').last().click();
  await page.waitForURL(/\/bpm-astra\/cloture(\?|$)/);

  check(!errors.length, `Erreurs dans la page :\n  ${errors.join('\n  ')}`);
  console.log(report.join('\n'));
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(`\n✗ ${failures.length} écart(s) :\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\n✓ BPM-Astra : structure, écran étroit et gestes conformes.');
