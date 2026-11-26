// Calendrier : contrat des natures fournies par un module et validation de la configuration (formats, préférences
// d'affichage, entrées, conditions). Aucune lecture de données ici.
import { fail } from '../../socle/errors.mjs';
import { isCalendarDate } from '../../socle/validation.mjs';
import { TONES, MARKERS, VIEWS, FORMATS, CADENCES, INDICATORS, LAYOUTS, FORMAT_FIELDS, BUILT_IN_FORMATS, FORMAT_ID, MAX_OWN_FORMATS, OWN_FORMAT_ID, isObj, isText, asList } from './constants.mjs';

// ---------- contrat des natures fournies par un module ----------
/** Types de champ qu'une nature fournie déclare : le moteur contrôle que la configuration n'en utilise pas d'autres. */
export const FIELD_TYPES = ['texte', 'date', 'montant', 'nombre', 'booleen', 'liste', 'objet', 'identifiant'];

/** Contrôle la déclaration d'une nature fournie : libellé, lecture, champs typés (dont `id`). */
export function validateProvidedNature(nature, def) {
  const at = `calendarSources.${nature}`;
  if (!/^[a-z][A-Za-z0-9]*$/.test(nature)) throw new Error(`${at} : nom de nature invalide.`);
  if (!isObj(def) || !isText(def.label) || typeof def.read !== 'function') throw new Error(`${at} : { label, read(ctx, fenêtre), fields } est attendu.`);
  if (!isObj(def.fields) || !Object.keys(def.fields).length) throw new Error(`${at} : les champs fournis (fields) sont à déclarer.`);
  for (const [field, type] of Object.entries(def.fields)) if (!FIELD_TYPES.includes(type)) throw new Error(`${at}.fields.${field} : type inconnu « ${type} ».`);
  if (def.fields.id !== 'identifiant') throw new Error(`${at}.fields.id : chaque objet fourni a un identifiant.`);
  return def;
}

/** Contrôle ce qu'une nature fournie a rendu : une liste d'objets à identifiant texte, dates au format du calendrier. */
export function checkProvidedObjects(nature, def, objects) {
  if (!Array.isArray(objects)) throw new Error(`calendarSources.${nature} : la lecture doit rendre une liste.`);
  const dates = Object.entries(def.fields).filter(([, t]) => t === 'date').map(([k]) => k);
  for (const o of objects) {
    if (!isObj(o) || !isText(o.id)) throw new Error(`calendarSources.${nature} : chaque objet rendu a un identifiant texte.`);
    for (const k of dates) if (o[k] !== null && o[k] !== undefined && !isCalendarDate(o[k])) throw new Error(`calendarSources.${nature} : « ${k} » de ${o.id} n'est pas une date AAAA-MM-JJ.`);
  }
  return objects;
}

/** Champs d'un objet nommés par un élément de configuration (premier segment des chemins). */
export function fieldsUsedBy(el) {
  const out = new Set();
  const add = (path) => { if (isText(path) && path !== '@date') out.add(path.split('.')[0]); };
  const fromTemplate = (t) => { if (isText(t)) for (const [, p] of t.matchAll(/\{([@\w.]+)\}/g)) add(p); };
  const fromCondition = (c) => { if (isObj(c)) for (const k of Object.keys(c)) if (k !== 'relies') add(k); };
  const fromEntry = (e) => {
    if (!isObj(e)) return;
    asList(e.champ).forEach(add);
    if (!e.reference && !e.relies) fromTemplate(e.texte);
    if (e.sinon) fromEntry(e.sinon);
  };
  asList(el.date).forEach(add);
  fromTemplate(el.titre);
  fromTemplate(el.lien);
  fromCondition(el.filtre);
  fromCondition(el.termine);
  if (el.montant) { asList(el.montant.champ).forEach(add); if (el.montant.sens?.champ) add(el.montant.sens.champ); }
  for (const e of [el.statut, el.groupe, ...(el.survol ?? [])]) fromEntry(e);
  if (el.repetition) for (const k of ['debut', 'fin', 'cadence', 'ancrage']) add(el.repetition[k]);
  if (el.replanifier) { fromTemplate(el.replanifier.route); fromCondition(el.replanifier.si); }
  return out;
}

// ---------- validation de la configuration ----------

