import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { formatMoney } from '../shared/amount';
import { pageText, registerPageTexts } from '../shared/page-text';
import { UserSession, entityTypeLabel } from '../utilisateurs/utilisateurs.contract';
import { BpmGlobalView, legalFormLabel } from './bpm-global.model';

const P = 'content.pages.bpm.bpm-context.component.';
/** Textes de la barre de contexte ; ils se personnalisent dans Configuration → Contenus. */
export const BPM_CONTEXT_TEXTS: Record<string, string> = {
  label: 'Contexte de travail',
  expand: 'Repères patrimoniaux',
  details: 'Détail personnel et professionnel',
  user: 'Utilisateur',
  change: 'Changer d’utilisateur',
  personal: 'Patrimoine personnel',
  professional: 'Patrimoine professionnel',
  professionalShare: 'Part professionnelle',
  global: 'Patrimoine global',
  unknown: 'à valoriser',
  none: 'à préparer dans Utilisateurs',
  share: '{pct} % détenus',
  pilot: 'Piloter {label} →',
  open: 'Mes patrimoines →',
  scope: 'Périmètre',
  personalScope: 'Personnel',
  professionalScope: 'Structure',
  globalScope: 'Personnel et structures',
};
registerPageTexts(
  Object.fromEntries(Object.entries(BPM_CONTEXT_TEXTS).map(([k, v]) => [P + k, v])),
);

/**
 * La barre de contexte commune aux pages Budget/Patrimoine Management, sous le
 * bandeau de titre : l'utilisateur connecté et sa situation, son patrimoine unique,
 * le patrimoine professionnel de ses entreprises rattachées, le total global, et
 * l'accès au pilotage de l'entreprise. Lecture seule.
 */
