import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { JourneyResume } from '../../plan/journey-resume';
import { RouterLink } from '@angular/router';
import { RecetteContext } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmProjectCard, BpmTaskCard, ProjectBudgetState } from '../../core/bpm-projects.models';
import { cents } from '../../core/format';
import { TASK_STATUS_LABEL } from '../../core/models';
import { PlanCardsComponent, zoneSectionCards } from '../../home/plan-cards';
import { PlanZone } from '../../plan/site-plan';
import { bpmLoader, BpmState, FUNDING } from '../ui';

const STATE_LABEL: Record<ProjectBudgetState, string> = {
  unallocated: 'Enveloppe à attribuer',
  ok: 'Dans l’enveloppe',
  'at-risk': 'À surveiller',
  deficit: 'Enveloppe dépassée',
};
const pct = (part: number, whole: number | null | undefined) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

/**
 * Vue d'ensemble de Budget/Patrimoine Management (`/zones/bpm`) : la structure de l'application, complémentaire
 * du tableau de bord (lecture de la période). Les entrées et sorties alimentent le budget du projet de vie unique,
 * qui attribue une enveloppe à chaque projet de la vie ; chaque tâche en reçoit une part, de 0 à 100 %.
 * Lecture seule : trois lectures existantes, aucun calcul métier ici (pourcentages d'affichage seulement).
 */
