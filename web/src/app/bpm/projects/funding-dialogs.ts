import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { BpmApi } from '../data/bpm-api.service';
import { BpmTaskCard, FundingSource, ProjectBudget } from '../data/bpm-projects.models';
import { cents, CentsPipe, parseAmount } from '../../core/format';
import { toApiError } from '../../core/api.service';
import { BpmModal } from '../ui/modal';

// Fenêtres de financement ouvertes depuis le chiffre lui-même : le montant d'une enveloppe (ou « À attribuer »)
// et la part d'une tâche (ou « À demander »). Les règles restent dans le middleware Budget ; ces fenêtres
// annoncent seulement l'effet avant l'enregistrement (dépassement de l'enveloppe, source verrouillée).

const FORM_STYLES = `
  .fd-form { display: grid; gap: 14px; padding: 18px 24px 22px; }
  .fd-actions { padding-top: 4px; }
  .fd-figures { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 0; }
  .fd-figures div { padding: 10px 12px; border-radius: 8px; background: var(--bpm-soft, #f6f6f9); }
  .fd-figures dt { color: var(--bpm-muted, #66667a); font-size: 11px; }
  .fd-figures dd { margin: 3px 0 0; font-weight: 650; font-variant-numeric: tabular-nums; }
  .fd-field { display: grid; gap: 5px; font-size: 13px; font-weight: 600; }
  .fd-field :is(input, select) { width: 100%; min-height: 38px; }
  .fd-modes { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13px; }
  .fd-modes label { display: inline-flex; align-items: center; gap: 6px; }
  .fd-help { margin: 0; color: var(--bpm-muted, #66667a); font-size: 12.5px; line-height: 1.5; }
  .fd-warning { margin: 0; padding: 10px 12px; border-radius: 8px; font-size: 13px; line-height: 1.5;
    color: var(--status-warning, #8a5a00); background: var(--status-warning-surface, #fff5e0); border: 1px solid currentColor; }
  .fd-error { margin: 0; color: var(--status-danger, #b42318); font-size: 13px; font-weight: 600; }
  .fd-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
  @media (max-width: 520px) { .fd-figures { grid-template-columns: minmax(0, 1fr); } }
`;

/** Attribuer ou modifier l'enveloppe d'un projet de la vie : montant et source du financement. */
@Component({
  selector: 'bpm-envelope-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BpmModal, CentsPipe],
  styles: FORM_STYLES,
  template: `
    @let b = budget();
    <bpm-modal [open]="true" [headed]="true" [title]="b.regime ? 'Modifier l’enveloppe de « ' + b.name + ' »' : 'Attribuer une enveloppe à « ' + b.name + ' »'" [busy]="busy()" (closed)="closed.emit()">
      <form class="fd-form" (submit)="$event.preventDefault(); save()" novalidate>
        @if (b.regime) {
          <dl class="fd-figures">
            <div><dt>Enveloppe actuelle</dt><dd>{{ b.allocationCents | cents }}</dd></div>
            <div><dt>Accordé aux tâches</dt><dd>{{ b.sharesCents | cents }}</dd></div>
            <div><dt>Déjà réglé</dt><dd>{{ b.paidCents | cents }}</dd></div>
          </dl>
          <div class="fd-modes" role="radiogroup" aria-label="Façon de modifier l’enveloppe">
            <label><input type="radio" name="mode" value="total" [checked]="mode() === 'total'" (change)="mode.set('total')" /> Fixer le montant total</label>
            <label><input type="radio" name="mode" value="add" [checked]="mode() === 'add'" (change)="mode.set('add')" /> Ajouter des moyens</label>
          </div>
        }
        <label class="fd-field">{{ mode() === 'add' ? 'Montant à ajouter (€)' : 'Montant de l’enveloppe (€)' }}
          <input inputmode="decimal" autocomplete="off" [value]="amount()" (input)="amount.set($any($event.target).value)" autofocus />
        </label>
        @if (mode() === 'add' && total() !== null) { <p class="fd-help">Nouveau total : <strong>{{ total() | cents }}</strong></p> }
        <label class="fd-field">Enveloppe financée par
          <select [value]="source()" [disabled]="!!b.fundingSourceLocked" (change)="source.set($any($event.target).value)">
            <option value="cycle">Le budget du quotidien (cycle en cours)</option>
            <option value="patrimoine">Le patrimoine (hors cycle)</option>
          </select>
        </label>
        <p class="fd-help">
          L’enveloppe réserve des moyens ; les dépenses et gains des tâches sont imputés à cette source quand ils sont réglés.
          @if (b.fundingSourceLocked) { La source est fixée : des règlements y sont déjà imputés. }
        </p>
        @if (belowShares()) { <p class="fd-warning" role="status">Ce montant est inférieur aux parts déjà accordées aux tâches ({{ b.sharesCents | cents }}) : réduisez d’abord des parts.</p> }
        @if (error()) { <p class="fd-error" role="alert">{{ error() }}</p> }
        <div class="fd-actions">
          <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="closed.emit()">Annuler</button>
          <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ busy() ? 'Enregistrement…' : b.regime ? 'Enregistrer l’enveloppe' : 'Attribuer l’enveloppe' }}</button>
        </div>
      </form>
    </bpm-modal>
  `,
})
export class BpmEnvelopeDialog implements OnInit {
  private readonly bpm = inject(BpmApi);
  readonly budget = input.required<ProjectBudget>();
  readonly closed = output<void>();
  readonly saved = output<string>();

  protected readonly mode = signal<'total' | 'add'>('total');
  protected readonly amount = signal('');
  protected readonly source = signal<FundingSource>('cycle');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  ngOnInit() {
    const b = this.budget();
    this.source.set(b.fundingSource ?? 'cycle');
    this.amount.set(b.allocationCents === null ? '' : String(b.allocationCents / 100).replace('.', ','));
  }

