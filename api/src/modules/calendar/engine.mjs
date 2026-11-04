// Moteur du Calendrier : un seul code, piloté par une configuration (paramètre administrable ou paramètres
// fournis à l'appel). Il lit en lecture seule les objets du user du contexte, par nature d'objet déclarée au
// registre, et produit des repères datés. Aucune règle propre à un module n'y figure : la configuration dit
// quelle nature lire, quel champ sert de date, de titre, de montant, ce qui est terminé, ce qui se répète,
// quelles entrées montrer au survol et quelle commande de l'API replanifie un repère.
import { fail } from '../../socle/errors.mjs';
import { isCalendarDate } from '../../socle/validation.mjs';

export const TONES = ['bleu', 'indigo', 'violet', 'cyan', 'sarcelle', 'vert', 'ambre', 'orange', 'rouge', 'rose', 'ardoise'];
export const MARKERS = { debut: 'start', echeance: 'due', ponctuel: 'point' };
export const VIEWS = { semaine: 'week', mois: 'month', annee: 'year' };
export const FORMATS = ['texte', 'date', 'heures', 'montant', 'montantSigne', 'nombre', 'pourcentage'];
export const CADENCES = ['daily', 'weekly', 'monthly', 'yearly'];
export const INDICATORS = {
  elements: { label: 'Éléments', description: 'Objets distincts du jour, par nature (projets, tâches, opérations…).' },
  dates: { label: 'Dates', description: 'Débuts et dates prévues face aux échéances du jour.' },
  suivi: { label: 'Suivi', description: 'Repères à suivre face aux repères terminés.' },
  flux: { label: 'Flux', description: 'Montant des entrées et des sorties du jour.' },
  solde: { label: 'Solde', description: 'Entrées moins sorties du jour.' },
};
export const MAX_WINDOW_DAYS = 400;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);

// ---------- dates ----------

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (y, m, d) => {
  const r = new Date(0);
  r.setUTCFullYear(y, m, d);
  return r;
};
const parts = (ymd) => ymd.split('-').map(Number);
export const dayNumber = (ymd) => {
  const [y, m, d] = parts(ymd);
  return Math.round(utc(y, m - 1, d).getTime() / 86400000);
};
export const addDays = (ymd, n) => {
  const [y, m, d] = parts(ymd);
  return iso(utc(y, m - 1, d + n));
};
const daysInMonth = (y, m) => utc(y, m + 1, 0).getUTCDate();

/** n-ième date (n ≥ 0) d'une répétition : le mois et l'année gardent le jour d'origine, ramené au dernier jour du mois. */
export function nthDate(first, cadence, n) {
  const [y, m, d] = parts(first);
  if (cadence === 'daily') return iso(utc(y, m - 1, d + n));
  if (cadence === 'weekly') return iso(utc(y, m - 1, d + 7 * n));
  const months = m - 1 + n * (cadence === 'yearly' ? 12 : 1);
  const year = y + Math.floor(months / 12);
  const month = months - Math.floor(months / 12) * 12;
  return iso(utc(year, month, Math.min(d, daysInMonth(year, month))));
}

/** Date du jour `day` du mois de `ymd`, ou du mois précédent si ce jour n'est pas encore atteint (ancrage d'un cycle). */
export function alignToDay(ymd, day) {
  if (!isCalendarDate(ymd) || !Number.isInteger(day) || day < 1 || day > 31) return ymd;
  const [y, m, d] = parts(ymd);
  const month = d >= day ? m - 1 : m - 2;
  const year = y + Math.floor(month / 12);
  const mm = month - Math.floor(month / 12) * 12;
  return iso(utc(year, mm, Math.min(day, daysInMonth(year, mm))));
}

/** Rang de départ pour atteindre `from` sans énumérer depuis la première date (une marge de sécurité incluse). */
function startRank(first, cadence, from) {
  if (from <= first) return 0;
  const days = dayNumber(from) - dayNumber(first);
  if (cadence === 'daily') return Math.max(0, days - 1);
  if (cadence === 'weekly') return Math.max(0, Math.floor(days / 7) - 1);
  const [fy, fm] = parts(first);
  const [y, m] = parts(from);
  return Math.max(0, Math.floor(((y - fy) * 12 + (m - fm)) / (cadence === 'yearly' ? 12 : 1)) - 1);
}

