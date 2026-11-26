/**
 * Navigation system v2 · moteur commun aux modules applicatifs (BPM et les suivants).
 *
 * Un module applicatif décrit sa navigation en quatre niveaux, et rien d'autre :
 *   Section → Page → Sous-page → Section de sous-page.
 * Le cadre (menu latéral, onglets, listes verticales, titre de section) se dérive de cette
 * description. Ce fichier ne dépend d'aucun module : un module la produit par son adaptateur
 * (BPM : `plan/application-navigation.ts`), puis le moteur la contrôle et la parcourt.
 */

/** Une action de l'accueil d'une page : elle ouvre un formulaire (paramètre) ou une destination. */
export interface AppNavigationAction {
  key: string;
  label: string;
  link: string;
  query: Record<string, string>;
}
/** Une section de sous-page : une ancre de contenu, jamais une commande. */
export interface AppNavigationAnchor {
  id: string;
  label: string;
}
export interface AppNavigationSubpage {
  link: string;
  label: string;
  /** La première sous-page est l'accueil de la page : elle partage son adresse et porte ses actions. */
  home: boolean;
  actions: AppNavigationAction[];
  anchors: AppNavigationAnchor[];
}
export interface AppNavigationPage {
  link: string;
  label: string;
  step?: string;
  subpages: AppNavigationSubpage[];
}
export interface AppNavigationSection {
  id: string;
  /** Repère affiché (01, 02… dans un module numéroté). */
  mark: string;
  label: string;
  tone: string;
  pages: AppNavigationPage[];
}
export interface AppNavigation {
  module: string;
  label: string;
  sections: AppNavigationSection[];
}

export type NavigationRule = 'N2' | 'N3' | 'N4' | 'N5' | 'N6' | 'N9';
export interface NavigationFinding {
  rule: NavigationRule;
  level: 'error' | 'warning';
  /** L'adresse ou la clé concernée. */
  at: string;
  message: string;
}

/** Les règles que le moteur garantit, dans les mots de l'interface. */
export const NAVIGATION_RULES: Record<NavigationRule, string> = {
  N2: 'Chaque section a au moins une page ; la première est son accueil.',
  N3: 'Chaque page commence par sa sous-page d’accueil, à la même adresse.',
  N4: 'La sous-page d’accueil porte les actions de la page.',
  N5: 'Les autres sous-pages déclarent leurs sections de contenu.',
  N6: 'Une section de contenu est une ancre unique dans sa sous-page.',
  N9: 'Une vue, une adresse : aucune sous-page n’en partage une autre.',
};

/** Contrôle une navigation applicative ; une liste vide veut dire « d'équerre ». */
export function auditNavigation(navigation: AppNavigation): NavigationFinding[] {
  const findings: NavigationFinding[] = [];
  const seen = new Map<string, string>();
  const add = (rule: NavigationRule, level: NavigationFinding['level'], at: string, message: string) =>
    findings.push({ rule, level, at, message });
  for (const section of navigation.sections) {
    if (!section.pages.length) add('N2', 'error', section.id, `${section.label} : aucune page.`);
    for (const page of section.pages) {
      const [home, ...others] = page.subpages;
      if (!home || !home.home || home.link !== page.link)
        add('N3', 'error', page.link, `${page.label} : la première sous-page doit être son accueil, à la même adresse.`);
      if (home && !home.actions.length)
        add('N4', 'warning', page.link, `${page.label} : l’accueil « ${home.label} » ne porte aucune action.`);
      for (const subpage of others) {
        if (!subpage.anchors.length)
          add('N5', 'warning', subpage.link, `${page.label} › ${subpage.label} : aucune section de contenu déclarée.`);
      }
      for (const subpage of page.subpages) {
        const owner = seen.get(subpage.link);
        if (owner) add('N9', 'error', subpage.link, `${subpage.label} partage l’adresse de ${owner}.`);
        seen.set(subpage.link, subpage.label);
        const ids = subpage.anchors.map((anchor) => anchor.id);
        if (new Set(ids).size !== ids.length)
          add('N6', 'error', subpage.link, `${subpage.label} : deux sections portent la même ancre.`);
      }
    }
  }
  return findings;
}

/** Les sous-pages dans l'ordre de lecture du module : la boucle section → page → sous-page. */
export function navigationLoop(navigation: AppNavigation): { section: AppNavigationSection; page: AppNavigationPage; subpage: AppNavigationSubpage }[] {
  return navigation.sections.flatMap((section) =>
    section.pages.flatMap((page) => page.subpages.map((subpage) => ({ section, page, subpage }))),
  );
}

/** Le repère d'un rang dans une liste numérotée : 01, 02… */
export const navigationNumber = (index: number) => String(index + 1).padStart(2, '0');
