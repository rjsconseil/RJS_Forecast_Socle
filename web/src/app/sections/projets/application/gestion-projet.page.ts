import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, toApiError, type Priority } from '../../../platform/grand-noyau';
import { BpmPageContext, BpmRefresh, bpmLoader } from '../../../astra/cadre';
import { isWorkProject } from '../fonctionnalites/portfolio';
import { PRIORITY } from './libelles';
import { commandeProjet, commandeTache, erreurSaisie } from '../fonctionnalites/gestion';
import { PRINCE2_THEMES, SEQUENCE, processusDuTheme, processusPrince2, themePrince2 } from '../fonctionnalites/prince2';

type Panneau = 'projet' | 'tache' | null;

/**
 * Application autonome Mes projets · gestion de projet selon PRINCE2, présentation simple.
 * Un bandeau (titre, gestes de création, onglets), puis : sur l'accueil, la séquence des processus PRINCE2 ; sur un
 * thème, où il s'applique dans la séquence et la liste de ses processus. Aucune donnée de projet n'est affichée ici ;
 * les créations passent par le grand noyau (mêmes commandes, mêmes règles). Le référentiel vit dans les fonctionnalités.
 */
@Component({
  selector: 'projets-gestion-projet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  providers: [BpmPageContext],
  templateUrl: './gestion-projet.page.html',
  styleUrl: './gestion-projet.page.scss',
})
export class ProjetsGestionProjetPage {
  protected readonly ctx = inject(BpmPageContext);
  private readonly api = inject(Api);
  private readonly refresh = inject(BpmRefresh);

  protected readonly themes = PRINCE2_THEMES;
  protected readonly sequence = SEQUENCE.filter((id) => id !== 'DP').map(processusPrince2);
  protected readonly diriger = processusPrince2('DP');
  protected readonly priorities: { id: Priority; label: string }[] = (['high', 'medium', 'low'] as const).map((id) => ({ id, label: PRIORITY[id] }));

  /** Les projets, seulement pour rattacher une nouvelle tâche à l'un d'eux. */
  protected readonly data = bpmLoader(() => 0, async () => ({ projects: await this.api.projects() }));
  protected readonly projets = computed(() => (this.data.data()?.projects ?? []).filter(isWorkProject).map((p) => ({ id: p.project.id, title: p.project.title })));

  // ---------- navigation de l'application : l'accueil, puis un thème ----------
  protected readonly theme = computed(() => themePrince2(this.ctx.q('theme')()));
  protected readonly themeProcessus = computed(() => (this.theme() ? processusDuTheme(this.theme()!.id) : []));
  protected readonly themeProcessusIds = computed(() => new Set(this.themeProcessus().map((p) => p.processus.id)));

  // ---------- création ----------
  /** Saisie ouverte ; `?saisie=projet` ou `?saisie=tache` l'ouvre à l'arrivée (gestes de la palette et des onglets). */
  protected readonly panneau = signal<Panneau>(((s) => (s === 'projet' || s === 'tache' ? s : null))(this.ctx.query().get('saisie')));
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected toggle(p: Exclude<Panneau, null>) {
    this.panneau.set(this.panneau() !== p ? p : null);
    this.failure.set(null);
  }

  private async run(action: () => Promise<unknown>, done: string) {
    if (this.busy()) return false;
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      await action();
      this.notice.set(done);
      this.refresh.bump();
      return true;
    } catch (err) {
      this.failure.set(toApiError(err).message);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async createProject(form: HTMLFormElement) {
    const f = new FormData(form);
    const saisie = { title: String(f.get('title') ?? ''), description: String(f.get('description') ?? ''), priority: (f.get('priority') || 'medium') as Priority, startDate: String(f.get('startDate') ?? ''), dueDate: String(f.get('dueDate') ?? '') };
    const error = erreurSaisie(saisie);
    if (error) { this.failure.set(error); return; }
    if (await this.run(() => this.api.createProject(commandeProjet(saisie)), `Project “${saisie.title.trim()}” created.`)) { form.reset(); this.panneau.set(null); }
  }

  protected async createTask(form: HTMLFormElement) {
    const f = new FormData(form);
    const saisie = { title: String(f.get('title') ?? ''), projectId: String(f.get('projectId') ?? ''), plannedHours: String(f.get('plannedHours') ?? ''), dueDate: String(f.get('dueDate') ?? '') };
    const error = erreurSaisie(saisie);
    if (error) { this.failure.set(error); return; }
    if (await this.run(() => this.api.createTask(commandeTache(saisie)), `Task “${saisie.title.trim()}” created${saisie.projectId ? ' and linked to its project' : ' without a project'}.`)) { form.reset(); this.panneau.set(null); }
  }
}
