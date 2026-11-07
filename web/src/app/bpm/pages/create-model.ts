// Brouillon de l'assistant « Partir de zéro » : types, préremplissage, validation par étape,
// calculs indicatifs (moyennes, périodes du cycle) et construction de la commande unique `setup`.
// Aucun ID métier n'est créé ici : seules des références locales (uid, tempRef) servent à l'écran.
import { Cadence, Direction, GoalType, SetupInput, SetupProfile } from '../../core/bpm-models';
import { parseAmount, parseHours } from '../../core/format';

export type Mode = 'principal' | 'branch';
export type Errors = Record<string, string>;

export interface LineDraft {
  uid: string;
  /** existing : ligne récurrente du budget type (mise à jour) ; suggestion : libellé proposé sans montant ; user : saisie libre. */
  origin: 'existing' | 'suggestion' | 'user';
  recurrenceId: string | null;
  direction: Direction;
  label: string;
  centerRef: string;
  centerLabel: string | null;
  amount: string;
  cadence: Cadence;
  firstDate: string;
  endDate: string;
  orig: { label: string; amount: string; endDate: string } | null;
}

export interface TaskDraft {
  uid: string;
  title: string;
  description: string;
  hours: string;
}

export interface CenterDraft {
  tempRef: string;
  label: string;
  direction: Direction;
}

export interface GoalDraft {
  uid: string;
  goalId: string | null;
  label: string;
  type: GoalType | '';
  date: string;
  amount: string;
  orig: { label: string; type: string; date: string; amount: string } | null;
}

export interface Draft {
  v: 1;
  userId: string;
  requestKey: string;
  step: number;
  maxReached: number;
  mode: Mode | null;
  principalName: string;
  principalDescription: string;
  principalOrig: { name: string; description: string };
  branchName: string;
  branchDescription: string;
  tasks: TaskDraft[];
  lines: LineDraft[];
  centers: CenterDraft[];
  caps: Record<string, string>;
  capsOrig: Record<string, string>;
  stockKnown: boolean;
  stock: string;
  stockDate: string;
  objective: string;
  patOrig: { known: boolean; stock: string; date: string; objective: string };
  anchorDay: string;
  cycleStart: string;
  cycleOrig: { anchorDay: string; start: string };
  rate: string;
  inflation: string;
  savingsTarget: string;
  visionOrig: { rate: string; inflation: string; savingsTarget: string };
  visionLater: boolean;
  goals: GoalDraft[];
  nextRef: number;
}

export const PER_YEAR: Record<Exclude<Cadence, 'once'>, number> = { weekly: 52, monthly: 12, yearly: 1 };

/**
 * Étapes de l'assistant : jalon (surtitre de la scène), aide courte sous le titre et explication
 * repliable « Pourquoi cette étape ? » (absente quand l'étape n'en a pas besoin).
 */
export const STEPS: { n: number; label: string; milestone: string; help: string; why: string | null }[] = [
  {
    n: 1,
    label: 'Votre situation',
    milestone: 'Point de départ',
    help: 'Ce qui est déjà enregistré pour votre profil financier et le profil de départ proposé. Rien n’est enregistré avant la confirmation de l’étape 7.',
    why: null,
  },
  {
    n: 2,
    label: 'Le projet',
    milestone: 'Le projet',
    help: 'Choisissez le rôle du projet : compléter le Budget du projet de vie ou créer un projet de la vie.',
    why: 'Le rôle est choisi ici et n’est jamais déduit du nom. Le Budget du projet de vie est unique et créé avec votre profil financier ; un projet de la vie est une branche qui en dépend. Aucun objet existant n’est réassemblé.',
  },
  {
    n: 3,
    label: 'Le budget',
    milestone: 'Le budget',
    help: 'Revenus et charges, leur centre, leur cadence et leurs dates ; les moyennes mensuelles se recalculent à chaque saisie.',
    why: 'Une ligne enregistrée garde son identité : seuls son libellé, son montant et sa fin se modifient ici (pour l’arrêter, renseignez une fin). Une ponctuelle devient une opération prévue ; une cadence crée une définition récurrente dont les occurrences apparaissent dans les dépenses de la période.',
  },
  {
    n: 4,
    label: 'Le patrimoine',
    milestone: 'Le patrimoine',
    help: 'Le stock initial du Patrimoine unique de votre profil financier et, si vous le souhaitez, un objectif de stock.',
    why: 'Chaque profil financier possède exactement un Patrimoine. Les détails d’actifs et les phases patrimoniales avancées ne sont pas encore disponibles (choix métier non validé).',
  },
  {
    n: 5,
    label: 'Le cycle',
    milestone: 'Le cycle',
    help: 'Le jour d’ancrage et la date de début qui fixent les périodes de clôture.',
    why: 'Le cycle fixe les périodes de clôture du Budget du projet de vie. Changer la période affichée dans les pages ne modifie jamais ce cycle. Une fois une période close, le jour et la date de début sont figés.',
  },
  {
    n: 6,
    label: 'Votre vision',
    milestone: 'La vision',
    help: 'Rendement, inflation, épargne visée et objectifs datés ; tout peut être complété plus tard.',
    why: 'Les montants d’objectif sont exprimés en euros d’aujourd’hui ; la projection les réévalue avec l’inflation. Un rendement vide laisse la projection « hypothèse manquante » plutôt que d’inventer un taux.',
  },
  {
    n: 7,
    label: 'Vérifier et confirmer',
    milestone: 'Confirmation',
    help: 'Relisez chaque bloc, modifiez au besoin, puis confirmez en une seule fois.',
    why: null,
  },
];

