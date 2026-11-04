import { Component, DOCUMENT, ElementRef, effect, inject, input, OnDestroy, output, signal, untracked, viewChild } from '@angular/core';
import { Api, toApiError } from '../core/api.service';
import { FigureEvaluation } from '../core/models';
import { CalcTrace } from '../shared/calc-trace';
import { presentFigure } from './figure-card';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Tiroir « Comment est calculé ce chiffre ? ». À l'ouverture, l'évaluation est relue sur
 * le serveur : l'explication présentée est toujours celle de la formule administrée courante.
 */
@Component({
  selector: 'app-figure-explain',
  imports: [CalcTrace],
  host: { '(document:keydown.escape)': 'onDocumentEscape()' },
  template: `
    @if (figureKey()) {
      <div class="fx-backdrop" (click)="close()" aria-hidden="true"></div>
      <aside
        #panel
        class="fx-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fx-title"
        aria-describedby="fx-sub"
        tabindex="-1"
        (keydown)="onKeydown($event)"
      >
        <header class="fx-head">
          <div class="fx-titles">
            <p class="fx-eyebrow">Comment est calculé ce chiffre ?</p>
            <h2 id="fx-title">{{ figure()?.label ?? 'Calcul du chiffre' }}</h2>
            <p id="fx-sub" class="fx-sub">
              @if (figure(); as f) {
                {{ f.period?.label ?? 'Sans période' }}
                @if (f.value !== null) {
                  · <strong class="fx-val">{{ value(f) }}</strong>
                } @else {
                  · <strong class="fx-val unknown">Inconnu</strong>
                }
              } @else {
                Lecture du calcul…
              }
            </p>
          </div>
          <button #closeBtn type="button" class="fx-close" (click)="close()" aria-label="Fermer l'explication">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
          </button>
        </header>

        <div class="fx-body" aria-live="polite" [attr.aria-busy]="loading()">
          @if (error()) {
            <div class="alert error" role="alert">
              {{ error() }}
              <p><button type="button" class="btn small" (click)="reload()">Réessayer</button></p>
            </div>
          } @else if (figure(); as f) {
            <div [class.fx-stale]="loading()">
              <app-calc-trace [figure]="f" />
            </div>
          } @else {
            <div class="fx-skeleton" aria-hidden="true">
              <span></span><span></span><span class="short"></span><span class="block"></span><span class="block"></span>
            </div>
          }
        </div>
        <footer class="fx-foot">
          <p>La formule est un paramètre administrable : modifier la formule change ce chiffre partout où il est présenté.</p>
        </footer>
      </aside>
    }
  `,
  styles: [
    `
      :host { display: contents; }
      .fx-backdrop {
        position: fixed; inset: 0; z-index: 90;
        background: rgba(12, 18, 26, .42);
        backdrop-filter: blur(2px);
        animation: fx-fade .18s ease-out;
      }
      .fx-panel {
        position: fixed; z-index: 91; top: 0; right: 0; bottom: 0;
        width: min(640px, 100vw);
        display: flex; flex-direction: column;
        background: var(--app-bg);
        color: var(--app-ink, var(--text));
        box-shadow: -12px 0 40px rgba(10, 16, 24, .22);
        border-radius: 18px 0 0 18px;
        animation: fx-slide .22s cubic-bezier(.2, .8, .2, 1);
        outline: none;
      }
      .fx-head {
        display: flex; align-items: flex-start; gap: 12px;
        padding: 22px 24px 16px;
        border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
      }
      .fx-titles { flex: 1; min-width: 0; }
      .fx-eyebrow { margin: 0 0 4px; font-size: 0.72rem; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); font-weight: 600; }
      h2 { margin: 0; font-size: 1.35rem; line-height: 1.25; letter-spacing: -0.01em; }
      .fx-sub { margin: 4px 0 0; color: var(--muted); font-size: 0.9rem; font-variant-numeric: tabular-nums; }
      .fx-val { color: var(--app-ink, var(--text)); }
      .fx-val.unknown { color: var(--unknown); }
      .fx-close {
        flex: none; width: 40px; height: 40px; display: inline-grid; place-items: center;
        border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: inherit; cursor: pointer;
      }
      .fx-close:hover { background: var(--surface-2); }
      .fx-close:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
      .fx-body { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 20px 24px 24px; }
      .fx-stale { opacity: .55; transition: opacity .15s; }
      .fx-foot { padding: 12px 24px 16px; border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent); }
      .fx-foot p { margin: 0; font-size: 0.8rem; color: var(--muted); }
      .fx-skeleton { display: grid; gap: 12px; }
      .fx-skeleton span { display: block; height: 14px; border-radius: 8px; background: var(--surface-2); animation: fx-pulse 1.2s ease-in-out infinite; }
      .fx-skeleton span.short { width: 45%; }
      .fx-skeleton span.block { height: 72px; border-radius: 12px; }
      @keyframes fx-slide { from { transform: translateX(32px); opacity: 0; } to { transform: none; opacity: 1; } }
      @keyframes fx-sheet { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
      @keyframes fx-fade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes fx-pulse { 50% { opacity: .5; } }
      @media (max-width: 640px) {
        .fx-panel { width: 100vw; left: 0; border-radius: 0; animation-name: fx-sheet; }
        .fx-head { padding: 16px 16px 12px; }
        .fx-body { padding: 16px; }
        .fx-foot { padding: 10px 16px 14px; }
        h2 { font-size: 1.15rem; }
      }
      @media (prefers-reduced-motion: reduce) {
        .fx-panel, .fx-backdrop, .fx-skeleton span { animation: none; }
      }
    `,
  ],
})
export class FigureExplain implements OnDestroy {
  readonly figureKey = input<string | null>(null);
  readonly periodKey = input<string | undefined>(undefined);
  readonly closed = output<void>();

