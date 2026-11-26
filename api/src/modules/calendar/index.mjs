// Calendrier (transverse, niveau 0) : un service autonome, réutilisable par tous les modules (spec v0.4, C12).
// Un seul code (`engine.mjs`) se comporte selon les paramètres qu'on lui donne : une configuration dit quelles
// natures d'objets lire, quel champ sert de date, de titre ou de montant, ce qui est terminé, ce qui se répète,
// quelles entrées montrer au survol, quels indicateurs résumer et quelle commande de l'API replanifie un repère.
// Les données lues sont celles du user du contexte, en lecture seule. Aucun module n'est modifié pour être
// affiché : chaque calendrier est un paramètre administrable `calendrier.<id>` (valeurs livrées dans
// `defaults.mjs`), et une configuration peut aussi être fournie à l'appel (aperçu, autre module).
// Un module de niveau supérieur peut fournir des natures calculées par l'extension `calendarSources` (sens
// unique : le calendrier ne dépend d'aucun d'eux) ; la personne peut brancher les sources d'un autre
// calendrier livré (`sources`), et chaque lecture rend les formats d'affichage proposés.
import { fail } from '../../socle/errors.mjs';
import { today } from '../../socle/clock.mjs';
import { date } from '../../socle/validation.mjs';
import { CALENDAR_BUDGET_PATRIMOINE, CALENDAR_NOYAU, CALENDAR_PATRIMOINE } from './defaults.mjs';
import { BUILT_IN_FORMATS, addDays, CADENCES, FIELD_TYPES, FORMAT_FIELDS, FORMATS, INDICATORS, LAYOUTS, MARKERS, MAX_PLUGGED, MAX_WINDOW_DAYS, TONES, VIEWS, checkProvidedObjects, dayNumber, readCalendar, readerFor, validateConfiguration, validateDisplayPreferences, validateOwnFormats, validateProvidedNature } from './engine.mjs';

/** Calendriers livrés : identifiant → configuration par défaut du paramètre `calendrier.<id>`. */
const CALENDARS = {
  noyau: CALENDAR_NOYAU,
  budgetPatrimoine: CALENDAR_BUDGET_PATRIMOINE,
  patrimoine: CALENDAR_PATRIMOINE,
};

const parameterKey = (id) => `calendrier.${id}`;

/**
 * Natures fournies par les modules (extension `calendarSources`) : { nature: { label, module, read(ctx, fenêtre) } }.
 * Chaque fournisseur s'exécute dans la portée de son module ; le calendrier ne connaît que leur contrat.
 */
function providedSources(socle) {
  const out = new Map();
  for (const provide of socle.registry.extensions('calendarSources')) {
    for (const [nature, def] of Object.entries(provide(socle) ?? {})) {
      if (out.has(nature)) throw new Error(`calendarSources.${nature} : nature fournie deux fois.`);
      out.set(nature, validateProvidedNature(nature, def));
    }
  }
  return out;
}

/** Calendriers dont la page hôte propose les sources (`?offre=a,b`) ; absente : aucune autre source. */
function offerOf(q) {
  if (q.offre === undefined || q.offre === null || q.offre === '') return [];
  const ids = String(q.offre).split(',').map((x) => x.trim()).filter(Boolean);
  for (const id of ids) if (!Object.hasOwn(CALENDARS, id)) fail('VALIDATION', `Calendrier proposé inconnu « ${id} ».`, { field: 'offre', calendars: Object.keys(CALENDARS) });
  return ids;
}

/** Liste `a,b,c` des sources branchées (`?sources=`), absente : choix de la configuration. */
function pluggedOf(q) {
  if (q.sources === undefined || q.sources === null) return null;
  const ids = String(q.sources).split(',').map((x) => x.trim()).filter(Boolean);
  if (ids.length > MAX_PLUGGED + 20) fail('VALIDATION', `Trop de sources branchées (${MAX_PLUGGED} au plus en plus de la configuration).`, { field: 'sources' });
  return new Set(ids);
}

