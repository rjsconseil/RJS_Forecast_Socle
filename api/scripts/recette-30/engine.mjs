// Moteur de la recette « 30 cas » : chaque cas est une chronologie d'événements datés, jouée avec
// l'horloge de recette, uniquement par les commandes du socle et des middlewares (aucune mutation brute).
// Un registre indépendant (l'oracle) recalcule ce que le site doit afficher ; les écarts deviennent des constats.
import { randomUUID } from "node:crypto";
import { occurrenceDates } from "../../src/modules/budget/recurrence.mjs";

export const TODAY = "2026-11-06";

const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m, d));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};
const parts = (s) => s.split("-").map(Number);
export const addDays = (s, n) => {
  const [y, m, d] = parts(s);
  return iso(y, m - 1, d + n);
};
const addMonths = (s, n) => {
  const [y, m, d] = parts(s);
  return iso(y, m - 1 + n, d);
};
export const cents = (euros) => Math.round(euros * 100);

/** Les trois cycles clos et le cycle en cours, pour un jour d'ancrage donné, à la date de recette. */
export function cyclesFor(anchorDay, today = TODAY) {
  const [y, m, d] = parts(today);
  const current = d >= anchorDay ? iso(y, m - 1, anchorDay) : iso(y, m - 2, anchorDay);
  const starts = [-3, -2, -1, 0].map((k) => addMonths(current, k));
  return starts.map((start, i) => ({
    index: i,
    key: start.slice(0, 7),
    start,
    end: addDays(addMonths(start, 1), -1),
    closed: i < 3,
  }));
}

/** Date d'un jour donné dans un cycle (le jour est compté depuis le début du cycle, 1 = premier jour). */
export const dayOf = (cycle, n) => addDays(cycle.start, n - 1);

export class Case {
  constructor(socle, spec, { prefix, report }) {
    this.socle = socle;
    this.spec = spec;
    this.prefix = prefix;
    this.report = report;
    this.P = socle.modules.bpm.projects;
    this.B = socle.modules.budget;
    this.C = socle.modules.core;
    this.bpm = socle.modules.bpm;
    this.cycles = cyclesFor(spec.anchorDay ?? 1);
    this.events = [];
    this.ledger = {}; // clé de période -> { inCents, outCents, projectOutCents }
    this.planned = []; // prévisions du budget de vie : { direction, amountCents, date, settled: () => bool }
    this.recs = {}; // nom -> { id, spec, settled: Map(date -> realizedDate) }
    this.projects = {}; // nom -> { coreProjectId, budgetId, tasks: { nom -> id } }
    this.ops = {}; // nom -> opération
    this.checks = [];
    this.notes = [];
    this.ctx = null;
  }

  // ————— Chronologie —————
  at(date, label, fn, priority = 1) {
    this.events.push({ date, label, fn, priority, seq: this.events.length });
  }

  periodOf(date) {
    // Le registre suit la même règle que le cycle : jour d'ancrage, période nommée par son mois de début.
    const anchor = this.spec.anchorDay ?? 1;
    const [y, m, d] = parts(date);
    const start = d >= anchor ? iso(y, m - 1, anchor) : iso(y, m - 2, anchor);
    return start.slice(0, 7);
  }

  book(scope, direction, amountCents, realizedDate) {
    const k = this.periodOf(realizedDate);
    const l = (this.ledger[k] ??= { inCents: 0, outCents: 0, projectOutCents: 0 });
    if (direction === "income") {
      if (scope === "life") l.inCents += amountCents;
    } else {
      l.outCents += amountCents;
      if (scope === "project") l.projectOutCents += amountCents;
    }
  }

  unbook(scope, direction, amountCents, realizedDate) {
    this.book(scope, direction, -amountCents, realizedDate);
  }

  // ————— Constats —————
  check(name, observed, expected) {
    const ok = JSON.stringify(observed) === JSON.stringify(expected);
    this.checks.push({ name: `${this.spec.id} ${name}`, ok, expected, observed });
    return ok;
  }

  note(text) {
    this.notes.push(`${this.spec.id} ${text}`);
  }

  async refusal(name, action, code) {
    try {
      await action();
      this.check(name, "Autorisé", code);
    } catch (e) {
      this.check(name, e.code, code);
    }
  }

  key() {
    return `r30-${this.spec.id}-${randomUUID()}`;
  }

