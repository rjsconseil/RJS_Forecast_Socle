// Middleware technique « Cycle et temps » : périodes du cycle, politique de clôture et cadences.
// Il ne porte aucun objet : ce sont les règles du temps que les middlewares métier partagent (Budget pour
// ses périodes et récurrences, Patrimoine pour ses apports). Le sortir de Budget rend ces deux middlewares
// indépendants l'un de l'autre. Une application y accède par la façade du middleware métier qu'elle utilise.
import { fail } from '../../socle/errors.mjs';
import { today, periodContaining, periodByIndex } from './periods.mjs';
import { CADENCES, CADENCE_LABEL, PER_YEAR, monthlyAverageCents } from './cadences.mjs';

/** Lecture d'essai : la période qui contient une date pour un jour d'ancrage, ses voisines et les cadences. */
export function cycleProbe({ anchorDay = 1, date = today(), amountCents = 0 } = {}) {
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 28) fail('VALIDATION', 'Le jour d’ancrage va de 1 à 28.', { field: 'anchorDay' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) fail('VALIDATION', 'Date attendue au format AAAA-MM-JJ.', { field: 'date' });
  if (!Number.isInteger(amountCents) || amountCents < 0) fail('VALIDATION', 'Montant invalide.', { field: 'amount' });
  const current = periodContaining(date, anchorDay);
  return {
    today: today(),
    anchorDay,
    date,
    current,
    periods: [-2, -1, 0, 1, 2, 3].map((shift) => ({ ...periodByIndex(current.index + shift, anchorDay), shift })),
    cadences: CADENCES.map((id) => ({ id, label: CADENCE_LABEL[id], perYear: PER_YEAR[id], monthlyAverageCents: monthlyAverageCents(amountCents, id), yearlyCents: amountCents * PER_YEAR[id] })),
  };
}

export default {
  id: 'cycle',
  label: 'Cycle et temps',
  level: 2,
  role: 'technique',
  dependsOn: [],
  setup: () => ({ probe: cycleProbe }),
  routes: () => [
    // Interface de test du middleware : lecture pure, aucun objet, aucun user requis.
    ['GET', '/api/cycle', async ({ query }) => cycleProbe({
      anchorDay: query.has('anchorDay') ? Number(query.get('anchorDay')) : 1,
      date: query.get('date') || today(),
      amountCents: Math.round(Number(query.get('amount') || 0) * 100),
    })],
  ],
};
