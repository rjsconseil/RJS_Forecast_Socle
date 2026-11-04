import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Direction, SetupProfile } from '../../core/bpm-models';
import {
  CADENCES,
  CenterOption,
  Draft,
  LineDraft,
  addCenter,
  addGoal,
  addLine,
  addTask,
  centerDirectionChanged,
  included,
  linesOf,
  removeCenter,
  removeGoal,
  removeLine,
  removeTask,
} from './create-model';

export type CreateDetailsSection = 'tasks' | 'budget' | 'goals';

/**
 * Détail repliable de l'assistant « Partir de zéro », sur le modèle `rjs-bpm-start-details` de la référence :
 * une section par famille (tâches, revenus, charges, centres personnels, plafonds, objectifs),
 * une ligne repliable par élément et ses champs en grille.
 * Les modifications restent locales au brouillon ; `changed` demande à la page de le conserver.
 * Les saisies (input/change) remontent aussi à la page par propagation des événements.
 */
@Component({
  selector: 'bpm-create-details',
  imports: [FormsModule],
  styleUrls: ['../ref-styles/bpm-start-details.component.scss'],
  template: `
    @switch (section()) {
      @case ('tasks') {
        <section aria-labelledby="cd-tasks">
          <h3 id="cd-tasks">Tâches initiales · {{ d().tasks.length }} <span class="muted">(au moins une)</span></h3>
          @if (e('tasks')) {
            <p class="err">{{ e('tasks') }}</p>
          }
          @for (t of d().tasks; track t.uid; let i = $index) {
            <details [open]="true">
              <summary>{{ t.title.trim() || 'Tâche ' + (i + 1) }}</summary>
              <div class="start-fields">
                <label
                  >Titre
                  <input [(ngModel)]="t.title" maxlength="200" [attr.aria-invalid]="e('task.' + t.uid + '.title') ? 'true' : null" />
                  @if (e('task.' + t.uid + '.title')) {
                    <span class="err">{{ e('task.' + t.uid + '.title') }}</span>
                  }
                </label>
                <label
                  >Heures prévues (facultatif)
                  <input [(ngModel)]="t.hours" inputmode="decimal" class="num" [attr.aria-invalid]="e('task.' + t.uid + '.hours') ? 'true' : null" />
                  @if (e('task.' + t.uid + '.hours')) {
                    <span class="err">{{ e('task.' + t.uid + '.hours') }}</span>
                  }
                </label>
                <label class="wide"
                  >Description (facultative)
                  <textarea rows="2" [(ngModel)]="t.description"></textarea>
                </label>
              </div>
              @if (d().tasks.length > 1) {
                <button type="button" class="btn btn-secondary" (click)="removeTask(t.uid)" [attr.aria-label]="'Retirer la tâche ' + (i + 1)">Retirer</button>
              }
            </details>
          }
          <button type="button" class="btn btn-secondary" (click)="addTask()">Ajouter une tâche</button>
        </section>
      }

      @case ('budget') {
        @for (dir of directions; track dir.key) {
          <section [attr.aria-labelledby]="'cd-flow-' + dir.key">
            <h3 [id]="'cd-flow-' + dir.key">{{ dir.title }} · {{ linesFor(dir.key).length }}</h3>
            @for (l of linesFor(dir.key); track l.uid) {
              <details [open]="l.origin === 'user' || lineHasError(l)" [class.is-ignored]="!included(l)">
                <summary>
                  {{ l.label.trim() || '(sans libellé)' }}
                  @if (l.amount.trim()) {
                    · {{ l.amount }} €
                  }
                  @switch (l.origin) {
                    @case ('existing') {
                      <span class="status-pill" data-status="done">Enregistrée</span>
                    }
                    @case ('suggestion') {
                      <span class="status-pill" data-status="planned">{{ included(l) ? 'Suggestion retenue' : 'Suggestion : laisser vide pour ignorer' }}</span>
                    }
                    @default {
                      <span class="status-pill">Nouvelle</span>
                    }
                  }
                </summary>
                <fieldset class="start-fields">
                  <legend class="visually-hidden">{{ dir.one }} {{ l.label || '(sans libellé)' }}</legend>
                  <label
                    >Libellé
                    <input [(ngModel)]="l.label" maxlength="200" [attr.aria-invalid]="e('line.' + l.uid + '.label') ? 'true' : null" />
                    @if (e('line.' + l.uid + '.label')) {
                      <span class="err">{{ e('line.' + l.uid + '.label') }}</span>
                    }
                  </label>
                  <label
                    >Centre
                    @if (l.origin === 'existing') {
                      <input [value]="l.centerLabel ?? l.centerRef" disabled />
                    } @else {
                      <select [(ngModel)]="l.centerRef" [attr.aria-invalid]="e('line.' + l.uid + '.center') ? 'true' : null">
                        <option value="">— choisir —</option>
                        @for (c of centersFor(dir.key); track c.ref) {
                          <option [value]="c.ref">{{ c.label }}{{ c.standard ? '' : ' (personnel)' }}</option>
                        }
                      </select>
                    }
                    @if (e('line.' + l.uid + '.center')) {
                      <span class="err">{{ e('line.' + l.uid + '.center') }}</span>
                    }
                  </label>
                  <label
                    >Montant (€)
                    <input [(ngModel)]="l.amount" inputmode="decimal" class="num" [attr.aria-invalid]="e('line.' + l.uid + '.amount') ? 'true' : null" />
                    @if (e('line.' + l.uid + '.amount')) {
                      <span class="err">{{ e('line.' + l.uid + '.amount') }}</span>
                    }
                  </label>
                  <label
                    >Rythme
                    <select [(ngModel)]="l.cadence" [disabled]="l.origin === 'existing'">
                      @for (c of cadences; track c.key) {
                        @if (c.key !== 'once' || l.origin !== 'existing') {
                          <option [value]="c.key">{{ c.label }}</option>
                        }
                      }
                    </select>
                  </label>
                  <label
                    >{{ l.cadence === 'once' ? 'Date' : 'Première date' }}
                    <input type="date" [(ngModel)]="l.firstDate" [disabled]="l.origin === 'existing'" [attr.aria-invalid]="e('line.' + l.uid + '.firstDate') ? 'true' : null" />
                    @if (e('line.' + l.uid + '.firstDate')) {
                      <span class="err">{{ e('line.' + l.uid + '.firstDate') }}</span>
                    }
                  </label>
                  @if (l.cadence !== 'once') {
                    <label
                      >Fin de récurrence, facultative
                      <input type="date" [(ngModel)]="l.endDate" [attr.aria-invalid]="e('line.' + l.uid + '.endDate') ? 'true' : null" />
                      @if (e('line.' + l.uid + '.endDate')) {
                        <span class="err">{{ e('line.' + l.uid + '.endDate') }}</span>
                      }
                    </label>
                  }
                </fieldset>
                @if (l.origin !== 'existing') {
                  <button type="button" class="btn btn-secondary" (click)="removeLine(l.uid)" [attr.aria-label]="'Retirer la ligne ' + (l.label || 'sans libellé')">Retirer cette proposition</button>
                }
              </details>
            } @empty {
              <p class="muted">Aucune ligne.</p>
            }
            <button type="button" class="btn btn-secondary" (click)="addLine(dir.key)">{{ dir.add }}</button>
          </section>
        }

        <section aria-labelledby="cd-centers">
          <h3 id="cd-centers">Centres personnels · {{ d().centers.length }}</h3>
          <p class="muted">Un centre personnel est propre à votre user ; il n'est pas ajouté au catalogue des autres users. Il est créé à la confirmation.</p>
          @for (c of d().centers; track c.tempRef) {
            <details [open]="true">
              <summary>{{ c.label.trim() || 'Nouveau centre (sans nom)' }} · {{ c.direction === 'income' ? 'revenus' : 'charges' }}</summary>
              <div class="start-fields">
                <label
                  >Nom du centre
                  <input [(ngModel)]="c.label" maxlength="120" [attr.aria-invalid]="e('center.' + c.tempRef + '.label') ? 'true' : null" />
                  @if (e('center.' + c.tempRef + '.label')) {
                    <span class="err">{{ e('center.' + c.tempRef + '.label') }}</span>
                  }
                </label>
                <label
                  >Concerne
                  <select [(ngModel)]="c.direction" (ngModelChange)="directionChanged(c.tempRef)">
                    <option value="income">Revenus</option>
                    <option value="charge">Charges</option>
                  </select>
                </label>
              </div>
              <button type="button" class="btn btn-secondary" (click)="removeCenter(c.tempRef)" [attr.aria-label]="'Retirer le centre ' + (c.label || 'sans nom')">Retirer</button>
            </details>
          }
          <button type="button" class="btn btn-secondary" (click)="addCenter()">Ajouter un centre personnel</button>
        </section>

        @if (d().mode === 'principal') {
          <section aria-labelledby="cd-caps">
            <h3 id="cd-caps">Plafonds par centre de charge <span class="muted">(facultatifs)</span></h3>
            <details>
              <summary>Plafonds · {{ capCount() }} renseigné(s)</summary>
              <p class="muted">Plafond de dépense par période pour le Budget du projet de vie. Laisser vide : pas de plafond.</p>
              <div class="start-fields">
                @for (c of centersFor('charge'); track c.ref) {
                  <label
                    >{{ c.label }} — plafond (€)
                    <input [ngModel]="d().caps[c.ref] ?? ''" (ngModelChange)="d().caps[c.ref] = $event" inputmode="decimal" class="num" [attr.aria-invalid]="e('cap.' + c.ref) ? 'true' : null" />
                    @if (e('cap.' + c.ref)) {
                      <span class="err">{{ e('cap.' + c.ref) }}</span>
                    }
                  </label>
                }
              </div>
            </details>
          </section>
        }
      }

      @case ('goals') {
        <section aria-labelledby="cd-goals">
          <h3 id="cd-goals">Objectifs datés · {{ d().goals.length }}</h3>
          @for (g of d().goals; track g.uid; let i = $index) {
            <details [open]="!g.goalId || goalHasError(g.uid)">
              <summary>
                {{ g.label.trim() || 'Objectif ' + (i + 1) }}
                @if (g.amount.trim()) {
                  · {{ g.amount }} €
                }
                @if (g.goalId) {
                  <span class="status-pill" data-status="done">Enregistré</span>
                } @else {
                  <span class="status-pill">Nouveau</span>
                }
              </summary>
              <fieldset class="start-fields">
                <legend class="visually-hidden">Objectif {{ i + 1 }}</legend>
                <label
                  >Objectif
                  <input [(ngModel)]="g.label" maxlength="200" [attr.aria-invalid]="e('goal.' + g.uid + '.label') ? 'true' : null" />
                  @if (e('goal.' + g.uid + '.label')) {
                    <span class="err">{{ e('goal.' + g.uid + '.label') }}</span>
                  }
                </label>
                <label
                  >Type
                  <select [(ngModel)]="g.type" [attr.aria-invalid]="e('goal.' + g.uid + '.type') ? 'true' : null">
                    <option value="">— choisir —</option>
                    @for (t of goalTypes(); track t.key) {
                      <option [value]="t.key">{{ t.label }}</option>
                    }
                  </select>
                  @if (e('goal.' + g.uid + '.type')) {
                    <span class="err">{{ e('goal.' + g.uid + '.type') }}</span>
                  }
                </label>
                <label
                  >Montant (€ d'aujourd'hui)
                  <input [(ngModel)]="g.amount" inputmode="decimal" class="num" [attr.aria-invalid]="e('goal.' + g.uid + '.amount') ? 'true' : null" />
                  @if (e('goal.' + g.uid + '.amount')) {
                    <span class="err">{{ e('goal.' + g.uid + '.amount') }}</span>
                  }
                </label>
                <label
                  >Date visée
                  <input type="date" [(ngModel)]="g.date" [attr.aria-invalid]="e('goal.' + g.uid + '.date') ? 'true' : null" />
                  @if (e('goal.' + g.uid + '.date')) {
                    <span class="err">{{ e('goal.' + g.uid + '.date') }}</span>
                  }
                </label>
              </fieldset>
              @if (!g.goalId) {
                <button type="button" class="btn btn-secondary" (click)="removeGoal(g.uid)" [attr.aria-label]="'Retirer l\\'objectif ' + (i + 1)">Retirer cette proposition</button>
              }
            </details>
          } @empty {
            <p class="muted">Aucun objectif pour l'instant.</p>
          }
          <button type="button" class="btn btn-secondary" (click)="addGoal()">Ajouter un objectif</button>
          <p class="muted">Le retrait d'un objectif enregistré se fait depuis « Objectifs et avenir ».</p>
        </section>
      }
    }
  `,
  styles: `
    /* Compléments absents de la feuille source : messages d'erreur, pastilles dans le résumé, fieldset neutre. */
    .err { color: var(--status-danger); font-weight: 400; }
    p { margin: 0; }
    summary .status-pill { margin-inline-start: var(--ecart-8); vertical-align: middle; }
    details > .btn { justify-self: start; }
    details[open] { display: grid; gap: var(--ecart-8); }
    details.is-ignored { border-style: dashed; }
    fieldset.start-fields { margin: 0; border: 0; padding-inline: 0; min-width: 0; }
    .start-fields .wide { grid-column: 1 / -1; }
  `,
})
export class BpmCreateDetails {
  readonly draft = input.required<Draft>();
  readonly section = input.required<CreateDetailsSection>();
  /** Message d'erreur affiché pour une clé de champ (saisie ou réponse serveur), sinon null. */
  readonly errorOf = input.required<(key: string) => string | null>();
  readonly centers = input<CenterOption[]>([]);
  readonly goalTypes = input<SetupProfile['goalTypes']>([]);
  readonly changed = output<void>();

