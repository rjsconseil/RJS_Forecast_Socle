import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BpmCreationDetails } from './bpm.model';
import { pageText, registerPageTexts } from '../shared/page-text';

const P = 'content.pages.bpm.bpm-start-details.component.';
export const BPM_START_DETAILS_TEXTS: Record<string, string> = {
  centers: 'Postes et plafonds',
  providers: 'Prestataires génériques à personnaliser',
  provider: 'Prestataire (facultatif)',
  type: 'Type de prestataire',
  flows: 'Entrées, dépenses et événements',
  incomeType: 'Type d’entrée financière',
  incomeForecastDate: 'Date prévisionnelle de réception',
  expenseForecastDate: 'Date de dépense prévisionnelle',
  allocations: 'Allocations du patrimoine',
  assets: 'Actifs et valeurs actuelles',
  goals: 'Objectifs datés',
  name: 'Nom',
  title: 'Libellé',
  label: 'Objectif',
  limitCents: 'Plafond (€)',
  amountCents: 'Montant (€)',
  targetCents: 'Cible (€)',
  valueCents: 'Valeur actuelle (€), vide si inconnue',
  liabilityCents: 'Dette restante (€)',
  date: 'Date',
  targetDate: 'Date visée',
  endDate: 'Fin de récurrence, facultative',
  note: 'Note',
  center: 'Poste',
  allocation: 'Allocation',
  cadence: 'Rythme',
  kind: 'Nature',
  settled: 'Déjà reçu ou payé à cette date',
  beneficiary: 'Bénéficiaire du budget',
  income: 'Entrée',
  expense: 'Dépense',
  once: 'Une fois',
  weekly: 'Chaque semaine',
  monthly: 'Chaque mois',
  yearly: 'Chaque année',
  securite: 'Réserve',
  etudes: 'Études',
  retraite: 'Retraite',
  achat: 'Achat',
  transmission: 'Transmission',
  autre: 'Autre',
  add: 'Ajouter une ligne',
  remove: 'Retirer cette proposition',
  proposal:
    'Exemples à relire. Un objectif n’est pas un avoir. Un flux approuvé devient réel à sa date.',
  details: 'Détailler',
};
registerPageTexts(
  Object.fromEntries(Object.entries(BPM_START_DETAILS_TEXTS).map(([k, v]) => [P + k, v])),
);
type Family = 'providers' | 'centers' | 'flows' | 'allocations' | 'assets' | 'goals';
type Row = Record<string, string | number | boolean | null>;
const FIELDS: Record<Family, string[]> = {
  providers: ['name', 'type', 'note'],
  centers: ['name', 'limitCents', 'note'],
  flows: [
    'kind',
    'incomeType',
    'title',
    'amountCents',
    'cadence',
    'date',
    'endDate',
    'center',
    'provider',
    'note',
  ],
  allocations: ['name', 'targetCents', 'note'],
  assets: ['name', 'allocation', 'valueCents', 'liabilityCents', 'date', 'note'],
  goals: ['kind', 'label', 'allocation', 'targetCents', 'targetDate', 'note'],
};
@Component({
  selector: 'rjs-bpm-start-details',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './bpm-start-details.component.scss',
  template: `
    <p>{{ t('proposal') }}</p>
    @if (section() === 'budget' || section() === 'all') {
      <label
        >{{ t('beneficiary')
        }}<input
          [ngModel]="data().beneficiary"
          (ngModelChange)="data().beneficiary = $event; changed.emit()"
          [ngModelOptions]="{ standalone: true }"
          required
          maxlength="120"
      /></label>
    }
    @for (family of families(); track family) {
      <section>
        <h3>{{ t(family) }} · {{ rows(family).length }}</h3>
        @for (row of rows(family); track row; let i = $index) {
          <details>
            <summary>
              {{ row['name'] || row['title'] || row['label'] || t('details') }}
              @if (row['amountCents']) {
                · {{ Number(row['amountCents']) / 100 }} €
              }
            </summary>
            <div class="start-fields">
              @for (field of fields(family); track field) {
                @if (field === 'incomeType' && row['kind'] !== 'income') {
                } @else if (options(family, field); as choices) {
                  <label
                    >{{ t(field)
                    }}<select
                      [ngModel]="row[field]"
                      (ngModelChange)="row[field] = $event; changed.emit()"
                      [ngModelOptions]="{ standalone: true }"
                      [required]="
                        field !== 'provider' && (field !== 'center' || row['kind'] === 'expense')
                      "
                    >
                      <option value="">—</option>
                      @for (choice of choices; track choice.value) {
                        <option [value]="choice.value">{{ choice.label }}</option>
                      }
                    </select></label
                  >
                } @else if (field.endsWith('Cents')) {
                  <label
                    >{{
                      t(
                        family === 'flows' && field === 'date'
                          ? row['kind'] === 'income'
                            ? 'incomeForecastDate'
                            : 'expenseForecastDate'
                          : field
                      )
                    }}<input
                      type="number"
                      min="0"
                      step="0.01"
                      [ngModel]="row[field] === null ? null : Number(row[field]) / 100"
                      (ngModelChange)="setAmount(row, field, $event)"
                      [ngModelOptions]="{ standalone: true }"
                      [required]="
                        field === 'amountCents' ||
                        field === 'liabilityCents' ||
                        (family === 'goals' && field === 'targetCents')
                      "
                  /></label>
                } @else {
                  <label
                    >{{
                      t(
                        family === 'flows' && field === 'date'
                          ? row['kind'] === 'income'
                            ? 'incomeForecastDate'
                            : 'expenseForecastDate'
                          : field
                      )
                    }}<input
                      [type]="field.toLowerCase().includes('date') ? 'date' : 'text'"
                      [ngModel]="row[field]"
                      (ngModelChange)="row[field] = $event; changed.emit()"
                      [ngModelOptions]="{ standalone: true }"
                      [required]="
                        field !== 'note' &&
                        field !== 'endDate' &&
                        (field !== 'incomeType' || row['cadence'] === 'once')
                      "
                      [attr.maxlength]="
                        field === 'note'
                          ? 300
                          : field === 'label'
                            ? 80
                            : field === 'incomeType'
                              ? 100
                              : 120
                      "
                  /></label>
                }
              }
            </div>
            <button
              type="button"
              class="btn btn-secondary"
              (click)="remove(family, i)"
              [disabled]="(family === 'centers' || family === 'allocations') && i === 0"
            >
              {{ t('remove') }}
            </button>
          </details>
        }
        <button type="button" class="btn btn-secondary" (click)="add(family)">
          {{ t('add') }}
        </button>
      </section>
    }
  `,
})
export class BpmStartDetailsComponent {
  readonly data = input.required<BpmCreationDetails>();
  readonly section = input.required<string>();
  readonly today = input.required<string>();
  readonly changed = output<void>();
  protected readonly Number = Number;
  protected families(): Family[] {
    return this.section() === 'budget'
      ? ['centers', 'providers', 'flows']
      : this.section() === 'patrimoine'
        ? ['allocations', 'assets']
        : this.section() === 'vision'
          ? ['goals']
          : ['centers', 'providers', 'flows', 'allocations', 'assets', 'goals'];
  }
  protected rows(family: Family): Row[] {
    if (family === 'providers') this.data().providers ??= [];
    return this.data()[family] as unknown as Row[];
  }
  protected fields(family: Family) {
    return FIELDS[family];
  }
  protected t(key: string) {
    return pageText(P + key);
  }
  protected setAmount(row: Row, key: string, value: number | null) {
    row[key] = value === null ? null : Math.round(value * 100);
    this.changed.emit();
  }
  protected options(family: Family, field: string): { value: string; label: string }[] | null {
    if (field === 'provider')
      return (this.data().providers ?? []).map((p) => ({ value: p.key, label: p.name }));
    if (field === 'center')
      return this.data().centers.map((c) => ({ value: c.key, label: c.name }));
    if (field === 'allocation')
      return this.data().allocations.map((a) => ({ value: a.key, label: a.name }));
    const keys =
      field === 'cadence'
        ? ['once', 'weekly', 'monthly', 'yearly']
        : field === 'kind'
          ? family === 'goals'
            ? ['securite', 'etudes', 'retraite', 'achat', 'transmission', 'autre']
            : ['income', 'expense']
          : null;
    return keys?.map((value) => ({ value, label: this.t(value) })) ?? null;
  }
  protected remove(family: Family, index: number) {
    if (family === 'providers') {
      const key = this.rows(family)[index]?.['key'];
      for (const flow of this.data().flows) if (flow.provider === key) flow.provider = '';
    }
    this.rows(family).splice(index, 1);
    this.changed.emit();
  }
  protected add(family: Family) {
    const key = 'custom-' + Date.now().toString(36);
    const date = this.today();
    const center = this.data().centers[0]?.key ?? '';
    const allocation = this.data().allocations[0]?.key ?? '';
    const defaults: Record<Family, Row> = {
      providers: { key, name: 'Prestataire à personnaliser', type: 'Service', note: '' },
      centers: { key, name: '', limitCents: null, note: '' },
      flows: {
        kind: 'expense',
        title: '',
        amountCents: 0,
        cadence: 'once',
        date,
        endDate: '',
        center,
        settled: false,
        note: '',
      },
      allocations: { key, name: '', targetCents: null, note: '' },
      assets: { name: '', allocation, valueCents: null, liabilityCents: 0, date, note: '' },
      goals: { kind: 'autre', label: '', allocation, targetCents: 0, targetDate: date, note: '' },
    };
    this.rows(family).push(defaults[family]);
    this.changed.emit();
  }
}
