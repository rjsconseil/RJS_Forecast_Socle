import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { BpmRouterLink } from '../ui/bpm-router-link';
import { BpmAmount } from '../ui/amount';
import { CentsPipe, ShortDatePipe } from '../../core/format';
import { BpmLifeFundingComponent } from '../life/life-funding';
import { BpmOverrunRequestComponent } from './project-parts';
import { MetricTile } from '../../shared/metric-tiles.component';
import { BpmProjectDetail, ProjectOverrun } from '../data/bpm-projects.models';

/** Décision du projet de vie sur un dépassement demandé par l'un de ses projets. */
export interface LifeOverrunDecision {
  overrun: ProjectOverrun;
  decision: 'approve' | 'refuse';
}

/**
 * Fiche du projet de vie (variante non standard de la fiche projet) : chiffres clés de son budget, ventilation vers
 * ses projets, décisions attendues, contrôles de fin de cycle et financement des projets de la vie. Sorti de
 * project.page.html (faiblesse n° 7 du rapport « architecture et faiblesses ») : la page garde les écritures, ce
 * composant n'affiche que ce qu'on lui donne et remonte les décisions.
 */
@Component({
  selector: 'bpm-life-project-cockpit',
  imports: [BpmAmount, CentsPipe, ShortDatePipe, BpmRouterLink, BpmLifeFundingComponent, BpmOverrunRequestComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './life-project-cockpit.html',
  // Sans boîte propre : ses sections restent des enfants directs de la page pour la mise en page.
  host: { style: 'display: contents' },
  // Mêmes feuilles que la fiche projet : le rendu ne change pas (vérifié avec e2e/style-fingerprint.mjs).
  styleUrls: ['./projects.page.scss', './project.page.scss', './project-command-center.scss'],
})
export class BpmLifeProjectCockpit {
  readonly detail = input.required<BpmProjectDetail>();
  readonly tiles = input<MetricTile[]>([]);
  readonly busy = input(false);
  readonly workspaceKey = input<string | null>(null);
  readonly decide = output<LifeOverrunDecision>();
  protected readonly life = computed(() => this.detail().life!);
}
