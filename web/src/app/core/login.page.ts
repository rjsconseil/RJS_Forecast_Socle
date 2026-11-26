import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { newRequestKey, UserDirectory } from './api.service';
import { AuthSession } from './auth-session';

/** Connexion et inscription (connexion exigée). Le mot de passe ne quitte le navigateur que vers l'API, jamais stocké. */
@Component({
  selector: 'rjs-login-page',
  imports: [FormsModule],
  template: `
    <main class="login-page">
      <section class="login-card" aria-labelledby="login-title">
        <h1 id="login-title">{{ mode() === 'login' ? 'Se connecter' : 'Créer un compte' }}</h1>
        <p class="login-lead">{{ mode() === 'login' ? 'Retrouvez votre projet de vie, votre budget et vos cycles.' : 'Un compte par personne : vos données restent les vôtres.' }}</p>
        <form (ngSubmit)="submit()" #f="ngForm">
          @if (mode() === 'register') {
            <label>Votre prénom ou un nom de profil
              <input name="label" [(ngModel)]="label" required maxlength="120" autocomplete="name" />
            </label>
          }
          <label>Adresse e-mail
            <input name="email" type="email" [(ngModel)]="email" required autocomplete="email" />
          </label>
          <label>Mot de passe
            <input name="password" type="password" [(ngModel)]="password" required minlength="10" [attr.autocomplete]="mode() === 'login' ? 'current-password' : 'new-password'" />
            @if (mode() === 'register') { <small>Au moins 10 caractères.</small> }
          </label>
          @if (error()) { <p class="login-error" role="alert">{{ error() }}</p> }
          <button class="btn btn-primary" type="submit" [disabled]="busy() || f.invalid">{{ mode() === 'login' ? 'Se connecter' : 'Créer mon compte' }}</button>
        </form>
        <button class="btn btn-link" type="button" (click)="toggle()">{{ mode() === 'login' ? 'Pas encore de compte ? En créer un' : 'Déjà un compte ? Se connecter' }}</button>
      </section>
    </main>
  `,
  styles: `
    .login-page { display: grid; place-items: center; min-height: 70vh; padding: var(--ecart-24, 24px); }
    .login-card { display: grid; gap: 14px; width: 100%; max-width: 440px; box-sizing: border-box; padding: 28px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface, #fff); }
    h1 { margin: 0; font-size: 22px; }
    .login-lead { margin: 0; color: var(--muted); }
    form { display: grid; gap: 12px; }
    label { display: grid; gap: 4px; font-weight: 600; font-size: 13px; }
    input { font: inherit; font-weight: 400; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; }
    small { color: var(--muted); font-weight: 400; }
    .login-error { margin: 0; color: var(--status-danger); }
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthSession);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly directory = inject(UserDirectory);
  readonly mode = signal<'login' | 'register'>('login');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  email = '';
  password = '';
  label = '';

  toggle() {
    this.mode.update((m) => (m === 'login' ? 'register' : 'login'));
    this.error.set(null);
  }

  async submit() {
    this.busy.set(true);
    this.error.set(null);
    try {
      if (this.mode() === 'login') await this.auth.login(this.email, this.password);
      else await this.auth.register({ email: this.email, password: this.password, label: this.label, requestKey: newRequestKey() });
      this.password = '';
      await this.directory.refresh();
      await this.router.navigateByUrl(this.route.snapshot.queryParamMap.get('retour') || '/');
    } catch (err) {
      this.error.set(err instanceof HttpErrorResponse ? err.error?.error?.message ?? 'Connexion impossible pour le moment.' : 'Connexion impossible pour le moment.');
    } finally {
      this.busy.set(false);
    }
  }
}
