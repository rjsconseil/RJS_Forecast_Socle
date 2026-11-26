import type { BpmLifeManagement } from '../bpm/data/bpm-life.models';
import type { AstraPartKey } from './astra-parts';

/** Un pont mène d'une partie à une autre avec le chiffre qui les relie. */
export interface AstraBridge {
  to: AstraPartKey;
  label: string;
  valueCents: number | null;
  note: string;
  link: string;
  /** Lecture du chiffre : atteint, à surveiller ou neutre. */
  state: 'ok' | 'watch' | 'neutral';
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const euro = (c: number | null | undefined) => c === null || c === undefined ? '—'
  : (c / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

/**
 * Les deux ponts de chaque partie vers les deux autres. Ils lisent tous la même réponse
 * (gestion du projet de vie) : aucun chiffre n'est recalculé côté présentation.
 */
export function astraBridges(part: AstraPartKey, d: BpmLifeManagement): AstraBridge[] {
  const flows = d.cycle.flows;
  const current = d.results.current;
  const period = d.cycle.period?.label ?? 'le cycle';
  const fromWealth = d.projects.projects.filter(p => p.fundingSource === 'patrimoine');
  const savings: AstraBridge = {
    to: 'patrimoine', label: 'Épargne du cycle', valueCents: current?.expectedCents ?? null,
    note: current?.targetCents === null || current?.targetCents === undefined ? 'Objectif d’épargne à fixer'
      : `${current.meetsTarget ? 'Objectif tenu' : 'Sous l’objectif'} de ${euro(current.targetCents)}`,
    link: 'objectif', state: current?.meetsTarget === null || current?.meetsTarget === undefined ? 'neutral' : current.meetsTarget ? 'ok' : 'watch',
  };
  const projectsOnCycle: AstraBridge = {
    to: 'projets', label: 'Projets payés ce cycle', valueCents: flows?.projectsPaidCents ?? null,
    note: count(d.projects.fundedCount, 'projet financé', 'projets financés'),
    link: 'projets', state: d.projects.deficitCount ? 'watch' : 'neutral',
  };
  if (part === 'quotidien' || part === 'budget') return [projectsOnCycle, savings];
  if (part === 'projets') return [
    {
      to: 'quotidien', label: 'Pris sur le cycle', valueCents: d.projects.periodPaidCents ?? flows?.projectsPaidCents ?? null,
      note: `Réglé en ${period}`, link: 'mouvements', state: 'neutral',
    },
    {
      to: 'patrimoine', label: 'Pris sur le patrimoine', valueCents: fromWealth.reduce((s, p) => s + p.paidCents, 0),
      note: fromWealth.length ? count(fromWealth.length, 'projet hors cycle', 'projets hors cycle') : 'Aucun projet hors cycle',
      link: 'patrimoine', state: 'neutral',
    },
  ];
  return [
    {
      to: 'quotidien', label: 'Solde prévu du cycle', valueCents: flows?.expectedCents ?? null,
      note: d.cycle.days ? `${period} · ${count(d.cycle.days.left, 'jour restant', 'jours restants')}` : period,
      link: '', state: savings.state,
    },
    {
      to: 'projets', label: 'Reste sur les enveloppes', valueCents: d.projects.remainingCents,
      note: count(d.projects.projectCount, 'projet de la vie', 'projets de la vie'),
      link: 'projets', state: d.projects.deficitCount ? 'watch' : 'neutral',
    },
  ];
}