/**
 * Dates d'une répétition comprises dans [from, to]. `position: 'veilleSuivante'` place chaque repère la veille
 * de l'occurrence suivante (la fin d'une période qui commence à l'occurrence).
 */
export function repeatDates({ first, last, cadence, position = 'occurrence' }, from, to) {
  if (!isCalendarDate(first) || !CADENCES.includes(cadence)) return [];
  const out = [];
  const dateOf = (n) => (position === 'veilleSuivante' ? addDays(nthDate(first, cadence, n + 1), -1) : nthDate(first, cadence, n));
  for (let n = startRank(first, cadence, from), date = dateOf(n); date <= to; date = dateOf(++n)) {
    if (last && nthDate(first, cadence, n) > last) break;
    if (date >= from) out.push(date);
    if (n > 5000) break;
  }
  return out;
}

// ---------- validation de la configuration ----------

function validateCondition(cond, at) {
  if (cond === undefined) return;
  if (!isObj(cond)) fail('VALIDATION', `${at} : une condition { champ: [valeurs] } est attendue.`);
  for (const [field, rule] of Object.entries(cond)) {
    if (field === 'relies') {
      if (!isObj(rule) || !isText(rule.nature) || !isText(rule.champ)) fail('VALIDATION', `${at}.relies : { nature, champ, tous } est attendu.`);
      validateCondition(rule.tous, `${at}.relies.tous`);
      continue;
    }
    if (!(Array.isArray(rule) || (isObj(rule) && Array.isArray(rule.sauf)))) fail('VALIDATION', `${at}.${field} : une liste de valeurs ou { sauf: [...] } est attendue.`);
  }
}

function validateEntry(entry, at, natureOk) {
  if (!isObj(entry)) fail('VALIDATION', `${at} : une entrée { libelle, champ… } est attendue.`);
  if (entry.libelle !== undefined && !isText(entry.libelle)) fail('VALIDATION', `${at}.libelle : un texte est attendu.`);
  const sources = ['champ', 'texte', 'relies'].filter((k) => entry[k] !== undefined);
  if (!sources.length) fail('VALIDATION', `${at} : « champ », « texte » ou « relies » est attendu.`);
  if (entry.champ !== undefined && !(isText(entry.champ) || (Array.isArray(entry.champ) && entry.champ.every(isText)))) fail('VALIDATION', `${at}.champ : un nom de champ (ou une liste) est attendu.`);
  if (entry.texte !== undefined && !isText(entry.texte)) fail('VALIDATION', `${at}.texte : un modèle de texte est attendu.`);
  if (entry.format !== undefined && !FORMATS.includes(entry.format)) fail('VALIDATION', `${at}.format : format inconnu « ${entry.format} ».`, { formats: FORMATS });
  if (entry.valeurs !== undefined && !isObj(entry.valeurs)) fail('VALIDATION', `${at}.valeurs : une table { valeur: libellé } est attendue.`);
  if (entry.reference !== undefined) {
    if (!isObj(entry.reference) || !isText(entry.reference.nature) || !isText(entry.reference.champ)) fail('VALIDATION', `${at}.reference : { nature, champ } est attendu.`);
    natureOk(entry.reference.nature, `${at}.reference`);
  }
  if (entry.parametre !== undefined && (!isObj(entry.parametre) || !isText(entry.parametre.cle) || !isText(entry.parametre.id) || !isText(entry.parametre.champ))) fail('VALIDATION', `${at}.parametre : { cle, id, champ } est attendu.`);
  if (entry.relies !== undefined) {
    if (!isObj(entry.relies) || !isText(entry.relies.nature) || !isText(entry.relies.champ)) fail('VALIDATION', `${at}.relies : { nature, champ, termine } est attendu.`);
    natureOk(entry.relies.nature, `${at}.relies`);
    validateCondition(entry.relies.termine, `${at}.relies.termine`);
  }
  if (entry.vide !== undefined && typeof entry.vide !== 'string') fail('VALIDATION', `${at}.vide : un texte est attendu.`);
  if (entry.sinon !== undefined) validateEntry(entry.sinon, `${at}.sinon`, natureOk);
}

