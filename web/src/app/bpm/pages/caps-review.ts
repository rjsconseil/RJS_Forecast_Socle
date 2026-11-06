// Revue des plafonds : de la lecture `caps-review` aux cartes de la page « Plafonds et catégories ».
// Une carte par plafond (poste, catégorie, ou poste avec ses catégories) : état, jauge, alerte, et les charges
// qui, ensemble, forment l'engagé — avec leur récurrence et leur antériorité. Rien n'est retiré à la place de
// l'utilisateur : la page montre ce qui pèse, l'utilisateur décide.
import { CapsReview, ReviewCategory, ReviewCenter, ReviewCharge } from '../../core/bpm-caps.models';
import { cents, percentText } from '../../core/format';
import { LifeGauge } from '../life/life-gauge';
import { capTone } from '../ui/caps';

export type ReviewMode = 'center' | 'category' | 'both';
export type CardHealth = 'alert' | 'watch' | 'ok' | 'unknown';

export const REVIEW_MODES: { key: ReviewMode; label: string }[] = [
  { key: 'center', label: 'Par poste' },
  { key: 'category', label: 'Par catégorie' },
  { key: 'both', label: 'Poste et catégories' },
];

/** Groupe de charges dans le détail d'une carte (une catégorie, ou « Sans catégorie », ou tout le plafond). */
export interface ChargeGroup {
  key: string;
  label: string | null;
  note: string | null;
  health: CardHealth | null;
  overCents: number;
  charges: ReviewCharge[];
}

export interface CapCard {
  key: string;
  level: 'Poste' | 'Catégorie';
  title: string;
  centerRef: string;
  categoryId: string | null;
  health: CardHealth;
  healthLabel: string;
  description: string;
  facts: { label: string; value: string; note?: string }[];
  gauge: LifeGauge;
  alert: string | null;
  overCents: number;
  groups: ChargeGroup[];
  chargeCount: number;
}

type Row = ReviewCenter | ReviewCategory;

const HEALTH_LABEL: Record<CardHealth, string> = { alert: 'Plafond dépassé', watch: 'Proche du plafond', ok: 'Dans le plafond', unknown: 'Sans plafond' };
const HEALTH_ORDER: Record<CardHealth, number> = { alert: 0, watch: 1, ok: 2, unknown: 3 };

export function healthOf(r: Pick<Row, 'capCents' | 'engagedCents' | 'over'>): CardHealth {
  return { none: 'unknown', over: 'alert', near: 'watch', ok: 'ok' }[capTone(r)] as CardHealth;
}

const overOf = (r: Row) => (r.over && r.marginCents !== null ? -r.marginCents : 0);
const plural = (n: number, one: string, many = one + 's') => `${n} ${n > 1 ? many : one}`;

const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
export const monthText = (ymd: string) => MONTH.format(new Date(`${ymd}T00:00:00`));

/** Récurrence d'une charge en une ligne : rythme, puis poids moyen par mois et par an. */
export function recurrenceText(c: ReviewCharge): { label: string; note: string | null } {
  if (c.cadence === 'once' || c.perYearCents === null) return { label: 'Ponctuelle', note: c.projectCharge ? 'Charge de projet validée' : null };
  return { label: c.cadenceLabel, note: `${cents(c.monthlyCents ?? 0)} / mois en moyenne · ${cents(c.perYearCents)} / an` };
}

/** Antériorité : depuis quand la charge pèse (récurrence) ou sa date (ponctuelle). */
export function anteriorityText(c: ReviewCharge): { label: string; note: string | null } {
  const since = c.sinceMonths === 0 ? 'ce mois-ci' : `il y a ${plural(c.sinceMonths, 'mois', 'mois')}`;
  if (c.rank !== null) return { label: `Depuis ${monthText(c.origin)}`, note: `${c.rank === 1 ? '1re' : `${c.rank}e`} échéance · ${c.newThisPeriod ? 'nouvelle cette période' : `commencée ${since}`}` };
  return { label: c.newThisPeriod ? 'Nouvelle cette période' : `Prévue en ${monthText(c.origin)}`, note: `Ponctuelle · ${since}` };
}

export const statusText = (c: ReviewCharge) => (c.engagedAs === 'paid' ? 'Payée' : c.status === 'late' ? 'En retard' : c.status === 'due' ? 'Du jour' : 'À payer');

