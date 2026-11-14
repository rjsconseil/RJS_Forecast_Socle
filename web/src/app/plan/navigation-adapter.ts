// Adaptateur du socle : le module Navigation ne dépend ni de BPM, ni de ce plan.
import { NavigationCatalog } from '../navigation/navigation.service';
import { NavigationEntry, NavigationNode } from '../navigation/navigation-model';
import { PLAN_BANDS, PLAN_ZONES, PlanPage, PlanZone, locate, portalBands, sectionEntry, zoneHomeLink } from './site-plan';
import { PAGE_WORKSPACES, matchWorkspace } from './page-workspaces';
import { bandKey, objectKey, PORTAL_KEY, sectionKey, zoneKey } from './plan-order';
import { TAB_LINKS, tabLinkKey, tabLinksKey, tabLinksOf } from './tab-links';
const entries: NavigationEntry[] = [{ key: PORTAL_KEY, label: 'Accueil', link: '/', module: '', level: 'section' }];
for (const band of PLAN_BANDS) entries.push({ key: bandKey(band.id), label: band.label, link: '/#portal-' + band.id, module: '', level: 'detail' });
for (const zone of PLAN_ZONES) {
  entries.push({ key: zoneKey(zone.id), label: zone.label, link: zoneHomeLink(zone), module: zone.id, level: 'section' });
  for (const section of zone.sections) {
    entries.push({ key: sectionKey(zone.id, section.id), label: section.label, link: sectionEntry(zone, section).link, module: zone.id, level: 'section' });
    for (const page of section.pages) entries.push({ key: page.link, label: page.label, link: page.link, module: zone.id, level: 'page' });
  }
}
for (const view of PAGE_WORKSPACES) {
  const link = '/' + view.path;
  if (!entries.some(e => e.key === link)) entries.push({ key: link, label: view.label, link, module: locate(view.parent).zone?.id ?? '', level: 'detail' });
}
// Les fiches utilisent un modèle de page : le réglage vaut pour tous les objets de ce type.
const TEMPLATES = [
  ['/app/gestion-projet/:id', 'Fiche du projet BPM', 'bpm'],
  ['/argent/postes/:poste', 'Détail du poste', 'bpm'],
  ['/projects/:id', 'Fiche du projet noyau', 'noyau'],
  ['/projects/:id/edit', 'Modifier le projet noyau', 'noyau'],
  ['/tasks/:id/edit', 'Modifier la tâche noyau', 'noyau'],
  ['/admin/calculs/:key', 'Éditer une formule', 'administration'],
];
for (const [link, label, module] of TEMPLATES) entries.push({ key: link, link, label, module, level: 'detail' });
// Les gestes d'un onglet : le niveau vertical du cadre supérieur.
for (const link of TAB_LINKS) entries.push({ key: tabLinkKey(link), link: tabLinkKey(link), label: link.label, module: locate(link.tab).zone?.id ?? '', level: 'detail' });
const matchesTemplate = (template: string, path: string) => {
  const parts = path.split('/'); const pattern = template.split('/');
  return pattern.length === parts.length && pattern.every((part, i) => part.startsWith(':') || part === parts[i]);
};

/**
 * L'arbre des liens, tel que le site les montre : l'accueil range ses liens dans la page (bandes → modules →
 * sections) ; chaque module range les siens dans le menu de gauche (sections → pages → sous-pages) puis dans
 * le cadre supérieur (onglets des sous-pages et des vues d'une fiche). La clé d'un nœud porte l'ordre de ses enfants.
 */
