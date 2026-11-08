import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiError, toApiError } from '../../core/api.service';
import { BpmApi } from '../../core/bpm-api.service';
import { cents, CentsPipe, parseAmount, ShortDatePipe, signedCents } from '../../core/format';
import { bpmLoader, BpmProgress, BpmRefresh, BpmState } from '../ui';

/**
 * Panneau « Directives » : épargne nécessaire, provisions indicatives, plafond, disponible et
 * montant indicatif par semaine, chacun avec ses hypothèses. Une valeur manquante est
 * « Non calculable » avec sa raison, jamais un zéro.
 */
@Component({
  selector: 'bpm-act-directives',
  imports: [RouterLink, BpmState, ShortDatePipe],
  styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-vision.page.scss'],
  template: `
    <section class="bv-card bp-directives" [attr.data-state]="state()" aria-labelledby="bp-dir-title" data-ui-pattern="panel">
      <h2 id="bp-dir-title">Directives de la période</h2>
      <p>Épargne nécessaire, provisions, plafond, disponible et montant par semaine, chacun avec ses hypothèses.</p>
      <bpm-state [loading]="dir.loading() && !dir.data()" [error]="dir.error()" (retry)="dir.reload()" />
      @if (dir.data(); as d) {
        @if (d.context.period; as p) {
          <p class="bp-dir-status">Période {{ p.label }}, du {{ p.start | shortDate }} au {{ p.end | shortDate }} inclus ; calcul au {{ d.context.calculationDate | shortDate }}.</p>
        }
        <ol class="bp-dir-list">
          @for (i of d.items; track i.key; let n = $index) {
            <li [class.is-over]="i.valueCents !== null && (i.key === 'available' || i.key === 'weekly') && (i.valueCents ?? 0) < 0">
              <span aria-hidden="true">{{ marks[n] ?? n + 1 }}</span>{{ i.label }} :
              @if (i.valueCents !== null) {
                <strong>{{ value(i.key, i.valueCents) }}</strong>
                @if (i.computable) { <span class="chip estimate">Indicatif</span> }
              } @else {
                <strong>Non calculable</strong> <span>{{ i.reason }}</span>
              }
            </li>
          }
        </ol>
        <div class="bp-dir-explain">
          <details class="bpm-limited">
            <summary>Hypothèses de chaque directive</summary>
            <dl class="bpm-recap">
              @for (i of d.items; track i.key) {
                <div class="bpm-recap-wide">
                  <dt>{{ i.label }}</dt>
                  <dd>
                    @for (a of i.assumptions; track a) { <span class="bpm-help">{{ a }}</span><br /> } @empty { <span class="bpm-help">—</span> }
                    @if (!i.computable) { <span class="bpm-help">Non calculable : {{ i.reason }}</span> }
                  </dd>
                </div>
              }
            </dl>
          </details>
        </div>
        <p class="bpm-help">
          Indications calculées sans écriture. L'épargne nécessaire vient de l'objectif d'excédent ou de l'épargne visée ;
          les provisions viennent des objectifs datés (<a routerLink="/vision">Objectifs et avenir</a>) ; le plafond est la somme des limites définies dans <a routerLink="/plafonds/reglages">Définir les plafonds</a>.
        </p>
      }
    </section>
  `,
  styles: `
    .bpm-recap dd { font-size: var(--fs-sm); font-weight: 400; }
  `,
})
export class BpmActDirectives {
  private bpm = inject(BpmApi);
  protected dir = bpmLoader(() => 0, () => this.bpm.directives());
  protected readonly marks = ['①', '②', '③', '④', '⑤', '⑥'];
  /** État de la carte : aucune directive calculable, disponible négatif ou dans les clous. */
  protected state = computed(() => {
    const items = this.dir.data()?.items ?? [];
    if (!items.some((i) => i.computable)) return 'none';
    const available = items.find((i) => i.key === 'available');
    return available?.computable && (available.valueCents ?? 0) < 0 ? 'behind' : 'ok';
  });
  protected value(key: string, v: number) {
    return key === 'available' || key === 'weekly' ? signedCents(v) : cents(v);
  }
}

/**
 * Panneau « Objectif d'excédent budgétaire » : montant cible, nombre de périodes et période de
 * départ, enregistrés dans la vision de la composition (révision attendue). L'enregistrement ne
 * modifie pas le stock du Patrimoine ; la progression suit les résultats des périodes closes.
 */
