import { BpmAmount } from './amount';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BpmRouterLink } from './bpm-router-link';
import { CentsPipe, SignedCentsPipe, ShortDatePipe } from '../../core/format';
import { BpmApi } from '../data/bpm-api.service';
import { RegisterLine } from '../data/bpm-models';
import { bpmLoader } from './page-context';
import { BpmState } from './state';
import { BpmLineDetail } from './line-detail';

/** Même lecture des origines sur le cycle, le patrimoine et la fiche d'un projet. */
@Component({
  selector: 'bpm-project-flows',
  imports: [BpmAmount, BpmRouterLink, CentsPipe, SignedCentsPipe, ShortDatePipe, BpmState, BpmLineDetail],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './project-flows.scss',
  template: `
    <section class="flow-panel" [id]="anchor()" [attr.aria-labelledby]="anchor() + '-title'">
      <header><div><span class="eyebrow">Origine des mouvements · projets de la vie</span><h2 [id]="anchor() + '-title'">{{ title() }}</h2><p>{{ source() === 'cycle' ? 'Le cycle d’imputation porte seul la charge ou le gain. Le cycle d’annonce et celui du paiement en gardent la trace.' : source() === 'patrimoine' ? 'Les mouvements validés ci-dessous sont déjà compris dans le stock. Les enveloppes et les parts n’y sont jamais prélevées.' : 'Pour chaque achat ou gain : sa tâche, sa date et sa destination financière.' }}</p></div>
        @if (source() === 'cycle') { <a routerLink="/vision" fragment="wealth-project-flows">Prélèvements sur le patrimoine ↗</a> }
        @else { <a routerLink="/projet-de-vie/cloture" fragment="cycle-project-flows">Imputations au cycle ↗</a> }
      </header>
      <bpm-state [loading]="report.loading() && !report.data()" [error]="report.error()" (retry)="report.reload()" />
      @if (report.data(); as d) {
        <p class="flow-scope">{{ source() === 'cycle' ? (d.context.period?.label ?? 'Cycle à configurer') : 'Cumul validé au ' + dateText(d.to) }} · {{ d.projects.length }} projet(s)</p>
        <dl class="flow-totals"><div><dt>Dépenses validées</dt><dd [bpmAmount]="d.totals.paidCents" bpmFlow="charge">{{ d.totals.paidCents | cents }}</dd></div><div><dt>Gains et remboursements</dt><dd [bpmAmount]="d.totals.receivedCents" bpmFlow="income">{{ d.totals.receivedCents | cents }}</dd></div><div [class.negative]="d.totals.netCents < 0"><dt>{{ source() === 'patrimoine' ? 'Effet net sur le stock' : source() === 'cycle' ? 'Effet net sur le résultat' : 'Effet net des flux' }}</dt><dd [bpmAmount]="d.totals.netCents">{{ d.totals.netCents | signedCents }}</dd></div></dl>
        @if (source() === 'all') { <div class="flow-destinations"><a routerLink="/projet-de-vie/cloture">Cycles · <span [bpmAmount]="d.bySource.cycle.netCents">{{ d.bySource.cycle.netCents | signedCents }}</span></a><a routerLink="/vision" fragment="wealth-project-flows">Patrimoine · <span [bpmAmount]="d.bySource.patrimoine.netCents">{{ d.bySource.patrimoine.netCents | signedCents }}</span></a></div> }
        @if (d.projects.length > 1 && !projectId()) {
          <label class="flow-filter">Projet à examiner <select [value]="selectedProject()" (change)="selectedProject.set($any($event.target).value)"><option value="">Tous les projets</option>@for (p of d.projects; track p.id) { <option [value]="p.id">{{ p.name }}</option> }</select><small>Les trois chiffres ci-dessus portent sur tous les projets.</small></label>
        }
        <div class="flow-origins">
          @for (p of visibleProjects(); track p.id) {
            <details class="flow-project" [open]="!!projectId() || !!selectedProject()">
              <summary><span><strong>{{ p.name }}</strong><small>{{ p.count }} flux validé(s) · {{ p.pendingCount }} annoncé(s)</small></span><span class="flow-net" [bpmAmount]="p.netCents">{{ p.netCents | signedCents }}</span></summary>
              <a class="flow-project-link" [routerLink]="['/app/gestion-projet', p.coreProjectId, 'budget']">Ouvrir le budget et les tâches de ce projet ↗</a>
              <ul class="flow-lines">@for (l of lines(p.id); track l.id) {
                <li><button type="button" class="flow-open" (click)="lineId.set(l.id)"><strong>{{ l.label }}</strong><span>{{ l.taskTitle ?? 'Tâche historique non renseignée' }} · {{ l.costCenterLabel }}</span></button><span class="flow-amount" [bpmAmount]="l.realizedCents" [bpmFlow]="l.direction">{{ l.realizedCents | cents }}</span><div class="flow-dates"><span>Prévu {{ l.plannedDate | shortDate }}</span><span>{{ l.direction === 'income' ? 'Reçu' : 'Payé' }} {{ l.realizedDate | shortDate }}</span><strong>{{ l.fundingSource === 'patrimoine' ? 'Patrimoine' : 'Cycle' }} · imputé {{ l.accountingDate | shortDate }}</strong></div></li>
              } @empty { <li class="flow-empty">Aucun flux validé pour ce projet sur ce périmètre.</li> }</ul>
              @if (pending(p.id).length) { <div class="flow-pending"><h3>À valider · sans effet sur le réalisé</h3><ul class="flow-lines">@for (l of pending(p.id); track l.id) { <li><button type="button" class="flow-open" (click)="lineId.set(l.id)"><strong>{{ l.label }}</strong><span>{{ l.taskTitle ?? 'Tâche à préciser' }} · {{ l.fundingSource === 'patrimoine' ? 'Patrimoine proposé' : 'Cycle proposé' }}</span></button><span><span [bpmAmount]="l.plannedCents" [bpmFlow]="l.direction">{{ l.plannedCents | cents }}</span> · {{ l.plannedDate | shortDate }}</span></li> }</ul></div> }
            </details>
          } @empty { <p class="flow-empty">Aucun flux de projet sur ce périmètre. Attribuer une enveloppe ou une part n’ajoute aucun mouvement ici.</p> }
        </div>
        @if (d.totals.pendingCount) { <p class="flow-note">Encore annoncé : <span [bpmAmount]="d.totals.pendingPaidCents" bpmFlow="charge">{{ d.totals.pendingPaidCents | cents }}</span> de dépenses et <span [bpmAmount]="d.totals.pendingReceivedCents" bpmFlow="income">{{ d.totals.pendingReceivedCents | cents }}</span> de gains jusqu’au {{ d.pendingUntil | shortDate }}. La destination proposée reste à confirmer à la validation.</p> }
        @if (d.announcementTrace.length || d.paymentTrace.length) {
          <details class="flow-traces"><summary>Annoncé ou payé ici, imputé à un autre cycle</summary><p>Ces traces sont exclues des totaux de ce cycle.</p>
            @for (l of traces(); track l.id) { <p><button type="button" class="flow-open" (click)="lineId.set(l.id)">{{ l.label }} · {{ l.budgetName }}</button> · <span [bpmAmount]="l.realizedCents" [bpmFlow]="l.direction">{{ l.realizedCents | cents }}</span> · prévu {{ l.plannedDate | shortDate }}, payé {{ l.realizedDate | shortDate }}, imputé {{ l.accountingDate | shortDate }}</p> }
          </details>
        }
      }
    </section>
    @if (lineId(); as id) { <bpm-line-detail [lineId]="id" [period]="period()" (closed)="lineId.set(null)" (saved)="report.reload()" (edit)="edit($event)" /> }
  `,
})
export class BpmProjectFlowsPanel {
  readonly source = input<'cycle' | 'patrimoine' | 'all'>('cycle');
  readonly period = input<string | undefined>(undefined);
  readonly projectId = input<string | undefined>(undefined);
  readonly anchor = input('cycle-project-flows');
  private readonly api = inject(BpmApi);
  private readonly router = inject(Router);
  protected readonly report = bpmLoader(() => ({ source: this.source(), period: this.period(), projectId: this.projectId() }), q => this.api.projectFlows(q));
  protected readonly title = computed(() => this.source() === 'cycle' ? 'Ce que les projets imputent à ce cycle' : this.source() === 'patrimoine' ? 'Ce que les projets prélèvent et apportent' : 'Où passent les dépenses et les gains du projet');
  protected readonly selectedProject = signal('');
  protected readonly lineId = signal<string | null>(null);
  protected readonly visibleProjects = computed(() => this.report.data()?.projects.filter(p => !this.selectedProject() || p.id === this.selectedProject()) ?? []);
  protected readonly traces = computed(() => [...new Map([...(this.report.data()?.announcementTrace ?? []), ...(this.report.data()?.paymentTrace ?? [])].map(l => [l.id, l])).values()]);
  protected lines(id: string) { return this.report.data()?.lines.filter(l => l.budgetId === id) ?? []; }
  protected pending(id: string) { return this.report.data()?.pending.filter(l => l.budgetId === id) ?? []; }
  protected dateText(value: string) { return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(value)); }
  protected edit(line: RegisterLine) {
    const project = this.report.data()?.projects.find(p => p.id === line.budgetId);
    if (project) { this.lineId.set(null); void this.router.navigate(['/app/gestion-projet', project.coreProjectId, 'budget'], { queryParams: { entry: line.id } }); }
  }
}