  private api = inject(Api);
  private document = inject(DOCUMENT);
  private panel = viewChild<ElementRef<HTMLElement>>('panel');
  private closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');

  protected figure = signal<FigureEvaluation | null>(null);
  protected loading = signal(false);
  protected error = signal<string | null>(null);

  private ticket = 0;
  private returnFocus: HTMLElement | null = null;
  private previousOverflow = '';
  private wasOpen = false;

  constructor() {
    // Relecture serveur à chaque ouverture (ou changement de chiffre / période).
    effect(() => {
      const key = this.figureKey();
      const period = this.periodKey();
      untracked(() => {
        if (key) {
          this.onOpen();
          this.load(key, period);
        } else {
          this.onClose();
        }
      });
    });
    // Focus déplacé dans le tiroir dès qu'il est rendu.
    effect(() => {
      const btn = this.closeBtn();
      if (btn) queueMicrotask(() => btn.nativeElement.focus());
    });
  }

  ngOnDestroy() {
    this.onClose();
  }

  protected value(f: FigureEvaluation) {
    return presentFigure(f);
  }

  protected reload() {
    const key = this.figureKey();
    if (key) this.load(key, this.periodKey());
  }

  private async load(key: string, period: string | undefined) {
    const ticket = ++this.ticket;
    if (this.figure()?.key !== key) this.figure.set(null);
    this.loading.set(true);
    this.error.set(null);
    try {
      const f = await this.api.figure(key, period);
      if (ticket === this.ticket) this.figure.set(f);
    } catch (err) {
      if (ticket === this.ticket) this.error.set(toApiError(err).message);
    } finally {
      if (ticket === this.ticket) this.loading.set(false);
    }
  }

  protected close() {
    this.closed.emit();
  }

  protected onDocumentEscape() {
    if (this.figureKey()) this.close();
  }

  protected onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const root = this.panel()?.nativeElement;
    if (!root) return;
    const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === this.document.activeElement);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = this.document.activeElement;
    if (event.shiftKey && (active === first || active === root)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private onOpen() {
    if (this.wasOpen) return;
    this.wasOpen = true;
    const active = this.document.activeElement;
    this.returnFocus = active instanceof HTMLElement ? active : null;
    this.previousOverflow = this.document.body.style.overflow;
    this.document.body.style.overflow = 'hidden';
  }

  private onClose() {
    this.ticket++;
    this.figure.set(null);
    this.error.set(null);
    this.loading.set(false);
    if (!this.wasOpen) return;
    this.wasOpen = false;
    this.document.body.style.overflow = this.previousOverflow;
    const target = this.returnFocus;
    this.returnFocus = null;
    if (target?.isConnected) queueMicrotask(() => target.focus());
  }
}
