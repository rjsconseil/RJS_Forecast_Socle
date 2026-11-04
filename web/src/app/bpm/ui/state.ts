import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ApiError } from '../../core/api.service';

/**
 * États d'une lecture, dans le vocabulaire des pages BPM de la référence (`bpm-pages.scss`, `bpm-money.scss`) :
 * lecture en cours (`.bpm-help` + `role="status"`), erreur avec nouvelle tentative (`.bpm-error` + `role="alert"`),
 * absence de données (`.bm-empty`). Une valeur inconnue n'est jamais présentée comme un zéro (voir `bpm-metric`).
 */
@Component({
  selector: 'bpm-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './bpm-ui.scss',
  template: `
    @if (error(); as e) {
      <div class="bpm-error bpm-state-error" role="alert">
        <p>{{ e.message }}</p>
        @if (e.body.details?.['field']) {
          <p><small>Champ concerné : {{ e.body.details?.['field'] }}</small></p>
        }
        <div class="bpm-actions">
          <button type="button" class="btn btn-secondary" (click)="retry.emit()">Réessayer</button>
        </div>
      </div>
    } @else if (loading()) {
      <div class="bpm-state-loading" aria-busy="true">
        <p class="bpm-help" role="status">Lecture en cours…</p>
        @for (i of rows(); track i) {
          <span class="bpm-state-line" aria-hidden="true" [style.inline-size.%]="90 - i * 12"></span>
        }
      </div>
    } @else if (empty()) {
      <div class="bm-empty bpm-state-empty">
        <p>{{ emptyText() }}</p>
        <ng-content />
      </div>
    }
  `,
})
export class BpmState {
  readonly loading = input(false);
  readonly error = input<ApiError | null>(null);
  readonly empty = input(false);
  readonly emptyText = input('Aucune donnée pour ce contexte.');
  readonly lines = input(3);
  readonly retry = output<void>();
  protected rows = () => Array.from({ length: this.lines() }, (_, i) => i);
}
