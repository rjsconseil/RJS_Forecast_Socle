import { BpmAmount } from '../ui/amount';
import { Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BpmRouterLink } from '../ui/bpm-router-link';
import { CentsPipe, SignedCentsPipe, ShortDatePipe, parseAmount } from '../../core/format';

export interface BankBalance { id: number; name: string; opening: string; closing: string; }
export function bankTotals(rows: BankBalance[]) {
  let opening = 0, closing = 0;
  if (!rows.length) return null;
  for (const row of rows) {
    const a = parseAmount(row.opening), b = parseAmount(row.closing);
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    opening += Math.round(a * 100); closing += Math.round(b * 100);
  }
  return { opening, closing, variation: closing - opening };
}
@Component({
  selector: 'bpm-bank-reconciliation',
  imports: [BpmAmount, FormsModule, BpmRouterLink, CentsPipe, SignedCentsPipe, ShortDatePipe],
  styleUrl: './vision-workspace.scss',
  template: `
    <section class="vision-panel" aria-labelledby="bank-title">
      <div class="vision-heading"><div><span class="vision-eyebrow">01 · Même périmètre, mêmes dates</span><h2 id="bank-title">Du cycle budgétaire à vos applications bancaires</h2></div><span class="vision-badge">Comparaison manuelle · sans connexion bancaire</span></div>
      <div class="bank-timeline"><div><small>Solde d’ouverture</small><strong>Avant les mouvements du {{from() | shortDate}}</strong></div><span aria-hidden="true">→</span><div><small>Solde de contrôle</small><strong>Après les mouvements du {{to() | shortDate}}</strong></div></div>
      <p>Dans chaque application bancaire, relevez le <strong>solde comptabilisé</strong> à ces deux bornes. Le solde disponible peut inclure un découvert autorisé ou des paiements en attente : ne l’utilisez pas ici.</p>
      <p>Incluez uniquement les comptes qui portent les entrées et sorties de votre budget. Un virement entre deux comptes inclus s’annule dans leur total ; un virement vers un compte exclu doit être expliqué. Les enveloppes de projets ne sont pas des mouvements bancaires.</p>
      <div class="bank-accounts">
        @for (row of accounts(); track row.id; let i = $index) {
          <fieldset><legend>Compte {{i + 1}}</legend>
            <label>Banque / compte<input [ngModel]="row.name" (ngModelChange)="update(row.id, 'name', $event)" placeholder="Ex. compte courant" /></label>
            <label>Ouverture (€)<input inputmode="decimal" [ngModel]="row.opening" (ngModelChange)="update(row.id, 'opening', $event)" placeholder="0,00" /></label>
            <label>Contrôle (€)<input inputmode="decimal" [ngModel]="row.closing" (ngModelChange)="update(row.id, 'closing', $event)" placeholder="0,00" /></label>
            <button class="btn btn-secondary" [disabled]="accounts().length === 1" (click)="remove(row.id)" [attr.aria-label]="'Retirer le compte ' + (i + 1)">Retirer</button>
          </fieldset>
        }
      </div>
      <div class="vision-actions"><button class="btn btn-secondary" (click)="add()">＋ Ajouter un compte</button><button class="btn btn-secondary" (click)="reset()">Effacer les soldes</button></div>
      @if (!totals()) {<p role="status">Renseignez les deux soldes de chaque compte, en euros avec au plus deux décimales. Un solde négatif est accepté.</p>}
      <label class="bank-confirm"><input type="checkbox" [ngModel]="confirmed()" (ngModelChange)="confirmed.set($event)" />J’ai vérifié les dates et inclus tous les comptes correspondant aux flux du budget.</label>
      <small>Les soldes restent dans cette page pendant la comparaison. Ils ne sont ni enregistrés ni transmis à une banque.</small>
    </section>
    <section class="vision-panel" aria-labelledby="bank-result" aria-live="polite">
      <span class="vision-eyebrow">02 · Comparer les variations</span><h2 id="bank-result">Votre compte et votre budget racontent-ils la même chose ?</h2>
      <div class="vision-metrics">
        <article><span>Variation bancaire</span><strong [bpmAmount]="totals()?.variation">{{totals() ? (totals()!.variation | signedCents) : 'À renseigner'}}</strong><small>Total contrôle − total ouverture</small></article>
        <article><span>Variation budgétaire</span><strong [bpmAmount]="net()">{{net() === null ? 'Inconnue' : (net() | signedCents)}}</strong><small>Entrées reçues − sorties payées</small></article>
        <article class="vision-net" [class.bank-warning]="gap() !== null && gap() !== 0"><span>Écart à expliquer</span><strong [bpmAmount]="gap()" [bpmTone]="gap() === null ? 'info' : gap() === 0 && confirmed() ? 'success' : 'warning'">{{gap() === null ? 'À vérifier' : (gap() | signedCents)}}</strong><small>Variation bancaire − variation budgétaire</small></article>
      </div>
      @if (totals(); as t) {<div class="bank-equation"><span>Ouverture <b [bpmAmount]="t.opening">{{t.opening | cents}}</b></span><span>+ net budgétaire <b [bpmAmount]="net()">{{net() | signedCents}}</b></span><span>= solde théorique <b [bpmAmount]="net() === null ? null : t.opening + net()!">{{net() === null ? 'Inconnu' : (t.opening + net()! | cents)}}</b></span><span>Face au relevé <b [bpmAmount]="t.closing">{{t.closing | cents}}</b></span></div>}
      <p class="bank-verdict" [attr.data-tone]="!confirmed() || gap() === null ? 'info' : gap() === 0 ? 'success' : 'warning'">{{!confirmed() ? 'Vérifiez le périmètre et les dates avant de conclure.' : gap() === null ? 'La comparaison attend des soldes valides et un net budgétaire connu.' : gap() === 0 ? 'Les variations concordent. Cela ne remplace pas le contrôle des opérations : deux erreurs peuvent se compenser.' : gap()! < 0 ? 'La banque présente moins d’argent que le budget : recherchez un débit absent, une entrée non reçue ou un décalage de date.' : 'La banque présente plus d’argent que le budget : recherchez un crédit absent, une dépense non débitée ou un décalage de date.'}}</p>
    </section>
    <section class="vision-panel"><span class="vision-eyebrow">03 · Expliquer, puis corriger</span><h2 id="bank-checks">Contrôlez les mouvements, pas seulement le total</h2>
      <div class="bank-checks">
        <article><b>1. Pointer les règlements</b><p>Comparez date, libellé et montant de chaque ligne comptabilisée du relevé avec le registre. Une opération prévue n’est pas encore un règlement.</p><a routerLink="/tableau-de-bord/entrees" [queryParams]="{period:period(),from:from(),to:to(),dateBasis:'realized',direction:'all',status:'settled'}">Ouvrir les flux réglés →</a></article>
        <article><b>2. Repérer les décalages</b><p>Vérifiez les cartes à débit différé, chèques, frais, remboursements et virements. Un paiement passé au cycle suivant doit porter sa date réelle.</p><a routerLink="/tableau-de-bord/entrees" [queryParams]="{period:period(),dateBasis:'planned',direction:'all'}">Ouvrir les échéances du cycle →</a></article>
        <article><b>3. Corriger la ligne identifiée</b><p>Modifiez le montant ou la date, pointez le règlement, ou ajoutez le mouvement réellement manquant. Ne créez pas une opération du montant de l’écart sans justificatif.</p><a routerLink="/tableau-de-bord/entrees" [queryParams]="{period:period(),direction:'all'}">Ouvrir le registre de flux →</a></article>
      </div>
    </section>
  `,
})
export class BankReconciliationComponent {
  readonly net = input<number | null>(null);
  readonly from = input('');
  readonly to = input('');
  readonly period = input<string | undefined>();
  protected accounts = signal<BankBalance[]>([{id:1,name:'',opening:'',closing:''}]);
  protected confirmed = signal(false);
  protected totals = computed(() => bankTotals(this.accounts()));
  protected gap = computed(() => this.totals() && this.net() !== null ? this.totals()!.variation - this.net()! : null);
  private nextId = 2;
  protected update(id:number,key:'name'|'opening'|'closing',value:string) {this.accounts.update(rows=>rows.map(row=>row.id===id?{...row,[key]:value}:row));this.confirmed.set(false);}
  protected add() {this.accounts.update(rows=>[...rows,{id:this.nextId++,name:'',opening:'',closing:''}]);this.confirmed.set(false);}
  protected remove(id:number) {this.accounts.update(rows=>rows.filter(row=>row.id!==id));this.confirmed.set(false);}
  protected reset() {this.accounts.set([{id:this.nextId++,name:'',opening:'',closing:''}]);this.confirmed.set(false);}
}
