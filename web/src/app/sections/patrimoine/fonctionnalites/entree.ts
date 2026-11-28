import type { PatrimoineRead, ProjectSummary } from '../../../platform/grand-noyau';

/**
 * Entrée de l'application autonome Mon patrimoine : le patrimoine constitué, son objectif, et les projets de la vie
 * qui peuvent porter un but patrimonial (constituer un apport pour un achat immobilier, préparer le budget d'une
 * période de retraite…). L'application planifie le patrimoine sur ces projets. La sortie reste à définir.
 */
export interface ProjetPatrimonial {
  id: string;
  titre: string;
  echeance: string | null;
}

export interface EntreePatrimoine {
  constitueCents: number | null;
  objectifCents: number | null;
  /** Reste à constituer pour atteindre l'objectif (0 s'il est atteint) ; null sans objectif ou sans stock connu. */
  resteCents: number | null;
  projets: ProjetPatrimonial[];
}

export function entreePatrimoine(lecture: PatrimoineRead, projets: ProjectSummary[]): EntreePatrimoine {
  const p = lecture.patrimoine;
  const constitueCents = p.openingStockCents === null ? null : p.openingStockCents + lecture.capitalizations.reduce((t, c) => t + c.amountCents, 0);
  const resteCents = constitueCents === null || p.objectiveCents === null ? null : Math.max(0, p.objectiveCents - constitueCents);
  return {
    constitueCents,
    objectifCents: p.objectiveCents,
    resteCents,
    // Le projet racine (« Projet de vie », qui porte budget et patrimoine) n'est pas un projet à planifier.
    projets: projets
      .filter((s) => s.project.id !== p.coreProjectId)
      .map((s) => ({ id: s.project.id, titre: s.project.title, echeance: s.project.dueDate }))
      .sort((a, b) => (a.echeance ?? '9999').localeCompare(b.echeance ?? '9999') || a.titre.localeCompare(b.titre)),
  };
}
