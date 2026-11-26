// Cadences du temps : le vocabulaire commun des répétitions (récurrences de Budget, apports de Patrimoine).
export const CADENCES = ['weekly', 'monthly', 'yearly'];
export const CADENCE_LABEL = { once: 'Ponctuelle', weekly: 'Hebdomadaire', monthly: 'Mensuelle', yearly: 'Annuelle' };
/** Fréquence annuelle d'une cadence (apport annuel = apport par période × fréquence). */
export const PER_YEAR = { weekly: 52, monthly: 12, yearly: 1 };
export const monthlyAverageCents = (amountCents, cadence) => Math.round((amountCents * PER_YEAR[cadence]) / 12);
