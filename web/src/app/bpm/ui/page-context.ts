import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, convertToParamMap, Params, Router } from '@angular/router';
import { ApiError, RecetteContext, toApiError } from '../../core/api.service';

/** Version des lectures BPM : incrémentée après chaque écriture réussie pour recharger les pages affectées. */
@Injectable({ providedIn: 'root' })
export class BpmRefresh {
  readonly version = signal(0);
  bump() {
    this.version.update((v) => v + 1);
  }
}

/**
 * Contexte d'une page BPM : user actif, paramètres d'URL (période, filtres, sélection) et écriture
 * de ces paramètres sans perdre les autres. Le retour arrière retrouve donc la sélection.
 * À fournir au niveau du composant de page : `providers: [BpmPageContext]`.
 */
@Injectable()
export class BpmPageContext {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  readonly userId = inject(RecetteContext).userId;
  readonly refresh = inject(BpmRefresh);
  readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot?.queryParamMap ?? convertToParamMap({}) });
  readonly params = toSignal(this.route.paramMap, { initialValue: this.route.snapshot?.paramMap ?? convertToParamMap({}) });
  /** Ancre de l'URL (#bm-period-income…) : un lien vers un tiroir l'ouvre, comme dans la référence. */
  readonly fragment = toSignal(this.route.fragment, { initialValue: this.route.snapshot?.fragment ?? null });
  /** Période lue (clé AAAA-MM) ; absente = période courante calculée par l'API. */
  readonly period = computed(() => this.query().get('period') || undefined);

  q(name: string) {
    return computed(() => this.query().get(name) ?? '');
  }

  private pendingQuery: Params = {};

  /** Fusionne des paramètres d'URL ; `null` ou '' retire le paramètre. */
  setQuery(patch: Params, opts: { replace?: boolean } = {}) {
    const clean: Params = {};
    for (const [k, v] of Object.entries(patch)) clean[k] = v === '' || v === undefined ? null : v;
    // Plusieurs contrôles peuvent être remis à zéro dans le même geste : conserver tous les patchs.
    Object.assign(this.pendingQuery, clean);
    const next = { ...this.route.snapshot?.queryParams, ...this.pendingQuery };
    const request = this.router.navigate([], { relativeTo: this.route, queryParams: next, replaceUrl: opts.replace ?? false });
    void request.finally(() => { if (Object.entries(this.pendingQuery).every(([k, v]) => next[k] === v)) this.pendingQuery = {}; });
    return request;
  }

  /** Paramètres à transmettre à un lien de détail pour garder le contexte de lecture. */
  readonly carry = computed<Params>(() => (this.period() ? { period: this.period() } : {}));
}

export interface Loader<T> {
  readonly data: () => T | null;
  readonly error: () => ApiError | null;
  readonly loading: () => boolean;
  reload(): void;
}

/**
 * Lecture réactive protégée contre les réponses périmées : seule la réponse de la dernière
 * demande (même user, même clé, même version) est retenue. Les données précédentes restent
 * affichées pendant le rechargement. À appeler dans un contexte d'injection.
 */
export function bpmLoader<K, T>(key: () => K, fetch: (key: K) => Promise<T>): Loader<T> {
  const userId = inject(RecetteContext).userId;
  const refresh = inject(BpmRefresh);
  const data = signal<T | null>(null);
  const error = signal<ApiError | null>(null);
  const loading = signal(true);
  const manual = signal(0);
  let token = 0;
  let lastUser: string | null | undefined;
  effect(() => {
    const k = key();
    const user = userId();
    refresh.version();
    manual();
    const mine = ++token;
    untracked(() => {
      if (user !== lastUser) data.set(null); // autre user : ne jamais montrer les données du précédent
      lastUser = user;
      loading.set(true);
      error.set(null);
    });
    fetch(k).then(
      (value) => {
        if (mine !== token) return;
        data.set(value);
        loading.set(false);
      },
      (err) => {
        if (mine !== token) return;
        error.set(toApiError(err));
        loading.set(false);
      },
    );
  });
  return { data: data.asReadonly(), error: error.asReadonly(), loading: loading.asReadonly(), reload: () => manual.update((v) => v + 1) };
}

/** Clé de commande rejouable : générée une fois par brouillon (ce n'est pas un ID métier). */
export function newRequestKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Clé de période voisine (AAAA-MM). */
export function shiftPeriod(key: string, delta: number) {
  const [y, m] = key.split('-').map(Number);
  const i = y * 12 + (m - 1) + delta;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}
