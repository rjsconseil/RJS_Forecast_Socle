import { Component, computed, DestroyRef, inject, input, output } from '@angular/core';
import { BpmApi } from '../../core/bpm-api.service';
import { BpmBudgetRef, EntryInput } from '../../core/bpm-models';
import { ModalComponent } from '../../shared/modal.component';
import { BpmOperationEditor } from './operation-editor';
import { BpmPageContext, bpmLoader } from './page-context';
import { BpmState } from './state';

/** L'ouverture de l'éditeur fait partie du parcours : une adresse suffit pour le reprendre. */
@Component({
  selector: 'bpm-entry-flow',
  imports: [BpmOperationEditor, BpmState, ModalComponent],
  template: `
    @if (id() && budgets().length) {
      @if (id() === 'new' || selectedLine()) {
        <bpm-operation-editor
          [budgets]="budgets()"
          [line]="selectedLine()"
          [defaults]="defaults()"
          [taskFundingRequired]="taskFundingRequired()"
          (closed)="close()"
          (saved)="complete($event)"
        />
      } @else {
        <rjs-modal [open]="true" [headed]="true" title="Reprendre l’opération" (closed)="close()">
          <bpm-state [loading]="line.loading()" [error]="line.error()" (retry)="line.reload()" />
          @if (!line.loading() && line.data()?.line?.id === id() && !selectedLine()) {
            <p class="bpm-error" role="alert">Cette opération appartient à un autre projet. Revenez au projet concerné pour la modifier.</p>
            <button type="button" class="btn btn-secondary" (click)="close()">Fermer</button>
          }
        </rjs-modal>
      }
    }
  `,
})
export class BpmEntryFlow {
  private destroy = inject(DestroyRef);
  private ctx = inject(BpmPageContext);
  private api = inject(BpmApi);
  readonly budgets = input.required<BpmBudgetRef[]>();
  readonly defaults = input<Partial<EntryInput>>({});
  readonly taskFundingRequired = input(false);
  /** Paramètres d'adresse qui accompagnent la saisie (tâche, sens…) : ils partent avec elle. */
  readonly clearOnClose = input<string[]>([]);
  readonly saved = output<string>();
  protected id = computed(() => this.ctx.query().get('entry'));
  protected line = bpmLoader(
    () => this.id(),
    (id) => (id && id !== 'new' ? this.api.line(id, this.ctx.period()) : Promise.resolve(null)),
  );
  protected selectedLine = computed(() =>
    this.id() !== 'new' && this.line.data()?.line.id === this.id() && this.budgets().some(b => b.id === this.line.data()?.line.budgetId) ? this.line.data()!.line : null,
  );
  protected close() {
    const extra = Object.fromEntries(this.clearOnClose().map((name) => [name, null]));
    return this.ctx.setQuery({ ...extra, entry: null }, { replace: true });
  }
  protected async complete(message: string) {
    await this.close();
    if (!this.destroy.destroyed) this.saved.emit(message);
  }
}
