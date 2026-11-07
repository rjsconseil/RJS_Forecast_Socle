// Gestion du projet de vie : chaque volet de la lecture `life-management` devient une carte pleine largeur,
// au format des cartes de « Gestion de projet » (identité, jauge, alerte, détail dépliable, commandes).
// Fonctions pures : aucun appel, aucun état ; les montants restent ceux de l'API (centimes).
import { BpmLifeManagement, LifeHealth, LifeNature, LifeVoletKey } from '../../core/bpm-life.models';
import { cents, percentText, shortDate, signedCents } from '../../core/format';
import { FUNDING } from '../ui/project-funding';
import { LifeGauge, LifeGaugeTone } from './life-gauge';

export type VoletAction = 'entry-income' | 'entry-charge' | 'follow' | 'close';

export interface VoletLink {
  label: string;
  link?: string;
  fragment?: string;
  queryParams?: Record<string, string>;
  action?: VoletAction;
}

export interface VoletView {
  key: LifeVoletKey;
  index: number;
  title: string;
  link: VoletLink;
  health: LifeHealth;
  healthLabel: string;
  tag: string;
  description: string;
  facts: { label: string; value: string; note?: string }[];
  gauge: LifeGauge;
  /** Jauge sans objet (aucun projet…) : la carte reste courte au lieu d'afficher des zéros. */
  hideGauge?: boolean;
  alert: string | null;
  disclosure: { label: string; summary: string };
  primary: VoletLink;
  actions: VoletLink[];
  figures: { label: string; value: string; pending?: boolean }[];
}

export const HEALTH_TONE: Record<LifeHealth, LifeGaugeTone> = { ok: 'green', watch: 'orange', alert: 'red', unknown: 'unknown' };

const ratio = (part: number | null | undefined, whole: number | null | undefined) =>
  part === null || part === undefined || !whole || whole <= 0 ? null : Math.round((part / whole) * 1000) / 10;
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const listOf = (labels: string[]) =>
  !labels.length ? 'aucun poste pour l’instant' : labels.length === 1 ? labels[0].toLowerCase() : `${labels.slice(0, -1).join(', ').toLowerCase()} et ${labels.at(-1)!.toLowerCase()}`;

type CycleFlows = NonNullable<BpmLifeManagement['cycle']['flows']>;

/** Légende du cycle : les avances (réglées au cycle précédent) sont nommées, sinon le solde paraît inexpliqué. */
function cycleCaption(f: CycleFlows): string {
  const parts = [`À recevoir ${cents(f.toReceiveCents)}`, `À payer ${cents(f.toPayCents)}`, `Budget initial ${signedCents(f.initialBudgetCents)}`];
  if (f.advanceReceivedCents) parts.push(`Reçu d’avance ${cents(f.advanceReceivedCents)}`);
  if (f.advancePaidCents) parts.push(`Payé d’avance ${cents(f.advancePaidCents)}`);
  if (f.advanceReceivedCents || f.advancePaidCents) parts.push(`Avances comprises ${signedCents(f.balancedCents)}`);
  if (f.incomeGapCents) parts.push(`Écart reçu / prévu ${signedCents(f.incomeGapCents)}`);
  if (f.unrealizedIncomeCents) parts.push(`Jamais reçu ${cents(f.unrealizedIncomeCents)}`);
  if (f.unrealizedChargeCents) parts.push(`Jamais réglé ${cents(f.unrealizedChargeCents)}`);
  return parts.join(' · ');
}

