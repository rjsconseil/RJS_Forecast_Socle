// Météo BPM : l'état du moment des trois sections MPV, lu dans les lectures existantes.
// - « Mon projet de vie » : les volets du projet de vie (cycle, charges, projets financés, résultats, patrimoine)
//   et les échéances à régler.
// - « Gestion de projet » : enveloppes, décisions, tâches en retard ou bloquées, temps des tâches, avancement.
// Chaque signal a un état (ok, watch, alert, unknown) ; la météo d'un ensemble de signaux suit une seule règle
// (WEATHER_RULE). S'y ajoutent les prévisions (ce qui arrive dans les 30 prochains jours) et les tendances (la
// météo de chaque cycle passé, d'après son bilan). Aucune lecture n'écrit ; aucun montant n'est recalculé.
import { addDays } from '../budget/api.mjs';
import { plural } from './format.mjs';

export const WEATHERS = {
  soleil: { key: 'soleil', label: 'Ensoleillé', symbol: '☀', rank: 0 },
  eclaircies: { key: 'eclaircies', label: 'Éclaircies', symbol: '⛅', rank: 1 },
  nuages: { key: 'nuages', label: 'Nuageux', symbol: '☁', rank: 2 },
  orage: { key: 'orage', label: 'Orageux', symbol: '⛈', rank: 3 },
};
export const WEATHER_RULE = [
  { weather: 'orage', when: 'Deux signaux en alerte ou plus.' },
  { weather: 'nuages', when: 'Un signal en alerte.' },
  { weather: 'eclaircies', when: 'Aucune alerte, mais au moins un signal à surveiller ou à renseigner.' },
  { weather: 'soleil', when: 'Tous les signaux sont en règle.' },
];
const HEALTH_LABEL = { ok: 'En règle', watch: 'À surveiller', alert: 'En alerte', unknown: 'À renseigner' };
const FORECAST_DAYS = 30;
const GOALS_DAYS = 365;

const eur = (c) => (c === null || c === undefined ? '—' : (c / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }));

/** La météo d'un ensemble de signaux, d'après WEATHER_RULE. */
export function weatherOf(signals) {
  const count = (h) => signals.filter((s) => s.health === h).length;
  const counts = { ok: count('ok'), watch: count('watch'), alert: count('alert'), unknown: count('unknown') };
  const key = counts.alert >= 2 ? 'orage' : counts.alert === 1 ? 'nuages' : counts.watch + counts.unknown > 0 ? 'eclaircies' : 'soleil';
  return { ...WEATHERS[key], counts };
}

const signal = (key, label, health, figure, text, link, action, extra = {}) => ({ key, label, health, healthLabel: HEALTH_LABEL[health], figure, text, link, action, ...extra });
const worst = (...hs) => ['alert', 'watch', 'unknown', 'ok'].find((h) => hs.includes(h)) ?? 'ok';

/**
 * @param bpm les lectures du module BPM : life, projects, bilans, reads
 */
/** Éléments du calendrier Budget/Patrimoine lus par les prévisions, et leur genre dans la Météo. */
const FORECAST_KINDS = {
  revenu: 'flux', 'revenu-recurrent': 'flux', depense: 'flux', 'depense-recurrente': 'flux', 'reglement-projet': 'flux',
  'tache-echeance': 'tache', 'fin-periode': 'cycle', 'decision-enveloppes': 'decision',
};
const detailOf = (event, ...labels) => labels.map((label) => event.details.find((d) => d.label === label)?.value).filter(Boolean).join(' · ') || null;
const splitLink = (link) => {
  if (!link) return { link: null, query: undefined };
  const [path, search] = link.split('?');
  return { link: path, query: search ? Object.fromEntries(new URLSearchParams(search)) : undefined };
};

