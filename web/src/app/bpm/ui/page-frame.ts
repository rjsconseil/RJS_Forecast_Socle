import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { BpmContextInfo } from '../../core/bpm-models';
import { HeroTone } from '../../shared/app-hero.component';
import { BpmBackTarget } from './heading';
import { BpmPageBanner } from './page-banner';
import { BpmPageFocus, BpmPageResult } from './page-focus';
import { BpmFragmentNavigation } from './fragment-navigation';

/** Cadre de page : le bandeau commun porte les commandes, le corps reste propre au parcours. */
@Component({
  selector: 'bpm-page',
  imports: [BpmPageBanner, BpmFragmentNavigation],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="page bpm-reading bpm-app"
      [class]="pageClass()"
      data-tone="budget"
      bpmFragmentNavigation
    >
      <bpm-page-banner
        [title]="title()"
        [lead]="lead()"
        [kicker]="kicker()"
        [back]="back()"
        [context]="context()"
        [periodKey]="periodKey()"
        [periodNav]="periodNav()"
        [focus]="focus()"
        [toolsLabel]="toolsLabel()"
        [scope]="scope()"
        [result]="result()"
      >
        <ng-content select="[primary]" ngProjectAs="[primary]" />
        <ng-content select="[actions]" ngProjectAs="[actions]" />
        <ng-content select="[tools]" ngProjectAs="[tools]" />
      </bpm-page-banner>
      <ng-content select="[extra]" />
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
  `,
})
export class BpmPageFrame {
  readonly title = input.required<string>();
  readonly lead = input.required<string>();
  readonly kicker = input('Ma vision budgétaire');
  readonly tone = input<HeroTone>('lagoon');
  readonly pageClass = input('');
  readonly context = input<BpmContextInfo | null | undefined>(null);
  readonly periodKey = input<string | undefined>(undefined);
  readonly periodNav = input(false);
  readonly back = input<BpmBackTarget | null>(null);
  readonly focus = input<BpmPageFocus | null>(null);
  readonly scope = input('');
  readonly result = input<BpmPageResult | null>(null);
  readonly toolsLabel = input('Outils de la page');
  readonly periodChange = output<string | null>();
}
