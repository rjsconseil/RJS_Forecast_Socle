import type { PatrimoineRead } from '../../../platform/grand-noyau';

/**
 * Entrée de l'application autonome Mon budget : le patrimoine DISPONIBLE, celui qui n'est pas déjà dépensé ni engagé
 * pour l'avenir (un projet, une dépense future prévue sur le patrimoine). C'est lui que l'application « manage » :
 * investissements en bourse ou sur des projets à but de rendement.
 *
 *   patrimoine disponible = patrimoine constitué (stock d'ouverture + résultats des cycles capitalisés) − engagements futurs
 *
 * Les engagements futurs ne sont pas encore exposés par le grand noyau (fondation repérée, docs/sections/budget.md §5) :
 * tant qu'ils ne le sont pas, le disponible reste inconnu plutôt que surestimé. La sortie reste à définir.
 */
export interface EntreeBudget {
  constitueCents: number | null;
  /** Montants engagés pour l'avenir sur le patrimoine (projets, dépenses futures) ; null tant qu'ils ne sont pas lus. */
  engagesCents: number | null;
  /** Ce qui entre dans l'application ; null tant que les engagements sont inconnus. */
  disponibleCents: number | null;
  /** Date à partir de laquelle le patrimoine est suivi. */
  depuis: string | null;
}

export function patrimoineConstitueCents(lecture: PatrimoineRead): number | null {
  const ouverture = lecture.patrimoine.openingStockCents;
  if (ouverture === null) return null;
  return ouverture + lecture.capitalizations.reduce((t, c) => t + c.amountCents, 0);
}

export function entreeBudget(lecture: PatrimoineRead, engagesCents: number | null = null): EntreeBudget {
  const constitueCents = patrimoineConstitueCents(lecture);
  const disponibleCents = constitueCents === null || engagesCents === null ? null : Math.max(0, constitueCents - engagesCents);
  return { constitueCents, engagesCents, disponibleCents, depuis: lecture.patrimoine.openingDate };
}
