import { defaultApplicationHome } from '../platform/applications';
import { DOCUMENT } from '@angular/common';
import { previewFonts } from './navigation-preview-fonts';
import { staticNavigationPreview } from './navigation-static-preview';
import { Component, CSP_NONCE, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { NavigationConfiguration } from './navigation-model';

const VIEWPORT_PRESETS = [
  { name: 'Adapté', width: null, height: 850 },
  { name: 'Grand écran', width: 1440, height: 900 },
  { name: 'Ordinateur', width: 1024, height: 768 },
  { name: 'Tablette', width: 768, height: 1024 },
  { name: 'Mobile', width: 390, height: 844 },
] as const;

@Component({
  selector: 'rjs-navigation-live-preview',
  imports: [FormsModule],
  template: `
    <section class="live-preview" aria-labelledby="live-preview-title">
      <header>
        <div>
          <h2 id="live-preview-title">Simulation statique de BPM</h2>
          <p>
            Cliquez sur Simuler pour visualiser les réglages courants sur des pages de
            démonstration.
          </p>
        </div>
        <span class="preview-status" role="status">
          {{ document() ? 'Simulation générée' : 'Prêt à simuler' }}
        </span>
        <button type="button" (click)="simulate()" [disabled]="simulating()">
          {{ simulating() ? 'Préparation…' : 'Simuler' }}
        </button>
      </header>
      <div class="preview-controls">
        <label>
          Page à examiner
          <select [ngModel]="path()" (ngModelChange)="selectPage($event)">
            @for (page of pages(); track page.link) {
              <option [value]="page.link">{{ page.label }}</option>
            }
          </select>
        </label>
        <label>
          Menu latéral sur grand écran
          <select [ngModel]="focus()" (ngModelChange)="focus.set($event)">
            <option [ngValue]="false">Visible</option>
            <option [ngValue]="true">Masqué · mode concentré</option>
          </select>
        </label>
        <label>
          Densité
          <select [ngModel]="density()" (ngModelChange)="density.set($event)">
            <option value="comfortable">Confortable</option>
            <option value="compact">Dense</option>
          </select>
        </label>
        <label>
          Style de l’interface
          <select [ngModel]="visualStyle()" (ngModelChange)="visualStyle.set($event)">
            <option value="classic">Classique</option>
            <option value="editorial">Éditorial</option>
          </select>
        </label>
        <label>
          Cibles de navigation
          <select [ngModel]="touchTargets()" (ngModelChange)="touchTargets.set($event)">
            <option [ngValue]="false">Selon l’appareil</option>
            <option [ngValue]="true">Tactiles</option>
          </select>
        </label>
      </div>
      <div class="preview-viewport">
        <div class="preview-presets" role="group" aria-label="Formats d’écran">
          @for (preset of presets; track preset.name) {
            <button
              type="button"
              [attr.aria-pressed]="
                viewportWidth() === preset.width && viewportHeight() === preset.height
              "
              (click)="selectViewport(preset.width, preset.height)"
            >
              {{ preset.name }}
            </button>
          }
        </div>
        <div class="preview-dimensions">
          <label>
            Largeur (px)
            <input
              type="number"
              min="280"
              max="3840"
              step="1"
              placeholder="Auto"
              [ngModel]="viewportWidth()"
              (ngModelChange)="setWidth($event)"
            />
          </label>
          <label>
            Hauteur (px)
            <input
              type="number"
              min="280"
              max="2160"
              step="1"
              [ngModel]="viewportHeight()"
              (ngModelChange)="setHeight($event)"
            />
          </label>
        </div>
      </div>
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
      <div class="preview-stage">
        <iframe
          #frame
          [srcdoc]="document()"
          title="Aperçu interactif du module BPM"
          sandbox="allow-scripts"
          [style.width]="viewportWidth() === null ? '100%' : viewportWidth() + 'px'"
          [style.height.px]="viewportHeight()"
        ></iframe>
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
      grid-column: 1/-1;
      min-width: 0;
      margin-top: 28px;
    }
    .live-preview {
      border: 1px solid var(--line);
      border-radius: 16px;
      overflow: hidden;
      background: var(--raised-surface);
    }
    header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 12px 24px;
      padding: 24px;
    }
    h2 {
      font-size: 22px;
      margin: 0;
    }
    p,
    .preview-status {
      margin: 5px 0 0;
      font-size: 12px;
      color: var(--muted);
    }
    label {
      display: grid;
      gap: 6px;
      min-width: 0;
      font-size: 12px;
      color: var(--muted);
    }
    input,
    select,
    button {
      min-width: 0;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--raised-surface);
      color: var(--ink);
      font: inherit;
    }
    button {
      cursor: pointer;
      font-size: 12px;
    }
    button[aria-pressed='true'] {
      border-color: var(--app-accent-line, var(--ink));
      background: var(--app-accent-soft, var(--soft));
      font-weight: 650;
    }
    .preview-controls,
    .preview-viewport {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 12px;
      padding: 12px 24px;
      border-top: 1px solid var(--line);
    }
    .preview-controls label {
      flex: 1 1 145px;
    }
    .preview-controls label:first-child {
      flex: 2 1 240px;
    }
    .preview-viewport {
      justify-content: space-between;
    }
    .preview-presets,
    .preview-dimensions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .preview-dimensions input {
      width: 88px;
    }
    .preview-stage {
      background: var(--soft);
      padding: 16px;
      overflow: auto;
    }
    iframe {
      display: block;
      max-width: none;
      margin: auto;
      border: 0;
      border-radius: 10px;
      outline: 1px solid var(--line);
      background: white;
    }
    @media (max-width: 700px) {
      header,
      .preview-controls,
      .preview-viewport {
        padding-inline: 12px;
      }
      .preview-stage {
        padding: 4px;
      }
    }
  `,
})
export class NavigationLivePreview {
  readonly configuration = input.required<NavigationConfiguration>();
  readonly pages = input.required<{ link: string; label: string }[]>();
  readonly path = signal(defaultApplicationHome());
  readonly presets = VIEWPORT_PRESETS;
  readonly viewportWidth = signal<number | null>(null);
  readonly viewportHeight = signal<number>(VIEWPORT_PRESETS[0].height);
  readonly focus = signal(false);
  readonly density = signal<'comfortable' | 'compact'>('comfortable');
  readonly visualStyle = signal<'classic' | 'editorial'>('classic');
  readonly touchTargets = signal(false);
  private readonly hostDocument = inject(DOCUMENT);
  /** Nonce de la page fourni par le serveur du site (ngCspNonce) : la feuille en ligne de l'aperçu le porte. */
  private readonly nonce = inject(CSP_NONCE, { optional: true });
  private readonly sanitizer = inject(DomSanitizer);
  readonly document = signal<ReturnType<DomSanitizer['bypassSecurityTrustHtml']> | string>('');
  readonly error = signal('');
  readonly simulating = signal(false);
  async simulate() {
    if (this.simulating()) return;
    this.simulating.set(true);
    try {
      const fontStyles = await previewFonts(this.hostDocument);
      this.document.set(
        this.sanitizer.bypassSecurityTrustHtml(
          staticNavigationPreview(
            this.configuration(),
            this.path(),
            {
              focus: this.focus(),
              density: this.density(),
              visualStyle: this.visualStyle(),
              touchTargets: this.touchTargets(),
            },
            Array.from(
              this.hostDocument.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
            )
              .map((link) => link.href)
              .filter((href) => new URL(href).origin === this.hostDocument.location.origin),
            fontStyles,
            this.nonce ?? '',
          ),
        ),
      );
      this.error.set('');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Simulation impossible.');
    } finally {
      this.simulating.set(false);
    }
  }

  selectPage(path: string) {
    if (path === this.path() || !this.pages().some((page) => page.link === path)) return;
    this.path.set(path);
  }

  selectViewport(width: number | null, height: number) {
    this.viewportWidth.set(width);
    this.viewportHeight.set(height);
  }

  setWidth(width: number | null) {
    if (width === null || (Number.isInteger(width) && width >= 280 && width <= 3840)) {
      this.viewportWidth.set(width);
    }
  }

  setHeight(height: number | null) {
    if (height !== null && Number.isInteger(height) && height >= 280 && height <= 2160) {
      this.viewportHeight.set(height);
    }
  }
}
