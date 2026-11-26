// Index mémorisés par version de partition (montée en charge, niveau 2 et au-dessus).
// Une vue publiée est gelée et remplacée dès que sa partition change : un calcul fait sur une collection gelée reste
// donc juste tant que cette collection est la même. Les index (objets d'une collection rangés par la valeur d'un champ)
// et les calculs coûteux sont mémorisés contre l'objet collection lui-même ; ils disparaissent avec lui. Sur un
// brouillon de transaction (non gelé), rien n'est mémorisé : le calcul est refait à chaque appel.
const CACHE = new WeakMap();

/** Calcul mémorisé pour une collection gelée (même collection → même résultat), refait sur un brouillon. */
export function memo(collection, name, compute) {
  if (!collection || typeof collection !== 'object' || !Object.isFrozen(collection)) return compute(collection ?? {});
  let entries = CACHE.get(collection);
  if (!entries) CACHE.set(collection, (entries = new Map()));
  if (!entries.has(name)) entries.set(name, compute(collection));
  return entries.get(name);
}

/** Les objets d'une collection rangés par la valeur d'un champ, dans l'ordre de la collection. */
export function indexBy(collection, field) {
  return memo(collection, `by:${field}`, (c) => {
    const index = new Map();
    for (const o of Object.values(c)) {
      const key = o?.[field];
      const list = index.get(key);
      if (list) list.push(o); else index.set(key, [o]);
    }
    return index;
  });
}

/** Les objets dont `field` vaut `value` (liste vide sinon), dans l'ordre de la collection. */
export const objectsWith = (collection, field, value) => indexBy(collection, field).get(value) ?? [];

/** Rang de chaque objet dans sa collection (pour réunir plusieurs listes d'index dans l'ordre d'origine). */
export const positions = (collection) => memo(collection, 'positions', (c) => new Map(Object.keys(c).map((id, i) => [id, i])));
