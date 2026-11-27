import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { flowsFrom, flowsInto, sectionOf, type SectionFlow, type SectionKey } from './sections';

/** Un indicateur de l'accueil d'une section : son chiffre phare ou un compte utile. */
export interface SectionIndicator {
  label: string;
  value: string;
  note?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}

/** État « section seule » : ce qui manque en entrée, et le geste qui permet d'avancer quand même. */
export interface SectionAlone {
  title: string;
  detail: string;
  action?: { label: string; link: string; query?: Record<string, string> };
}

/**
 * Accueil générique d'une section (vision « cinq sections autonomes, un seul site ») : sa promesse, ce qu'elle est
 * seule à décider, ses indicateurs, son contenu propre (projeté), puis ce qu'elle reçoit et ce qu'elle donne aux
 * autres sections. Chaque section le remplit par ses données ; la mise en page est la même partout.
 */
@Component({
  selector: 'app-section-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @let s = section();
    <header class="section-home-head" [attr.data-section]="s.key">
      <p class="section-home-eyebrow">{{ s.label }} · {{ s.verb }}</p>
      <h1>{{ title() ?? s.label }}</h1>
      <p class="section-home-promise">{{ s.promise }}</p>
    </header>

    @if (alone(); as a) {
      <aside class="section-home-alone" role="note">
        <strong>{{ a.title }}</strong>
        <span>{{ a.detail }}</span>
        @if (a.action; as act) { <a [routerLink]="act.link" [queryParams]="act.query ?? null">{{ act.label }}</a> }
      </aside>
    }

    @if (indicators().length) {
      <ul class="section-home-indicators" aria-label="Indicateurs de la section">
        @for (i of indicators(); track i.label) {
          <li [attr.data-tone]="i.tone ?? 'neutral'"><span>{{ i.label }}</span><b>{{ i.value }}</b>@if (i.note) {<small>{{ i.note }}</small>}</li>
        }
      </ul>
    }

    <ng-content />

    @if (showFlows()) {
      <section class="section-home-flows" aria-label="Liens avec les autres sections">
        <div>
          <h2>Ce que la section reçoit</h2>
          <ul>@for (f of received(); track f.n) { <li><a [routerLink]="linkOf()(f.from)">{{ labelOf(f.from) }}</a> — {{ f.label }}<small>{{ f.detail }}</small></li> }</ul>
        </div>
        <div>
          <h2>Ce qu'elle donne</h2>
          <ul>@for (f of given(); track f.n) { <li><a [routerLink]="linkOf()(f.to)">{{ labelOf(f.to) }}</a> — {{ f.label }}<small>{{ f.detail }}</small></li> }</ul>
        </div>
        <p class="section-home-decides"><b>Seule à décider :</b> {{ s.decides }}</p>
      </section>
    }
  `,
  styles: [`
    :host { display: grid; gap: 16px; }
    .section-home-eyebrow { margin: 0; font: 600 12px/1.3 var(--font-sans); letter-spacing: .04em; text-transform: uppercase; color: var(--astra-link, currentColor); }
    h1 { margin: 2px 0 0; font: 670 clamp(24px, 2.6vw, 36px)/1.15 var(--font-sans); letter-spacing: -.04em; }
    .section-home-promise { margin: 4px 0 0; color: var(--bpm-muted, #555); }
    .section-home-alone { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; padding: 10px 14px; border-left: 3px solid var(--astra-link, #2f5bd0); background: var(--astra-wash, #f5f7fb); border-radius: 6px; }
    .section-home-indicators { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
    .section-home-indicators li { display: grid; gap: 2px; padding: 12px; border: 1px solid var(--bpm-line, #dde3ee); border-radius: 8px; background: var(--bpm-surface, #fff); }
    .section-home-indicators span, .section-home-indicators small { font-size: 12px; color: var(--bpm-muted, #555); }
    .section-home-indicators b { font: 660 20px/1.2 var(--font-sans); }
    .section-home-indicators [data-tone='warning'] b { color: var(--warning-text, #9a5b00); }
    .section-home-indicators [data-tone='danger'] b { color: var(--danger-text, #b42318); }
    .section-home-indicators [data-tone='success'] b { color: var(--success-text, #1a7f37); }
    .section-home-flows { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 8px 24px; padding-top: 12px; border-top: 1px solid var(--bpm-line, #dde3ee); }
    .section-home-flows h2 { margin: 0 0 4px; font: 640 14px/1.3 var(--font-sans); }
    .section-home-flows ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; font-size: 13px; }
    .section-home-flows small { display: block; color: var(--bpm-muted, #555); }
    .section-home-decides { grid-column: 1 / -1; margin: 0; font-size: 13px; color: var(--bpm-muted, #555); }
  `],
})
export class SectionHome {
  readonly key = input.required<SectionKey>();
  /** Titre de la page (par défaut le nom de la section). */
  readonly title = input<string | null>(null);
  readonly indicators = input<SectionIndicator[]>([]);
  readonly alone = input<SectionAlone | null>(null);
  /** Adresse de l'accueil d'une autre section, fournie par l'application. */
  readonly linkOf = input<(key: SectionKey) => string>(() => '/');
  /** Montrer ce que la section reçoit et donne (masquable pour un usage seul de la section). */
  readonly showFlows = input(true);

  protected readonly section = computed(() => sectionOf(this.key()));
  protected readonly received = computed<SectionFlow[]>(() => flowsInto(this.key()));
  protected readonly given = computed<SectionFlow[]>(() => flowsFrom(this.key()));
  protected labelOf = (key: SectionKey) => sectionOf(key).label;
}
