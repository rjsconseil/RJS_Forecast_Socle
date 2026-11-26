// Libellés et tons de la fiche projet : fonctions pures, sans état de page.
import type { BpmTaskCard, ProjectChargeLine } from '../data/bpm-projects.models';

const today = () => new Date().toISOString().slice(0, 10);

export function timeTone(t: BpmTaskCard) {
  const p = t.budget?.timeConsumptionPercent;
  return p === null || p === undefined
    ? 'unknown'
    : p >= 100
      ? 'green'
      : p >= 50
        ? 'yellow'
        : 'blue';
}

export function chargeState(c: ProjectChargeLine) {
  if (c.refund)
    return c.validated
      ? c.fundingSource === 'patrimoine' ? 'Entrée reçue · patrimoine' : 'Entrée reçue · cycle'
      : c.settled
        ? 'Entrée reçue · historique du projet'
        : 'Entrée attendue';
  if (c.validated) return c.fundingSource === 'patrimoine' ? 'Réglée · patrimoine' : 'Réglée · cycle';
  if (c.beforeAllocation) return 'Réglée · avant l’enveloppe';
  if (c.settled) return 'Réglée · hors budget de vie';
  return c.kind === 'occurrence' ? 'Échéance à régler' : 'À régler';
}

export function defaultDate(c: ProjectChargeLine) {
  return c.plannedDate <= today() ? c.plannedDate : today();
}
