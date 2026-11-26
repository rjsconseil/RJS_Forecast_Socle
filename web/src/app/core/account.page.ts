import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { RecetteContext } from './api.service';
import { AuthSession } from './auth-session';

/**
 * Mon compte : l'adresse e-mail et le mot de passe du profil actif. Sur le poste (mode local), c'est ainsi qu'un profil
 * existant reçoit ses identifiants avant que la connexion soit exigée ; ensuite, on y change d'identifiants (le mot de
 * passe actuel est demandé) ou on se déconnecte partout.
 */
@Component({
  selector: 'rjs-account-page',
  imports: [FormsModule],
  template: `
    <main class="account-page">
      <section class="account-card" aria-labelledby="account-title">
        <h1 id="account-title">Mon compte</h1>
        @if (!context.userId()) {
          <p class="account-lead">Choisissez d’abord votre profil.</p>
        } @else {
          <p class="account-lead">
            @if (auth.status()?.account; as a) { Profil protégé par l’adresse <strong>{{ a.email }}</strong>@if (a.role === 'admin') { · administrateur }. }
            @else { Ce profil n’a pas encore d’identifiants : donnez-lui une adresse e-mail et un mot de passe pour pouvoir vous connecter. }
          </p>
          <form (ngSubmit)="save()" #f="ngForm">
            <label>Adresse e-mail
              <input name="email" type="email" [(ngModel)]="email" required autocomplete="email" />
            </label>
            @if (auth.status()?.account) {
              <label>Mot de passe actuel
                <input name="currentPassword" type="password" [(ngModel)]="currentPassword" required autocomplete="current-password" />
              </label>
            }
            <label>{{ auth.status()?.account ? 'Nouveau mot de passe' : 'Mot de passe' }}
              <input name="password" type="password" [(ngModel)]="password" required minlength="10" autocomplete="new-password" />
              <small>Au moins 10 caractères. Il n’est jamais enregistré en clair.</small>
            </label>
            @if (message()) { <p class="account-ok" role="status">{{ message() }}</p> }
            @if (error()) { <p class="account-error" role="alert">{{ error() }}</p> }
            <button class="btn btn-primary" type="submit" [disabled]="busy() || f.invalid">Enregistrer mes identifiants</button>
          </form>
          @if (auth.status()?.account) {
            <button class="btn btn-secondary" type="button" (click)="logoutEverywhere()" [disabled]="busy()">Se déconnecter partout</button>
          }
        }
      </section>
    </main>
  `,
  styles: `
    .account-page { display: grid; place-items: center; min-height: 60vh; padding: 24px; }
    .account-card { display: grid; gap: 14px; width: 100%; max-width: 460px; box-sizing: border-box; padding: 28px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface, #fff); }
    h1 { margin: 0; font-size: 22px; }
    .account-lead { margin: 0; color: var(--muted); }
    form { display: grid; gap: 12px; }
    label { display: grid; gap: 4px; font-weight: 600; font-size: 13px; }
    input { font: inherit; font-weight: 400; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; }
    small { color: var(--muted); font-weight: 400; }
    .account-ok { margin: 0; color: var(--status-success, #1f7a4d); }
    .account-error { margin: 0; color: var(--status-danger); }
  `,
})
export class AccountPage {
  protected readonly auth = inject(AuthSession);
  protected readonly context = inject(RecetteContext);
  private readonly http = inject(HttpClient);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);
  email = this.auth.status()?.account?.email ?? '';
  password = '';
  currentPassword = '';

  constructor() {
    void this.auth.refresh().then((s) => { if (s?.account?.email && !this.email) this.email = s.account.email; });
  }

  async save() {
    await this.run(async () => {
      await firstValueFrom(this.http.post('/api/auth/credentials', { email: this.email, password: this.password, currentPassword: this.currentPassword || undefined }));
      this.password = '';
      this.currentPassword = '';
      await this.auth.refresh();
      this.message.set('Identifiants enregistrés : vous pourrez vous connecter avec cette adresse et ce mot de passe.');
    });
  }

  async logoutEverywhere() {
    await this.run(async () => {
      await this.auth.logout(true);
      this.message.set('Toutes les sessions sont fermées.');
    });
  }

  private async run(fn: () => Promise<void>) {
    this.busy.set(true);
    this.error.set(null);
    this.message.set(null);
    try {
      await fn();
    } catch (err) {
      this.error.set(err instanceof HttpErrorResponse ? err.error?.error?.message ?? 'Enregistrement impossible pour le moment.' : 'Enregistrement impossible pour le moment.');
    } finally {
      this.busy.set(false);
    }
  }
}
