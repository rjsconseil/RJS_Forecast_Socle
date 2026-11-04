import { CalendarDirection, CalendarElement, CalendarEvent, CalendarIndicatorKey } from './calendar.models';

/** Couleurs paramétrables → jetons du site (les mêmes noms que la configuration). */
export const TONE_COLORS: Record<string, string> = {
  bleu: 'var(--blue-600)',
  indigo: 'var(--indigo-600)',
  violet: 'var(--violet-600)',
  cyan: 'var(--cyan-700)',
  sarcelle: 'var(--teal-600)',
  vert: 'var(--green-700)',
  ambre: 'var(--amber-600)',
  orange: '#c2410c',
  rouge: 'var(--red-600)',
  rose: '#be185d',
  ardoise: 'var(--slate-600)',
};
export const toneColor = (tone: string | undefined) => TONE_COLORS[tone ?? ''] ?? TONE_COLORS['bleu'];

export const MARKER_SYMBOL = { start: '○', due: '●', point: '◆' } as const;
export const MARKER_LABEL = { start: 'Début ou date prévue', due: 'Échéance', point: 'Repère ponctuel' } as const;

const MONEY = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Montant signé selon le sens : + entrée, − sortie ; sans sens, montant simple. */
export function formatAmount(cents: number, direction: CalendarDirection | null = null): string {
  const text = MONEY.format(Math.abs(cents) / 100);
  if (direction === 'entree') return `+${text}`;
  if (direction === 'sortie') return `−${text}`;
  return cents < 0 ? `−${text}` : text;
}

export function groupByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const days = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const list = days.get(e.date);
    if (list) list.push(e);
    else days.set(e.date, [e]);
  }
  return days;
}

export interface StatLine {
  text: string;
  tone?: 'alert' | 'success' | 'zero';
}
export interface DayStat {
  key: CalendarIndicatorKey;
  label: string;
  lines: StatLine[];
  aria: string;
}

const distinct = (events: CalendarEvent[]) => {
  const seen = new Map<string, CalendarEvent>();
  for (const e of events) seen.set(`${e.nature}:${e.objectId}`, e);
  return [...seen.values()];
};

/** Natures de la configuration, dans l'ordre des éléments, avec leurs libellés singulier / pluriel. */
function naturesOf(elements: CalendarElement[]) {
  const out = new Map<string, { one: string; many: string }>();
  for (const el of elements) if (!out.has(el.nature)) out.set(el.nature, el.objectLabel);
  return out;
}

/** Bilan d'un ensemble de repères (une journée) pour les indicateurs paramétrés du survol. */
export function dayStats(events: CalendarEvent[], elements: CalendarElement[], indicators: { key: CalendarIndicatorKey; label: string }[]): DayStat[] {
  const byId = new Map(elements.map((el) => [el.id, el]));
  const markerOf = (e: CalendarEvent) => byId.get(e.element)?.marker ?? 'point';
  const items = distinct(events);
  return indicators.map(({ key, label }) => {
    let lines: StatLine[] = [];
    if (key === 'elements') {
      const counts = [...naturesOf(elements)].map(([nature, names]) => ({ n: items.filter((e) => e.nature === nature).length, names }));
      const shown = counts.filter((c) => c.n > 0);
      for (const c of counts) if (shown.length < 2 && c.n === 0) shown.push(c);
      lines = shown.slice(0, 3).map((c) => ({ text: plural(c.n, c.names.one, c.names.many), tone: c.n ? undefined : 'zero' }));
    } else if (key === 'dates') {
      const starts = events.filter((e) => markerOf(e) === 'start').length;
      const dues = events.filter((e) => markerOf(e) === 'due').length;
      const points = events.filter((e) => markerOf(e) === 'point').length;
      const pendingDues = events.filter((e) => markerOf(e) === 'due' && !e.done).length;
      const hasStarts = elements.some((el) => el.marker === 'start');
      lines = [
        hasStarts || !points ? { text: plural(starts, 'début', 'débuts'), tone: starts ? undefined : 'zero' } : { text: plural(points, 'repère', 'repères'), tone: points ? undefined : 'zero' },
        { text: plural(dues, 'échéance', 'échéances'), tone: pendingDues >= 2 || events.some((e) => markerOf(e) === 'due' && e.urgent === 'overdue') ? 'alert' : dues ? undefined : 'zero' },
      ];
    } else if (key === 'suivi') {
      const done = items.filter((e) => e.done).length;
      const open = items.length - done;
      lines = [
        { text: `${open} à suivre`, tone: open >= 5 || items.some((e) => !e.done && e.urgent === 'overdue') ? 'alert' : open ? undefined : 'zero' },
        { text: plural(done, 'terminé', 'terminés'), tone: done && done >= open ? 'success' : done ? undefined : 'zero' },
      ];
    } else if (key === 'flux') {
      const sum = (d: CalendarDirection) => events.filter((e) => e.direction === d && e.amountCents !== null).reduce((s, e) => s + (e.amountCents ?? 0), 0);
      const inflow = sum('entree');
      const outflow = sum('sortie');
      lines = [
        { text: `${formatAmount(inflow, 'entree')} entrées`, tone: inflow ? 'success' : 'zero' },
        { text: `${formatAmount(outflow, 'sortie')} sorties`, tone: outflow ? 'alert' : 'zero' },
      ];
    } else if (key === 'solde') {
      const flows = events.filter((e) => e.direction && e.amountCents !== null);
      const net = flows.reduce((s, e) => s + (e.direction === 'entree' ? 1 : -1) * (e.amountCents ?? 0), 0);
      const settled = flows.filter((e) => e.done).length;
      lines = [
        { text: `${net < 0 ? '−' : '+'}${MONEY.format(Math.abs(net) / 100)} solde`, tone: net < 0 ? 'alert' : net > 0 ? 'success' : 'zero' },
        { text: `${settled}/${flows.length} réglés`, tone: flows.length ? undefined : 'zero' },
      ];
    }
    return { key, label, lines, aria: `${label} : ${lines.map((l) => l.text).join(', ')}` };
  });
}

