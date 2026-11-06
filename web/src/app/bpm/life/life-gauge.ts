import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type LifeGaugeTone = 'green' | 'orange' | 'red' | 'unknown';

/** Jauge d'un volet du projet de vie : trois montants autour d'une jauge verticale, puis une bande de suivi. */
export interface LifeGauge {
  heading: string;
  signal: string;
  tone: LifeGaugeTone;
  first: { label: string; value: string };
  middle: { label: string; value: string; kind?: 'spend' | 'gain' | 'neutral' };
  last: { label: string; value: string };
  /** `aria` décrit aussi la jauge vide : il s'affiche à la place du pourcentage (« Aucune entrée reçue »…). */
  meter: { percent: number | null; label: string; aria: string };
  caption: string | null;
  band: {
    label: string;
    value: string;
    unit?: string;
    sub?: string;
    percent: number | null;
    percentLabel: string;
    tone: 'green' | 'yellow' | 'blue' | 'unknown';
    note?: string | null;
  } | null;
}

/**
 * Même lecture que les jauges de « Gestion de projet » (`bpm-project-metrics`, mode vertical) :
 * mêmes classes, donc même rendu, appliquées aux volets du projet de vie.
 */
@Component({
  selector: 'bpm-life-gauge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Montant central : une dépense reste rouge (comme « Consommé »), un gain passe en vert, un neutre à l'encre.
  styles: `
    :host { display: grid; min-width: 0; }
    .pm-budget .pm-consumed[data-kind='gain'] > strong { color: var(--status-success); }
    .pm-budget .pm-consumed[data-kind='neutral'] > strong { color: var(--ink); }
  `,
  template: `
    @let g = gauge();
    <div class="pm-budget pm-vertical-metrics" [attr.data-tone]="g.tone">
      <div class="pm-metric-heading">
        <span>{{ g.heading }}</span><span class="pm-signal">{{ g.signal }}</span>
      </div>
      <div class="pm-money">
        <div class="pm-envelope">
          <small>{{ g.first.label }}</small>
          <strong>{{ g.first.value }}</strong>
        </div>
        <div class="pm-consumed" [attr.data-kind]="g.middle.kind ?? 'spend'">
          <span>{{ g.middle.label }}</span><strong>{{ g.middle.value }}</strong>
        </div>
        <div class="pm-budget-meter">
          <span class="pm-budget-percent">{{ g.meter.percent === null ? g.meter.aria : g.meter.label }}</span>
          <div
            class="pm-track pm-budget-track"
            role="progressbar"
            aria-orientation="vertical"
            [attr.aria-label]="g.heading"
            [attr.aria-valuenow]="g.meter.percent === null ? null : width()"
            [attr.aria-valuetext]="g.meter.aria"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <span [style.width.%]="100" [style.height.%]="width()"></span>
          </div>
        </div>
        <div class="pm-remaining">
          <span>{{ g.last.label }}</span><strong>{{ g.last.value }}</strong>
        </div>
      </div>
      @if (g.caption) {
        <div class="pm-metric-caption"><span>{{ g.caption }}</span></div>
      }
      @if (g.band; as b) {
        <div class="pm-time" [attr.data-tone]="b.tone">
          <div class="pm-time-heading">
            <div>
              <span class="pm-metric-label">{{ b.label }}</span
              ><strong
                >{{ b.value }}
                @if (b.unit) {
                  <small>{{ b.unit }}</small>
                }</strong
              >
              @if (b.sub) {
                <span class="pm-time-planned">{{ b.sub }}</span>
              }
            </div>
            <span class="pm-time-percent">{{ b.percentLabel }}</span>
          </div>
          @if (b.percent !== null) {
            <!-- Jauge verticale, comme celle du budget au-dessus (même rendu que bpm-project-metrics en mode vertical). -->
            <div
              class="pm-track pm-time-track"
              role="progressbar"
              aria-orientation="vertical"
              [attr.aria-label]="b.label"
              [attr.aria-valuenow]="bandWidth()"
              [attr.aria-valuetext]="b.percentLabel"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span [style.width.%]="100" [style.height.%]="bandWidth()"></span>
            </div>
          } @else {
            <div class="pm-track pm-time-track is-unknown" aria-hidden="true"></div>
          }
          @if (b.note) {
            <p class="pm-time-note">{{ b.note }}</p>
          }
        </div>
      }
    </div>
  `,
})
export class BpmLifeGaugeComponent {
  readonly gauge = input.required<LifeGauge>();
  private clamp = (v: number | null) => (v === null ? 0 : Math.min(100, Math.max(0, v)));
  protected width = computed(() => this.clamp(this.gauge().meter.percent));
  protected bandWidth = computed(() => this.clamp(this.gauge().band?.percent ?? null));
}