/**
 * Grand parcours affiché dans la ligne d'avancement (gabarit `rjs-milestone-journey` de la référence,
 * présentation « rail ») : quatre jalons qui regroupent les sept étapes de l'assistant.
 * Lecture seule : aucune complétion n'est déduite d'un clic.
 */
export interface JourneyMilestone {
  id: string;
  title: string;
  goal: string;
  result: string;
  steps: number[];
}
export const JOURNEY: { title: string; lead: string; number: string; milestones: JourneyMilestone[] } = {
  title: 'Préparer mon projet',
  lead: 'De votre situation à la confirmation : quatre jalons, une seule commande.',
  number: '01',
  milestones: [
    {
      id: 'identity',
      title: 'Choisir mon point de départ',
      goal: 'Poser le bon cadre avant de saisir des montants.',
      result: 'Votre situation est relue et le rôle du projet est choisi.',
      steps: [1, 2],
    },
    {
      id: 'base',
      title: 'Construire ma base',
      goal: 'Donner des montants et un point de départ au projet.',
      result: 'Un budget relu, ligne par ligne, et un Patrimoine identifié.',
      steps: [3, 4],
    },
    {
      id: 'horizon',
      title: 'Donner un rythme et un cap',
      goal: 'Relier le quotidien à ce que vous préparez.',
      result: 'Le rythme du cycle et les premières intentions d’avenir sont définis.',
      steps: [5, 6],
    },
    {
      id: 'launch',
      title: 'Relire et démarrer',
      goal: 'Transformer le brouillon en un projet utilisable.',
      result: 'Après confirmation, ouvrez le projet préparé et poursuivez son pilotage.',
      steps: [7],
    },
  ],
};

export const CADENCES: { key: Cadence; label: string }[] = [
  { key: 'once', label: 'Ponctuelle' },
  { key: 'weekly', label: 'Hebdomadaire' },
  { key: 'monthly', label: 'Mensuelle' },
  { key: 'yearly', label: 'Annuelle' },
];

let seq = 0;
export const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Date du jour (locale) au format AAAA-MM-JJ. */
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Date civile réelle (31 février refusé), même règle que l'API. */
export function isCalendarDate(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
}

