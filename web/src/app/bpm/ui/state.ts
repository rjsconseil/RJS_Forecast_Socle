import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiError } from '../../core/api.service';

/**
 * États d'une lecture, dans le vocabulaire des pages BPM de la référence (`bpm-pages.scss`, `bpm-money.scss`) :
 * lecture en cours (`.bpm-help` + `role="status"`), erreur avec nouvelle tentative (`.bpm-error` + `role="alert"`),
 * absence de données (`.bm-empty`). Une valeur inconnue n'est jamais présentée comme un zéro (voir `bpm-metric`).
 */
@Component({
  selector: 'bpm-state',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './bpm-ui.scss',
  template: `
    @if (error(); as e) {
      @if (isCycleToConfigure(e)) {
        <!-- Règle, pas panne : sans cycle, aucune période n'existe à lire ; réessayer ne changerait rien. -->
        <div class="bm-empty bpm-state-empty bpm-state-cycle" role="status">
          <p>
            <strong>Cycle à configurer.</strong> Les chiffres d'une période sont inconnus tant que le cycle du Budget du projet
            de vie n'a pas de date de début : ils ne valent pas zéro.
          </p>
          <div class="bpm-actions">
            <a class="btn btn-primary" routerLink="/app/reglages">Configurer le cycle</a>
          </div>
        </div>
      } @else {
      <div class="bpm-error bpm-state-error" role="alert">
        <p>{{ e.message }}</p>
        @if (e.body.details?.['field']) {
          <p><small>Champ concerné : {{ e.body.details?.['field'] }}</small></p>
        }
        <div class="bpm-actions">
          <button type="button" class="btn btn-secondary" (click)="retry.emit()">Réessayer</button>
        </div>
      </div>
      }
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
  /** Refus de l'API « Cycle à configurer » (règle sur la période), distinct d'une panne. */
  protected isCycleToConfigure(e: ApiError) {
    return e.body.code === 'FORBIDDEN_BY_RULE' && e.body.details?.['field'] === 'period';
  }
}