export function createMeteo({ life, projects, bilans, reads, calendar }) {
  /** Section 01 : les volets du projet de vie, dans l'ordre de leur lecture, puis les échéances. */
  function lifeSignals(l) {
    const v = Object.fromEntries(l.pilot.volets.map((x) => [x.key, x]));
    const f = l.cycle.flows ?? {};
    const out = [];
    const volet = (key, figure, link, action, okText) => {
      const x = v[key];
      if (x) out.push(signal(key, x.label, x.health, figure, x.alert ?? okText, link, action));
    };
    volet('cycle', l.cycle.days ? `Reste ${eur(f.netCents)} · jour ${l.cycle.days.elapsed} sur ${l.cycle.days.total}` : 'Cycle à configurer', '/projet-de-vie/cloture', 'Ouvrir le cycle',
      `${l.cycle.period?.label ?? 'Cycle à configurer'} : ${eur(f.receivedCents)} reçus, ${eur(f.paidCents)} dépensés.`);
    for (const key of ['indispensable', 'courante']) {
      const n = l.natures[key];
      volet(key, `${eur(n.paidCents)} réglés${n.toPayCents ? ` · ${eur(n.toPayCents)} à régler` : ''}`, key === 'indispensable' ? '/projet-de-vie/budget-type' : '/plafonds',
        key === 'indispensable' ? 'Ouvrir le budget type' : 'Ouvrir les plafonds',
        n.capCents ? `Plafond ${eur(n.capCents)} · marge ${eur(n.marginCents)}.` : 'Dans le cadre fixé.');
    }
    const p = l.projects;
    volet('projets', `${eur(p.paidCents)} réglés sur ${eur(p.allocatedCents)}`, '/projet-de-vie/projets', 'Ouvrir les projets de la vie',
      `${plural(p.projectCount, 'projet')} de la vie, ${plural(p.fundedCount, 'financé')}.`);
    const r = l.results;
    volet('resultats', r.toCloseCount ? `${plural(r.toCloseCount, 'cycle')} à clôturer` : `${plural(r.count, 'cycle clos', 'cycles clos')}`,
      r.toCloseCount ? '/projet-de-vie/cloture' : '/projet-de-vie/bilans', r.toCloseCount ? 'Clôturer un cycle' : 'Ouvrir les bilans',
      r.count ? `Résultat moyen ${eur(r.averageCents)} par cycle clos.` : 'Aucun cycle clos pour l’instant.');
    const d = l.dueSoon;
    const soon = d.lines.length - d.lateCount;
    out.push(signal('echeances', 'Échéances à régler', d.lateCount ? 'alert' : soon ? 'watch' : 'ok',
      d.lateCount ? `${plural(d.lateCount, 'retard')}` : soon ? `${soon} sous 7 jours` : 'Rien à régler',
      d.lateCount ? `${plural(d.lateCount, 'règlement')} en retard${soon ? `, ${soon} autre(s) d’ici 7 jours` : ''}.` : soon ? `${plural(soon, 'règlement')} attendu(s) d’ici 7 jours.` : 'Aucun règlement en retard ni attendu cette semaine.',
      '/projet-de-vie/echeances', 'Régler les échéances'));
    return out;
  }

  function wealthSignals(ctx, l) {
    const w = l.patrimoine;
    const movements = reads.projectFlows(ctx, { source: 'patrimoine' });
    const netPending = movements.totals.pendingReceivedCents - movements.totals.pendingPaidCents;
    const after = w.stockCents === null ? null : w.stockCents + netPending;
    return [
      signal('stock', 'Patrimoine disponible', w.stockCents === null ? 'unknown' : w.stockCents < 0 ? 'alert' : 'ok', eur(w.stockCents), 'Stock initial + résultats déjà capitalisés + gains directs − dépenses directes validées. Le cycle ouvert n’est pas encore capitalisé.', '/vision', 'Ouvrir le patrimoine'),
      signal('mouvements', 'Achats et gains annoncés', after === null ? 'unknown' : after < 0 ? 'alert' : movements.pending.length ? 'watch' : 'ok', `${eur(movements.totals.pendingPaidCents)} à régler`, `${eur(movements.totals.pendingReceivedCents)} à recevoir ; stock après ces mouvements : ${eur(after)}. Aucun résultat de cycle futur n’est ajouté ici.`, '/vision', 'Ouvrir les projets sur le patrimoine', { fragment: 'wealth-project-flows' }),
      signal('cap', 'Cap patrimonial', w.objectiveCents == null ? 'unknown' : 'ok', w.objectiveCents == null ? 'À fixer' : eur(w.objectiveCents), w.objectiveCents == null ? 'Fixez le stock que vous souhaitez construire.' : w.stockCents === null ? 'Renseignez le stock pour mesurer la progression.' : `${eur(Math.max(0, w.objectiveCents - w.stockCents))} restent à constituer. Un objectif ne réserve pas d’argent.`, '/vision/reperes', 'Fixer le cap patrimonial'),
    ];
  }

  /** La météo d'un projet de la vie : son enveloppe, ses tâches, son temps. */
  function projectWeather(entry, tasks, now) {
    const b = entry.budget ?? {};
    const mine = tasks.filter((t) => t.task.projectId === entry.project.id);
    const open = mine.filter((t) => t.task.status !== 'done');
    const late = open.filter((t) => t.task.dueDate && t.task.dueDate < now);
    const blocked = open.filter((t) => t.task.status === 'blocked');
    const over = mine.filter((t) => t.budget?.over);
    const noEstimate = open.filter((t) => t.budget?.shareCents !== null && t.budget?.shareCents !== undefined && !t.task.plannedHours);
    const signals = [
      signal('enveloppe', 'Enveloppe', b.deficit ? 'alert' : b.pendingOverrun ? 'watch' : b.allocationCents === null || b.allocationCents === undefined ? 'unknown' : 'ok',
        b.allocationCents === null || b.allocationCents === undefined ? 'À attribuer' : `Reste ${eur(b.remainingCents)}`,
        b.deficit ? 'L’enveloppe est dépassée.' : b.pendingOverrun ? 'Un dépassement attend votre décision.' : '', null, null),
      signal('retard', 'Tâches en retard', late.length ? 'alert' : 'ok', String(late.length), '', null, null),
      signal('parts', 'Parts dépassées', over.length ? 'alert' : 'ok', String(over.length), '', null, null),
      signal('bloquees', 'Tâches bloquées', blocked.length ? 'watch' : 'ok', String(blocked.length), '', null, null),
      signal('estimation', 'Temps à estimer', noEstimate.length ? 'unknown' : 'ok', String(noEstimate.length), '', null, null),
      signal('vide', 'Tâches', mine.length ? 'ok' : 'watch', String(mine.length), mine.length ? '' : 'Aucune tâche : le projet n’avance pas encore.', null, null),
    ];
    const reasons = signals.filter((s) => s.health !== 'ok').map((s) => (s.text || `${s.label} : ${s.figure}`));
    return {
      projectId: entry.project.id,
      title: entry.project.title,
      status: entry.view.status,
      statusLabel: entry.view.statusLabel,
      completionPercent: entry.view.completionPercent,
      taskCount: mine.length,
      fundingSource: b.fundingSource ?? 'cycle',
      allocationCents: b.allocationCents ?? null,
      remainingCents: b.remainingCents ?? null,
      weather: weatherOf(signals),
      reasons,
    };
  }

  /** Section 02 : la gestion de projet, d'après le tableau des projets et celui des tâches. */
  function projectSignals(ov, tv, now) {
    const list = ov.projects.filter((x) => x.role !== 'life' && !x.budget?.abandoned);
    const tasks = tv.tasks.filter((t) => t.projectRole !== 'life');
    const open = tasks.filter((t) => t.task.status !== 'done');
    const deficits = list.filter((x) => x.budget?.deficit);
    const overruns = list.filter((x) => x.budget?.pendingOverrun);
    const unfunded = list.filter((x) => x.budget?.allocationCents === null || x.budget?.allocationCents === undefined);
    const decisions = (ov.life?.pendingRequests?.length ?? 0) + (ov.life?.taskRequests?.length ?? 0);
    const late = open.filter((t) => t.task.dueDate && t.task.dueDate < now);
    const week = open.filter((t) => t.task.dueDate && t.task.dueDate >= now && t.task.dueDate <= addDays(now, 7));
    const blocked = open.filter((t) => t.task.status === 'blocked');
    const over = tasks.filter((t) => t.budget?.over);
    const noEstimate = open.filter((t) => t.budget?.shareCents !== null && t.budget?.shareCents !== undefined && !t.task.plannedHours);
    const empty = list.filter((x) => !x.view.taskIds.length);
    const done = tasks.filter((t) => t.task.status === 'done').length;

    const signals = [
      signal('enveloppes', 'Enveloppes des projets', deficits.length ? 'alert' : overruns.length ? 'watch' : unfunded.length ? 'unknown' : 'ok',
        `${list.length - unfunded.length} sur ${list.length} financé(s)`,
        deficits.length ? `${plural(deficits.length, 'projet')} au-delà de l’enveloppe : ${deficits.map((x) => x.project.title).join(', ')}.`
          : overruns.length ? `${plural(overruns.length, 'dépassement')} en attente de décision.`
            : unfunded.length ? `${plural(unfunded.length, 'projet')} sans enveloppe : ${unfunded.map((x) => x.project.title).join(', ')}.` : 'Chaque projet tient dans son enveloppe.',
        '/app/gestion-projet/financement', 'Ouvrir le financement'),
      signal('decisions', 'Décisions à prendre', decisions ? 'watch' : 'ok', decisions ? plural(decisions, 'demande') : 'Aucune',
        decisions ? `${plural(decisions, 'demande')} de part ou de dépassement attend(ent) votre accord.` : 'Aucune demande en attente.',
        '/app/gestion-projet/financement', 'Accorder ou refuser', { fragment: 'project-decisions-title' }),
      signal('retards', 'Tâches en retard', late.length ? 'alert' : week.length ? 'watch' : 'ok',
        late.length ? `${plural(late.length, 'tâche')} en retard` : week.length ? `${week.length} à rendre sous 7 jours` : 'Aucun retard',
        late.length ? `En retard : ${late.slice(0, 3).map((t) => t.task.title).join(', ')}${late.length > 3 ? '…' : ''}.` : week.length ? `${plural(week.length, 'tâche')} arrive(nt) à échéance cette semaine.` : 'Toutes les tâches datées sont dans les temps.',
        '/app/taches', 'Ouvrir les tâches'),
      signal('bloquees', 'Tâches bloquées', blocked.length >= 3 ? 'alert' : blocked.length ? 'watch' : 'ok', blocked.length ? plural(blocked.length, 'tâche') : 'Aucune',
        blocked.length ? `Bloquées : ${blocked.slice(0, 3).map((t) => t.task.title).join(', ')}${blocked.length > 3 ? '…' : ''}.` : 'Rien ne bloque le travail.',
        '/app/taches', 'Avancer les tâches'),
      signal('temps', 'Temps et parts des tâches', over.length ? 'alert' : noEstimate.length ? 'unknown' : 'ok',
        over.length ? `${plural(over.length, 'part')} dépassée(s)` : noEstimate.length ? `${noEstimate.length} à estimer` : 'Dans les temps',
        over.length ? `Au-delà de leur part (temps ou achats) : ${over.slice(0, 3).map((t) => t.task.title).join(', ')}${over.length > 3 ? '…' : ''}.`
          : noEstimate.length ? `${plural(noEstimate.length, 'tâche')} avec une part mais sans temps prévu : leur budget restant est inconnu.` : 'Chaque tâche avec une part a son temps prévu et le respecte.',
        '/app/taches', 'Ouvrir les tâches'),
      signal('avancement', 'Avancement', empty.length ? 'watch' : 'ok', `${done} sur ${tasks.length} tâche(s) terminée(s)`,
        empty.length ? `${plural(empty.length, 'projet')} sans tâche : ${empty.map((x) => x.project.title).join(', ')}.` : list.length ? 'Chaque projet a au moins une tâche.' : 'Aucun projet de la vie pour l’instant.',
        '/projet-de-vie/projets', 'Ouvrir les projets de la vie'),
    ];
    const perProject = list.map((x) => projectWeather(x, tasks, now)).sort((a, b) => b.weather.rank - a.weather.rank || a.title.localeCompare(b.title));
    return { signals, projects: perProject };
  }

  /**
   * Ce qui arrive dans les 30 prochains jours, et les objectifs datés de l'année. Les dates viennent du calendrier
   * Budget/Patrimoine (seule source des événements datés du projet de vie) : la Météo choisit ce qu'elle en garde
   * (ce qui reste à régler ou à faire) et le présente, sans recalculer aucune date.
   */
  function forecast(ctx, l, now) {
    const to = addDays(now, FORECAST_DAYS);
    // Fenêtre la plus large que le calendrier accepte : une tâche ou un règlement de projet en retard reste
    // annoncé ; les règlements du quotidien, eux, partent de la première période ouverte.
    const events = calendar().events(ctx, 'budgetPatrimoine', { from: addDays(to, -399), to });
    const openFrom = l.dueSoon.from ?? now;
    const items = [];
    for (const e of events) {
      const genre = FORECAST_KINDS[e.element];
      if (!genre || e.done || e.status === 'unrealized') continue;
      const late = e.date < now;
      const { link, query } = splitLink(e.link);
      if (genre === 'flux') {
        const project = e.element === 'reglement-projet';
        if (!project && e.date < openFrom) continue;
        const incoming = e.direction === 'entree';
        items.push({ id: e.objectId, date: e.date, kind: incoming ? 'entree' : 'depense', label: e.title,
          detail: project ? detailOf(e, 'Projet', 'Tâche', 'Financement') : detailOf(e, 'Centre de coût'),
          amountCents: e.amountCents === null ? null : incoming ? e.amountCents : -e.amountCents, late, link, query,
          fundingSource: project && detailOf(e, 'Financement') === 'Patrimoine' ? 'patrimoine' : 'cycle' });
      } else if (genre === 'tache') {
        items.push({ date: e.date, kind: 'tache', label: e.title, detail: e.groupLabel ? `Projet « ${e.groupLabel} »` : null, amountCents: null, late, link, query });
      } else if (genre === 'cycle') {
        // Seule la fin du cycle en cours est annoncée ; une période terminée non close relève de la Clôture.
        if (e.date < now) continue;
        const current = e.date === l.cycle.period?.end;
        items.push({ date: e.date, kind: 'cycle', label: current ? `Fin du cycle ${l.cycle.period.label}` : e.title, detail: 'Le résultat rejoindra le patrimoine à la clôture.',
          amountCents: current ? l.cycle.flows.expectedCents ?? null : null, late: false, link, query });
      } else {
        items.push({ date: e.date, kind: 'decision', label: e.title, detail: detailOf(e, 'Décision'), amountCents: null, late, link, query });
      }
    }
    items.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
    const horizon = (days) => {
      const lim = addDays(now, days);
      const xs = items.filter((x) => x.date <= lim && x.amountCents !== null && x.kind !== 'cycle');
      return {
        days,
        incomingCents: xs.filter((x) => x.amountCents > 0).reduce((s, x) => s + x.amountCents, 0),
        outgoingCents: -xs.filter((x) => x.amountCents < 0).reduce((s, x) => s + x.amountCents, 0),
        tasks: items.filter((x) => x.kind === 'tache' && x.date <= lim).length,
      };
    };
    // Objectifs datés : les dates viennent du calendrier du patrimoine, les montants des lectures BPM.
    const goalsTo = addDays(now, GOALS_DAYS);
    const dated = new Set(calendar().events(ctx, 'patrimoine', { from: addDays(goalsTo, -399), to: goalsTo })
      .filter((e) => e.element === 'objectif').map((e) => e.objectId));
    const goals = reads.events(ctx).rows.filter((g) => dated.has(g.goalId))
      .map((g) => ({ date: g.date, label: g.label, futureCostCents: g.futureCostCents, provisionPerPeriodCents: g.provisionPerPeriodCents }));
    return { from: now, to, lateCount: items.filter((x) => x.late).length, items, horizons: [horizon(7), horizon(FORECAST_DAYS)], goals, cycleDaysLeft: l.cycle.days?.left ?? null };
  }

  /** La météo de chaque cycle, d'après son bilan : résultat positif, nul ou négatif, et l'épargne visée. */
  function trends(ctx, l) {
    const list = bilans.list(ctx);
    const target = l.results.savingsTargetCents ?? null;
    const rows = list.bilans.map((b) => {
      const quiet = !b.receivedCents && !b.spentCents;
      const r = b.resultCents ?? 0;
      const key = quiet ? null : r < 0 ? 'orage' : r === 0 ? 'nuages' : target !== null && r < target ? 'eclaircies' : 'soleil';
      return {
        period: b.period, status: b.status, source: b.source, receivedCents: b.receivedCents, spentCents: b.spentCents, resultCents: b.resultCents,
        projectsCents: b.projectsCents, withdrawnCents: b.withdrawnCents, stockAfterCents: b.stockAfterCents,
        weather: key ? WEATHERS[key] : null, headline: b.highlights[0]?.title ?? null,
      };
    });
    const closed = rows.filter((x) => x.status === 'closed' && x.weather);
    const last = closed.slice(0, 3).map((x) => x.resultCents ?? 0);
    const prev = closed.slice(3, 6).map((x) => x.resultCents ?? 0);
    const avg = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
    const direction = last.length && prev.length ? (avg(last) > avg(prev) ? 'hausse' : avg(last) < avg(prev) ? 'baisse' : 'stable') : null;
    const tally = Object.fromEntries(Object.keys(WEATHERS).map((k) => [k, rows.filter((x) => x.weather?.key === k).length]));
    return { savingsTargetCents: target, rows, tally, direction, recentAverageCents: avg(last), previousAverageCents: avg(prev), totals: list.totals };
  }

  /** La météo complète : les deux sections, la météo d'ensemble, les prévisions et les tendances. */
  function report(ctx) {
    const l = life.lifeManagement(ctx, {});
    const ov = projects.overview(ctx);
    const tv = projects.tasksOverview(ctx);
    const now = l.context.calculationDate;
    const one = lifeSignals(l);
    const two = projectSignals(ov, tv, now);
    const three = wealthSignals(ctx, l);
    const sections = [
      { key: 'projet-de-vie', label: 'Mon projet de vie', link: '/meteo/projet-de-vie', home: '/projet-de-vie', weather: weatherOf(one), signals: one },
      { key: 'gestion-de-projet', label: 'Gestion de projet', link: '/meteo/gestion-de-projet', home: '/projet-de-vie/projets', weather: weatherOf(two.signals), signals: two.signals, projects: two.projects },
      { key: 'patrimoine', label: 'Patrimoine', link: '/meteo/patrimoine', home: '/vision', weather: weatherOf(three), signals: three },
    ];
    const all = [...one, ...two.signals, ...three];
    const overall = weatherOf(all);
    const alerts = all.filter((s) => s.health === 'alert');
    return {
      context: { ...l.context, today: now },
      overall: { ...overall, worst: worst(...all.map((s) => s.health)), headline: alerts.length ? alerts.map((s) => s.label).join(' · ') : null },
      sections,
      forecast: forecast(ctx, l, now),
      trends: trends(ctx, l),
      legend: { weathers: Object.values(WEATHERS), rule: WEATHER_RULE, health: HEALTH_LABEL },
    };
  }

  return { report };
}