@Component({
  selector: 'bpm-overview',
  imports: [RouterLink, BpmState, PlanCardsComponent, JourneyResume],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './overview.scss',
  template: `
    <div class="page bpm-app bpm-overview" data-tone="budget">
      <header class="ov-hero">
        <p class="ov-kicker">{{ zone().label }} · Vue d’ensemble</p>
        <h1>Vos finances et vos projets, <em>au même endroit.</em></h1>
        <p class="ov-lead">
          Suivez votre budget, répartissez les enveloppes de vos projets et avancez vers vos objectifs.
          Chaque montant reste relié aux opérations et aux tâches qui l’expliquent.
        </p>
        <div class="ov-hero-meta">
          @if (life.data(); as l) {
            <span>{{ l.context.user.label }}</span>
            <span>{{ l.cycle.label }}@if (l.cycle.period) { · {{ l.cycle.period.label }} }</span>
          }
        </div>
        <div class="ov-hero-actions">
          <a class="btn ov-btn-light" routerLink="/tableau-de-bord">Ouvrir mon tableau de bord →</a>
          <a class="btn ov-btn-ghost" routerLink="/app/gestion-projet" [queryParams]="{ editProject: 'new' }">＋ Créer un projet de la vie</a>
        </div>
      </header>

      <bpm-state [loading]="loading()" [error]="error()" (retry)="reload()" />

      @if (view(); as v) {
        <section class="ov-chain" aria-labelledby="ov-chain-title">
          <h2 id="ov-chain-title" class="ov-title">Votre budget en un coup d’œil</h2>
          <ol class="ov-stages">
            @for (s of v.stages; track s.key; let i = $index) {
              <li class="ov-stage" [attr.data-bpm-tone]="s.tone">
                <span class="ov-stage-step" aria-hidden="true">{{ i + 1 }}</span>
                <h3>{{ s.title }}</h3>
                <p class="ov-stage-hero">{{ s.hero }}</p>
                <dl>
                  @for (f of s.figures; track f[0]) {
                    <div><dt>{{ f[0] }}</dt><dd>{{ f[1] }}</dd></div>
                  }
                </dl>
                <a class="ov-link" [routerLink]="s.link">{{ s.action }} →</a>
                @if (s.flow) {
                  <span class="ov-flow" aria-hidden="true"><small>{{ s.flow }}</small></span>
                }
              </li>
            }
          </ol>
          <p class="ov-health" role="status">
            Santé du projet de vie :
            <span class="ov-chip" data-health="ok">{{ v.health.ok }} en règle</span>
            <span class="ov-chip" data-health="watch">{{ v.health.watch }} à surveiller</span>
            <span class="ov-chip" data-health="alert">{{ v.health.alert }} à traiter</span>
            <a class="ov-link" routerLink="/projet-de-vie">Piloter le projet de vie →</a>
          </p>
        </section>

        <rjs-journey-resume zone="bpm" title="Reprendre mon activité" />

        <section class="ov-tree" aria-labelledby="ov-tree-title" data-bpm-tone="nav-petrol">
          <div class="ov-section-head">
            <h2 id="ov-tree-title" class="ov-title">L’arbre de votre projet de vie</h2>
            <p>Chaque enveloppe vaut 100 % : elle se répartit entre les parts des tâches et ce qui reste à répartir.</p>
          </div>
          <div class="ov-root">
            <span class="ov-root-mark" aria-hidden="true">◫</span>
            <div>
              <strong>{{ v.lifeTitle }}</strong>
              <small>{{ v.projects.length }} projet(s) de la vie · {{ FUNDING.envelopes }} {{ v.allocated }}</small>
            </div>
          </div>
          <div class="ov-projects">
            @for (p of v.projects; track p.id) {
              <a class="ov-project" [routerLink]="['/app/gestion-projet', p.id]" [attr.data-state]="p.state">
                <header>
                  <h3>{{ p.title }}</h3>
                  <span class="ov-chip" [attr.data-state]="p.state">{{ p.stateLabel }}</span>
                </header>
                <p class="ov-project-meta">{{ p.status }} · {{ p.completion }} % des tâches terminées</p>
                <p class="ov-envelope"><span>{{ FUNDING.envelope }}</span><strong>{{ p.envelope }}</strong></p>
                <div class="ov-bar" role="img" [attr.aria-label]="p.barLabel">
                  @for (t of p.tasks; track t.id; let i = $index) {
                    @if (t.pct > 0) {
                      <span class="ov-seg" [style.flex-basis.%]="t.pct" [style.--seg]="i" [attr.title]="t.title + ' · ' + t.pct + ' %'"></span>
                    }
                  }
                  @if (p.restPct > 0) {
                    <span class="ov-seg ov-seg-rest" [style.flex-basis.%]="p.restPct"></span>
                  }
                </div>
                <ul class="ov-tasks">
                  @for (t of p.tasks; track t.id; let i = $index) {
                    <li>
                      <i [style.--seg]="i" aria-hidden="true"></i>
                      <span>{{ t.title }} <small>{{ t.status }}</small></span>
                      <strong>{{ t.share ? t.pct + ' % · ' + t.share : FUNDING.noShare }}</strong>
                    </li>
                  } @empty {
                    <li class="ov-muted">Aucune tâche : créez-en une pour lui accorder une part.</li>
                  }
                  @if (p.rest) {
                    <li class="ov-rest"><i aria-hidden="true"></i><span>{{ FUNDING.toShare }}</span><strong>{{ p.restPct }} % · {{ p.rest }}</strong></li>
                  }
                </ul>
                <p class="ov-paid">{{ FUNDING.paidOnEnvelope }} : <strong>{{ p.paid }}</strong></p>
              </a>
            }
            <a class="ov-project ov-project-new" routerLink="/app/gestion-projet" [queryParams]="{ editProject: 'new' }">
              <span aria-hidden="true">＋</span>
              <strong>Nouveau projet de la vie</strong>
              <small>Le budget du projet de vie lui attribuera son enveloppe.</small>
            </a>
          </div>
        </section>

        <div class="ov-duo">
          <section class="ov-panel" aria-labelledby="ov-decisions-title" data-bpm-tone="nav-teal">
            <h2 id="ov-decisions-title" class="ov-title">Décisions attendues</h2>
            @if (v.decisions.length) {
              <ul class="ov-list">
                @for (d of v.decisions; track d.id) {
                  <li><span>{{ d.label }}</span><strong>{{ d.amount }}</strong></li>
                }
              </ul>
              <a class="btn btn-primary" routerLink="/app/gestion-projet" [queryParams]="{ decisions: 'tasks' }">Décider les demandes</a>
            } @else {
              <p class="ov-muted">Aucune demande de part ni de dépassement en attente : toutes les décisions sont prises.</p>
            }
          </section>
          <section class="ov-panel" aria-labelledby="ov-wealth-title" data-bpm-tone="nav-cyan">
            <h2 id="ov-wealth-title" class="ov-title">Et au bout : votre patrimoine</h2>
            <p class="ov-muted">Le résultat de chaque cycle clos rejoint votre patrimoine unique.</p>
            <p class="ov-envelope"><span>Patrimoine enregistré</span><strong>{{ v.wealth.stock }}</strong></p>
            @if (v.wealth.progress !== null) {
              <div class="ov-bar ov-bar-thin" role="img" [attr.aria-label]="v.wealth.progress + ' % de l’objectif'">
                <span class="ov-seg" [style.flex-basis.%]="v.wealth.progress"></span>
              </div>
              <p class="ov-paid">{{ v.wealth.progress }} % de l’objectif de {{ v.wealth.objective }}</p>
            }
            <a class="ov-link" routerLink="/vision">Objectifs et avenir →</a>
          </section>
        </div>
      }

      <section class="ov-spaces" aria-labelledby="ov-spaces-title">
        <h2 id="ov-spaces-title" class="ov-title">Les espaces de l’application</h2>
        <rjs-plan-cards [cards]="spaces()" />
      </section>
    </div>
  `,
})
export class BpmOverviewPage {
  readonly zone = input.required<PlanZone>();
  protected readonly FUNDING = FUNDING;
  private readonly ctx = inject(RecetteContext);
  private readonly api = inject(BpmApi);
  protected readonly life = bpmLoader(() => null, () => this.api.lifeManagement());
  private readonly projects = bpmLoader(() => null, () => this.api.projectsOverview());
  private readonly tasks = bpmLoader(() => null, () => this.api.tasksOverview());
  private readonly loaders = [this.life, this.projects, this.tasks];
  protected readonly loading = computed(() => this.loaders.some((l) => l.loading() && !l.data()));
  protected readonly error = computed(() => this.loaders.map((l) => l.error()).find(Boolean) ?? null);
  protected readonly spaces = computed(() => zoneSectionCards(this.zone(), this.ctx.connected()));
  protected reload() {
    this.loaders.forEach((l) => l.reload());
  }