function gaugeOf(r: Row): LifeGauge {
  const h = healthOf(r);
  const cap = r.capCents;
  const margin = r.marginCents ?? 0;
  return {
    heading: 'Plafond de la période',
    signal: cap === null ? 'Sans plafond' : r.over ? `Dépassé de ${cents(-margin)}` : `Reste ${cents(margin)}`,
    tone: h === 'alert' ? 'red' : h === 'watch' ? 'orange' : h === 'ok' ? 'green' : 'unknown',
    first: { label: 'Plafond', value: cap === null ? '—' : cents(cap) },
    middle: { label: 'Engagé', value: cents(r.engagedCents), kind: 'spend' },
    last: { label: r.over ? 'Au-delà' : 'Reste', value: cap === null ? '—' : cents(Math.abs(margin)) },
    meter: {
      percent: r.usedPct === null ? null : Math.min(100, Math.max(0, r.usedPct)),
      label: r.usedPct === null ? '—' : percentText(r.usedPct, 0),
      aria: cap === null ? 'Sans plafond' : `${percentText(r.usedPct ?? 0, 0)} du plafond engagé`,
    },
    caption: `Payé ${cents(r.paidCents)} · à payer ${cents(r.toPayCents)}`,
    band: null,
  };
}

function facts(r: Row) {
  return [
    { label: 'Plafond', value: r.capCents === null ? 'Aucun' : cents(r.capCents) },
    { label: 'Payé', value: cents(r.paidCents), note: 'réglé dans la période' },
    { label: 'À payer', value: cents(r.toPayCents), note: 'prévu, pas encore réglé' },
    { label: 'Charges', value: String(r.lineCount) },
  ];
}

const pick = (d: CapsReview, ids: string[]) => ids.map((id) => d.charges[id]).filter(Boolean);

/** Période terminée ou close : la revue devient un bilan (aucun « nouvel achat » à surveiller). */
export const isPastReading = (d: Pick<CapsReview, 'totals'>) => d.totals?.reading === 'closed' || d.totals?.reading === 'ended';

function centerAlert(c: ReviewCenter, past = false): string | null {
  if (c.over)
    return past
      ? `La période s’est terminée ${cents(overOf(c))} au-delà du plafond de ce poste.`
      : `${cents(overOf(c))} au-delà du plafond. Chaque nouvelle dépense de ce poste creuse l'écart, à compenser sur d'autres postes pour ne pas finir la période en déficit.`;
  if (c.capCents !== null && healthOf(c) === 'watch')
    return past ? `La période s’est terminée à ${cents(c.marginCents ?? 0)} du plafond.` : `Plus que ${cents(c.marginCents ?? 0)} avant le plafond : vérifiez avant tout nouvel achat.`;
  return null;
}

