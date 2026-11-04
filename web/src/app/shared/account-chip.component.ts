import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * L'utilisateur connecté, toujours visible (gabarit source `utilisateurs/account-chip`) : en haut à droite
 * de la barre du site (accueil compris) et en tête du menu de gauche. Un clic mène au changement d'utilisateur.
 */
@Component({
  selector: 'rjs-account-chip',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './account-chip.component.scss',
  template: `
    <a class="account-chip" [attr.data-variant]="variant()" routerLink="/utilisateurs" [attr.aria-label]="ariaLabel()" title="Changer d’utilisateur">
      <span class="account-chip-mark" aria-hidden="true">{{ initial() }}</span>
      <span class="account-chip-text">
        @if (label()) {
          <strong>{{ label() }}</strong>
          <small>{{ typeLabel() ? typeLabel() + ' · ' : '' }}Changer d’utilisateur</small>
        } @else {
          <strong>Choisir un utilisateur</strong>
          <small>Changer d’utilisateur</small>
        }
      </span>
    </a>
  `,
})
export class AccountChipComponent {
  readonly variant = input<'topbar' | 'sidebar'>('topbar');
  readonly label = input<string | null>(null);
  readonly typeLabel = input('');
  protected readonly initial = computed(() => this.label()?.trim()[0]?.toUpperCase() ?? '·');
  protected readonly ariaLabel = computed(() => (this.label() ? `Utilisateur connecté : ${this.label()}. Changer d’utilisateur` : 'Choisir un utilisateur'));
}
