import { BpmAmount } from './amount';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { BpmRouterLink } from './bpm-router-link';
import { CentsPipe, SignedCentsPipe, ShortDatePipe } from '../../core/format';
import { BpmApi } from '../data/bpm-api.service';
import { bpmLoader } from './page-context';
import { BpmState } from './state';

@Component({
  selector: 'bpm-financial-outlook',
  imports: [BpmAmount, BpmRouterLink, CentsPipe, SignedCentsPipe, ShortDatePipe, BpmState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './financial-outlook.scss',
  template: `
    <section class="outlook" [id]="anchor()" [attr.aria-labelledby]="anchor() + '-title'">
      <header><div><span class="eyebrow">Réalisé → annoncé → prévision</span><h2 [id]="anchor() + '-title'">Ce qui reste après vos dépenses prévues</h2><p>Le quotidien et les tâches de projets, sur leurs dates annoncées. Les enveloppes, parts et objectifs ne sont pas déduits.</p></div><label>Horizon<select [value]="horizon()" (change)="horizon.set(+$any($event.target).value)"><option value="3">3 cycles</option><option value="6">6 cycles</option><option value="12">12 cycles</option></select></label></header>
      <bpm-state [loading]="report.loading()" [error]="report.error()" (retry)="report.reload()" />
      @if (report.data(); as d) {
        <dl class="outlook-overview"><div><dt>Patrimoine disponible</dt><dd [bpmAmount]="d.stockCents">{{ d.stockCents | signedCents }}</dd><small>Validations déjà prises en compte</small></div><div><dt>Résultat prévu du cycle courant</dt><dd [bpmAmount]="d.cycles[0]?.expectedCents">{{ d.cycles[0]?.expectedCents ?? null | signedCents }}</dd><small>Achats et gains de tâches annoncés inclus</small></div><div><dt>Patrimoine estimé après {{ d.cycles.length }} cycles</dt><dd [bpmAmount]="lastStock()">{{ lastStock() | signedCents }}</dd><small>Après clôtures et mouvements directs prévus</small></div></dl>
        @if (d.reason) { <p>{{ d.reason }} <a routerLink="/app/reglages/cycle">Fixer le cycle ↗</a></p> }
        @if (d.waiting.length) { <details class="outlook-waiting"><summary>{{ d.waiting.length }} cycle(s) passé(s) à clôturer · <span [bpmAmount]="d.waitingCents">{{ d.waitingCents | signedCents }}</span></summary><p>Leurs résultats réalisés sont inclus une fois dans l’estimation future ; ils ne sont pas encore dans le stock disponible. Les opérations encore non réalisées de ces cycles restent à régulariser.</p><ul>@for (w of d.waiting; track w.period.key) { <li><a routerLink="/projet-de-vie/cloture" [queryParams]="{period:w.period.key}">{{ w.period.label }}</a><strong [bpmAmount]="w.resultCents">{{ w.resultCents | signedCents }}</strong></li> }</ul></details> }
        <div class="outlook-cycles">@for (c of d.cycles; track c.period.key) {
          <details class="outlook-cycle">
            <summary><span><strong>{{ c.period.label }}</strong><small>{{ c.period.start | shortDate }} → {{ c.period.end | shortDate }}</small></span><span><small>Résultat prévu</small><strong [bpmAmount]="c.expectedCents">{{ c.expectedCents | signedCents }}</strong></span><span><small>Patrimoine après</small><strong [bpmAmount]="c.stockAfterCents">{{ c.stockAfterCents | signedCents }}</strong></span><span aria-hidden="true">＋</span></summary>
            <div class="outlook-details"><dl><div><dt>Résultat déjà validé</dt><dd [bpmAmount]="c.actualCents">{{ c.actualCents | signedCents }}</dd></div><div><dt>Quotidien restant · entrées / dépenses</dt><dd><span [bpmAmount]="c.lifeIncomeCents" bpmFlow="income">{{ c.lifeIncomeCents | cents }}</span> / <span [bpmAmount]="c.lifeChargeCents" bpmFlow="charge">{{ c.lifeChargeCents | cents }}</span></dd></div><div><dt>Tâches annoncées sur le cycle · gains / dépenses</dt><dd><span [bpmAmount]="c.projectIncomeCents" bpmFlow="income">{{ c.projectIncomeCents | cents }}</span> / <span [bpmAmount]="c.projectChargeCents" bpmFlow="charge">{{ c.projectChargeCents | cents }}</span></dd></div><div><dt>Tâches annoncées sur le patrimoine · gains / dépenses</dt><dd><span [bpmAmount]="c.wealthIncomeCents" bpmFlow="income">{{ c.wealthIncomeCents | cents }}</span> / <span [bpmAmount]="c.wealthChargeCents" bpmFlow="charge">{{ c.wealthChargeCents | cents }}</span></dd></div></dl>
              @if (c.projects.length) { <h3>Quels projets font évoluer ces montants ?</h3><ul>@for (p of c.projects; track p.projectId) { <li><a [routerLink]="['/app/gestion-projet',p.projectId,'budget']">{{ p.name }}</a><span>Cycle <span [bpmAmount]="p.cycleCents">{{ p.cycleCents | signedCents }}</span></span><span>Patrimoine <span [bpmAmount]="p.patrimoineCents">{{ p.patrimoineCents | signedCents }}</span></span></li> }</ul> }
              <p>Patrimoine estimé : {{ c.stockBeforeCents | signedCents }} + résultat du cycle + gains directs − dépenses directes. Un prélèvement déjà validé n’est pas déduit à nouveau.</p>
            </div>
          </details>
        }</div>
        <footer><p>Prévision fondée sur les opérations enregistrées, sans rendement supposé ni dépenses inventées. La date et la destination seront confirmées à la validation. Les prélèvements sur le patrimoine en retard sont inclus dans la première estimation.</p><a routerLink="/calendrier-budget">Replanifier les événements ↗</a><a routerLink="/vision/projection">Scénario patrimonial à long terme ↗</a></footer>
      }
    </section>
  `,
})
export class BpmFinancialOutlookPanel {
  readonly anchor = input('bpm-outlook');
  protected readonly horizon = signal(3);
  private readonly api = inject(BpmApi);
  protected readonly report = bpmLoader(this.horizon, h => this.api.financialOutlook(h));
  protected readonly lastStock = computed(() => this.report.data()?.cycles.at(-1)?.stockAfterCents ?? null);
}