export default {
  id: 'calendar',
  label: 'Calendrier',
  level: 2,
  role: 'transverse',
  dependsOn: ['users'],

  // Préférences d'une personne : par calendrier (sources branchées, affichage) et pour tous ses calendriers
  // (`calendar: '*'`, ses formats). Elles ne touchent jamais aux données métier ni au paramètre administré.
  kinds: {
    calendarPreference: { collection: 'calendarPreferences', prefix: 'calp', label: 'Préférences de calendrier', references: {} },
  },

  parameters: Object.entries(CALENDARS).map(([id, config]) => ({
    key: parameterKey(id),
    label: config.libelle,
    group: 'Calendrier',
    type: 'object',
    description:
      'Configuration du calendrier : vue d’ouverture (semaine, mois, annee), repères par case et au survol, indicateurs du survol, et éléments affichés. Chaque élément nomme une nature d’objet, son champ date, son titre, sa couleur, ses entrées de survol, et le cas échéant son montant, sa répétition et sa commande de replanification.',
    default: config,
    validate: (value, state, socle) => validateConfiguration(value, socle.registry, providedSources(socle)),
  })),

  setup(socle) {
    const { om, registry, parameters } = socle;

    function windowOf(q) {
      const from = date('from', q.from, { required: true });
      const to = date('to', q.to, { required: true });
      if (to < from) fail('VALIDATION', 'La fin de la fenêtre précède son début.', { field: 'to' });
      if (dayNumber(to) - dayNumber(from) + 1 > MAX_WINDOW_DAYS) fail('VALIDATION', `Fenêtre limitée à ${MAX_WINDOW_DAYS} jours.`, { field: 'to' });
      return { from, to };
    }

    /** Natures fournies, liées au user et à la fenêtre de la lecture : chacune n'est calculée qu'une fois, à la demande. */
    function providedFor(ctx, win) {
      const out = new Map();
      for (const [nature, def] of providedSources(socle)) out.set(nature, () => checkProvidedObjects(nature, def, def.read(ctx, win)));
      return out;
    }

    /** Sources des calendriers que la page hôte propose, offertes au branchement sous un identifiant qualifié. */
    function foreignOf(id, offer) {
      return offer.filter((other) => other !== id).flatMap((other) => {
        const config = parameters.effective(socle.state, parameterKey(other)).value;
        return config.elements.filter((el) => el.disponible !== false)
          .map((el) => ({ el: { ...el, id: `${other}.${el.id}` }, origin: { calendar: other, label: config.libelle } }));
      });
    }

    /** Préférences enregistrées d'une personne pour un calendrier (`'*'` : celles de tous ses calendriers). */
    const preferenceOf = (state, userId, calendar) =>
      om.list(state, 'calendarPreference', (p) => p.userId === userId && p.calendar === calendar)[0] ?? null;
    const ownFormatsOf = (state, userId) => preferenceOf(state, userId, '*')?.formats ?? [];

    /** Écrit (ou crée) l'enregistrement de préférences : une commande d'Object Management, sans clé de demande. */
    async function writePreference(ctx, calendar, patch, command) {
      return om.command(command, ctx, patch, (tx) => {
        const current = preferenceOf(tx.draft, tx.userId, calendar);
        const record = current ? om.update(tx, current, patch) : om.create(tx, 'calendarPreference', { calendar, display: null, plugged: null, formats: [], ...patch });
        return { calendar, revision: (record ?? preferenceOf(tx.draft, tx.userId, calendar))?.revision ?? null };
      });
    }

    /** Applique une configuration aux données du user du contexte sur une fenêtre. Aucune écriture. */
    function run(ctx, config, q, options = {}) {
      const state = socle.state;
      const userId = om.requireUser(state, ctx);
      const win = windowOf(q);
      const reader = readerFor(state, registry, parameters, userId, today(), providedFor(ctx, win));
      return { window: win, today: reader.today, ...readCalendar(config, reader, win, options) };
    }

    function calendarParameter(id) {
      if (!Object.hasOwn(CALENDARS, id)) fail('NOT_FOUND', 'Calendrier inconnu.', { calendar: id, calendars: Object.keys(CALENDARS) });
      return parameters.effective(socle.state, parameterKey(id));
    }

    return {
      list() {
        return Object.keys(CALENDARS).map((id) => {
          const p = calendarParameter(id);
          return { id, label: p.value.libelle, description: p.value.description ?? null, parameter: p.key, revision: p.revision, origin: p.origin };
        });
      },

      /** Calendrier nommé : sa configuration est le paramètre `calendrier.<id>`. */
      read(ctx, id, q = {}) {
        const p = calendarParameter(id);
        const userId = om.requireUser(socle.state, ctx);
        const saved = preferenceOf(socle.state, userId, id);
        // Sans `sources` dans l'appel : celles que la personne a enregistrées, sinon celles de la configuration.
        // `personnel=non` : lecture de référence (un autre module qui lit le calendrier), sans les choix personnels.
        const personal = q.personnel !== 'non';
        const asked = pluggedOf(q);
        const plugged = asked ?? (personal && saved?.plugged ? new Set(saved.plugged) : null);
        return {
          calendar: { id, label: p.value.libelle, description: p.value.description ?? null },
          parameter: { key: p.key, revision: p.revision, origin: p.origin },
          ...run(ctx, p.value, q, { plugged, foreign: foreignOf(id, offerOf(q)), ownFormats: ownFormatsOf(socle.state, userId) }),
          preferences: { display: saved?.display ?? null, revision: saved?.revision ?? null },
        };
      },

      /**
       * Événements d'un calendrier sur une période de toute longueur, lue par tranches de 400 jours (fenêtre maximale) :
       * la lecture des autres modules (Météo, échéances), sans les choix personnels.
       */
      events(ctx, id, { from, to }) {
        const out = [];
        for (let start = from; start <= to; start = addDays(start, MAX_WINDOW_DAYS)) {
          const end = [addDays(start, MAX_WINDOW_DAYS - 1), to].sort()[0];
          out.push(...this.read(ctx, id, { from: start, to: end, personnel: 'non' }).events);
        }
        return out;
      },

      /** Préférences de la personne pour ce calendrier : affichage et/ou sources branchées (nul : revenir au défaut). */
      async savePreferences(ctx, id, input = {}) {
        calendarParameter(id);
        const patch = {};
        if (input.display !== undefined) patch.display = validateDisplayPreferences(input.display);
        if (input.plugged !== undefined) {
          if (input.plugged !== null && (!Array.isArray(input.plugged) || input.plugged.some((x) => typeof x !== 'string') || input.plugged.length > MAX_PLUGGED + 20)) fail('VALIDATION', 'plugged : une liste d’identifiants de sources (ou null) est attendue.');
          patch.plugged = input.plugged === null ? null : [...new Set(input.plugged)];
        }
        if (!Object.keys(patch).length) fail('VALIDATION', 'display ou plugged est attendu.');
        return writePreference(ctx, id, patch, 'saveCalendarPreferences');
      },

      /** Formats créés par la personne : valables dans tous ses calendriers, appelés comme les formats livrés. */
      async saveFormats(ctx, input = {}) {
        return writePreference(ctx, '*', { formats: validateOwnFormats(input.formats) }, 'saveCalendarFormats');
      },

      /** Configuration fournie à l'appel (aperçu d'un paramétrage, usage par un autre module) : contrôlée puis lue. */
      preview(ctx, body = {}) {
        validateConfiguration(body.configuration, registry, providedSources(socle));
        return {
          calendar: { id: null, label: body.configuration.libelle, description: body.configuration.description ?? null },
          parameter: null,
          ...run(ctx, body.configuration, body),
        };
      },

      /** Vocabulaire des configurations : natures d'objets du registre, couleurs, repères, formats, indicateurs. */
      catalog() {
        return {
          natures: [
            ...[...registry.kinds.values()].map(({ kind, label, module, level }) => ({ nature: kind, label, module, level, provided: false })),
            ...[...providedSources(socle)].map(([nature, def]) => ({ nature, label: def.label, module: def.module ?? null, level: null, provided: true, fields: def.fields })),
          ],
          layouts: LAYOUTS,
          formatFields: FORMAT_FIELDS,
          builtInFormats: BUILT_IN_FORMATS,
          fieldTypes: FIELD_TYPES,
          tones: TONES,
          markers: Object.keys(MARKERS),
          views: Object.keys(VIEWS),
          formats: FORMATS,
          cadences: CADENCES,
          indicators: Object.entries(INDICATORS).map(([key, v]) => ({ key, ...v })),
          calendars: Object.keys(CALENDARS).map((id) => ({ id, parameter: parameterKey(id) })),
        };
      },
    };
  },

  routes(socle) {
    const s = socle.modules.calendar;
    return [
      ['GET', '/api/calendar', () => s.list()],
      ['GET', '/api/calendar/catalog', () => s.catalog()],
      ['POST', '/api/calendar/preview', ({ ctx, body }) => s.preview(ctx, body)],
      ['GET', '/api/calendar/:id', ({ ctx, params, query }) => s.read(ctx, params.id, Object.fromEntries(query))],
      ['PUT', '/api/calendar/:id/preferences', ({ ctx, params, body }) => s.savePreferences(ctx, params.id, body)],
      ['PUT', '/api/calendar/formats', ({ ctx, body }) => s.saveFormats(ctx, body)],
    ];
  },
};
