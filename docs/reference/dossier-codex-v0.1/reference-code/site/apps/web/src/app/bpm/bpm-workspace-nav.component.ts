import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { pageText, registerPageTexts } from '../shared/page-text';
import { ModalComponent } from '../shared/modal.component';
import { formatMoney } from '../shared/amount';
import { BpmProject } from './bpm.model';
import { BpmStore } from './bpm.store';
import { guidanceOf } from './bpm-guidance.model';

const P = 'content.pages.bpm.bpm-workspace-nav.';
export const BPM_WORKSPACE_NAV_TEXTS: Record<string, string> = {
  dashboard: 'Tableau de bord',
  pilot: 'Piloter la période',
  money: 'Tableau de bord',
  vision: 'Objectifs & avenir',
  help: 'Que faire maintenant ?',
  close: 'Revenir à ma page',
  real: 'Solde réalisé',
  expected: 'Solde attendu à la clôture',
  wealth: 'Patrimoine connu',
  unknown: 'À compléter',
  reading: 'Comment lire ces montants ?',
  readingHelp:
    'Réalisé : entrées reçues et sorties payées. Attendu : le réalisé plus les échéances encore prévues. Le patrimoine inclut les périodes déjà clôturées.',
  next: 'Votre prochaine étape',
  wealthCap: 'Choisir la suite du patrimoine',
  wealthCapHelp: 'Votre cap patrimonial est atteint. Choisissez un nouveau dépassement fixe ou ouvrez la phase d’allocation.',
  cycle: 'Vérifier le cycle',
  cycleHelp:
    'La liaison standard devrait être préparée avec l’utilisateur. Vérifiez le projet sélectionné ou relisez ses données.',
  paused: 'Relire le cycle suspendu',
  pausedHelp:
    'Les prochaines clôtures de ce budget sont suspendues. Patrimoine et clôtures passées sont conservés ; voyez le cycle pour reprendre.',
  valuation: 'Compléter votre patrimoine',
  valuationHelp:
    'Une valeur est manquante : une projection ne peut pas indiquer un capital fiable. Renseignez les actifs dans le parcours patrimonial.',
  setup: 'Décrire votre période habituelle',
  setupHelp:
    'Commencez par les salaires et les charges régulières. Les courses peuvent revenir chaque semaine même si le budget se clôture chaque mois.',
  point: 'Vérifier les échéances arrivées',
  pointHelp:
    'Les entrées et dépenses approuvées sont enregistrées automatiquement à leur échéance.',
  goal: 'Donner un but à votre épargne',
  goalHelp:
    'Ajoutez un premier objectif : des études ou un achat à financer, une réserve ou une transmission à conserver.',
  deficit: 'Préparer un prélèvement sur votre patrimoine',
  deficitHelp:
    'Déficit attendu : vérifiez les dépenses prévues et les recettes manquantes. Seul le réalisé sera prélevé à la clôture.',
  ready: 'Relire vos objectifs et vos hypothèses',
  readyHelp:
    'Les échéances arrivées sont enregistrées. Vous pouvez ajuster vos objectifs et vérifier ce que votre budget doit mettre de côté.',
  goals: 'Objectifs enregistrés',
  due: 'Échéances arrivées à vérifier',
  caution:
    'Les projections reposent sur vos hypothèses : ce n’est ni de l’argent disponible, ni un rendement garanti.',
};
registerPageTexts(
  Object.fromEntries(
    Object.entries(BPM_WORKSPACE_NAV_TEXTS).map(([key, value]) => [P + key, value]),
  ),
);

/** L'aide « Que faire maintenant ? » : une action du bandeau de chaque vue, qui complète le menu secondaire natif. */
@Component({
  selector: 'rjs-bpm-workspace-nav',
  imports: [RouterLink, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './bpm-context.scss',
  template: `
    <!-- Action du bandeau de la page : l'aide s'ouvre sans quitter la vue. -->
    <button class="app-hero-action" type="button" (click)="opened.set(true)" aria-haspopup="dialog">
      {{ t(reading().state === 'wealthCap' ? 'wealthCap' : 'help') }}
    </button>
    <rjs-modal [headed]="true" [open]="opened()" [title]="t('help')" (closed)="opened.set(false)">
      <div class="bpm-guide">
        <header>
          <small>{{ project().title }} · {{ t(active()) }}</small>
        </header>
        <section>
          <h3>{{ t('next') }}</h3>
          <strong>{{ t(reading().state) }}</strong>
          <p>{{ t(reading().state + 'Help') }}</p>
          <p>
            {{ t('due') }} : {{ reading().due.length }} · {{ t('goals') }} :
            {{ project().vision.goals.length }}
          </p>
          <a
            class="btn btn-primary"
            [routerLink]="destination().link"
            [queryParams]="destination().query"
            [fragment]="destination().fragment"
            (click)="opened.set(false)"
            >{{ t(reading().state) }} →</a
          >
        </section>
        <section>
          <h3>{{ t('reading') }}</h3>
          <dl>
            <div>
              <dt>{{ t('real') }}</dt>
              <dd>{{ amount(project().snapshot?.netCents) }}</dd>
            </div>
            <div>
              <dt>{{ t('expected') }}</dt>
              <dd>{{ amount(reading().expectedCents) }}</dd>
            </div>
            <div>
              <dt>{{ t('wealth') }}</dt>
              <dd>{{ amount(project().snapshot?.standing?.totalCents) }}</dd>
            </div>
          </dl>
          <p>{{ t('readingHelp') }}</p>
        </section>
        <p>{{ t('caution') }}</p>
        <button autofocus class="btn btn-secondary" type="button" (click)="opened.set(false)">
          {{ t('close') }}
        </button>
      </div>
    </rjs-modal>
  `,
})
export class BpmWorkspaceNavComponent {
  readonly project = input.required<BpmProject>();
  readonly active = input.required<'dashboard' | 'pilot' | 'money' | 'vision'>();
  private readonly store = inject(BpmStore);
  protected readonly opened = signal(false);
  protected readonly reading = computed(() =>
    guidanceOf(this.project(), this.store.workspace()?.today ?? ''),
  );
  protected readonly destination = computed(() => {
    const state = this.reading().state;
    const page =
      state === 'cycle' || state === 'paused'
        ? 'cycle'
        : state === 'valuation'
          ? 'parcours'
          : ['goal', 'ready', 'wealthCap'].includes(state)
            ? 'vision'
            : 'piloter/agir';
    return {
      link: '/budget-patrimoine-management/' + page,
      query: ((state === 'cycle' || state === 'paused') && this.project().linkId
        ? { liaison: this.project().linkId }
        : { projet: this.project().id }) as Record<string, string>,
      fragment:
        state === 'wealthCap' ? 'cap-patrimonial' : state === 'setup'
          ? 'mois-type'
          : state === 'goal' || state === 'ready'
              ? 'objectifs'
              : undefined,
    };
  });
  protected amount(value: number | null | undefined) {
    return value == null ? this.t('unknown') : formatMoney(value);
  }
  protected t(key: string) {
    return pageText(P + key);
  }
}