function cycleVolet(d: BpmLifeManagement): VoletView {
  const c = d.cycle;
  const f = c.flows;
  const p = c.period;
  const kept = f ? ratio(f.netCents, f.receivedCents) : null;
  return {
    key: 'cycle',
    index: 1,
    title: p ? c.label : 'Cycle à configurer',
    link: { label: 'Tableau de bord', link: '/tableau-de-bord' },
    health: c.health,
    healthLabel: c.healthLabel,
    tag: !p ? 'Jour d’ancrage à choisir' : c.reading === 'closed' ? `${p.label} · clôturé` : c.reading === 'ended' ? `${p.label} · à clôturer` : `${p.label} · clôture le ${shortDate(p.end)}`,
    description: 'Ce qui entre, ce qui sort et ce qui reste prévu jusqu’à la clôture du cycle.',
    facts: [
      { label: 'Jours restants', value: c.days ? `${c.days.left}` : '—', note: c.days ? `sur ${c.days.total} jours` : 'Cycle à configurer' },
      {
        label: 'Entrées reçues',
        value: f ? `${f.receivedCount} / ${f.incomeCount}` : '—',
        note: [
          f?.nextIncome ? `Prochaine : ${shortDate(f.nextIncome.plannedDate)}` : f?.incomeCount ? 'Toutes reçues' : 'Aucune entrée prévue',
          f?.advanceReceivedCount ? `dont ${count(f.advanceReceivedCount, 'reçue', 'reçues')} d’avance` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      },
      { label: 'Taux d’épargne', value: percentText(f?.savingsRatePct ?? null), note: 'Part des entrées conservée' },
    ],
    gauge: {
      heading: 'Budget du cycle',
      signal: c.healthLabel,
      tone: HEALTH_TONE[c.health],
      first: { label: 'Reçu', value: cents(f?.receivedCents) },
      middle: { label: 'Dépensé', value: cents(f?.paidCents), kind: 'spend' },
      last: c.reading === 'closed' ? { label: 'Résultat clôturé', value: signedCents(c.closedResultCents) } : { label: 'Solde prévu à la clôture', value: signedCents(f?.expectedCents) },
      meter: {
        percent: kept === null ? null : Math.max(0, kept),
        label: `${percentText(kept, 0)} conservé`,
        aria: kept === null ? 'Aucune entrée reçue' : `${percentText(kept, 0)} des entrées reçues restent après les dépenses`,
      },
      caption: f ? cycleCaption(f) : null,
      band: c.days
        ? { label: 'Période écoulée', value: `${c.days.elapsed}`, unit: 'j', sub: `sur ${c.days.total} j`, percent: c.days.elapsedPct, percentLabel: percentText(c.days.elapsedPct, 0), tone: 'blue' }
        : { label: 'Période écoulée', value: '—', percent: null, percentLabel: 'À configurer', tone: 'unknown', note: 'Choisissez le jour d’ancrage du cycle dans les réglages.' },
    },
    alert: c.alert,
    disclosure: {
      label: 'Entrées & écarts du cycle',
      summary: f ? `${count(f.incomeCount, 'entrée prévue', 'entrées prévues')} · écart au budget initial ${signedCents(f.gapToInitialCents)}` : 'Cycle à configurer',
    },
    primary: { label: 'Piloter le cycle', link: '/tableau-de-bord' },
    actions: [
      { label: 'Saisir une entrée', action: 'entry-income' },
      { label: 'Budget & réel', link: '/piloter', fragment: 'bp-groupe-chiffres' },
      { label: 'Détail du solde', link: '/argent/reste' },
      { label: 'Réglages du cycle', link: '/app/reglages' },
    ],
    figures: [
      { label: 'À recevoir', value: cents(f?.toReceiveCents) },
      c.reading === 'closed'
        ? { label: 'Jamais reçues', value: `${f?.unrealizedIncomeCount ?? 0}`, pending: (f?.unrealizedIncomeCount ?? 0) > 0 }
        : { label: 'Entrées en retard', value: `${f?.lateIncomeCount ?? 0}`, pending: (f?.lateIncomeCount ?? 0) > 0 },
    ],
  };
}

/** Légende des charges : plafonds, puis ce qui explique que Prévu ≠ Réglé + Reste à payer. */
function natureCaption(x: LifeNature): string {
  const cats = x.categories ?? [];
  const overCats = cats.filter((k) => k.over);
  const overCenters = x.rows.filter((r) => r.over).length;
  const parts = [
    x.capCents === null
      ? cats.length ? 'Aucun plafond par poste' : 'Aucun plafond'
      : `Plafonds ${cents(x.capCents)} · marge ${signedCents(x.marginCents)}${overCenters ? ` · ${count(overCenters, 'poste dépassé', 'postes dépassés')}` : ''}`,
  ];
  if (cats.length) parts.push(`${count(cats.length, 'catégorie plafonnée', 'catégories plafonnées')}${overCats.length ? ` dont ${overCats.length} dépassée${overCats.length > 1 ? 's' : ''} (${overCats.map((k) => `${k.label} ${signedCents(k.marginCents)}`).join(', ')})` : ', toutes dans leur plafond'}`);
  if (x.realizationGapCents) parts.push(`Écart réglé / prévu ${signedCents(x.realizationGapCents)}`);
  if (x.otherCyclePaidCents) parts.push(`Dont ${cents(x.otherCyclePaidCents)} réglés pour un autre cycle`);
  return parts.join(' · ');
}

function natureVolet(x: LifeNature): VoletView {
  const essential = x.key === 'indispensable';
  const settled = ratio(x.settledCount, x.lineCount);
  return {
    key: x.key,
    index: essential ? 2 : 3,
    title: x.label,
    link: { label: x.label, link: '/depenses', queryParams: { nature: x.key } },
    health: x.health,
    healthLabel: x.healthLabel,
    tag: count(x.centers.length, 'poste'),
    description: essential ? 'Ce qu’il faut payer pour vivre : à régler à temps, avant tout le reste.' : 'La vie de tous les jours : profiter de ce que l’on a sans entamer l’essentiel.',
    facts: essential
      ? [
          { label: 'En retard', value: cents(x.lateCents), note: x.lateCount ? count(x.lateCount, 'échéance') : 'Aucun retard' },
          { label: 'Prochaine échéance', value: x.next ? shortDate(x.next.plannedDate) : '—', note: x.next ? `${x.next.label} · ${cents(x.next.plannedCents)}` : 'Rien à venir dans le cycle' },
          { label: 'Moyenne mensuelle', value: cents(x.monthlyAverageCents), note: 'Budget type' },
        ]
      : [
          { label: 'Disponible pour profiter', value: signedCents(x.availableCents ?? null), note: x.availableCents === null || x.availableCents === undefined ? (x.availableReason ?? 'Non calculable') : 'Après épargne visée et provisions' },
          { label: 'Par semaine', value: cents(x.weeklyCents ?? null), note: 'Montant indicatif' },
          { label: 'Moyenne mensuelle', value: cents(x.monthlyAverageCents), note: 'Budget type' },
        ],
    gauge: {
      heading: 'Paiements du cycle',
      signal: x.healthLabel,
      tone: HEALTH_TONE[x.health],
      first: { label: 'Prévu', value: cents(x.plannedCents) },
      middle: { label: essential ? 'Réglé' : 'Dépensé', value: cents(x.paidCents), kind: 'spend' },
      last: { label: 'Reste à payer', value: cents(x.toPayCents) },
      meter: {
        percent: x.consumedPct,
        label: `${percentText(x.consumedPct, 0)} réglé`,
        aria: x.consumedPct === null ? 'Aucune charge prévue' : `${percentText(x.consumedPct, 0)} du prévu est réglé`,
      },
      caption: natureCaption(x),
      band: essential
        ? { label: 'Échéances réglées', value: `${x.settledCount}`, sub: `sur ${x.lineCount}`, percent: settled, percentLabel: settled === null ? 'Aucune échéance' : percentText(settled, 0), tone: x.lateCount ? 'yellow' : 'green' }
        : { label: 'Part des dépenses du cycle', value: percentText(x.shareOfPaidPct, 0), sub: 'du dépensé total', percent: x.shareOfPaidPct, percentLabel: x.shareOfPaidPct === null ? 'Rien de dépensé' : percentText(x.shareOfPaidPct, 0), tone: 'blue' },
    },
    alert: x.alert,
    disclosure: { label: 'Postes & échéances', summary: `${capitalize(listOf(x.centers.map((c) => c.label)))} · ${count(x.lineCount, 'échéance')} dans le cycle` },
    primary: { label: essential ? 'Voir les charges indispensables' : 'Voir les charges courantes', link: '/depenses', queryParams: { nature: x.key } },
    actions: [
      { label: essential ? 'Saisir une charge' : 'Saisir une dépense', action: 'entry-charge' },
      { label: 'Échéances en retard', link: '/depenses', queryParams: { nature: x.key, status: 'late' } },
      { label: 'Plafonds et catégories', link: '/plafonds' },
      essential ? { label: 'Échéances à traiter', link: '/projet-de-vie', fragment: 'life-due' } : { label: 'Régler les objectifs', link: '/vision', fragment: 'objectifs-budgetaires' },
    ],
    figures: essential
      ? [
          { label: 'En retard', value: `${x.lateCount}`, pending: x.lateCount > 0 },
          { label: 'À régler aujourd’hui', value: `${x.dueTodayCount}`, pending: x.dueTodayCount > 0 },
        ]
      : [
          { label: 'Disponible', value: signedCents(x.availableCents ?? null) },
          { label: 'Par semaine', value: cents(x.weeklyCents ?? null) },
        ],
  };
}

function projectsVolet(d: BpmLifeManagement): VoletView {
  const p = d.projects;
  const decisions = p.pendingRequests.length + p.taskRequestCount;
  const remaining = ratio(p.remainingCents, p.allocatedCents + p.approvedOverrunCents);
  const funded = ratio(p.fundedCount, p.projectCount);
  return {
    key: 'projets',
    index: 4,
    title: p.label,
    link: { label: 'Gestion de projet', link: '/app/gestion-projet' },
    health: p.health,
    healthLabel: p.healthLabel,
    tag: `${p.fundedCount} / ${p.projectCount} financé${p.fundedCount > 1 ? 's' : ''}`,
    description: p.projectCount
      ? 'Les enveloppes des autres projets : leurs dépenses validées entrent dans le cycle.'
      : 'Aucun projet de la vie pour l’instant : un projet finance une envie par une enveloppe, ses dépenses validées entrent alors dans le cycle.',
    facts: !p.projectCount ? [{ label: 'Projets de la vie', value: '0', note: 'Créer un projet pour lui attribuer une enveloppe' }] : [
      { label: 'Projets financés', value: `${p.fundedCount} / ${p.projectCount}`, note: p.unfundedCount ? `${p.unfundedCount} sans enveloppe` : p.projectCount ? 'Tous dotés d’une enveloppe' : 'Aucun projet' },
      { label: 'Réglé validé ce cycle', value: cents(p.periodPaidCents), note: 'Compté dans le Dépensé' },
      {
        label: 'Décisions attendues',
        value: `${decisions}`,
        note: p.billable.length ? `${cents(p.billableCents)} à facturer` : p.nextBillingDate ? `Facturation le ${shortDate(p.nextBillingDate)}` : 'Rien à facturer',
      },
    ],
    gauge: {
      heading: 'Enveloppes des projets',
      signal: p.healthLabel,
      tone: HEALTH_TONE[p.health],
      first: { label: FUNDING.envelopes, value: cents(p.allocatedCents) },
      middle: { label: FUNDING.paidOnEnvelopes, value: cents(p.paidCents), kind: 'spend' },
      last: { label: FUNDING.remaining, value: cents(p.remainingCents) },
      meter: { percent: remaining, label: `${percentText(remaining, 0)} restant`, aria: remaining === null ? 'Aucune enveloppe attribuée' : `${percentText(remaining, 0)} des enveloppes restent à consommer` },
      caption: p.approvedOverrunCents ? `Dont ${cents(p.approvedOverrunCents)} de dépassement autorisé · ${cents(p.availableCents)} à répartir entre les tâches` : `${cents(p.availableCents)} à répartir entre les tâches`,
      band: { label: 'Projets financés', value: `${p.fundedCount}`, sub: `sur ${p.projectCount}`, percent: funded, percentLabel: funded === null ? 'Aucun projet' : percentText(funded, 0), tone: p.unfundedCount ? 'yellow' : 'green' },
    },
    hideGauge: !p.projectCount,
    alert: p.alert,
    disclosure: { label: 'Projets & décisions', summary: `${count(p.projectCount, 'projet')} · ${count(decisions, 'décision attendue', 'décisions attendues')}` },
    // Parcours le plus courant d'abord : décider ce qui attend, sinon piloter les projets.
    primary: !p.projectCount
      ? { label: 'Créer un projet de la vie', link: '/creer' }
      : decisions > 0
        ? { label: `Décider (${decisions})`, link: '/projet-de-vie', fragment: 'life-decisions' }
        : { label: 'Piloter les projets', link: '/app/gestion-projet' },
    actions: !p.projectCount ? [{ label: 'Gestion de projet', link: '/app/gestion-projet' }] : [
      decisions > 0 ? { label: 'Piloter les projets', link: '/app/gestion-projet' } : { label: 'Décisions & facturation', link: '/projet-de-vie', fragment: 'life-decisions' },
      { label: 'Dépenses des projets à régler', link: '/projet-de-vie', fragment: 'life-due' },
      { label: 'Tableau des projets', link: '/app/projets' },
      { label: 'Tâches des projets', link: '/app/taches' },
    ],
    figures: !p.projectCount ? [] : [
      { label: 'À facturer', value: cents(p.billableCents), pending: p.billable.length > 0 },
      { label: 'Décisions attendues', value: `${decisions}`, pending: decisions > 0 },
    ],
  };
}

function resultsGauge(d: BpmLifeManagement): Omit<LifeGauge, 'band'> {
  const r = d.results;
  const s = r.surplus;
  const base = { signal: r.healthLabel, tone: HEALTH_TONE[r.health] };
  if (s) {
    return {
      ...base,
      heading: 'Objectif d’excédent',
      first: { label: 'Objectif', value: cents(s.targetCents) },
      middle: { label: 'Cumulé', value: signedCents(s.cumulatedCents), kind: s.cumulatedCents >= 0 ? 'gain' : 'spend' },
      last: { label: 'Reste à dégager', value: cents(s.remainingCents) },
      meter: { percent: s.progressPct, label: `${percentText(s.progressPct, 0)} atteint`, aria: s.progressPct === null ? 'Objectif d’excédent à fixer' : `${percentText(s.progressPct, 0)} de l’objectif d’excédent atteint` },
      caption: `${cents(s.perPeriodCents)} par cycle, de ${s.startKey} à ${s.endKey} · ${s.onTrack ? 'en avance de' : 'en retard de'} ${cents(Math.abs(s.gapCents))} à date`,
    };
  }
  if (r.savingsTargetCents !== null) {
    const met = ratio(r.metCount, r.count);
    return {
      ...base,
      heading: 'Épargne visée',
      first: { label: 'Visée par cycle', value: cents(r.savingsTargetCents) },
      middle: { label: 'Cumul des résultats', value: signedCents(r.totalCents), kind: r.totalCents >= 0 ? 'gain' : 'spend' },
      last: { label: 'Moyenne par cycle', value: signedCents(r.averageCents) },
      meter: { percent: met, label: `${percentText(met, 0)} à l’objectif`, aria: met === null ? 'Aucun cycle clôturé' : `${percentText(met, 0)} des cycles atteignent l’épargne visée` },
      caption: 'Un objectif d’excédent sur plusieurs cycles se fixe dans « Objectifs du projet de vie ».',
    };
  }
  const positive = ratio(r.positiveCount, r.count);
  return {
    ...base,
    heading: 'Résultats des cycles',
    first: { label: 'Cumul des résultats', value: signedCents(r.totalCents) },
    middle: { label: 'Meilleur cycle', value: signedCents(r.best?.resultCents ?? null), kind: 'gain' },
    last: { label: 'Moins bon cycle', value: signedCents(r.worst?.resultCents ?? null) },
    meter: { percent: positive, label: `${percentText(positive, 0)} positifs`, aria: positive === null ? 'Aucun cycle clôturé' : `${percentText(positive, 0)} des cycles clôturés sont positifs` },
    caption: 'Fixez un objectif d’excédent dans « Objectifs et avenir » pour mesurer chaque cycle.',
  };
}

function resultsVolet(d: BpmLifeManagement): VoletView {
  const r = d.results;
  const cur = r.current;
  const reached = cur && cur.targetCents ? ratio(cur.expectedCents, cur.targetCents) : null;
  const closable = !!r.closing?.possible && !!r.firstOpen;
  const history: VoletLink = { label: 'Historique des cycles', link: '/tableau-de-bord', fragment: 'bm-history' };
  return {
    key: 'resultats',
    index: 5,
    title: r.label,
    link: { label: 'Historique des cycles', link: '/tableau-de-bord', fragment: 'bm-history' },
    health: r.health,
    healthLabel: r.healthLabel,
    tag: count(r.count, 'cycle clôturé', 'cycles clôturés'),
    description: 'Chaque clôture verse son résultat, positif ou négatif, au patrimoine.',
    facts: [
      { label: 'Cycles positifs', value: `${r.positiveCount} / ${r.count}`, note: r.negativeCount ? count(r.negativeCount, 'négatif', 'négatifs') : r.count ? 'Aucun négatif' : 'Aucun cycle clôturé' },
      { label: 'Moyenne par cycle', value: signedCents(r.averageCents), note: 'Résultats capitalisés' },
      { label: 'Dernier résultat', value: signedCents(r.last?.resultCents ?? null), note: r.last?.periodLabel ?? 'Aucune clôture' },
    ],
    gauge: {
      ...resultsGauge(d),
      band: cur
        ? {
            label: d.cycle.reading === 'current' ? 'Cycle en cours' : `Cycle lu · ${d.cycle.period?.label ?? ''}`,
            value: signedCents(cur.expectedCents),
            sub: cur.targetCents === null ? 'prévu à la clôture' : `prévu · objectif ${cents(cur.targetCents)}`,
            percent: reached,
            percentLabel: cur.targetCents === null ? 'Sans objectif' : cur.meetsTarget ? 'Objectif tenu' : 'Sous l’objectif',
            tone: cur.targetCents === null ? 'unknown' : cur.meetsTarget ? 'green' : 'yellow',
            note: r.surplus && !r.surplus.reached && r.surplus.requiredPerPeriodCents !== null ? `Pour atteindre l’objectif : ${cents(r.surplus.requiredPerPeriodCents)} par cycle restant.` : null,
          }
        : null,
    },
    alert: r.alert,
    disclosure: { label: 'Résultats cycle par cycle', summary: `${count(r.count, 'clôture')} · cumul ${signedCents(r.totalCents)}` },
    primary: closable ? { label: `Clôturer ${r.firstOpen!.label}`, action: 'close' } : history,
    actions: [
      { label: 'Objectif d’excédent', link: '/vision', fragment: 'objectifs-budgetaires' },
      closable ? history : { label: 'Suivi & clôture', action: 'follow' },
      { label: 'Épargne visée', link: '/vision', fragment: 'epargne' },
      { label: 'Projection du patrimoine', link: '/vision', fragment: 'life-projection' },
    ],
    figures: [
      { label: 'À clôturer', value: `${r.toCloseCount}`, pending: r.toCloseCount > 0 },
      { label: 'Cycles à l’objectif', value: `${r.metCount} / ${r.count}` },
    ],
  };
}

function patrimoineVolet(d: BpmLifeManagement): VoletView {
  const p = d.patrimoine;
  const reached = p.objectiveCents !== null && p.stockCents !== null && p.progressPct !== null && p.progressPct >= 100;
  return {
    key: 'patrimoine',
    index: 6,
    title: p.label,
    link: { label: 'Cap patrimonial', link: '/vision', fragment: 'cap-patrimonial' },
    health: p.health,
    healthLabel: p.healthLabel,
    tag: 'Patrimoine unique',
    description: 'Le stock d’ouverture et les résultats capitalisés, cycle après cycle.',
    facts: [
      { label: 'Stock d’ouverture', value: cents(p.openingStockCents), note: p.openingDate ? `au ${shortDate(p.openingDate)}` : 'Date à renseigner' },
      { label: 'Résultats capitalisés', value: signedCents(p.capitalizedCents), note: count(p.capitalizationCount, 'clôture') },
      { label: 'Objectif de stock', value: cents(p.objectiveCents), note: p.objectiveCents === null ? 'À fixer' : p.progressPct === null ? 'Avancement à mesurer : stock inconnu' : `${percentText(p.progressPct, 0)} atteint` },
    ],
    gauge: {
      heading: 'Patrimoine accumulé',
      signal: p.healthLabel,
      tone: HEALTH_TONE[p.health],
      first: { label: 'Stock enregistré', value: cents(p.stockCents) },
      middle: { label: 'Effet du cycle', value: signedCents(p.effectCents), kind: (p.effectCents ?? 0) >= 0 ? 'gain' : 'spend' },
      last: { label: 'Estimation après le cycle', value: cents(p.afterCents) },
      meter: { percent: p.progressPct, label: `${percentText(p.progressPct, 0)} de l’objectif`, aria: p.progressPct !== null ? `${percentText(p.progressPct, 0)} de l’objectif de stock` : p.objectiveCents !== null && p.stockCents === null ? 'Stock d’ouverture à renseigner' : 'Objectif de stock à fixer' },
      caption: p.expectedAfterCents !== null ? `Si tout le prévu se réalise : ${cents(p.expectedAfterCents)} à la clôture` : null,
      band:
        p.objectiveCents !== null
          ? p.progressPct === null
            ? { label: 'Reste pour l’objectif', value: cents(p.remainingCents), sub: `objectif ${cents(p.objectiveCents)}`, percent: null, percentLabel: 'À mesurer', tone: 'unknown', note: 'Renseignez le stock d’ouverture : l’avancement se mesure à partir du stock réel.' }
            : reached
              ? { label: 'Objectif atteint', value: signedCents(p.stockCents! - p.objectiveCents), sub: `au-delà de l’objectif de ${cents(p.objectiveCents)}`, percent: p.progressPct, percentLabel: percentText(p.progressPct, 0), tone: 'green', note: 'Le cap est franchi : fixez un nouveau cap ou un objectif daté pour la suite.' }
              : { label: 'Reste pour l’objectif', value: cents(p.remainingCents), sub: `objectif ${cents(p.objectiveCents)}`, percent: p.progressPct, percentLabel: percentText(p.progressPct, 0), tone: 'green' }
          : { label: 'Objectif de stock', value: 'À fixer', percent: null, percentLabel: 'Sans objectif', tone: 'unknown', note: 'Fixez un cap dans la page « Objectifs et avenir ».' },
    },
    alert: p.alert,
    disclosure: { label: 'Accumulation & capitalisations', summary: `${count(p.capitalizationCount, 'capitalisation')} · stock ${cents(p.stockCents)}` },
    primary: { label: 'Cap patrimonial', link: '/vision', fragment: 'cap-patrimonial' },
    actions: [
      { label: 'Projection & avenir', link: '/vision', fragment: 'life-projection' },
      { label: 'Objectifs de vie', link: '/vision', fragment: 'life-dated-goals' },
      { label: 'Soldes versés', link: '/tableau-de-bord', fragment: 'bm-history' },
      { label: 'Calendrier budgétaire', link: '/calendrier-budget' },
    ],
    figures: [
      reached ? { label: 'Au-delà de l’objectif', value: signedCents(p.stockCents! - p.objectiveCents!) } : { label: 'Reste pour l’objectif', value: cents(p.remainingCents) },
      { label: 'Capitalisations', value: `${p.capitalizationCount}` },
    ],
  };
}

/** Les six volets du projet de vie, dans l'ordre de pilotage. */
export function lifeVolets(d: BpmLifeManagement): VoletView[] {
  return [cycleVolet(d), natureVolet(d.natures.indispensable), natureVolet(d.natures.courante), projectsVolet(d), resultsVolet(d), patrimoineVolet(d)];
}

/** Commandes « Suivi & clôture » en attente : décisions du budget de vie, facturation, périodes à clôturer. */
export const followCount = (d: BpmLifeManagement) => d.projects.pendingRequests.length + d.projects.taskRequestCount + (d.projects.billable.length ? 1 : 0) + d.results.toCloseCount;
