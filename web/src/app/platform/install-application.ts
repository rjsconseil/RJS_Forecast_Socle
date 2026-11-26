import type { Routes } from '@angular/router';
/**
 * Contrôle et installation d'une déclaration d'application. `checkApplication` vérifie qu'une
 * déclaration est complète et n'entre en collision avec rien ; `installApplication` la branche dans
 * les catalogues de la plateforme (plan, sous-pages, actions, sections, fiches) et rend de quoi la
 * retirer. Au démarrage, les applications de `platform/applications.ts` sont assemblées par les
 * catalogues eux-mêmes ; l'installation sert aux essais et prouve qu'aucun autre fichier n'est à toucher.
 */
import { CONTENT_SECTION_CATALOG } from '../navigation/content-section-catalog';
import { auditNavigation, NavigationFinding } from '../navigation/navigation-engine';
import { applicationNavigation } from '../plan/application-navigation';
import { PAGE_WORKSPACES } from '../plan/page-workspaces';
import { PLAN_BANDS, PLAN_DETAILS, PLAN_OBJECTS, PLAN_ZONES } from '../plan/site-plan';
import { TAB_LINKS } from '../plan/tab-links';
import { ApplicationDeclaration, PLAN_ROOT } from './application';
import { APPLICATIONS } from './applications';

/** Les couleurs d'identité de section disponibles pour toute application (`styles/_bpm-application.scss`). */
export const SECTION_IDENTITY_TONES = ['nav-navy', 'nav-teal', 'nav-iris', 'nav-petrol', 'nav-cyan'];