  async clock(date, fn) {
    const saved = process.env.SOCLE_TODAY;
    process.env.SOCLE_TODAY = date;
    try {
      return await fn();
    } finally {
      if (saved === undefined) delete process.env.SOCLE_TODAY;
      else process.env.SOCLE_TODAY = saved;
    }
  }

  // ————— Profil —————
  label() {
    return `${this.prefix} · ${this.spec.id} · ${this.spec.title}`;
  }

  async createUser() {
    const s = this.spec;
    const c0 = this.cycles[0];
    const u = await this.clock(c0.start, () =>
      this.socle.modules.users.createUser({
        requestKey: this.key(),
        label: this.label(),
        userType: s.userType ?? "individuel",
        anchorDay: s.anchorDay ?? 1,
        cycleStartDate: c0.start,
        openingStock: s.openingStock === undefined ? 5000 : s.openingStock,
        openingDate: s.openingStock === null ? null : c0.start,
        objective: s.objective ?? null,
      }),
    );
    this.ctx = { userId: u.userId };
    this.userId = u.userId;
    return u;
  }

  /**
   * Définition récurrente du budget de vie (ou d'un projet) et ses règlements par défaut, à la date prévue.
   * `settle(date)` peut renvoyer null (non réglé), ou { realizedDate, realizedAmount }.
   */
  recurrence(name, def, { settle, project, task, createAt } = {}) {
    const firstDate = def.firstDate;
    const spec = { cadence: def.cadence ?? "monthly", firstDate, endDate: def.endDate ?? null };
    const entry = (this.recs[name] = { id: null, spec, def, settled: new Map(), ops: new Map(), project, task });
    const scope = project ? "project" : "life";
    this.at(createAt ?? this.cycles[0].start, `Créer ${name}`, async () => {
      const p = project ? this.projects[project] : null;
      const r = await this.B.createRecurrence(this.ctx, {
        requestKey: this.key(),
        budgetId: p?.budgetId,
        taskId: p && task ? p.tasks[task] : undefined,
        direction: def.direction,
        label: def.label ?? name,
        amount: def.amount,
        cadence: spec.cadence,
        firstDate,
        endDate: spec.endDate ?? undefined,
        costCenterRef: def.center,
        categoryId: def.category ? this.categories[def.category] : undefined,
      });
      entry.id = r.recurrence.id;
    }, 0.5);
    const dates = occurrenceDates(spec, this.cycles[0].start, this.cycles[3].end);
    for (const date of dates) {
      const plan = settle ? settle(date) : { realizedDate: date };
      if (scope === "life")
        this.planned.push({
          direction: def.direction,
          amountCents: cents(def.amount),
          date,
          settledBy: () => entry.settled.get(date),
          recurrence: name,
        });
      if (!plan || plan.realizedDate > TODAY) continue;
      const realizedDate = plan.realizedDate;
      const realizedAmount = plan.realizedAmount ?? def.amount;
      this.at(realizedDate, `Régler ${name} du ${date}`, async () => {
        const r = await this.B.settleOccurrence(this.ctx, entry.id, {
          requestKey: this.key(),
          occurrenceDate: date,
          realizedDate,
          realizedAmount,
          fund: project ? true : undefined,
        });
        entry.settled.set(date, realizedDate);
        entry.ops.set(date, r.operation.id);
        this.book(scope, def.direction, cents(realizedAmount), realizedDate);
      });
    }
    return entry;
  }

  /** Opération ponctuelle du budget de vie (ou d'un projet) ; réglée si `realizedDate` est donnée. */
  operation(name, def) {
    const scope = def.project ? "project" : "life";
    const date = def.date;
    const realizedDate = def.realizedDate === undefined ? date : def.realizedDate;
    const record = { direction: def.direction ?? "charge", amountCents: cents(def.amount), date, settledBy: () => this.ops[name]?.status === "realized" ? this.ops[name].realizedDate : undefined, operation: name };
    if (scope === "life") this.planned.push(record);
    const when = def.at ?? (realizedDate && realizedDate <= TODAY ? realizedDate : null) ?? (date <= TODAY ? date : TODAY);
    this.at(when, `Saisir ${name}`, async () => {
      const p = def.project ? this.projects[def.project] : null;
      const realized = realizedDate && realizedDate <= TODAY;
      const r = await this.B.createOperation(this.ctx, {
        requestKey: this.key(),
        budgetId: p?.budgetId,
        taskId: p && def.task ? p.tasks[def.task] : undefined,
        direction: record.direction,
        label: def.label ?? name,
        amount: def.amount,
        date,
        status: realized ? "realized" : "planned",
        realizedDate: realized ? realizedDate : undefined,
        realizedAmount: realized ? def.realizedAmount : undefined,
        costCenterRef: def.center,
        categoryId: def.category ? this.categories[def.category] : undefined,
        fund: p && realized ? (def.fund ?? true) : undefined,
      });
      this.ops[name] = r.operation;
      if (realized && !def.excluded) this.book(scope, record.direction, cents(def.realizedAmount ?? def.amount), realizedDate);
    });
  }

