import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom, tap } from 'rxjs';
import { RecetteContext } from './api.service';

/**
 * Session de connexion. Le serveur dit son mode (`/api/auth/status`) :
 * - `local` (poste de travail) : rien ne change, le profil se choisit sur le poste ;
 * - `required` (site en ligne) : le profil est celui du compte connecté (cookie de session HttpOnly, posé par le
 *   serveur, que le site ne lit jamais) ; sans session, le site mène à la page de connexion.
 */
export interface AuthStatus {
  mode: 'local' | 'required';
  user: { id: string; label: string } | null;
  account: { email: string; role: string } | null;
}
export interface RegisterInput { email: string; password: string; label: string; userType?: string; requestKey: string }

export const LOGIN_PATH = '/connexion';

@Injectable({ providedIn: 'root' })
export class AuthSession {
  private readonly http = inject(HttpClient);
  private readonly context = inject(RecetteContext);
  readonly status = signal<AuthStatus | null>(null);
  readonly required = computed(() => this.status()?.mode === 'required');
  readonly signedIn = computed(() => !!this.status()?.account);

  async refresh(): Promise<AuthStatus | null> {
    try {
      return this.apply(await firstValueFrom(this.http.get<AuthStatus>('/api/auth/status')));
    } catch {
      return this.status(); // serveur injoignable : l'état reste celui connu
    }
  }
  login(email: string, password: string) {
    return firstValueFrom(this.http.post<AuthStatus>('/api/auth/login', { email, password })).then(() => this.refresh());
  }
  register(input: RegisterInput) {
    return firstValueFrom(this.http.post('/api/auth/register', input)).then(() => this.refresh());
  }
  logout(everywhere = false) {
    return firstValueFrom(this.http.post(everywhere ? '/api/auth/logout-all' : '/api/auth/logout', {})).then(() => this.refresh());
  }

  /** Connexion exigée : le profil actif est celui du compte (jamais un profil choisi dans le navigateur). */
  private apply(status: AuthStatus) {
    this.status.set(status);
    if (status.mode === 'required') this.context.select(status.user?.id ?? null, { remember: false });
    return status;
  }
}

/** Connexion exigée et session absente ou expirée : la réponse 401 mène à la page de connexion. */
export const authRequiredInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthSession);
  const router = inject(Router);
  return next(req).pipe(tap({
    error: (err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && err.error?.error?.code === 'AUTH_REQUIRED' && !router.url.startsWith(LOGIN_PATH)) {
        void auth.refresh().then(() => router.navigate([LOGIN_PATH], { queryParams: { retour: router.url } }));
      }
    },
  }));
};
