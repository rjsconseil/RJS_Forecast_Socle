/** Lit un montant en euros et retourne les centimes, sans arrondir une troisième décimale. */
export function parseAmount(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) && cents <= 100_000_000_000 ? cents : null;
}

export function parseSignedAmount(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) && Math.abs(cents) <= 100_000_000_000 ? cents : null;
}

const euroFormatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
/**
 * Le montant lisible du site : l'espace fine insécable des milliers devient une
 * espace insécable (l'espace fine disparaît presque dans le texte courant) et le
 * signe moins typographique remplace le trait d'union.
 */
export const formatMoney = (cents: number) =>
  euroFormatter.format(cents / 100).replace(/\u202f/g, '\u00a0').replace(/^-/, '\u2212');
