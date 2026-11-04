// Validations d'entrée partagées par les modules. Elles ne portent aucune règle métier.
import { fail } from './errors.mjs';

export function text(field, value, { required = false, max = 20000 } = {}) {
  if (value === undefined || value === null) {
    if (required) fail('VALIDATION', `Le champ ${field} est obligatoire.`, { field });
    return '';
  }
  if (typeof value !== 'string') fail('VALIDATION', `Le champ ${field} doit être un texte.`, { field });
  const v = required ? value.trim() : value;
  if (required && v === '') fail('VALIDATION', `Le champ ${field} ne peut pas être vide.`, { field });
  if (v.length > max) fail('VALIDATION', `Le champ ${field} dépasse ${max} caractères.`, { field });
  return v;
}

export function date(field, value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail('VALIDATION', `Le champ ${field} est obligatoire.`, { field });
    return null;
  }
  if (!isCalendarDate(value)) fail('VALIDATION', `Le champ ${field} doit être une date civile valide AAAA-MM-JJ.`, { field, value });
  return value;
}

/**
 * Date civile réelle : le format ISO ne suffit pas, le jour doit exister dans le mois
 * (31 février refusé, 29 février seulement les années bissextiles). Aucune normalisation.
 */
export function isCalendarDate(value) {
  const m = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= days;
}

export function dateOrder(start, due, startField, dueField) {
  if (start && due && due < start) fail('VALIDATION', `${dueField} ne peut pas être antérieure à ${startField}.`, { field: dueField });
}

export function hours(field, value, { nullable }) {
  if (value === undefined || value === null || value === '') {
    if (nullable) return null;
    fail('VALIDATION', `Le champ ${field} est obligatoire.`, { field });
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000) {
    fail('VALIDATION', `Le champ ${field} doit être un nombre d'heures fini et non négatif.`, { field });
  }
  return Math.round(value * 100) / 100;
}

/**
 * Montant en euros (entrée) → centimes entiers (stockage). `null` reste inconnu, jamais 0.
 * `signed` autorise un montant négatif (ex. stock d'ouverture débiteur).
 */
export function money(field, value, { nullable = false, signed = false, positive = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (nullable) return null;
    fail('VALIDATION', `Le champ ${field} est obligatoire.`, { field });
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) {
    fail('VALIDATION', `Le champ ${field} doit être un montant en euros.`, { field });
  }
  if (!signed && value < 0) fail('VALIDATION', `Le champ ${field} ne peut pas être négatif.`, { field });
  if (positive && value <= 0) fail('VALIDATION', `Le champ ${field} doit être strictement positif.`, { field });
  const cents = Math.round(value * 100);
  if (Math.abs(cents - value * 100) > 1e-6) fail('VALIDATION', `Le champ ${field} accepte au plus deux décimales.`, { field });
  return cents;
}

export function integer(field, value, { min, max, nullable = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (nullable) return null;
    fail('VALIDATION', `Le champ ${field} est obligatoire.`, { field });
  }
  if (!Number.isInteger(value) || (min !== undefined && value < min) || (max !== undefined && value > max)) {
    fail('VALIDATION', `Le champ ${field} doit être un entier${min !== undefined ? ` entre ${min} et ${max}` : ''}.`, { field });
  }
  return value;
}

export function oneOf(field, value, allowed, fallback) {
  if (value === undefined || value === null) {
    if (fallback === undefined) fail('VALIDATION', `Le champ ${field} est obligatoire.`, { field, allowed });
    return fallback;
  }
  if (!allowed.includes(value)) fail('VALIDATION', `Valeur invalide pour ${field}.`, { field, allowed });
  return value;
}

export function expectedRevisionOf(input) {
  const r = input?.expectedRevision;
  if (!Number.isInteger(r) || r < 1) fail('VALIDATION', 'La version attendue (expectedRevision) est requise.', { field: 'expectedRevision' });
  return r;
}

export function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj && k in obj).map((k) => [k, obj[k]]));
}
