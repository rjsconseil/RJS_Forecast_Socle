import { PAGE_GUIDANCE } from './page-guidance';
import { PageHeading } from './page-heading.component';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { ActivatedRoute, convertToParamMap, Params, RouterLink } from '@angular/router';
import type { Period } from '../core/models';
import { shortDate } from '../core/format';
import { HeroTone } from './app-hero.component';
import { PeriodNavigationComponent } from './period-navigation.component';
import { PageFocus, PageResult, PageToolbar } from './page-toolbar.component';

import { PageHeroDirective } from './page-hero.directive';
import { injectPageWorkspace, injectWorkspaceReturn } from '../plan/page-workspace';
import { injectCurrentUrl, injectPlanContext } from '../plan/plan-context';
import { PageTabs } from '../plan/page-tabs.component';
let heroId = 0;

/** Le contexte de lecture qu'une page donne à son bandeau : qui, quel périmètre, quelle période, calculé quand. */
export interface PageContextInfo {
  user: { label: string };
  scopeLabel?: string | null;
  period: (Period & { endExclusive: string }) | null;
  /** Bornes de navigation : première période lisible et période courante. */
  periods?: { firstKey: string; currentKey: string } | null;
  calculationDate: string;
}

/** La période voisine d'une clé « AAAA-MM ». */
export function shiftPeriod(key: string, delta: number) {
  const [y, m] = key.split('-').map(Number);
  const i = y * 12 + (m - 1) + delta;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

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
 * Bandeau commun des pages : identité, contexte, période, priorité et commandes. Le sélecteur `rjs-page-banner`
 * et les classes `bpm-banner-*` sont historiques (ciblés par les feuilles globales) ; aucune application n'est importée.
 */
@Component({
  selector: 'rjs-page-banner',
  hostDirectives: [PageHeroDirective],
  imports: [RouterLink, PageHeading, PeriodNavigationComponent, PageToolbar, PageTabs],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'rjs-page-banner',
    'data-ui-pattern': 'heading',
    'data-sticky-hero': '',
    role: 'region',
    '[attr.aria-labelledby]': 'headingId',
    '[class.bpm-banner-compact]': 'compact() && !expanded()',
  },
  template: `
    <bpm-heading
      [back]="back() ?? parent()"
      [kicker]="kicker() || plan().eyebrow || ''"
      [title]="displayTitle()"
      [lead]="guidance?.lead ?? displayLead()"
      [headingId]="headingId"
    >
    @if (guidance && nextPath(); as next) {
      <a class="page-guidance-next" [routerLink]="next" [queryParams]="readingQuery()">{{ guidance!.nextLabel }} <span data-astra-icon="continuer" aria-hidden="true"></span></a>
    }
    </bpm-heading>
    <rjs-page-tabs [tabs]="plan().tabs" [url]="url()" [label]="'Vues de « ' + (plan().location.page?.label ?? title()) + ' »'" />
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
        <span>Montants en euros · calcul au {{ date(c.calculationDate) }}</span>
      </div>
    }
    <rjs-page-toolbar
      [focus]="focus()"
      [label]="effectiveToolsLabel()"
      [compact]="compact()"
      [scope]="effectiveScope()"
      [result]="result()"
    >
      <div toolbarPrimary class="bpm-banner-primary"><ng-content select="[primary]" /></div>
      <div toolbarActions class="bpm-banner-actions"><ng-content select="[actions]" /></div>
      <div toolbarFilters class="bpm-banner-tools">
        <ng-content select="[tools]" />
        @if (compact()) {
          <button
            type="button"
            class="bpm-banner-expand"
            [attr.aria-expanded]="expanded()"
            (click)="expanded.set(!expanded())"
          >
            {{ expanded() ? 'Réduire la présentation' : 'Présentation et contexte' }}
          </button>
        }
      </div>
    </rjs-page-toolbar>
  `,
})
export class PageBanner {
  protected readonly workspace = injectPageWorkspace();
  protected readonly parent = injectWorkspaceReturn();
  /** Le plan du site situe la page : surtitre, niveau supérieur et onglets sont les mêmes partout. */
  protected readonly plan = injectPlanContext();
  protected readonly url = injectCurrentUrl();
  private route = inject(ActivatedRoute);
  protected readonly guidance = inject(PAGE_GUIDANCE, { optional: true });
  private readonly guideParams = toSignal(this.route.paramMap ?? of(convertToParamMap({})));
  private readonly guideQuery = toSignal(this.route.queryParamMap ?? of(convertToParamMap({})));
  protected readonly nextPath = computed(() => this.guidance?.nextPath.replace(':id', this.guideParams()?.get('id') ?? ''));
  protected readonly readingQuery = computed(() => {
    const query = this.guideQuery();
    const period = query?.get(this.guidance?.periodParam ?? 'period') || query?.get('period');
    return period ? { period } : {};
  });
  readonly title = input.required<string>();
  readonly lead = input.required<string>();
  /** Surtitre imposé ; par défaut « Section · Page » lu dans le plan du site. */
  readonly kicker = input('');
  /** Une fiche ouverte garde son nom en titre ; ses sous-pages sont des onglets. */
  protected readonly displayTitle = computed(() =>
    this.plan().location.object ? this.title() : (this.guidance?.title ?? this.workspace()?.title ?? this.title()),
  );
  protected readonly displayLead = computed(() => this.workspace()?.lead ?? this.lead());
  /** Les outils portent le nom de la vue où l'on est : une sous-page ne reprend pas l'intitulé de sa page. */
  protected readonly effectiveToolsLabel = computed(() => {
    const plan = this.plan();
    const own = this.toolsLabel();
    const generic = !own || own === 'Outils de la page' || own === 'Outils de cette étape';
    if (plan.location.kind === 'subpage' && !plan.location.object) return `Outils · ${plan.label}`;
    return generic && plan.label ? `Outils · ${plan.label}` : own;
  });
  /** Ambiance du bandeau ; les pages BPM de la référence lisent en `lagoon`. */
  readonly tone = input<HeroTone>('lagoon');
  /** Classes de page de la référence (ex. `bpm-money`, `bpm-vision`, `bpm-start`). */
  readonly pageClass = input('');
  readonly context = input<PageContextInfo | null | undefined>(null);
  /** Clé explicitement demandée dans l'URL (null = période courante). */
  readonly periodKey = input<string | undefined>(undefined);
  readonly periodNav = input(false);
  /** Niveau supérieur imposé (ex. l'origine d'un détail) ; par défaut la page parente du plan. */
  readonly back = input<{ label: string; link: string; query?: Record<string, string>; direct?: boolean } | null>(
    null,
  );
  /** Conservé pour compatibilité : la navigation de période passe désormais par des liens d'URL. */
  readonly focus = input<PageFocus | null>(null);
  readonly toolsLabel = input('Outils de la page');
  readonly scope = input('');
  readonly result = input<PageResult | null>(null);
  private readonly hero = inject(PageHeroDirective);
  protected readonly compact = this.hero.compact;
  protected readonly expanded = this.hero.expanded;
  protected readonly effectiveScope = computed(() => {
    const c = this.context();
    return (
      this.scope() ||
      (c
        ? [
            c.user.label,
            c.scopeLabel,
            c.period?.label,
            this.state() === 'past' ? 'Période passée' : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : '')
    );
  });

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

  /** Les filtres suivent la lecture ; une fiche ou une saisie ouverte reste propre à sa période. */
  protected query(period: string | null): Params {
    const query: Params = { ...this.params(), period };
    for (const key of ['entry', 'operation', 'occurrence', 'ligne', 'initial', 'current'])
      delete query[key];
    return query;
  }
}
