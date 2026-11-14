import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, firstValueFrom, map } from 'rxjs';
import { NavigationConfiguration, NavigationContext, NavigationEntry, NavigationNode, effectiveLabel } from './navigation-model';
export interface NavigationCatalog {
  entries: NavigationEntry[];
  /** Les liens rangés par partie du site (accueil, puis chaque module) et par niveau. */
  tree: NavigationNode[];
  modules: { id: string; label: string }[];
  context(url: string): NavigationContext;
}
export const NAVIGATION_CATALOG = new InjectionToken<NavigationCatalog>('Navigation catalog', { providedIn: 'root', factory: () => ({ entries: [], tree: [], modules: [], context: url => ({ page: url.split(/[?#]/)[0] }) }) });
interface Parameter { value: NavigationConfiguration; revision: number }
@Injectable({ providedIn: 'root' })
export class NavigationSystem {
  readonly catalog = inject(NAVIGATION_CATALOG);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  /** Adresse courante, partagée : libellés et styles se recalculent à chaque navigation aboutie. */
  readonly url = toSignal(this.router.events.pipe(filter(e => e instanceof NavigationEnd), map(e => e.urlAfterRedirects)), { initialValue: this.router.url });
  readonly configuration = signal<NavigationConfiguration>({ version: 1, scopes: {} });
  readonly error = signal('');
  readonly ready = signal(false);
  private revision = 0;
  private readonly endpoint = '/api/navigation/settings';
  constructor() { void this.reload(); }
  async reload() {
    try {
      const result = await firstValueFrom(this.http.get<Parameter>(this.endpoint));
      this.configuration.set(result.value); this.revision = result.revision; this.error.set(''); this.ready.set(true);
    } catch { this.error.set('Les réglages de navigation ne sont pas disponibles. Les valeurs par défaut restent utilisables.'); }
  }
  async save(value: NavigationConfiguration) {
    const result = await firstValueFrom(this.http.put<{ parameter: Parameter }>(this.endpoint, { value, expectedRevision: this.revision }));
    this.configuration.set(result.parameter.value); this.revision = result.parameter.revision;
  }
  label(key: string, fallback: string, url: string) {
    const path = key.split(/[?#]/)[0];
    const entry = this.catalog.entries.find(e => e.key === key)
      ?? this.catalog.entries.find(e => e.key === path)
      ?? this.catalog.entries.find(e => e.link === path)
      ?? this.catalog.entries.find(e => e.key === this.catalog.context(path).page);
    return effectiveLabel(this.configuration(), this.catalog.context(url), entry?.key ?? key, fallback);
  }
}