  categories = {};

  // ————— Projets de la vie —————
  project(name, def) {
    this.at(def.date, `Créer le projet ${name}`, async () => {
      const p = await this.P.createProject(this.ctx, {
        requestKey: this.key(),
        title: def.title ?? name,
        description: def.description,
        amount: def.amount ?? null,
      });
      const tasks = {};
      for (const t of def.tasks) {
        const r = await this.P.createTask(this.ctx, {
          requestKey: this.key(),
          projectId: p.coreProjectId,
          title: t.title,
          description: t.description,
          plannedHours: t.plannedHours ?? null,
          spentHours: t.spentHours ?? 0,
          dueDate: t.dueDate ?? null,
        });
        tasks[t.key] = r.task.id;
      }
      this.projects[name] = { coreProjectId: p.coreProjectId, budgetId: p.budgetId, tasks };
    }, 0.2);
  }

  detail(name) {
    return this.P.projectDetail(this.ctx, this.projects[name].coreProjectId);
  }

  async taskStatus(project, task, status) {
    const id = this.projects[project].tasks[task];
    await this.C.changeTaskStatus(this.ctx, id, { expectedRevision: this.socle.state.tasks[id].revision, status });
  }

  async taskTime(project, task, time) {
    const id = this.projects[project].tasks[task];
    await this.C.setTaskTime(this.ctx, id, { expectedRevision: this.socle.state.tasks[id].revision, ...time });
  }

  // ————— Clôtures et contrôles du cycle —————
  scheduleClosures() {
    for (const c of this.cycles.filter((c) => c.closed))
      this.at(addDays(c.end, 1), `Clore ${c.key}`, () => this.close(c), 0);
  }

  expected(key) {
    const l = this.ledger[key] ?? { inCents: 0, outCents: 0, projectOutCents: 0 };
    return { ...l, resultCents: l.inCents - l.outCents };
  }

  figure(key, periodKey) {
    return this.bpm.figure(this.ctx, key, { periodKey }).value;
  }

  periodChecks(c, label) {
    const e = this.expected(c.key);
    const v = (k) => Math.round((this.figure(k, c.key) ?? 0) * 100);
    this.check(`${label} ${c.key} · Reçu`, v("bpm.revenus"), e.inCents);
    this.check(`${label} ${c.key} · Dépensé`, v("bpm.charges"), e.outCents);
    this.check(`${label} ${c.key} · dont projets`, v("bpm.chargesProjets"), e.projectOutCents);
    this.check(`${label} ${c.key} · Reste réel`, v("bpm.resultatPeriode"), e.resultCents);
  }

  async close(c) {
    this.periodChecks(c, "Avant clôture");
    const preview = this.bpm.closingPreview(this.ctx, c.key);
    this.check(`Aperçu de clôture ${c.key}`, preview.resultCents, this.expected(c.key).resultCents);
    await this.bpm.closePeriod(this.ctx, {
      requestKey: this.key(),
      periodKey: c.key,
      expectedResultCents: preview.resultCents,
    });
    const stock = this.stockAfter(c.index);
    if (stock !== null) this.check(`Patrimoine après clôture ${c.key}`, Math.round(this.figure("bpm.patrimoineConstitue", this.cycles[c.index + 1].key) * 100), stock);
  }

  stockAfter(index) {
    if (this.spec.openingStock === null) return null;
    let s = cents(this.spec.openingStock === undefined ? 5000 : this.spec.openingStock);
    for (const c of this.cycles.slice(0, index + 1)) s += this.expected(c.key).resultCents;
    return s;
  }

