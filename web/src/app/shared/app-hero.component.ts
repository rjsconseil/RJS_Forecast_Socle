import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { PageHeroDirective } from './page-hero.directive';
import { PageFocus, PageResult, PageToolbar } from './page-toolbar.component';
import { injectPageWorkspace, injectWorkspaceReturn } from './page-workspace';
import { injectCurrentUrl, injectPlanContext } from './plan-context';
import { PageTabs } from './page-tabs.component';

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
  imports: [RouterLink, PageToolbar, PageTabs],
  hostDirectives: [PageHeroDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Les classes app-hero-* sont propres au bandeau : globales, elles habillent aussi les commandes projetées.
  encapsulation: ViewEncapsulation.None,
  styleUrl: './app-hero.component.scss',
  template: `
    <section class="app-hero" [attr.data-hero]="tone()" [attr.aria-labelledby]="headingId()">
      @if (parent(); as back) {
        <a class="app-hero-parent" [routerLink]="back.link" [queryParams]="back.query" [attr.aria-label]="'Remonter à : ' + back.label"><span aria-hidden="true">↑</span> {{ back.label }}</a>
      }
      <div class="app-hero-heading">
        @if (workspace()?.lead || lead()) {
          <p class="app-hero-lead">{{ workspace()?.lead || lead() }}</p>
        }
        <div class="app-hero-title">
          @if (level() === 1) {
            <h1 [id]="headingId()">{{ workspace()?.title || title() }}</h1>
          } @else {
            <h2 [id]="headingId()">{{ workspace()?.title || title() }}</h2>
          }
          <p class="app-hero-kicker">{{ kicker() }}</p>
        </div>
      </div>
      <rjs-page-tabs class="app-hero-tabs" [tabs]="plan().tabs" [url]="url()" />
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
      <rjs-page-toolbar
        class="app-hero-toolbar"
        [focus]="focus()"
        [label]="toolsLabel() || 'Outils de la page'"
        [compact]="hero.compact()"
        [scope]="scope()"
        [result]="result()"
      >
        <div toolbarPrimary class="app-hero-primary"><ng-content select="[heroPrimary]" /></div>
        <div toolbarActions class="app-hero-actions">
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
        <div toolbarFilters class="app-hero-page-tools">
          <ng-content select="[heroTools], [heroPageTools]" />
          @if (hero.compact()) {
            <button
              type="button"
              class="app-hero-expand"
              [attr.aria-expanded]="hero.expanded()"
              (click)="hero.expanded.set(!hero.expanded())"
            >
              {{ hero.expanded() ? 'Réduire la présentation' : 'Présentation et contexte' }}
            </button>
          }
        </div>
      </rjs-page-toolbar>
    </section>
  `,
})
export class AppHeroComponent {
  protected readonly workspace = injectPageWorkspace();
  protected readonly parent = injectWorkspaceReturn();
  protected readonly plan = injectPlanContext();
  protected readonly url = injectCurrentUrl();
  protected readonly hero = inject(PageHeroDirective);
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
  readonly focus = input<PageFocus | null>(null);
  readonly scope = input('');
  readonly result = input<PageResult | null>(null);
}