/** Contrôle complet d'une configuration de calendrier ; les natures doivent exister au registre. */
export function validateConfiguration(config, registry) {
  const natureOk = (nature, at) => {
    if (!registry.kinds.has(nature)) fail('VALIDATION', `${at} : nature d'objet inconnue « ${nature} ».`, { natures: [...registry.kinds.keys()] });
  };
  if (!isObj(config)) fail('VALIDATION', 'Une configuration { libelle, elements… } est attendue.');
  if (!isText(config.libelle)) fail('VALIDATION', 'La configuration a un libellé.');
  if (config.vue !== undefined && !VIEWS[config.vue]) fail('VALIDATION', 'Vue attendue : semaine, mois ou annee.', { vues: Object.keys(VIEWS) });
  for (const [k, min, max] of [['reperesParCase', 0, 8], ['reperesAuSurvol', 1, 30], ['delaiFermetureSurvol', 0, 3000]]) {
    if (config[k] !== undefined && (!Number.isInteger(config[k]) || config[k] < min || config[k] > max)) fail('VALIDATION', `${k} : un entier entre ${min} et ${max} est attendu.`);
  }
  if (config.indicateurs !== undefined) {
    if (!Array.isArray(config.indicateurs) || config.indicateurs.length < 1 || config.indicateurs.length > 4) fail('VALIDATION', 'Entre 1 et 4 indicateurs sont attendus.');
    const seen = new Set();
    for (const k of config.indicateurs) {
      if (!INDICATORS[k]) fail('VALIDATION', `Indicateur inconnu « ${k} ».`, { indicateurs: Object.keys(INDICATORS) });
      if (seen.has(k)) fail('VALIDATION', `Indicateur en double « ${k} ».`);
      seen.add(k);
    }
  }
  if (!Array.isArray(config.elements) || !config.elements.length) fail('VALIDATION', 'Au moins un élément est attendu.');
  const ids = new Set();
  config.elements.forEach((el, i) => {
    const at = `elements[${i}]`;
    if (!isObj(el)) fail('VALIDATION', `${at} : un objet est attendu.`);
    if (!isText(el.id) || !/^[a-z0-9-]+$/i.test(el.id)) fail('VALIDATION', `${at}.id : identifiant en lettres, chiffres et tirets.`);
    if (ids.has(el.id)) fail('VALIDATION', `${at}.id : « ${el.id} » figure deux fois.`);
    ids.add(el.id);
    if (!isText(el.libelle)) fail('VALIDATION', `${at}.libelle : un libellé est attendu.`);
    if (!isText(el.nature)) fail('VALIDATION', `${at}.nature : une nature d'objet est attendue.`);
    natureOk(el.nature, at);
    if (!(isText(el.date) || (Array.isArray(el.date) && el.date.length && el.date.every(isText)))) fail('VALIDATION', `${at}.date : le champ date (ou une liste, le premier renseigné) est attendu.`);
    if (!isText(el.titre)) fail('VALIDATION', `${at}.titre : un modèle de titre est attendu (ex. « {title} »).`);
    if (el.repere !== undefined && !MARKERS[el.repere]) fail('VALIDATION', `${at}.repere : debut, echeance ou ponctuel.`);
    if (el.couleur !== undefined && !TONES.includes(el.couleur)) fail('VALIDATION', `${at}.couleur : couleur inconnue « ${el.couleur} ».`, { couleurs: TONES });
    if (el.affiche !== undefined && typeof el.affiche !== 'boolean') fail('VALIDATION', `${at}.affiche : true ou false.`);
    if (el.urgence !== undefined && typeof el.urgence !== 'boolean') fail('VALIDATION', `${at}.urgence : true ou false.`);
    if (el.objet !== undefined && !(Array.isArray(el.objet) && el.objet.length === 2 && el.objet.every(isText))) fail('VALIDATION', `${at}.objet : [singulier, pluriel] est attendu.`);
    if (el.lien !== undefined && (!isText(el.lien) || !el.lien.startsWith('/'))) fail('VALIDATION', `${at}.lien : un chemin du site commençant par « / » est attendu.`);
    validateCondition(el.filtre, `${at}.filtre`);
    validateCondition(el.termine, `${at}.termine`);
    if (el.statut !== undefined) validateEntry(el.statut, `${at}.statut`, natureOk);
    if (el.groupe !== undefined) validateEntry(el.groupe, `${at}.groupe`, natureOk);
    if (el.montant !== undefined) {
      const m = el.montant;
      if (!isObj(m) || !(isText(m.champ) || (Array.isArray(m.champ) && m.champ.every(isText)))) fail('VALIDATION', `${at}.montant : { champ, sens } est attendu (montant en centimes).`);
      if (m.sens !== undefined && !(isObj(m.sens) && ((isText(m.sens.champ) && isObj(m.sens.valeurs)) || ['entree', 'sortie'].includes(m.sens.fixe)))) fail('VALIDATION', `${at}.montant.sens : { champ, valeurs: { valeur: "entree" | "sortie" } } ou { fixe: "entree" | "sortie" }.`);
    }
    if (el.repetition !== undefined) {
      const r = el.repetition;
      if (!isObj(r) || !isText(r.debut) || !(isText(r.cadence) || CADENCES.includes(r.cadenceFixe))) fail('VALIDATION', `${at}.repetition : { debut, fin?, cadence | cadenceFixe, ancrage?, position?, remplacePar? } est attendu.`, { cadences: CADENCES });
      if (r.position !== undefined && !['occurrence', 'veilleSuivante'].includes(r.position)) fail('VALIDATION', `${at}.repetition.position : occurrence ou veilleSuivante.`);
      if (r.ancrage !== undefined && !isText(r.ancrage)) fail('VALIDATION', `${at}.repetition.ancrage : le champ qui porte le jour du mois est attendu.`);
      if (r.remplacePar !== undefined) {
        if (!isObj(r.remplacePar) || !isText(r.remplacePar.nature) || !isText(r.remplacePar.champ) || !isText(r.remplacePar.date)) fail('VALIDATION', `${at}.repetition.remplacePar : { nature, champ, date } est attendu.`);
        natureOk(r.remplacePar.nature, `${at}.repetition.remplacePar`);
      }
    }
    if (el.replanifier !== undefined) {
      const r = el.replanifier;
      if (!isObj(r) || !['PUT', 'POST'].includes(r.methode) || !isText(r.route) || !r.route.startsWith('/api/') || !isText(r.champ)) fail('VALIDATION', `${at}.replanifier : { methode: PUT | POST, route: "/api/…/{id}", champ, si? } est attendu.`);
      validateCondition(r.si, `${at}.replanifier.si`);
    }
    if (el.survol !== undefined) {
      if (!Array.isArray(el.survol)) fail('VALIDATION', `${at}.survol : une liste d'entrées est attendue.`);
      el.survol.forEach((entry, j) => {
        validateEntry(entry, `${at}.survol[${j}]`, natureOk);
        if (!isText(entry.libelle)) fail('VALIDATION', `${at}.survol[${j}].libelle : chaque entrée de survol a un libellé.`);
      });
    }
  });
}

