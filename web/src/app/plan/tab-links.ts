/**
 * Les gestes d'un onglet : le niveau vertical du cadre supérieur. Chaque onglet du bandeau peut ouvrir
 * la liste des saisies et réglages que sa page sait ouvrir par un paramètre d'adresse. Le plan garde
 * les destinations ; ces gestes s'ajoutent sous l'onglet, sans créer de page.
 */
import { APPLICATIONS } from '../platform/applications';

export interface TabLink {
  /** L'onglet qui porte le geste : l'adresse de la page ou de la sous-page. */
  tab: string;
  label: string;
  /** Le paramètre d'adresse qui ouvre le geste sur cette page. */
  query: Record<string, string>;
  /** Navigation system v2 : destination propre du geste quand elle n'est pas l'onglet lui-même. */
  link?: string;
}
export interface PlanTabLink { key: string; label: string; query: Record<string, string>; link?: string }


/** Les actions viennent des déclarations d’application ; la plateforme n’en porte aucune en propre. */
export const TAB_LINKS: TabLink[] = APPLICATIONS.flatMap((application) => application.actions ?? []);

/** La clé d'un geste : son onglet et son paramètre, stable pour les libellés et l'ordre. */
export const tabLinkKey = (link: TabLink) =>
  link.link ? `${link.tab}>${link.link}?${new URLSearchParams(link.query)}` : `${link.tab}?${new URLSearchParams(link.query)}`;
/**
 * Le parent des gestes d'un onglet dans l'arbre des liens. La vue principale partage l'adresse de sa
 * page, dont les enfants sont déjà les sous-pages : ses gestes ont leur propre parent.
 */
export const tabLinksKey = (tab: string, main: boolean) => (main ? tab + '#main' : tab);
export const tabLinksOf = (tab: string): PlanTabLink[] =>
  TAB_LINKS.filter((link) => link.tab === tab).map((link) => ({ key: tabLinkKey(link), label: link.label, query: link.query, link: link.link }));
