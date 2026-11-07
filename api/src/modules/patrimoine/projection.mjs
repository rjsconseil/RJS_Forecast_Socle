// Projection patrimoniale (simulation, aucune écriture). Convention annuelle explicite :
// les objectifs de l'année de départ sont traités avant le premier rendement ; ensuite, pour chaque
// année n : rendement sur le capital de l'année précédente, puis apport annuel, puis objectifs de l'année.
//   apport annuel            = apport par période × fréquence annuelle (52, 12 ou 1)
//   indice des prix[n]       = indice des prix[n-1] × (1 + inflation / 100)
//   capital avant objectifs  = capital[n-1] × (1 + rendement / 100) + apport annuel
//   cible nominale[n]        = cible en euros d'aujourd'hui × indice des prix[n]
//   capital réel[n]          = capital nominal[n] / indice des prix[n]
//   rendement réel           = (1 + rendement / 100) / (1 + inflation / 100) − 1
// Montants en centimes entiers ; arrondi au centime à chaque année.

export const GOAL_TYPES = {
  etudes: { label: 'Études', consumes: true },
  retraite: { label: 'Retraite', consumes: false },
  achat: { label: 'Achat', consumes: true },
  securite: { label: 'Sécurité', consumes: false },
  transmission: { label: 'Transmission', consumes: false },
  autre: { label: 'Autre', consumes: true },
};

export const COVERAGE_STATUS = { funded: 'Finançable', partial: 'Partiel', unfunded: 'Non financé', outOfHorizon: 'Hors horizon' };

const statusOf = (covered, target) => (covered >= target ? 'funded' : covered > 0 ? 'partial' : 'unfunded');

/**
 * @param {object} p
 * @param {number|null} p.startCents   capital de départ (null : stock inconnu → projection impossible)
 * @param {number} p.startYear         année de départ
 * @param {number} p.horizonYears      nombre d'années projetées (≥ 1)
 * @param {number} p.ratePct           rendement annuel (%)
 * @param {number} p.inflationPct      inflation annuelle (%)
 * @param {number} p.contributionCents apport par période (centimes, signé)
 * @param {number} p.perYear           fréquence annuelle de l'apport (52, 12 ou 1)
 * @param {Array}  p.goals             [{ id, label, type, date: 'AAAA-MM-JJ', targetTodayCents }]
 */
export function project({ startCents, startYear, horizonYears, ratePct, inflationPct, contributionCents, perYear, goals = [] }) {
  const realReturnPct = ((1 + ratePct / 100) / (1 + inflationPct / 100) - 1) * 100;
  if (startCents === null || startCents === undefined) {
    return { status: 'unknown', reason: 'Stock initial à renseigner : aucune projection fiable sans valeur de départ.', realReturnPct, rows: [], goals: goalsOutOfReach(goals, startYear, horizonYears) };
  }
  const annualContribution = contributionCents * perYear;
  const lastYear = startYear + horizonYears;
  const sorted = [...goals].sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  const results = new Map();
  const reservations = []; // { goalId, cents } dans l'ordre de réservation
  let capital = startCents;
  let index = 1;
  const rows = [];

  const applyGoals = (year) => {
    for (const g of sorted.filter((x) => Number(x.date.slice(0, 4)) === year)) {
      const nominalTarget = Math.round(g.targetTodayCents * index);
      const reserved = reservations.reduce((s, r) => s + r.cents, 0);
      const available = Math.max(0, capital - reserved);
      const covered = Math.min(available, nominalTarget);
      const type = GOAL_TYPES[g.type] ?? GOAL_TYPES.autre;
      if (type.consumes) capital -= covered;
      else if (covered > 0) reservations.push({ goalId: g.id, cents: covered });
      results.set(g.id, { goalId: g.id, label: g.label, type: g.type, typeLabel: type.label, consumes: type.consumes, date: g.date, year, targetTodayCents: g.targetTodayCents, nominalTargetCents: nominalTarget, coveredCents: covered, status: statusOf(covered, nominalTarget) });
    }
  };
  /** Un déficit ultérieur remet en cause les réservations, de la plus récente à la plus ancienne. */
  const recheckReservations = () => {
    let excess = reservations.reduce((s, r) => s + r.cents, 0) - Math.max(0, capital);
    for (let i = reservations.length - 1; i >= 0 && excess > 0; i--) {
      const cut = Math.min(reservations[i].cents, excess);
      reservations[i].cents -= cut;
      excess -= cut;
      const res = results.get(reservations[i].goalId);
      res.coveredCents = reservations[i].cents;
      res.status = statusOf(res.coveredCents, res.nominalTargetCents);
      res.revised = true;
    }
  };

  applyGoals(startYear);
  rows.push(rowOf(startYear, 0, capital, index, reservations));
  for (let n = 1; n <= horizonYears; n++) {
    index *= 1 + inflationPct / 100;
    capital = Math.round(capital * (1 + ratePct / 100)) + annualContribution;
    applyGoals(startYear + n);
    recheckReservations();
    rows.push(rowOf(startYear + n, n, capital, index, reservations));
  }
  const outOfHorizon = sorted.filter((g) => Number(g.date.slice(0, 4)) > lastYear || Number(g.date.slice(0, 4)) < startYear);
  for (const g of outOfHorizon) results.set(g.id, outOfHorizonResult(g));
  const last = rows.at(-1);
  return {
    status: 'estimate',
    realReturnPct,
    annualContributionCents: annualContribution,
    rows,
    goals: sorted.map((g) => ({ ...results.get(g.id), coveragePct: pct(results.get(g.id)) })),
    keyFigures: {
      nominalAtHorizonCents: last.nominalCents,
      realAtHorizonCents: last.realCents,
      realReturnPct,
      // Perte de pouvoir d'achat du capital de départ s'il ne rapportait rien.
      erosionWithoutReturnCents: startCents - Math.round(startCents / last.priceIndex),
    },
  };
}

function rowOf(year, n, capital, index, reservations) {
  const reserved = reservations.reduce((s, r) => s + r.cents, 0);
  return { year, n, nominalCents: capital, realCents: Math.round(capital / index), priceIndex: Math.round(index * 1e6) / 1e6, reservedCents: reserved };
}

const pct = (r) => (r.status === 'outOfHorizon' || !r.nominalTargetCents ? null : Math.round((r.coveredCents / r.nominalTargetCents) * 1000) / 10);

const outOfHorizonResult = (g) => ({ goalId: g.id, label: g.label, type: g.type, typeLabel: (GOAL_TYPES[g.type] ?? GOAL_TYPES.autre).label, date: g.date, targetTodayCents: g.targetTodayCents, nominalTargetCents: null, coveredCents: null, status: 'outOfHorizon' });

function goalsOutOfReach(goals, startYear, horizonYears) {
  return goals.map((g) => {
    const y = Number(g.date.slice(0, 4));
    return y > startYear + horizonYears || y < startYear ? { ...outOfHorizonResult(g), coveragePct: null } : { ...outOfHorizonResult(g), status: 'unknown', coveragePct: null };
  });
}
