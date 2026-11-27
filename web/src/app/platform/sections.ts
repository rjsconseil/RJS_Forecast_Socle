/**
 * Catalogue des sections du site (vision « cinq sections autonomes, un seul site », 27/11/2026).
 * Le site lit le MÊME fichier que l'API et la base : `api/src/socle/sections.json`. Une section a une promesse,
 * une responsabilité qu'elle est seule à porter, une couleur ; les flux disent ce qu'elle reçoit et ce qu'elle donne.
 */
import catalog from '../../../../api/src/socle/sections.json';

export type SectionKey = 'quotidien' | 'projets' | 'budget' | 'patrimoine' | 'cycles';

export interface SiteSection {
  key: SectionKey;
  prefix: string;
  order: number;
  label: string;
  /** Ce que la section fait dans la boucle du projet de vie (« prévoir », « réaliser »…). */
  verb: string;
  /** Teinte du plan (`astra-<clé>`) : cadre, menu et pages de la section. */
  tone: `astra-${SectionKey}`;
  promise: string;
  /** Ce que la section est seule à décider. */
  decides: string;
}

export interface SectionFlow {
  n: number;
  from: SectionKey;
  to: SectionKey;
  label: string;
  detail: string;
}

/** Les cinq sections du site, dans l'ordre du menu (le système, socle commun, n'en fait pas partie). */
export const SITE_SECTIONS: readonly SiteSection[] = catalog.sections
  .filter((s) => s.key !== 'systeme')
  .sort((a, b) => a.order - b.order) as SiteSection[];

/** Les neuf flux entre sections : la boucle du projet de vie. */
export const SECTION_FLOWS: readonly SectionFlow[] = catalog.flows as SectionFlow[];

export const sectionOf = (key: SectionKey): SiteSection => {
  const s = SITE_SECTIONS.find((x) => x.key === key);
  if (!s) throw new Error(`Section inconnue : ${key}`);
  return s;
};

/** Ce qu'une section reçoit des autres. */
export const flowsInto = (key: SectionKey): SectionFlow[] => SECTION_FLOWS.filter((f) => f.to === key);
/** Ce qu'une section donne aux autres. */
export const flowsFrom = (key: SectionKey): SectionFlow[] => SECTION_FLOWS.filter((f) => f.from === key);
