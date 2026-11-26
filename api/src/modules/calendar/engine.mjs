// Moteur du Calendrier : un seul code, piloté par une configuration (paramètre administrable ou paramètres
// fournis à l'appel). Il lit en lecture seule les objets du user du contexte, par nature d'objet déclarée au
// registre, et produit des repères datés. Aucune règle propre à un module n'y figure : la configuration dit
// quelle nature lire, quel champ sert de date, de titre, de montant, ce qui est terminé, ce qui se répète,
// quelles entrées montrer au survol et quelle commande de l'API replanifie un repère.
import { isCalendarDate } from '../../socle/validation.mjs';
import { MARKERS, VIEWS, INDICATORS, asList } from './constants.mjs';
import { dayNumber, alignToDay, repeatDates } from './dates.mjs';
import { formatsOf } from './config-validation.mjs';
export * from './constants.mjs';
export * from './dates.mjs';
export * from './config-validation.mjs';


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
 * Les objets ne sont jamais modifiés ; seuls ceux du user du contexte sont visibles. Une nature peut aussi
 * être fournie par un module (`provided` : nature → lecture) : le moteur la lit comme une nature stockée.
 */
export function readerFor(state, registry, parameters, userId, today, provided = new Map()) {
  const cache = new Map();
  const objectsOf = (nature) => {
    if (!cache.has(nature)) {
      // Nature fournie par un module (lecture calculée pour la fenêtre et le user du contexte) ou nature stockée.
      if (provided.has(nature)) cache.set(nature, provided.get(nature)());
      else {
        const def = registry.kind(nature);
        cache.set(nature, Object.values(state[def.collection] ?? {}).filter((o) => o.userId === userId));
      }
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
export function readCalendar(config, reader, win, { plugged = null, foreign = [], ownFormats = [] } = {}) {
  const offered = [
    ...config.elements.filter((el) => el.disponible !== false).map((el) => ({ el, origin: null })),
    ...foreign,
  ];
  // Sans choix de la personne, les sources de la configuration (sauf `branche: false`) ; sinon, son choix.
  const isPlugged = ({ el, origin }) => (plugged ? plugged.has(el.id) : !origin && el.branche !== false);
  const available = offered.filter(isPlugged).map((x) => x.el);
  const originOf = new Map(offered.map((x) => [x.el.id, x.origin]));
  const describe = (el) => ({ id: el.id, label: el.libelle, nature: el.nature, tone: el.couleur ?? 'bleu', origin: originOf.get(el.id) ?? null });
  const elements = available.map((el) => ({
    id: el.id,
    label: el.libelle,
    nature: el.nature,
    tone: el.couleur ?? 'bleu',
    marker: MARKERS[el.repere ?? 'ponctuel'],
    visible: el.affiche ?? true,
    objectLabel: { one: el.objet?.[0] ?? 'élément', many: el.objet?.[1] ?? 'éléments' },
    hover: (el.survol ?? []).map((s) => s.libelle),
    reschedulable: !!el.replanifier && !el.repetition,
    origin: originOf.get(el.id) ?? null,
  }));
  const order = new Map(offered.map((x, i) => [x.el.id, i]));
  const events = available
    .flatMap((el) => eventsOf(el, reader, win))
    .sort((a, b) => a.date.localeCompare(b.date) || order.get(a.element) - order.get(b.element) || a.title.localeCompare(b.title, 'fr'));
  return {
    interaction: {
      access: config.interaction?.access ?? 'collapsed',
      controls: { sources: true, fields: true, indicators: true, density: true, completed: true, appearance: true, ...config.interaction?.controls },
      includeDone: config.interaction?.includeDone ?? true,
    },
    display: {
      view: VIEWS[config.vue ?? 'mois'],
      perCell: config.reperesParCase ?? 2,
      perPeek: config.reperesAuSurvol ?? 4,
      peekCloseDelayMs: config.delaiFermetureSurvol ?? 260,
      format: config.format ?? 'standard',
      design: config.design ?? 'standard',
      effect: config.effet ?? 'standard',
    },
    formats: [...formatsOf(config), ...ownFormats.map((f) => ({ ...f, builtIn: false, own: true }))],
    library: offered.filter((x) => !isPlugged(x)).map((x) => describe(x.el)),
    plugged: plugged ? [...plugged].filter((id) => originOf.has(id)) : null,
    indicators: (config.indicateurs ?? ['elements', 'dates', 'suivi']).map((k) => ({ key: k, label: INDICATORS[k].label })),
    elements,
    events,
  };
}