@Component({
  selector: 'bpm-act-surplus',
  imports: [FormsModule, BpmState, BpmProgress, CentsPipe],
  styleUrls: ['../ref-styles/bpm-pages.scss', '../ref-styles/bpm-vision.page.scss', '../ref-styles/bpm-pilot-charts.scss'],
  template: `
    <section class="bv-card" aria-labelledby="bp-target-title" data-ui-pattern="panel">
      <h2 id="bp-target-title">Objectif d’excédent</h2>
      <p>Montant cible, nombre de périodes et période de départ ; progression.</p>
      <bpm-state [loading]="(profile.loading() && !profile.data()) || (dir.loading() && !dir.data())" [error]="profile.error() ?? dir.error()" (retry)="profile.reload(); dir.reload()" />
      @if (dir.data(); as d) {
        @if (d.surplus; as s) {
          <dl class="bp-target-facts">
            <div>
              <dt>Excédent cumulé visé</dt>
              <dd><strong>{{ s.targetCents | cents }}</strong><span>{{ s.periods }} période(s) depuis {{ s.startKey }}</span></dd>
            </div>
            <div>
              <dt>Excédent par période</dt>
              <dd><strong>{{ s.perPeriodCents | cents }}</strong><span>par période</span></dd>
            </div>
          </dl>
          <bpm-progress label="Excédent cumulé vers la cible" [value]="s.cumulatedCents" [target]="s.targetCents"
            [detail]="s.closedPeriods + ' période(s) close(s) depuis ' + s.startKey + ' sur ' + s.periods + ' prévue(s) · ' + fmt(s.perPeriodCents) + ' par période'" />
          <p class="bpm-help">Seuls les résultats enregistrés des périodes closes à partir de {{ s.startKey }} sont cumulés. Un résultat négatif réduit le cumul.</p>
        } @else {
          <p class="bv-empty">Aucun objectif d'excédent enregistré.</p>
        }
      }
      @if (profile.data()) {
        <form class="bv-form" (ngSubmit)="save()" novalidate aria-label="Objectif d'excédent budgétaire">
          @if (error(); as e) {
            <div [class.bpm-error]="!e.isConflict" [class.bpm-missing]="e.isConflict" role="alert">
              {{ e.message }}
              <p>{{ e.isConflict ? 'La vision a changé entre-temps : votre saisie est conservée ; rechargez puis réenregistrez.' : 'Rien n’a été enregistré ; votre saisie est conservée.' }}</p>
              @if (e.isConflict) { <button type="button" class="btn btn-secondary small" (click)="profile.reload()">Relire la version enregistrée</button> }
            </div>
          }
          @if (message()) { <p class="bv-saved" role="status">{{ message() }}</p> }
          <div class="bv-fields">
            <label>
              Montant cible (€)
              <input name="target" inputmode="decimal" class="num" [(ngModel)]="target" (ngModelChange)="dirty.set(true)" [attr.aria-invalid]="fieldErr('surplus.target') ? 'true' : null" />
              @if (fieldErr('surplus.target')) { <span class="err">{{ fieldErr('surplus.target') }}</span> }
            </label>
            <label>
              Nombre de périodes
              <input name="periods" type="number" min="1" max="600" step="1" class="num" [(ngModel)]="periods" (ngModelChange)="dirty.set(true)" [attr.aria-invalid]="fieldErr('surplus.periods') ? 'true' : null" />
              @if (fieldErr('surplus.periods')) { <span class="err">{{ fieldErr('surplus.periods') }}</span> }
            </label>
            <label>
              Période de départ
              <input name="startKey" type="month" [(ngModel)]="startKey" (ngModelChange)="dirty.set(true)" [attr.aria-invalid]="fieldErr('surplus.startKey') ? 'true' : null" />
              @if (fieldErr('surplus.startKey')) { <span class="err">{{ fieldErr('surplus.startKey') }}</span> }
            </label>
          </div>
          @if (perPeriod() !== null) {
            <p>Soit <strong class="num">{{ perPeriod()! | cents }}</strong> d'excédent par période (arrondi au centime supérieur).</p>
          }
          <p class="bpm-help">Enregistrer cet objectif ne modifie pas le stock du Patrimoine : il fixe l'épargne nécessaire des directives. Le stock n'évolue qu'à la clôture, par la capitalisation du résultat réel.</p>
          <div class="bpm-actions">
            <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ busy() ? 'Enregistrement…' : 'Enregistrer l’objectif' }}</button>
            @if (hasSurplus()) {
              @if (!confirmRemove()) {
                <button type="button" class="btn btn-secondary" (click)="confirmRemove.set(true)">Retirer l'objectif…</button>
              } @else {
                <span class="bpm-help">Retirer l'objectif d'excédent ?</span>
                <button type="button" class="btn btn-secondary danger small" (click)="remove()" [disabled]="busy()">Confirmer le retrait</button>
                <button type="button" class="btn btn-secondary small" (click)="confirmRemove.set(false)">Garder</button>
              }
            }
          </div>
        </form>
      }
    </section>
  `,
  styles: `
    .bpm-actions { align-items: center; }
    .bv-fields .err { color: var(--status-danger); font-weight: 400; font-size: var(--fs-sm); }
  `,
})
export class BpmActSurplus {
  private bpm = inject(BpmApi);
  private refresh = inject(BpmRefresh);
  protected profile = bpmLoader(() => 0, () => this.bpm.setupProfile());
  protected dir = bpmLoader(() => 0, () => this.bpm.directives());

