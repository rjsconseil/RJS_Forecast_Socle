/**
 * Accès rapides : toutes les destinations, les liens de contexte et les actions sont **dérivés du plan
 * du site** (`site-plan.ts`, `page-workspaces.ts`). Aucune page n'est déclarée ici une seconde fois ;
 * la palette de commandes, les épingles et le pied « Poursuivre » lisent ce seul modèle.
 *
 * Un lien de contexte emporte la lecture en cours (période, filtres) selon la même règle que les
 * onglets du bandeau (`workspaceContextQuery`) : jamais une saisie ouverte.
 */
import { PAGE_WORKSPACES } from './page-workspaces';
import { workspaceContextQuery } from './page-workspace';
import {
  hasSectionHome,
  locate,
  menuPages,
  OBJECT_FALLBACK,
  planContext,
  PLAN_ZONES,
  PlanLocation,
  PlanZone,
  sectionHomeLink,
  zoneHomeLink,
  zoneSections,
} from './site-plan';

export type QuickGroup = 'context' | 'action' | 'pinned' | 'recent' | 'site';
export type QuickKind = 'up' | 'view' | 'sibling' | 'zone' | 'section' | 'page' | 'subpage' | 'action' | 'pinned' | 'recent';

export interface QuickLink {
  id: string;
  group: QuickGroup;
  kind: QuickKind;
  label: string;
  /** Où mène le lien, ou ce qu'il fait : « Zone › Section ». */
  hint: string;
  link: string;
  query?: Record<string, string> | null;
  /** Sigle ou symbole du plan affiché devant le libellé. */
  mark: string;
  tone?: string;
  /** Identifiant de la zone de destination : classe les résultats proches du contexte en premier. */
  zone?: string;
  /** Clé du Navigation system : le libellé personnalisé s'applique aussi ici. */
  navigationKey?: string;
  /** Texte cherchable en plus du libellé (description du plan). */
  keywords?: string;
  /** Étape du parcours à rejoindre (liens récents). */
  journeyIndex?: number;
  /** La lecture en cours (période, filtres) accompagne le lien. */
  carries?: boolean;
}

export const QUICK_GROUP_LABELS: Record<QuickGroup, string> = {
  context: 'Dans ce contexte',
  action: 'Actions',
  pinned: 'Épinglés',
  recent: 'Récents',
  site: 'Tout le site',
};

const cleanPath = (url: string) => url.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
const carried = (query: Record<string, string>) => (Object.keys(query).length ? query : null);

/** Toutes les destinations du plan ouvertes à ce public : zones, accueils de section, pages et sous-pages. */
export function siteDestinations(connected: boolean): QuickLink[] {
  const links: QuickLink[] = [];
  const seen = new Set<string>();
  const add = (link: QuickLink) => {
    if (seen.has(link.link)) return;
    seen.add(link.link);
    links.push(link);
  };
  for (const zone of PLAN_ZONES) {
    add({
      id: 'zone:' + zone.id, group: 'site', kind: 'zone', label: zone.label, hint: zone.eyebrow, link: zoneHomeLink(zone),
      mark: zone.acronym, tone: zone.tone, zone: zone.id, navigationKey: 'zone:' + zone.id, keywords: zone.mission,
    });
    for (const section of zoneSections(zone, connected)) {
      if (hasSectionHome(section))
        add({
          id: `section:${zone.id}:${section.id}`, group: 'site', kind: 'section', label: section.label, hint: `${zone.label} › Accueil de section`,
          link: sectionHomeLink(zone, section), mark: section.acronym, tone: section.tone, zone: zone.id,
          navigationKey: `section:${zone.id}:${section.id}`, keywords: `${section.intention} ${section.description}`,
        });
      for (const page of menuPages(section)) {
        if (page.zoneOverview) continue;
        add({
          id: 'page:' + page.link, group: 'site', kind: 'page', label: page.label,
          hint: page.label === section.label ? zone.label : `${zone.label} › ${section.label}`,
          link: page.link, mark: page.symbol, tone: page.tone ?? section.tone, zone: zone.id, navigationKey: page.link,
          keywords: `${page.description} ${page.result} ${page.mainLabel ?? ''}`,
        });
      }
    }
  }
  for (const view of PAGE_WORKSPACES) {
    if (view.path.includes(':')) continue;
    const owner = locate(view.parent);
    if (!owner.zone || !owner.section || !owner.page) continue;
    if (!zoneSections(owner.zone, connected).includes(owner.section)) continue;
    add({
      id: 'view:' + view.key + ':' + view.path, group: 'site', kind: 'subpage', label: view.label,
      hint: `${owner.zone.label} › ${owner.page.label}`, link: '/' + view.path, mark: '↳',
      tone: owner.page.tone ?? owner.section.tone, zone: owner.zone.id, navigationKey: '/' + view.path, keywords: view.lead,
    });
  }
  return links;
}

