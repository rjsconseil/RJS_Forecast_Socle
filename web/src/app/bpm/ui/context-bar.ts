import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { BpmContextInfo } from '../../core/bpm-models';

/**
 * Barre de contexte du bandeau BPM (`rjs-bpm-context` de la référence, forme intégrée `.bctx-embedded`) :
 * le périmètre lu et, hors mode `scopeOnly`, l'utilisateur dont la situation est affichée.
 * Lecture seule ; les valeurs viennent du contexte renvoyé par l'API (`BpmContextInfo`).
 */
@Component({
  selector: 'rjs-bpm-context',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../ref-styles/bpm-context.component.scss',
  template: `
    <aside aria-label="Contexte de travail">
      <div class="bctx-embedded" [class.is-compact]="compact()">
        @if (info(); as c) {
          <span class="bctx-scope"
            ><small>Périmètre</small><strong>{{ c.scopeLabel }}</strong></span
          >
          @if (!scopeOnly()) {
            <span class="bctx-scope"
              ><small>Utilisateur</small><strong>{{ c.user.label }}</strong></span
            >
          }
        }
      </div>
    </aside>
  `,
})
export class BpmContextBar {
  readonly info = input<BpmContextInfo | null | undefined>(null);
  readonly embedded = input(true);
  readonly compact = input(true);
  readonly scopeOnly = input(false);
}
