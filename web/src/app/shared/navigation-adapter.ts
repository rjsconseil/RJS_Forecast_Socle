// Adaptateur du socle : le module Navigation ne dépend ni de BPM, ni de ce plan.
import { NavigationCatalog } from '../navigation/navigation.service';
import { NavigationEntry } from '../navigation/navigation-model';
import { PLAN_BANDS, PLAN_ZONES, locate, sectionEntry, zoneHomeLink } from './site-plan';
import { PAGE_WORKSPACES, matchWorkspace } from './page-workspaces';
const entries: NavigationEntry[] = [{ key: '/', label: 'Accueil', link: '/', module: '', level: 'section' }];
for (const band of PLAN_BANDS) entries.push({ key: 'anchor:portal:' + band.id, label: band.label, link: '/#portal-' + band.id, module: '', level: 'detail' });
for (const zone of PLAN_ZONES) {
  entries.push({ key: 'zone:' + zone.id, label: zone.label, link: zoneHomeLink(zone), module: zone.id, level: 'section' });
  for (const section of zone.sections) {
    entries.push({ key: `section:${zone.id}:${section.id}`, label: section.label, link: sectionEntry(zone, section).link, module: zone.id, level: 'section' });
    for (const page of section.pages) entries.push({ key: page.link, label: page.label, link: page.link, module: zone.id, level: 'page' });
  }
}
for (const view of PAGE_WORKSPACES) {
  const link = '/' + view.path;
  if (!entries.some(e => e.key === link)) entries.push({ key: link, label: view.label, link, module: locate(view.parent).zone?.id ?? '', level: 'detail' });
}
// Les fiches utilisent un modèle de page : le réglage vaut pour tous les objets de ce type.
for (const [link, label, module] of [
  ['/app/gestion-projet/:id', 'Fiche du projet BPM', 'bpm'],
  ['/argent/postes/:poste', 'Détail du poste', 'bpm'],
  ['/projects/:id', 'Fiche du projet noyau', 'noyau'],
  ['/projects/:id/edit', 'Modifier le projet noyau', 'noyau'],
  ['/tasks/:id/edit', 'Modifier la tâche noyau', 'noyau'],
  ['/admin/calculs/:key', 'Éditer une formule', 'administration'],
]) entries.push({ key: link, link, label, module, level: 'detail' });
const matchesTemplate = (template: string, path: string) => {
  const parts = path.split('/'); const pattern = template.split('/');
  return pattern.length === parts.length && pattern.every((part, i) => part.startsWith(':') || part === parts[i]);
};
export const SITE_NAVIGATION: NavigationCatalog = {
  entries, modules: PLAN_ZONES.map(z => ({ id: z.id, label: z.label })),
  context(url) {
    const path = url.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    const workspace = matchWorkspace(path);
    const at = locate(url);
    return { module: at.zone?.id, page: workspace ? '/' + workspace.workspace.path : entries.find(e => e.link.includes(':') && matchesTemplate(e.link, path))?.link ?? path };
  },
};
