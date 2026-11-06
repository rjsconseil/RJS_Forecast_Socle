import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiError } from '../../core/api.service';
import { cents, signedCents } from '../../core/format';

// Éléments propres au tableau de bord et à ses sous-pages (solde, entrées).

/** Problème de contexte d'une lecture BPM : aucun user choisi, ou ensemble principal non prêt. */
export function setupProblem(e: ApiError | null): 'user' | 'composition' | null {
  if (!e) return null;
  if (e.body.code === 'CONTEXT_REQUIRED') return 'user';
  if (e.body.code === 'FORBIDDEN_BY_RULE' && e.body.details?.['preparation']) return 'composition';
  return null;
}

/**
 * Nuances d'une même mesure pour les catégories d'une répartition (centres, sources) : la mesure
 * garde sa couleur (`--s-charge` pour les dépenses, `--s-income` pour les entrées), seules les
 * intensités distinguent les catégories ; la liste associée porte les libellés.
 */
export function shade(token: string, i: number) {
  const steps = [100, 78, 60, 46, 34, 24];
  const pct = steps[i % steps.length];
  return pct === 100 ? `var(${token})` : `color-mix(in srgb, var(${token}) ${pct}%, var(--c-text-3))`;
}

/** État explicite quand la lecture n'a pas de user ou d'ensemble principal prêt (cadre source `.bpm-empty`). */
@Component({
  selector: 'bpm-setup-needed',
  imports: [RouterLink],
  styleUrls: ['../ref-styles/bpm-pages.scss'],
  template: `
    <section class="bpm-empty bpm-card" data-ui-pattern="panel" role="status">
      @if (kind() === 'user') {
        <h2>Aucun profil financier sélectionné</h2>
        <p class="bpm-help">Choisissez un profil financier dans le bandeau ou créez-en un. Chaque profil dispose de son projet de vie et de son patrimoine uniques.</p>
        <div class="bpm-actions"><a class="btn btn-primary" routerLink="/utilisateurs">Choisir un profil financier</a></div>
      } @else {
        <h2>Espace BPM à préparer</h2>
        <p class="bpm-help">{{ message() }}</p>
        <p class="bpm-missing">Terminez la configuration du budget du projet de vie et du patrimoine pour retrouver vos chiffres ici.</p>
        <div class="bpm-actions"><a class="btn btn-primary" routerLink="/creer">Configurer mon espace</a></div>
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .bpm-empty { display: grid; gap: var(--ecart-12); }
    .bpm-empty h2 { margin: 0; }
  `,
})
export class BpmSetupNeeded {
  readonly kind = input.required<'user' | 'composition'>();
  readonly message = input('');
}

/**
 * Cap patrimonial : stock connu et estimation après la période face à l'objectif de stock,
 * avec le manque ou le dépassement. Les valeurs négatives sont dessinées à gauche de zéro ;
 * une valeur inconnue n'est pas dessinée. Les valeurs sont reprises en texte sous le graphe.
 */
