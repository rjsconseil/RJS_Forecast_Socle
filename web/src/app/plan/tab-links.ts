/**
 * Les gestes d'un onglet : le niveau vertical du cadre supérieur. Chaque onglet du bandeau peut ouvrir
 * la liste des saisies et réglages que sa page sait ouvrir par un paramètre d'adresse. Le plan garde
 * les destinations ; ces gestes s'ajoutent sous l'onglet, sans créer de page.
 */
export interface TabLink {
  /** L'onglet qui porte le geste : l'adresse de la page ou de la sous-page. */
  tab: string;
  label: string;
  /** Le paramètre d'adresse qui ouvre le geste sur cette page. */
  query: Record<string, string>;
}
export interface PlanTabLink { key: string; label: string; query: Record<string, string> }

const entry = (tab: string): TabLink[] => [
  { tab, label: 'Saisir une entrée', query: { entry: 'new', entryDirection: 'income' } },
  { tab, label: 'Saisir une dépense', query: { entry: 'new', entryDirection: 'charge' } },
];

export const TAB_LINKS: TabLink[] = [
  ...entry('/tableau-de-bord'),
  ...entry('/projet-de-vie'),
  ...entry('/piloter/agir'),
  { tab: '/vision', label: 'Créer un objectif daté', query: { goal: 'new' } },
  { tab: '/vision/reperes', label: 'Régler l’épargne visée', query: { reglage: 'savings' } },
  { tab: '/vision/reperes', label: 'Régler le cap patrimonial', query: { reglage: 'wealth' } },
  { tab: '/vision/projection', label: 'Ajuster les hypothèses', query: { reglage: 'projection' } },
  { tab: '/app/gestion-projet', label: 'Créer un projet de la vie', query: { editProject: 'new' } },
  { tab: '/app/gestion-projet', label: 'Créer une tâche', query: { editTask: 'new' } },
  { tab: '/app/gestion-projet', label: 'Décider les demandes', query: { decisions: 'tasks' } },
  { tab: '/app/taches', label: 'Créer une tâche', query: { editTask: 'new' } },
];

/** La clé d'un geste : son onglet et son paramètre, stable pour les libellés et l'ordre. */
export const tabLinkKey = (link: TabLink) => `${link.tab}?${new URLSearchParams(link.query)}`;
/**
 * Le parent des gestes d'un onglet dans l'arbre des liens. La vue principale partage l'adresse de sa
 * page, dont les enfants sont déjà les sous-pages : ses gestes ont leur propre parent.
 */
export const tabLinksKey = (tab: string, main: boolean) => (main ? tab + '#main' : tab);
export const tabLinksOf = (tab: string): PlanTabLink[] =>
  TAB_LINKS.filter((link) => link.tab === tab).map((link) => ({ key: tabLinkKey(link), label: link.label, query: link.query }));