// ---------- lecture des données du user ----------

const MONEY = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const NUMBER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function get(obj, path) {
  let v = obj;
  for (const k of path.split('.')) {
    if (v === null || v === undefined) return undefined;
    v = v[k];
  }
  return v;
}
const firstOf = (obj, fields) => {
  for (const f of asList(fields)) {
    const v = f === '@date' ? obj['@date'] : get(obj, f);
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
};

/**
 * Contexte de lecture : objets du user par nature (index par id), paramètres effectifs, date du jour.
 * Les objets ne sont jamais modifiés ; seuls ceux du user du contexte sont visibles.
 */
export function readerFor(state, registry, parameters, userId, today) {
  const cache = new Map();
  const objectsOf = (nature) => {
    if (!cache.has(nature)) {
      const def = registry.kind(nature);
      cache.set(nature, Object.values(state[def.collection] ?? {}).filter((o) => o.userId === userId));
    }
    return cache.get(nature);
  };
  const byId = new Map();
  const find = (nature, id) => {
    const k = `${nature}:${id}`;
    if (!byId.has(k)) byId.set(k, objectsOf(nature).find((o) => o.id === id) ?? null);
    return byId.get(k);
  };
  const related = new Map();
  const relatedOf = (nature, field, id) => {
    const k = `${nature}:${field}`;
    if (!related.has(k)) {
      const groups = new Map();
      for (const o of objectsOf(nature)) {
        const key = get(o, field);
        if (key === null || key === undefined) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(o);
      }
      related.set(k, groups);
    }
    return related.get(k).get(id) ?? [];
  };
  return { objectsOf, find, relatedOf, parameter: (key) => parameters.value(state, key), today };
}

export function matches(obj, cond, reader) {
  if (!cond) return true;
  for (const [field, rule] of Object.entries(cond)) {
    if (field === 'relies') {
      const items = reader.relatedOf(rule.nature, rule.champ, obj.id);
      if (!items.length || !items.every((o) => matches(o, rule.tous, reader))) return false;
      continue;
    }
    const v = get(obj, field) ?? null;
    if (Array.isArray(rule) ? !rule.includes(v) : rule.sauf.includes(v)) return false;
  }
  return true;
}

/** Remplit un modèle « {champ} » ; `encode` pour un lien. */
export function fill(template, obj, { encode = false } = {}) {
  return template.replace(/\{([@\w.]+)\}/g, (_, path) => {
    const v = path === '@date' ? obj['@date'] : get(obj, path);
    const s = v === null || v === undefined ? '' : String(v);
    return encode ? encodeURIComponent(s) : s;
  });
}

function formatValue(v, format, sign) {
  switch (format) {
    case 'date':
      return isCalendarDate(v) ? DATE.format(new Date(v + 'T12:00:00Z')) : String(v);
    case 'heures':
      return typeof v === 'number' ? `${NUMBER.format(v)} h` : String(v);
    case 'montant':
      return Number.isInteger(v) ? (v < 0 ? '−' : '') + MONEY.format(Math.abs(v) / 100) : String(v);
    case 'montantSigne':
      return Number.isInteger(v) ? `${sign < 0 ? '−' : '+'}${MONEY.format(Math.abs(v) / 100)}` : String(v);
    case 'nombre':
      return typeof v === 'number' ? NUMBER.format(v) : String(v);
    case 'pourcentage':
      return typeof v === 'number' ? `${NUMBER.format(v)} %` : String(v);
    default:
      return String(v);
  }
}

/** Valeur d'une entrée (survol, statut, groupe) pour un objet : { raw, text } ; text null si rien à montrer. */
export function evaluate(entry, obj, reader, sign = 1) {
  let raw = null;
  let text = null;
  if (entry.relies) {
    const items = reader.relatedOf(entry.relies.nature, entry.relies.champ, obj.id);
    const done = items.filter((o) => matches(o, entry.relies.termine, reader)).length;
    raw = { total: items.length, done };
    text = items.length ? (entry.relies.termine ? `${done}/${items.length} terminées · ${Math.round((100 * done) / items.length)} %` : String(items.length)) : null;
  } else if (entry.texte !== undefined) {
    text = fill(entry.texte, obj).trim() || null;
    raw = entry.champ !== undefined ? firstOf(obj, entry.champ) : text;
  } else {
    raw = firstOf(obj, entry.champ);
    if (raw !== null) {
      if (entry.reference) {
        const target = reader.find(entry.reference.nature, raw);
        text = target ? firstOf(target, entry.reference.champ) : null;
        text = text === null ? null : String(text);
      } else if (entry.parametre) {
        const list = reader.parameter(entry.parametre.cle);
        const item = Array.isArray(list) ? list.find((x) => x?.[entry.parametre.id] === raw) : null;
        text = item ? String(item[entry.parametre.champ] ?? '') || null : null;
      } else if (entry.valeurs) {
        text = entry.valeurs[String(raw)] ?? String(raw);
      } else {
        text = formatValue(raw, entry.format, sign);
      }
    }
  }
  if (text === null && entry.sinon) return evaluate(entry.sinon, obj, reader, sign);
  if (text === null && entry.vide !== undefined) text = entry.vide;
  return { raw, text };
}

const SOON_DAYS = 7;
function urgencyOf(day, done, today) {
  if (done) return null;
  if (day < today) return 'overdue';
  return dayNumber(day) - dayNumber(today) <= SOON_DAYS ? 'soon' : null;
}

/** Repères d'un élément de configuration sur [from, to], pour les objets du user. */
export function eventsOf(el, reader, { from, to }) {
  const out = [];
  const replaced = el.repetition?.remplacePar
    ? new Set(reader.objectsOf(el.repetition.remplacePar.nature).map((o) => `${get(o, el.repetition.remplacePar.champ)}@${get(o, el.repetition.remplacePar.date)}`))
    : null;
  for (const obj of reader.objectsOf(el.nature)) {
    if (!matches(obj, el.filtre, reader)) continue;
    let dates;
    if (el.repetition) {
      const r = el.repetition;
      const cadence = r.cadenceFixe ?? get(obj, r.cadence);
      const first = r.ancrage ? alignToDay(get(obj, r.debut), get(obj, r.ancrage)) : get(obj, r.debut);
      dates = repeatDates({ first, last: r.fin ? get(obj, r.fin) : null, cadence, position: r.position }, from, to).filter((d) => !replaced?.has(`${obj.id}@${d}`));
    } else {
      const d = firstOf(obj, el.date);
      dates = isCalendarDate(d) && d >= from && d <= to ? [d] : [];
    }
    if (!dates.length) continue;
    const done = el.termine ? matches(obj, el.termine, reader) : false;
    const amount = el.montant ? firstOf(obj, el.montant.champ) : null;
    const direction = !el.montant?.sens ? null : el.montant.sens.fixe ?? el.montant.sens.valeurs[String(get(obj, el.montant.sens.champ))] ?? null;
    const sign = direction === 'sortie' ? -1 : 1;
    const canMove = el.replanifier && !el.repetition && matches(obj, el.replanifier.si, reader);
    for (const day of dates) {
      const view = { ...obj, '@date': day };
      const objectId = el.repetition ? `${obj.id}@${day}` : obj.id;
      const status = el.statut ? evaluate(el.statut, view, reader, sign) : { raw: null, text: null };
      const group = el.groupe ? evaluate(el.groupe, view, reader, sign) : { raw: null, text: null };
      out.push({
        key: `${el.id}:${objectId}:${day}`,
        element: el.id,
        nature: el.nature,
        objectId,
        revision: Number.isInteger(obj.revision) ? obj.revision : null,
        date: day,
        title: fill(el.titre, view).trim() || '(sans titre)',
        done,
        status: status.raw === null || typeof status.raw === 'object' ? null : String(status.raw),
        statusLabel: status.text,
        urgent: el.urgence ? urgencyOf(day, done, reader.today) : null,
        groupId: group.raw === null || typeof group.raw === 'object' ? null : String(group.raw),
        groupLabel: group.text,
        amountCents: Number.isInteger(amount) ? amount : null,
        direction,
        link: el.lien ? fill(el.lien, { ...view, id: objectId }, { encode: true }) : null,
        details: (el.survol ?? [])
          .map((entry) => ({ label: entry.libelle, value: evaluate(entry, view, reader, sign).text }))
          .filter((d) => d.value !== null && d.value !== ''),
        reschedule: canMove ? { method: el.replanifier.methode, url: fill(el.replanifier.route, obj, { encode: true }), field: el.replanifier.champ } : null,
      });
    }
  }
  return out;
}

/** Lecture complète d'une configuration : éléments résolus, repères triés, réglages d'affichage. */
export function readCalendar(config, reader, win) {
  const elements = config.elements.map((el) => ({
    id: el.id,
    label: el.libelle,
    nature: el.nature,
    tone: el.couleur ?? 'bleu',
    marker: MARKERS[el.repere ?? 'ponctuel'],
    visible: el.affiche ?? true,
    objectLabel: { one: el.objet?.[0] ?? 'élément', many: el.objet?.[1] ?? 'éléments' },
    hover: (el.survol ?? []).map((s) => s.libelle),
    reschedulable: !!el.replanifier && !el.repetition,
  }));
  const order = new Map(config.elements.map((el, i) => [el.id, i]));
  const events = config.elements
    .flatMap((el) => eventsOf(el, reader, win))
    .sort((a, b) => a.date.localeCompare(b.date) || order.get(a.element) - order.get(b.element) || a.title.localeCompare(b.title, 'fr'));
  return {
    display: {
      view: VIEWS[config.vue ?? 'mois'],
      perCell: config.reperesParCase ?? 2,
      perPeek: config.reperesAuSurvol ?? 4,
      peekCloseDelayMs: config.delaiFermetureSurvol ?? 260,
    },
    indicators: (config.indicateurs ?? ['elements', 'dates', 'suivi']).map((k) => ({ key: k, label: INDICATORS[k].label })),
    elements,
    events,
  };
}