function pageNode(page: PlanPage, zone: PlanZone): NavigationNode {
  const views = PAGE_WORKSPACES.filter(view => view.parent === page.link);
  const gestures = (tab: string): NavigationNode[] => tabLinksOf(tab).map(link => ({ key: link.key, label: link.label, link: link.key, level: 'detail', surfaces: ['secondary'], role: 'Geste · liste verticale de l’onglet' }));
  const tab = (view: (typeof views)[number], object: boolean): NavigationNode => ({
    key: '/' + view.path, label: view.label, link: '/' + view.path, level: 'detail', children: gestures('/' + view.path),
    surfaces: object ? ['secondary'] : ['primary', 'secondary'], role: object ? 'Onglet de la fiche ouverte' : 'Sous-page et onglet',
  });
  const children = views.filter(view => !view.path.includes(':id') && view.menu !== false).map(view => tab(view, false));
  // Les vues ouvertes par un bouton ou un geste se nomment ici, mais n'ont pas de place dans le menu.
  for (const view of views.filter(entry => entry.menu === false)) children.push({ key: '/' + view.path, label: view.label, link: '/' + view.path, level: 'detail', surfaces: ['tertiary'], role: 'Hors menu · ouverte par un bouton ou un geste', fixed: true });
  const objectViews = views.filter(view => view.path.includes(':id')).map(view => tab(view, true));
  // Les modèles de fiche et de détail suivent leur page : ils se nomment, mais leur place vient de l'objet ouvert.
  for (const [link, label] of TEMPLATES) {
    if (locate(link.replace(/:\w+/g, 'x')).page?.link !== page.link || locate(link.replace(/:\w+/g, 'x')).zone?.id !== zone.id) continue;
    const isObject = link === objectKey(page.link);
    children.push({ key: link, label, link, level: 'detail', surfaces: ['tertiary'], role: isObject ? 'Fiche ouverte' : 'Détail du fil d’Ariane', fixed: true, children: isObject ? objectViews : undefined });
  }
  // La vue principale partage l'adresse de sa page : ses gestes se rangent sous un repère à part.
  if (gestures(page.link).length) children.unshift({ key: tabLinksKey(page.link, true), label: page.mainLabel ?? 'Vue principale', level: 'detail', surfaces: ['secondary'], role: 'Premier onglet · ses gestes', fixed: true, unlabeled: true, children: gestures(page.link) });
  return { key: page.link, label: page.label, link: page.link, level: 'page', surfaces: page.zoneOverview ? ['primary'] : ['primary', 'portal'], role: page.zoneOverview ? 'Accueil du module' : 'Page', children };
}
function zoneNode(zone: PlanZone): NavigationNode {
  return {
    key: zoneKey(zone.id), label: zone.label, link: zoneHomeLink(zone), level: 'section', surfaces: ['primary'], role: 'Module',
    children: zone.sections.map(section => ({
      key: sectionKey(zone.id, section.id), label: section.label, link: sectionEntry(zone, section).link, level: 'section' as const,
      surfaces: ['primary', 'portal'], role: section.audience === 'visitor' ? 'Section · visiteur seulement' : 'Section',
      children: section.pages.filter(page => !page.hidden).map(page => pageNode(page, zone)),
    })),
  };
}
const portal: NavigationNode = {
  key: PORTAL_KEY, label: 'Accueil', link: '/', level: 'section', surfaces: ['portal'], role: 'Liens rangés dans la page',
  children: portalBands(PLAN_ZONES).map(row => ({
    key: bandKey(row.band?.id ?? row.zones[0].id), label: row.band?.label ?? row.zones[0].label, link: row.band ? '/#portal-' + row.band.id : undefined,
    level: 'detail' as const, surfaces: ['portal'], role: 'Bande de l’accueil', fixed: !row.band,
    children: row.zones.map(zone => ({ key: zoneKey(zone.id), label: zone.label, link: zoneHomeLink(zone), level: 'section' as const, surfaces: ['portal'], role: 'Carte du module' })),
  })),
};
const tree: NavigationNode[] = [portal, ...PLAN_ZONES.map(zoneNode)];

export const SITE_NAVIGATION: NavigationCatalog = {
  entries, tree, modules: PLAN_ZONES.map(z => ({ id: z.id, label: z.label })),
  context(url) {
    const path = url.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    const workspace = matchWorkspace(path);
    const at = locate(url);
    return { module: at.zone?.id, page: workspace ? '/' + workspace.workspace.path : entries.find(e => e.link.includes(':') && matchesTemplate(e.link, path))?.link ?? path };
  },
};
