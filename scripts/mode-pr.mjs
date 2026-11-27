// Mode d'une PR : chaque fichier modifié est rangé dans le grand noyau (socle) ou dans une application autonome
// (et ses fonctionnalités par section). Une PR ne mêle jamais les deux modes (docs/sections/README.md).
//
//   npm run mode                       compare la branche à origin/main
//   node scripts/mode-pr.mjs --base <réf>
//
// Mode application : web/src/app/sections/** (fonctionnalités, application, registre sections/inscriptions.ts),
//                    web/src/app/hybrides/**, et la fiche de la section docs/sections/<clé>.md.
// Sans mode       : CHANGELOG.md (chaque livraison y ajoute sa ligne).
// Mode socle      : tout le reste (API, base, interface grand-noyau.ts, cadre BPM-Astra, tests, scripts, CI, docs).
// Exception rare et visible : MODE_TRANSITION=1 (étiquette « transition-socle » sur la PR) laisse une PR du socle
// déplacer une déclaration vers une application, quand le socle cède la main (par exemple à la création du point
// d'inscription). Le mode affiché reste « socle ».
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const base = arg('--base') ?? process.env.MODE_BASE ?? 'origin/main';

/** Rangement d'un chemin du dépôt : { mode: 'socle' | 'application' | null, app?: clé de l'application }. */
export function classify(path) {
  let m = path.match(/^web\/src\/app\/sections\/([^/]+)\//);
  if (m) return { mode: 'application', app: m[1] };
  if (path === 'web/src/app/sections/inscriptions.ts') return { mode: 'application', app: 'registre' };
  m = path.match(/^web\/src\/app\/hybrides\/([^/]+)\//);
  if (m) return { mode: 'application', app: m[1] };
  m = path.match(/^docs\/sections\/([^/_][^/]*)\.md$/);
  if (m && m[1] !== 'README') return { mode: 'application', app: m[1] };
  if (path === 'CHANGELOG.md') return { mode: null };
  return { mode: 'socle' };
}

/** Verdict sur une liste de fichiers modifiés. */
export function verdict(files, { transition = false } = {}) {
  const socle = []; const application = []; const neutral = []; const apps = new Set();
  for (const file of files) {
    const c = classify(file);
    if (c.mode === 'socle') socle.push(file);
    else if (c.mode === 'application') { application.push(file); if (c.app !== 'registre') apps.add(c.app); }
    else neutral.push(file);
  }
  const mixed = socle.length > 0 && application.length > 0;
  const mode = socle.length ? 'socle' : application.length ? 'application' : 'aucun';
  return { mode, ok: !mixed || transition, mixed, transition: mixed && transition, socle, application, neutral, apps: [...apps].sort() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const files = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
  const v = verdict(files, { transition: process.env.MODE_TRANSITION === '1' });
  const title = v.mode === 'socle' ? (v.transition ? 'Mode socle (transition : des déclarations passent aux applications)' : 'Mode socle')
    : v.mode === 'application' ? `Mode application (${v.apps.join(', ') || 'registre'})` : 'Aucun fichier du socle ni d’application';
  const list = (label, items) => (items.length ? `\n${label} (${items.length}) :\n${items.map((f) => '  - ' + f).join('\n')}` : '');
  const report = `${v.ok ? '✓' : '✗'} ${v.mixed && !v.transition ? 'PR mixte : elle touche le grand noyau ET une application autonome' : title}`
    + list('Grand noyau (socle)', v.socle) + list('Applications autonomes et fonctionnalités par section', v.application) + list('Sans mode', v.neutral)
    + (v.mode === 'socle' ? '\nMode socle : non-régression complète exigée (API, site, bout en bout, jeux d’essai), et la photo du contrat à jour si l’interface change.' : '')
    + (v.ok ? '' : '\n\nUne PR ne mêle jamais les deux modes : séparer la fondation du socle (PR à part, fusionnée d’abord) et l’application (PR suivante).');
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + report + '\n```\n');
  if (!v.ok) process.exit(1);
}
