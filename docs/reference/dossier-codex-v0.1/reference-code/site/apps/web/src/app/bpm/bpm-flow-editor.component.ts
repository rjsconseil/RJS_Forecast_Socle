import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { FlowPilot } from './bpm-flow-pilot.model';
import { FormsModule } from '@angular/forms';
import { BpmProject, BpmFlow } from './bpm.model';
import { BpmStore } from './bpm.store';
import { FlowDefinition } from './bpm-flow-pilot.model';
import { ParameterChoiceComponent } from '../shared/parameter-choice.component';
import { formatMoney, parseAmount } from '../shared/amount';
import { pageText, registerPageTexts } from '../shared/page-text';
const P = 'content.pages.bpm.bpm-flow-editor.component.';
export const BPM_FLOW_EDITOR_TEXTS = {
  title: 'Saisir une entrée ou une charge',
  intro: 'Une date, un montant, un poste. Voyez l’effet avant d’enregistrer.',
  scopeLife: 'Mon projet de vie',
  scopeProjects: 'Mes autres projets',
  scopeLifeHelp: 'Revenus et charges du quotidien.',
  scopeProjectsHelp: 'Entrées et charges liées à un projet.',
  define: 'Renseigner l’opération',
  impact: 'Vérifier l’impact',
  preview: 'Voir l’impact avant d’enregistrer',
  previewing: 'Calcul en cours…',
  projectionDate: 'Patrimoine estimé après les clôtures jusqu’au',
  previewHelp: 'Comparez le solde et le patrimoine avant / après cette opération.',
  before: 'Avant',
  after: 'Après la saisie',
  net: 'Solde prévu de la période en cours',
  stock: 'Patrimoine estimé',
  delta: 'Effet sur le patrimoine',
  target: 'Objectif de patrimoine',
  noStock: 'Valeur à renseigner',
  noLink:
    'Ce projet n’est pas relié à ce patrimoine. Son solde compte dans le budget, mais ne modifie pas le patrimoine estimé.',
  outside:
    'Si le montant reste inchangé, vérifiez la date, la clôture concernée et l’approbation de l’opération.',
  review: 'Ouvrir les graphiques',
  stepScope: 'Choisir le projet',
  stepDefine: 'Renseigner l’opération',
  stepImpact: 'Vérifier & enregistrer',
  unchanged: 'Une modification demande un nouvel aperçu.',
  project: 'Projet concerné',
  life: 'Projet de vie · quotidien',
  operation: 'Ajouter ou modifier',
  add: 'Nouvelle opération',
  income: 'Entrée',
  expense: 'Charge',
  once: 'Ponctuel',
  recurring: 'Récurrent',
  switch: 'Répéter cette opération automatiquement',
  titleField: 'Libellé',
  incomeExample: 'Ex. salaire, remboursement, prime',
  expenseExample: 'Ex. loyer, courses, assurance',
  optional: 'Ajouter une note (facultatif)',
  amount: 'Montant (€)',
  recurringAmount: 'Montant par échéance (€)',
  date: 'Date prévue',
  firstDate: 'Première échéance',
  cadence: 'Répétition',
  weekly: 'Chaque semaine',
  monthly: 'Chaque mois',
  yearly: 'Chaque année',
  end: 'Dernière échéance (facultatif)',
  post: 'Poste (obligatoire)',
  type: 'Type d’entrée',
  task: 'Tâche du projet',
  withoutTask: 'Sans tâche',
  note: 'Note (facultatif)',
  save: 'Enregistrer',
  update: 'Enregistrer les modifications',
  saving: 'Enregistrement…',
  saved: 'Opération enregistrée. Échéances et pilotage mis à jour.',
  invalid:
    'Renseignez le libellé, un montant positif, la date et le poste. Pour une entrée ponctuelle, choisissez aussi son type.',
  locked:
    'Les montants déjà enregistrés et le calendrier sont conservés. Un nouveau montant récurrent concerne seulement les échéances non réalisées.',
  previewOnce: 'Une seule opération à la date choisie.',
  previewRecurring: 'Le montant se répète à chaque échéance, à partir de la première date.',
  previewImpact: 'À la clôture, le solde du budget lié augmente ou réduit le patrimoine.',
  current: 'La date saisie s’applique, même si vous consultez une autre période.',
  clear: 'Nouvelle saisie',
  retained: 'Cette opération reste une hypothèse tant qu’elle n’est pas approuvée.',
};
registerPageTexts(
  Object.fromEntries(Object.entries(BPM_FLOW_EDITOR_TEXTS).map(([k, v]) => [P + k, v])),
);
const draft = (date: string) => ({
  kind: 'expense' as BpmFlow['kind'],
  title: '',
  amount: '',
  date,
  cadence: 'once' as BpmFlow['cadence'],
  endDate: '',
  centerName: '',
  incomeType: '',
  coreTaskId: '',
  note: '',
});
@Component({
  selector: 'rjs-bpm-flow-editor',
  imports: [FormsModule, ParameterChoiceComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./bpm-pages.scss', './bpm-vision.page.scss', './bpm-flow-editor.component.scss'],
  template: ` <section
    id="saisie-des-flux"
    class="fe-panel"
    data-bpm-frame="form"
    data-tour="flow"
    aria-labelledby="fe-title"
  >
    <header class="fe-heading">
      <span class="fe-eyebrow">{{ project().ownerLabel }}</span>
      <h2 id="fe-title">{{ t('title') }}</h2>
      <p>{{ t('intro') }}</p>
    </header>
    <div class="fe-workspace">
      <aside class="fe-context">
        <h3 class="fe-section-title"><span>01</span>{{ t('stepScope') }}</h3>
        <div class="fe-scopes" role="group" aria-label="Cadre de la saisie">
          <button
            type="button"
            [class.is-selected]="selected()?.standard"
            [attr.aria-pressed]="selected()?.standard"
            (click)="chooseScope(true)"
          >
            <strong>{{ t('scopeLife') }}</strong
            ><span>{{ t('scopeLifeHelp') }}</span>
          </button>
          <button
            type="button"
            [class.is-selected]="selected() && !selected()?.standard"
            [attr.aria-pressed]="selected() && !selected()?.standard"
            [disabled]="!hasProjects()"
            (click)="chooseScope(false)"
          >
            <strong>{{ t('scopeProjects') }}</strong
            ><span>{{ t('scopeProjectsHelp') }}</span>
          </button>
        </div>
        <div class="fe-selectors">
          <label
            >{{ t('project')
            }}<select [ngModel]="budgetId()" (ngModelChange)="chooseBudget($event)">
              @for (p of scopedOptions(); track p.id) {
                <option [value]="p.id">{{ p.standard ? t('life') : p.title }}</option>
              }
            </select></label
          ><label
            >{{ t('operation')
            }}<select [ngModel]="operationId()" (ngModelChange)="chooseOperation($event)">
              <option value="">＋ {{ t('add') }}</option>
              @for (o of selected()?.operations ?? []; track o.id) {
                <option [value]="o.id">
                  {{ o.kind === 'income' ? '↑' : '↓' }} {{ o.title }} · {{ money(o.amountCents) }}
                </option>
              }
            </select></label
          >
        </div>
      </aside>
      <form (ngSubmit)="save()" class="fe-form" (input)="invalidate()" (change)="invalidate()">
        <h3 class="fe-section-title"><span>02</span>{{ t('define') }}</h3>
        <div class="fe-controls">
          <div class="bp-toggle">
            <label [class.is-selected]="form.kind === 'income'"
              ><input
                type="radio"
                name="kind"
                value="income"
                [(ngModel)]="form.kind"
                [disabled]="locked()"
              />↑ {{ t('income') }}</label
            ><label [class.is-selected]="form.kind === 'expense'"
              ><input
                type="radio"
                name="kind"
                value="expense"
                [(ngModel)]="form.kind"
                [disabled]="locked()"
              />↓ {{ t('expense') }}</label
            >
          </div>
          <div class="bp-flow-mode">
            <span>{{ t('once') }}</span
            ><button
              type="button"
              role="switch"
              class="bp-recurrence-switch"
              [attr.aria-label]="t('switch')"
              [attr.aria-checked]="form.cadence !== 'once'"
              [disabled]="locked()"
              (click)="toggle()"
            ></button
            ><span>{{ t('recurring') }}</span>
          </div>
        </div>
        @if (locked()) {
          <p class="fe-explanation">{{ t('locked') }}</p>
        }
        @if (editing()?.decision !== 'approved' && editing()) {
          <p class="fe-explanation">{{ t('retained') }}</p>
        }
        <div class="fe-fields">
          <label
            >{{ t('titleField')
            }}<input
              name="title"
              [(ngModel)]="form.title"
              [placeholder]="t(form.kind === 'income' ? 'incomeExample' : 'expenseExample')"
              maxlength="120"
              required
          /></label>
          <label
            >{{ t(form.cadence === 'once' ? 'date' : 'firstDate')
            }}<input type="date" name="date" [(ngModel)]="form.date" [disabled]="locked()" required
          /></label>
          <label
            >{{ t(form.cadence === 'once' ? 'amount' : 'recurringAmount')
            }}<input
              name="amount"
              inputmode="decimal"
              [(ngModel)]="form.amount"
              [disabled]="locked() && form.cadence === 'once'"
              required
          /></label>
          @if (form.cadence !== 'once') {
            <label
              >{{ t('cadence')
              }}<select name="cadence" [(ngModel)]="form.cadence" [disabled]="locked()">
                @for (c of cadences; track c) {
                  <option [value]="c">{{ t(c) }}</option>
                }
              </select></label
            >
            <label
              >{{ t('end')
              }}<input name="end" type="date" [(ngModel)]="form.endDate" [min]="form.date"
            /></label>
          }
          <div class="fe-choice">
            <span>{{ t('post') }}</span
            ><rjs-parameter-choice
              [label]="t('post')"
              [value]="form.centerName"
              (valueChange)="form.centerName = $event"
              [catalog]="store.workspace()?.proposals?.[form.kind] ?? emptyChoices"
            />
          </div>
          @if (form.kind === 'income' && form.cadence === 'once') {
            <div class="fe-choice">
              <span>{{ t('type') }}</span
              ><rjs-parameter-choice
                [label]="t('type')"
                [value]="form.incomeType"
                (valueChange)="form.incomeType = $event"
                [catalog]="store.workspace()?.proposals?.income ?? emptyChoices"
              />
            </div>
          }
          @if (selected()?.tasks?.length) {
            <label
              >{{ t('task')
              }}<select name="task" [(ngModel)]="form.coreTaskId">
                <option value="">{{ t('withoutTask') }}</option>
                @for (task of selected()?.tasks ?? []; track task.id) {
                  <option [value]="task.id">{{ task.title }}</option>
                }
              </select></label
            >
          }
          <label
            >{{ t('note') }}<input name="note" [(ngModel)]="form.note" maxlength="300"
          /></label>
        </div>
        <p class="fe-schedule-note">
          {{ t(form.cadence === 'once' ? 'previewOnce' : 'previewRecurring') }}
          <span>{{ t('current') }}</span>
        </p>
        <section class="fe-impact" aria-labelledby="fe-impact-title">
          <h3 id="fe-impact-title" class="fe-section-title"><span>03</span>{{ t('impact') }}</h3>
          <p>{{ t('previewHelp') }}</p>
          <p class="fe-impact-rule">{{ t('previewImpact') }}</p>
          <button
            type="button"
            class="btn"
            [disabled]="previewing() || store.saving()"
            (click)="calculate()"
          >
            {{ t(previewing() ? 'previewing' : 'preview') }}
          </button>
          @if (preview(); as result) {
            <strong
              >{{ t('projectionDate') }}
              {{ displayDate(result.after.projectionDate ?? result.after.end) }}</strong
            >
            <div class="fe-impact-grid">
              <article>
                <h4>{{ t('net') }}</h4>
                <span>{{ t('before') }} · {{ money(result.before.expectedNetCents) }}</span
                ><strong>{{ money(result.after.expectedNetCents) }}</strong
                ><small>{{ t('after') }}</small>
              </article>
              <article>
                <h4>{{ t('stock') }}</h4>
                <span>{{ t('before') }} · {{ amount(result.before.projectedStockCents) }}</span
                ><strong>{{ amount(result.after.projectedStockCents) }}</strong
                ><small>{{ t('after') }}</small>
              </article>
              <article [class.fe-loss]="impactDelta(result) < 0">
                <h4>{{ t('delta') }}</h4>
                <strong>{{ signedDelta(result) }}</strong
                ><span>{{ t('target') }} · {{ amount(result.after.targetCents) }}</span>
              </article>
            </div>
            @if (!linked(result.after)) {
              <p class="bpm-error">{{ t('noLink') }}</p>
            }
            @if (impactDelta(result) === 0) {
              <p>{{ t('outside') }}</p>
            }
          }
          <a
            routerLink="/budget-patrimoine-management/piloter"
            [queryParams]="{ projet: project().id }"
            >{{ t('review') }} →</a
          >
        </section>
        @if (error()) {
          <p class="bpm-error" role="alert">{{ error() }}</p>
        }
        @if (message()) {
          <p role="status">{{ message() }}</p>
        }
        <div class="fe-save">
          <button type="submit" class="btn btn-primary" [disabled]="store.saving() || !selected()">
            {{ t(store.saving() ? 'saving' : operationId() ? 'update' : 'save') }}
          </button>
          @if (operationId()) {
            <button type="button" class="btn" (click)="chooseOperation('')">
              {{ t('clear') }}
            </button>
          }
        </div>
      </form>
    </div>
  </section>`,
})
export class BpmFlowEditorComponent {
  readonly project = input.required<BpmProject>();
  protected readonly store = inject(BpmStore);
  protected readonly options = computed(
    () =>
      this.store.workspace()?.projects.find((p) => p.id === this.project().id)?.flowEditor ?? [],
  );
  protected readonly hasProjects = computed(() => this.options().some((p) => !p.standard));
  protected readonly scopedOptions = computed(() =>
    this.options().filter((p) => !!p.standard === !!this.selected()?.standard),
  );
  protected readonly preview = signal<{ before: FlowPilot; after: FlowPilot } | null>(null);
  protected readonly previewing = signal(false);
  private previewTicket = 0;
  protected readonly budgetId = signal('');
  protected readonly operationId = signal('');
  protected readonly selected = computed(
    () => this.options().find((p) => p.id === this.budgetId()) ?? this.options()[0],
  );
  protected readonly editing = signal<FlowDefinition | null>(null);
  protected readonly locked = computed(() => !!this.editing()?.settledCount);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly money = formatMoney;
  protected readonly cadences = ['weekly', 'monthly', 'yearly'];
  protected readonly emptyChoices = { standard: [], custom: [] };
  protected form = draft('');
  private recurring: BpmFlow['cadence'] = 'monthly';
  private ownerProject = '';
  constructor() {
    effect(() => {
      const id = this.project().id;
      if (id === this.ownerProject) return;
      this.ownerProject = id;
      untracked(() => {
        this.budgetId.set(this.project().budgetProjectId);
        this.chooseOperation('');
      });
    });
  }
  protected t(k: string) {
    return pageText(P + k);
  }
  protected chooseScope(standard: boolean) {
    const p = this.options().find((p) => p.standard === standard);
    if (p && p.id !== this.budgetId()) this.chooseBudget(p.id);
  }
  protected invalidate() {
    this.previewTicket++;
    this.preview.set(null);
    this.previewing.set(false);
  }
  protected displayDate(s: string) {
    return new Date(s + 'T12:00:00Z').toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }
  protected amount(n: number | null) {
    return n === null ? this.t('noStock') : this.money(n);
  }
  protected impactDelta(r: { before: FlowPilot; after: FlowPilot }) {
    return r.before.projectedStockCents === null || r.after.projectedStockCents === null
      ? 0
      : r.after.projectedStockCents - r.before.projectedStockCents;
  }
  protected signedDelta(r: { before: FlowPilot; after: FlowPilot }) {
    if (r.before.projectedStockCents === null || r.after.projectedStockCents === null)
      return this.t('noStock');
    const n = this.impactDelta(r);
    return (n > 0 ? '+' : '') + this.money(n);
  }
  protected linked(p: FlowPilot) {
    return p.projects.find((p) => p.id === this.selected()?.id)?.linked;
  }
  protected async calculate() {
    this.error.set('');
    const flow = this.payload();
    if (!flow) return;
    const ticket = ++this.previewTicket;
    this.previewing.set(true);
    this.preview.set(null);
    const result = await this.store.previewFlow(
      this.project().id,
      flow,
      this.editing() ?? undefined,
    );
    if (ticket !== this.previewTicket) return;
    this.previewing.set(false);
    if (result) this.preview.set(result);
    else this.error.set(this.store.error());
  }
  private payload() {
    const cents = parseAmount(this.form.amount);
    if (
      !cents ||
      cents < 0 ||
      !this.form.title.trim() ||
      !this.form.date ||
      !this.form.centerName.trim() ||
      (this.form.kind === 'income' && this.form.cadence === 'once' && !this.form.incomeType.trim())
    ) {
      this.error.set(this.t('invalid'));
      return null;
    }
    return {
      ...this.form,
      budgetProjectId: this.selected()!.id,
      amountCents: cents,
      settled: false,
      endDate: this.form.cadence === 'once' ? '' : this.form.endDate,
    };
  }
  protected chooseBudget(id: string) {
    this.budgetId.set(id);
    this.chooseOperation('');
  }
  protected chooseOperation(id: string) {
    this.invalidate();
    this.operationId.set(id);
    const o = this.selected()?.operations.find((o) => o.id === id) ?? null;
    this.editing.set(o);
    this.form = o
      ? { ...o, amount: (o.amountCents / 100).toFixed(2) }
      : draft(this.store.workspace()?.today ?? '');
    this.error.set('');
    this.message.set('');
  }
  protected toggle() {
    this.invalidate();
    if (this.form.cadence === 'once') this.form.cadence = this.recurring;
    else {
      this.recurring = this.form.cadence;
      this.form.cadence = 'once';
    }
  }
  protected async save() {
    this.error.set('');
    this.message.set('');
    const flow = this.payload();
    if (!flow) return;
    const old = this.editing();
    const ok = old
      ? await this.store.updateFlow(this.project().id, old.id, old.updatedAt, flow)
      : await this.store.addFlow(this.project().id, flow);
    if (ok) {
      this.chooseOperation('');
      this.message.set(this.t('saved'));
    } else this.error.set(this.store.error());
  }
}
