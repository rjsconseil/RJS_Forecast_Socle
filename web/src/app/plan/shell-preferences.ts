import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { RecetteContext } from '../core/api.service';
import { locate } from './site-plan';

/** Une page épinglée : son adresse (sans la lecture en cours) et le nom affiché au moment de l'épingler. */
export interface PinnedPage {
  link: string;
  label: string;
  /** Zone et section d'origine, pour situer l'épingle sans relire le plan. */
  hint: string;
}
export const PIN_LIMIT = 12;
const pinPath = (url: string) => url.split(/[?#]/)[0].replace(/\/+$/, '') || '/';

export function togglePin(pins: PinnedPage[], pin: PinnedPage): PinnedPage[] {
  return pins.some((entry) => entry.link === pin.link) ? pins.filter((entry) => entry.link !== pin.link) : [...pins, pin].slice(-PIN_LIMIT);
}
const validPins = (value: unknown): PinnedPage[] =>
  Array.isArray(value)
    ? value
        .filter((entry): entry is PinnedPage => !!entry && typeof entry.link === 'string' && entry.link.startsWith('/') && !entry.link.startsWith('//') && typeof entry.label === 'string' && typeof entry.hint === 'string')
        .filter((entry) => !!locate(entry.link).zone)
        .slice(-PIN_LIMIT)
    : [];

/**
 * Les pages épinglées, par utilisateur actif : préférence locale du navigateur, comme le style de
 * l'interface. Une épingle garde l'adresse d'une page du plan (fiche comprise), jamais une saisie.
 */
@Injectable({ providedIn: 'root' })
export class PinnedPages {
  private readonly user = inject(RecetteContext).userId;
  private readonly items = signal<PinnedPage[]>(this.read());
  readonly pins = this.items.asReadonly();

  constructor() {
    // Changer d'utilisateur change de liste, comme le parcours.
    effect(() => {
      this.user();
      untracked(() => this.items.set(this.read()));
    });
  }

  has(url: string): boolean {
    const link = pinPath(url);
    return this.items().some((entry) => entry.link === link);
  }
  toggle(url: string, label: string, hint: string): boolean {
    const link = pinPath(url);
    this.items.update((pins) => togglePin(pins, { link, label, hint }));
    this.write();
    return this.has(link);
  }
  remove(link: string): void {
    this.items.update((pins) => pins.filter((entry) => entry.link !== link));
    this.write();
  }
  /** Une fiche épinglée avant d'être nommée reprend son nom dès que la page le publie. */
  rename(url: string, label: string): void {
    const link = pinPath(url);
    if (!this.items().some((entry) => entry.link === link && entry.label !== label)) return;
    this.items.update((pins) => pins.map((entry) => (entry.link === link ? { ...entry, label } : entry)));
    this.write();
  }

  private key() {
    return `rjs-pins:${this.user() ?? 'anonymous'}`;
  }
  private read(): PinnedPage[] {
    try {
      return validPins(JSON.parse(localStorage.getItem(this.key()) ?? 'null'));
    } catch {
      return [];
    }
  }
  private write() {
    try {
      localStorage.setItem(this.key(), JSON.stringify(this.items()));
    } catch {
      /* Les épingles restent en mémoire pour cette séance. */
    }
  }
}

export type ShellDensity = 'comfortable' | 'compact';
interface StoredShell {
  focus?: boolean;
  density?: ShellDensity;
  keys?: boolean;
}

/**
 * Préférences du cadre, propres au navigateur : menu masqué (mode concentré), densité d'affichage
 * et raccourcis à une touche. Elles ne touchent aucune donnée du site.
 */
@Injectable({ providedIn: 'root' })
export class ShellPreferences {
  private static readonly key = 'rjs-forecast-shell';
  private readonly stored = signal<StoredShell>(ShellPreferences.read());
  /** Le menu latéral est masqué : la page prend toute la largeur. */
  readonly focus = computed(() => !!this.stored().focus);
  readonly density = computed<ShellDensity>(() => (this.stored().density === 'compact' ? 'compact' : 'comfortable'));
  /** Raccourcis à une touche (désactivables : une frappe hors d'un champ ne doit jamais surprendre). */
  readonly singleKeys = computed(() => this.stored().keys !== false);

  toggleFocus() {
    this.patch({ focus: !this.focus() });
  }
  setDensity(density: ShellDensity) {
    this.patch({ density });
  }
  setSingleKeys(keys: boolean) {
    this.patch({ keys });
  }

  private patch(change: StoredShell) {
    this.stored.update((value) => ({ ...value, ...change }));
    try {
      localStorage.setItem(ShellPreferences.key, JSON.stringify(this.stored()));
    } catch {
      /* Le choix vaut pour cette séance. */
    }
  }
  private static read(): StoredShell {
    try {
      const value = JSON.parse(localStorage.getItem(ShellPreferences.key) ?? 'null');
      return value && typeof value === 'object' && !Array.isArray(value) ? (value as StoredShell) : {};
    } catch {
      return {};
    }
  }
}