  /** Contrôles de fin : cycle en cours, prévu restant, périodes et intégrité J1 des projets. */
  finalChecks() {
    const cur = this.cycles[3];
    this.periodChecks(cur, "En cours");
    const keys = this.bpm.periods(this.ctx, { limit: 24 }).periods.map((p) => p.key);
    this.check("Cycles du site", this.cycles.every((c) => keys.includes(c.key)), true);
    this.check("Trois clôtures", this.bpm.closures(this.ctx).map((c) => c.periodKey).sort(), this.cycles.slice(0, 3).map((c) => c.key));
    // Ce qui reste prévu dans le cycle en cours (dates prévues dans le cycle, non encore réglées).
    const rest = (direction) =>
      this.planned
        .filter((p) => p.direction === direction && p.date >= cur.start && p.date <= cur.end && !p.settledBy())
        .reduce((s, p) => s + p.amountCents, 0);
    const v = (k) => Math.round((this.figure(k, cur.key) ?? 0) * 100);
    this.check("En cours · À recevoir", v("bpm.resteARecevoir"), rest("income"));
    this.check("En cours · À payer", v("bpm.resteAPayer"), rest("charge"));
    this.check(
      "En cours · Solde prévu",
      v("bpm.soldeAttendu"),
      this.expected(cur.key).resultCents + rest("income") - rest("charge"),
    );
    // Intégrité J1 : chaque projet de la vie garde un état et des temps dérivés de ses tâches.
    for (const [name, p] of Object.entries(this.projects)) {
      const d = this.C.readProjectDetail(this.ctx, p.coreProjectId);
      const tasks = d.tasks.map((t) => t.task);
      const done = tasks.filter((t) => t.status === "done").length;
      this.check(`Projet ${name} · complétude`, d.view.completionPercent, tasks.length ? Math.round((done / tasks.length) * 100) : 0);
      const spent = tasks.reduce((s, t) => s + Math.round((t.spentHours ?? 0) * 100), 0) / 100;
      this.check(`Projet ${name} · temps consommé`, d.view.time.spentHoursTotal, spent);
    }
    // Le tronc reste actif : aucun état de branche ne clôt le projet de vie.
    this.check("Projet de vie toujours actif", this.bpm.dashboard(this.ctx).cycle.state, "active");
  }

  async run() {
    const s = this.spec;
    const existing = Object.values(this.socle.state.users).find((u) => u.label === this.label());
    if (existing) {
      this.report.profiles.push({ id: existing.id, case: s.id, label: this.label(), existing: true });
      return;
    }
    await this.createUser();
    await this.clock(this.cycles[0].start, () => s.setup?.(this));
    this.scheduleClosures();
    await s.play?.(this);
    const queue = [...this.events].sort((a, b) => a.date.localeCompare(b.date) || a.priority - b.priority || a.seq - b.seq);
    // Les événements ajoutés pendant l'exécution sont insérés à leur date.
    while (queue.length) {
      const ev = queue.shift();
      const before = this.events.length;
      try {
        await this.clock(ev.date, () => ev.fn());
      } catch (e) {
        this.checks.push({ name: `${s.id} ${ev.date} ${ev.label}`, ok: false, expected: "Geste réalisable", observed: { code: e.code, message: e.message, details: e.details } });
      }
      if (this.events.length > before) {
        queue.push(...this.events.slice(before));
        queue.sort((a, b) => a.date.localeCompare(b.date) || a.priority - b.priority || a.seq - b.seq);
      }
    }
    await this.clock(TODAY, async () => {
      try {
        this.finalChecks();
        await s.verify?.(this);
      } catch (e) {
        this.checks.push({ name: `${s.id} contrôles finaux`, ok: false, expected: "Lecture possible", observed: { code: e.code, message: e.message, stack: e.stack?.split("\n").slice(0, 4) } });
      }
    });
    this.report.profiles.push({
      id: this.userId,
      case: s.id,
      label: this.label(),
      particularity: s.particularity,
      projects: Object.entries(this.projects).map(([name, p]) => ({ name, ...p })),
    });
    this.report.checks.push(...this.checks);
    this.report.notes.push(...this.notes);
  }
}

export async function runCases(socle, specs, { prefix }) {
  const report = { date: TODAY, prefix, profiles: [], checks: [], notes: [], ok: false };
  const oldClock = process.env.SOCLE_TODAY;
  try {
    for (const spec of specs) await new Case(socle, spec, { prefix, report }).run();
  } finally {
    if (oldClock === undefined) delete process.env.SOCLE_TODAY;
    else process.env.SOCLE_TODAY = oldClock;
  }
  report.ok = report.checks.length > 0 && report.checks.every((c) => c.ok);
  return report;
}