  protected readonly cadences = CADENCES;
  protected readonly directions: { key: Direction; title: string; add: string; one: string }[] = [
    { key: 'income', title: 'Revenus', add: 'Ajouter un revenu', one: 'Revenu' },
    { key: 'charge', title: 'Charges', add: 'Ajouter une charge', one: 'Charge' },
  ];
  protected readonly included = included;

  protected d = computed(() => this.draft());
  protected capCount = computed(() => Object.values(this.draft().caps).filter((v) => (v ?? '').trim() !== '').length);

  protected e(key: string) {
    return this.errorOf()(key);
  }
  protected centersFor(dir: Direction) {
    return this.centers().filter((c) => c.direction === dir);
  }
  protected linesFor(dir: Direction) {
    return linesOf(this.draft()).filter((l) => l.direction === dir);
  }
  protected lineHasError(l: LineDraft) {
    return ['label', 'center', 'amount', 'firstDate', 'endDate'].some((f) => !!this.e('line.' + l.uid + '.' + f));
  }
  protected goalHasError(id: string) {
    return ['label', 'type', 'amount', 'date'].some((f) => !!this.e('goal.' + id + '.' + f));
  }

  protected addTask() {
    addTask(this.draft());
    this.changed.emit();
  }
  protected removeTask(id: string) {
    removeTask(this.draft(), id);
    this.changed.emit();
  }
  protected addLine(direction: Direction) {
    addLine(this.draft(), direction);
    this.changed.emit();
  }
  protected removeLine(id: string) {
    removeLine(this.draft(), id);
    this.changed.emit();
  }
  protected addCenter() {
    addCenter(this.draft());
    this.changed.emit();
  }
  protected removeCenter(tempRef: string) {
    removeCenter(this.draft(), tempRef);
    this.changed.emit();
  }
  protected directionChanged(tempRef: string) {
    centerDirectionChanged(this.draft(), tempRef);
  }
  protected addGoal() {
    addGoal(this.draft());
    this.changed.emit();
  }
  protected removeGoal(id: string) {
    removeGoal(this.draft(), id);
    this.changed.emit();
  }
}
