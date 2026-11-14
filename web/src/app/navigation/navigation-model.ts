export type NavigationSurface = 'primary' | 'secondary' | 'tertiary' | 'portal';
export type NavigationLevel = 'section' | 'page' | 'detail';
export interface NavigationStyle { size?: number; spacing?: number; color?: string; background?: string; activeColor?: string; activeBackground?: string }
export interface NavigationSettings {
  labels?: Record<string, string>;
  styles?: Partial<Record<NavigationSurface, Partial<Record<NavigationLevel, NavigationStyle>>>>;
}
export interface NavigationConfiguration { version: 1; scopes: Record<string, NavigationSettings>; order?: NavigationOrder }
export interface NavigationContext { module?: string; page: string }
export interface NavigationEntry { key: string; label: string; link: string; module: string; level: NavigationLevel }
export function scopeChain(context: NavigationContext): string[] {
  return ['site', ...(context.module ? ['module:' + context.module] : []), 'page:' + context.page];
}
export function effectiveStyle(config: NavigationConfiguration, context: NavigationContext, surface: NavigationSurface, level: NavigationLevel): NavigationStyle {
  return Object.assign({}, ...scopeChain(context).map(key => config.scopes[key]?.styles?.[surface]?.[level] ?? {}));
}
export function effectiveLabel(config: NavigationConfiguration, context: NavigationContext, key: string, fallback: string): string {
  return scopeChain(context).reduce((label, scope) => config.scopes[scope]?.labels?.[key] ?? label, fallback);
}

/** L'ordre des liens : pour chaque parent (clé du nœud), ses enfants dans l'ordre voulu. Vaut pour tout le site. */
export type NavigationOrder = Record<string, string[]>;
/**
 * Un nœud de l'arbre des liens, tel que le site le déclare : sa clé sert aux libellés et à l'ordre de ses enfants.
 * `fixed` : visible dans l'arbre, mais sa place ne se règle pas (modèle de fiche, détail du fil d'Ariane).
 */
export interface NavigationNode {
  key: string; label: string; link?: string; level: NavigationLevel;
  /** Les zones de navigation où le lien apparaît. */
  surfaces: NavigationSurface[];
  /** Précision affichée sous le libellé (« carte de module », « onglet de la fiche »…). */
  role?: string;
  fixed?: boolean;
  /** Repère de l'arbre sans libellé propre : il range seulement ses enfants. */
  unlabeled?: boolean;
  children?: NavigationNode[];
}
/** Range `items` selon `order` ; ce qui n'y figure pas garde sa place d'origine, à la suite. */
export function orderItems<T>(items: readonly T[], keyOf: (item: T) => string, order?: readonly string[]): T[] {
  if (!order?.length) return [...items];
  const rank = new Map(order.map((key, index) => [key, index]));
  return items.map((item, index) => ({ item, index }))
    .sort((a, b) => (rank.get(keyOf(a.item)) ?? order.length + a.index) - (rank.get(keyOf(b.item)) ?? order.length + b.index))
    .map(entry => entry.item);
}
/** Déplace l'élément de `from` vers `to` ; hors bornes ou sur place, la liste revient inchangée. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
/** Les enfants d'un nœud dans l'ordre réglé ; les liens fixes restent en fin de liste. */
export function orderedChildren(node: NavigationNode, order: NavigationOrder): NavigationNode[] {
  const children = node.children ?? [];
  return [...orderItems(children.filter(child => !child.fixed), child => child.key, order[node.key]), ...children.filter(child => child.fixed)];
}
/** L'ordre après déplacement d'un enfant ; revenu à l'ordre du plan, le réglage disparaît. */
export function reorder(order: NavigationOrder, node: NavigationNode, from: number, to: number): NavigationOrder {
  const movable = orderedChildren(node, order).filter(child => !child.fixed);
  const keys = moveItem(movable, from, to).map(child => child.key);
  const natural = (node.children ?? []).filter(child => !child.fixed).map(child => child.key);
  const next = { ...order };
  if (keys.join('\n') === natural.join('\n')) delete next[node.key];
  else next[node.key] = keys;
  return next;
}
/** Ne garde que les branches dont un lien correspond à la recherche, avec leurs parents. */
export function filterTree(nodes: readonly NavigationNode[], matches: (node: NavigationNode) => boolean): NavigationNode[] {
  return nodes.flatMap(node => {
    if (matches(node)) return [node];
    const children = filterTree(node.children ?? [], matches);
    return children.length ? [{ ...node, children }] : [];
  });
}