@Component({
  selector: 'bpm-dashboard-cap',
  template: `
    <figure class="cap">
      <figcaption>Cap patrimonial</figcaption>
      @if (target() === null) {
        <p class="muted small">Objectif de stock non renseigné : aucun cap à comparer.</p>
      } @else {
        <div class="plot" role="img" [attr.aria-label]="summary()">
          @for (b of bars(); track b.key) {
            <div class="row">
              <span class="lbl">{{ b.label }}</span>
              <span class="track">
                @if (b.value !== null) {
                  <span class="bar" [class.estimate]="b.estimate" [class.neg]="b.value < 0" [style.left.%]="b.left" [style.width.%]="b.width"></span>
                }
                <span class="target" [style.left.%]="scale().target" aria-hidden="true"></span>
              </span>
              <span class="num val">{{ b.value === null ? 'Inconnu' : signed(b.value) }}</span>
            </div>
          }
        </div>
        <dl class="gaps">
          <div><dt>Objectif de stock</dt><dd class="num">{{ money(target()) }}</dd></div>
          @for (b of bars(); track b.key) {
            <div>
              <dt>{{ b.gapLabel }}</dt>
              <dd class="num" [class.pos]="b.gap !== null && b.gap >= 0" [class.neg]="b.gap !== null && b.gap < 0">{{ gapText(b.gap) }}</dd>
            </div>
          }
        </dl>
        <p class="legend"><span><i class="k-stock"></i>Stock enregistré</span><span><i class="k-est"></i>Estimation (hachurée)</span><span><i class="k-target"></i>Objectif</span></p>
      }
    </figure>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .cap { margin: 0; }
    figcaption { font-weight: 600; font-size: 0.92rem; margin-bottom: 8px; }
    .plot { position: relative; display: grid; gap: 8px; }
    .row { display: grid; grid-template-columns: minmax(110px, 0.9fr) 2fr minmax(96px, auto); gap: 10px; align-items: center; }
    .lbl { font-size: 0.84rem; color: var(--c-text-2); }
    .track { position: relative; height: 14px; background: var(--c-surface-3); border-radius: 7px; }
    .bar { position: absolute; top: 0; bottom: 0; background: var(--s-patrimoine); border-radius: 7px; min-width: 2px; }
    .bar.estimate { background: repeating-linear-gradient(45deg, var(--s-patrimoine) 0 4px, color-mix(in srgb, var(--s-patrimoine) 45%, var(--c-surface)) 4px 8px); }
    .bar.neg { background: var(--c-neg); }
    .target { position: absolute; top: -5px; bottom: -5px; width: 2px; margin-left: -1px; background: var(--c-text); }
    .val { font-size: 0.84rem; text-align: right; white-space: nowrap; }
    .gaps { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 6px 16px; margin: 12px 0 0; }
    .gaps dt { font-size: 0.74rem; color: var(--c-text-3); }
    .gaps dd { margin: 0; font-size: 0.9rem; }
    .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 0.78rem; color: var(--c-text-2); margin: 8px 0 0; }
    .legend i { display: inline-block; width: 12px; height: 8px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
    .k-stock { background: var(--s-patrimoine); }
    .k-est { background: repeating-linear-gradient(45deg, var(--s-patrimoine) 0 3px, var(--c-surface) 3px 6px); }
    .k-target { width: 2px !important; height: 12px !important; background: var(--c-text); }
    @media (max-width: 520px) { .row { grid-template-columns: 1fr auto; } .track { grid-column: 1 / -1; order: 3; } }
  `,
})
export class BpmDashboardCap {
  /** Centimes ; `null` = inconnu. */
  readonly stock = input<number | null>(null);
  readonly estimate = input<number | null>(null);
  readonly target = input<number | null>(null);
  protected signed = signedCents;
  protected money = cents;

  protected scale = computed(() => {
    const vals = [this.stock(), this.estimate(), this.target()].filter((v): v is number => v !== null);
    const lo = Math.min(0, ...vals);
    const hi = Math.max(1, ...vals);
    const pos = (v: number) => ((v - lo) / (hi - lo)) * 100;
    return { pos, target: pos(this.target() ?? 0) };
  });

  protected bars = computed(() => {
    const { pos } = this.scale();
    const t = this.target();
    const mk = (key: string, label: string, gapLabel: string, value: number | null, estimate: boolean) => ({
      key,
      label,
      gapLabel,
      value,
      estimate,
      left: value === null ? 0 : Math.min(pos(0), pos(value)),
      width: value === null ? 0 : Math.abs(pos(value) - pos(0)),
      // Écart signé au cap : positif = dépassement, négatif = manque.
      gap: value === null || t === null ? null : value - t,
    });
    return [mk('stock', 'Stock enregistré', 'Par rapport au stock connu', this.stock(), false), mk('estimate', 'Estimation après période', 'Après la période (estimation)', this.estimate(), true)];
  });

  protected gapText(g: number | null) {
    if (g === null) return 'Non calculable : valeur inconnue';
    if (g === 0) return 'Cap atteint exactement';
    return g > 0 ? `Dépassement de ${cents(g)}` : `Manque ${cents(-g)}`;
  }