const clean = (path: string) => path.replace(/^\//, '');

/** Les adresses qu'une déclaration sait servir : ses routes et ses sous-pages. */
export function applicationPaths(application: ApplicationDeclaration): string[] {
  function routePaths(routes: Routes, parent = ''): string[] {
    return routes.flatMap(route => {
      const path = [parent, route.path].filter(Boolean).join('/');
      return [path, ...routePaths(route.children ?? [], path)];
    });
  }
  return [
    ...new Set(routePaths(application.routes)),
    ...(application.workspaces ?? []).map((view) => view.path),
  ];
}

/** Les défauts d'une déclaration, en clair. Une liste vide : l'application peut être inscrite telle quelle. */
export function checkApplication(application: ApplicationDeclaration): string[] {
  const problems: string[] = [];
  const { zone } = application;
  const others = APPLICATIONS.filter((entry) => entry !== application && entry.id !== application.id);
  const pages = zone.sections.flatMap((section) => section.pages);
  const pageLinks = new Set(pages.map((page) => page.link));
  const views = application.workspaces ?? [];
  const destinations = new Set([...pageLinks, ...views.map((view) => '/' + view.path)]);
  const paths = new Set(applicationPaths(application));

  if (zone.id !== application.id) problems.push(`La zone s’appelle « ${zone.id} » mais l’application « ${application.id} ».`);
  if (!zone.numbered) problems.push('La zone d’une application doit être numérotée (`numbered: true`).');
  if (zone.home ? !pageLinks.has(zone.home) : !pages.some((page) => page.zoneOverview && page.link === `/${PLAN_ROOT}/${zone.id}`)) problems.push('L’application doit déclarer un accueil : une page de sa zone (`home`) ou une section « Vue d’ensemble » (`overviewSection`).');
  if (PLAN_ZONES.some((entry) => entry !== zone && entry.id === zone.id)) problems.push(`Une zone « ${zone.id} » existe déjà.`);
  if (new Set(zone.sections.map((section) => section.id)).size !== zone.sections.length) problems.push('Deux sections portent le même identifiant.');
  if (pageLinks.size !== pages.length) problems.push('Deux pages portent la même adresse.');
  if (!PLAN_BANDS.some((band) => band.id === zone.band) && application.band?.id !== zone.band) problems.push(`La bande d’accueil « ${zone.band} » n’existe pas : déclarez-la (\`band\`).`);

  for (const section of zone.sections) {
    if (!section.pages.length && !(section.hidden && section.redirectTo && pageLinks.has(section.redirectTo))) problems.push(`La section « ${section.label} » n’a aucune page.`);
    if (section.homePage && !section.pages.some(page => !page.hidden && page.link === section.homePage)) problems.push(`L’accueil de « ${section.label} » doit être une de ses pages visibles.`);
    if (!SECTION_IDENTITY_TONES.includes(section.tone) && !application.tones?.includes(section.tone)) problems.push(`La section « ${section.label} » utilise la couleur « ${section.tone} », absente des identités de section.`);
  }
  for (const page of pages) {
    if (page.zoneOverview) continue;
    if (!paths.has(clean(page.link))) problems.push(`La page « ${page.label} » (${page.link}) n’a pas de route.`);
  }
  for (const view of views) {
    if (!pageLinks.has(view.parent)) problems.push(`La sous-page « ${view.label} » dépend de ${view.parent}, qui n’est pas une page de l’application.`);
    if (!view.existing && !view.loadComponent) problems.push(`La sous-page « ${view.label} » n’a pas d’écran.`);
    if (view.existing && !application.routes.some((route) => route.path === view.path)) problems.push(`La sous-page « ${view.label} » se dit déjà routée, mais aucune route ne porte ${view.path}.`);
  }
  for (const action of application.actions ?? []) {
    if (!destinations.has(action.tab)) problems.push(`L’action « ${action.label} » est posée sur ${action.tab}, qui n’est ni une page ni une sous-page de l’application.`);
    if (action.link && !destinations.has(action.link)) problems.push(`L’action « ${action.label} » ouvre ${action.link}, hors de l’application.`);
  }
  for (const link of Object.keys(application.contentSections ?? {}))
    if (!destinations.has(link)) problems.push(`Des sections de contenu sont déclarées pour ${link}, qui n’est ni une page ni une sous-page de l’application.`);
  for (const detail of application.details ?? []) {
    if (!zone.sections.some((section) => section.id === detail.section)) problems.push(`Le détail « ${detail.label} » vise la section « ${detail.section} », inconnue.`);
    if (!pageLinks.has(detail.parent)) problems.push(`Le détail « ${detail.label} » dépend de ${detail.parent}, qui n’est pas une page de l’application.`);
  }
  for (const object of application.objects ?? []) {
    if (!pageLinks.has(object.home)) problems.push(`La fiche « ${object.kind} » s’ouvre depuis ${object.home}, qui n’est pas une page de l’application.`);
    const base = object.base ?? object.home;
    if (!paths.has(clean(base) + '/:id')) problems.push(`La fiche « ${object.kind} » n’a pas de route ${base}/:id.`);
  }

  // Aucune collision avec les autres applications ni avec la plateforme.
  const taken = new Set<string>();
  for (const other of others) for (const path of applicationPaths(other)) taken.add(path);
  for (const other of PLAN_ZONES) if (other !== zone && other.id !== zone.id) for (const section of other.sections) for (const page of section.pages) taken.add(clean(page.link));
  for (const view of PAGE_WORKSPACES) if (!views.includes(view)) taken.add(view.path);
  for (const path of paths) if (path && path !== '**' && taken.has(path)) problems.push(`L’adresse /${path} est déjà prise.`);
  return problems;
}

/** Les écarts aux règles du Navigation system (N2 à N9) d'une application installée. */
export function auditApplication(id: string): NavigationFinding[] {
  const navigation = applicationNavigation(id);
  return navigation ? auditNavigation(navigation) : [{ rule: 'N2', level: 'error', at: id, message: `Application « ${id} » introuvable.` }];
}

/**
 * Branche une application dans la plateforme et rend de quoi la retirer. Refuse une déclaration
 * incomplète ou en collision : rien n'est installé à moitié.
 */
export function installApplication(application: ApplicationDeclaration): () => void {
  const problems = checkApplication(application);
  if (problems.length) throw new Error(`Application « ${application.id} » refusée :\n- ${problems.join('\n- ')}`);
  const band = application.band && !PLAN_BANDS.some((entry) => entry.id === application.band!.id) ? application.band : null;
  const details = (application.details ?? []).map((detail) => ({ ...detail, zone: application.id }));
  const sections = Object.keys(application.contentSections ?? {});
  APPLICATIONS.push(application);
  PLAN_ZONES.push(application.zone);
  if (band) PLAN_BANDS.push(band);
  PAGE_WORKSPACES.push(...(application.workspaces ?? []));
  TAB_LINKS.push(...(application.actions ?? []));
  Object.assign(CONTENT_SECTION_CATALOG, application.contentSections ?? {});
  PLAN_DETAILS.unshift(...details);
  PLAN_OBJECTS.push(...(application.objects ?? []));
  const drop = <T>(list: T[], items: readonly T[]) => { for (const item of items) { const index = list.indexOf(item); if (index >= 0) list.splice(index, 1); } };
  return () => {
    drop(APPLICATIONS, [application]);
    drop(PLAN_ZONES, [application.zone]);
    if (band) drop(PLAN_BANDS, [band]);
    drop(PAGE_WORKSPACES, application.workspaces ?? []);
    drop(TAB_LINKS, application.actions ?? []);
    for (const link of sections) delete CONTENT_SECTION_CATALOG[link];
    drop(PLAN_DETAILS, details);
    drop(PLAN_OBJECTS, application.objects ?? []);
  };
}
