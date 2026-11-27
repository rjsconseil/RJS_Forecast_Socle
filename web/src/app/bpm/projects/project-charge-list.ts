import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { BpmAmount } from '../ui/amount';
import { BpmFormDraft } from '../ui/form-draft';
import { CentsPipe, ShortDatePipe } from '../../core/format';
import { ProjectChargeLine } from '../data/bpm-projects.models';
import { chargeState, defaultDate } from './project-labels';

/** Validation d'un règlement saisie dans la liste : la page fait l'écriture (avec relecture), la liste la demande. */
export interface ChargeSettlement {
  charge: ProjectChargeLine;
  fields: HTMLFormControlsCollection;
  draft?: BpmFormDraft;
}

/**
 * Dépenses d'un projet ou d'une tâche (douze mois passés et à venir) : état, prévu et réglé, validation du règlement.
 * Sorti de project.page.html (faiblesse n° 7 du rapport « architecture et faiblesses »), où il était un gabarit
 * partagé (`#chargeList`) ; les écritures restent à la page.
 */
@Component({
  selector: 'bpm-project-charge-list',
  imports: [BpmAmount, BpmFormDraft, CentsPipe, ShortDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-charge-list.html',
  // Sans boîte propre, mêmes feuilles que la fiche projet : le rendu ne change pas (e2e/style-fingerprint.mjs).
  host: { style: 'display: contents' },
  styleUrl: './project.page.scss',
})
export class BpmProjectChargeList {
  readonly charges = input<ProjectChargeLine[]>([]);
  readonly busy = input(false);
  readonly settlingId = input<string | null>(null);
  readonly today = input.required<string>();
  readonly open = output<ProjectChargeLine>();
  readonly settle = output<ChargeSettlement>();
  readonly cancelSettle = output<void>();
  protected readonly chargeState = chargeState;
  protected readonly defaultDate = defaultDate;
}
