import { ChangeDetectionStrategy, Component, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CentsPipe, ShortDatePipe, parseAmount } from '../core/format';
import { toApiError } from '../core/api.service';
import { BpmApi } from '../bpm/data/bpm-api.service';
import type { SetupProfile } from '../bpm/data/bpm-models';
import { BpmPageContext, BpmRefresh, BpmState, bpmLoader } from '../bpm/ui';
import { PageToolbar, type PageFocus } from '../shared/page-toolbar.component';
import { AstraActions } from './astra-actions';

interface Draft { savings: string; wealth: string; horizon: string; rate: string; inflation: string }

const text = (cents: number | null | undefined) => cents === null || cents === undefined ? '' : String(Math.round(cents) / 100).replace('.', ',');
const pct = (value: number | null | undefined) => value === null || value === undefined ? '' : String(value).replace('.', ',');
const num = (raw: string) => { const n = Number(raw.replace(',', '.').trim()); return raw.trim() === '' || !Number.isFinite(n) ? null : n; };

function draftOf(p: SetupProfile | null): Draft {
  const v = p?.principal.vision;
  return {
    savings: text(v?.savingsTargetCents), wealth: text(p?.principal.patrimoine.objectiveCents),
    horizon: String(v?.horizonYears ?? 20), rate: pct(v?.annualReturnPct), inflation: pct(v?.inflationPct ?? 2),
  };
}

