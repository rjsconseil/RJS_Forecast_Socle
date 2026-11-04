import { ChangeDetectionStrategy, Component, forwardRef, input, signal } from '@angular/core';
import { pageText, registerPageTexts } from './page-text';
import {
  ControlValueAccessor,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ValidationErrors,
  Validator,
} from '@angular/forms';

registerPageTexts({
  'content.pages.shared.range-field.component.exact': 'Valeur exacte',
  'content.pages.shared.range-field.component.invalid':
    'Saisissez une valeur de {min} à {max}, par pas de {step}.',
});

/** Un même brouillon, piloté au clavier, au toucher ou par saisie exacte. Aucune écriture. */
@Component({
  selector: 'rjs-range-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './range-field.component.scss',
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => RangeFieldComponent), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(() => RangeFieldComponent), multi: true },
  ],
  template: `
    <div
      class="range-field"
      [class.is-disabled]="disabled()"
      [class.is-invalid]="touched() && !!validate()"
    >
      <div class="range-heading">
        <label [for]="id() + '-range'">{{ label() }}</label>
        <div class="range-exact">
          <input
            type="number"
            [id]="id() + '-number'"
            [attr.aria-label]="label() + ' · ' + t('exact')"
            [attr.aria-describedby]="id() + '-bounds'"
            [attr.aria-invalid]="touched() && !!validate()"
            [min]="min()"
            [max]="max()"
            [step]="numberStep() ?? step()"
            [value]="value() ?? ''"
            [disabled]="disabled()"
            required
            (input)="change($event)"
            (blur)="touch()"
          />
          @if (unit()) {
            <span>{{ unitFor(value()) }}</span>
          }
        </div>
      </div>
      <input
        type="range"
        [id]="id() + '-range'"
        [attr.aria-label]="label()"
        [attr.aria-describedby]="id() + '-bounds'"
        [attr.aria-valuetext]="formatted(value()) + ' ' + unitFor(value())"
        [min]="min()"
        [max]="max()"
        [step]="step()"
        [value]="value() ?? min()"
        [style.--range-position]="position() + '%'"
        [disabled]="disabled()"
        (input)="change($event)"
        (blur)="touch()"
      />
      @if (touched() && validate()) {
        <p class="range-error" role="status">{{ error() }}</p>
      }
      <div class="range-bounds" [id]="id() + '-bounds'">
        <span>{{ formatted(min()) }} {{ unitFor(min()) }}</span>
        @if (hint()) {
          <span class="range-hint">{{ hint() }}</span>
        }
        <span>{{ formatted(max()) }} {{ unitFor(max()) }}</span>
      </div>
    </div>
  `,
})
export class RangeFieldComponent implements ControlValueAccessor, Validator {
  readonly id = input.required<string>();
  readonly label = input.required<string>();
  readonly min = input(0);
  readonly max = input.required<number>();
  readonly step = input(1);
  /** La saisie peut être plus fine que les crans du curseur. */
  readonly numberStep = input<number>();
  readonly unit = input('');
  readonly unitSingular = input('');
  readonly hint = input('');
  protected readonly value = signal<number | null>(null);
  protected readonly disabled = signal(false);
  protected readonly touched = signal(false);
  private changed: (value: number | null) => void = () => {};
  private blurred: () => void = () => {};
  private validatorChanged: () => void = () => {};
  writeValue(value: number | null): void {
    this.value.set(typeof value === 'number' && Number.isFinite(value) ? value : null);
  }
  registerOnChange(fn: (value: number | null) => void): void {
    this.changed = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.blurred = fn;
  }
  registerOnValidatorChange(fn: () => void): void {
    this.validatorChanged = fn;
  }
  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }
  ngOnChanges(): void {
    this.validatorChanged();
  }
  validate(): ValidationErrors | null {
    const value = this.value();
    if (value === null) return { required: true };
    if (value < this.min() || value > this.max())
      return { range: { min: this.min(), max: this.max() } };
    const steps = (value - this.min()) / (this.numberStep() ?? this.step());
    return !Number.isFinite(steps) || Math.abs(steps - Math.round(steps)) > 1e-7
      ? { step: true }
      : null;
  }
  protected change(event: Event): void {
    const n = (event.target as HTMLInputElement).valueAsNumber;
    this.value.set(Number.isFinite(n) ? n : null);
    this.changed(this.value());
  }
  protected touch(): void {
    this.touched.set(true);
    this.blurred();
  }
  protected position(): number {
    const span = this.max() - this.min();
    return span > 0
      ? Math.max(0, Math.min(100, (((this.value() ?? this.min()) - this.min()) / span) * 100))
      : 0;
  }
  protected t(key: string): string {
    return pageText('content.pages.shared.range-field.component.' + key);
  }
  protected error(): string {
    return this.t('invalid')
      .replace('{min}', this.formatted(this.min()))
      .replace('{max}', this.formatted(this.max()))
      .replace('{step}', this.formatted(this.numberStep() ?? this.step()));
  }
  protected unitFor(n: number | null): string {
    const singular: Record<string, string> = {
      ans: 'an',
      jours: 'jour',
      Jours: 'Jour',
      copies: 'copie',
      minutes: 'minute',
      archives: 'archive',
      événements: 'événement',
      repères: 'repère',
      lignes: 'ligne',
      points: 'point',
    };
    return n !== null && Math.abs(n) === 1
      ? this.unitSingular() || singular[this.unit()] || this.unit()
      : this.unit();
  }
  protected formatted(n: number | null): string {
    return n === null
      ? '—'
      : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n);
  }
}
