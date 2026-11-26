import { BpmAmount } from '../ui/amount';
import { Component, computed, input } from '@angular/core';
import { CentsPipe, percentText, ShortDatePipe, SignedCentsPipe } from '../../core/format';
import { BpmLifeManagement, LifeCycle } from '../data/bpm-life.models';

export function cycleReadingText(reading: LifeCycle['reading']) {
  switch (reading) {
    case 'closed':
      return { status: 'Période clôturée · consultation', compact: 'Clôturée', net: 'Solde réalisé', expected: 'Résultat clôturé', expectedNote: 'Capitalisé dans le patrimoine' };
    case 'ended':
      return { status: 'Période terminée · à clôturer', compact: 'À clôturer', net: 'Solde réalisé', expected: 'Solde prévu à la clôture', expectedNote: 'Résultat à capitaliser' };
    default:
      return { status: 'Période actuelle', compact: 'Actuelle', net: 'Solde à ce jour', expected: 'Solde prévu à la clôture', expectedNote: 'Si tout le prévu se réalise' };
  }
}

@Component({
  selector: 'bpm-life-cycle-summary',
  imports: [BpmAmount, CentsPipe, SignedCentsPipe, ShortDatePipe],
  templateUrl: './life-cycle-summary.html',
  styleUrl: './life-cycle-summary.scss',
})
export class BpmLifeCycleSummary {
  readonly data = input<BpmLifeManagement | null>(null);
  protected readonly reading = computed(() => this.data()?.cycle.reading ?? null);
  protected readonly readingText = computed(() => cycleReadingText(this.reading()));
  protected readonly pct = (value: number | null) => percentText(value, 0);
}