const W = 720, H = 250, L = 58, R = 18, T = 14, B = 30;
const compact = (cents: number) => {
  const e = cents / 100, a = Math.abs(e);
  if (a >= 1e6) return (e / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' M€';
  if (a >= 1e3) return Math.round(e / 1e3).toLocaleString('fr-FR') + ' k€';
  return Math.round(e).toLocaleString('fr-FR') + ' €';
};

/**
 * Objectif et projection : on fixe l'épargne visée par cycle et le patrimoine visé, puis on lit
 * aussitôt leur effet sur la durée, à partir du patrimoine constaté au dernier bilan. Le passé ne sert
 * que de point de départ ; chaque réglage est essayé avant d'être enregistré.
 */
@Component({
  selector: 'astra-goal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageToolbar, BpmState, CentsPipe, ShortDatePipe],
  providers: [BpmPageContext],
  templateUrl: './astra-goal.page.html',
})
export class AstraGoalPage {
  protected readonly ctx = inject(BpmPageContext);
  private readonly api = inject(BpmApi);
  private readonly refresh = inject(BpmRefresh);
  private readonly actions = inject(AstraActions, { optional: true });

  constructor() {
    // « Créer un objectif daté » (palette, onglets) arrive avec ?goal=new : la fenêtre s'ouvre ici.
    effect(() => {
      if (this.ctx.query().get('goal') !== 'new' || !this.actions) return;
      untracked(() => { this.actions!.create('goal'); void this.ctx.setQuery({ goal: null }, { replace: true }); });
    });
  }
  /** Action principale quand le cap est enregistré : un objectif daté, en fenêtre, sans quitter la page. */
  protected createGoal(): void {
    this.actions?.create('goal');
  }
  protected readonly W = W; protected readonly H = H; protected readonly L = L; protected readonly B = B;

  protected readonly profile = bpmLoader(() => 0, () => this.api.setupProfile());
  protected readonly life = bpmLoader(this.ctx.period, period => this.api.lifeManagement(period));
  private readonly saved = computed(() => draftOf(this.profile.data()));
  protected readonly draft = linkedSignal(() => this.saved());
  protected readonly dirty = computed(() => JSON.stringify(this.draft()) !== JSON.stringify(this.saved()));
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly error = signal('');

  /** Brouillon lu et contrôlé : une valeur invalide garde la dernière valeur enregistrée. */
  protected readonly parsed = computed(() => {
    const d = this.draft(), s = this.saved();
    const money = (raw: string, fallback: string) => {
      const v = parseAmount(raw);
      return v === 'invalid' || (v !== null && v < 0) ? { value: parseAmount(fallback) as number | null, invalid: true } : { value: v, invalid: false };
    };
    const savings = money(d.savings, s.savings), wealth = money(d.wealth, s.wealth);
    const horizon = num(d.horizon), rate = num(d.rate), inflation = num(d.inflation);
    return {
      savings, wealth,
      horizon: horizon !== null && horizon >= 1 && horizon <= 80 ? Math.round(horizon) : num(s.horizon) ?? 20,
      rate: rate !== null && rate >= -50 && rate <= 50 ? rate : num(s.rate),
      inflation: inflation !== null && inflation >= -20 && inflation <= 50 ? inflation : num(s.inflation) ?? 2,
      invalid: savings.invalid || wealth.invalid || (d.horizon.trim() !== '' && horizon === null) || (d.rate.trim() !== '' && rate === null),
    };
  });

  private readonly query = computed(() => {
    const p = this.parsed(), saved = parseAmount(this.saved().savings);
    const base = typeof saved === 'number' ? saved : 0;
    const extra = p.savings.value === null ? 0 : p.savings.value - base;
    return { basis: 'savings-goal' as const, horizon: p.horizon, rate: p.rate ?? undefined, inflation: p.inflation, extra: extra ? Math.round(extra * 100) / 100 : undefined };
  });
  protected readonly projection = bpmLoader(this.query, q => this.api.projection(q));

  protected readonly wealthTargetCents = computed(() => {
    const v = this.parsed().wealth.value;
    return v === null ? null : Math.round(v * 100);
  });

  /** L'année où le patrimoine, en euros d'aujourd'hui, atteint le patrimoine visé. */
  protected readonly reached = computed(() => {
    const target = this.wealthTargetCents(), rows = this.projection.data()?.rows ?? [];
    if (target === null || !rows.length) return null;
    const row = rows.find(r => r.realCents >= target);
    return row ? { year: row.year, n: row.n } : { year: null, n: null };
  });

  protected readonly year = linkedSignal(() => this.projection.data()?.rows.length ? this.projection.data()!.rows.length - 1 : 0);
  protected readonly cursor = computed(() => this.projection.data()?.rows[this.year()] ?? null);

  protected readonly chart = computed(() => {
    const rows = this.projection.data()?.rows ?? [];
    if (rows.length < 2) return null;
    const target = this.wealthTargetCents();
    const max = Math.max(...rows.map(r => r.nominalCents), target ?? 0, 1);
    const x = (i: number) => L + (i / (rows.length - 1)) * (W - L - R);
    const y = (v: number) => T + (1 - Math.max(0, v) / max) * (H - T - B);
    const line = (key: 'nominalCents' | 'realCents') => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join(' ');
    const nominal = line('nominalCents');
    const ticks = [0, .25, .5, .75, 1].map(f => ({ y: y(max * f), label: compact(max * f) }));
    const every = Math.max(1, Math.ceil(rows.length / 7));
    const years = rows.map((r, i) => ({ x: x(i), label: String(r.year) })).filter((_, i) => i % every === 0 || i === rows.length - 1);
    const goals = (this.projection.data()?.goals ?? []).filter(g => g.year !== undefined).map(g => {
      const i = rows.findIndex(r => r.year >= (g.year ?? 0));
      return i < 0 ? null : { x: x(i), label: g.label, status: g.status };
    }).filter((g): g is NonNullable<typeof g> => !!g);
    const sel = this.year();
    return {
      area: `${nominal} L${x(rows.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`,
      nominal, real: line('realCents'), ticks, years, goals,
      target: target === null ? null : y(target),
      cursor: { x: x(sel), nominal: y(rows[sel]?.nominalCents ?? 0), real: y(rows[sel]?.realCents ?? 0) },
    };
  });

  /** Le pont vers Mon quotidien : ce que le cycle en cours doit dégager pour tenir l'objectif. */
  protected readonly cycleCheck = computed(() => {
    const d = this.life.data(), target = this.parsed().savings.value;
    if (!d || target === null) return null;
    const expected = d.cycle.flows?.expectedCents ?? null;
    const targetCents = Math.round(target * 100);
    return { period: d.cycle.period?.label ?? 'Cycle en cours', expected, targetCents, gap: expected === null ? null : expected - targetCents, daysLeft: d.cycle.days?.left ?? null };
  });

  /** Module « Priorité » : l'essai en cours, sinon ce que le cycle en cours fait de l'objectif. */
  protected readonly focus = computed((): PageFocus | null => {
    if (this.dirty()) return { title: 'Essai en cours', detail: 'La projection montre vos nouveaux montants ; rien n’est encore enregistré.', tone: 'info' };
    const c = this.cycleCheck();
    if (!c || c.gap === null) return null;
    const euro = (v: number) => (v / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
    return c.gap >= 0
      ? { title: c.period + ' : objectif tenu', detail: 'Solde prévu ' + euro(c.expected ?? 0) + ' pour ' + euro(c.targetCents) + ' visés.', tone: 'success' }
      : { title: c.period + ' : il manque ' + euro(-c.gap), detail: 'Le solde prévu ne couvre pas l’épargne visée.', tone: 'warning' };
  });

  protected set(field: keyof Draft, value: string): void {
    this.message.set('');
    this.draft.update(d => ({ ...d, [field]: value }));
  }

  protected pickYear(value: string): void {
    this.year.set(Number(value));
  }

  protected reset(): void {
    this.draft.set(this.saved());
    this.error.set('');
  }

  protected async save(): Promise<void> {
    const p = this.profile.data();
    const v = this.parsed();
    if (!p || this.busy()) return;
    if (v.invalid) { this.error.set('Corrigez les montants et les pourcentages signalés avant d’enregistrer.'); return; }
    const d = this.draft(), s = this.saved();
    this.busy.set(true);
    this.error.set('');
    try {
      if (d.savings !== s.savings || d.horizon !== s.horizon || d.rate !== s.rate || d.inflation !== s.inflation) {
        await this.api.updateVision({
          expectedRevision: p.principal.revision, savingsTarget: v.savings.value,
          horizonYears: v.horizon, annualReturnPct: v.rate, inflationPct: v.inflation,
        });
      }
      if (d.wealth !== s.wealth) {
        await this.api.updatePatrimoine({ expectedRevision: p.principal.patrimoine.revision, objective: v.wealth.value });
      }
      this.message.set('Votre cap est enregistré : chaque cycle se mesure désormais à cet objectif.');
      this.refresh.bump();
    } catch (e) {
      this.error.set(toApiError(e).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected coverageLabel(status: string): string {
    return { funded: 'Couvert', partial: 'En partie couvert', unfunded: 'Non couvert', outOfHorizon: 'Au-delà de l’horizon', unknown: 'À estimer' }[status] ?? status;
  }
}
