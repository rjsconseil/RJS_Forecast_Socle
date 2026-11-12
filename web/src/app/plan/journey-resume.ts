import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { Journey } from './journey';
import { sameStep } from './journey-model';
import { locate } from './site-plan';

/**
 * « Reprendre là où vous en étiez » : la dernière étape du parcours et les étapes récentes, tous
 * modules confondus. Lecture seule du parcours unifié ; un clic rejoint l'étape sans la dupliquer.
 */
@Component({
  selector: 'rjs-journey-resume',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (steps().length; as count) {
      <section class="journey-resume" aria-labelledby="journey-resume-title">
        <header>
          <h2 id="journey-resume-title">{{ title() }}</h2>
          <p>{{ count > 1 ? (zone() ? 'Vos dernières étapes dans cette zone.' : 'Vos dernières étapes, dans tous les modules.') : 'Votre dernière étape.' }}</p>
        </header>
        <ol>
          @for (step of steps(); track step.index; let first = $first) {
            <li>
              <button type="button" [class.is-last]="first" (click)="journey.jump(step.index)" [disabled]="journey.pendingNavigation()">
                <span class="journey-resume-zone" [attr.title]="step.zone?.label">{{ step.zone?.acronym }}</span>
                <span class="journey-resume-label"><strong>{{ step.label }}</strong><small>{{ step.zone?.label }}</small></span>
                <span aria-hidden="true">{{ first ? 'Reprendre →' : '→' }}</span>
              </button>
            </li>
          }
        </ol>
      </section>
    }
  `,
  styles: `
    .journey-resume { margin: 0 0 var(--ecart-24, 24px); padding: 16px 20px; border: 1px solid var(--line); border-radius: 14px; background: var(--raised-surface, #fff); box-shadow: var(--app-panel-shadow); }
    header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin-bottom: 10px; }
    h2 { margin: 0; font-size: 1.05rem; }
    header p { margin: 0; color: var(--muted); font-size: 0.85rem; }
    ol { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
    button { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 52px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: transparent; color: var(--ink); font: inherit; text-align: left; cursor: pointer; transition: border-color 160ms ease, background-color 160ms ease, box-shadow 240ms ease, transform 240ms ease; }
    button:hover, button:focus-visible { border-color: var(--app-accent); background: color-mix(in srgb, var(--app-accent) 6%, transparent); box-shadow: var(--card-hover-shadow); transform: translateY(var(--card-lift, -2px)); }
    button.is-last { border-color: var(--app-accent); }
    .journey-resume-zone { flex-shrink: 0; min-width: 38px; padding: 2px 6px; border-radius: 6px; background: color-mix(in srgb, var(--app-accent) 12%, transparent); color: var(--app-accent); font-size: 11px; font-weight: 700; text-align: center; }
    .journey-resume-label { display: grid; flex: 1; min-width: 0; }
    .journey-resume-label strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .journey-resume-label small { color: var(--muted); font-size: 0.78rem; }
    button > span:last-child { flex-shrink: 0; color: var(--app-accent); font-size: 0.85rem; font-weight: 650; }
  `,
})
export class JourneyResume {
  readonly title = input('Reprendre là où vous en étiez');
  readonly limit = input(4);
  /** Limite la reprise aux étapes d'une zone (accueil de zone) ; absent : tous les modules. */
  readonly zone = input<string | null>(null);
  protected readonly journey = inject(Journey);
  private readonly router = inject(Router);
  /** L'étape où l'utilisateur se trouvait d'abord, puis les plus récentes, une seule fois par adresse. */
  protected readonly steps = computed(() => {
    const seen = new Set<string>();
    const cursor = this.journey.cursor();
    return this.journey
      .visits()
      .map((visit, index) => ({ index, label: visit.label, url: visit.url.split('#')[0], zone: locate(visit.url).zone }))
      // La page affichée n'est pas une étape à reprendre.
      .filter((step) => (!this.zone() || step.zone?.id === this.zone()) && !sameStep(step.url, this.router.url))
      .reverse()
      .sort((a, b) => Number(b.index === cursor) - Number(a.index === cursor))
      .filter((step) => !seen.has(step.url) && !!seen.add(step.url))
      .slice(0, this.limit());
  });
}
