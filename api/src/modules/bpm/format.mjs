// Petites écritures communes des lectures de BPM (montants, dates, pluriels) : une seule définition pour tout le
// module, au lieu d'une copie par fichier. Le format reste celui affiché sur le site (« 3 nov. 2026 », « 12,50 € »).
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/** « 2026-11-03 » → « 3 nov. 2026 » ; chaîne vide sans date. */
export const frDate = (ymd) => {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
/** Euros (nombre) → centimes entiers ; null reste null. */
export const cents = (v) => (v === null || v === undefined ? null : Math.round(v * 100));
/** Somme d'une valeur lue sur chaque élément (une valeur absente compte zéro). */
export const sum = (xs, f) => xs.reduce((s, x) => s + (f(x) ?? 0), 0);
/** « 1 point », « 2 points ». */
export const plural = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
/** Centimes → « 1 234,50 € » (espaces simples). */
export const fmt = (c) => euro.format(c / 100).replace(/[\u00a0\u202f]/g, ' ');
