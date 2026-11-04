import { ParameterChoiceComponent } from '../shared/parameter-choice.component';
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
import { FormsModule } from '@angular/forms';
import { formatMoney, parseAmount } from '../shared/amount';
import { pageText, registerPageTexts } from '../shared/page-text';
import { BpmFlow, BpmProject } from './bpm.model';
import { BpmStore } from './bpm.store';
import { BpmTermComponent } from './bpm-term.component';
import { profileOf } from './bpm-profile.model';

const P = 'content.pages.bpm.bpm-month-type.component.';
/** Textes livrés de l'assistant du mois type ; ils se personnalisent dans Configuration → Contenus. */
export const BPM_MONTH_TYPE_TEXTS: Record<string, string> = {
  title: 'Mon budget type',
  intro:
    'Renseignez plusieurs entrées et charges du quotidien. Le mode choisi à droite s’applique à toutes les lignes.',
  open: 'Ouvrir la saisie',
  close: 'Replier la saisie',
  incomes: 'Entrées d’argent',
  expenses: 'Charges',
  label: 'Libellé',
  amount: 'Montant (€)',
  cadence: 'Répétition',
  mode: 'Mode de saisie',
  recurring: 'Récurrent',
  once: 'Ponctuel',
  repeat: 'Mode ponctuel pour tout le formulaire',
  onceDate: 'Date unique des entrées et dépenses',
  defaultDate: 'Date par défaut',
  recurringHelp:
    'Chaque montant se répète au rythme choisi, à partir de sa première échéance. Ajustez les dates ligne par ligne si besoin.',
  onceHelp:
    'Chaque ligne est prise en compte une seule fois, à sa date. Ajustez les dates ligne par ligne si besoin.',
  knownHelp: 'Les lignes déjà présentes dans le budget ne sont pas ajoutées une seconde fois.',
  saveOnce: 'Enregistrer les opérations ponctuelles',
  date: 'Date prévue',
  firstDate: 'Première échéance',
  incomeType: 'Type de l’entrée ponctuelle',
  incomeTypeHint: 'Don, gain ponctuel, prime exceptionnelle…',
  oncePreview: 'Solde de cette saisie ponctuelle',
  invalid: 'Précisez la date et choisissez le poste de chaque entrée ou dépense.',
  center: 'Poste',
  start: 'À partir du',
  already: 'Déjà dans votre budget',
  weekly: 'Chaque semaine',
  monthly: 'Chaque mois',
  yearly: 'Chaque année',
  preview: 'Solde moyen après ajout :',
  previewHelp:
    'Moyenne du budget type selon les rythmes choisis. Les dates déterminent le résultat de chaque période réelle.',
  save: 'Enregistrer mon budget type',
  none: 'Indiquez au moins un montant.',
  saved: 'Saisie enregistrée. Les échéances sont planifiées à leurs dates.',
  addLine: '+ Ajouter une ligne',
  fromProfile: 'Modèle « {label} » : ajustez les montants et laissez vides les lignes inutiles.',
  lineIncome1: 'Salaire 1',
  lineIncome2: 'Salaire 2',
  lineIncome3: 'Allocations et aides',
  lineIncome4: 'Autre revenu régulier',
  lineRent: 'Loyer ou crédit immobilier',
  lineCharges: 'Charges (électricité, eau, internet)',
  lineInsurance: 'Assurances et mutuelle',
  linePhones: 'Téléphones et abonnements',
  lineTransport: 'Transports',
  lineGroceries: 'Courses',
  lineChildren: 'Cantine et activités des enfants',
  lineLeisure: 'Loisirs et sorties',
  lineClothes: 'Habillement',
  centerHousing: 'Logement',
  centerEveryday: 'Vie courante',
  centerGroceries: 'Courses',
  centerTransport: 'Transports',
  centerLeisure: 'Loisirs',
};
registerPageTexts(
  Object.fromEntries(Object.entries(BPM_MONTH_TYPE_TEXTS).map(([key, value]) => [P + key, value])),
);

type Cadence = 'weekly' | 'monthly' | 'yearly';
interface Line {
  kind: 'income' | 'expense';
  label: string;
  amount: string;
  date?: string;
  cadence: Cadence;
  incomeType?: string;
  center: string;
}
/** Un montant en centimes, écrit comme on le saisit (« 165 », « 2 650,50 » devient « 2650,5 »). */
const amountText = (cents: number) => String(cents / 100).replace('.', ',');
const PER_YEAR: Record<Cadence, number> = { weekly: 52, monthly: 12, yearly: 1 };

