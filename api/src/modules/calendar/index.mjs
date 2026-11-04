// Calendrier (transverse, niveau 0) : un service autonome, réutilisable par tous les modules (spec v0.4, C12).
// Un seul code (`engine.mjs`) se comporte selon les paramètres qu'on lui donne : une configuration dit quelles
// natures d'objets lire, quel champ sert de date, de titre ou de montant, ce qui est terminé, ce qui se répète,
// quelles entrées montrer au survol, quels indicateurs résumer et quelle commande de l'API replanifie un repère.
// Les données lues sont celles du user du contexte, en lecture seule. Aucun module n'est modifié pour être
// affiché : chaque calendrier est un paramètre administrable `calendrier.<id>` (valeurs livrées dans
// `defaults.mjs`), et une configuration peut aussi être fournie à l'appel (aperçu, autre module).
import { fail } from '../../socle/errors.mjs';
import { today } from '../../socle/clock.mjs';
import { date } from '../../socle/validation.mjs';
import { CALENDAR_BUDGET_PATRIMOINE, CALENDAR_NOYAU, CALENDAR_PATRIMOINE } from './defaults.mjs';
import { CADENCES, FORMATS, INDICATORS, MARKERS, MAX_WINDOW_DAYS, TONES, VIEWS, dayNumber, readCalendar, readerFor, validateConfiguration } from './engine.mjs';

/** Calendriers livrés : identifiant → configuration par défaut du paramètre `calendrier.<id>`. */
const CALENDARS = {
  noyau: CALENDAR_NOYAU,
  budgetPatrimoine: CALENDAR_BUDGET_PATRIMOINE,
  patrimoine: CALENDAR_PATRIMOINE,
};

const parameterKey = (id) => `calendrier.${id}`;

export default {
  id: 'calendar',
  label: 'Calendrier',
  level: 0,
  dependsOn: ['users'],

  parameters: Object.entries(CALENDARS).map(([id, config]) => ({
    key: parameterKey(id),
    label: config.libelle,
    group: 'Calendrier',
    type: 'object',
    description:
      'Configuration du calendrier : vue d’ouverture (semaine, mois, annee), repères par case et au survol, indicateurs du survol, et éléments affichés. Chaque élément nomme une nature d’objet, son champ date, son titre, sa couleur, ses entrées de survol, et le cas échéant son montant, sa répétition et sa commande de replanification.',
    default: config,
    validate: (value, state, socle) => validateConfiguration(value, socle.registry),
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

    /** Applique une configuration aux données du user du contexte sur une fenêtre. Aucune écriture. */
    function run(ctx, config, q) {
      const state = socle.state;
      const userId = om.requireUser(state, ctx);
      const win = windowOf(q);
      const reader = readerFor(state, registry, parameters, userId, today());
      return { window: win, today: reader.today, ...readCalendar(config, reader, win) };
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
        return {
          calendar: { id, label: p.value.libelle, description: p.value.description ?? null },
          parameter: { key: p.key, revision: p.revision, origin: p.origin },
          ...run(ctx, p.value, q),
        };
      },

      /** Configuration fournie à l'appel (aperçu d'un paramétrage, usage par un autre module) : contrôlée puis lue. */
      preview(ctx, body = {}) {
        validateConfiguration(body.configuration, registry);
        return {
          calendar: { id: null, label: body.configuration.libelle, description: body.configuration.description ?? null },
          parameter: null,
          ...run(ctx, body.configuration, body),
        };
      },

      /** Vocabulaire des configurations : natures d'objets du registre, couleurs, repères, formats, indicateurs. */
      catalog() {
        return {
          natures: [...registry.kinds.values()].map(({ kind, label, module, level }) => ({ nature: kind, label, module, level })),
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
    ];
  },
};