/** Lignes du volet de détail d'un indicateur (au survol de l'indicateur, dans l'aperçu d'une journée). */
export function detailRows(events: CalendarEvent[], elements: CalendarElement[], key: CalendarIndicatorKey): { label: string; title: string }[] {
  const byId = new Map(elements.map((el) => [el.id, el]));
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  switch (key) {
    case 'elements':
      return distinct(events).map((e) => ({ label: `${cap(byId.get(e.element)?.objectLabel.one ?? 'élément')} ·`, title: e.statusLabel ? `${e.title} (${e.statusLabel})` : e.title }));
    case 'dates':
      return events.map((e) => ({ label: `${byId.get(e.element)?.label ?? 'Repère'} ·`, title: e.title }));
    case 'suivi':
      return [...distinct(events)].sort((a, b) => Number(a.done) - Number(b.done)).map((e) => ({ label: e.done ? 'Terminé ·' : 'À suivre ·', title: e.title }));
    default:
      return events.filter((e) => e.direction && e.amountCents !== null).map((e) => ({ label: `${formatAmount(e.amountCents ?? 0, e.direction)} ·`, title: e.title }));
  }
}

/** Synthèse d'une période : repères, objets distincts par nature, suivi et montants. */
export function periodSummary(events: CalendarEvent[], elements: CalendarElement[]) {
  const items = distinct(events);
  const natures = [...naturesOf(elements)].map(([nature, names]) => {
    const n = items.filter((e) => e.nature === nature).length;
    return { nature, count: n, label: n === 1 ? names.one : names.many };
  });
  const flows = events.filter((e) => e.direction && e.amountCents !== null);
  const inCents = flows.filter((e) => e.direction === 'entree').reduce((s, e) => s + (e.amountCents ?? 0), 0);
  const outCents = flows.filter((e) => e.direction === 'sortie').reduce((s, e) => s + (e.amountCents ?? 0), 0);
  return {
    markers: events.length,
    natures,
    toFollow: items.filter((e) => !e.done).length,
    done: items.filter((e) => e.done).length,
    hasAmounts: flows.length > 0,
    inCents,
    outCents,
    netCents: inCents - outCents,
  };
}

/** Repères regroupés par regroupement (projet, Budget…), dans l'ordre des dates. */
export function groupsOf(events: CalendarEvent[]) {
  const groups = new Map<string, { id: string | null; label: string; events: CalendarEvent[] }>();
  for (const e of events) {
    const k = e.groupId ?? `__${e.groupLabel ?? ''}`;
    if (!groups.has(k)) groups.set(k, { id: e.groupId, label: e.groupLabel ?? 'Sans regroupement', events: [] });
    groups.get(k)!.events.push(e);
  }
  return [...groups.values()].sort((a, b) => a.events[0].date.localeCompare(b.events[0].date) || a.label.localeCompare(b.label, 'fr'));
}