/**
 * Les liens proches de l'adresse courante : le niveau supérieur, les autres vues de la page (ou de la
 * fiche ouverte) et les pages voisines de la section. Ils gardent la période et les filtres de lecture.
 */
export function contextLinks(url: string, objectLabel: string | null = null): QuickLink[] {
  const context = planContext(url, objectLabel);
  const { zone, section, page, object } = context.location;
  if (!zone) return [];
  const path = cleanPath(url);
  const links: QuickLink[] = [];
  const tone = page?.tone ?? section?.tone ?? zone.tone;
  if (context.up) {
    const query = workspaceContextQuery(url, context.up.link);
    links.push({
      id: 'up:' + context.up.link, group: 'context', kind: 'up', label: context.up.label, hint: 'Niveau supérieur', link: context.up.link,
      query: carried(query), carries: !!carried(query), mark: '↑', tone, zone: zone.id, navigationKey: context.up.link,
    });
  }
  const owner = object ? objectLabel || OBJECT_FALLBACK : page?.label;
  for (const tab of context.tabs) {
    if (tab.current) continue;
    const query = workspaceContextQuery(url, tab.link);
    links.push({
      id: 'view:' + tab.link, group: 'context', kind: 'view', label: tab.label, hint: owner ? `Vue de « ${owner} »` : 'Autre vue de cette page',
      link: tab.link, query: carried(query), carries: !!carried(query), mark: '◧', tone, zone: zone.id, navigationKey: tab.link,
    });
  }
  if (section && page) {
    const pages = menuPages(section).filter((entry) => !entry.zoneOverview);
    const index = pages.findIndex((entry) => entry.link === page.link);
    const neighbour = (offset: number, hint: string, mark: string) => {
      const target = index < 0 ? undefined : pages[index + offset];
      if (!target || target.link === path) return;
      const query = workspaceContextQuery(url);
      links.push({
        id: 'sibling:' + target.link, group: 'context', kind: 'sibling', label: target.label, hint, link: target.link,
        query: carried(query), carries: !!carried(query), mark, tone: target.tone ?? section.tone, zone: zone.id, navigationKey: target.link,
      });
    };
    neighbour(-1, `Page précédente · ${section.label}`, '←');
    neighbour(1, `Page suivante · ${section.label}`, '→');
  }
  return links;
}

/** Les pages qui savent ouvrir la saisie d'une opération avec son sens (`?entry=new&entryDirection=…`). */
const ENTRY_HOSTS = ['/tableau-de-bord', '/projet-de-vie', '/piloter/agir'];
const entryHost = (path: string) => ENTRY_HOSTS.find((host) => path === host) ?? '/tableau-de-bord';

const actionRank = (at: PlanLocation, parent: string) => {
  const owner = locate(parent);
  if (at.page && owner.page?.link === at.page.link) return 0;
  if (at.section && owner.section?.id === at.section.id && owner.zone?.id === at.zone?.id) return 1;
  return 2;
};

/**
 * Les actions utiles là où l'on se trouve. Les créations viennent du catalogue des sous-pages
 * (« Créer … ») de la zone courante, celles de la page affichée d'abord ; l'application BPM ajoute la
 * saisie d'une entrée ou d'une dépense, sur la période lue ; une fiche ouverte ajoute ses raccourcis.
 */
