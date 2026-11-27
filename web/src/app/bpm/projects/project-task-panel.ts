import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, TemplateRef } from '@angular/core';
import { CentsPipe } from '../../core/format';
import { BpmFormDraft } from '../ui/form-draft';
import { BpmModal } from '../ui/modal';
import { BpmProjectChargeList } from './project-charge-list';
import { BpmOverrunRequestComponent, BpmTaskRequestsComponent } from './project-parts';
import { PROJECT_PAGE, ProjectTaskView } from './project-page-host';

/** Gabarits de la page repris tels quels dans la fenêtre (rendus dans la page, donc avec ses styles). */
export interface ProjectTaskPanelViews {
  flows: TemplateRef<unknown>;
  status: TemplateRef<{ $implicit: ProjectTaskView }>;
  money: TemplateRef<{ $implicit: ProjectTaskView }>;
  time: TemplateRef<{ $implicit: ProjectTaskView }>;
}

/**
 * Fenêtre d'une tâche de la fiche projet : part de budget, demande, dépenses et gains, retour au budget de vie,
 * historique. Sortie de project.page.html (rapport v4, point 3) ; l'état et les écritures restent à la page.
 */
@Component({
  selector: 'bpm-project-task-panel',
  imports: [NgTemplateOutlet, CentsPipe, BpmFormDraft, BpmModal, BpmProjectChargeList, BpmOverrunRequestComponent, BpmTaskRequestsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-task-panel.html',
  // Sans boîte propre. Des feuilles de la fiche projet, seules les règles qui peuvent viser ce gabarit
  // (project-task-panel.host.scss, tiré par scripts/styles-extract.mjs) : le rendu ne change pas.
  host: { style: 'display: contents' },
  styleUrls: ['./project-task-panel.host.scss', './project-task-panel.scss'],
})
export class BpmProjectTaskPanel {
  protected readonly page = inject(PROJECT_PAGE);
  readonly task = input.required<ProjectTaskView>();
  readonly views = input.required<ProjectTaskPanelViews>();
}