/** Un format d'affichage : identifiant, libellé, disposition, champs dans l'ordre, repères par case. */
export function validateFormat(format, at) {
  if (!isObj(format)) fail('VALIDATION', `${at} : un format { id, libelle, disposition, champs } est attendu.`);
  if (!isText(format.id) || !FORMAT_ID.test(format.id)) fail('VALIDATION', `${at}.id : identifiant en lettres minuscules, chiffres et tirets.`);
  if (!isText(format.libelle)) fail('VALIDATION', `${at}.libelle : un libellé est attendu.`);
  if (!LAYOUTS.includes(format.disposition)) fail('VALIDATION', `${at}.disposition : ligne, deux-lignes ou pastille.`, { dispositions: LAYOUTS });
  if (!Array.isArray(format.champs) || format.champs.some((c) => !FORMAT_FIELDS.includes(c)) || new Set(format.champs).size !== format.champs.length) fail('VALIDATION', `${at}.champs : champs distincts parmi ${FORMAT_FIELDS.join(', ')}.`, { champs: FORMAT_FIELDS });
  if (format.reperesParCase !== undefined && (!Number.isInteger(format.reperesParCase) || format.reperesParCase < 0 || format.reperesParCase > 8)) fail('VALIDATION', `${at}.reperesParCase : un entier entre 0 et 8.`);
}

function validateFormats(config) {
  const ids = new Set(BUILT_IN_FORMATS.map((f) => f.id));
  if (config.formats !== undefined) {
    if (!Array.isArray(config.formats)) fail('VALIDATION', 'formats : une liste de formats est attendue.');
    config.formats.forEach((f, i) => {
      validateFormat(f, `formats[${i}]`);
      if (ids.has(f.id)) fail('VALIDATION', `formats[${i}].id : « ${f.id} » existe déjà.`);
      ids.add(f.id);
    });
  }
  if (config.format !== undefined && !ids.has(config.format)) fail('VALIDATION', `format : format inconnu « ${config.format} ».`, { formats: [...ids] });
}

/** Formats créés par une personne : forme du site ({ id: perso-…, label, layout, fields, perCell }). */
export function validateOwnFormats(formats) {
  if (!Array.isArray(formats) || formats.length > MAX_OWN_FORMATS) fail('VALIDATION', `formats : une liste d'au plus ${MAX_OWN_FORMATS} formats est attendue.`);
  const ids = new Set();
  return formats.map((f, i) => {
    const at = `formats[${i}]`;
    if (!isObj(f) || !isText(f.id) || !OWN_FORMAT_ID.test(f.id)) fail('VALIDATION', `${at}.id : « perso-… » en minuscules, chiffres et tirets.`);
    if (ids.has(f.id)) fail('VALIDATION', `${at}.id : « ${f.id} » figure deux fois.`);
    ids.add(f.id);
    if (!isText(f.label) || f.label.trim().length > 40) fail('VALIDATION', `${at}.label : un nom de 40 caractères au plus.`);
    if (!LAYOUTS.includes(f.layout)) fail('VALIDATION', `${at}.layout : ligne, deux-lignes ou pastille.`);
    if (!Array.isArray(f.fields) || f.fields.some((c) => !FORMAT_FIELDS.includes(c)) || new Set(f.fields).size !== f.fields.length) fail('VALIDATION', `${at}.fields : champs distincts parmi ${FORMAT_FIELDS.join(', ')}.`);
    if (!(f.perCell === null || f.perCell === undefined || (Number.isInteger(f.perCell) && f.perCell >= 0 && f.perCell <= 8))) fail('VALIDATION', `${at}.perCell : vide ou un entier entre 0 et 8.`);
    return { id: f.id, label: f.label.trim(), layout: f.layout, fields: [...f.fields], perCell: f.perCell ?? null };
  });
}

/** Préférences d'affichage d'une personne pour un calendrier : sources visibles, format, indicateurs, densité, terminés. */
export function validateDisplayPreferences(display) {
  if (display === null) return null;
  if (!isObj(display)) fail('VALIDATION', 'display : un objet est attendu.');
  const out = {};
  if (display.sources !== undefined) {
    if (!isObj(display.sources) || Object.values(display.sources).some((v) => typeof v !== 'boolean')) fail('VALIDATION', 'display.sources : { source: true | false } est attendu.');
    out.sources = { ...display.sources };
  }
  if (display.format !== undefined) {
    if (!isText(display.format) || !FORMAT_ID.test(display.format)) fail('VALIDATION', 'display.format : identifiant de format attendu.');
    out.format = display.format;
  }
  if (display.indicators !== undefined) {
    if (!Array.isArray(display.indicators) || display.indicators.some((k) => !INDICATORS[k])) fail('VALIDATION', 'display.indicators : indicateurs connus attendus.', { indicateurs: Object.keys(INDICATORS) });
    out.indicators = [...new Set(display.indicators)];
  }
  if (display.perCell !== undefined) {
    if (!(display.perCell === null || (Number.isInteger(display.perCell) && display.perCell >= 0 && display.perCell <= 8))) fail('VALIDATION', 'display.perCell : vide ou un entier entre 0 et 8.');
    out.perCell = display.perCell;
  }
  for (const k of ['design', 'effect']) {
    if (display[k] === undefined) continue;
    if (!isText(display[k]) || !FORMAT_ID.test(display[k])) fail('VALIDATION', `display.${k} : identifiant attendu.`);
    out[k] = display[k];
  }
  if (display.effectParams !== undefined) {
    const p = display.effectParams;
    if (!isObj(p) || Object.keys(p).length > 16 || Object.entries(p).some(([k, v]) => !/^[a-zA-Z]{1,30}$/.test(k) || typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10000)) {
      fail('VALIDATION', 'display.effectParams : réglages numériques entre 0 et 10 000 attendus.');
    }
    out.effectParams = { ...p };
  }
  if (display.includeDone !== undefined) {
    if (typeof display.includeDone !== 'boolean') fail('VALIDATION', 'display.includeDone : booléen attendu.');
    out.includeDone = display.includeDone;
  }
  return out;
}

