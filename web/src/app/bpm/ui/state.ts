import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiError } from '../../core/api.service';

/** Refus de l'API « Cycle à configurer » (règle sur la période), distinct d'une panne : réessayer ne changerait rien. */
export function isCycleRefusal(e: ApiError | null | undefined): boolean {
  return !!e && e.body.code === 'FORBIDDEN_BY_RULE' && e.body.details?.['field'] === 'period';
}

/**
 * Les deux chemins pour sortir de « Cycle à configurer », partout les mêmes :
 * l'assistant du projet de vie (cycle, patrimoine, budget type en une fois, il complète un budget existant),
 * ou le seul réglage du cycle pour qui veut aller vite.
 */
@Component({
  selector: 'bpm-cycle-setup',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './bpm-ui.scss',
  template: `
    @if (buttons()) {
      <span class="bpm-actions bpm-cycle-setup">
        <a class="btn btn-primary" routerLink="/creer/projet-de-vie">Démarrer mon projet de vie</a>
        <a class="btn btn-secondary" routerLink="/app/reglages/cycle">Régler seulement le cycle</a>
      </span>
    } @else {
      <span class="bpm-cycle-setup">
        <a class="bm-action-link" routerLink="/creer/projet-de-vie">Démarrer mon projet de vie →</a>
        <span aria-hidden="true"> · </span>
        <a class="bm-action-link" routerLink="/app/reglages/cycle">Régler seulement le cycle</a>
      </span>
    }
  `,
})
export class BpmCycleSetup {
  readonly buttons = input(false);
}

/**
 * États d'une lecture, dans le vocabulaire des pages BPM de la référence (`bpm-pages.scss`, `bpm-money.scss`) :
 * lecture en cours (`.bpm-help` + `role="status"`), erreur avec nouvelle tentative (`.bpm-error` + `role="alert"`),
 * absence de données (`.bm-empty`). Une valeur inconnue n'est jamais présentée comme un zéro (voir `bpm-metric`).
 */
@Component({
  selector: 'bpm-state',
  imports: [BpmCycleSetup],
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
          <bpm-cycle-setup [buttons]="true" />
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
  protected isCycleToConfigure = isCycleRefusal;
}