  private readonly parsed = computed(() => parseAmount(this.amount()));
  protected readonly total = computed(() => {
    const v = this.parsed();
    if (typeof v !== 'number') return null;
    return Math.round(v * 100) + (this.mode() === 'add' ? this.budget().allocationCents ?? 0 : 0);
  });
  protected readonly belowShares = computed(() => {
    const t = this.total();
    return t !== null && this.budget().regime && t < this.budget().sharesCents;
  });

  protected async save() {
    const b = this.budget();
    const total = this.total();
    if (total === null || total < 0) { this.error.set('Indiquez un montant positif, en euros (deux décimales au plus).'); return; }
    this.busy.set(true);
    this.error.set('');
    try {
      const source = this.source();
      await this.bpm.allocate(b.budgetId, total / 100, b.revision, source !== (b.fundingSource ?? 'cycle') ? source : undefined);
      this.saved.emit(`Enveloppe de « ${b.name} » : ${cents(total)}, financée par ${source === 'patrimoine' ? 'le patrimoine' : 'le budget du quotidien'}.`);
    } catch (e) {
      const err = toApiError(e);
      this.error.set(err.isConflict ? 'Le projet a changé ailleurs : fermez puis rouvrez la fenêtre pour relire son enveloppe.' : err.message);
    } finally {
      this.busy.set(false);
    }
  }
}

/** Accorder ou modifier la part d'une tâche dans l'enveloppe du projet, avec l'avertissement de dépassement. */
@Component({
  selector: 'bpm-task-share-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BpmModal, CentsPipe],
  styles: FORM_STYLES,
  template: `
    @let b = budget();
    @let t = task();
    <bpm-modal [open]="true" [headed]="true" [title]="'Part de l’enveloppe pour « ' + t.task.title + ' »'" [busy]="busy()" (closed)="closed.emit()">
      <form class="fd-form" (submit)="$event.preventDefault(); save()" novalidate>
        <dl class="fd-figures">
          <div><dt>Enveloppe du projet</dt><dd>{{ b.ceilingCents | cents }}</dd></div>
          <div><dt>Déjà accordé aux tâches</dt><dd>{{ b.sharesCents | cents }}</dd></div>
          <div><dt>Disponible à répartir</dt><dd>{{ b.availableCents | cents }}</dd></div>
        </dl>
        @if (!b.regime) {
          <p class="fd-warning" role="status">Ce projet n’a pas encore d’enveloppe : toute part sera un dépassement à autoriser. Attribuez d’abord l’enveloppe du projet si possible.</p>
        }
        <label class="fd-field">Part accordée à la tâche (€)
          <input inputmode="decimal" autocomplete="off" [value]="amount()" (input)="amount.set($any($event.target).value)" autofocus />
        </label>
        @if (currentCents() !== null) { <p class="fd-help">Part actuelle : {{ currentCents() | cents }}. Laissez vide pour retirer la part.</p> }
        @if (overrunCents() > 0) {
          <p class="fd-warning" role="alert">
            Cette part dépasse l’enveloppe : il ne reste que {{ (b.availableCents ?? 0) | cents }} à répartir.
            En confirmant, vous autorisez <strong>{{ overrunCents() | cents }}</strong> de dépassement de l’enveloppe totale.
          </p>
        }
        @if (error()) { <p class="fd-error" role="alert">{{ error() }}</p> }
        <div class="fd-actions">
          <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="closed.emit()">Annuler</button>
          <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ busy() ? 'Enregistrement…' : overrunCents() > 0 ? 'Accorder et autoriser le dépassement' : 'Accorder la part' }}</button>
        </div>
      </form>
    </bpm-modal>
  `,
})
export class BpmTaskShareDialog implements OnInit {
  private readonly bpm = inject(BpmApi);
  readonly budget = input.required<ProjectBudget>();
  readonly task = input.required<BpmTaskCard>();
  readonly closed = output<void>();
  readonly saved = output<string>();

  protected readonly amount = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly currentCents = computed(() => this.task().budget?.shareCents ?? null);

  ngOnInit() {
    const c = this.currentCents();
    this.amount.set(c === null ? '' : String(c / 100).replace('.', ','));
  }

  private readonly parsed = computed(() => parseAmount(this.amount()));
  /** Ce que la nouvelle part prend en plus de ce qui reste à répartir dans l'enveloppe. */
  protected readonly overrunCents = computed(() => {
    const v = this.parsed();
    if (typeof v !== 'number') return 0;
    const extra = Math.round(v * 100) - (this.currentCents() ?? 0);
    return Math.max(0, extra - Math.max(0, this.budget().availableCents ?? 0));
  });

  protected async save() {
    const v = this.parsed();
    if (v === 'invalid' || (typeof v === 'number' && v < 0)) { this.error.set('Indiquez une part positive en euros, ou laissez vide pour la retirer.'); return; }
    const b = this.budget(), t = this.task();
    this.busy.set(true);
    this.error.set('');
    try {
      const overrun = this.overrunCents();
      await this.bpm.setTaskShare(b.budgetId, t.task.id, v, b.revision, overrun > 0 ? { authorizeOverrun: true } : {});
      this.saved.emit(v === null ? `Part de « ${t.task.title} » retirée.`
        : `Part de « ${t.task.title} » portée à ${cents(Math.round(v * 100))}${overrun ? `, dont ${cents(overrun)} autorisés en dépassement` : ''}.`);
    } catch (e) {
      const err = toApiError(e);
      this.error.set(err.isConflict ? 'Le projet a changé ailleurs : fermez puis rouvrez la fenêtre pour relire les parts.' : err.message);
    } finally {
      this.busy.set(false);
    }
  }
}
