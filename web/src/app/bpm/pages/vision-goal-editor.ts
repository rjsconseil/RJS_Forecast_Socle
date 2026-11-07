import { BpmDrafts, DraftHandle } from '../ui/drafts';
import { BpmFormActions } from '../ui/form-actions';
import { Component, computed, DestroyRef, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiError, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { GoalType, LifeGoal } from '../../core/bpm-models';
import { parseAmount } from '../../core/format';
import { BpmModal } from '../ui/modal';
import { BpmRefresh, newRequestKey } from '../ui';
import { GOAL_SYMBOL } from './vision-charts';

export interface GoalTypeOption {
  key: GoalType;
  label: string;
  consumes: boolean;
}

/**
 * Éditeur d'objectif de projection (fenêtre `rjs-modal` d'Objectifs et avenir, formulaire source `.bv-form`) : création rejouable (clé de
 * commande unique par brouillon) ou modification avec révision attendue. Un objectif ne crée ni
 * Budget, ni tâche, ni paiement. En cas d'erreur, la saisie est conservée.
 */
@Component({
  selector: 'bpm-goal-editor',
  imports: [BpmFormActions, FormsModule, BpmModal],
  styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-vision.page.scss'],
  template: `
    <bpm-modal [headed]="true" [open]="true" [title]="heading()" [busy]="busy()" (closed)="closed.emit()">
      <form class="bv-form" (ngSubmit)="save()" (input)="draft?.save()" (change)="draft?.save()" novalidate>
        @if (draft?.restored) { <p class="bpm-help" role="status">Votre brouillon a été repris.</p> }
        <div class="bv-kinds" role="radiogroup" aria-label="Type d’objectif">
          @for (t of types(); track t.key) {
            <label class="bv-kind" [class.is-selected]="type() === t.key">
              <input type="radio" name="type" [value]="t.key" [(ngModel)]="type" [attr.aria-invalid]="err('type') ? 'true' : null" />
              <span aria-hidden="true">{{ symbol(t.key) }}</span>{{ t.label }}
            </label>
          }
        </div>
        @if (err('type')) { <p class="bpm-error" role="alert">{{ err('type') }}</p> }
        <p class="bpm-help">{{ typeHelp() }}</p>
        <p class="bpm-help">Un objectif de projection ne crée ni Budget, ni tâche, ni paiement : il sert uniquement à la simulation.</p>
        <div class="bv-fields">
          <label>
            Libellé
            <input autofocus name="label" [(ngModel)]="label" maxlength="200" [attr.aria-invalid]="err('label') ? 'true' : null" />
            @if (err('label')) { <span class="bpm-error">{{ err('label') }}</span> }
          </label>
          <label>
            Cible en euros d'aujourd'hui
            <input name="target" inputmode="decimal" [(ngModel)]="target" [attr.aria-invalid]="err('targetToday') ? 'true' : null" />
            @if (err('targetToday')) { <span class="bpm-error">{{ err('targetToday') }}</span> }
          </label>
          <label>
            Date
            <input name="date" type="date" [(ngModel)]="date" [attr.aria-invalid]="err('date') ? 'true' : null" />
            @if (err('date')) { <span class="bpm-error">{{ err('date') }}</span> }
          </label>
        </div>
        <p class="bpm-help">Montant positif ; la cible nominale à l'échéance est calculée avec l'inflation des hypothèses.</p>
        @if (error(); as e) {
          <div class="bpm-error" role="alert">
            {{ e.message }}
            @if (e.isConflict) {
              <p>L'objectif a été modifié ailleurs. Votre saisie est conservée : fermez puis rouvrez l'éditeur pour repartir de la version enregistrée.</p>
            } @else {
              <p>Rien n'a été enregistré ; votre saisie est conservée.</p>
            }
          </div>
        }
        <bpm-form-actions [busy]="busy()" [label]="goal() ? 'Enregistrer les modifications' : 'Ajouter l’objectif'" (cancel)="cancel()" />
      </form>
    </bpm-modal>
  `,
})
export class BpmGoalEditor implements OnInit {
  private drafts = inject(BpmDrafts);
  private destroy = inject(DestroyRef);
  protected draft?: DraftHandle;
  protected cancel() { this.draft?.clear(); this.closed.emit(); }
  private bpm = inject(BpmApi);
  private refresh = inject(BpmRefresh);
  /** Objectif à modifier ; absent = création. */
  readonly goal = input<LifeGoal | null>(null);
  readonly types = input.required<GoalTypeOption[]>();
  readonly closed = output<void>();
  readonly saved = output<string>();

  protected label = signal('');
  protected type = signal<GoalType>('achat');
  protected date = signal('');
  protected target = signal('');
  protected busy = signal(false);
  protected error = signal<ApiError | null>(null);
  private localErr = signal<{ field: string; message: string } | null>(null);
  private requestKey = newRequestKey('goal');

  protected symbol = (t: GoalType) => GOAL_SYMBOL[t] ?? '✦';
  protected heading = computed(() => (this.goal() ? 'Modifier l’objectif' : 'Ajouter un objectif'));
  protected typeHelp = computed(() => {
    const t = this.types().find((x) => x.key === this.type());
    return !t ? '' : t.consumes ? 'Consomme le capital dans la projection.' : 'Réserve une part du capital sans la soustraire du stock nominal.';
  });

  ngOnInit() {
    const g = this.goal();
    if (g) {
      this.label.set(g.label);
      this.type.set(g.type);
      this.date.set(g.date);
      this.target.set(String(g.targetTodayCents / 100).replace('.', ','));
    }
    this.draft = this.drafts.fields(`goal:${g?.id ?? 'new'}:${g?.revision ?? 0}`, this, ['label', 'type', 'date', 'target', 'requestKey'], this.destroy);
  }

  protected err(field: string) {
    const l = this.localErr();
    if (l && l.field === field) return l.message;
    const e = this.error();
    return e && e.body.details?.['field'] === field ? e.message : null;
  }

  async save() {
    this.localErr.set(null);
    const amount = parseAmount(this.target());
    if (!this.label().trim()) return this.localErr.set({ field: 'label', message: 'Libellé obligatoire.' });
    if (!this.date()) return this.localErr.set({ field: 'date', message: 'Date obligatoire.' });
    if (typeof amount !== 'number' || amount <= 0) return this.localErr.set({ field: 'targetToday', message: 'Montant positif attendu (en euros).' });
    this.busy.set(true);
    this.error.set(null);
    const body = { label: this.label().trim(), type: this.type(), date: this.date(), targetToday: amount };
    try {
      const g = this.goal();
      if (g) {
        await this.bpm.updateGoal(g.id, { ...body, expectedRevision: g.revision });
        this.refresh.bump();
        this.draft?.clear();
        this.saved.emit(`Objectif « ${body.label} » modifié.`);
      } else {
        const r = await this.bpm.createGoal({ ...body, requestKey: this.requestKey });
        this.refresh.bump();
        this.draft?.clear();
        this.saved.emit(r.replayed ? `Objectif « ${r.goal.label} » déjà enregistré (demande rejouée).` : `Objectif « ${r.goal.label} » ajouté.`);
      }
    } catch (e) {
      this.error.set(toApiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
