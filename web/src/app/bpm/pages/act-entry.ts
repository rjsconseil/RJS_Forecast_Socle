import { Component, computed, input, linkedSignal, output, signal } from '@angular/core';
import { BpmBudgetRef, Direction, EntryInput } from '../../core/bpm-models';

/**
 * Saisie des flux de Ce qu'il faut faire, sur le poste de saisie de la référence (`rjs-bpm-flow-editor`,
 * `.fe-panel`) : 01 choisir le projet, 02 le sens de l'opération, 03 vérifier et enregistrer. Le
 * formulaire lui-même est l'éditeur d'opération partagé (fenêtre), ouvert prérempli avec ces choix ;
 * son aperçu est calculé sans écriture et seul « Enregistrer » crée l'opération.
 */
@Component({
  selector: 'bpm-act-entry',
  styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-vision.page.scss', '../ref-styles/bpm-flow-editor.component.scss'],
  template: `
    <section id="saisie-des-flux" class="fe-panel" data-bpm-frame="form" aria-labelledby="fe-title">
      <header class="fe-heading">
        @if (owner()) { <span class="fe-eyebrow">{{ owner() }}</span> }
        <h2 id="fe-title">Saisir une entrée ou une charge</h2>
        <p>Une date, un montant, un poste. Voyez l’effet avant d’enregistrer.</p>
      </header>
      <div class="fe-workspace">
        <aside class="fe-context">
          <h3 class="fe-section-title"><span>01</span>Choisir le projet</h3>
          <div class="fe-scopes" role="group" aria-label="Cadre de la saisie">
            <button type="button" [class.is-selected]="scope() === 'life'" [attr.aria-pressed]="scope() === 'life'" [disabled]="!life()" (click)="scope.set('life')">
              <strong>Mon projet de vie</strong><span>Revenus et charges du quotidien.</span>
            </button>
            <button type="button" [class.is-selected]="scope() === 'projects'" [attr.aria-pressed]="scope() === 'projects'" [disabled]="!projects().length" (click)="scope.set('projects')">
              <strong>Mes projets de la vie</strong><span>Entrées et charges liées à un projet.</span>
            </button>
          </div>
          @if (scope() === 'projects' && projects().length) {
            <div class="fe-selectors">
              <label
                >Projet concerné
                <select [value]="projectId()" (change)="projectId.set($any($event.target).value)">
                  @for (b of projects(); track b.id) {
                    <option [value]="b.id" [selected]="b.id === projectId()">{{ b.name }}</option>
                  }
                </select>
              </label>
            </div>
          }
        </aside>
        <div class="fe-form">
          <h3 class="fe-section-title"><span>02</span>Renseigner l’opération</h3>
          <div class="fe-controls">
            <div class="bp-toggle" role="radiogroup" aria-label="Sens de l’opération">
              <label [class.is-selected]="direction() === 'income'"
                ><input type="radio" name="fe-kind" value="income" [checked]="direction() === 'income'" (change)="direction.set('income')" />↑ Entrée</label
              ><label [class.is-selected]="direction() === 'charge'"
                ><input type="radio" name="fe-kind" value="charge" [checked]="direction() === 'charge'" (change)="direction.set('charge')" />↓ Charge</label
              >
            </div>
          </div>
          <p class="fe-schedule-note">
            Libellé, montant, poste, date et récurrence (ponctuelle, hebdomadaire, mensuelle, annuelle) se renseignent dans l’éditeur
            d’opération partagé, avec une fin et une note facultatives.
            <span>La modification d’une opération existante, depuis son détail, conserve son identité.</span>
          </p>
          <section class="fe-impact" aria-labelledby="fe-impact-title">
            <h3 id="fe-impact-title" class="fe-section-title"><span>03</span>Vérifier &amp; enregistrer</h3>
            <p>L’éditeur compare avant / après le solde prévu de la période et le patrimoine estimé lorsque le stock est connu (« À renseigner » sinon).</p>
            <p class="fe-impact-rule">L’aperçu est calculé sans aucune écriture ; seul « Enregistrer » crée l’opération.</p>
          </section>
          <div class="fe-save">
            <button type="button" class="btn btn-primary" (click)="open()" [disabled]="disabled() || !target()">Renseigner l’opération →</button>
          </div>
          <p class="fe-explanation">Une opération ne devient jamais une tâche, et le temps d’une tâche ne crée aucune allocation financière.</p>
        </div>
      </div>
    </section>
  `,
  styles: `
    :host { margin-block: 0; }
  `,
})
export class BpmActEntry {
  readonly disabled = input(false);
  /** Budgets du user (contexte de lecture) : le projet de vie et les projets de la vie budgétisés. */
  readonly budgets = input<BpmBudgetRef[]>([]);
  /** Libellé du user, en surtitre comme dans la référence. */
  readonly owner = input<string | null>(null);
  /** Ouvre l'éditeur partagé prérempli (Budget cible et sens) ; rien n'est écrit ici. */
  readonly create = output<Partial<EntryInput>>();

  protected life = computed(() => this.budgets().find((b) => b.role === 'life') ?? null);
  protected projects = computed(() => this.budgets().filter((b) => b.role !== 'life'));
  protected scope = signal<'life' | 'projects'>('life');
  protected projectId = linkedSignal(() => this.projects()[0]?.id ?? '');
  protected direction = signal<Direction>('charge');
  protected target = computed(() => (this.scope() === 'life' ? (this.life()?.id ?? this.budgets()[0]?.id ?? null) : this.projectId() || null));

  protected open() {
    const budgetId = this.target();
    if (!budgetId) return;
    this.create.emit({ budgetId, direction: this.direction() });
  }
}
