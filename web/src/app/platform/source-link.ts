/**
 * Ouvrir un fait à sa source (vision « cinq sections autonomes, un seul site ») : un objet appartient à une seule
 * section ; les autres le montrent et, pour le changer, renvoient à la section qui le gère. Les adresses sont
 * déclarées par l'application (`sources`), jamais écrites en dur dans une page d'une autre section.
 */
import type { SourceLink, SourceRef } from './application';
import { APPLICATIONS } from './applications';

/** Natures d'objet, par préfixe d'ID (les mêmes que le registre de l'API). */
export const KIND_OF_PREFIX: Record<string, string> = {
  prj: 'coreProject', tsk: 'task', ovr: 'projectOverrun', dmt: 'taskBudgetRequest',
  op: 'operation', rec: 'recurrence', bud: 'budget', cc: 'costCenter',
  pat: 'patrimoine', cap: 'capitalization', obj: 'lifeGoal',
  clo: 'closure', cyc: 'cycleLink', bpm: 'bpmComposition',
};

/** Nature d'un objet d'après son ID (`prj_…` → coreProject) ; null si le préfixe est inconnu. */
export const kindOfId = (id: string | null | undefined): string | null => (id ? KIND_OF_PREFIX[id.split('_')[0]] ?? null : null);

/** L'adresse où se gère un objet, dans l'application qui le déclare ; null si aucune ne sait l'ouvrir. */
export function sourceLink(kind: string, ref: SourceRef | string, applicationId?: string): SourceLink | null {
  const r = typeof ref === 'string' ? { id: ref } : ref;
  const apps = applicationId ? APPLICATIONS.filter((a) => a.id === applicationId) : APPLICATIONS;
  for (const app of apps) {
    const open = app.sources?.[kind];
    if (open) return open(r);
  }
  return null;
}

/** Comme `sourceLink`, la nature étant lue dans l'ID. */
export const sourceLinkOfId = (ref: SourceRef | string): SourceLink | null => {
  const id = typeof ref === 'string' ? ref : ref.id;
  const kind = kindOfId(id);
  return kind ? sourceLink(kind, ref) : null;
};
