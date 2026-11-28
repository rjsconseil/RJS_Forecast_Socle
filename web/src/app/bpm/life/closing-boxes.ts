import { cents, signedCents } from '../../core/format';
import { Bilan } from '../data/bpm-bilans.models';
import { ClosingChecks, ClosingGroup, ClosingJourney, ClosingPoint } from '../data/bpm-closing.models';
import { AlertTone, KeyBox, KeyColumn, worst } from './closing-kit';
import { checkTone } from './closing-resolution';

/**
 * Les chiffres clés de la clôture : encadrés et colonnes de chaque section, calculés à partir du parcours rendu par le
 * serveur. Fonctions pures, sans état ni injection : la page leur passe ce qu'elle lit, et les présente.
 */

/** Libellés courts des étapes, pour le tableau. */
export const STEP_LABEL: Record<ClosingGroup, string> = { income: 'Entrées reçues', charges: 'Charges réglées', projects: 'Flux des projets', decisions: 'Décisions de financement' };
const CHECK_STATE: Record<string, string> = { ok: 'bon', warn: 'à voir', fail: 'bloque', later: 'après le cycle' };

export const isUrgent = (p: ClosingPoint) => p.status === 'late' || p.status === 'due';
/** « 1 déc. » */
export function shortDay(ymd: string) {
  return new Date(`${ymd}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
export const signed = (c: number | null | undefined) => (c === null || c === undefined ? '—' : signedCents(c));
export const keep = <T>(xs: (T | false | null | undefined | 0 | '')[]) => xs.filter(Boolean) as T[];
export const pct = (value: number) => value.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/** Ce qui empêche la clôture : vérification du compte, contrôle bloquant en échec. */
export interface BlockingPoint { label: string; detail: string; tone: AlertTone }
/** Une condition restante avant de pouvoir clôturer. */
export interface CloseCondition { label: string; tone: AlertTone }

// ---------- 1. à valider ----------
export interface PathInput {
  j: ClosingJourney | null;
  open: ClosingPoint[];
  closed: ClosingPoint[];
  blocking: BlockingPoint[];
  openTone: AlertTone;
  openVerdict: string;
  closing: boolean;
  /** Points clos depuis le dernier passage, et l'heure de ce passage. */
  since: number;
  baselineTime: string | null;
}
export function pathBoxes(x: PathInput): KeyBox[] {
  const { j, open, blocking } = x;
  if (!j?.counts || !j.period) return [];
  const n = j.counts;
  const urgent = open.filter(isUrgent).length;
  const upcoming = open.length - urgent;
  const last = x.closed[0];
  return [
    {
      label: 'Points à valider', value: String(open.length), tone: x.openTone,
      part: open.length ? { value: String(urgent), label: urgent > 1 ? 'urgents' : 'urgent', tone: urgent ? 'n4' : 'ok' } : null,
      lines: keep([x.openVerdict, upcoming && !x.closing ? `${upcoming} à venir d’ici le ${shortDay(j.period.end)}` : null]),
    },
    {
      label: 'Points clos', value: String(n.closed), tone: n.closed ? 'ok' : 'neutral',
      part: n.deferred ? { value: String(n.deferred), label: 'à revoir plus tard', tone: 'n1' } : null,
      bar: { pct: j.percent, tone: 'ok' },
      lines: keep([
        `sur ${plural(n.total, 'point')} du cycle, ${j.percent} % traités`,
        last ? `dernier : ${last.label}${last.closedOn ? `, le ${shortDay(last.closedOn)}` : ''}` : null,
        x.since && x.baselineTime ? `+${x.since} depuis votre passage de ${x.baselineTime}` : null,
      ]),
    },
    {
      label: 'Points bloquants', value: String(blocking.length), tone: blocking.length ? worst(...blocking.map((b) => b.tone)) : 'ok',
      lines: blocking.length ? blocking.map((b) => `${b.label} : ${b.detail}`) : ['Aucun point bloquant', 'la clôture n’attend que les points à valider'],
    },
  ];
}
/** Une colonne par étape : son libellé, puis ce qui est fait sur ce qu'il fallait faire. */
export function pathColumns(j: ClosingJourney | null, open: ClosingPoint[], closing: boolean): KeyColumn[] {
  if (!j?.period) return [];
  return j.criteria.map((c) => {
    const urgentHere = open.filter((p) => p.group === c.key && isUrgent(p)).length;
    const tone: AlertTone = c.state === 'done' ? 'ok' : c.state === 'none' ? 'neutral' : c.state === 'later' ? 'n1' : closing ? 'n4' : !urgentHere ? 'n1' : urgentHere > 2 ? 'n3' : 'n2';
    return {
      label: STEP_LABEL[c.key],
      value: c.state === 'none' ? '—' : `${c.done} / ${c.total}`,
      tone,
      sub: c.state === 'none' ? 'sans objet' : urgentHere ? `${urgentHere} en retard` : c.state === 'done' ? 'fait' : c.state === 'later' ? 'à venir' : 'en cours',
    };
  });
}

// ---------- 2. résultat et cycle suivant ----------
export function resultTone(b: Bilan | null, j: ClosingJourney | null): AlertTone {
  const f = b?.flows;
  const result = f?.resultCents ?? j?.netCents ?? null;
  if (result === null) return 'neutral';
  return result >= 0 ? 'ok' : -result <= (f?.receivedCents ?? 0) * 0.1 ? 'n3' : 'n4';
}
export function resultBoxes(b: Bilan | null, j: ClosingJourney | null): KeyBox[] {
  const tone = resultTone(b, j);
  if (!b) return j ? [{ label: 'Résultat à ce jour', value: signed(j.netCents), tone }] : [];
  const f = b.flows;
  const received = f.receivedCents ?? 0;
  const spent = f.spentCents ?? 0;
  const max = Math.max(1, received, spent);
  const ratio = received ? spent / received : spent ? 2 : 0;
  const spentTone: AlertTone = ratio <= 0.6 ? 'n1' : ratio <= 0.85 ? 'n2' : ratio <= 1 ? 'n3' : 'n4';
  const result = f.resultCents ?? received - spent;
  const rate = f.savingsRatePct;
  const target = f.savingsTargetCents ?? null;
  const savingTone: AlertTone = target
    ? result >= target ? 'ok' : result >= target / 2 ? 'n2' : result > 0 ? 'n3' : 'n4'
    : rate === null ? 'neutral' : rate >= 20 ? 'ok' : rate >= 10 ? 'n1' : rate >= 0 ? 'n2' : 'n4';
  return [
    { label: 'Reçu', value: cents(received), tone: 'ok', bar: { pct: (received * 100) / max, tone: 'ok' }, lines: [plural(f.receivedCount ?? 0, 'entrée')] },
    { label: 'Dépensé', value: cents(spent), tone: spentTone, bar: { pct: (spent * 100) / max, tone: spentTone }, lines: keep([plural(f.paidCount ?? 0, 'paiement'), received ? `${pct(ratio * 100)} % des entrées` : null]) },
    { label: 'Résultat', value: signedCents(result), tone, lines: [b.source === 'provisoire' ? 'à ce jour, figé à la clôture' : 'figé à la clôture'] },
    {
      label: 'Épargne', value: rate === null ? '—' : `${pct(rate)} %`, tone: savingTone,
      bar: rate === null ? null : { pct: Math.max(0, Math.min(100, rate)), tone: savingTone },
      lines: [target ? (result >= target ? `objectif ${cents(target)} atteint` : `objectif ${cents(target)} : manque ${cents(target - result)}`) : 'des entrées conservées'],
    },
  ];
}
export function nextBoxes(j: ClosingJourney | null): KeyBox[] {
  const im = j?.impacts;
  if (!j?.period || !im) return [];
  const parts = [im.recurring, im.planned, im.projects, im.deferred.intoNext];
  const income = parts.reduce((t, p) => t + p.incomeCents, 0);
  const charge = parts.reduce((t, p) => t + p.chargeCents, 0);
  const balanceTone: AlertTone = im.balanceCents >= 0 ? 'ok' : -im.balanceCents <= income * 0.05 ? 'n3' : 'n4';
  const cap = im.capitalization.resultCents ?? 0;
  const waiting = im.deferred.count + im.decisions.count;
  return [
    { label: `Solde prévu de ${im.next.label}`, value: signedCents(im.balanceCents), tone: balanceTone, lines: [`entrées ${cents(income)} · charges ${cents(charge)}`, im.opensEntries ? 'entrées rouvertes par la clôture' : `entrées ouvertes à la clôture de ${j.period.label}`] },
    {
      label: 'Versé au patrimoine', value: signedCents(cap), tone: cap >= 0 ? 'ok' : 'n4',
      lines: keep([im.capitalization.provisional ? 'à ce jour, versé à la clôture' : `au ${shortDay(im.capitalization.date)}`, im.capitalization.stockBefore !== null && im.capitalization.stockAfter !== null ? `stock ${cents(im.capitalization.stockBefore * 100)} → ${cents(im.capitalization.stockAfter * 100)}` : null]),
    },
    { label: 'Budget récurrent', value: plural(im.recurring.count, 'échéance'), tone: 'n1', lines: [`entrées ${cents(im.recurring.incomeCents)}`, `charges ${cents(im.recurring.chargeCents)}`] },
    { label: 'Reports et décisions', value: String(waiting), tone: waiting ? 'n2' : 'ok', lines: [plural(im.deferred.count, 'point reporté', 'points reportés'), plural(im.decisions.count, 'décision en attente', 'décisions en attente')] },
  ];
}

// ---------- 3. cohérence ----------
export function checkBoxes(c: ClosingChecks | null | undefined): KeyBox[] {
  if (!c) return [];
  const toSee = c.items.filter((x) => x.level !== 'blocking' && x.state === 'warn');
  const blocking = c.items.filter((x) => x.level === 'blocking' && (x.state === 'fail' || x.state === 'warn'));
  return [
    { label: 'Contrôles bons', value: `${c.ok} / ${c.total}`, tone: c.ok === c.total ? 'ok' : 'neutral', bar: { pct: (c.ok * 100) / Math.max(1, c.total), tone: 'ok' }, lines: [c.later ? `${plural(c.later, 'contrôle')} après le dernier jour` : 'tous vérifiables aujourd’hui'] },
    { label: 'À voir', value: String(toSee.length), tone: toSee.length ? worst(...toSee.map(checkTone)) : 'ok', lines: toSee.length ? toSee.map((x) => `${x.label} : ${x.value}`) : ['Rien à voir'] },
    {
      label: 'Bloquants', value: String(blocking.length), tone: blocking.length ? worst(...blocking.map(checkTone)) : 'ok',
      lines: blocking.length ? blocking.map((x) => `${x.label} : ${x.value}${x.state === 'warn' ? ' (bloquera la clôture)' : ''}`) : ['Aucun bloquant : rien n’arrête la clôture'],
    },
  ];
}
export function checkColumns(c: ClosingChecks | null | undefined): KeyColumn[] {
  return (c?.items ?? []).map((x) => ({ label: x.label, value: x.value, tone: checkTone(x), sub: CHECK_STATE[x.state] }));
}

// ---------- 4. clôturer ----------
/** Ce qui manque encore pour clôturer : points à valider, points bloquants. */
export function closeConditions(j: ClosingJourney | null, openCount: number, closing: boolean, openTone: AlertTone, blocking: BlockingPoint[]): CloseCondition[] {
  if (!j?.period) return [];
  const list: CloseCondition[] = [];
  if (openCount) list.push({ label: plural(openCount, 'point à valider', 'points à valider'), tone: closing ? 'n4' : openTone === 'neutral' ? 'n1' : openTone });
  for (const b of blocking) list.push({ label: `${b.label} (${b.detail})`, tone: b.tone });
  return list;
}
export function closeTone(j: ClosingJourney | null, conditions: CloseCondition[]): AlertTone {
  if (!j?.period) return 'neutral';
  if (j.canClose) return 'ok';
  return j.phase === 'to_close' ? (conditions.length > 2 ? 'n4' : 'n3') : 'n1';
}
export function closeBoxes(j: ClosingJourney | null, conditions: CloseCondition[]): KeyBox[] {
  if (!j?.period) return [];
  const a = j.actions;
  const c = j.checks;
  const pv = j.closing?.preview ?? null;
  const tone = closeTone(j, conditions);
  const state: KeyBox = j.canClose
    ? { label: 'État de la clôture', value: 'Prête', tone: 'ok', bar: { pct: 100, tone: 'ok' }, lines: ['tout est traité et cohérent'] }
    : j.phase === 'to_close'
      ? { label: 'État de la clôture', value: `${j.percent} %`, tone, bar: { pct: j.percent, tone }, lines: ['en clôture : à finaliser sur cette page'] }
      : { label: 'État de la clôture', value: `Le ${shortDay(j.opensOn!)}`, tone: 'n1', bar: { pct: j.percent, tone: 'n1' }, lines: [`dans ${plural(j.days?.left ?? 0, 'jour')}, à la fin du dernier jour`, `cycle complété à ${j.percent} %`] };
  return [
    state,
    { label: 'Conditions restantes', value: String(conditions.length), tone: conditions.length ? worst(...conditions.map((x) => x.tone)) : 'ok', lines: conditions.length ? conditions.map((x) => x.label) : ['Toutes les conditions sont remplies'] },
    {
      label: 'Ce qui sera figé', value: a ? plural(a.total, 'action') : '—', tone: 'n1',
      lines: keep([`${c ? plural(c.total, 'contrôle') : 'les contrôles'}, le bilan et le résultat ${signed(pv?.resultCents ?? j.netCents)}`, j.lastClosure ? `dernière clôture : ${j.lastClosure.periodLabel} (${signed(j.lastClosure.resultCents)})` : null]),
    },
  ];
}
