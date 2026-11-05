import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, RouterLink } from '@angular/router';
import { BpmContextInfo } from '../../core/bpm-models';
import { shortDate } from '../../core/format';
import { AppHeroComponent, HeroChip, HeroTone } from '../../shared/app-hero.component';
import { PeriodNavigationComponent } from '../../shared/period-navigation.component';
import { BpmContextBar } from './context-bar';
import { shiftPeriod } from './page-context';

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
 * Cadre commun des pages BPM, composé comme les pages de la référence (`bpm-money.page.ts`,
 * `bpm-money-detail.page.ts`) : bandeau `rjs-app-hero` (figé sous la barre du haut par la directive
 * `rjsStickyPageHero` de la coquille), barre de contexte `rjs-bpm-context` en `heroMetaWide`,
 * retour et actions en `heroActions`, navigation de période `rjs-period-navigation` en `heroFooter`.
 * Contenu projeté : `[actions]` pour les actions du bandeau, `[extra]` pour les explications repliables.
 * La page est enveloppée dans `.page.bpm-reading.bpm-app` (gabarit source), portée des couches globales `_bpm-presentation`.
 */
@Component({
  selector: 'bpm-page',
  imports: [RouterLink, AppHeroComponent, PeriodNavigationComponent, BpmContextBar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page bpm-reading bpm-app" [class]="pageClass()" data-tone="budget">
      <rjs-app-hero
        toolsLabel="Actions"
        [tone]="tone()"
        [headingId]="headingId"
        [kicker]="kicker()"
        [title]="title()"
        [lead]="lead()"
        [chips]="chips()"
      >
        @if (context(); as c) {
          <rjs-bpm-context heroMetaWide [info]="c" [compact]="true" [embedded]="true" />
        }
        @if (back(); as b) {
          <a heroActions class="app-hero-action" [routerLink]="b.link" [queryParams]="b.query ?? {}">← {{ b.label }}</a>
        }
        <div heroActions class="bpm-hero-actions"><ng-content select="[actions]" /></div>
        <div heroFooter>
          @if (!context()) {
            <p class="period-reading-state" role="status">Lecture du contexte…</p>
          } @else if (period(); as p) {
            @if (periodNav()) {
              <rjs-period-navigation
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
            }
          } @else {
            <p class="period-reading-state" role="status">Période : cycle à configurer.</p>
          }
        </div>
      </rjs-app-hero>
      <ng-content select="[extra]" />
      <ng-content />
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .period-reading-state { margin: 0; }
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
  readonly back = input<{ label: string; link: string; query?: Record<string, string> } | null>(null);
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
  protected atFirst = computed(() => !!this.key() && this.key() === this.context()?.periods?.firstKey);
  protected atCurrent = computed(() => !!this.key() && this.key() === this.context()?.periods?.currentKey);
  /** Période passée, actuelle ou à venir au regard de la date de calcul renvoyée par l'API. */
  protected state = computed<'past' | 'present' | 'future'>(() => {
    const p = this.period();
    const today = this.context()?.calculationDate ?? '';
    if (!p || !today) return 'present';
    return p.endExclusive <= today ? 'past' : p.start > today ? 'future' : 'present';
  });
  protected compactState = computed(() => `${this.state()}Compact` as const);
  protected chips = computed<HeroChip[]>(() => {
    const c = this.context();
    if (!c) return [];
    const p = c.period;
    return [
      ...(p ? [{ label: 'Période', value: `${p.label} · du ${shortDate(p.start)} inclus au ${shortDate(p.endExclusive)} exclu` }] : []),
      { label: 'Calcul au', value: shortDate(c.calculationDate) },
    ];
  });

  /** Les autres paramètres (filtres) sont conservés ; null revient à la période courante. */
  protected query(period: string | null): Params {
    return { ...this.params(), period };
  }
}
