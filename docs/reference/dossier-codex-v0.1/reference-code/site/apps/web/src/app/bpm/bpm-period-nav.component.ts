import { PeriodNavigationComponent } from '../shared/period-navigation.component';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { BpmStore } from './bpm.store';
import { shiftWindow } from './bpm-money.model';
import { pageText, registerPageTexts } from '../shared/page-text';
const P = 'content.pages.bpm.bpm-period-nav.component.';
export const BPM_PERIOD_NAV_TEXTS: Record<string, string> = {
  past: 'Période passée · consultation',
  future: 'Période à venir · prévisions',
  present: 'Période actuelle',
  pastCompact: 'Passée',
  futureCompact: 'À venir',
  presentCompact: 'Actuelle',
  labelCompact: 'Période',
  currentCompact: 'Revenir',
  error:
    'La période demandée est indisponible. Les chiffres de la période en cours restent affichés.',
  label: 'Période budgétaire consultée',
  previous: 'Période précédente',
  next: 'Période suivante',
  current: 'Revenir à la période en cours',
  loading: 'Lecture de la période…',
};
registerPageTexts(
  Object.fromEntries(Object.entries(BPM_PERIOD_NAV_TEXTS).map(([k, v]) => [P + k, v])),
);
@Component({
  selector: 'rjs-bpm-period-nav',
  imports: [PeriodNavigationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (window(); as w) {
    <rjs-period-navigation
      [start]="w.start"
      [end]="w.end"
      [label]="t('label')"
      [previousLabel]="t('previous')"
      [nextLabel]="t('next')"
      [currentLabel]="t('current')"
      [compactCurrentLabel]="t('currentCompact')"
      [previousQuery]="query(-1)"
      [nextQuery]="query(1)"
      [currentQuery]="query(0)"
      [status]="t(state())"
      [compactStatus]="t(state() + 'Compact')"
      [busy]="loading()"
    />
    @if (loading()) {
      <p class="period-reading-state" role="status">{{ t('loading') }}</p>
    }
    @if (error()) {
      <p class="period-reading-state" role="alert">{{ error() }}</p>
    }
  }`,
})
export class BpmPeriodNavComponent {
  private readonly store = inject(BpmStore);
  protected readonly state = computed(() => {
    const w = this.window();
    const today = this.store.workspace()?.today ?? '';
    return w && today
      ? w.end <= today
        ? 'past'
        : w.start > today
          ? 'future'
          : 'present'
      : 'label';
  });
  readonly window = input<{ start: string; end: string } | null>(null);
  readonly loading = input(false);
  readonly error = input('');
  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap);
  protected t(key: string) {
    return pageText(P + key);
  }
  protected query(step: -1 | 0 | 1) {
    const params = this.params();
    const query: Record<string, string | null> = Object.fromEntries(
      (params?.keys ?? []).map((key) => [key, params!.get(key)]),
    );
    query['lecture'] =
      step && this.window()
        ? shiftWindow(this.window()!.start, this.window()!.end, step).start
        : null;
    return query;
  }
}
