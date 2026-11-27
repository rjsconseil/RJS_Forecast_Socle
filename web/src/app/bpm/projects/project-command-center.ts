import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, TemplateRef } from '@angular/core';
import { CentsPipe, ShortDatePipe } from '../../core/format';
import { BpmAmount } from '../ui/amount';
import { BpmDial } from '../ui/dial';
import { PROJECT_PAGE, ProjectTaskView } from './project-page-host';

/**
 * Centre de commande de la fiche projet : tâche suivie, argent des prochaines échéances, réglage de la part et du
 * temps. Sorti de project.page.html (rapport v4, point 3) ; l'état et les écritures restent à la page.
 */
@Component({
  selector: 'bpm-project-command-center',
  imports: [NgTemplateOutlet, CentsPipe, ShortDatePipe, BpmAmount, BpmDial],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-command-center.html',
  // Sans boîte propre, mêmes feuilles que la fiche projet : le rendu ne change pas (e2e/style-fingerprint.mjs).
  host: { style: 'display: contents' },
  styleUrls: ['./projects.page.scss', './project.page.scss', './project-command-center.scss'],
})
export class BpmProjectCommandCenter {
  protected readonly page = inject(PROJECT_PAGE);
  readonly views = input.required<{ status: TemplateRef<{ $implicit: ProjectTaskView }> }>();
}