export function contextActions(url: string, connected: boolean, objectLabel: string | null = null): QuickLink[] {
  const at = locate(url);
  const zone = at.zone;
  if (!zone) return [];
  const path = cleanPath(url);
  const reading = workspaceContextQuery(url);
  const actions: QuickLink[] = [];
  const tone = at.page?.tone ?? at.section?.tone ?? zone.tone;
  if (zone.id === 'bpm' && connected) {
    const host = entryHost(path);
    for (const [direction, label] of [['income', 'Saisir une entrée'], ['charge', 'Saisir une dépense']] as const)
      actions.push({
        id: 'entry:' + direction, group: 'action', kind: 'action', label, link: host, mark: '＋', tone, zone: zone.id,
        hint: reading['period'] || reading['lifePeriod'] ? 'Sur la période affichée' : host === path ? 'Sur cette page' : 'Depuis le tableau de bord',
        query: { ...reading, entry: 'new', entryDirection: direction }, carries: !!carried(reading), keywords: 'opération revenu charge ajouter nouveau',
      });
    if (at.object) {
      const name = objectLabel || OBJECT_FALLBACK;
      actions.push({
        id: 'object-tasks:' + at.object.id, group: 'action', kind: 'action', label: `Voir les tâches de « ${name} » dans le tableau`, hint: 'Tâches des projets, filtrées sur ce projet',
        link: '/app/taches', query: { ...reading, project: at.object.id }, carries: true, mark: '☑', tone, zone: zone.id,
      });
    }
    if (!path.startsWith('/vision'))
      actions.push({ id: 'goal:new', group: 'action', kind: 'action', label: 'Créer un objectif daté', hint: 'Objectifs et avenir', link: '/vision', query: { goal: 'new' }, mark: '＋', tone, zone: zone.id });
  }
  const creations = PAGE_WORKSPACES
    .filter((view) => !view.path.includes(':') && /^Créer\b/.test(view.label))
    .map((view) => ({ view, owner: locate(view.parent) }))
    .filter(({ owner }) => owner.zone?.id === zone.id && !!owner.section && zoneSections(zone, connected).includes(owner.section))
    .sort((a, b) => actionRank(at, a.view.parent) - actionRank(at, b.view.parent));
  for (const { view, owner } of creations) {
    if ('/' + view.path === path) continue;
    actions.push({
      id: 'create:' + view.path, group: 'action', kind: 'action', label: view.label, hint: owner.page?.label ?? zone.label, link: '/' + view.path,
      mark: '＋', tone: owner.page?.tone ?? tone, zone: zone.id, navigationKey: '/' + view.path, keywords: view.lead + ' nouveau ajouter',
    });
  }
  const coreProject = /^\/projects\/([^/]+)$/.exec(path)?.[1];
  if (coreProject && coreProject !== 'new' && coreProject !== 'planning')
    actions.push({ id: 'edit:' + path, group: 'action', kind: 'action', label: 'Modifier ce projet', hint: objectLabel || 'Fiche du projet', link: `${path}/edit`, mark: '✎', tone, zone: zone.id });
  return actions;
}

/** Recherche sans accents ni casse : chaque mot saisi doit se retrouver dans le lien. */
export const normalizeSearch = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').toLocaleLowerCase('fr').trim();

function score(link: QuickLink, words: string[], zone: string | null): number {
  const label = normalizeSearch(link.label);
  const hint = normalizeSearch(link.hint);
  const more = normalizeSearch(link.keywords ?? '');
  let total = 0;
  for (const word of words) {
    if (label.startsWith(word)) total += 100;
    else if (label.split(/[\s/·-]+/).some((part) => part.startsWith(word))) total += 70;
    else if (label.includes(word)) total += 45;
    else if (hint.includes(word)) total += 25;
    else if (more.includes(word)) total += 10;
    else return 0;
  }
  if (zone && link.zone === zone) total += 12;
  if (link.group === 'context') total += 8;
  if (link.group === 'action' || link.group === 'pinned') total += 4;
  return total;
}

/**
 * Filtre et classe des liens : le libellé d'abord, puis l'emplacement, puis la description. À score
 * égal, la zone où l'on se trouve passe devant. Sans texte, la liste revient telle quelle.
 */
export function searchLinks(links: QuickLink[], text: string, zone: string | null = null): QuickLink[] {
  const words = normalizeSearch(text).split(/\s+/).filter(Boolean);
  if (!words.length) return links;
  return links
    .map((link, order) => ({ link, order, value: score(link, words, zone) }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value || a.order - b.order)
    .map((entry) => entry.link);
}

/** Une même adresse n'apparaît qu'une fois : le groupe le plus proche du contexte la garde. */
export function uniqueLinks(links: QuickLink[]): QuickLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = link.kind === 'action' ? 'action:' + link.id : cleanPath(link.link);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** La zone d'une adresse, pour décider si la période lue a un sens à l'arrivée. */
export const zoneOf = (url: string): PlanZone | null => locate(url).zone;
