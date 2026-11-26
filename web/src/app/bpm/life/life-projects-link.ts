import { BpmAmount } from '../ui/amount';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { BpmRouterLink } from '../ui/bpm-router-link';
import { BpmApi } from '../data/bpm-api.service';
import { CentsPipe, SignedCentsPipe } from '../../core/format';
import { bpmLoader } from '../ui';

/** La page de « Mon projet de vie » qui affiche le lien. */
export type LifeLinkContext = 'cycle' | 'pilotage' | 'patrimoine' | 'postes';

/**
 * Le lien principal de « Mon projet de vie » : l'argent que le projet de vie confie à ses projets de la vie.
 * L'enveloppe attribuée devient des parts de tâches, puis des dépenses réglées ; ces dépenses comptent dans le
 * cycle où elles sont payées, sur leur poste et ses plafonds, et elles retiennent une part de ce qui rejoint le
 * patrimoine. Le même bandeau, sur les quatre pages, dit ce que ce lien représente pour la page affichée.
 */
@Component({
  selector: 'bpm-life-projects-link',
  imports: [BpmAmount, BpmRouterLink, CentsPipe, SignedCentsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (overview.data(); as o) {
      <section class="lpl" data-bpm-tone="nav-petrol" aria-labelledby="lpl-title">
        <header class="lpl-head">
          <div>
            <p class="lpl-kick">Le projet de vie et ses projets de la vie</p>
            <h2 id="lpl-title">{{ title() }}</h2>
          </div>
          <a class="btn btn-secondary small" routerLink="/projet-de-vie/projets">Ouvrir les projets au quotidien</a>
        </header>

        <!-- La chaîne : du projet de vie aux tâches, puis retour au cycle. -->
        <ol class="lpl-chain">
          <li><small>Le projet de vie attribue</small><strong [bpmAmount]="o.life.allocatedCents" bpmTone="info">{{ o.life.allocatedCents | cents }}</strong><span>à {{ o.life.fundedCount }} / {{ o.life.projectCount }} projet(s)</span></li>
          <li><small>Les projets répartissent</small><strong [bpmAmount]="o.life.sharesCents" bpmTone="info">{{ o.life.sharesCents | cents }}</strong><span>en parts de tâches · {{ o.life.availableCents | cents }} à répartir</span></li>
          <li><small>Les tâches règlent{{ periodLabel() ? ' · ' + periodLabel() : '' }}</small><strong [bpmAmount]="projectsPaidCents()" bpmFlow="expense">{{ projectsPaidCents() | cents }}</strong><span>comptés au cycle@if (withdrawnCents()) { · {{ withdrawnCents() | cents }} prélevés sur le patrimoine }</span></li>
          <li class="lpl-here">
            @switch (context()) {
              @case ('cycle') {
                <small>Dans le dépensé du cycle</small><strong>{{ projectsSharePct() === null ? '—' : projectsSharePct() + ' %' }}</strong>
                <span>Sans les projets, le résultat serait {{ resultWithoutProjects() | signedCents }}</span>
              }
              @case ('pilotage') {
                <small>À décider pour les projets</small><strong>{{ o.life.taskRequests.length + o.life.pendingRequests.length }}</strong>
                <span>demande(s) · {{ o.life.projectCount - o.life.fundedCount }} projet(s) sans enveloppe · {{ o.life.deficitCount }} en dépassement</span>
              }
              @case ('patrimoine') {
                <small>Retenu et prélevé sur le patrimoine</small><strong [bpmAmount]="((bilans.data()?.totals?.projectsClosedCents ?? 0) + (bilans.data()?.totals?.withdrawnCents ?? 0))" bpmFlow="expense">{{ ((bilans.data()?.totals?.projectsClosedCents ?? 0) + (bilans.data()?.totals?.withdrawnCents ?? 0)) | cents }}</strong>
                <span>{{ (bilans.data()?.totals?.projectsClosedCents ?? 0) | cents }} retenus par les cycles clos · {{ (bilans.data()?.totals?.withdrawnCents ?? 0) | cents }} prélevés hors cycle · {{ o.life.remainingCents | cents }} encore à dépenser</span>
              }
              @case ('postes') {
                <small>Dans vos postes ce cycle</small><strong [bpmAmount]="projectsPaidCents()" bpmFlow="expense">{{ projectsPaidCents() | cents }}</strong>
                <span>comptés dans les plafonds des postes où ils sont réglés</span>
              }
            }
          </li>
        </ol>

        <p class="lpl-note">{{ note() }}</p>

        @if (context() === 'postes' && bilan.data()?.bilan?.projectCenters?.length) {
          <ul class="lpl-list" aria-label="Dépenses des projets par poste">
            @for (c of bilan.data()!.bilan.projectCenters!; track c.ref) {
              <li><span>{{ c.label }}<small>{{ c.projects.join(' · ') }}</small></span><strong [bpmAmount]="c.paidCents" bpmFlow="expense">{{ c.paidCents | cents }}</strong></li>
            }
          </ul>
        } @else if (projects().length) {
          <ul class="lpl-list" aria-label="Projets de la vie financés">
            @for (p of projects(); track p.id) {
              <li>
                <a [routerLink]="['/app/gestion-projet', p.id, 'budget']">{{ p.title }}@if (p.source === 'patrimoine') { <em class="lpl-source">patrimoine</em> }<small>{{ p.cyclePaid ? (p.cyclePaid | cents) + ' réglés ce cycle · ' : '' }}{{ p.paid | cents }} sur {{ p.envelope | cents }}</small></a>
                <span class="lpl-bar" role="img" [attr.aria-label]="p.pct + ' % de l’enveloppe réglée'"><span [style.width.%]="p.pct" [class.is-over]="p.pct >= 100"></span></span>
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
  styleUrl: './life-projects-link.scss',
})
export class BpmLifeProjectsLink {
  readonly context = input.required<LifeLinkContext>();
  /** La période lue par la page ; sans elle, la période en cours. */
  readonly periodKey = input<string | null | undefined>(null);
  private readonly bpm = inject(BpmApi);
  protected readonly overview = bpmLoader(() => 0, () => this.bpm.projectsOverview());
  protected readonly bilan = bpmLoader(() => this.periodKey() || 'current', (k) => this.bpm.bilan(k));
  protected readonly bilans = bpmLoader(() => this.context(), (c) => (c === 'patrimoine' ? this.bpm.bilans() : Promise.resolve(null)));

  protected readonly periodLabel = computed(() => this.bilan.data()?.bilan.period.label ?? '');
  protected readonly projectsPaidCents = computed(() => this.bilan.data()?.bilan.patrimoine.projectsCents ?? 0);
  protected readonly withdrawnCents = computed(() => this.bilan.data()?.bilan.patrimoine.withdrawnCents ?? 0);
  protected readonly projectsSharePct = computed(() => this.bilan.data()?.bilan.natures.find((n) => n.key === 'projet')?.sharePct ?? null);
  protected readonly resultWithoutProjects = computed(() => {
    const b = this.bilan.data()?.bilan;
    const r = b?.patrimoine.capitalizedCents ?? b?.flows.resultCents ?? null;
    return r === null ? null : r + (b?.patrimoine.projectsCents ?? 0);
  });
  protected readonly title = computed(() => ({
    cycle: 'Ce que vos projets pèsent sur le cycle',
    pilotage: 'Le projet de vie finance ses projets',
    patrimoine: 'Ce que vos projets retiennent du patrimoine',
    postes: 'Les dépenses de vos projets dans vos postes',
  })[this.context()]);
  protected readonly note = computed(() => ({
    cycle: 'Une dépense de tâche compte dans le cycle choisi pour sa validation. Sa date de paiement reste tracée, même si elle appartient à un autre cycle.',
    pilotage: 'Les enveloppes et les parts préparent les moyens sans débiter le budget. Seuls les dépenses et gains validés depuis les tâches sont imputés au cycle choisi ou au patrimoine.',
    patrimoine: 'La source se choisit pour chaque dépense ou gain de tâche : le cycle choisi pour sa validation, ou directement le patrimoine après validation.',
    postes: 'Une dépense de projet est réglée sur un poste : elle compte dans le plafond de ce poste, comme toute autre dépense du cycle.',
  })[this.context()]);
  /** Les projets financés : réglé depuis l'attribution sur l'enveloppe, et réglé pendant la période lue. */
  protected readonly projects = computed(() => {
    const cycle = new Map((this.bilan.data()?.bilan.projects ?? []).map((p) => [p.coreProjectId, p.paidCents]));
    return (this.overview.data()?.projects ?? [])
      .filter((p) => p.role === 'standard' && p.budget?.regime)
      .map((p) => {
        const envelope = p.budget!.ceilingCents ?? p.budget!.allocationCents ?? 0;
        return { id: p.project.id, title: p.project.title, source: p.budget!.fundingSource ?? 'cycle', paid: p.budget!.paidCents, envelope, cyclePaid: cycle.get(p.project.id) ?? 0, pct: envelope ? Math.min(100, Math.round((p.budget!.paidCents / envelope) * 100)) : 0 };
      })
      .sort((x, y) => y.cyclePaid - x.cyclePaid || y.paid - x.paid)
      .slice(0, 4);
  });
}