/**
 * L'assistant du mois type : les entrées et dépenses qui reviennent, saisies une
 * fois pour toutes. Les lignes déjà présentes dans le budget sont signalées.
 */
@Component({
  selector: 'rjs-bpm-month-type',
  imports: [FormsModule, BpmTermComponent, ParameterChoiceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './bpm-month-type.component.scss',
  template: `
    <section
      class="bm-month"
      data-bpm-frame="form"
      id="mois-type"
      aria-labelledby="bm-month-title"
      data-tour="month-type"
    >
      <header class="bm-head">
        <div>
          <h2 id="bm-month-title">{{ t('title') }} <rjs-bpm-term key="moisType" /></h2>
          <p>{{ t('intro') }}</p>
          @if (profile(); as current) {
            <p class="bpm-help">{{ t('fromProfile').replace('{label}', current.label) }}</p>
          }
        </div>
        @if (!expanded()) {
          <button
            type="button"
            class="btn"
            [class.btn-primary]="!open()"
            [class.btn-secondary]="open()"
            (click)="toggle()"
            [attr.aria-expanded]="open()"
          >
            {{ open() ? t('close') : t('open') }}
          </button>
        }
        <aside class="bm-format" [attr.aria-label]="t('mode')">
          <span [class.is-active]="!oneShot()">{{ t('recurring') }}</span>
          <button
            type="button"
            role="switch"
            class="bm-switch"
            [attr.aria-label]="t('repeat')"
            [attr.aria-checked]="oneShot()"
            [disabled]="store.saving()"
            (click)="toggleRecurrence()"
          ></button>
          <span [class.is-active]="oneShot()">{{ t('once') }}</span>
        </aside>
      </header>
      @if (open() || expanded()) {
        <form class="bm-form" (ngSubmit)="save()">
          <label class="bm-start"
            >{{ t('defaultDate') }}
            <input type="date" name="start" [(ngModel)]="start" (ngModelChange)="bump()" />
          </label>
          <p class="bpm-help">{{ t(oneShot() ? 'onceHelp' : 'recurringHelp') }}</p>
          @if (!oneShot()) {
            <p class="bpm-help">{{ t('knownHelp') }}</p>
          }
          @for (group of groups; track group.kind) {
            <fieldset>
              <legend>{{ t(group.kind === 'income' ? 'incomes' : 'expenses') }}</legend>
              <div class="bm-table" role="table">
                <div
                  class="bm-row bm-row-head"
                  role="row"
                  [class.bm-income]="group.kind === 'income'"
                  [class.bm-oneshot]="oneShot()"
                >
                  <span role="columnheader">{{ t('label') }}</span>
                  <span role="columnheader">{{ t(oneShot() ? 'date' : 'firstDate') }}</span>
                  <span role="columnheader">{{ t('amount') }}</span>
                  @if (!oneShot()) {
                    <span role="columnheader">{{ t('cadence') }}</span>
                  }
                  <span role="columnheader">{{ t('center') }}</span>
                </div>
                @for (line of linesOf(group.kind); track $index) {
                  <div
                    class="bm-row"
                    role="row"
                    [class.bm-income]="group.kind === 'income'"
                    [class.bm-oneshot]="oneShot()"
                    [class.is-known]="known(line)"
                  >
                    <input
                      role="cell"
                      [name]="group.kind + 'label' + $index"
                      [(ngModel)]="line.label"
                      (ngModelChange)="bump()"
                      [attr.aria-label]="t('label')"
                    />
                    <input
                      type="date"
                      role="cell"
                      [name]="group.kind + 'date' + $index"
                      [ngModel]="line.date ?? start"
                      (ngModelChange)="line.date = $event; bump()"
                      [attr.aria-label]="t(oneShot() ? 'date' : 'firstDate') + ' · ' + line.label"
                    />
                    <input
                      role="cell"
                      [name]="group.kind + 'amount' + $index"
                      inputmode="decimal"
                      [(ngModel)]="line.amount"
                      (ngModelChange)="bump()"
                      [attr.aria-label]="t('amount') + ' · ' + line.label"
                      [placeholder]="known(line) ? t('already') : '0'"
                    />
                    @if (!oneShot()) {
                      <select
                        role="cell"
                        [name]="group.kind + 'cadence' + $index"
                        [(ngModel)]="line.cadence"
                        (ngModelChange)="bump()"
                        [attr.aria-label]="t('cadence') + ' · ' + line.label"
                      >
                        <option value="weekly">{{ t('weekly') }}</option>
                        <option value="monthly">{{ t('monthly') }}</option>
                        <option value="yearly">{{ t('yearly') }}</option>
                      </select>
                    }
                    <div role="cell">
                      <rjs-parameter-choice
                        [value]="line.center"
                        (valueChange)="line.center = $event; bump()"
                        [label]="t('center') + ' · ' + line.label"
                        [catalog]="
                          store.workspace()?.proposals?.[group.kind] ?? { standard: [], custom: [] }
                        "
                        [extra]="line.kind === 'expense' ? centerNames() : []"
                      />
                    </div>
                  </div>
                }
              </div>
              <button type="button" class="bm-add" (click)="addLine(group.kind)">
                {{ t('addLine') }}
              </button>
            </fieldset>
          }
          @if (oneShot()) {
            <p class="bm-preview">
              {{ t('oncePreview') }} : <strong>{{ signed(oncePreview()) }}</strong
              >.
            </p>
          } @else {
            <p class="bm-preview" [attr.data-sign]="preview() < 0 ? 'negative' : 'positive'">
              {{ t('preview') }} <strong>{{ signed(preview()) }}</strong> {{ perPeriod() }}.
            </p>
            <p class="bpm-help">{{ t('previewHelp') }}</p>
          }
          @if (error()) {
            <p class="bpm-error" role="alert">{{ error() }}</p>
          }
          <button type="submit" class="btn btn-primary" [disabled]="store.saving()">
            {{ t(oneShot() ? 'saveOnce' : 'save') }}
          </button>
        </form>
      }
      @if (message()) {
        <p class="bm-saved" role="status">{{ message() }}</p>
      }
    </section>
  `,
})
export class BpmMonthTypeComponent {
  readonly project = input.required<BpmProject>();
  readonly expanded = input(false);
  private readonly projectIdentity = computed(() => this.project().id);
  constructor() {
    effect(() => {
      const id = this.projectIdentity();
      if (this.expanded() && id)
        untracked(() => {
          this.reset();
          this.open.set(true);
        });
    });
  }
  protected readonly store = inject(BpmStore);
  protected readonly open = signal(false);
  protected readonly oneShot = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');
  private readonly version = signal(0);
  protected readonly groups = [{ kind: 'income' as const }, { kind: 'expense' as const }];
  protected lines: Line[] = [];
  protected start = '';

  protected readonly centerNames = computed(() =>
    (this.project().snapshot?.centers ?? [])
      .filter((entry) => entry.name)
      .map((entry) => entry.name),
  );
  private readonly knownTitles = computed(() => {
    const profile = this.project().snapshot?.profile;
    return new Set([
      ...(profile?.incomes ?? []).map((entry) => entry.title.toLocaleLowerCase('fr')),
      ...(profile?.expenses ?? []).flatMap((group) =>
        group.items.map((item) => item.title.toLocaleLowerCase('fr')),
      ),
    ]);
  });
  /** L'épargne naturelle d'une période type : actuelle plus les lignes saisies. */
  protected readonly preview = computed(() => {
    this.version();
    const periods = PER_YEAR[this.cadenceOfProject()];
    const added = this.lines.reduce((sum, line) => {
      const cents = parseAmount(line.amount);
      if (!cents || cents <= 0 || this.known(line)) return sum;
      const perPeriod = Math.round((cents * PER_YEAR[line.cadence]) / periods);
      return sum + (line.kind === 'income' ? perPeriod : -perPeriod);
    }, 0);
    return (this.project().snapshot?.profile?.naturalSavingCents ?? 0) + added;
  });

  protected readonly oncePreview = computed(() => {
    this.version();
    return this.lines.reduce((sum, line) => {
      const cents = parseAmount(line.amount);
      return cents && cents > 0 && line.label.trim()
        ? sum + (line.kind === 'income' ? cents : -cents)
        : sum;
    }, 0);
  });
  protected toggleRecurrence(): void {
    this.oneShot.update((value) => !value);
    this.error.set('');
    this.bump();
  }

  protected t(key: string): string {
    return pageText(P + key);
  }
  protected bump(): void {
    this.version.update((value) => value + 1);
  }
  private cadenceOfProject(): Cadence {
    return this.project().link?.periodicity ?? 'monthly';
  }
  protected perPeriod(): string {
    return this.t(this.cadenceOfProject()).toLocaleLowerCase('fr').replace('chaque', 'par');
  }
  protected toggle(): void {
    if (!this.open()) this.reset();
    this.open.set(!this.open());
  }
  /** Le profil du projet (ou celui proposé par défaut) : ses lignes et montants types remplissent l'assistant. */
  protected readonly profile = computed(() => profileOf(this.store.workspace(), this.project()));
  private reset(): void {
    const profile = this.profile();
    if (profile) {
      this.lines = [
        ...profile.incomes.map((entry) => ({
          kind: 'income' as const,
          label: entry.title,
          amount: amountText(entry.amountCents),
          cadence: entry.cadence,
          center: entry.center ?? 'Autres entrées',
        })),
        ...profile.expenses.map((entry) => ({
          kind: 'expense' as const,
          label: entry.title,
          amount: amountText(entry.amountCents),
          cadence: entry.cadence,
          center: entry.center,
        })),
      ];
      this.start = this.project().snapshot?.period.start ?? this.store.workspace()?.today ?? '';
      this.error.set('');
      this.message.set('');
      this.bump();
      return;
    }
    const line = (kind: Line['kind'], key: string, cadence: Cadence, center = ''): Line => ({
      kind,
      label: this.t(key),
      amount: '',
      cadence,
      center: center ? this.t(center) : kind === 'income' ? 'Autres entrées' : '',
    });
    this.lines = [
      line('income', 'lineIncome1', 'monthly'),
      line('income', 'lineIncome2', 'monthly'),
      line('income', 'lineIncome3', 'monthly'),
      line('income', 'lineIncome4', 'monthly'),
      line('expense', 'lineRent', 'monthly', 'centerHousing'),
      line('expense', 'lineCharges', 'monthly', 'centerHousing'),
      line('expense', 'lineInsurance', 'monthly', 'centerEveryday'),
      line('expense', 'linePhones', 'monthly', 'centerEveryday'),
      line('expense', 'lineTransport', 'monthly', 'centerTransport'),
      line('expense', 'lineGroceries', 'weekly', 'centerGroceries'),
      line('expense', 'lineChildren', 'monthly', 'centerEveryday'),
      line('expense', 'lineLeisure', 'monthly', 'centerLeisure'),
      line('expense', 'lineClothes', 'monthly', 'centerEveryday'),
    ];
    this.start = this.project().snapshot?.period.start ?? this.store.workspace()?.today ?? '';
    this.error.set('');
    this.message.set('');
    this.bump();
  }
  private limitOf(center: string): { centerLimitCents?: number } {
    const limit = this.profile()?.centers.find((entry) => entry.name === center)?.limitCents;
    return limit ? { centerLimitCents: limit } : {};
  }
  protected linesOf(kind: Line['kind']): Line[] {
    return this.lines.filter((line) => line.kind === kind);
  }
  protected addLine(kind: Line['kind']): void {
    this.lines.push({
      kind,
      label: '',
      amount: '',
      cadence: 'monthly',
      center: kind === 'expense' ? this.t('centerEveryday') : 'Autres entrées',
    });
    this.bump();
  }
  protected known(line: Line): boolean {
    return !this.oneShot() && this.knownTitles().has(line.label.trim().toLocaleLowerCase('fr'));
  }
  protected signed(cents: number): string {
    return (cents > 0 ? '+' : cents < 0 ? '−' : '') + formatMoney(Math.abs(cents));
  }
  protected async save(): Promise<void> {
    this.error.set('');
    const candidates = this.lines.filter(
      (line) => line.label.trim() && !this.known(line) && (parseAmount(line.amount) ?? 0) > 0,
    );
    if (candidates.some((line) => !(line.date ?? this.start) || !line.center.trim())) {
      this.error.set(this.t('invalid'));
      return;
    }
    const flows: BpmFlow[] = candidates
      .filter((line) => line.label.trim() && !this.known(line))
      .map((line) => ({ line, cents: parseAmount(line.amount) }))
      .filter((entry): entry is { line: Line; cents: number } => !!entry.cents && entry.cents > 0)
      .map(({ line, cents }) => ({
        kind: line.kind,
        title: line.label.trim(),
        amountCents: cents,
        date: line.date ?? this.start,
        incomeType:
          line.kind === 'income' ? line.incomeType?.trim() || line.center.trim() : undefined,
        cadence: this.oneShot() ? 'once' : line.cadence,
        centerName: line.center.trim(),
        // Un poste créé par son nom reçoit le plafond que le profil lui propose.
        ...(line.kind === 'expense' ? this.limitOf(line.center.trim()) : {}),
        settled: false,
      }));
    if (!flows.length) {
      this.error.set(this.t('none'));
      return;
    }
    if (await this.store.addFlows(this.project().id, flows)) {
      // Le formulaire reste ouvert dans Piloter : ne pas resoumettre une saisie ponctuelle.
      if (this.oneShot()) for (const line of candidates) line.amount = '';
      this.bump();
      this.open.set(false);
      this.message.set(this.t('saved'));
    }
  }
}
