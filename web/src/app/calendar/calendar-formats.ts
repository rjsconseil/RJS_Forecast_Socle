import { CalendarData, CalendarFormat, CalendarFormatField, CalendarLayout } from './calendar.models';

/**
 * Formats d'affichage des événements. Le service livre les formats « Standard », « Compact » et « Détaillé »,
 * la configuration peut en ajouter, et chaque personne peut créer les siens : ils sont enregistrés sur le
 * serveur pour son profil, valent pour tous ses calendriers et s'appellent par leur id comme un format livré.
 */
export const LAYOUT_LABELS: Record<CalendarLayout, string> = {
  ligne: 'Une ligne',
  'deux-lignes': 'Deux lignes',
  pastille: 'Pastille',
};
export const LAYOUTS = Object.keys(LAYOUT_LABELS) as CalendarLayout[];
export const FORMAT_FIELDS: { key: CalendarFormatField; label: string; short: string }[] = [
  { key: 'amount', label: 'Montant des événements', short: 'montant' },
  { key: 'total', label: 'Total des flux du jour', short: 'total du jour' },
  { key: 'type', label: 'Type de repère', short: 'type' },
  { key: 'status', label: 'Statut', short: 'statut' },
  { key: 'group', label: 'Regroupement de rattachement', short: 'regroupement' },
];
const FIELD_KEYS = new Set<string>(FORMAT_FIELDS.map((f) => f.key));

/** Format de repli quand un service plus ancien ne rend pas ses formats. */
export const FALLBACK_FORMAT: CalendarFormat = { id: 'standard', label: 'Standard', layout: 'ligne', fields: ['amount', 'total'], perCell: null, builtIn: true };

/** Un format créé est contrôlé avant d'être enregistré : une entrée abîmée n'est jamais affichée de travers. */
export function validOwnFormat(raw: unknown): raw is CalendarFormat {
  if (!raw || typeof raw !== 'object') return false;
  const f = raw as Record<string, unknown>;
  return typeof f['id'] === 'string' && /^perso-[a-z0-9-]+$/.test(f['id'])
    && typeof f['label'] === 'string' && f['label'].trim().length > 0 && f['label'].trim().length <= 40
    && LAYOUTS.includes(f['layout'] as CalendarLayout)
    && Array.isArray(f['fields']) && f['fields'].every((x) => FIELD_KEYS.has(x as string)) && new Set(f['fields']).size === f['fields'].length
    && (f['perCell'] === null || (Number.isInteger(f['perCell']) && (f['perCell'] as number) >= 0 && (f['perCell'] as number) <= 8));
}

/** Formats proposés : ceux du service (livrés, configuration), puis ceux de la personne (`own`, tenus à jour à l'écran). */
export function availableFormats(data: CalendarData | null, own: CalendarFormat[]): CalendarFormat[] {
  const served = (data?.formats?.length ? data.formats : [FALLBACK_FORMAT]).filter((f) => !f.own);
  const taken = new Set(served.map((f) => f.id));
  return [...served, ...own.filter((f) => !taken.has(f.id))];
}

/** Identifiant d'un nouveau format, tiré de son nom et unique parmi les formats existants. */
export function newFormatId(label: string, existing: CalendarFormat[]): string {
  const slug = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'format';
  const taken = new Set(existing.map((f) => f.id));
  let id = `perso-${slug}`;
  for (let n = 2; taken.has(id); n++) id = `perso-${slug}-${n}`;
  return id;
}

/** Résumé lisible : disposition, champs dans l'ordre, densité. */
export function describeFormat(format: CalendarFormat): string {
  const fields = format.fields.map((key) => FORMAT_FIELDS.find((f) => f.key === key)?.short ?? key);
  return [LAYOUT_LABELS[format.layout], fields.length ? fields.join(', ') : 'titre seul', format.perCell !== null ? `${format.perCell} par case` : null]
    .filter(Boolean).join(' · ');
}