/** Formats proposés par une configuration : les formats livrés, puis les siens. */
export function formatsOf(config) {
  return [
    ...BUILT_IN_FORMATS,
    ...(config.formats ?? []).map((f) => ({ id: f.id, label: f.libelle, layout: f.disposition, fields: [...f.champs], perCell: f.reperesParCase ?? null, builtIn: false })),
  ];
}

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
export function validateConfiguration(config, registry, provided = new Map()) {
  const names = provided instanceof Map ? provided : new Map([...provided].map((n) => [n, null]));
  const natureOk = (nature, at) => {
    if (!registry.kinds.has(nature) && !names.has(nature)) fail('VALIDATION', `${at} : nature d'objet inconnue « ${nature} ».`, { natures: [...registry.kinds.keys(), ...names.keys()] });
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
  if (config.interaction !== undefined) {
    const settings = config.interaction;
    if (!isObj(settings)) fail('VALIDATION', 'interaction : un objet est attendu.');
    if (settings.access !== undefined && !['hidden', 'collapsed', 'expanded'].includes(settings.access)) fail('VALIDATION', 'interaction.access : hidden, collapsed ou expanded.');
    for (const [key, allowed] of [['controls', ['sources', 'fields', 'indicators', 'density', 'completed', 'appearance']], ['fields', ['amount', 'total', 'type', 'status', 'group']]]) {
      if (settings[key] !== undefined && (!isObj(settings[key]) || Object.entries(settings[key]).some(([k, v]) => !allowed.includes(k) || typeof v !== 'boolean'))) fail('VALIDATION', 'Options booléennes connues attendues dans interaction.' );
    }
    if (settings.includeDone !== undefined && typeof settings.includeDone !== 'boolean') fail('VALIDATION', 'interaction.includeDone : booléen attendu.');
  }
  validateFormats(config);
  // Design et effet d'affichage d'ouverture : définis par le site (couche de présentation), nommés ici.
  for (const k of ['design', 'effet']) if (config[k] !== undefined && (!isText(config[k]) || !FORMAT_ID.test(config[k]))) fail('VALIDATION', `${k} : identifiant en minuscules, chiffres et tirets.`);
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
    // Nature fournie : la configuration n'emploie que les champs que son module déclare.
    const declared = names.get(el.nature)?.fields;
    if (declared) {
      const unknown = [...fieldsUsedBy(el)].filter((k) => !Object.hasOwn(declared, k));
      if (unknown.length) fail('VALIDATION', `${at} : champ(s) non fourni(s) par « ${el.nature} » : ${unknown.join(', ')}.`, { champs: Object.keys(declared) });
    }
    if (!(isText(el.date) || (Array.isArray(el.date) && el.date.length && el.date.every(isText)))) fail('VALIDATION', `${at}.date : le champ date (ou une liste, le premier renseigné) est attendu.`);
    if (!isText(el.titre)) fail('VALIDATION', `${at}.titre : un modèle de titre est attendu (ex. « {title} »).`);
    if (el.repere !== undefined && !MARKERS[el.repere]) fail('VALIDATION', `${at}.repere : debut, echeance ou ponctuel.`);
    if (el.couleur !== undefined && !TONES.includes(el.couleur)) fail('VALIDATION', `${at}.couleur : couleur inconnue « ${el.couleur} ».`, { couleurs: TONES });
    if (el.disponible !== undefined && typeof el.disponible !== 'boolean') fail('VALIDATION', 'disponible : booléen attendu.');
    if (el.affiche !== undefined && typeof el.affiche !== 'boolean') fail('VALIDATION', `${at}.affiche : true ou false.`);
    if (el.branche !== undefined && typeof el.branche !== 'boolean') fail('VALIDATION', `${at}.branche : true ou false (false : source proposée, à brancher).`);
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

