import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/** Réglage local : le parent décide quand enregistrer. Glissement vertical, clavier ou saisie précise. */
@Component({
  selector: 'bpm-dial',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './dial.scss',
  template: `
    <fieldset class="bpm-dial" [disabled]="disabled()" [class.is-disabled]="disabled()">
      <legend>{{ label() }}</legend>
      <div class="dial-ring" [style.--dial-angle]="angle() + 'deg'" [style.--dial-fill]="fill() + 'deg'">
        <div class="dial-knob" role="slider" [attr.tabindex]="disabled() ? -1 : 0"
          [attr.aria-label]="label()" [attr.aria-valuemin]="min()" [attr.aria-valuemax]="upper()"
          [attr.aria-valuenow]="current()" [attr.aria-valuetext]="display() || current() + ' ' + unit()"
          [attr.aria-disabled]="disabled()" aria-orientation="vertical"
          title="Glissez vers le haut ou le bas. Au clavier : flèches, Début et Fin."
          (pointerdown)="start($event)" (pointermove)="drag($event)" (pointerup)="stop($event)" (pointercancel)="stop($event)" (keydown)="key($event)">
          <span class="dial-marker" aria-hidden="true"></span>
          <strong [class.has-display]="!!display()">{{ display() || current() }}<small>{{ display() ? '' : unit() }}</small></strong>
        </div>
      </div>
      <div class="dial-precision">
        <button type="button" [disabled]="disabled() || current() <= min()" [attr.aria-label]="'Diminuer : ' + label()" (click)="adjust(-step())">−</button>
        <input type="number" [attr.aria-label]="label() + ' : valeur précise'" [value]="current()" [min]="min()" [max]="upper()" [step]="step()" (change)="typed($event)" />
        <button type="button" [disabled]="disabled() || current() >= upper()" [attr.aria-label]="'Augmenter : ' + label()" (click)="adjust(step())">+</button>
      </div>
      <span class="dial-scale">{{ min() }} — {{ upper() }} {{ unit() }}</span>
    </fieldset>
  `,
})
export class BpmDial {
  readonly label = input.required<string>();
  readonly value = input(0);
  readonly min = input(0);
  readonly max = input(100);
  readonly step = input(1);
  readonly unit = input('%');
  readonly display = input('');
  readonly disabled = input(false);
  readonly valueChange = output<number>();
  protected readonly upper = computed(() => Math.max(this.min(), this.max()));
  protected readonly current = computed(() => Math.max(this.min(), Math.min(this.upper(), Number.isFinite(this.value()) ? this.value() : this.min())));
  protected readonly fill = computed(() => this.upper() > this.min() ? (this.current() - this.min()) / (this.upper() - this.min()) * 270 : 0);
  protected readonly angle = computed(() => this.fill() - 135);
  private gesture: { pointer: number; y: number; value: number } | null = null;
  protected start(event: PointerEvent) {
    if (this.disabled() || event.button !== 0) return;
    this.gesture = { pointer: event.pointerId, y: event.clientY, value: this.current() };
    const knob = event.currentTarget as HTMLElement;
    knob.focus(); knob.setPointerCapture(event.pointerId); event.preventDefault();
  }
  protected drag(event: PointerEvent) {
    const gesture = this.gesture;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    this.emit(gesture.value + (gesture.y - event.clientY) / 140 * (this.upper() - this.min()));
  }
  protected stop(event: PointerEvent) { if (this.gesture?.pointer === event.pointerId) this.gesture = null; }
  protected key(event: KeyboardEvent) {
    const steps: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
    if (event.key in steps) { event.preventDefault(); this.adjust(this.step() * steps[event.key]); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); this.emit(event.key === 'Home' ? this.min() : this.upper()); }
  }
  protected typed(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.value !== '' && Number.isFinite(input.valueAsNumber)) this.emit(input.valueAsNumber);
    else input.value = String(this.current());
  }
  protected adjust(delta: number) { this.emit(this.current() + delta); }
  private emit(value: number) {
    if (this.disabled()) return;
    const step = this.step() > 0 ? this.step() : 1;
    const rounded = this.min() + Math.round((value - this.min()) / step) * step;
    this.valueChange.emit(Math.round(Math.max(this.min(), Math.min(this.upper(), rounded)) * 1e6) / 1e6);
  }
}
