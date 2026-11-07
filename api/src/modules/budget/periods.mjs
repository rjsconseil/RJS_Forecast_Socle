// Périodes du cycle mensuel [P] (C07) : une période commence le jour d'ancrage (1 à 28) d'un mois
// et finit la veille du même jour le mois suivant. Sa clé est le mois de son début (AAAA-MM).
// Les périodes sont calculées par index (mois depuis l'an 0) : aucune énumération depuis le début
// du cycle, donc aucun plafond quel que soit l'âge du projet de vie (C10). L'historique se lit par pages.

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_LONG = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

import { today } from '../../socle/clock.mjs';

export { today };

/** Date UTC à minuit ; mois et jour hors bornes sont reportés (setUTCFullYear, sans l'ambiguïté 0–99 de Date.UTC). */
const utc = (y, m, d) => {
  const r = new Date(0);
  r.setUTCFullYear(y, m, d);
  return r;
};

export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return iso(utc(y, m - 1, d + n));
}

export const dayBefore = (ymd) => addDays(ymd, -1);

/** Index absolu d'une période (mois de son début). */
export const indexOfKey = (key) => {
  const [y, m] = key.split('-').map(Number);
  return y * 12 + (m - 1);
};

export function periodByIndex(index, anchorDay) {
  const year = Math.floor(index / 12);
  const month = index - year * 12;
  const start = utc(year, month, anchorDay);
  const end = utc(year, month + 1, anchorDay - 1);
  const s = iso(start);
  const e = iso(end);
  const label =
    anchorDay === 1
      ? `${MONTHS_LONG[month]} ${year}`
      : `${start.getUTCDate()} ${MONTHS[month]} → ${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
  return { key: s.slice(0, 7), index, start: s, end: e, label };
}

export function periodContaining(ymd, anchorDay) {
  const [y, m, d] = ymd.split('-').map(Number);
  return periodByIndex(y * 12 + (m - 1) - (d < anchorDay ? 1 : 0), anchorDay);
}

export function periodByKey(key, anchorDay) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}$/.test(key)) return null;
  const [, m] = key.split('-').map(Number);
  if (m < 1 || m > 12) return null;
  return periodByIndex(indexOfKey(key), anchorDay);
}

/**
 * Bornes du cycle : première période (celle de la date de début) et période courante
 * (celle d'aujourd'hui, ou la première si le cycle commence plus tard).
 */
export function cycleBounds(cycle, now = today()) {
  if (cycle?.state !== 'active') return null;
  const first = periodContaining(cycle.startDate, cycle.anchorDay);
  const current = now < cycle.startDate ? first : periodContaining(now, cycle.anchorDay);
  return { first, current, count: current.index - first.index + 1 };
}

/** Une page de l'historique, du plus récent au plus ancien : `limit` périodes avant l'index `before` (exclu). */
export function periodsPage(cycle, { before, limit = 24, now = today() } = {}) {
  const b = cycleBounds(cycle, now);
  if (!b) return { periods: [], total: 0, nextBefore: null };
  const top = Math.min(before ?? b.current.index + 1, b.current.index + 1);
  const bottom = Math.max(b.first.index, top - limit);
  const periods = [];
  for (let i = top - 1; i >= bottom; i--) periods.push(periodByIndex(i, cycle.anchorDay));
  return { periods, total: b.count, nextBefore: bottom > b.first.index ? bottom : null };
}
