import { BpmAmount } from '../ui/amount';
import { Component, computed, inject } from '@angular/core';
import { BpmRouterLink } from '../ui/bpm-router-link';
import { injectPageWorkspace } from '../../plan/page-workspace';
import { BpmApi } from '../data/bpm-api.service';
import { CentsPipe, ShortDatePipe } from '../../core/format';
import { BpmPageContext, BpmPageFrame, BpmState, bpmLoader } from '../ui';
import { BpmSetupNeeded, setupProblem } from './dashboard-parts';
import { BankReconciliationComponent } from './bank-reconciliation.component';

@Component({
  selector:'bpm-page-balance',
  providers:[BpmPageContext],
  imports:[BpmAmount, BpmRouterLink,BpmPageFrame,BpmState,BpmSetupNeeded,BankReconciliationComponent,CentsPipe,ShortDatePipe],
  styleUrls:['../ref-styles/bpm-pages.scss','./vision-workspace.scss'],
  template:`
    <bpm-page title="Rapprochement bancaire" lead="Du budget à vos comptes : comparez les mêmes dates, expliquez les écarts, puis vérifiez les mouvements." [context]="balance.data()?.context" [periodKey]="ctx.period()" [periodNav]="true" (periodChange)="ctx.setQuery({period:$event})" toolsLabel="Cycle à rapprocher">
      <button primary class="btn btn-primary" type="button" [disabled]="!balance.data()" (click)="compare()">Saisir le solde de mon relevé</button>
      <a actions class="btn btn-secondary" routerLink="/tableau-de-bord/entrees" [queryParams]="ctx.carry()">Registre de flux →</a>
      @if (problem(); as p) {<bpm-setup-needed [kind]="p" [message]="balance.error()?.message ?? ''" />}
      @else if (!balance.data() || balance.error()) {<bpm-state [loading]="balance.loading()" [error]="balance.error()" (retry)="balance.reload()" />}
      @else if (balance.data()?.context?.period; as cycle) {
        <section class="vision-panel">
          <span class="vision-eyebrow">Votre référence budgétaire</span><h2>Cycle du {{cycle.start | shortDate}} · contrôle au {{controlDate() | shortDate}}</h2>
          <p>{{balance.data()!.context.scopeLabel}}. Seuls les règlements du {{cycle.start | shortDate}} au {{controlDate() | shortDate}} sont comparés. Les échéances encore attendues ne sont pas des mouvements bancaires.</p>
          @if (register.error()) {<bpm-state [error]="register.error()" (retry)="register.reload()" />}
          @else if (register.loading()) {<p role="status">Lecture des règlements…</p>}
          @else if (register.data(); as r) {
            <div class="vision-metrics">
              <article data-flow="income"><span>Entrées reçues</span><strong [bpmAmount]="r.totals.byDirection?.income?.settledCents" bpmFlow="income">{{r.totals.byDirection?.income?.settledCents ?? 0 | cents}}</strong></article>
              <article data-flow="charge"><span>Sorties payées</span><strong [bpmAmount]="r.totals.byDirection?.charge?.settledCents" bpmFlow="charge">{{r.totals.byDirection?.charge?.settledCents ?? 0 | cents}}</strong></article>
              <article><span>À vérifier sur vos relevés</span><strong>{{r.totals.lineCount}} flux</strong><a routerLink="/tableau-de-bord/entrees" [queryParams]="{period:ctx.period(),from:cycle.start,to:controlDate(),dateBasis:'realized',direction:'all'}">Ouvrir exactement ces mouvements →</a></article>
            </div>
          }
        </section>
        @for (key of [cycle.key + ':' + balance.data()!.context.user.id]; track key) {
          <bpm-bank-reconciliation [net]="register.loading() || register.error() ? null : register.data()?.totals?.netSettledCents ?? null" [from]="cycle.start" [to]="controlDate()" [period]="ctx.period()" />
        }
      }
    </bpm-page>
  `,
})
export class BpmBalancePage {
  protected workspace=injectPageWorkspace();
  protected ctx=inject(BpmPageContext);
  private bpm=inject(BpmApi);
  protected balance=bpmLoader(()=>({period:this.ctx.period()}),q=>this.bpm.balance(q));
  protected problem=computed(()=>setupProblem(this.balance.error()));
  /** Action principale : aller à la comparaison et mettre le curseur dans le premier solde à saisir. */
  protected compare(){
    const title=document.getElementById('bank-title');
    title?.scrollIntoView({block:'start',behavior:'smooth'});
    title?.closest('section')?.querySelector<HTMLInputElement>('input:not([type=hidden]),select')?.focus({preventScroll:true});
  }
  protected controlDate=computed(()=>{
    const data=this.balance.data();
    if (!data?.context.period) return '';
    const last=new Date(data.context.period.endExclusive+'T12:00:00Z');
    last.setUTCDate(last.getUTCDate()-1);
    return [last.toISOString().slice(0,10),data.context.calculationDate].sort()[0];
  });
  protected register=bpmLoader(()=>({from:this.balance.data()?.context.period?.start,to:this.controlDate(),period:this.ctx.period(),user:this.balance.data()?.context.user.id}),q=>q.from && q.to ? this.bpm.register({from:q.from,to:q.to,period:q.period,dateBasis:'realized',direction:'',status:'settled'}) : Promise.resolve(null));
}