function categoryAlert(k: ReviewCategory, center: ReviewCenter | undefined, past = false): string | null {
  if (k.over) {
    const absorbed = center && center.capCents !== null && !center.over;
    if (past)
      return `La période s’est terminée ${cents(overOf(k))} au-delà du plafond de la catégorie${absorbed ? `, absorbés par le poste « ${center!.label} » resté dans son plafond` : ''}.`;
    return `${cents(overOf(k))} au-delà du plafond de la catégorie. ${
      absorbed ? `Le poste « ${center!.label} » reste dans son plafond : l'écart y est absorbé, au détriment de ses autres dépenses.` : 'Chaque nouvelle dépense creuse l’écart, à compenser ailleurs dans le budget.'
    }`;
  }
  if (k.capCents !== null && healthOf(k) === 'watch')
    return past ? `La période s’est terminée à ${cents(k.marginCents ?? 0)} du plafond de la catégorie.` : `Plus que ${cents(k.marginCents ?? 0)} avant le plafond de la catégorie.`;
  return null;
}

/** Cartes de la revue selon le regroupement choisi ; dépassements d'abord, puis par consommation. */
export function reviewCards(d: CapsReview, mode: ReviewMode): CapCard[] {
  const past = isPastReading(d);
  const centerOf = (ref: string) => d.centers.find((c) => c.ref === ref);
  const cards: CapCard[] = [];
  if (mode === 'center') {
    for (const c of d.centers.filter((x) => x.capCents !== null)) {
      const charges = pick(d, c.chargeIds);
      cards.push({
        key: c.ref,
        level: 'Poste',
        title: c.label,
        centerRef: c.ref,
        categoryId: null,
        health: healthOf(c),
        healthLabel: HEALTH_LABEL[healthOf(c)],
        description: `Toutes les charges du poste sur la période, catégorisées ou non.`,
        facts: facts(c),
        gauge: gaugeOf(c),
        alert: centerAlert(c, past),
        overCents: overOf(c),
        groups: [{ key: c.ref, label: null, note: null, health: null, overCents: overOf(c), charges }],
        chargeCount: charges.length,
      });
    }
  } else if (mode === 'category') {
    for (const k of d.categories.filter((x) => x.capCents !== null)) {
      const charges = pick(d, k.chargeIds);
      cards.push({
        key: k.id,
        level: 'Catégorie',
        title: k.label,
        centerRef: k.costCenterRef,
        categoryId: k.archived ? null : k.id,
        health: healthOf(k),
        healthLabel: HEALTH_LABEL[healthOf(k)],
        description: `Catégorie du poste « ${k.costCenterLabel} »${k.archived ? ' (retirée des choix, ses dépenses restent rangées)' : ''}.`,
        facts: facts(k),
        gauge: gaugeOf(k),
        alert: categoryAlert(k, centerOf(k.costCenterRef), past),
        overCents: overOf(k),
        groups: [{ key: k.id, label: null, note: null, health: null, overCents: overOf(k), charges }],
        chargeCount: charges.length,
      });
    }
  } else {
    for (const c of d.centers) {
      const cats = d.categories.filter((k) => k.costCenterRef === c.ref);
      const cappedCats = cats.filter((k) => k.capCents !== null);
      if (c.capCents === null && !cappedCats.length) continue;
      const overCats = cappedCats.filter((k) => k.over);
      const health: CardHealth = c.over || overCats.length ? 'alert' : healthOf(c) === 'watch' || cappedCats.some((k) => healthOf(k) === 'watch') ? 'watch' : 'ok';
      const all = pick(d, c.chargeIds);
      const groups: ChargeGroup[] = cats
        .map((k) => ({
          key: k.id,
          label: k.label,
          note: k.capCents === null ? 'Sans plafond' : k.over ? `Dépassé de ${cents(overOf(k))} · plafond ${cents(k.capCents)}` : `Reste ${cents(k.marginCents ?? 0)} sur ${cents(k.capCents)}`,
          health: k.capCents === null ? null : healthOf(k),
          overCents: overOf(k),
          charges: all.filter((x) => x.categoryId === k.id),
        }))
        .filter((g) => g.charges.length || g.health !== null)
        .sort((x, y) => y.overCents - x.overCents);
      const loose = all.filter((x) => !x.categoryId);
      if (loose.length) groups.push({ key: `${c.ref}:none`, label: 'Sans catégorie', note: null, health: null, overCents: 0, charges: loose });
      const catAlerts = overCats.map((k) => `« ${k.label} » +${cents(overOf(k))}`);
      cards.push({
        key: c.ref,
        level: 'Poste',
        title: c.label,
        centerRef: c.ref,
        categoryId: null,
        health,
        healthLabel: !c.over && overCats.length ? (overCats.length > 1 ? 'Catégories dépassées' : 'Catégorie dépassée') : HEALTH_LABEL[health],
        description: cappedCats.length ? `${plural(cappedCats.length, 'catégorie plafonnée', 'catégories plafonnées')} dans ce poste, avec une limite indépendante.` : 'Aucune catégorie plafonnée dans ce poste.',
        facts: [...facts(c).slice(0, 3), { label: 'Catégories dépassées', value: overCats.length ? catAlerts.join(', ') : 'Aucune' }],
        gauge: gaugeOf(c),
        alert: centerAlert(c, past) ?? (overCats.length ? categoryAlert(overCats[0], c, past) : null),
        overCents: Math.max(overOf(c), ...overCats.map(overOf), 0),
        groups,
        chargeCount: all.length,
      });
    }
  }
  return cards.sort((x, y) => HEALTH_ORDER[x.health] - HEALTH_ORDER[y.health] || y.overCents - x.overCents || x.title.localeCompare(y.title, 'fr'));
}

/** Synthèse de la revue (bandeau) : dépassements par niveau, plafonds proches, consommation des postes. */
export function reviewSummary(d: CapsReview) {
  const capped = d.centers.filter((c) => c.capCents !== null);
  const cats = d.categories.filter((k) => k.capCents !== null);
  const capCents = capped.reduce((t, c) => t + (c.capCents ?? 0), 0);
  const engagedCents = capped.reduce((t, c) => t + c.engagedCents, 0);
  return {
    overCenters: capped.filter((c) => c.over).length,
    overCategories: cats.filter((k) => k.over).length,
    near: [...capped, ...cats].filter((r) => healthOf(r) === 'watch').length,
    within: [...capped, ...cats].filter((r) => healthOf(r) === 'ok').length,
    capCents,
    engagedCents,
    usedPct: capCents ? Math.round((engagedCents / capCents) * 1000) / 10 : null,
  };
}
