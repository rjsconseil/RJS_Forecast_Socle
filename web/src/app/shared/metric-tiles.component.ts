import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

export type MetricTone = 'success' | 'danger' | 'warning' | 'accent' | 'neutral';
export interface MetricDetail {
  label: string;
  value: string;
  tone?: MetricTone | null;
  segments?: { text: string; tone?: MetricTone | null }[];
}
/** Une tuile de chiffre clé : libellé, valeur, aide et, au besoin, un lien vers le détail. */
export interface MetricTile {
  id: string;
  label: string;
  value: string;
  suffix?: string;
  note?: string;
  tone?: MetricTone | null;
  emphasis?: boolean;
  symbol?: 'income' | 'expense' | 'balance';
  detailsPlacement?: 'aside' | 'between';
  details?: MetricDetail[];
  checks?: MetricDetail[];
  actions?: {
    label: string;
    link: string;
    query?: Record<string, string> | null;
    fragment?: string;
  }[];
  steps?: ('done' | 'current' | 'todo')[];
  link?: string;
  query?: Record<string, string> | null;
  preserveQuery?: boolean;
  fragment?: string;
}

/**
 * La rangée de chiffres clés commune aux applications. Les calculs restent au
 * module propriétaire ; la tuile ne fait que présenter et relier.
 */
@Component({
  selector: 'rjs-metric-tiles',
  imports: [NgTemplateOutlet, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './metric-tiles.component.scss',
  template: `
    <div
      class="metric-tiles"
      role="list"
      [attr.aria-label]="label()"
      [attr.data-variant]="variant()"
      [attr.data-layout]="layout()"
    >
      @for (tile of tiles(); track tile.id) {
        @if (tile.link && !tile.actions?.length) {
          <a
            class="metric-tile"
            role="listitem"
            [class.is-emphasis]="tile.emphasis"
            [attr.data-tone]="tile.tone ?? null"
            [attr.data-symbol]="tile.symbol ?? null"
            [attr.data-details-placement]="tile.detailsPlacement ?? null"
            [routerLink]="tile.link"
            [queryParams]="tile.query ?? null"
            [queryParamsHandling]="tile.preserveQuery ? 'preserve' : null"
            [fragment]="tile.fragment"
            (click)="selectFragment(tile.fragment)"
            data-ui-pattern="metric"
          >
            <ng-container *ngTemplateOutlet="body; context: { $implicit: tile }" />
          </a>
        } @else {
          <article
            class="metric-tile"
            role="listitem"
            [class.is-emphasis]="tile.emphasis"
            [attr.data-tone]="tile.tone ?? null"
            [attr.data-symbol]="tile.symbol ?? null"
            [attr.data-details-placement]="tile.detailsPlacement ?? null"
            data-ui-pattern="metric"
          >
            <ng-container *ngTemplateOutlet="body; context: { $implicit: tile }" />
          </article>
        }
      }
    </div>
    <ng-template #body let-tile>
      @if (tile.symbol) {
        <span class="metric-symbol" aria-hidden="true">{{
          tile.symbol === 'income' ? '↑' : tile.symbol === 'expense' ? '↓' : '='
        }}</span>
      }
      @if (tile.detailsPlacement === 'between') {
        <div class="metric-flow-layout">
          <div class="metric-principal">
            <ng-container *ngTemplateOutlet="headline; context: { $implicit: tile }" />
          </div>
          <div class="metric-flow-description">
            <ng-container *ngTemplateOutlet="foot; context: { $implicit: tile }" />
            <ng-container *ngTemplateOutlet="details; context: { $implicit: tile }" />
          </div>
        </div>
      } @else if (tile.detailsPlacement === 'aside') {
        <div class="metric-principal">
          <ng-container *ngTemplateOutlet="headline; context: { $implicit: tile }" /><ng-container
            *ngTemplateOutlet="foot; context: { $implicit: tile }"
          />
        </div>
        <div class="metric-aside">
          <ng-container *ngTemplateOutlet="details; context: { $implicit: tile }" />
          @if (tile.checks?.length || tile.actions?.length) {
            <div class="metric-controls">
              @for (check of tile.checks ?? []; track check.label) {
                <span class="metric-check" [attr.data-tone]="check.tone ?? null"
                  ><small>{{ check.label }}</small
                  ><strong>{{ check.value }}</strong></span
                >
              }
            </div>
          }
          @if (tile.actions?.length) {
            <div class="metric-actions">
              @for (action of tile.actions; track action.label) {
                <a
                  [routerLink]="action.link"
                  [queryParams]="action.query ?? null"
                  [fragment]="action.fragment"
                  (click)="selectFragment(action.fragment)"
                  >{{ action.label }} <span aria-hidden="true">→</span></a
                >
              }
            </div>
          }
        </div>
      } @else {
        <ng-container *ngTemplateOutlet="headline; context: { $implicit: tile }" />
        <ng-container *ngTemplateOutlet="details; context: { $implicit: tile }" />
        <ng-container *ngTemplateOutlet="foot; context: { $implicit: tile }" />
      }
    </ng-template>
    <ng-template #headline let-tile>
      <small class="metric-label">{{ tile.label }}</small>
      <strong class="metric-value"
        >{{ tile.value }}
        @if (tile.suffix) {
          <span>{{ tile.suffix }}</span>
        }
      </strong>
    </ng-template>
    <ng-template #foot let-tile>
      @if (tile.steps?.length) {
        <span class="metric-steps" aria-hidden="true">
          @for (step of tile.steps; track $index) {
            <span [attr.data-step]="step"></span>
          }
        </span>
      }
      @if (tile.note) {
        <span class="metric-note">{{ tile.note }}</span>
      }
    </ng-template>
    <ng-template #details let-tile>
      @if (tile.details?.length) {
        <span class="metric-details">
          @for (detail of tile.details; track detail.label) {
            <span [attr.data-tone]="detail.tone ?? null"
              >{{ detail.label }} {{ detail.value }}
              @for (segment of detail.segments ?? []; track $index) {
                <span class="metric-segment" [attr.data-tone]="segment.tone ?? null">{{
                  segment.text
                }}</span>
              }
            </span>
          }
        </span>
      }
    </ng-template>
  `,
})
export class MetricTilesComponent {
  readonly fragmentSelected = output<string>();
  protected selectFragment(fragment?: string) {
    if (fragment) this.fragmentSelected.emit(fragment);
  }
  /** « instrument » : la lecture d'un tableau de bord de cockpit (étiquettes techniques, liseré lumineux). */
  readonly layout = input<'auto' | 'first-wide' | 'last-wide' | 'stacked'>('auto');
  readonly variant = input<'default' | 'instrument'>('default');
  readonly tiles = input.required<MetricTile[]>();
  readonly label = input.required<string>();
}
