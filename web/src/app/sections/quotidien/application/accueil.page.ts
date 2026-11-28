import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Api, CentsPipe } from '../../../platform/grand-noyau';
import { bpmLoader } from '../../../astra/cadre';
import { entreeQuotidien } from '../fonctionnalites/entree';

/**
 * Application autonome Mon quotidien · accueil (squelette). Pose la vision et l'ENTRÉE de l'application, lue par le grand
 * noyau ; la SORTIE reste à définir selon les fonctions qui seront demandées (docs/sections/quotidien.md).
 */
@Component({
  selector: 'quotidien-accueil',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CentsPipe],
  templateUrl: './accueil.page.html',
  styleUrl: './accueil.page.scss',
})
export class QuotidienAccueilPage {
  private readonly api = inject(Api);
  protected readonly vision = 'Gérer au même endroit son emploi du temps et son budget personnel : ce qu’on a à faire et ce qu’on dépense, jour après jour.';
  protected readonly entree = 'Le budget personnel du quotidien : les mouvements du budget de vie (entrées et dépenses, prévues et réglées) du cycle en cours, lus par le grand noyau. L’emploi du temps entrera quand le grand noyau exposera ses lectures du calendrier.';
  /** Le budget de vie et le cycle en cours, lus par le grand noyau. */
  protected readonly data = bpmLoader(() => 0, async () => {
    const budgets = await this.api.budgets();
    const vie = budgets.find((b) => b.role === 'life');
    const operations = vie ? (await this.api.budget(vie.id)).operations : [];
    const periodes = (await this.api.metricPeriods()).periods;
    const cycle = periodes.find((p) => p.status === 'current') ?? periodes[0] ?? null;
    return { cycle, entree: cycle ? entreeQuotidien(operations, cycle.start, cycle.end) : null };
  });
}
