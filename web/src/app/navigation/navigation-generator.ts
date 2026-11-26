import {
  NavigationConfiguration,
  NavigationNode,
  NavigationSurface,
  orderItems,
} from './navigation-model';

export type NavigationKind =
  'module' | 'section' | 'page' | 'subpage' | 'action' | 'content' | 'auxiliary';
export interface GeneratedNavigationNode extends NavigationNode {
  kind: NavigationKind;
  parent: string | null;
  children: GeneratedNavigationNode[];
  home?: string;
}
export interface GeneratedNavigation {
  root: GeneratedNavigationNode;
  nodes: Map<string, GeneratedNavigationNode>;
  errors: string[];
}

export function navigationKind(node: NavigationNode): NavigationKind {
  if (node.key.startsWith('zone:')) return 'module';
  if (node.level === 'section') return 'section';
  if (node.level === 'page') return 'page';
  if (node.level === 'content') return 'content';
  if (node.surfaces.includes('actions')) return 'action';
  return node.fixed && !node.key.endsWith('#main') ? 'auxiliary' : 'subpage';
}

export function acceptsNavigationChild(parent: NavigationKind, child: NavigationKind): boolean {
  return (
    {
      module: ['section'],
      section: ['page'],
      page: ['subpage', 'auxiliary'],
      subpage: ['content', 'action'],
      auxiliary: ['subpage', 'content', 'action'],
      action: [],
      content: [],
    } as Record<NavigationKind, NavigationKind[]>
  )[parent].includes(child);
}

/** Reconstruit une zone entière depuis le catalogue, les relations et l’ordre du brouillon. */
export function generateNavigation(
  source: NavigationNode,
  configuration: NavigationConfiguration,
): GeneratedNavigation {
  const nodes = new Map<string, GeneratedNavigationNode>();
  const naturalParents = new Map<string, string | null>();
  const errors: string[] = [];
  const collect = (node: NavigationNode, parent: string | null) => {
    if (nodes.has(node.key)) {
      errors.push('Lien déclaré plusieurs fois : ' + node.key);
      return;
    }
    nodes.set(node.key, {
      ...node,
      surfaces: [...new Set([...node.surfaces, 'tertiary' as const])],
      kind: navigationKind(node),
      parent,
      children: [],
    });
    naturalParents.set(node.key, parent);
    for (const child of node.children ?? []) collect(child, node.key);
  };
  collect(source, null);
  const relations = configuration.relations?.[source.key] ?? {};
  for (const [key, relation] of Object.entries(relations)) {
    const node = nodes.get(key);
    if (!node) {
      errors.push('Lien inconnu : ' + key);
      continue;
    }
    if (relation.parent !== undefined) {
      const parent = nodes.get(relation.parent);
      if (!parent || !acceptsNavigationChild(parent.kind, node.kind)) {
        errors.push('Rattachement incompatible pour ' + node.label);
      } else node.parent = parent.key;
    }
    if (relation.surfaces !== undefined) node.surfaces = [...relation.surfaces];
  }
  // Les modèles de fiche peuvent contenir des sous-pages : contrôle explicite des cycles.
  for (const node of nodes.values()) {
    const seen = new Set([node.key]);
    let parent = node.parent;
    while (parent) {
      if (seen.has(parent)) {
        errors.push('Cycle de navigation autour de ' + node.label);
        node.parent = naturalParents.get(node.key) ?? null;
        break;
      }
      seen.add(parent);
      parent = nodes.get(parent)?.parent ?? null;
    }
  }
  for (const node of nodes.values()) if (node.parent) nodes.get(node.parent)?.children.push(node);
  for (const node of nodes.values()) {
    node.children = orderItems(
      node.children,
      (child) => child.key,
      configuration.order?.[node.key],
    );
    const candidates = node.children.filter((child) =>
      node.kind === 'module'
        ? child.kind === 'section'
        : node.kind === 'section'
          ? child.kind === 'page'
          : node.kind === 'page' || node.kind === 'auxiliary'
            ? child.kind === 'subpage'
            : false,
    );
    const requested = relations[node.key]?.home;
    if (requested && !candidates.some((child) => child.key === requested)) {
      errors.push('Accueil invalide pour ' + node.label + ' : choisissez un enfant direct.');
    }
    node.home =
      candidates.find((child) => child.key === requested)?.key ??
      candidates.find((child) => child.key === node.defaultHome)?.key ??
      candidates.find((child) => child.key.endsWith('#main'))?.key ??
      candidates[0]?.key;
    if (node.home)
      node.children.sort((a, b) => Number(b.key === node.home) - Number(a.key === node.home));
  }
  return { root: nodes.get(source.key)!, nodes, errors: [...new Set(errors)] };
}

export function navigationAncestors(
  graph: GeneratedNavigation,
  key: string,
): GeneratedNavigationNode[] {
  const result: GeneratedNavigationNode[] = [];
  let node = graph.nodes.get(key);
  while (node) {
    result.unshift(node);
    node = node.parent ? graph.nodes.get(node.parent) : undefined;
  }
  return result;
}

export function navigationDestination(
  graph: GeneratedNavigation,
  key: string,
): GeneratedNavigationNode {
  let node = graph.nodes.get(key) ?? graph.root;
  while (node.home) node = graph.nodes.get(node.home)!;
  return node;
}

export const NAVIGATION_SURFACES: NavigationSurface[] = [
  'primary',
  'secondary',
  'tertiary',
  'portal',
  'actions',
  'contents',
];