  protected readonly view = computed(() => {
    const l = this.life.data(), o = this.projects.data(), t = this.tasks.data();
    if (!l || !o || !t) return null;
    const f: Partial<NonNullable<typeof l.cycle.flows>> = l.cycle.flows ?? {};
    const sum = (...v: (number | null | undefined)[]) => v.reduce<number>((a, b) => a + (b ?? 0), 0);
    const projects = o.projects.map((p) => this.project(p, t.tasks));
    const sharedTasks = t.tasks.filter((x) => x.projectRole === 'standard' && (x.budget?.shareCents ?? 0) > 0).length;
    return {
      lifeTitle: o.lifeProject.project.title,
      allocated: cents(o.life.allocatedCents),
      health: l.pilot.counts,
      projects,
      stages: [
        { key: 'flows', tone: 'nav-iris', title: 'Entrées et sorties', hero: cents(sum(f.receivedCents, f.toReceiveCents)),
          figures: [['Entrées du cycle', cents(sum(f.receivedCents, f.toReceiveCents))], ['Sorties du cycle', cents(sum(f.paidCents, f.toPayCents))], ['Solde prévu à la clôture', cents(f.expectedCents)]],
          link: '/tableau-de-bord', action: 'Lire la période', flow: 'alimentent' },
        { key: 'life', tone: '', title: 'Budget du projet de vie', hero: o.lifeProject.project.title,
          figures: [[l.natures.indispensable.label, cents(l.natures.indispensable.plannedCents)], [l.natures.courante.label, cents(l.natures.courante.plannedCents)], [FUNDING.envelopes, cents(o.life.allocatedCents)]],
          link: '/projet-de-vie', action: 'Gérer le projet de vie', flow: 'attribue ' + cents(o.life.allocatedCents) },
        { key: 'projects', tone: 'nav-petrol', title: 'Projets de la vie', hero: `${o.life.projectCount} projet(s)`,
          figures: [['Financés', `${o.life.fundedCount} / ${o.life.projectCount}`], [FUNDING.envelopes, cents(o.life.allocatedCents)], [FUNDING.paidOnEnvelopes, cents(o.life.paidCents)]],
          link: '/app/projets', action: 'Voir les projets', flow: 'accordent ' + cents(o.life.sharesCents) },
        { key: 'tasks', tone: 'nav-teal', title: 'Tâches', hero: `${t.tasks.filter((x) => x.projectRole === 'standard').length} tâche(s)`,
          figures: [['Dotées d’une part', String(sharedTasks)], [FUNDING.shared, cents(o.life.sharesCents)], [FUNDING.toShare, cents(o.life.availableCents)]],
          link: '/app/taches', action: 'Faire avancer les tâches', flow: '' },
      ],
      decisions: [
        ...o.life.taskRequests.map((r) => ({ id: r.id, label: `Part demandée · ${r.taskTitle}`, amount: cents(r.amountCents) })),
        ...o.life.pendingRequests.map((r) => ({ id: r.id, label: 'Dépassement d’enveloppe à autoriser', amount: cents(r.amountCents) })),
      ],
      wealth: { stock: cents(l.patrimoine.stockCents), objective: cents(l.patrimoine.objectiveCents), progress: l.patrimoine.progressPct === null ? null : Math.min(100, Math.round(l.patrimoine.progressPct * 10) / 10) },
    };
  });

  /** Une branche de l'arbre : l'enveloppe (100 %) répartie entre les parts des tâches et le reste à répartir. */
  private project(p: BpmProjectCard, tasks: BpmTaskCard[]) {
    const b = p.budget;
    const envelope = b?.ceilingCents ?? b?.allocationCents ?? 0;
    const mine = tasks.filter((x) => x.task.projectId === p.project.id).map((x) => {
      const share = x.budget?.shareCents ?? 0;
      return { id: x.task.id, title: x.task.title, status: TASK_STATUS_LABEL[x.task.status], share: share ? cents(share) : '', pct: pct(share, envelope) };
    });
    const restCents = Math.max(0, envelope - (b?.sharesCents ?? 0));
    const restPct = envelope ? Math.max(0, Math.round((100 - mine.reduce((a, x) => a + x.pct, 0)) * 10) / 10) : 0;
    const state = b?.state ?? 'unallocated';
    return {
      id: p.project.id,
      title: p.project.title,
      status: p.view.statusLabel,
      completion: p.view.completionPercent,
      state,
      stateLabel: STATE_LABEL[state],
      envelope: envelope ? cents(envelope) : 'À attribuer',
      paid: cents(b?.paidCents ?? 0),
      tasks: mine,
      rest: restCents ? cents(restCents) : '',
      restPct,
      barLabel: `${FUNDING.envelope} ${cents(envelope)} : ${mine.map((x) => `${x.title} ${x.pct} %`).join(', ')}${restCents ? `, ${FUNDING.toShare} ${restPct} %` : ''}`,
    };
  }
}