  protected summary = computed(() => {
    const [s, e] = this.bars();
    return `Cap patrimonial : objectif ${cents(this.target())} ; stock enregistré ${s.value === null ? 'inconnu' : signedCents(s.value)} (${this.gapText(s.gap)}) ; estimation après période ${e.value === null ? 'inconnue' : signedCents(e.value)} (${this.gapText(e.gap)}).`;
  });
}

/**
 * Patrimoine du tableau de bord, sur le cadre source `dashboard-wealth` : 1 stock enregistré,
 * 2 effet signé de la période, 3 estimation après période (comptée une seule fois), puis l'objectif
 * de stock avec la progression et le manque ou le dépassement. Inconnu n'est jamais affiché comme zéro.
 */
@Component({
  selector: 'bpm-dashboard-wealth',
  imports: [RouterLink, BpmDashboardCap],
  styleUrl: '../ref-styles/bpm-dashboard-wealth.component.scss',
  template: `
    <section class="dashboard-wealth" aria-labelledby="dashboard-wealth-title" data-ui-pattern="panel">
      <header class="wealth-heading">
        <h2 id="dashboard-wealth-title">Patrimoine estimé en fin de période</h2>
        <span>{{ headingNote() }}</span>
      </header>
      @if (stock() === null) {
        <p class="wealth-unavailable">
          <strong>Stock enregistré : À renseigner.</strong> {{ stockReason() ?? 'Le stock initial du Patrimoine n’est pas connu.' }}
          <a routerLink="/creer">Renseigner le stock →</a>
        </p>
      }
      <div class="wealth-overview">
        <div class="wealth-base">
          <span class="wealth-label"><b class="wealth-step" aria-hidden="true">1</b>Notre point de départ</span>
          <strong>{{ stock() === null ? 'À renseigner' : signed(stock()) }}</strong>
          <p>Stock d'ouverture + résultats déjà capitalisés avant le début de la période.</p>
        </div>
        <div class="wealth-contribution">
          <span class="wealth-label"><b class="wealth-step" aria-hidden="true">2</b>Effet signé de la période</span>
          <strong class="wealth-contribution-value" [class.is-negative]="(effect() ?? 0) < 0">
            @if (effect() !== null) {
              <span class="flow-direction is-compact" [attr.data-flow]="effect()! < 0 ? 'expense' : 'income'" aria-hidden="true">{{ effect()! < 0 ? '↓' : '↑' }}</span>
            }
            {{ effect() === null ? 'Inconnu' : signed(effect()) }}
          </strong>
          <p>Reste réel (reçu − dépensé à date de règlement) ; il peut être nul ou négatif.</p>
        </div>
        <div class="wealth-total">
          <span class="wealth-label wealth-estimate-label"><b class="wealth-step" aria-hidden="true">3</b>{{ closed() ? 'Après clôture (enregistré)' : 'Après cette période' }}</span>
          <strong [class.is-unknown]="after() === null">{{ after() === null ? (stock() === null ? 'À renseigner' : 'Inconnu') : signed(after()) }}</strong>
          <p>Stock enregistré + effet de la période, compté une seule fois.</p>
        </div>
        <div class="wealth-target">
          <div class="wealth-target-heading">
            <span class="wealth-label">Objectif de patrimoine</span>
          </div>
          <strong>{{ objective() === null ? 'Objectif à renseigner' : money(objective()) }}</strong>
          @if (progress(); as p) {
            <div class="wealth-cap-comparison">
              <div class="wealth-cap-position">
                <span class="wealth-cap-mark" aria-hidden="true">⚑</span>
                <span>{{ p.label }} % de l’objectif (stock enregistré)</span>
              </div>
              <div class="wealth-cap-gap" [class.is-reached]="p.gap <= 0">
                <span>{{ p.gap > 0 ? 'À constituer' : p.gap < 0 ? 'Au-delà de l’objectif' : 'Objectif atteint' }}</span>
                @if (p.gap !== 0) {
                  <strong>{{ money(p.gap < 0 ? -p.gap : p.gap) }}</strong>
                }
              </div>
            </div>
          } @else if (objective() !== null) {
            <p>Stock à renseigner : progression non calculable.</p>
          }
          <a routerLink="/vision" [queryParams]="carry()">Modifier l’objectif →</a>
        </div>
      </div>
      <details class="wealth-composition">
        <summary><span>Comprendre ce montant</span><span class="wealth-chevron" aria-hidden="true">›</span></summary>
        <div class="wealth-composition-body">
          <dl class="wealth-facts">
            <div><dt>Stock enregistré avant la période</dt><dd>{{ stock() === null ? 'À renseigner' : signed(stock()) }}</dd></div>
            <div><dt>Contribution de la période affichée</dt><dd [class.is-negative]="(effect() ?? 0) < 0">{{ effect() === null ? 'Inconnu' : signed(effect()) }}</dd></div>
            <div><dt>{{ closed() ? 'Après clôture (enregistré)' : 'Estimation après la période' }}</dt><dd [class.is-negative]="(after() ?? 0) < 0">{{ after() === null ? 'Inconnu' : signed(after()) }}</dd></div>
            <div><dt>Objectif de patrimoine</dt><dd>{{ objective() === null ? 'À renseigner' : money(objective()) }}</dd></div>
          </dl>
          <p>Stock enregistré avant la période, puis estimation avec le résultat de la période affichée, sans double compte.</p>
          <bpm-dashboard-cap [stock]="stock()" [estimate]="after()" [target]="objective()" />
          <ul class="wealth-rules">
            <li><strong>Stock enregistré</strong> = stock d'ouverture + résultats déjà capitalisés avant le début de la période. La période lue n'y est pas encore incluse.</li>
            <li><strong>Effet signé de la période</strong> = reste réel (reçu − dépensé à date de règlement). Il peut être nul ou négatif.</li>
            <li><strong>Estimation après période</strong> = stock enregistré + effet de la période, compté une seule fois : une capitalisation déjà incluse dans le stock n'est jamais ajoutée une seconde fois.</li>
            <li>À la clôture, le résultat signé est capitalisé une seule fois, y compris s'il est nul ou négatif. Un Patrimoine négatif reste affiché tel quel.</li>
          </ul>
          @if (formula()) {
            <p>Formule : <code>{{ formula() }}</code></p>
          }
          <a routerLink="/argent/reste" [queryParams]="carry()">Effet de la période →</a>
        </div>
      </details>
    </section>
  `,
  styles: `
    .wealth-unavailable { margin: 0; padding: var(--ecart-12) var(--ecart-16); border-radius: var(--radius-md, 12px); background: var(--status-warning-surface); }
    .wealth-unavailable a { margin-inline-start: var(--ecart-8); }
    .wealth-rules { margin: 0; padding-inline-start: var(--ecart-20); display: grid; gap: var(--ecart-6); }
  `,
})
export class BpmDashboardWealth {
  /** Centimes ; `null` = inconnu. */
  readonly stock = input<number | null>(null);
  readonly effect = input<number | null>(null);
  readonly after = input<number | null>(null);
  readonly objective = input<number | null>(null);
  readonly closed = input(false);
  readonly stockReason = input<string | null>(null);
  readonly formula = input<string | null>(null);
  /** Date de clôture prévue (ISO), pour « Estimation au … ». */
  readonly endDate = input<string | null>(null);
  readonly carry = input<Record<string, string>>({});
  protected signed = signedCents;
  protected money = cents;

  protected headingNote = computed(() => {
    if (this.closed()) return 'Chiffres enregistrés à la clôture';
    const end = this.endDate();
    if (!end) return 'Estimation après période';
    const d = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(end.slice(0, 10) + 'T12:00:00Z'));
    return `Estimation au ${d}`;
  });

  /** Progression du stock enregistré vers l'objectif (même base que l'ancienne jauge). */
  protected progress = computed(() => {
    const value = this.stock();
    const target = this.objective();
    if (value === null || target === null) return null;
    const percent = target > 0 ? (value / target) * 100 : value >= 0 ? 100 : 0;
    return { gap: target - value, label: new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(percent) };
  });
}
