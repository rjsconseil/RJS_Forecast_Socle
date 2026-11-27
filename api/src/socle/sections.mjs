// Catalogue unique des sections du site (« cinq sections autonomes, un seul site », vision du 27/11/2026).
// Le code reste un seul site ; la section est une notion commune à la base, à l'API et au site :
// - la base range chaque collection dans la table préfixée de sa section (`engines/tables.mjs`) ;
// - le registre en déduit la section propriétaire de chaque nature d'objet (un fait, une section propriétaire) ;
// - le site lit le même catalogue (copie typée vérifiée par `web/src/app/platform/sections.spec.ts`).
import { readFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('./sections.json', import.meta.url), 'utf8'));

/** Les sections, dans l'ordre du site ; `systeme` (le socle commun) en dernier. */
export const SECTION_LIST = Object.freeze(catalog.sections.map((s) => Object.freeze({ ...s, collections: Object.freeze([...s.collections]) })));
/** Les neuf flux entre sections (la boucle du projet de vie). */
export const SECTION_FLOWS = Object.freeze(catalog.flows.map((f) => Object.freeze({ ...f })));
export const SYSTEM_SECTION = 'systeme';

const byKey = new Map(SECTION_LIST.map((s) => [s.key, s]));
const byCollection = new Map(SECTION_LIST.flatMap((s) => s.collections.map((c) => [c, s.key])));

export const sectionByKey = (key) => byKey.get(key) ?? null;
/** Section d'une collection ; une collection hors catalogue appartient au système. */
export const sectionOfCollection = (collection) => byCollection.get(collection) ?? SYSTEM_SECTION;
/** Collection rangée explicitement dans une section (et pas seulement par défaut au système). */
export const isCataloguedCollection = (collection) => byCollection.has(collection);

/** Vérifications de cohérence du catalogue, rejouées au chargement : clés, préfixes et collections uniques, flux entre sections connues. */
function validate() {
  const seen = (list, what) => {
    const dup = list.filter((x, i) => list.indexOf(x) !== i);
    if (dup.length) throw new Error(`Catalogue des sections : ${what} en double (${[...new Set(dup)].join(', ')}).`);
  };
  seen(SECTION_LIST.map((s) => s.key), 'clé');
  seen(SECTION_LIST.map((s) => s.prefix), 'préfixe');
  seen(SECTION_LIST.flatMap((s) => s.collections), 'collection');
  if (!byKey.has(SYSTEM_SECTION)) throw new Error('Catalogue des sections : la section système manque.');
  for (const f of SECTION_FLOWS) {
    if (!byKey.has(f.from) || !byKey.has(f.to) || f.from === SYSTEM_SECTION || f.to === SYSTEM_SECTION) throw new Error(`Catalogue des sections : flux ${f.n} entre sections inconnues.`);
  }
}
validate();
