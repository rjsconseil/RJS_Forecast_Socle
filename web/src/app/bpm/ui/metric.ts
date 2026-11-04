import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { cents, signedCents, tone } from '../../core/format';
import { MetricTone } from '../../shared/metric-tiles.component';

export interface MetricSub {
  label: string;
  cents: number | null;
  signed?: boolean;
}

/**
 * Carte de chiffre isolée, sur la tuile de la référence (`rjs-metric-tiles` : `.metric-tile`, `.metric-label`,
 * `.metric-value`, `.metric-details`, `.metric-note`) : valeur en centimes, inconnue distincte de zéro,
 * signe lisible sans couleur, sous-valeurs, statut (enregistré, estimation) et lien vers le détail qui l'explique.
 */
@Component({
  selector: 'bpm-metric',
  imports: [RouterLink, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../shared/metric-tiles.component.scss',
  template: `
    @if (link()) {
      <a
        class="metric-tile"
        data-ui-pattern="metric"
        [class.is-emphasis]="size() === 'big'"
        [attr.data-tone]="dataTone()"
        [routerLink]="link()"
        [queryParams]="query()"
        [attr.aria-label]="label() + ' : ' + text() + ' — voir le détail'"
      >
        <ng-container [ngTemplateOutlet]="body" />
      </a>
    } @else {
      <article class="metric-tile" data-ui-pattern="metric" [class.is-emphasis]="size() === 'big'" [attr.data-tone]="dataTone()">
        <ng-container [ngTemplateOutlet]="body" />
      </article>
    }
    <ng-template #body>
      <small class="metric-label">{{ label() }}</small>
      <strong class="metric-value">{{ text() }}</strong>
      @if (badge()) {
        <span class="metric-check" [attr.data-tone]="badgeDataTone()"><strong>{{ badge() }}</strong></span>
      }
      @if (valueCents() === null && unknownReason()) {
        <span class="metric-note">{{ unknownReason() }}</span>
      }
      @if (subs().length) {
        <span class="metric-details">
          @for (s of subs(); track s.label) {
            <span>{{ s.label }} {{ subText(s) }}</span>
          }
        </span>
      }
      @if (hint()) {
        <span class="metric-note">{{ hint() }}</span>
      }
    </ng-template>
  `,
  styles: `:host { display: block; min-width: 0; } .metric-tile { block-size: 100%; }`,
})
export class BpmMetric {
  readonly label = input.required<string>();
  readonly valueCents = input<number | null>(null);
  readonly signed = input(false);
  readonly colored = input(false);
  readonly unknownText = input('À renseigner');
  readonly unknownReason = input<string | null>(null);
  readonly subs = input<MetricSub[]>([]);
  readonly link = input<string | null>(null);
  readonly query = input<Record<string, string>>({});
  readonly badge = input<string | null>(null);
  readonly badgeTone = input('');
  readonly hint = input<string | null>(null);
  readonly size = input<'normal' | 'big'>('normal');

  protected text = computed(() => {
    const v = this.valueCents();
    if (v === null || v === undefined) return this.unknownText();
    return this.signed() ? signedCents(v) : cents(v);
  });
  /** Ton de la tuile de référence : succès / danger si coloré, avertissement si la valeur est inconnue. */
  protected dataTone = computed<MetricTone | null>(() => {
    const t = tone(this.valueCents());
    if (t === 'unknown') return 'warning';
    if (!this.colored()) return null;
    return t === 'pos' ? 'success' : t === 'neg' ? 'danger' : null;
  });
  protected badgeDataTone = computed<MetricTone | null>(() => {
    const t = this.badgeTone();
    return t === 'pos' || t === 'settled' ? 'success' : t === 'neg' ? 'danger' : t === 'warn' || t === 'estimate' ? 'warning' : t === 'accent' ? 'accent' : null;
  });
  protected subText = (s: MetricSub) => (s.cents === null ? 'Inconnu' : s.signed ? signedCents(s.cents) : cents(s.cents));
}