  protected target = signal('');
  protected periods = signal<number | string>(12);
  protected startKey = signal('');
  protected dirty = signal(false);
  protected busy = signal(false);
  protected error = signal<ApiError | null>(null);
  protected message = signal<string | null>(null);
  protected confirmRemove = signal(false);
  protected fmt = cents;

  protected hasSurplus = computed(() => !!this.profile.data()?.principal.vision.surplus);
  protected perPeriod = computed(() => {
    const t = parseAmount(this.target());
    const n = Number(this.periods());
    return typeof t === 'number' && t > 0 && Number.isInteger(n) && n > 0 ? Math.ceil((Math.round(t * 100)) / n) : null;
  });

  constructor() {
    // Le formulaire reprend la valeur enregistrée tant qu'aucune saisie n'est en cours.
    effect(() => {
      const p = this.profile.data();
      const period = this.dir.data()?.context.period?.key ?? '';
      untracked(() => {
        if (!p || this.dirty()) return;
        const s = p.principal.vision.surplus;
        this.target.set(s ? String(s.targetCents / 100).replace('.', ',') : '');
        this.periods.set(s?.periods ?? 12);
        this.startKey.set(s?.startKey ?? period);
      });
    });
  }

  protected fieldErr(name: string) {
    const e = this.error();
    return e && e.body.details?.['field'] === name ? e.message : null;
  }

  async save() {
    const p = this.profile.data();
    if (!p || this.busy()) return;
    const target = parseAmount(this.target());
    const periods = Number(this.periods());
    if (typeof target !== 'number' || target <= 0) return this.fail('Montant cible positif attendu.', 'surplus.target');
    if (!Number.isInteger(periods) || periods < 1 || periods > 600) return this.fail('Nombre entier de périodes entre 1 et 600 attendu.', 'surplus.periods');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(this.startKey())) return this.fail('Période de départ AAAA-MM attendue.', 'surplus.startKey');
    await this.write({ target, periods, startKey: this.startKey() }, 'Objectif d’excédent enregistré. Le stock du Patrimoine est inchangé.');
  }

  async remove() {
    await this.write(null, 'Objectif d’excédent retiré.');
    this.confirmRemove.set(false);
  }

  private fail(message: string, field: string) {
    this.error.set(new ApiError(400, { code: 'VALIDATION', action: null, message, details: { field } }));
  }

  private async write(surplus: { target: number; periods: number; startKey: string } | null, ok: string) {
    const p = this.profile.data();
    if (!p) return;
    this.busy.set(true);
    this.error.set(null);
    this.message.set(null);
    try {
      // Révision attendue : celle de la composition BPM (lue par le profil de démarrage).
      await this.bpm.updateVision({ expectedRevision: p.principal.revision, surplus });
      this.dirty.set(false);
      this.message.set(ok);
      this.refresh.bump();
    } catch (e) {
      this.error.set(toApiError(e));
    } finally {
      this.busy.set(false);
    }
  }
}
