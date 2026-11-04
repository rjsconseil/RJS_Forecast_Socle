/**
 * Vision patrimoniale de Budget/Patrimoine Management : les choix d'un projet
 * (rendement visé, épargne visée par période, objectifs de vie) et l'indice
 * d'inflation annuel tenu par le gestionnaire. Ces faits appartiennent à BPM et
 * vivent dans son espace ; les bornes sont des invariants du catalogue et la
 * série de référence est un fichier livré, mis à jour avec les publications INSEE.
 */
import { readFileSync } from 'node:fs';
import { HttpError, isRecord } from './api-http.mjs';
import { fixedSetting } from './configuration-settings.mjs';

export const BPM_GOAL_KINDS = new Set(['etudes', 'retraite', 'achat', 'securite', 'transmission', 'autre']);
const GOAL_ID = /^[A-Za-z0-9_-]{1,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const bound = (key) => Number(fixedSetting(key));

export const emptyVision = () => ({ returnPct: null, savingsTargetCents: null, goals: [] });

function percent(value, field, min, max) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new HttpError(400, `${field} doit être compris entre ${min} et ${max} %`);
  return Math.round(value * 100) / 100;
}
function validDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Les choix d'un projet, tous vérifiés avant écriture. */
export function bpmVisionOf(body) {
  if (body === undefined || body === null) return emptyVision();
  if (!isRecord(body)) throw new HttpError(400, 'La vision doit être un objet');
  const returnPct = percent(
    body.returnPct,
    'Le rendement visé',
    bound('bpm.vision.rendementMin'),
    bound('bpm.vision.rendementMax'),
  );
  let savingsTargetCents = null;
  if (body.savingsTargetCents !== null && body.savingsTargetCents !== undefined) {
    const limit = bound('bpm.vision.montantMaxCents');
    if (!Number.isSafeInteger(body.savingsTargetCents) || (body.savingsTargetCents < 0 || body.savingsTargetCents > limit))
      throw new HttpError(400, 'L’excédent minimum par période doit être positif ou nul');
    savingsTargetCents = body.savingsTargetCents;
  }
  const list = body.goals ?? [];
  if (!Array.isArray(list) || list.length > bound('bpm.vision.objectifsMax'))
    throw new HttpError(400, 'La liste des objectifs est invalide ou trop longue');
  const seen = new Set();
  const goals = list.map((goal, index) => {
    const at = `L’objectif ${index + 1}`;
    if (!isRecord(goal)) throw new HttpError(400, `${at} est invalide`);
    if (typeof goal.id !== 'string' || !GOAL_ID.test(goal.id) || seen.has(goal.id))
      throw new HttpError(400, `${at} a un identifiant invalide ou en double`);
    seen.add(goal.id);
    const label = typeof goal.label === 'string' ? goal.label.trim() : '';
    if (!label || label.length > 80 || /[\u0000-\u001F]/.test(label))
      throw new HttpError(400, `${at} doit avoir un nom de 80 caractères au plus`);
    if (!BPM_GOAL_KINDS.has(goal.kind)) throw new HttpError(400, `${at} a un usage inconnu`);
    if (
      !Number.isSafeInteger(goal.targetCents) ||
      goal.targetCents <= 0 ||
      goal.targetCents > bound('bpm.vision.montantMaxCents')
    )
      throw new HttpError(400, `${at} doit avoir un montant positif`);
    if (!validDate(goal.targetDate)) throw new HttpError(400, `${at} doit avoir une date valide`);
    const note = typeof goal.note === 'string' ? goal.note.trim() : '';
    if (note.length > 300) throw new HttpError(400, `${at} a une note trop longue`);
    const allocationId = goal.allocationId ? String(goal.allocationId) : null;
    if (allocationId && !/^[A-Za-z0-9_-]{1,80}$/.test(allocationId))
      throw new HttpError(400, `${at} a une allocation invalide`);
    return { id: goal.id, label, kind: goal.kind, targetCents: goal.targetCents, targetDate: goal.targetDate, note, allocationId };
  });
  let surplusGoal = null;
  if (body.surplusGoal != null) {
    const goal = body.surplusGoal;
    if (!isRecord(goal) || !Number.isSafeInteger(goal.targetCents) || goal.targetCents <= 0 || goal.targetCents > bound('bpm.vision.montantMaxCents') || !Number.isSafeInteger(goal.periods) || goal.periods < 1 || goal.periods > 1200 || !validDate(goal.startDate))
      throw new HttpError(400, 'L’objectif cumulé demande un montant positif, une date de départ et 1 à 1 200 périodes.');
    surplusGoal = { targetCents: goal.targetCents, periods: goal.periods, startDate: goal.startDate };
  }
  return { returnPct, savingsTargetCents, goals, surplusGoal };
}

/** L'indice d'inflation tenu par le gestionnaire : une valeur par année, triée. */
export function bpmInflationOf(list) {
  if (!Array.isArray(list)) throw new HttpError(400, 'L’indice d’inflation doit être une liste');
  const min = bound('bpm.vision.inflationMin');
  const max = bound('bpm.vision.inflationMax');
  const seen = new Set();
  return list
    .map((entry, index) => {
      if (!isRecord(entry) || !Number.isSafeInteger(entry.year) || entry.year < 1900 || entry.year > 2200)
        throw new HttpError(400, `L’année ${index + 1} de l’indice est invalide`);
      if (seen.has(entry.year)) throw new HttpError(400, `L’année ${entry.year} est en double`);
      seen.add(entry.year);
      return { year: entry.year, ratePct: percent(entry.ratePct, `Le taux de ${entry.year}`, min, max) ?? 0 };
    })
    .sort((a, b) => a.year - b.year);
}

/** La série livrée (`configuration/bpm/inflation-reference.csv`) : année, taux, source. */
export function inflationReference(
  file = new URL('../../configuration/bpm/inflation-reference.csv', import.meta.url),
) {
  const [header, ...rows] = readFileSync(file, 'utf8').trim().split(/\r?\n/);
  if (header !== 'annee,taux,source') throw new Error('Série d’inflation de référence invalide');
  return rows.map((row) => {
    const [year, rate, ...source] = row.split(',');
    return { year: Number(year), ratePct: Number(rate), source: source.join(',') };
  });
}

/** L'indice effectif : la valeur du gestionnaire l'emporte sur la référence de la même année. */
export function effectiveInflation(own, reference) {
  const byYear = new Map(reference.map((entry) => [entry.year, { year: entry.year, ratePct: entry.ratePct, source: 'reference' }]));
  for (const entry of own) byYear.set(entry.year, { year: entry.year, ratePct: entry.ratePct, source: 'profil' });
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}
