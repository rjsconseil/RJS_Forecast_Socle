import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  InjectionToken,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
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

/**
 * Les emplacements déclarés de la barre de commandes d'un écran : le cadre d'une application les range où il veut
 * (action principale dans sa barre de titre, le reste dans son panneau) sans chercher de classes dans le DOM.
 */
export interface PageToolbarParts {
  /** La barre entière (priorité, résultat, actions, filtres). */
  host: HTMLElement;
  /** L'action principale de l'écran (`toolbarPrimary`). */
  primary: HTMLElement;
  /** Les autres actions (`toolbarActions`). */
  actions: HTMLElement;
  /** Les filtres (`toolbarFilters`). */
  filters: HTMLElement;
}

/**
 * Emplacement fourni par le cadre d'une application : la barre de commandes de l'écran s'y range
 * (barre d'outils commune en haut de page) au lieu de rester dans le bandeau de l'écran.
 * Le premier écran qui la réclame l'obtient ; `claim` rend la fonction qui la libère.
 */
export interface PageToolbarSlot {
  claim(parts: PageToolbarParts): (() => void) | null;
}
export const PAGE_TOOLBAR_SLOT = new InjectionToken<PageToolbarSlot>('Emplacement de la barre de commandes');

/** Commandes de l'écran : les actions et filtres restent portés par leur page. */
@Component({
  selector: 'rjs-page-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './page-toolbar.component.scss',
  template: `
    <section
      class="page-toolbar-frame"
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
        <div class="page-toolbar-focus" [attr.data-state]="f.tone ?? 'info'" role="status">
          <span class="page-toolbar-mark" aria-hidden="true"></span>
          <div>
            <strong>{{ f.title }}</strong>
            @if (f.detail) {
              <p>{{ f.detail }}</p>
            }
          </div>
        </div>
      }
      <div class="page-toolbar-command-row">
        <span class="page-toolbar-caption">
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
        <div #primary class="page-toolbar-primary"><ng-content select="[toolbarPrimary]" /></div>
        <div #actions class="page-toolbar-actions" [id]="actionsId"><ng-content select="[toolbarActions]" /></div>
        <button
          type="button"
          class="page-toolbar-toggle"
          [attr.aria-expanded]="filtersVisible()"
          [attr.aria-controls]="filtersId + ' ' + actionsId"
          (click)="toggleFilters()"
        >
          {{ filtersVisible() ? 'Réduire les outils' : 'Actions et outils' }}
          <span aria-hidden="true">{{ filtersVisible() ? '−' : '+' }}</span>
        </button>
      </div>
      <div #filters class="page-toolbar-filters" [id]="filtersId" [hidden]="!filtersVisible()">
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
  protected readonly filtersId = `page-toolbar-filters-${++toolbarId}`;
  protected readonly actionsId = `${this.filtersId}-actions`;
  protected readonly narrow = toSignal(inject(BreakpointObserver).observe('(max-width: 700px)'));
  /** Outils repliés par défaut : l'utilisateur les déplie, le défilement vers le bas les replie. */
  private readonly expanded = signal(false);
  protected readonly filtersVisible = this.expanded.asReadonly();
  private readonly host = inject(ElementRef<HTMLElement>).nativeElement;
  private readonly primaryEl = viewChild.required<ElementRef<HTMLElement>>('primary');
  private readonly actionsEl = viewChild.required<ElementRef<HTMLElement>>('actions');
  private readonly filtersEl = viewChild.required<ElementRef<HTMLElement>>('filters');
  constructor() {
    const slot = inject(PAGE_TOOLBAR_SLOT, { optional: true });
    if (slot) {
      let release: (() => void) | null = null;
      afterNextRender(() => {
        release = slot.claim({ host: this.host, primary: this.primaryEl().nativeElement, actions: this.actionsEl().nativeElement, filters: this.filtersEl().nativeElement });
      });
      inject(DestroyRef).onDestroy(() => release?.());
    }
    effect(() => {
      if (this.compact() && !this.host.contains(document.activeElement)) this.expanded.set(false);
    });
  }
  /** Un champ ou une commande en cours d'utilisation ne disparaît pas au défilement. */
  protected keepFocusedTools(event: FocusEvent) {
    const target = event.target as Element | null;
    if (target?.closest('.page-toolbar-filters, .page-toolbar-actions')) this.expanded.set(true);
  }
  protected toggleFilters() {
    this.expanded.set(!this.filtersVisible());
  }
}
