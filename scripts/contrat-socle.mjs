// Contrat figé du grand noyau (socle) : une photo de ce qu'il offre aux fonctionnalités par section et aux
// applications autonomes. Deux parties :
//   - l'interface côté site : chaque export de web/src/app/platform/grand-noyau.ts et du cadre BPM-Astra
//     (web/src/app/astra/cadre.ts), avec sa forme (propriétés, signatures), lue par le vérificateur TypeScript ;
//   - les routes de l'API : chaque « MÉTHODE /api/… » déclarée par un module ou par la couche HTTP.
// La photo est rangée dans api/test/contrat/ ; le test api/test/contrat-socle.test.mjs échoue dès qu'elle ne
// correspond plus au code. On ne la met à jour qu'en mode socle, dans une PR du socle :
//
//   npm run contrat            vérifie (comme le test)
//   npm run contrat -- --maj   réécrit la photo après une évolution voulue du socle
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

export const root = resolve(import.meta.dirname, '..');
export const SNAPSHOTS = { interface: join(root, 'api/test/contrat/interface-site.json'), routes: join(root, 'api/test/contrat/routes-api.json') };
const ENTRIES = { 'platform/grand-noyau.ts': 'Grand noyau', 'astra/cadre.ts': 'Cadre BPM-Astra' };

/** Forme de l'interface côté site : { fichier: { export: description } }. Exige les dépendances du site (typescript). */
export function siteInterface() {
  const require = createRequire(join(root, 'web/package.json'));
  const ts = require('typescript');
  const app = join(root, 'web/src/app');
  const files = Object.keys(ENTRIES).map((f) => join(app, f));
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true, skipLibCheck: true, experimentalDecorators: false, noEmit: true, baseUrl: join(root, 'web'),
  });
  const checker = program.getTypeChecker();
  const flags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.WriteArrowStyleSignature;
  const text = (type, node) => checker.typeToString(type, node, flags).replace(/import\("[^"]*"\)\./g, '');
  const members = (type, node) => checker.getPropertiesOfType(type)
    .filter((p) => !(ts.getDeclarationModifierFlagsFromSymbol(p) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) && !p.name.startsWith('#') && !p.name.startsWith('ɵ'))
    .map((p) => `${p.name}${p.flags & ts.SymbolFlags.Optional ? '?' : ''}: ${text(checker.getTypeOfSymbolAtLocation(p, node), node)}`)
    .sort();
  const out = {};
  for (const [rel, label] of Object.entries(ENTRIES)) {
    const source = program.getSourceFile(join(app, rel));
    const exports = {};
    for (const exported of checker.getExportsOfModule(checker.getSymbolAtLocation(source))) {
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const kinds = [];
      if (symbol.flags & ts.SymbolFlags.Class) {
        const type = checker.getTypeOfSymbolAtLocation(symbol, source);
        const instance = checker.getDeclaredTypeOfSymbol(symbol);
        kinds.push({ classe: members(instance, source), statique: members(type, source).filter((m) => !m.startsWith('prototype:')) });
      } else if (symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)) {
        const type = checker.getDeclaredTypeOfSymbol(symbol);
        const props = type.isUnion() || type.flags & ts.TypeFlags.Primitive || type.flags & ts.TypeFlags.Literal ? null : members(type, source);
        kinds.push(props?.length ? { type: props } : { type: text(type, source) });
      } else if (symbol.flags & (ts.SymbolFlags.Function | ts.SymbolFlags.Variable)) {
        kinds.push({ valeur: text(checker.getTypeOfSymbolAtLocation(symbol, source), source) });
      } else {
        kinds.push({ autre: ts.SymbolFlags[symbol.flags] ?? String(symbol.flags) });
      }
      exports[exported.name] = kinds.length === 1 ? kinds[0] : kinds;
    }
    out[`${label} (${rel})`] = Object.fromEntries(Object.entries(exports).sort(([a], [b]) => a.localeCompare(b)));
  }
  return out;
}

/** Routes de l'API : celles des modules (déclarées), puis celles de la couche HTTP (santé, flux, connexion). */
export async function apiRoutes() {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { createSocle } = await import('../api/src/socle/index.mjs');
  const { SOCLE_MODULES } = await import('../api/src/modules/index.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'socle-contrat-'));
  const socle = await createSocle({ dataFile: join(dir, 'store.json'), modules: SOCLE_MODULES });
  try {
    const routes = {};
    for (const m of socle.registry.modules.values()) {
      const list = socle.routesOf(m).map(([method, path]) => `${method} ${path}`);
      if (list.length) routes[m.id] = list.sort();
    }
    const http = readFileSync(join(root, 'api/src/http.mjs'), 'utf8');
    routes['couche HTTP'] = [
      ...[...http.matchAll(/req\.method === '(\w+)' && url\.pathname === '(\/api\/[^']+)'/g)].map((m) => `${m[1]} ${m[2]}`),
      ...[...http.matchAll(/case '(\w+ \/api\/[^']+)'/g)].map((m) => m[1]),
    ].filter((r, i, all) => all.indexOf(r) === i).sort();
    return routes;
  } finally {
    await socle.close();
    await rm(dir, { recursive: true, force: true });
  }
}

const json = (value) => JSON.stringify(value, null, 2) + '\n';
const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');

/** Écarts entre le code et la photo : liste lisible (vide si conforme). */
export function differences(name, current, saved) {
  if (!saved) return [`${name} : aucune photo (lancer npm run contrat -- --maj, en mode socle)`];
  const before = JSON.parse(saved);
  const out = [];
  for (const group of new Set([...Object.keys(before), ...Object.keys(current)])) {
    const a = before[group] ?? {}; const b = current[group] ?? {};
    if (Array.isArray(a) || Array.isArray(b)) {
      const A = new Set(a ?? []); const B = new Set(b ?? []);
      for (const x of B) if (!A.has(x)) out.push(`${group} : + ${x}`);
      for (const x of A) if (!B.has(x)) out.push(`${group} : − ${x}`);
      continue;
    }
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(key in a)) out.push(`${group} : + ${key}`);
      else if (!(key in b)) out.push(`${group} : − ${key}`);
      else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) out.push(`${group} : ${key} a changé de forme`);
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const update = process.argv.includes('--maj');
  const current = { interface: siteInterface(), routes: await apiRoutes() };
  if (update) {
    writeFileSync(SNAPSHOTS.interface, json(current.interface));
    writeFileSync(SNAPSHOTS.routes, json(current.routes));
    const n = Object.values(current.interface).reduce((s, g) => s + Object.keys(g).length, 0);
    const r = Object.values(current.routes).reduce((s, g) => s + g.length, 0);
    console.log(`✓ Photo du contrat réécrite : ${n} exports côté site, ${r} routes de l'API (api/test/contrat/). À faire en mode socle seulement.`);
  } else {
    const found = [...differences('Interface du site', current.interface, read(SNAPSHOTS.interface)), ...differences('Routes de l’API', current.routes, read(SNAPSHOTS.routes))];
    if (found.length) {
      console.error(`✗ Le contrat du grand noyau a changé (${found.length} écart(s)) :\n- ${found.join('\n- ')}\n\nSi c'est voulu, c'est une évolution du socle : PR en mode socle, puis npm run contrat -- --maj.`);
      process.exit(1);
    }
    console.log('✓ Contrat du grand noyau conforme à la photo (interface du site et routes de l’API).');
  }
}
