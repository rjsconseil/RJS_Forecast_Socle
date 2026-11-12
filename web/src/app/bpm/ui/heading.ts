import { NavigationLabel, NavigationSurfaceDirective } from '../../navigation/navigation-ui';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BpmBack } from './navigation';

export interface BpmBackTarget {
  label: string;
  link: string;
  query?: Record<string, string>;
  direct?: boolean;
}

/** Titre, introduction et retour partagés ; les pages ne décrivent que leur contexte. */
@Component({
  selector: 'bpm-heading',
  host: { class: 'bpm-banner-copy life-banner-copy' },
  imports: [NavigationLabel, NavigationSurfaceDirective, RouterLink, BpmBack],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (back(); as b) {
      @if (b.direct) {
        <a navigationSurface="tertiary" data-navigation-level="detail" class="bpm-banner-back" [routerLink]="b.link" [queryParams]="b.query ?? {}" [attr.aria-label]="'Remonter à : ' + (b.label | navigationLabel:b.link)"><span aria-hidden="true">↑</span> {{ b.label | navigationLabel:b.link }}</a>
      } @else {
        <a navigationSurface="tertiary" data-navigation-level="detail" class="bpm-banner-back" bpmBack [routerLink]="b.link" [queryParams]="b.query ?? {}">← {{ b.label | navigationLabel:b.link }}</a>
      }
    }
    @if (kicker()) {
      <p class="eyebrow">{{ kicker() }}</p>
    }
    <h1 class="display" [id]="headingId()">{{ title() }}</h1>
    <p class="bpm-banner-intro page-intro">{{ lead() }}</p>
`,
  styles: `
    :host {
      display: block;
      min-width: 0;
      grid-column: 1 / -1;
    }
    .eyebrow {
      margin: 0;
    }
    h1.display {
      margin: 4px 0;
    }
    .page-intro {
      max-width: 68ch;
      margin: 0;
      line-height: 1.5;
    }
  `,
})
export class BpmHeading {
  readonly title = input.required<string>();
  /** Surtitre « Section · Page », lu dans le plan du site par le bandeau. */
  readonly kicker = input('');
  readonly lead = input.required<string>();
  readonly headingId = input<string | undefined>();
  readonly back = input<BpmBackTarget | null>(null);
}
