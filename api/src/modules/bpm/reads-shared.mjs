// Lectures BPM — constantes et conversions communes aux lectures (périmètres, statuts, natures, montants d'adresse).
import { money } from '../../socle/validation.mjs';
import { NATURES } from './natures.mjs';

export const RESULT = 'bpm.resultatPeriode';
export const SUMMARY_KEYS = ['bpm.revenus', 'bpm.charges', RESULT, 'bpm.resteARecevoir', 'bpm.resteAPayer', 'bpm.soldeAttendu', 'bpm.resultatPrevu', 'bpm.tauxEpargne', 'bpm.patrimoineConstitue', 'bpm.patrimoineDisponible', 'bpm.patrimoineFinPeriode', 'bpm.progressionObjectif', 'bpm.resteObjectif'];
export const STATUS_LABEL = { settled: 'Réglé', due: 'Du jour', late: 'En retard', pending: 'À venir', unrealized: 'Non réalisé' };
export const NATURE_ORDER = ['entrees', ...NATURES];
export const WITH_PROJECTS = 'life-with-projects';
export const SCOPE_LABELS = {
  principal: 'Budget du projet de vie',
  consolidated: 'Tous les Budgets du user (chaque Budget une fois ; aucun flux père/enfant calculé)',
  [WITH_PROJECTS]: 'Quotidien et projets de la vie',
};

export const sign = (direction) => (direction === 'income' ? 1 : -1);

/** Montant venant d'une adresse (texte « 12,50 » ou « 12.50 ») : converti à la frontière, puis validé en centimes. */
export const queryMoney = (field, value, opts) => money(field, typeof value === 'string' && value.trim() !== '' ? Number(value.replace(',', '.').replace(/\s/g, '')) : value, opts);
