import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Params, RouterLink } from '@angular/router';

/** Navigation de lecture : les adresses et les libellés restent fournis par la page. */
@Component({
  selector: 'rjs-period-navigation',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './period-navigation.component.scss',
  template: `
    <nav class="period-navigation bm-period" [attr.aria-label]="label()" [attr.aria-busy]="busy()">
      <a
        class="period-nav-arrow period-nav-previous"
        [routerLink]="[]"
        [queryParams]="previousQuery()"
        [attr.aria-label]="previousLabel()"
        [title]="previousLabel()"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 12h14m-6-6 6 6-6 6" />
        </svg>
      </a>
      <a
        class="period-nav-current"
        [routerLink]="[]"
        [queryParams]="currentQuery()"
        [attr.aria-label]="[title(), status(), currentLabel()].filter(nonEmpty).join(' · ')"
        [title]="[title(), status(), currentLabel()].filter(nonEmpty).join(' · ')"
      >
        <strong
          class="period-nav-title"
          [class.is-range]="periodParts().kind === 'range'"
          [class.is-long-month]="periodParts().primary.length > 8"
        >
          <span class="period-nav-primary period-nav-full">{{ periodParts().primary }}</span>
          <span class="period-nav-primary period-nav-compact">{{ periodParts().compact }}</span>
          @if (periodParts().secondary) {
            <span class="period-nav-year">{{ periodParts().secondary }}</span>
          }
        </strong>
        <span class="period-nav-return"
          ><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" /></svg
          ><span>{{ compactCurrentLabel() || currentLabel() }}</span></span
        >
      </a>
      <a
        class="period-nav-arrow period-nav-next"
        [routerLink]="[]"
        [queryParams]="nextQuery()"
        [attr.aria-label]="nextLabel()"
        [title]="nextLabel()"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 12h14m-6-6 6 6-6 6" />
        </svg>
      </a>
    </nav>
  `,
})
export class PeriodNavigationComponent {
  readonly start = input.required<string>();
  readonly end = input.required<string>();
  readonly label = input.required<string>();
  readonly previousLabel = input.required<string>();
  readonly nextLabel = input.required<string>();
  readonly currentLabel = input.required<string>();
  readonly compactCurrentLabel = input('');
  readonly compactStatus = input('');
  readonly previousQuery = input.required<Params>();
  readonly nextQuery = input.required<Params>();
  readonly currentQuery = input.required<Params>();
  readonly status = input('');
  readonly busy = input(false);
  protected readonly nonEmpty = (value: string) => Boolean(value);
  protected readonly title = computed(() => this.formatTitle(false));
  protected readonly periodParts = computed(() => {
    const from = new Date(this.start() + 'T12:00:00Z');
    const until = new Date(this.end() + 'T12:00:00Z');
    const last = new Date(until);
    last.setUTCDate(last.getUTCDate() - 1);
    const sameYear = from.getUTCFullYear() === last.getUTCFullYear();
    const month =
      from.getUTCDate() === 1 &&
      sameYear &&
      from.getUTCMonth() === last.getUTCMonth() &&
      until.getUTCDate() === 1;
    const year =
      from.getUTCMonth() === 0 &&
      from.getUTCDate() === 1 &&
      until.getUTCMonth() === 0 &&
      until.getUTCDate() === 1 &&
      until.getUTCFullYear() === from.getUTCFullYear() + 1;
    const format = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: 'UTC' });
    const capitalize = (value: string) => value.charAt(0).toLocaleUpperCase('fr') + value.slice(1);
    if (month) {
      return {
        kind: 'month',
        primary: capitalize(format({ month: 'long' }).format(from)),
        compact: capitalize(format({ month: 'short' }).format(from)),
        secondary: format({ year: 'numeric' }).format(from),
      };
    }
    if (year) {
      const value = format({ year: 'numeric' }).format(from);
      return { kind: 'year', primary: value, compact: value, secondary: '' };
    }
    return {
      kind: 'range',
      primary: format({ day: 'numeric', month: 'short' }).formatRange(from, last),
      compact: format({ day: '2-digit', month: '2-digit' }).formatRange(from, last),
      secondary: sameYear
        ? String(from.getUTCFullYear())
        : `${from.getUTCFullYear()}–${last.getUTCFullYear()}`,
    };
  });
  private formatTitle(compact: boolean) {
    const from = new Date(this.start() + 'T12:00:00Z'),
      until = new Date(this.end() + 'T12:00:00Z');
    const last = new Date(until);
    last.setUTCDate(last.getUTCDate() - 1);
    const month =
      from.getUTCDate() === 1 &&
      from.getUTCFullYear() === last.getUTCFullYear() &&
      from.getUTCMonth() === last.getUTCMonth() &&
      until.getUTCDate() === 1;
    const year =
      from.getUTCMonth() === 0 &&
      from.getUTCDate() === 1 &&
      until.getUTCMonth() === 0 &&
      until.getUTCDate() === 1 &&
      until.getUTCFullYear() === from.getUTCFullYear() + 1;
    const format = new Intl.DateTimeFormat('fr-FR', {
      ...(month
        ? { month: compact ? ('short' as const) : ('long' as const), year: 'numeric' as const }
        : year
          ? { year: 'numeric' as const }
          : compact
            ? { day: '2-digit' as const, month: '2-digit' as const }
            : { day: 'numeric' as const, month: 'long' as const, year: 'numeric' as const }),
      timeZone: 'UTC',
    });
    const value = month || year ? format.format(from) : format.formatRange(from, last);
    return value.charAt(0).toLocaleUpperCase('fr') + value.slice(1);
  }
}
