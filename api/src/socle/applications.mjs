// Base commune des données des applications autonomes (27/11/2026, docs/ARCHITECTURE.md §20.2).
// Chaque application autonome déclare son modèle de données dans son propre dossier :
//   web/src/app/sections/<clé>/application/donnees.json   (application d'une section)
//   web/src/app/hybrides/<nom>/donnees.json                (application hybride)
// Le socle en tire les natures d'objets, les tables « AA_ » + préfixe de la section, le catalogue de référence
// (lignes communes à tous, en lecture seule) et les règles d'instanciation d'un projet en cours.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { declareApplicationCollection, sectionByKey, SYSTEM_SECTION } from './sections.mjs';
import { SYSTEM_COLLECTIONS, SYSTEM_LISTS } from './data/schemas.mjs';

const RESERVED = new Set([...SYSTEM_LISTS, ...SYSTEM_COLLECTIONS, 'schemaVersion']);

const ROOT = new URL('../../../web/src/app/', import.meta.url);
export const FIELD_TYPES = Object.freeze(['texte', 'nombre', 'entier', 'date', 'booleen', 'choix', 'liste', 'json']);
/** Champs communs acceptés sur toute ligne d'application (en plus des champs déclarés). */
export const COMMON_FIELDS = Object.freeze({ refCode: { type: 'texte' }, catalogue: { type: 'texte' } });

/** Les déclarations lues sur le disque (une par application qui en a une). */
export function readApplicationData(root = ROOT) {
  const files = [];
  const scan = (dir, sub) => {
    const base = new URL(`${dir}/`, root);
    if (!existsSync(base)) return;
    for (const e of readdirSync(base, { withFileTypes: true })) {
      const file = new URL(`${dir}/${e.name}/${sub}donnees.json`, root);
      if (e.isDirectory() && existsSync(file)) files.push(file);
    }
  };
  scan('sections', 'application/');
  scan('hybrides', '');
  return files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
}

const bad = (app, msg) => { throw new Error(`Données de l'application ${app} : ${msg}`); };

/** Vérifie et complète une déclaration ; range ses collections dans leur section. */
export function normalizeApplication(decl) {
  const app = decl?.application;
  if (typeof app !== 'string' || !/^[a-z][a-z0-9-]*$/.test(app)) bad(app, 'clé « application » invalide.');
  const sectionKey = decl.section ?? SYSTEM_SECTION;
  if (!sectionByKey(sectionKey)) bad(app, `section inconnue : ${sectionKey}.`);
  const collections = {};
  for (const [name, c] of Object.entries(decl.collections ?? {})) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(name)) bad(app, `nom de collection invalide : ${name}.`);
    if (RESERVED.has(name)) bad(app, `le nom de collection ${name} est réservé par le socle.`);
    if (typeof c.nature !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(c.nature)) bad(app, `nature invalide pour ${name}.`);
    if (typeof c.prefixe !== 'string' || !/^aa[a-z0-9]{2,10}$/.test(c.prefixe)) bad(app, `préfixe d'identifiant invalide pour ${name} (aa + 2 à 10 lettres ou chiffres).`);
    const champs = {};
    for (const [f, def] of Object.entries(c.champs ?? {})) {
      if (!FIELD_TYPES.includes(def?.type)) bad(app, `type inconnu pour ${name}.${f} : ${def?.type}.`);
      if (def.type === 'choix' && !(Array.isArray(def.valeurs) && def.valeurs.length)) bad(app, `${name}.${f} : un choix liste ses valeurs.`);
      champs[f] = { ...def };
    }
    const liens = {};
    for (const [f, l] of Object.entries(c.liens ?? {})) {
      if (typeof l?.nature !== 'string') bad(app, `lien ${name}.${f} sans nature.`);
      liens[f] = { nature: l.nature, obligatoire: Boolean(l.obligatoire) };
    }
    for (const f of c.unique ?? []) if (!(f in champs) && !(f in liens)) bad(app, `${name} : champ unique inconnu ${f}.`);
    collections[name] = { name, nature: c.nature, prefixe: c.prefixe, libelle: c.libelle ?? name, catalogue: Boolean(c.catalogue), champs, liens, unique: [...(c.unique ?? [])] };
  }
  const catalogue = { version: decl.catalogue?.version ?? null, lignes: decl.catalogue?.lignes ?? {} };
  for (const [name, rows] of Object.entries(catalogue.lignes)) {
    if (!collections[name]?.catalogue) bad(app, `lignes de catalogue pour ${name}, qui n'est pas une collection de catalogue.`);
    const codes = rows.map((r) => r.code);
    if (codes.some((x) => typeof x !== 'string' || !x)) bad(app, `chaque ligne de ${name} a un code.`);
    if (new Set(codes).size !== codes.length) bad(app, `codes en double dans ${name}.`);
  }
  const regles = decl.regles ?? null;
  if (regles && !collections[regles]?.catalogue) bad(app, `les règles d'instanciation (${regles}) doivent être une collection de catalogue.`);
  for (const name of Object.keys(collections)) declareApplicationCollection(name, sectionKey);
  return { application: app, section: sectionKey, libelle: decl.libelle ?? app, collections, catalogue, regles };
}

/**
 * Remplit les catalogues de référence (partition système) depuis les déclarations : ajoute les lignes nouvelles,
 * met à jour celles qui ont changé. Rejoué à chaque démarrage ; sans changement, rien n'est écrit.
 */
export async function syncCatalogues(socle) {
  const mod = socle.registry.modules.get('applications');
  if (!mod?.applications?.some((a) => Object.keys(a.catalogue.lignes).length)) return null;
  return socle.store.mutate((draft) => {
    const now = new Date().toISOString();
    const tx = { draft, command: 'aa.catalogue.sync', now, created: [], updated: [], unchanged: false, userId: null, requestKey: null };
    for (const a of mod.applications) {
      for (const [name, rows] of Object.entries(a.catalogue.lignes)) {
        const c = a.collections[name];
        const existing = new Map(socle.om.list(draft, c.nature, (r) => !r.userId).map((r) => [r.code, r]));
        for (const line of rows) {
          const fields = { application: a.application, catalogue: a.catalogue.version, ...structuredClone(line) };
          const old = existing.get(line.code);
          if (!old) socle.om.create(tx, c.nature, fields, { userId: null });
          else if (Object.entries(fields).some(([k, v]) => JSON.stringify(old[k]) !== JSON.stringify(v))) socle.om.update(tx, old, fields);
        }
      }
    }
    if (!tx.created.length && !tx.updated.length) return { unchanged: true, value: { created: 0, updated: 0 } };
    draft.journal.push({ at: now, command: tx.command, userId: null, requestKey: null, created: tx.created.map((x) => x.id), updated: [...new Set(tx.updated.map((u) => u.id))], outcome: 'committed' });
    return { value: { created: tx.created.length, updated: tx.updated.length } };
  }, { partition: '' });
}
