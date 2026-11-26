import { BpmAmount, BpmAmountFlow, BpmAmountTone } from '../ui/amount';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface LifeGaugeValue { label: string; value: string; amountCents?: number | null; flow?: BpmAmountFlow; amountTone?: BpmAmountTone }

export type LifeGaugeTone = 'green' | 'orange' | 'red' | 'unknown';

/** Jauge d'un volet du projet de vie : trois montants autour d'une jauge verticale, puis une bande de suivi. */
export interface LifeGauge {
  heading: string;
  signal: string;
  tone: LifeGaugeTone;
  first: LifeGaugeValue;
  middle: LifeGaugeValue & { kind?: 'spend' | 'gain' | 'neutral' };
  last: LifeGaugeValue;
  /** `aria` décrit aussi la jauge vide : il s'affiche à la place du pourcentage (« Aucune entrée reçue »…). */
  meter: { percent: number | null; label: string; aria: string };
  caption: string | null;
  band: LifeGaugeValue & {
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
  imports: [BpmAmount],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Montant central : une dépense reste rouge (comme « Consommé »), un gain passe en vert, un neutre à l'encre.
  styles: `
    :host { display: grid; min-width: 0; container: life-gauge / inline-size; }
    .pm-budget .pm-consumed[data-kind='gain'] > strong { color: var(--status-success); }
    .pm-budget .pm-consumed[data-kind='neutral'] > strong { color: var(--ink); }
    @container life-gauge (max-width: 480px) {
      .pm-budget.pm-vertical-metrics .pm-money { grid-template-columns: repeat(3, minmax(0, 1fr)) 44px; gap: 8px; }
      .pm-budget.pm-vertical-metrics :is(.pm-envelope, .pm-consumed, .pm-remaining) > strong { font-size: clamp(13px, 4.3cqi, 21px); white-space: normal; overflow-wrap: anywhere; line-height: 1.4; }
      .pm-budget.pm-vertical-metrics :is(.pm-envelope, .pm-consumed, .pm-remaining) > :first-child { font-size: 12px; overflow-wrap: anywhere; }
      .pm-budget.pm-vertical-metrics .pm-metric-heading { flex-wrap: wrap; gap: 6px; font-size: 11px; }
    }
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
          <strong [bpmAmount]="g.first.amountCents" [bpmFlow]="g.first.flow" [bpmTone]="g.first.amountTone">{{ g.first.value }}</strong>
        </div>
        <div class="pm-consumed" [attr.data-kind]="g.middle.kind ?? 'spend'">
          <span>{{ g.middle.label }}</span><strong [bpmAmount]="g.middle.amountCents" [bpmFlow]="g.middle.flow" [bpmTone]="g.middle.amountTone">{{ g.middle.value }}</strong>
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
          <span>{{ g.last.label }}</span><strong [bpmAmount]="g.last.amountCents" [bpmFlow]="g.last.flow" [bpmTone]="g.last.amountTone">{{ g.last.value }}</strong>
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