@Component({
  selector: 'rjs-bpm-context',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './bpm-context.component.scss',
  template: `
    <aside [attr.aria-label]="t('label')">
      @if (embedded()) {
        <div class="bctx-embedded" [class.is-compact]="compact()">
          @if (view(); as v) {
            @if (scopeOnly()) {
              <span class="bctx-scope"
                ><small>{{ t('scope') }}</small
                ><strong>{{
                  t(
                    v.actor.isPersonal
                      ? v.members.some(professionalMember)
                        ? 'globalScope'
                        : 'personalScope'
                      : 'professionalScope'
                  )
                }}</strong></span
              >
            } @else if (compact()) {
              <div class="bctx-inline-metrics">
                @if (v.actor.isPersonal) {
                  <span
                    ><small>{{ t('personal') }}</small>
                    <strong>{{ amount(v.totals.personalCents, true) }}</strong></span
                  >
                }
                @if (v.members.some(professionalMember)) {
                  <span
                    ><small>{{
                      t(v.actor.isPersonal ? 'professionalShare' : 'professional')
                    }}</small>
                    <strong>{{ amount(v.totals.professionalCents, true) }}</strong></span
                  >
                }
              </div>
            } @else {
              @for (m of v.members; track m.ownerId) {
                <div>
                  <small
                    >{{ t(m.kind === 'professional' ? 'professional' : 'personal') }}
                    @if (m.kind === 'professional') {
                      · {{ m.ownerLabel }}
                    }</small
                  ><strong>{{ amount(m.standing?.totalCents, !!m.patrimoine) }}</strong>
                  @if (m.kind === 'professional' && m.ownershipPct < 100) {
                    <small>{{ t('share').replace('{pct}', String(m.ownershipPct)) }}</small>
                  }
                </div>
              }
              @if (v.members.length > 1) {
                <div>
                  <small>{{ t('global') }}</small
                  ><strong>{{ amount(v.totals.globalCents, true) }}</strong>
                </div>
              }
            }
            @if (showGlobalLink()) {
              <a routerLink="/budget-patrimoine-management/patrimoine-global">{{ t('open') }}</a>
            }
          }
        </div>
      } @else {
        <details class="bctx" [open]="compact()">
          <summary class="bctx-summary">
            <span
              >{{ t('expand') }} <small>{{ session.profile()?.label }}</small></span
            >
            <span class="bctx-total">
              @if (view(); as v) {
                <small>{{ t('global') }}</small
                ><strong>{{ amount(v.totals.globalCents, true) }}</strong>
              }
              <span aria-hidden="true">+</span></span
            >
          </summary>
          <div class="bctx-content">
            <a class="bctx-user" routerLink="/acces" [title]="t('change')">
              <span class="bctx-mark" aria-hidden="true">{{ initial() }}</span>
              <span class="bctx-text">
                <small>{{ t('user') }}</small>
                <strong>{{ session.profile()?.label ?? '—' }}</strong>
                <small>{{ situation() }} · {{ t('change') }}</small>
              </span>
            </a>
            @if (view(); as v) {
              @if (compact()) {
                @if (showGlobalLink()) {
                  <a routerLink="/budget-patrimoine-management/patrimoine-global">{{
                    t('open')
                  }}</a>
                }
              } @else {
                <ul class="bctx-wealth">
                  @for (m of v.members; track m.ownerId) {
                    <li [attr.data-kind]="m.kind">
                      <small>{{
                        t(m.kind === 'professional' ? 'professional' : 'personal')
                      }}</small>
                      <span>{{
                        m.kind === 'professional' ? m.ownerLabel + form(m.legalForm) : m.ownerLabel
                      }}</span>
                      <b>{{ amount(m.standing?.totalCents, !!m.patrimoine) }}</b>
                      @if (m.kind === 'professional' && m.ownershipPct < 100) {
                        <small>{{ t('share').replace('{pct}', String(m.ownershipPct)) }}</small>
                      }
                    </li>
                  }
                  @if (v.members.length > 1) {
                    <li data-kind="global">
                      <small>{{ t('global') }}</small>
                      <b>{{ amount(v.totals.globalCents, true) }}</b>
                      @if (showGlobalLink()) {
                        <a routerLink="/budget-patrimoine-management/patrimoine-global">{{
                          t('open')
                        }}</a>
                      }
                    </li>
                  }
                </ul>
                @if (business(); as b) {
                  <a
                    class="btn btn-secondary bctx-pilot"
                    routerLink="/budget-patrimoine-management/entreprise/pilotage"
                    [queryParams]="{ entreprise: b.ownerId }"
                    >{{ t('pilot').replace('{label}', b.ownerLabel) }}</a
                  >
                }
              }
            }
          </div>
        </details>
      }
    </aside>
  `,
})
export class BpmContextComponent {
  protected readonly professionalMember = (member: { kind: string }) =>
    member.kind === 'professional';
  readonly embedded = input(false);
  readonly compact = input(false);
  readonly showGlobalLink = input(true);
  readonly scopeOnly = input(false);
  private readonly http = inject(HttpClient);
  protected readonly session = inject(UserSession);
  protected readonly String = String;
  protected readonly view = signal<BpmGlobalView | null>(null);
  protected readonly initial = computed(
    () => this.session.profile()?.label.trim()[0]?.toUpperCase() ?? '·',
  );
  protected readonly situation = computed(() => entityTypeLabel(this.session.profile()));
  /** L'entreprise à piloter : l'utilisateur lui-même s'il en est une, sinon la première rattachée. */
  protected readonly business = computed(() => {
    const v = this.view();
    if (!v) return null;
    return (
      v.members.find((m) => m.ownerId === v.actor.id && m.kind === 'professional') ??
      v.members.find((m) => m.kind === 'professional') ??
      null
    );
  });
  constructor() {
    firstValueFrom(this.http.get<BpmGlobalView>('/api/bpm/patrimoine-global'))
      .then((view) => this.view.set(view))
      .catch(() => this.view.set(null));
  }
  protected t(key: string): string {
    return pageText(P + key);
  }
  protected form(legalForm: string | null): string {
    return legalForm ? ` · ${legalFormLabel(legalForm)}` : '';
  }
  protected amount(cents: number | null | undefined, exists: boolean): string {
    if (!exists) return this.t('none');
    return cents === null || cents === undefined ? this.t('unknown') : formatMoney(cents);
  }
}
