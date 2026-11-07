import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
  ViewEncapsulation,
} from '@angular/core';
export interface PageFocus {
  title: string;
  detail?: string;
  tone?: 'info' | 'success' | 'warning' | 'danger';
}
export interface PageResult {
  message: string;
  tone?: 'info' | 'success' | 'warning' | 'danger';
}

let toolbarId = 0;

/** Commandes de l'écran : les actions et filtres restent portés par leur page. */
@Component({
  selector: 'rjs-page-toolbar, bpm-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './page-toolbar.component.scss',
  template: `
    <section
      class="bpm-context-toolbar"
      [attr.aria-label]="label()"
      [class.is-compact]="compact()"
      [class.is-small]="narrow()?.matches"
      [class.is-open]="filtersVisible()"
      (focusin)="keepFocusedTools($event)"
    >
      @if (scope()) {
        <p class="page-toolbar-scope">{{ scope() }}</p>
      }
      @if (result(); as r) {
        <div
          class="page-toolbar-result"
          [attr.data-state]="r.tone ?? 'success'"
          [attr.role]="r.tone === 'danger' ? 'alert' : 'status'"
        >
          {{ r.message }}
        </div>
      }
      @if (focus(); as f) {
        <div class="bpm-toolbar-focus" [attr.data-state]="f.tone ?? 'info'" role="status">
          <span class="bpm-focus-mark" aria-hidden="true"></span>
          <div>
            <strong>{{ f.title }}</strong>
            @if (f.detail) {
              <p>{{ f.detail }}</p>
            }
          </div>
        </div>
      }
      <div class="bpm-toolbar-command-row">
        <span class="bpm-toolbar-caption">
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
          >
            <path d="M3 5h14M3 10h14M3 15h14" />
            <path d="M7 2v6m6-1v6m-6-1v6" stroke-width="3" />
          </svg>
          {{ label() }}
        </span>
        <div class="bpm-toolbar-primary"><ng-content select="[toolbarPrimary]" /></div>
        <div class="bpm-toolbar-actions" [id]="actionsId"><ng-content select="[toolbarActions]" /></div>
        <button
          type="button"
          class="bpm-toolbar-toggle"
          [attr.aria-expanded]="filtersVisible()"
          [attr.aria-controls]="filtersId + ' ' + actionsId"
          (click)="toggleFilters()"
        >
          {{ filtersVisible() ? 'Réduire les outils' : 'Actions et outils' }}
          <span aria-hidden="true">{{ filtersVisible() ? '−' : '+' }}</span>
        </button>
      </div>
      <div class="bpm-toolbar-filters" [id]="filtersId" [hidden]="!filtersVisible()">
        <ng-content select="[toolbarFilters]" />
      </div>
      <ng-content />
    </section>
  `,
})
export class PageToolbar {
  readonly label = input('Outils de la page');
  readonly scope = input('');
  readonly result = input<PageResult | null>(null);
  readonly focus = input<PageFocus | null>(null);
  readonly compact = input(false);
  protected readonly filtersId = `bpm-toolbar-filters-${++toolbarId}`;
  protected readonly actionsId = `${this.filtersId}-actions`;
  protected readonly narrow = toSignal(inject(BreakpointObserver).observe('(max-width: 700px)'));
  private readonly expanded = signal<boolean | null>(null);
  protected readonly filtersVisible = computed(
    () => this.expanded() ?? (!this.narrow()?.matches && !this.compact()),
  );
  /** Un champ ou une commande en cours d'utilisation ne disparaît pas au défilement. */
  protected keepFocusedTools(event: FocusEvent) {
    const target = event.target as Element | null;
    if (target?.closest('.bpm-toolbar-filters, .bpm-toolbar-actions')) this.expanded.set(true);
  }
  protected toggleFilters() {
    this.expanded.set(!this.filtersVisible());
  }
}
