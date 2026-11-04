import { pageText, registerPageTexts } from './page-text';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
const P = 'content.pages.shared.parameter-choice.component.';
export const PARAMETER_CHOICE_TEXTS = {
  choose: 'Choisir un poste', standard: 'Propositions standard', custom: 'Propositions personnalisées',
  customize: '+ Personnaliser', newChoice: 'Nouveau choix', useChoice: 'Utiliser ce choix',
};
registerPageTexts(Object.fromEntries(Object.entries(PARAMETER_CHOICE_TEXTS).map(([key,value])=>[P+key,value])));
/** Un même choix contrôlé : catalogue livré et propositions personnalisées, sans confondre saisie et enregistrement. */
@Component({
  selector: 'rjs-parameter-choice',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="parameter-choice">
      <select [compareWith]="sameChoice" [ngModel]="value()" (ngModelChange)="valueChange.emit($event)" [ngModelOptions]="{standalone: true}"
        [attr.aria-label]="label()" required>
        <option value="">{{t('choose')}}</option>
        <optgroup [label]="t('standard')">
          @for (option of catalog().standard; track option) { <option [value]="option">{{ option }}</option> }
        </optgroup>
        <optgroup [label]="t('custom')">
          @for (option of custom(); track option) { <option [value]="option">{{ option }}</option> }
        </optgroup>
      </select>
    </div>
  `,
  styles: `:host { display:block; min-width:0; } .parameter-choice { display:grid; gap:var(--ecart-6); }
    select,input { min-width:0; width:var(--part-100); min-height:var(--dim-44); }
`,
})
export class ParameterChoiceComponent {
  protected readonly sameChoice = (a:string,b:string) => (a ?? '').trim().normalize('NFKC').toLocaleLowerCase('fr') === (b ?? '').trim().normalize('NFKC').toLocaleLowerCase('fr');
  readonly value = input('');
  readonly valueChange = output<string>();
  readonly label = input.required<string>();
  readonly catalog = input<{standard:string[];custom:string[]}>({standard:[],custom:[]});
  readonly extra = input<string[]>([]);
  protected readonly custom = computed(() => {
    const key = (s:string) => s.trim().normalize('NFKC').toLocaleLowerCase('fr');
    const seen = new Set(this.catalog().standard.map(key));
    return [...this.catalog().custom,...this.extra(),this.value()].filter(v=>{
      if (!v.trim() || seen.has(key(v))) return false;
      seen.add(key(v)); return true;
    }).sort((a,b)=>a.localeCompare(b,'fr'));
  });
  protected t(key:string): string { return pageText(P+key); }
}
