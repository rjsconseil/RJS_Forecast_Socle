import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { pageText, registerPageTexts } from '../shared/page-text';
import { BpmProject } from './bpm.model';

const P = 'content.pages.bpm.bpm-project-switch.component.';
/** Textes du sélecteur de projet ; ils se personnalisent dans Configuration → Contenus. */
export const BPM_PROJECT_SWITCH_TEXTS: Record<string, string> = {
  label: 'Projet affiché',
  change: 'Changer de projet',
  standard: 'Projet Budget/Patrimoine standard',
  standardShort: 'Projet de vie',
  standardHelp:
    'Votre projet de vie réunit votre budget et votre patrimoine personnel. Les structures se gèrent dans Mon entreprise.',
  weekly: 'hebdo',
  monthly: 'mensuel',
  yearly: 'annuel',
  noCycle: 'sans cycle',
  due: 'à recevoir',
  starts: 'démarre le',
  upToDate: 'à jour',
};
registerPageTexts(
  Object.fromEntries(
    Object.entries(BPM_PROJECT_SWITCH_TEXTS).map(([key, value]) => [P + key, value]),
  ),
);

/** Le cadre standard reste affiché ; les budgets des autres projets se lisent dans les charges. */
@Component({
  selector: 'rjs-bpm-project-switch',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './bpm-project-switch.component.scss',
  template: `
    @if (selected()) {
      @if (embedded()) {
        <p class="bpm-project-embedded" [title]="selected()?.title">
          <small>{{ t('label') }}</small>
          <strong>{{
            selected()?.defaultForEntity ? t('standardShort') : selected()?.title
          }}</strong>
        </p>
      } @else {
        <details class="bpm-project-picker" #picker>
          <summary>
            <span
              >{{ t('label') }} · <strong>{{ selected()?.title }}</strong></span
            ><span class="bpm-picker-action">{{ t('standard') }}</span>
          </summary>
          <p>{{ t('standardHelp') }}</p>
        </details>
      }
    }
  `,
})
export class BpmProjectSwitchComponent {
  readonly embedded = input(false);
  readonly projects = input.required<readonly BpmProject[]>();
  readonly current = input.required<string>();
  protected readonly selected = computed(() =>
    this.projects().find((project) => project.id === this.current()),
  );
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly params = toSignal(this.route.queryParamMap);
  constructor() {
    effect(() => {
      const current = this.current();
      if (current && this.params()?.get('projet') !== current) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { projet: current },
          queryParamsHandling: 'merge',
          preserveFragment: true,
          replaceUrl: true,
        });
      }
    });
  }

  protected t(key: string): string {
    return pageText(P + key);
  }
}
