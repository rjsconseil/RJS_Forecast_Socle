import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, RouterLink } from '@angular/router';
import { BpmContextInfo } from '../../core/bpm-models';
import { shortDate } from '../../core/format';
import { HeroTone } from '../../shared/app-hero.component';
import { PeriodNavigationComponent } from '../../shared/period-navigation.component';
import { shiftPeriod } from './page-context';
import { BpmFragmentNavigation } from './fragment-navigation';

let heroId = 0;

/** Libellés de la navigation de période de la référence (`bpm-period-nav.component.ts`). */
const PERIOD_NAV = {
  label: 'Période budgétaire consultée',
  previous: 'Période précédente',
  next: 'Période suivante',
  current: 'Revenir à la période en cours',
  currentCompact: 'Revenir',
  past: 'Période passée · consultation',
  future: 'Période à venir · prévisions',
  present: 'Période actuelle',
  pastCompact: 'Passée',
  futureCompact: 'À venir',
  presentCompact: 'Actuelle',
} as const;

/**
 * Cadre propre à BPM : titre, période, contexte financier puis commandes dans un bandeau fixe.
 * Contenu projeté : `[actions]` pour les commandes, `[tools]` pour les filtres ou la navigation locale,
 * `[extra]` pour les explications sous le bandeau. Les styles restent limités au module BPM.
 */
@Component({
  selector: 'bpm-page',
  imports: [RouterLink, PeriodNavigationComponent, BpmFragmentNavigation],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="page bpm-reading bpm-app"
      [class]="pageClass()"
      data-tone="budget"
      bpmFragmentNavigation
    >
      <header
        class="bpm-page-banner"
        data-ui-pattern="heading"
        data-sticky-hero
        [attr.aria-labelledby]="headingId"
      >
        <div class="bpm-banner-copy">
          @if (back(); as b) {
            <a class="bpm-banner-back" [routerLink]="b.link" [queryParams]="b.query ?? {}"
              >← {{ b.label }}</a
            >
          }
          <p class="eyebrow">Budget/Patrimoine · {{ kicker() }}</p>
          <h1 [id]="headingId">{{ title() }}</h1>
          <p class="bpm-banner-intro">{{ lead() }}</p>
        </div>
        @if (period(); as p) {
          <div class="bpm-banner-period">
            @if (periodNav()) {
              <rjs-period-navigation
                tone="accent"
                [start]="p.start"
                [end]="p.endExclusive"
                [label]="text.label"
                [previousLabel]="text.previous"
                [nextLabel]="text.next"
                [currentLabel]="text.current"
                [compactCurrentLabel]="text.currentCompact"
                [status]="text[state()]"
                [compactStatus]="text[compactState()]"
                [previousQuery]="query(prev())"
                [nextQuery]="query(next())"
                [previousDisabled]="atFirst()"
                [nextDisabled]="atCurrent()"
                [currentQuery]="query(null)"
              />
            } @else {
              <span>Période consultée</span><strong>{{ p.label }}</strong>
            }
          </div>
        }
        @if (context(); as c) {
          <div class="bpm-banner-context">
            <span
              ><strong>{{ c.user.label }}</strong> ·
              {{
                c.scope === 'principal'
                  ? 'Budget du projet de vie'
                  : c.scope === 'budget'
                    ? c.scopeLabel
                    : 'Ensemble des budgets du profil'
              }}</span
            >
            <span>Montants en euros · calcul au {{ date(c.calculationDate) }}</span>
          </div>
        }
        <div class="bpm-banner-actions"><ng-content select="[actions]" /></div>
        <div class="bpm-banner-tools"><ng-content select="[tools]" /></div>
      </header>
      <ng-content select="[extra]" />
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .period-reading-state {
      margin: 0;
    }
  `,
})
export class BpmPageFrame {
  private route = inject(ActivatedRoute);
  readonly title = input.required<string>();
  readonly lead = input.required<string>();
  /** Section du site affichée en surtitre du bandeau. */
  readonly kicker = input('Ma vision budgétaire');
  /** Ambiance du bandeau ; les pages BPM de la référence lisent en `lagoon`. */
  readonly tone = input<HeroTone>('lagoon');
  /** Classes de page de la référence (ex. `bpm-money`, `bpm-vision`, `bpm-start`). */
  readonly pageClass = input('');
  readonly context = input<BpmContextInfo | null | undefined>(null);
  /** Clé explicitement demandée dans l'URL (null = période courante). */
  readonly periodKey = input<string | undefined>(undefined);
  readonly periodNav = input(false);
  readonly back = input<{ label: string; link: string; query?: Record<string, string> } | null>(
    null,
  );
  /** Conservé pour compatibilité : la navigation de période passe désormais par des liens d'URL. */
  readonly periodChange = output<string | null>();

  protected readonly text = PERIOD_NAV;
  protected readonly headingId = `bpm-page-title-${++heroId}`;
  private params = toSignal(this.route.queryParams, { initialValue: {} as Params });
  protected period = computed(() => this.context()?.period ?? null);
  private key = computed(() => this.period()?.key ?? null);
  protected prev = computed(() => (this.key() ? shiftPeriod(this.key()!, -1) : null));
  protected next = computed(() => (this.key() ? shiftPeriod(this.key()!, 1) : null));
  /** Bornes du cycle renvoyées par l'API : l'API refuse toute période hors de cet intervalle. */
  protected atFirst = computed(
    () => !!this.key() && this.key() === this.context()?.periods?.firstKey,
  );
  protected atCurrent = computed(
    () => !!this.key() && this.key() === this.context()?.periods?.currentKey,
  );
  /** Période passée, actuelle ou à venir au regard de la date de calcul renvoyée par l'API. */
  protected state = computed<'past' | 'present' | 'future'>(() => {
    const p = this.period();
    const today = this.context()?.calculationDate ?? '';
    if (!p || !today) return 'present';
    return p.endExclusive <= today ? 'past' : p.start > today ? 'future' : 'present';
  });
  protected compactState = computed(() => `${this.state()}Compact` as const);
  protected date = shortDate;

  /** Les autres paramètres (filtres) sont conservés ; null revient à la période courante. */
  protected query(period: string | null): Params {
    return { ...this.params(), period };
  }
}
