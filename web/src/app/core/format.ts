import { Pipe, PipeTransform } from '@angular/core';
import { TimeAggregates } from './models';

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export function hours(value: number | null | undefined): string {
  return value === null || value === undefined ? 'Non renseigné' : `${nf.format(value)} h`;
}

/** Prévu agrégé : un total incomplet est présenté comme partiel, jamais comme certain. */
export function plannedTotal(t: TimeAggregates): string {
  if (t.taskCount === 0) return '—';
  if (t.estimatedTaskCount === 0) return 'Non renseigné';
  const base = `${nf.format(t.plannedHoursKnown)} h`;
  return t.plannedIsPartial ? `${base} (partiel : ${t.estimatedTaskCount}/${t.taskCount} estimées)` : base;
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 12) + '…' : '—';
}

@Pipe({ name: 'hours' })
export class HoursPipe implements PipeTransform {
  transform = hours;
}

@Pipe({ name: 'plannedTotal' })
export class PlannedTotalPipe implements PipeTransform {
  transform = plannedTotal;
}

@Pipe({ name: 'shortId' })
export class ShortIdPipe implements PipeTransform {
  transform = shortId;
}

export function parseHours(raw: string | number | null | undefined): number | null | 'invalid' {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : 'invalid';
}

// ---------- chiffres présentés (métriques) ----------

const eur = (decimals: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** Montant en euros ; `null` est une donnée inconnue, jamais affichée comme 0. */
export function euros(value: number | null | undefined, decimals = 2): string {
  return value === null || value === undefined ? 'Inconnu' : eur(decimals).format(value);
}

/** Valeur d'un chiffre selon son unité ('EUR' ou '%'). */
export function figureValue(value: number | null | undefined, unit: string, decimals = 2): string {
  if (value === null || value === undefined) return 'Inconnu';
  if (unit === '%') return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: decimals }).format(value)} %`;
  return euros(value, decimals);
}

/** Date AAAA-MM-JJ → « 3 nov. 2026 ». */
export function shortDate(value: string | null | undefined): string {
  if (!value) return '—';
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Saisie d'un montant en euros (virgule acceptée) → nombre, null si vide, 'invalid' sinon. */
export function parseAmount(raw: string | number | null | undefined): number | null | 'invalid' {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) < 1e12 && Math.round(n * 100) === Math.round(n * 100 * 1e6) / 1e6 ? n : 'invalid';
}

@Pipe({ name: 'euros' })
export class EurosPipe implements PipeTransform {
  transform = euros;
}

@Pipe({ name: 'figureValue' })
export class FigureValuePipe implements PipeTransform {
  transform = figureValue;
}

@Pipe({ name: 'shortDate' })
export class ShortDatePipe implements PipeTransform {
  transform = shortDate;
}

// ---------- centimes (contrats BPM) ----------

/** Centimes → « 1 234,56 € » ; `null` reste inconnu (jamais 0). */
export function cents(value: number | null | undefined, decimals = 2): string {
  return value === null || value === undefined ? 'Inconnu' : eur(decimals).format(value / 100);
}

/** Centimes signés → « +80,00 € » / « −20,00 € » ; le signe reste lisible sans couleur. */
export function signedCents(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return 'Inconnu';
  if (value === 0) return eur(decimals).format(0);
  return `${value > 0 ? '+' : '−'}${eur(decimals).format(Math.abs(value) / 100)}`;
}

/** Classe d'état financier d'un montant signé : excédent, déficit, neutre ou inconnu. */
export function tone(value: number | null | undefined): 'pos' | 'neg' | 'zero' | 'unknown' {
  return value === null || value === undefined ? 'unknown' : value > 0 ? 'pos' : value < 0 ? 'neg' : 'zero';
}

export function percentText(value: number | null | undefined, decimals = 1): string {
  return value === null || value === undefined ? '—' : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: decimals }).format(value)} %`;
}

@Pipe({ name: 'cents' })
export class CentsPipe implements PipeTransform {
  transform = cents;
}

@Pipe({ name: 'signedCents' })
export class SignedCentsPipe implements PipeTransform {
  transform = signedCents;
}

@Pipe({ name: 'pct' })
export class PercentPipe implements PipeTransform {
  transform = percentText;
}
