import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { BpmRouterLink } from '../ui/bpm-router-link';
import { BpmAmount } from '../ui/amount';
import { VoletView } from './life-volets';

@Component({
  selector: 'bpm-life-topic-summary',
  imports: [BpmAmount, BpmRouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let v = volet();
    <section class="topic-summary" [attr.data-volet]="v.key" aria-labelledby="life-topic-title">
      <header>
        <div><span>{{ v.tag }}</span><h2 id="life-topic-title">{{ v.gauge.heading }}</h2></div>
        <strong class="pm-life-health" [attr.data-health]="v.health">{{ v.healthLabel }}</strong>
      </header>
      @if (v.alert) { <p class="pm-project-alert" [attr.data-health]="v.health">{{ v.alert }}</p> }
      <div class="topic-actions" role="group" [attr.aria-label]="'Actions · ' + v.title">
        @for (a of actions(); track a.label; let first = $first) {
          @if (a.action === 'entry-income' || a.action === 'entry-charge') {
            <button class="btn btn-secondary" type="button" [disabled]="!canEnter()" (click)="entry.emit(a.action === 'entry-income' ? 'income' : 'charge')">{{ a.label }}</button>
          } @else {
            <a class="btn" [class.btn-primary]="first" [class.btn-secondary]="!first"
              [routerLink]="a.link" [fragment]="a.fragment" [queryParams]="{ period: period(), ...a.queryParams }">{{ a.label }}</a>
          }
        }
      </div>
      @if (!v.hideGauge) {
        <dl class="amounts">
          @for (metric of [v.gauge.first, v.gauge.middle, v.gauge.last]; track metric.label) {
            <div><dt>{{ metric.label }}</dt><dd [bpmAmount]="metric.amountCents" [bpmFlow]="metric.flow" [bpmTone]="metric.amountTone">{{ metric.value }}</dd></div>
          }
        </dl>
        <div class="progress">
          <span>{{ v.gauge.meter.percent === null ? v.gauge.meter.aria : v.gauge.meter.label }}</span>
          @if (v.gauge.meter.percent !== null) { <progress max="100" [value]="v.gauge.meter.percent" [attr.aria-label]="v.gauge.meter.aria"></progress> }
        </div>
      }
      <dl class="facts">
        @for (f of facts(); track f.label) {
          <div><dt>{{ f.label }}</dt><dd [bpmAmount]="f.amountCents" [bpmFlow]="f.flow" [bpmTone]="f.amountTone">{{ f.value }}</dd>@if (f.note) { <small>{{ f.note }}</small> }</div>
        }
      </dl>
      @if (v.gauge.band; as band) {
        <p>{{ band.label }} · <strong [bpmAmount]="band.amountCents" [bpmTone]="band.amountTone ?? (band.amountCents !== undefined ? null : band.tone === 'green' ? 'success' : band.tone === 'yellow' ? 'warning' : 'info')">{{ band.value }} {{ band.unit }}</strong> {{ band.sub }} {{ band.note }}</p>
      }
      @if (v.gauge.caption) { <p>{{ v.gauge.caption }}</p> }
    </section>
  `,
  styles: `
    :host { display:block; min-width:0; }
    .topic-summary { display:grid; gap:16px; min-width:0; padding:clamp(16px,2vw,28px); border:1px solid var(--line); border-radius:14px; background:var(--bpm-surface,var(--raised-surface)); }
    header, .topic-actions, .progress { display:flex; flex-wrap:wrap; align-items:center; gap:8px 12px; }
    header { justify-content:space-between; }
    .topic-summary h2, .topic-summary p, dl, dd { margin:0; }
    header span, dt, small, p, .progress { color:var(--muted); font-size:.82rem; }
    .amounts, .facts { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,145px),1fr)); gap:12px; }
    .amounts > div { padding:12px 16px; background:var(--bpm-soft,var(--soft)); border-radius:8px; }
    dd { margin-top:4px; font-weight:650; font-variant-numeric:tabular-nums; }
    .amounts dd { font-size:clamp(1.1rem,2vw,1.6rem); }
    .facts { padding-top:12px; border-top:1px solid var(--line); }
    .facts small { display:block; }
    .pm-life-health { padding:4px 9px; border-radius:6px; font-size:.8rem; }
    .topic-summary [data-health="ok"] { color:var(--status-success); background:var(--status-success-surface); }
    .topic-summary [data-health="watch"] { color:var(--status-warning); background:var(--status-warning-surface); }
    .topic-summary [data-health="alert"] { color:var(--status-danger); background:var(--status-danger-surface); }
    .topic-summary [data-health="unknown"] { color:var(--status-info); background:var(--status-info-surface); }
    .pm-project-alert { padding:10px 12px; border-radius:6px; }
    progress { height:6px; accent-color:var(--app-accent); }
  `,
})
export class BpmLifeTopicSummary {
  readonly volet = input.required<VoletView>();
  readonly period = input<string | null>();
  readonly canEnter = input(false);
  readonly entry = output<'income' | 'charge'>();
  protected readonly actions = computed(() => [this.volet().primary, ...this.volet().actions]);
  protected readonly facts = computed(() => {
    const v = this.volet();
    const labels = new Set([v.gauge.first.label, v.gauge.middle.label, v.gauge.last.label]);
    const facts = v.facts.filter(f => !labels.has(f.label) || f.note);
    const figures = v.figures.filter(f => !facts.some(fact => fact.label === f.label && fact.value === f.value));
    return [...facts, ...figures.map(f => ({ ...f, note: '', amountTone: f.amountTone ?? (f.pending ? 'warning' as const : undefined) }))];
  });
}
