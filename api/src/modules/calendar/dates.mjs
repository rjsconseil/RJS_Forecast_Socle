// Calendrier : dates en texte AAAA-MM-JJ (UTC) et répétitions (n-ième date, alignement, dates d'une répétition).
import { isCalendarDate } from '../../socle/validation.mjs';
import { CADENCES } from './constants.mjs';

// ---------- dates ----------

export const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const utc = (y, m, d) => {
  const r = new Date(0);
  r.setUTCFullYear(y, m, d);
  return r;
};
export const parts = (ymd) => ymd.split('-').map(Number);
export const dayNumber = (ymd) => {
  const [y, m, d] = parts(ymd);
  return Math.round(utc(y, m - 1, d).getTime() / 86400000);
};
export const addDays = (ymd, n) => {
  const [y, m, d] = parts(ymd);
  return iso(utc(y, m - 1, d + n));
};
export const daysInMonth = (y, m) => utc(y, m + 1, 0).getUTCDate();

/** n-ième date (n ≥ 0) d'une répétition : le mois et l'année gardent le jour d'origine, ramené au dernier jour du mois. */
export function nthDate(first, cadence, n) {
  const [y, m, d] = parts(first);
  if (cadence === 'daily') return iso(utc(y, m - 1, d + n));
  if (cadence === 'weekly') return iso(utc(y, m - 1, d + 7 * n));
  const months = m - 1 + n * (cadence === 'yearly' ? 12 : 1);
  const year = y + Math.floor(months / 12);
  const month = months - Math.floor(months / 12) * 12;
  return iso(utc(year, month, Math.min(d, daysInMonth(year, month))));
}

/** Date du jour `day` du mois de `ymd`, ou du mois précédent si ce jour n'est pas encore atteint (ancrage d'un cycle). */
export function alignToDay(ymd, day) {
  if (!isCalendarDate(ymd) || !Number.isInteger(day) || day < 1 || day > 31) return ymd;
  const [y, m, d] = parts(ymd);
  const month = d >= day ? m - 1 : m - 2;
  const year = y + Math.floor(month / 12);
  const mm = month - Math.floor(month / 12) * 12;
  return iso(utc(year, mm, Math.min(day, daysInMonth(year, mm))));
}

/** Rang de départ pour atteindre `from` sans énumérer depuis la première date (une marge de sécurité incluse). */
export function startRank(first, cadence, from) {
  if (from <= first) return 0;
  const days = dayNumber(from) - dayNumber(first);
  if (cadence === 'daily') return Math.max(0, days - 1);
  if (cadence === 'weekly') return Math.max(0, Math.floor(days / 7) - 1);
  const [fy, fm] = parts(first);
  const [y, m] = parts(from);
  return Math.max(0, Math.floor(((y - fy) * 12 + (m - fm)) / (cadence === 'yearly' ? 12 : 1)) - 1);
}

/**
 * Dates d'une répétition comprises dans [from, to]. `position: 'veilleSuivante'` place chaque repère la veille
 * de l'occurrence suivante (la fin d'une période qui commence à l'occurrence).
 */
export function repeatDates({ first, last, cadence, position = 'occurrence' }, from, to) {
  if (!isCalendarDate(first) || !CADENCES.includes(cadence)) return [];
  const out = [];
  const dateOf = (n) => (position === 'veilleSuivante' ? addDays(nthDate(first, cadence, n + 1), -1) : nthDate(first, cadence, n));
  for (let n = startRank(first, cadence, from), date = dateOf(n); date <= to; date = dateOf(++n)) {
    if (last && nthDate(first, cadence, n) > last) break;
    if (date >= from) out.push(date);
    if (n > 5000) break;
  }
  return out;
}
