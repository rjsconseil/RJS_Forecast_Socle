/**
 * Adaptateur du plan vers le moteur du Navigation system : la navigation d'un module applicatif
 * (zone numérotée, comme BPM) projetée en Section → Page → Sous-page → Section de sous-page.
 * Un nouveau module applicatif se déclare dans le plan (zone `numbered`, pages, `PAGE_WORKSPACES`,
 * `TAB_LINKS`, `CONTENT_SECTION_CATALOG`) et hérite de tout le cadre sans code de navigation propre.
 */
import { CONTENT_SECTION_CATALOG } from '../navigation/content-section-catalog';
import { AppNavigation, AppNavigationSubpage } from '../navigation/navigation-engine';
import { PLAN_ZONES, PlanPage, menuPages, pageChildren, planZone, sectionMark, zoneSections } from './site-plan';
import { tabLinksOf } from './tab-links';

const anchorsOf = (link: string) => (CONTENT_SECTION_CATALOG[link] ?? []).map(({ id, label }) => ({ id, label }));

function subpagesOf(page: PlanPage): AppNavigationSubpage[] {
  const home: AppNavigationSubpage = {
    link: page.link,
    label: page.mainLabel ?? page.label,
    home: true,
    actions: tabLinksOf(page.link).map((action) => ({ key: action.key, label: action.label, link: action.link ?? page.link, query: action.query })),
    anchors: anchorsOf(page.link),
  };
  const others = pageChildren(page)
    .filter((child) => (child.depth ?? 1) === 1 && child.id !== 'object' && child.id !== 'current-detail')
    .map((child) => ({ link: child.link, label: child.label, home: false, actions: [], anchors: anchorsOf(child.link) }));
  return [home, ...others];
}

/** La navigation complète d'un module applicatif, pour un public connecté ou visiteur. */
export function applicationNavigation(zoneId: string, connected = true): AppNavigation | null {
  const zone = planZone(zoneId);
  if (!zone) return null;
  const visible = zoneSections(zone, connected);
  return {
    module: zone.id,
    label: zone.label,
    sections: visible.map((section) => ({
      id: section.id,
      mark: sectionMark(zone, section, visible),
      label: section.label,
      tone: section.tone,
      pages: menuPages(section).map((page) => ({ link: page.link, label: page.label, step: page.step, subpages: subpagesOf(page) })),
    })),
  };
}

/** Les modules applicatifs du site : les zones dont les sections sont numérotées. */
export const applicationModules = () => PLAN_ZONES.filter((zone) => zone.numbered).map((zone) => zone.id);
