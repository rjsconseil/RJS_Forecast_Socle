import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PlanCard } from '../shared/site-plan';

let planCardsId = 0;

/**
 * Les cartes de destination des accueils de zone et de section (gabarit `shared/plan-cards.component`
 * de la référence) : une destination, une ancre native ; toute la carte se parcourt au doigt comme au clavier.
 */
@Component({
  selector: 'rjs-plan-cards',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (commonResult(); as result) {
      <p class="plan-shared-result" [id]="resultId" data-ui-pattern="section-heading">
        <strong>Vous obtenez</strong>
        <span>{{ result }}</span>
      </p>
    }
    <div class="plan-page-grid" data-ui-pattern="journey">
      @for (card of cards(); track card.id; let index = $index) {
        <a
          class="plan-page-card plan-destination"
          data-ui-pattern="panel"
          [attr.data-tone]="card.tone"
          [attr.data-page-tone]="card.pageTone"
          [attr.aria-labelledby]="'journey-' + card.id"
          [attr.aria-describedby]="'journey-description-' + card.id + ' ' + (commonResult() ? resultId : 'journey-result-' + card.id)"
          [routerLink]="card.link"
          [queryParams]="card.query ?? null"
          [fragment]="card.fragment"
        >
          <header class="plan-page-head">
            <span class="plan-step" aria-hidden="true">{{ number(index) }}</span>
            @if (card.step) {
              <span class="plan-step-label">{{ card.step }}</span>
            }
            @if (card.metric !== null && card.metric !== undefined) {
              <span class="plan-metric">{{ card.metric }} <small>éléments</small></span>
            }
          </header>
          <h2 [id]="'journey-' + card.id">{{ card.label }}</h2>
          <p [id]="'journey-description-' + card.id">{{ card.description }}</p>
          @if (!commonResult()) {
            <div class="plan-result" [id]="'journey-result-' + card.id">
              <strong>Vous obtenez</strong><span>{{ card.result }}</span>
            </div>
          }
          <span class="plan-action" data-ui-pattern="action" aria-hidden="true">
            {{ card.action ?? 'Ouvrir ' + card.label }} <span aria-hidden="true">→</span>
          </span>
        </a>
      }
    </div>
  `,
})
export class PlanCardsComponent {
  readonly cards = input.required<readonly PlanCard[]>();
  protected readonly resultId = `plan-shared-result-${++planCardsId}`;
  /** Un résultat commun à toutes les cartes est dit une seule fois, au-dessus de la grille. */
  protected readonly commonResult = computed(() => {
    const cards = this.cards();
    const result = cards[0]?.result;
    return cards.length > 1 && result && cards.every((card) => card.result === result) ? result : null;
  });
  protected number(index: number): string {
    return String(index + 1).padStart(2, '0');
  }
}
