import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Api, CentsPipe, ShortDatePipe } from '../../../platform/grand-noyau';
import { bpmLoader } from '../../../astra/cadre';
import { entreePatrimoine } from '../fonctionnalites/entree';

/**
 * Application autonome Mon patrimoine · accueil (squelette). Pose la vision et l'ENTRÉE de l'application, lue par le grand
 * noyau ; la SORTIE reste à définir selon les fonctions qui seront demandées (docs/sections/patrimoine.md).
 */
@Component({
  selector: 'patrimoine-accueil',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CentsPipe, ShortDatePipe],
  templateUrl: './accueil.page.html',
  styleUrl: './accueil.page.scss',
})
export class PatrimoineAccueilPage {
  private readonly api = inject(Api);
  protected readonly vision = 'Planifier le patrimoine sur les projets de vie qui ont une portée patrimoniale : constituer un apport ou une somme pour l’achat d’un bien immobilier, préparer le budget qui soutiendra toute une période de retraite…';
  protected readonly entree = 'Le patrimoine constitué et son objectif, et les projets de la vie (projets du grand noyau) qui peuvent porter un but patrimonial.';
  /** Le patrimoine et les projets de la vie, lus par le grand noyau. */
  protected readonly data = bpmLoader(() => 0, async () => {
    const [lecture, projets] = await Promise.all([this.api.patrimoine(), this.api.projects()]);
    return { entree: entreePatrimoine(lecture, projets) };
  });
}
