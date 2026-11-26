// Les tuiles de l'enveloppe d'un projet (fiche projet) : lecture pure des chiffres renvoyés par l'API.
import { cents } from '../../core/format';
import { displayDate } from '../../projects/workspace-parts';
import type { MetricTile } from '../../shared/metric-tiles.component';
import type { BpmProjectDetail } from '../data/bpm-projects.models';
import { FUNDING } from '../ui/project-funding';

export function projectBudgetTiles(b: NonNullable<BpmProjectDetail['budget']>): MetricTile[] {
  // Variante non standard (projet de vie) : mêmes tuiles, lues sur les ressources du cycle en cours.
  if (b.kind === 'life') {
    return [
      {
        id: 'envelope',
        label: 'Entrées prévues du cycle',
        symbol: 'income',
        value: b.regime ? cents(b.allocationCents) : 'Cycle à configurer',
      amountCents: b.allocationCents,
        note: b.life?.period
          ? `Ressources du budget du projet de vie · ${b.life.period.label}`
          : 'Ressources du budget du projet de vie',
      },
      {
        id: 'paid',
        label: 'Dépensé du cycle',
        symbol: 'expense',
        value: cents(b.paidCents),
      amountCents: b.paidCents,
        tone: 'danger',
        note: `dont ${cents(b.life?.projectsPaidCents ?? 0)} remontés par ses projets`,
      },
      {
        id: 'remaining',
        label: 'Reste sur les entrées',
        value: cents(b.remainingCents),
      amountCents: b.remainingCents,
        tone: b.remainingCents === null ? null : b.remainingCents < 0 ? 'danger' : 'success',
        note: 'Entrées prévues − Dépensé',
      },
      {
        id: 'toPay',
        label: 'Encore à régler',
        symbol: 'expense',
        value: cents(b.toPayCents),
      amountCents: b.toPayCents,
        tone: 'warning',
        note: 'Charges prévues du cycle non réglées',
      },
    ];
  }
  return [
    {
      id: 'envelope',
      label: FUNDING.envelope,
      value: b.regime ? cents(b.allocationCents) : 'À attribuer',
      amountCents: b.allocationCents,
      tone: 'accent',
      note: !b.regime
        ? 'Sans enveloppe, ses dépenses restent hors budget de vie'
        : b.approvedOverrunCents
          ? `Depuis le ${displayDate(b.allocationDate!)} · + ${cents(b.approvedOverrunCents)} de dépassement autorisé`
          : `Par le projet de vie, le ${displayDate(b.allocationDate!)}`,
    },
    {
      id: 'paid',
      label: b.regime ? FUNDING.paidOnEnvelope : FUNDING.paidOutside,
      symbol: 'expense',
      value: cents(b.paidCents),
      amountCents: b.paidCents,
      tone: 'danger',
      note: !b.regime
        ? 'Règlements validés, non comptés dans le projet de vie'
        : b.paidBeforeAllocationCents
          ? `Depuis l’attribution · ${cents(b.paidBeforeAllocationCents)} réglés avant, hors enveloppe`
          : 'Règlements validés depuis l’attribution',
    },
    {
      id: 'remaining',
      label: FUNDING.remaining,
      value: b.regime ? cents(b.remainingCents) : '—',
      amountCents: b.remainingCents,
      tone: b.remainingCents === null ? null : b.remainingCents < 0 ? 'danger' : 'success',
      note: b.regime
        ? 'Enveloppe − réglé sur l’enveloppe'
        : 'Attribuez une enveloppe pour suivre le reste',
    },
    {
      id: 'toPay',
      label: FUNDING.toPay,
      symbol: 'expense',
      value: cents(b.toPayCents),
      amountCents: b.toPayCents,
      tone: 'warning',
      note: 'Dépenses engagées non réglées',
    },
  ];
}
