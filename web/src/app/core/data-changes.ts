import { HttpContextToken, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';
import { tap } from 'rxjs';
import { RecetteContext } from './api.service';

/**
 * Changements de données du site. Une version avance :
 * - après chaque écriture réussie de cet onglet vers l'API (hors aperçus, qui ne font que lire, et hors
 *   écritures « silencieuses » comme des préférences d'affichage déjà appliquées à l'écran) ;
 * - quand le serveur annonce une écriture faite ailleurs (autre onglet, autre appareil), par son flux
 *   `/api/changes` (Server-Sent Events).
 * Un composant qui affiche des données lues (le calendrier, par exemple) suit cette version et se relit,
 * sans connaître la page, l'application ni l'appareil qui a écrit.
 */

/** Écriture qui ne change pas les données lues (préférences) : elle n'avance pas la version de cet onglet. */
export const SILENT_WRITE = new HttpContextToken<boolean>(() => false);

/** Identifiant de cet onglet : le serveur le renvoie avec chaque changement, pour ne pas se relire soi-même. */
export const CLIENT_ID = (() => {
  const c = globalThis.crypto as Crypto | undefined;
  return c?.randomUUID ? c.randomUUID() : `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
})();

export interface ServerChange {
  revision: number;
  userId: string | null;
  clientId: string | null;
  module?: string;
}

@Injectable({ providedIn: 'root' })
export class DataChanges {
  readonly version = signal(0);
  /** Dernière origine d'un changement (adresse écrite ou module annoncé), utile au diagnostic. */
  readonly lastWrite = signal<string | null>(null);
  /** Le flux du serveur est ouvert (les écritures faites ailleurs arrivent sans attendre). */
  readonly live = signal(false);
  private source: EventSource | null = null;
  private knownRevision: number | null = null;

  constructor() {
    const context = inject(RecetteContext, { optional: true });
    if (context && typeof EventSource !== 'undefined') {
      effect(() => this.listen(context.userId()));
      inject(DestroyRef).onDestroy(() => this.close());
    }
  }

  bump(origin: string | null = null) {
    this.lastWrite.set(origin);
    this.version.update((v) => v + 1);
  }

  /** Reçoit une annonce du serveur : une écriture d'un autre onglet (ou d'un autre appareil) relit l'écran. */
  receive(change: ServerChange) {
    if (typeof change.revision === 'number') this.knownRevision = change.revision;
    if (change.clientId !== CLIENT_ID) this.bump(`flux:${change.module ?? 'serveur'}`);
  }

  /** Reconnexion : si le stockage a avancé pendant la coupure, l'écran se relit. */
  reconnected(revision: number) {
    if (this.knownRevision !== null && revision !== this.knownRevision) this.bump('flux:reprise');
    this.knownRevision = revision;
  }

  private listen(userId: string | null) {
    this.close();
    const source = new EventSource(`/api/changes${userId ? `?user=${encodeURIComponent(userId)}` : ''}`);
    this.source = source;
    source.addEventListener('ready', (e) => {
      this.live.set(true);
      try { this.reconnected(JSON.parse((e as MessageEvent).data).revision); } catch { /* annonce illisible : ignorée */ }
    });
    source.addEventListener('change', (e) => {
      try { this.receive(JSON.parse((e as MessageEvent).data)); } catch { /* annonce illisible : ignorée */ }
    });
    source.onerror = () => this.live.set(false);
  }

  private close() {
    this.source?.close();
    this.source = null;
    this.live.set(false);
  }
}

/** Une commande « aperçu » (`…/preview`) calcule sans écrire : elle ne compte pas comme un changement. */
export const isApiWrite = (method: string, url: string) =>
  method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && url.startsWith('/api/') && !/\/preview(?:$|\?)/.test(url);

export const dataChangesInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/')) return next(req);
  const tagged = req.clone({ setHeaders: { 'x-client-id': CLIENT_ID } });
  if (!isApiWrite(req.method, req.url) || req.context.get(SILENT_WRITE)) return next(tagged);
  const changes = inject(DataChanges);
  return next(tagged).pipe(tap((event) => { if (event instanceof HttpResponse && event.ok) changes.bump(req.url); }));
};
