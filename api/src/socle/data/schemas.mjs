// P5 · Données gérées — catalogue des schémas. Chaque module qui déclare des natures d'objets a son
// schéma ; le socle a le sien. Un schéma appartient à un espace de stockage : les données applicatives
// (niveau 3) ont chacune leur espace, séparé de l'espace « socle » qui porte les données techniques,
// le noyau et les middlewares. Le catalogue est dérivé du registre : rien n'est à tenir à la main.
export const CATEGORIES = { 0: 'technique', 1: 'noyau', 2: 'middleware', 3: 'application' };
export const SYSTEM_COLLECTIONS = ['creationRequests', 'parameters'];
export const SYSTEM_LISTS = ['journal', 'migrations'];
export const SOCLE_SPACE = 'socle';

export function buildCatalog(registry) {
  const schemas = [{
    name: 'technique.socle', category: 'technique', module: null, level: 0, space: SOCLE_SPACE,
    label: 'Socle : journal, paramètres, reçus de création, migrations', collections: [...SYSTEM_COLLECTIONS], lists: [...SYSTEM_LISTS],
  }];
  for (const mod of registry.modules.values()) {
    const collections = Object.values(mod.kinds ?? {}).map((kind) => kind.collection);
    if (!collections.length) continue;
    const category = CATEGORIES[mod.level];
    const name = `${category}.${mod.id}`;
    schemas.push({ name, category, module: mod.id, level: mod.level, label: mod.label, space: category === 'application' ? name : SOCLE_SPACE, collections, lists: [] });
  }
  const spaceByCollection = new Map(schemas.flatMap((schema) => [...schema.collections, ...schema.lists].map((c) => [c, schema.space])));
  return {
    schemas,
    spaces: [...new Set(schemas.map((schema) => schema.space))],
    collections: schemas.flatMap((schema) => schema.collections),
    /** L'espace de stockage d'une clé de l'état ; les métadonnées (révision, version) vivent dans l'espace socle. */
    spaceOf: (key) => spaceByCollection.get(key) ?? SOCLE_SPACE,
  };
}