/** Centimes → saisie en euros (« 1234,5 »). */
export const toInput = (cents: number | null | undefined) => (cents === null || cents === undefined ? '' : String(cents / 100).replace('.', ','));
/** Saisie en euros → centimes ; null si vide ou invalide. */
export function toCents(raw: string): number | null {
  const v = parseAmount(raw);
  return v === null || v === 'invalid' ? null : Math.round(v * 100);
}
const num = (raw: string) => {
  const v = parseAmount(raw);
  return v === 'invalid' ? null : v;
};
const pctOf = (raw: string): number | null | 'invalid' => {
  const s = (raw ?? '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : 'invalid';
};

// ---------- préremplissage ----------

function existingLine(r: SetupProfile['budgetType']['lines'][number]): LineDraft {
  const amount = toInput(r.amountCents);
  return {
    uid: uid('l'),
    origin: 'existing',
    recurrenceId: r.id,
    direction: r.direction,
    label: r.label,
    centerRef: r.costCenterRef,
    centerLabel: r.costCenterLabel,
    amount,
    cadence: r.cadence,
    firstDate: r.firstDate,
    endDate: r.endDate ?? '',
    orig: { label: r.label, amount, endDate: r.endDate ?? '' },
  };
}

function existingGoal(g: SetupProfile['goals'][number]): GoalDraft {
  const amount = toInput(g.targetTodayCents);
  return { uid: uid('g'), goalId: g.id, label: g.label, type: g.type, date: g.date, amount, orig: { label: g.label, type: g.type, date: g.date, amount } };
}

/** Brouillon initial : lignes récurrentes existantes (avec leur recurrenceId), puis suggestions vides. */
export function draftFromProfile(p: SetupProfile, requestKey: string): Draft {
  const today = todayIso();
  const existing = p.budgetType.lines.map(existingLine);
  const used = new Set(existing.map((l) => l.centerRef));
  const suggestions: LineDraft[] = p.suggestions
    .filter((s) => !used.has(s.costCenterRef))
    .map((s) => ({ uid: uid('l'), origin: 'suggestion', recurrenceId: null, direction: s.direction, label: s.label, centerRef: s.costCenterRef, centerLabel: null, amount: '', cadence: s.cadence, firstDate: today, endDate: '', orig: null }));
  const capsCents = p.budgetType.context.budgets.find((b) => b.id === p.principal.budgetId)?.capsCents ?? {};
  const caps: Record<string, string> = {};
  for (const [ref, c] of Object.entries(capsCents)) caps[ref] = toInput(c);
  const pat = p.principal.patrimoine;
  const cyc = p.principal.cycle;
  const vis = p.principal.vision;
  const patOrig = { known: pat.openingStockCents !== null, stock: toInput(pat.openingStockCents), date: pat.openingDate ?? '', objective: toInput(pat.objectiveCents) };
  const cycleOrig = { anchorDay: cyc.anchorDay === null ? '' : String(cyc.anchorDay), start: cyc.startDate ?? '' };
  const visionOrig = { rate: vis.annualReturnPct === null ? '' : String(vis.annualReturnPct).replace('.', ','), inflation: String(vis.inflationPct).replace('.', ','), savingsTarget: toInput(vis.savingsTargetCents) };
  return {
    v: 1,
    userId: p.user.id,
    requestKey,
    step: 1,
    maxReached: 1,
    mode: null,
    principalName: p.principal.project.title ?? '',
    principalDescription: p.principal.project.description ?? '',
    principalOrig: { name: p.principal.project.title ?? '', description: p.principal.project.description ?? '' },
    branchName: '',
    branchDescription: '',
    tasks: [{ uid: uid('t'), title: '', description: '', hours: '' }],
    lines: [...existing, ...suggestions],
    centers: [],
    caps,
    capsOrig: { ...caps },
    stockKnown: patOrig.known,
    stock: patOrig.stock,
    stockDate: patOrig.date || today,
    objective: patOrig.objective,
    patOrig,
    anchorDay: cycleOrig.anchorDay || '1',
    cycleStart: cycleOrig.start || today,
    cycleOrig,
    rate: visionOrig.rate,
    inflation: visionOrig.inflation,
    savingsTarget: visionOrig.savingsTarget,
    visionOrig,
    visionLater: false,
    goals: p.goals.filter((g) => !g.removed).map(existingGoal),
    nextRef: 1,
  };
}

/**
 * Rechargement du profil : ajoute ce qui est apparu (lignes, objectifs) sans jamais
 * remplacer une saisie déjà faite. Renvoie true si le brouillon a changé.
 */
export function mergeProfile(d: Draft, p: SetupProfile): boolean {
  let changed = false;
  const known = new Set(d.lines.map((l) => l.recurrenceId).filter(Boolean));
  const firstSuggestion = d.lines.findIndex((l) => l.origin !== 'existing');
  for (const r of p.budgetType.lines) {
    if (known.has(r.id)) continue;
    d.lines.splice(firstSuggestion < 0 ? d.lines.length : firstSuggestion, 0, existingLine(r));
    changed = true;
  }
  const goals = new Set(d.goals.map((g) => g.goalId).filter(Boolean));
  for (const g of p.goals) {
    if (g.removed || goals.has(g.id)) continue;
    d.goals.push(existingGoal(g));
    changed = true;
  }
  return changed;
}

// ---------- lectures du brouillon ----------

/** Lignes concernées par le mode : une branche ne reprend pas les lignes du Budget du projet de vie. */
export const linesOf = (d: Draft) => (d.mode === 'branch' ? d.lines.filter((l) => l.origin !== 'existing') : d.lines);
/** Une suggestion laissée sans montant n'est pas retenue ; les autres lignes le sont toujours. */
export const included = (l: LineDraft) => l.origin !== 'suggestion' || l.amount.trim() !== '';

export interface CenterOption {
  ref: string;
  label: string;
  direction: Direction;
  standard: boolean;
  fresh: boolean;
}

export function centerOptions(p: SetupProfile, d: Draft): CenterOption[] {
  return [
    ...p.centers.map((c) => ({ ...c, fresh: false })),
    ...d.centers.map((c) => ({ ref: `new:${c.tempRef}`, label: c.label.trim() || 'Nouveau centre (sans nom)', direction: c.direction, standard: false, fresh: true })),
  ];
}

export interface Totals {
  incomeCents: number;
  chargeCents: number;
  netCents: number;
  onceIncomeCents: number;
  onceChargeCents: number;
  recurring: number;
  once: number;
  ended: number;
  ignored: number;
}

/** Moyennes mensuelles indicatives (PER_YEAR 52/12/1) ; les ponctuelles et les lignes terminées en sont exclues. */
export function totalsOf(d: Draft): Totals {
  const today = todayIso();
  const t: Totals = { incomeCents: 0, chargeCents: 0, netCents: 0, onceIncomeCents: 0, onceChargeCents: 0, recurring: 0, once: 0, ended: 0, ignored: 0 };
  for (const l of linesOf(d)) {
    if (!included(l)) {
      t.ignored++;
      continue;
    }
    const c = toCents(l.amount);
    if (c === null || c <= 0) continue;
    if (l.cadence === 'once') {
      t.once++;
      if (l.direction === 'income') t.onceIncomeCents += c;
      else t.onceChargeCents += c;
      continue;
    }
    if (l.endDate && isCalendarDate(l.endDate) && l.endDate < today) {
      t.ended++;
      continue;
    }
    t.recurring++;
    const avg = Math.round((c * PER_YEAR[l.cadence]) / 12);
    if (l.direction === 'income') t.incomeCents += avg;
    else t.chargeCents += avg;
  }
  t.netCents = t.incomeCents - t.chargeCents;
  return t;
}

// ---------- cycle (lecture indicative, même découpage que l'API) ----------

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export interface PeriodView {
  index: number;
  start: string;
  endExclusive: string;
  label: string;
}

export function periodByIndex(index: number, anchor: number): PeriodView {
  const year = Math.floor(index / 12);
  const month = index - year * 12;
  const start = Date.UTC(year, month, anchor);
  const end = new Date(Date.UTC(year, month + 1, anchor - 1));
  const label = anchor === 1 ? `${MONTHS_LONG[month]} ${year}` : `${anchor} ${MONTHS[month]} → ${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
  return { index, start: iso(start), endExclusive: iso(Date.UTC(year, month + 1, anchor)), label };
}

export function periodContaining(ymd: string, anchor: number) {
  const [y, m, d] = ymd.split('-').map(Number);
  return periodByIndex(y * 12 + (m - 1) - (d < anchor ? 1 : 0), anchor);
}

export interface CyclePreview {
  first: PeriodView;
  current: PeriodView;
  next: PeriodView;
  past: number;
  startsLater: boolean;
}

export function cyclePreview(anchorRaw: string, start: string): CyclePreview | null {
  const anchor = Number(anchorRaw);
  if (!Number.isInteger(anchor) || anchor < 1 || anchor > 28 || !isCalendarDate(start)) return null;
  const today = todayIso();
  const first = periodContaining(start, anchor);
  const startsLater = today < start;
  const current = startsLater ? first : periodContaining(today, anchor);
  return { first, current, next: periodByIndex(current.index + 1, anchor), past: current.index - first.index, startsLater };
}

// ---------- validation par étape ----------

export function validate(step: number, d: Draft, p: SetupProfile, cycleLocked: boolean): Errors {
  const e: Errors = {};
  if (step === 2) {
    if (!d.mode) e['mode'] = 'Choisissez ce que vous configurez : le Budget du projet de vie ou un nouveau projet de la vie.';
    const name = d.mode === 'branch' ? d.branchName : d.principalName;
    const desc = d.mode === 'branch' ? d.branchDescription : d.principalDescription;
    if (d.mode && !name.trim()) e['name'] = 'Le nom est obligatoire.';
    else if (name.length > 200) e['name'] = '200 caractères au plus.';
    if (desc.length > 5000) e['description'] = '5 000 caractères au plus.';
    if (d.mode === 'branch') {
      if (!d.tasks.length) e['tasks'] = 'Un projet de la vie se crée avec au moins une tâche.';
      for (const t of d.tasks) {
        if (!t.title.trim()) e[`task.${t.uid}.title`] = 'Le titre de la tâche est obligatoire.';
        else if (t.title.length > 200) e[`task.${t.uid}.title`] = '200 caractères au plus.';
        const h = parseHours(t.hours);
        if (h === 'invalid' || (typeof h === 'number' && h > 100000)) e[`task.${t.uid}.hours`] = "Nombre d'heures positif attendu (ou vide).";
      }
    }
  }
  if (step === 3) {
    const opts = centerOptions(p, d);
    for (const l of linesOf(d)) {
      if (!included(l)) continue;
      const k = `line.${l.uid}`;
      if (!l.label.trim()) e[`${k}.label`] = 'Libellé obligatoire.';
      if (l.origin !== 'existing') {
        const c = opts.find((o) => o.ref === l.centerRef);
        if (!c) e[`${k}.center`] = 'Choisissez un centre.';
        else if (c.direction !== l.direction) e[`${k}.center`] = l.direction === 'income' ? 'Ce centre concerne les charges.' : 'Ce centre concerne les revenus.';
        if (!isCalendarDate(l.firstDate)) e[`${k}.firstDate`] = 'Date civile valide attendue.';
      }
      const a = parseAmount(l.amount);
      if (a === null) e[`${k}.amount`] = l.origin === 'existing' ? 'Montant obligatoire (pour arrêter cette ligne, renseignez une fin).' : 'Montant obligatoire.';
      else if (a === 'invalid') e[`${k}.amount`] = 'Montant en euros, deux décimales au plus.';
      else if (a <= 0) e[`${k}.amount`] = 'Le montant doit être strictement positif.';
      if (l.cadence !== 'once' && l.endDate) {
        if (!isCalendarDate(l.endDate)) e[`${k}.endDate`] = 'Date civile valide attendue.';
        else if (isCalendarDate(l.firstDate) && l.endDate < l.firstDate) e[`${k}.endDate`] = 'La fin ne peut pas précéder la première date.';
      }
    }
    const seen = new Map<string, string>();
    for (const c of p.centers) seen.set(`${c.direction}:${c.label.trim().toLowerCase()}`, c.ref);
    for (const c of d.centers) {
      const key = `${c.direction}:${c.label.trim().toLowerCase()}`;
      if (!c.label.trim()) e[`center.${c.tempRef}.label`] = 'Nom du centre obligatoire.';
      else if (c.label.length > 120) e[`center.${c.tempRef}.label`] = '120 caractères au plus.';
      else if (seen.has(key)) e[`center.${c.tempRef}.label`] = 'Un centre de même nom existe déjà.';
      seen.set(key, c.tempRef);
    }
    if (d.mode === 'principal') {
      for (const [ref, raw] of Object.entries(d.caps)) {
        if (!raw.trim()) continue;
        const a = parseAmount(raw);
        if (a === 'invalid' || a === null || a <= 0) e[`cap.${ref}`] = 'Plafond strictement positif attendu (ou vide).';
      }
    }
  }
  if (step === 4 && d.mode === 'principal') {
    if (d.stockKnown) {
      const s = parseAmount(d.stock);
      if (s === null) e['stock'] = 'Indiquez le montant, ou choisissez « À renseigner ».';
      else if (s === 'invalid') e['stock'] = 'Montant en euros, deux décimales au plus.';
      if (!isCalendarDate(d.stockDate)) e['stockDate'] = 'Date civile valide attendue.';
    }
    const o = parseAmount(d.objective);
    if (o === 'invalid' || (typeof o === 'number' && o < 0)) e['objective'] = 'Montant positif attendu (ou vide).';
  }
  if (step === 5 && d.mode === 'principal' && !cycleLocked) {
    const later = d.anchorDay === '' && d.cycleOrig.anchorDay === '';
    if (!later) {
      const a = Number(d.anchorDay);
      if (!Number.isInteger(a) || a < 1 || a > 28) e['anchorDay'] = 'Jour entre 1 et 28.';
      if (!isCalendarDate(d.cycleStart)) e['cycleStart'] = 'Date civile valide attendue.';
    }
  }
  if (step === 6 && !d.visionLater) {
    const r = pctOf(d.rate);
    if (r === 'invalid' || (typeof r === 'number' && (r < -50 || r > 50))) e['rate'] = 'Pourcentage entre −50 et 50 (ou vide).';
    const i = pctOf(d.inflation);
    if (i === null) e['inflation'] = "L'inflation est obligatoire (0 accepté).";
    else if (i === 'invalid' || i < -20 || i > 50) e['inflation'] = 'Pourcentage entre −20 et 50.';
    const s = parseAmount(d.savingsTarget);
    if (s === 'invalid' || (typeof s === 'number' && s < 0)) e['savingsTarget'] = 'Montant positif attendu (ou vide).';
    const types = new Set(p.goalTypes.map((t) => t.key));
    for (const g of d.goals) {
      const k = `goal.${g.uid}`;
      if (!g.label.trim()) e[`${k}.label`] = 'Libellé obligatoire.';
      if (!g.type || !types.has(g.type)) e[`${k}.type`] = 'Choisissez un type.';
      if (!isCalendarDate(g.date)) e[`${k}.date`] = 'Date civile valide attendue.';
      const a = parseAmount(g.amount);
      if (a === null || a === 'invalid' || a <= 0) e[`${k}.amount`] = 'Montant strictement positif en euros d’aujourd’hui.';
    }
  }
  return e;
}

// ---------- commande unique ----------

export interface PayloadMaps {
  entries: string[];
  goals: string[];
  centers: string[];
  tasks: string[];
}

const changedAmount = (a: string, b: string) => toCents(a) !== toCents(b);

/**
 * Commande `setup` : seuls les éléments nouveaux ou modifiés sont envoyés (construction
 * déterministe : une nouvelle tentative du même brouillon envoie exactement le même contenu).
 */
export function buildPayload(d: Draft, cycleLocked: boolean): { input: SetupInput; maps: PayloadMaps } {
  const mode = d.mode!;
  const maps: PayloadMaps = { entries: [], goals: [], centers: [], tasks: [] };
  const input: SetupInput = { requestKey: d.requestKey, mode };

  if (mode === 'principal') {
    const project: SetupInput['project'] = {};
    if (d.principalName.trim() !== d.principalOrig.name) project.name = d.principalName.trim();
    if (d.principalDescription !== d.principalOrig.description) project.description = d.principalDescription;
    if (Object.keys(project).length) input.project = project;
  } else {
    input.project = { name: d.branchName.trim(), ...(d.branchDescription.trim() ? { description: d.branchDescription } : {}) };
    input.tasks = d.tasks.map((t) => {
      maps.tasks.push(t.uid);
      const h = parseHours(t.hours);
      return { title: t.title.trim(), ...(t.description.trim() ? { description: t.description } : {}), plannedHours: typeof h === 'number' ? h : null };
    });
  }

  if (d.centers.length) {
    input.customCenters = d.centers.map((c) => {
      maps.centers.push(c.tempRef);
      return { tempRef: c.tempRef, label: c.label.trim(), direction: c.direction };
    });
  }

  const entries: NonNullable<SetupInput['entries']> = [];
  for (const l of linesOf(d)) {
    if (!included(l)) continue;
    if (l.origin === 'existing' && l.recurrenceId) {
      const patch: NonNullable<SetupInput['entries']>[number] = { recurrenceId: l.recurrenceId };
      if (l.label.trim() !== l.orig?.label) patch.label = l.label.trim();
      if (changedAmount(l.amount, l.orig?.amount ?? '')) patch.amount = num(l.amount) ?? undefined;
      if (l.endDate !== (l.orig?.endDate ?? '')) patch.endDate = l.endDate || null;
      if (Object.keys(patch).length === 1) continue;
      entries.push(patch);
    } else {
      const base = { direction: l.direction, label: l.label.trim(), costCenterRef: l.centerRef, amount: num(l.amount) ?? undefined, cadence: l.cadence };
      entries.push(l.cadence === 'once' ? { ...base, date: l.firstDate } : { ...base, firstDate: l.firstDate, endDate: l.endDate || null });
    }
    maps.entries.push(l.uid);
  }
  if (entries.length) input.entries = entries;

  if (mode === 'principal') {
    const caps: Record<string, number | null> = {};
    const refs = new Set([...Object.keys(d.caps), ...Object.keys(d.capsOrig)]);
    for (const ref of refs) {
      const now = d.caps[ref] ?? '';
      if (!changedAmount(now, d.capsOrig[ref] ?? '')) continue;
      caps[ref] = now.trim() ? num(now) : null;
    }
    if (Object.keys(caps).length) input.caps = caps;

    const pat: NonNullable<SetupInput['patrimoine']> = {};
    if (d.stockKnown !== d.patOrig.known || (d.stockKnown && changedAmount(d.stock, d.patOrig.stock))) pat.openingStock = d.stockKnown ? num(d.stock) : null;
    if (d.stockKnown && d.stockDate !== d.patOrig.date) pat.openingDate = d.stockDate;
    if (changedAmount(d.objective, d.patOrig.objective)) pat.objective = d.objective.trim() ? num(d.objective) : null;
    if (Object.keys(pat).length) input.patrimoine = pat;

    if (!cycleLocked && (d.anchorDay !== d.cycleOrig.anchorDay || (d.anchorDay !== '' && d.cycleStart !== d.cycleOrig.start))) {
      input.cycle = d.anchorDay === '' ? { anchorDay: null } : { anchorDay: Number(d.anchorDay), startDate: d.cycleStart };
    }
  }

  if (!d.visionLater) {
    const vision: NonNullable<SetupInput['vision']> = {};
    const r = pctOf(d.rate);
    if (d.rate.trim() !== d.visionOrig.rate.trim()) vision.annualReturnPct = typeof r === 'number' ? r : null;
    const i = pctOf(d.inflation);
    if (d.inflation.trim() !== d.visionOrig.inflation.trim() && typeof i === 'number') vision.inflationPct = i;
    if (changedAmount(d.savingsTarget, d.visionOrig.savingsTarget)) vision.savingsTarget = d.savingsTarget.trim() ? num(d.savingsTarget) : null;
    if (Object.keys(vision).length) input.vision = vision;

    const goals: NonNullable<SetupInput['goals']> = [];
    for (const g of d.goals) {
      const row = { label: g.label.trim(), type: g.type as GoalType, date: g.date, targetToday: num(g.amount) ?? 0 };
      if (g.goalId) {
        const o = g.orig!;
        if (row.label === o.label && g.type === o.type && g.date === o.date && !changedAmount(g.amount, o.amount)) continue;
        goals.push({ goalId: g.goalId, ...row });
      } else goals.push(row);
      maps.goals.push(g.uid);
    }
    if (goals.length) input.goals = goals;
  }
  return { input, maps };
}

// ---------- erreurs rendues par l'API ----------

const STEP3_FIELDS = ['label', 'amount', 'date', 'firstDate', 'endDate', 'costCenterRef', 'direction', 'cadence', 'status', 'taskId', 'note', 'budgetId'];
const STEP2_FIELDS = ['mode', 'name', 'title', 'description', 'plannedHours', 'spentHours', 'startDate', 'dueDate', 'priority'];

/** Champ d'erreur de l'API → étape et clé locale du champ (pour y renvoyer en gardant la saisie). */
export function locateField(field: string | undefined, maps: PayloadMaps): { step: number; key: string | null } {
  if (!field) return { step: 7, key: null };
  let m: RegExpExecArray | null;
  if ((m = /^entries\[(\d+)\]\.(\w+)/.exec(field))) {
    const u = maps.entries[Number(m[1])];
    const f = m[2] === 'costCenterRef' ? 'center' : m[2];
    return { step: 3, key: u ? `line.${u}.${f}` : null };
  }
  if ((m = /^goals\[(\d+)\]\.(\w+)/.exec(field))) {
    const u = maps.goals[Number(m[1])];
    return { step: 6, key: u ? `goal.${u}.${m[2] === 'targetToday' ? 'amount' : m[2]}` : null };
  }
  if ((m = /^customCenters\[(\d+)\]/.exec(field))) {
    const t = maps.centers[Number(m[1])];
    return { step: 3, key: t ? `center.${t}.label` : null };
  }
  if ((m = /^tasks\[(\d+)\]/.exec(field))) {
    const u = maps.tasks[Number(m[1])];
    return { step: 2, key: u ? `task.${u}.title` : 'tasks' };
  }
  if (field.startsWith('caps.')) return { step: 3, key: `cap.${field.slice(5)}` };
  const direct: Record<string, [number, string]> = {
    'project.name': [2, 'name'],
    name: [2, 'name'],
    'project.description': [2, 'description'],
    mode: [2, 'mode'],
    tasks: [2, 'tasks'],
    'patrimoine.openingStock': [4, 'stock'],
    'patrimoine.openingDate': [4, 'stockDate'],
    'patrimoine.objective': [4, 'objective'],
    'cycle.anchorDay': [5, 'anchorDay'],
    'cycle.startDate': [5, 'cycleStart'],
    annualReturnPct: [6, 'rate'],
    inflationPct: [6, 'inflation'],
    savingsTarget: [6, 'savingsTarget'],
  };
  if (direct[field]) return { step: direct[field][0], key: direct[field][1] };
  if (STEP3_FIELDS.includes(field)) return { step: 3, key: null };
  if (STEP2_FIELDS.includes(field)) return { step: 2, key: null };
  if (/^(horizonYears|contribution|inflationSource|surplus)/.test(field)) return { step: 6, key: null };
  return { step: 7, key: null };
}

// ---------- éléments du brouillon (modifications locales, aucune écriture) ----------

export function addTask(d: Draft) {
  d.tasks.push({ uid: uid('t'), title: '', description: '', hours: '' });
}
export function removeTask(d: Draft, id: string) {
  d.tasks = d.tasks.filter((t) => t.uid !== id);
}

export function addLine(d: Draft, direction: Direction) {
  d.lines.push({ uid: uid('l'), origin: 'user', recurrenceId: null, direction, label: '', centerRef: '', centerLabel: null, amount: '', cadence: 'monthly', firstDate: todayIso(), endDate: '', orig: null });
}
/** Une ligne enregistrée ne se retire pas ici (renseigner une fin pour l'arrêter). */
export function removeLine(d: Draft, id: string) {
  d.lines = d.lines.filter((l) => l.uid !== id || l.origin === 'existing');
}

export function addCenter(d: Draft) {
  d.centers.push({ tempRef: `c${d.nextRef++}`, label: '', direction: 'charge' });
}
/** Retrait d'un centre personnel non encore créé : les lignes et plafonds qui le visaient sont libérés. */
export function removeCenter(d: Draft, tempRef: string) {
  const ref = `new:${tempRef}`;
  d.centers = d.centers.filter((c) => c.tempRef !== tempRef);
  for (const l of d.lines) if (l.centerRef === ref) l.centerRef = '';
  delete d.caps[ref];
}
/** Changement de sens d'un centre personnel : les lignes de l'autre sens et son plafond sont libérés. */
export function centerDirectionChanged(d: Draft, tempRef: string) {
  const ref = `new:${tempRef}`;
  const c = d.centers.find((x) => x.tempRef === tempRef);
  for (const l of d.lines) if (l.centerRef === ref && c && l.direction !== c.direction) l.centerRef = '';
  if (c?.direction === 'income') delete d.caps[ref];
}

export function addGoal(d: Draft) {
  d.goals.push({ uid: uid('g'), goalId: null, label: '', type: '', date: '', amount: '', orig: null });
}
/** Un objectif enregistré se retire depuis « Objectifs et avenir ». */
export function removeGoal(d: Draft, id: string) {
  d.goals = d.goals.filter((g) => g.uid !== id || g.goalId);
}
