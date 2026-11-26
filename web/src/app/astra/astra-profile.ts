import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RecetteContext, UserDirectory } from '../core/api.service';

@Component({
  selector: 'astra-profile-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './astra-profile.html',
})
export class AstraProfilePicker {
  private readonly user = inject(RecetteContext);
  protected readonly profiles = inject(UserDirectory).users;
  protected readonly selectedProfile = signal('');

  protected openProfile(): void {
    const id = this.selectedProfile();
    if (this.profiles().some(profile => profile.id === id)) this.user.select(id);
  }
}
