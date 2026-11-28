import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Api, CentsPipe } from '../../../platform/grand-noyau';
import { bpmLoader } from '../../../astra/cadre';
import { entreeBudget } from '../fonctionnalites/entree';

/**
 * Application autonome Mon budget · accueil (squelette). Pose la vision et l'ENTRÉE de l'application, lue par le grand
 * noyau ; la SORTIE reste à définir selon les fonctions qui seront demandées (docs/sections/budget.md).
 */
@Component({
  selector: 'budget-accueil',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CentsPipe],
  templateUrl: './accueil.page.html',
  styleUrl: './accueil.page.scss',
})
export class BudgetAccueilPage {
  private readonly api = inject(Api);
  protected readonly vision = 'Prendre en charge le patrimoine dès qu’il est disponible (ni dépensé ni engagé pour un projet ou une dépense à venir) et le « manager » : investissements en bourse ou sur des projets avec un but de rendement.';
  protected readonly entree = 'Le patrimoine disponible : le patrimoine constitué (stock d’ouverture + résultats des cycles capitalisés) moins ce qui est engagé pour l’avenir. Tant que le grand noyau n’expose pas ces engagements, le disponible reste inconnu plutôt que surestimé.';
  /** Le patrimoine, lu par le grand noyau ; les engagements futurs ne sont pas encore exposés. */
  protected readonly data = bpmLoader(() => 0, async () => ({ entree: entreeBudget(await this.api.patrimoine()) }));
}
