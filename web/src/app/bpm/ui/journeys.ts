import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Entrées par intention : chaque parcours rejoint son écran de travail existant. */
@Component({
  selector: 'bpm-journeys',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details [open]="expanded() ?? initiallyOpen()" (toggle)="expanded.set($any($event.target).open)">
      <summary>Que souhaitez-vous faire ? <span>Les parcours essentiels de BPM</span></summary>
      <nav aria-label="Parcours essentiels" class="journeys">
        @for (journey of journeys; track journey.path) {
          <a [routerLink]="journey.path" [queryParams]="journey.period ? periodQuery() : null">
            <strong>{{ journey.title }} <span aria-hidden="true">→</span></strong>
            <span>{{ journey.steps }}</span>
          </a>
        }
      </nav>
    </details>
  `,
  styles: `
    :host { display: block; margin-block: 16px; }
    details { border: 1px solid var(--card-border); border-radius: 12px; background: var(--c-surface); }
    summary { cursor: pointer; padding: 16px; font-weight: 600; }
    summary > span { font-weight: 400; color: var(--c-text-2); margin-inline-start: 12px; }
    .journeys { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 0 16px 16px; }
    a { display: grid; gap: 8px; padding: 16px; border: 1px solid var(--card-border); border-radius: 8px; color: inherit; text-decoration: none; }
    a:hover, a:focus-visible { background: var(--c-surface-2); outline: 2px solid var(--c-accent); outline-offset: 2px; }
    strong { display: flex; justify-content: space-between; gap: 8px; }
    a > span { color: var(--c-text-2); font-size: .85rem; line-height: 1.5; }
    @media(max-width: 900px) { .journeys { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media(max-width: 560px) { .journeys { grid-template-columns: minmax(0, 1fr); } summary > span { display: block; margin: 4px 0 0; } }
  `,
})
export class BpmJourneys {
  readonly periodQuery = input<Record<string, string>>({});
  readonly initiallyOpen = input(false);
  protected expanded = signal<boolean | null>(null);
  protected readonly journeys = [
    { title: 'Saisir et vérifier mes opérations', steps: 'Enregistrer une entrée ou une dépense, puis retrouver son règlement.', path: '/depenses/registre', period: true },
    { title: 'Régler mes échéances', steps: 'Vérifier les dates et montants, puis pointer ce qui est payé ou reçu.', path: '/piloter/agir' },
    { title: 'Préparer mon budget', steps: 'Ajuster les revenus et charges récurrents, puis fixer mes plafonds.', path: '/projet-de-vie/budget-type' },
    { title: 'Réaliser un projet', steps: 'Créer le projet, attribuer son budget et faire avancer ses tâches.', path: '/app/gestion-projet' },
    { title: 'Terminer une période', steps: 'Rapprocher le compte, vérifier les opérations et confirmer la clôture.', path: '/projet-de-vie/cloture', period: true },
    { title: 'Préparer mes objectifs', steps: 'Donner un montant et une date, puis vérifier la couverture estimée.', path: '/vision' },
  ];
}
