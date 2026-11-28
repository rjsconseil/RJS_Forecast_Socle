import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Api, CentsPipe } from '../../../platform/grand-noyau';
import { bpmLoader } from '../../../astra/cadre';
import { entreeCycles } from '../fonctionnalites/entree';

/**
 * Application autonome Mes cycles · accueil (squelette). Pose la vision et l'ENTRÉE de l'application, lue par le grand
 * noyau ; la SORTIE reste à définir selon les fonctions qui seront demandées (docs/sections/cycles.md).
 */
@Component({
  selector: 'cycles-accueil',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CentsPipe],
  templateUrl: './accueil.page.html',
  styleUrl: './accueil.page.scss',
})
export class CyclesAccueilPage {
  private readonly api = inject(Api);
  protected readonly vision = 'Analyser les comportements financiers du quotidien, cycle après cycle, pour améliorer le taux d’épargne à chaque cycle.';
  protected readonly entree = 'Les cycles et, pour chacun, ce qui a été reçu et dépensé (mouvements réglés du budget de vie, à leur date réelle), l’épargne et le taux d’épargne.';
  /** Les cycles et les mouvements du budget de vie, lus par le grand noyau. */
  protected readonly data = bpmLoader(() => 0, async () => {
    const budgets = await this.api.budgets();
    const vie = budgets.find((b) => b.role === 'life');
    const operations = vie ? (await this.api.budget(vie.id)).operations : [];
    return { cycles: entreeCycles((await this.api.metricPeriods()).periods, operations) };
  });
}
