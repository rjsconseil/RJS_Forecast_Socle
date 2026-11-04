import { ChangeDetectionStrategy, Component, ViewEncapsulation, input } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface HeroChip {
  label: string;
  value: string;
}
export interface HeroAction {
  label: string;
  link: string;
  query?: Record<string, string> | null;
  fragment?: string;
}
/** Trois ambiances de bandeau ; chaque module choisit la sienne sans être nommé ici. */
export type HeroTone = 'indigo' | 'lagoon' | 'aurora';

/**
 * Le bandeau commun : aide en haut à gauche, titre et section à droite,
 * contenu, puis pastilles et contexte au-dessus de la navigation.
 * Pure présentation : les textes et les chiffres viennent du module appelant.
 */
@Component({
  selector: 'rjs-app-hero',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Les classes app-hero-* sont propres au bandeau : globales, elles habillent aussi les commandes projetées.
  encapsulation: ViewEncapsulation.None,
  styleUrl: './app-hero.component.scss',
  template: `
    <section class="app-hero" [attr.data-hero]="tone()" [attr.aria-labelledby]="headingId()">
      <div class="app-hero-heading">
        @if (lead()) {
          <p class="app-hero-lead">{{ lead() }}</p>
        }
        <div class="app-hero-title">
          @if (level() === 1) {
            <h1 [id]="headingId()">{{ title() }}</h1>
          } @else {
            <h2 [id]="headingId()">{{ title() }}</h2>
          }
          <p class="app-hero-kicker">{{ kicker() }}</p>
        </div>
      </div>
      <div class="app-hero-guide"><ng-content select="[heroGuide]" /></div>
      <div class="app-hero-visual"><ng-content /></div>
      <div class="app-hero-bottom">
        @if (chips().length) {
          <p class="app-hero-chips">
            @for (chip of chips(); track chip.label) {
              <span class="app-hero-chip"
                ><small>{{ chip.label }}</small
                >{{ chip.value }}</span
              >
            }
          </p>
        }
        <div class="app-hero-meta"><ng-content select="[heroMeta], [heroMetaWide]" /></div>
        <div class="app-hero-footer"><ng-content select="[heroFooter]" /></div>
      </div>
      <div class="app-hero-toolbar" role="group" aria-label="Outils de la page">
        <div class="app-hero-commandbar">
          @if (toolsLabel()) {
            <span class="app-hero-toolbar-label">{{ toolsLabel() }}</span>
          }
          <div class="app-hero-tools"><ng-content select="[heroTools]" /></div>
          <div class="app-hero-copy">
            <!-- Liens déclarés et commandes projetées ([heroActions]) partagent la même rangée. -->
            <div class="app-hero-actions">
              @for (action of actions(); track action.label; let first = $first) {
                <a
                  class="app-hero-action"
                  [class.is-secondary]="!first"
                  [routerLink]="action.link"
                  [queryParams]="action.query ?? null"
                  [fragment]="action.fragment"
                  >{{ action.label }}</a
                >
              }
              <ng-content select="[heroActions]" />
            </div>
          </div>
        </div>
        <div class="app-hero-page-tools"><ng-content select="[heroPageTools]" /></div>
      </div>
    </section>
  `,
})
export class AppHeroComponent {
  readonly kicker = input.required<string>();
  readonly title = input.required<string>();
  readonly headingId = input.required<string>();
  readonly lead = input('');
  readonly level = input<1 | 2>(1);
  readonly tone = input<HeroTone>('indigo');
  readonly chips = input<HeroChip[]>([]);
  readonly actions = input<HeroAction[]>([]);
  /** Facultatif : les modules peuvent nommer la rangée de leurs actions. */
  readonly toolsLabel = input('');
}
