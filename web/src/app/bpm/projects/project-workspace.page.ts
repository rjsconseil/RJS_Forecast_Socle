import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { injectPageWorkspace } from '../../shared/page-workspace';
import { TASK_STATUS_LABEL } from '../../core/models';
import { BpmPageBanner, BpmPageContext, BpmPageFocus, bpmQueryState } from '../ui';
import { BpmProjectManagementPage } from './management.page';
import { BpmProjectEditor, BpmTaskEditor } from './project-editors';
import { BpmProjectMetricsComponent } from './project-metrics';
import { BpmOverrunRequestComponent, BpmTaskRequestsComponent } from './project-parts';

/** Focused steps use exactly the overview's commands, funding rules and persistent editors. */
@Component({
  selector: 'app-bpm-project-workspace',
  providers: [BpmPageContext],
  imports: [BpmPageBanner, RouterLink, BpmProjectEditor, BpmTaskEditor,
    BpmProjectMetricsComponent, BpmOverrunRequestComponent, BpmTaskRequestsComponent],
  styleUrls: ['./projects.page.scss', './project-workspace.page.scss'],
  template: `
    <div class="page page-wide bpm-projects bpm-project-page bpm-specialized-projects">
      <bpm-page-banner
        class="life-projects-banner"
        [title]="workspace()?.title || 'Préparer les projets'"
        [lead]="workspace()?.lead || ''"
        [focus]="workspaceFocus()"
        [scope]="workspaceScope()"
        [result]="toolbarResult()"
        toolsLabel="Outils de cette étape"
      >
        <div actions>
          @if (key() === 'project-funding') {
            <a class="btn btn-secondary" routerLink="/app/gestion-projet/decisions" queryParamsHandling="preserve">Décider les demandes ({{ decisionCount() }})</a>
          } @else if (key() === 'project-decisions') {
            <a class="btn btn-secondary" routerLink="/app/gestion-projet/financement" queryParamsHandling="preserve">Attribuer les enveloppes</a>
          } @else if (key() === 'task-attach') {
            <a class="btn btn-secondary" routerLink="/app/taches/nouvelle" queryParamsHandling="preserve">Créer une tâche</a>
          }
        </div>
        @if (key() === 'project-funding' || key() === 'task-attach') {
          <div tools class="life-banner-tools">
            <label>Rechercher<input type="search" [value]="search()" (input)="search.set($any($event.target).value)" placeholder="Nom ou description…" /></label>
            @if (key() === 'project-funding') {
              <label>Enveloppes<select [value]="fundingView()" (change)="fundingView.set($any($event.target).value)">
                <option value="missing">À attribuer</option><option value="all">Tous les projets</option>
              </select></label>
            } @else {
              <label>Projet destinataire<select [value]="destination()" (change)="destination.set($any($event.target).value)">
                <option value="">Choisir un projet…</option>
                @for (p of projectOptions(); track p.projectId) { <option [value]="p.projectId">{{ p.title }}</option> }
              </select></label>
            }
          </div>
        }
      </bpm-page-banner>

      @if (key() === 'project-create') {
        <bpm-project-editor [inline]="true" (closed)="back()" (saved)="projectCreated($event)" />
      } @else if (error()) {
        <div class="empty-state" role="alert"><h2>Étape indisponible</h2><p>{{ error() }}</p><button type="button" class="btn btn-secondary" (click)="load()">Réessayer</button></div>
      } @else if (!data()) {
        <p role="status">Chargement des projets et des tâches…</p>
      } @else if (key() === 'task-create') {
        @if (!taskCreated()) {
          <bpm-task-editor [inline]="true" [projects]="projectOptions()" [defaultProjectId]="validDestination()" (closed)="back()" (saved)="completeTask($event)" />
        } @else {
          <section class="bpm-panel workspace-next" aria-label="Après la création">
            <h2>La tâche est prête</h2><p>{{ notice()?.text }}</p>
            <div class="bpm-actions">
              @if (validDestination()) { <a class="btn btn-primary" [routerLink]="['/app/gestion-projet', validDestination(), 'taches']" queryParamsHandling="preserve">Poursuivre dans le projet</a> }
              @else { <a class="btn btn-primary" routerLink="/app/taches/rattacher" queryParamsHandling="preserve">Rattacher les tâches disponibles</a> }
              <button type="button" class="btn btn-secondary" (click)="taskCreated.set(false)">Créer une autre tâche</button>
            </div>
          </section>
        }
      } @else if (key() === 'project-funding') {
        <section class="bpm-section" aria-label="Enveloppes des projets">
          <header><h2>{{ fundingView() === 'missing' ? 'Enveloppes à attribuer' : 'Enveloppes des projets' }}</h2><span>{{ fundingProjects().length }} projet(s)</span></header>
          <div class="workspace-focus-grid">
            @for (p of fundingProjects(); track p.project.id) {
              @if (p.budget; as b) {
                <article class="bpm-panel workspace-funding-card">
                  <h3><a [routerLink]="['/app/gestion-projet', p.project.id, 'budget']" queryParamsHandling="preserve">{{ p.project.title }}</a></h3>
                  <bpm-project-metrics [budget]="b" [time]="p.view.time" />
                  <form class="bpm-inline-form" (submit)="$event.preventDefault(); allocate(p, $any($event.target).elements.amount.value)">
                    <label>Enveloppe totale (€)<input name="amount" inputmode="decimal" required [value]="b.allocationCents === null ? '' : (b.allocationCents / 100).toString().replace('.', ',')" /></label>
                    <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ b.regime ? 'Enregistrer l’enveloppe' : 'Attribuer l’enveloppe' }}</button>
                  </form>
                  <p class="bpm-note">L’attribution prépare le financement ; seuls les règlements validés deviennent des dépenses.</p>
                </article>
              }
            } @empty {
              <div class="empty-state"><h3>{{ search() ? 'Aucun projet ne correspond à la recherche' : 'Toutes les enveloppes sont attribuées' }}</h3><p>Retrouvez les enveloppes existantes avec « Tous les projets ».</p></div>
            }
          </div>
          @if (data()!.candidates.length) {
            <form class="bpm-panel bpm-inline-form" (submit)="$event.preventDefault(); adopt()">
              <h3>Donner un budget à un projet du noyau</h3>
              <label>Projet à intégrer<select [value]="candidate()" (change)="candidate.set($any($event.target).value)" required><option value="">Choisir un projet…</option>@for (p of data()!.candidates; track p.projectId) { <option [value]="p.projectId">{{ p.title }} · {{ p.taskCount }} tâche(s)</option> }</select></label>
              <button type="submit" class="btn btn-secondary" [disabled]="busy() || !candidate()">Intégrer au financement</button>
            </form>
          }
        </section>
      } @else if (key() === 'project-decisions') {
        <section class="bpm-section" aria-label="Demandes à décider">
          <header><h2>Parts demandées par les tâches</h2><span>{{ data()!.life.taskRequests.length }} demande(s)</span></header>
          @for (r of data()!.life.taskRequests; track r.id) {
            <bpm-task-requests [requests]="[r]" [funded]="projectFunded(r.coreProjectId)" [busy]="busy()" (decide)="decideRequest($event)" />
            @if (!projectFunded(r.coreProjectId)) { <a class="btn btn-secondary" [routerLink]="['/app/gestion-projet', r.coreProjectId, 'budget']" queryParamsHandling="preserve">Attribuer l’enveloppe de {{ r.budgetName }}</a> }
          } @empty { <p class="bpm-note">Aucune part de tâche ne demande de décision.</p> }
        </section>
        <section class="bpm-section" aria-label="Dépassements à décider">
          <header><h2>Autorisations du projet de vie</h2><span>{{ data()!.life.pendingRequests.length }} demande(s)</span></header>
          @for (o of data()!.life.pendingRequests; track o.id) { <bpm-overrun-request [overrun]="o" [busy]="busy()" (decide)="decideOverrun(o, $event)" /> }
          @empty { <p class="bpm-note">Aucun dépassement en attente.</p> }
        </section>
      } @else if (key() === 'task-attach') {
        <section class="bpm-section" aria-label="Tâches à rattacher">
          <header><h2>Tâches préparées sans projet</h2><span>{{ assignmentTasks().length }} tâche(s)</span></header>
          @if (!projectOptions().length) { <div class="empty-state"><h3>Préparez d’abord le projet destinataire</h3><a class="btn btn-primary" routerLink="/app/gestion-projet/nouveau">Créer un projet de la vie</a></div> }
          @else {
            <div class="workspace-focus-grid">
              @for (t of assignmentTasks(); track t.task.id) {
                <article class="bpm-panel workspace-assignment-card"><h3>{{ t.task.title }}</h3><p>{{ t.task.description || 'Aucun détail renseigné.' }}</p><p class="bpm-note">{{ t.task.plannedHours === null ? 'Temps non estimé' : t.task.plannedHours + ' h prévues' }} · {{ taskStatus[t.task.status] }}</p>
                  <button type="button" class="btn btn-primary" [disabled]="busy() || !validDestination()" (click)="assignTask(t.task.id)">{{ validDestination() ? 'Rattacher à ' + destinationTitle() : 'Choisir le projet dans le bandeau' }}</button>
                </article>
              } @empty { <div class="empty-state"><h3>{{ search() ? 'Aucune tâche ne correspond à la recherche' : 'Aucune tâche à rattacher' }}</h3><p>Les tâches déjà rattachées restent disponibles dans leur projet.</p></div> }
            </div>
          }
        </section>
      }
    </div>
  `,
})
export class BpmProjectWorkspacePage extends BpmProjectManagementPage {
  private readonly workspaceRouter = inject(Router);
  protected readonly workspace = injectPageWorkspace();
  protected readonly taskStatus = TASK_STATUS_LABEL;
  protected readonly key = computed(() => this.workspace()?.key ?? 'project-create');
  protected readonly fundingView = bpmQueryState('funding', 'missing');
  protected readonly destination = bpmQueryState('project', '');
  protected readonly validDestination = computed(() => this.projectOptions().some((p) => p.projectId === this.destination()) ? this.destination() : '');
  protected readonly destinationTitle = computed(() => this.projectOptions().find((p) => p.projectId === this.validDestination())?.title ?? '');
  protected readonly taskCreated = signal(false);
  protected readonly decisionCount = computed(() => (this.data()?.life.taskRequests.length ?? 0) + (this.data()?.life.pendingRequests.length ?? 0));
  protected readonly fundingProjects = computed(() => {
    const q = this.search().trim().toLocaleLowerCase('fr');
    return (this.data()?.projects ?? []).filter((p) =>
      (this.fundingView() === 'all' || !p.budget?.regime) &&
      (!q || `${p.project.title} ${p.project.description}`.toLocaleLowerCase('fr').includes(q)),
    );
  });
  protected readonly assignmentTasks = computed(() => {
    const q = this.search().trim().toLocaleLowerCase('fr');
    return this.availableTasks().filter((t) => !q || `${t.task.title} ${t.task.description}`.toLocaleLowerCase('fr').includes(q));
  });
  protected readonly workspaceScope = computed(() => {
    if (this.key() === 'project-decisions') return `${this.decisionCount()} décision(s) · tous les projets`;
    if (this.key() === 'project-funding') return `${this.fundingProjects().length} projet(s) · ${this.data()?.life.fundedCount ?? 0} enveloppe(s) attribuée(s)`;
    if (this.key() === 'task-attach') return `${this.assignmentTasks().length} tâche(s) disponible(s) · ${this.destinationTitle() || 'destinataire à choisir'}`;
    return this.destinationTitle() || 'Création · brouillon conservé automatiquement';
  });
  protected readonly workspaceFocus = computed<BpmPageFocus>(() => {
    if (this.key() === 'project-create') return { title: 'Définissez le résultat attendu ; le budget et les tâches pourront suivre.', tone: 'info' };
    if (this.key() === 'task-create') return { title: this.taskCreated() ? 'La tâche est enregistrée. Préparez maintenant la suite.' : 'Décrivez une action concrète et choisissez son projet si vous le connaissez.', tone: this.taskCreated() ? 'success' : 'info' };
    if (this.key() === 'task-attach') return { title: this.validDestination() ? `Rattachez les tâches utiles à « ${this.destinationTitle()} ».` : 'Choisissez un projet destinataire dans le bandeau.', detail: 'Chaque rattachement actualise immédiatement l’avancement du projet.', tone: 'info' };
    if (this.key() === 'project-decisions') return { title: this.decisionCount() ? `${this.decisionCount()} décision(s) à prendre` : 'Toutes les demandes ont été traitées.', detail: 'Les parts des tâches et les autorisations de dépassement restent deux décisions distinctes.', tone: this.decisionCount() ? 'warning' : 'success' };
    return { title: this.unfundedCount() ? `${this.unfundedCount()} projet(s) attendent une enveloppe.` : 'Les projets disposent de leur enveloppe.', detail: 'Réglez ici les montants, puis répartissez-les dans les tâches du projet.', tone: this.unfundedCount() ? 'warning' : 'success' };
  });
  /** « Annuler » revient d'où l'on vient (la page parente à défaut), sans ajouter d'étape au parcours. */
  protected back() {
    this.navigation.back(this.workspace()?.parent || (this.key().startsWith('task-') ? '/app/taches' : '/app/gestion-projet'));
  }
  /**
   * Le formulaire de création est consommé : il quitte le parcours, la fiche du nouveau projet s'ouvre
   * avec la confirmation, et « Retour » ramène à la page d'où la création a été lancée.
   */
  protected projectCreated(project: { projectId: string; title: string }) {
    this.navigation.completeFlow((url) => /^\/app\/gestion-projet\/nouveau(?:[?#]|$)/.test(url));
    void this.workspaceRouter.navigate(['/app/gestion-projet', project.projectId], {
      state: { bpmNotice: `Projet « ${project.title} » créé.` },
    });
  }
  protected assignTask(taskId: string) {
    const projectId = this.validDestination();
    if (!projectId) return;
    return this.attachById(taskId, projectId);
  }
  protected completeTask(message: string) {
    this.taskSaved(message);
    this.taskCreated.set(true);
  }
}
