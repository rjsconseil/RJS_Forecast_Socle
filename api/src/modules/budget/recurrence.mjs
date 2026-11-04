// Récurrences [P] : une définition (cadence, première date, fin éventuelle) produit des occurrences
// attendues, identifiées par `<recurrenceId>@<date prévue>`. Une occurrence devient une opération
// au moment de son règlement : définition, occurrence attendue et règlement effectif restent distincts.
// Les occurrences d'une fenêtre sont calculées directement, sans énumérer depuis la première date.

export const CADENCES = ['weekly', 'monthly', 'yearly'];
export const CADENCE_LABEL = { once: 'Ponctuelle', weekly: 'Hebdomadaire', monthly: 'Mensuelle', yearly: 'Annuelle' };
/** Fréquence annuelle d'une cadence (apport annuel = apport par période × fréquence). */
export const PER_YEAR = { weekly: 52, monthly: 12, yearly: 1 };

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parts = (ymd) => ymd.split('-').map(Number);
const utc = (y, m, d) => {
  const r = new Date(0);
  r.setUTCFullYear(y, m, d);
  return r;
};
const dayNumber = (ymd) => {
  const [y, m, d] = parts(ymd);
  return Math.round(utc(y, m - 1, d).getTime() / 86400000);
};
const daysInMonth = (y, m) => utc(y, m + 1, 0).getUTCDate();

export const occurrenceKey = (recurrenceId, date) => `${recurrenceId}@${date}`;

export function parseOccurrenceKey(key) {
  const i = typeof key === 'string' ? key.lastIndexOf('@') : -1;
  return i > 0 ? { recurrenceId: key.slice(0, i), date: key.slice(i + 1) } : null;
}

/**
 * n-ième occurrence (n ≥ 0). Mensuelle et annuelle gardent le jour de la première date, ramené au
 * dernier jour du mois quand il n'existe pas (31 → 30, 29 février → 28 février).
 */
export function nthOccurrence(rec, n) {
  const [y, m, d] = parts(rec.firstDate);
  if (rec.cadence === 'weekly') return iso(utc(y, m - 1, d + 7 * n));
  const months = (m - 1) + n * (rec.cadence === 'yearly' ? 12 : 1);
  const year = y + Math.floor(months / 12);
  const month = months - Math.floor(months / 12) * 12;
  return iso(utc(year, month, Math.min(d, daysInMonth(year, month))));
}

/** Dates des occurrences comprises dans [from, to] (bornes incluses), en respectant la fin éventuelle. */
export function occurrenceDates(rec, from, to) {
  const last = rec.endDate && rec.endDate < to ? rec.endDate : to;
  if (last < rec.firstDate || last < from) return [];
  let n = 0;
  if (from > rec.firstDate) {
    if (rec.cadence === 'weekly') n = Math.max(0, Math.floor((dayNumber(from) - dayNumber(rec.firstDate)) / 7) - 1);
    else {
      const [fy, fm] = parts(rec.firstDate);
      const [y, m] = parts(from);
      const months = (y - fy) * 12 + (m - fm);
      n = Math.max(0, Math.floor(months / (rec.cadence === 'yearly' ? 12 : 1)) - 1);
    }
  }
  const out = [];
  for (let date = nthOccurrence(rec, n); date <= last; date = nthOccurrence(rec, ++n)) if (date >= from) out.push(date);
  return out;
}

/** Une date est-elle une occurrence de la définition ? */
export const isOccurrence = (rec, date) => occurrenceDates(rec, date, date).length === 1;

/** Moyenne mensuelle d'un montant selon sa cadence (nommée comme une moyenne : elle ne remplace pas les échéances). */
export const monthlyAverageCents = (amountCents, cadence) => Math.round((amountCents * PER_YEAR[cadence]) / 12);
