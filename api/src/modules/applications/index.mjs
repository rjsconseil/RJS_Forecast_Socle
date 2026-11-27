// Données des applications autonomes (niveau 2, middleware transverse) : la base commune servie à toutes les
// applications autonomes et hybrides. Chaque collection déclarée par une application (donnees.json, lu par
// socle/applications.mjs) devient une nature d'objet du socle, rangée dans sa table AA_<préfixe>_… :
// mêmes identifiants, révisions, journal et cloisonnement par user que le grand noyau. Les liens vers le noyau
// (projet, tâche) sont contrôlés à l'écriture. Une collection de catalogue est commune à tous (partition système),
// remplie depuis la déclaration, et se lit seulement. Les règles d'instanciation créent les lignes d'un projet.
import { fail } from '../../socle/errors.mjs';
import { COMMON_FIELDS, normalizeApplication, readApplicationData } from '../../socle/applications.mjs';
import { expectedRevisionOf } from '../../socle/validation.mjs';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkValue(field, def, v) {
  if (v === null || v === undefined || v === '') return null;
  const wrong = () => fail('VALIDATION', `Valeur invalide pour ${field}.`, { field });
  switch (def.type) {
    case 'texte': if (typeof v !== 'string' || v.length > 20000) wrong(); return v.trim();
    case 'nombre': if (typeof v !== 'number' || !Number.isFinite(v)) wrong(); return v;
    case 'entier': if (!Number.isInteger(v)) wrong(); return v;
    case 'date': if (typeof v !== 'string' || !DATE.test(v)) wrong(); return v;
    case 'booleen': if (typeof v !== 'boolean') wrong(); return v;
    case 'choix': if (!def.valeurs.includes(v)) fail('VALIDATION', `${field} doit valoir : ${def.valeurs.join(', ')}.`, { field }); return v;
    case 'liste': if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) wrong(); return [...v];
    default: return structuredClone(v);
  }
}

/** Les champs écrits : seulement ceux déclarés (et les champs communs), contrôlés selon leur type. */
function fieldsOf(col, input = {}, { partial = false } = {}) {
  const out = {};
  const defs = { ...COMMON_FIELDS, ...col.champs };
  for (const [f, def] of Object.entries(defs)) {
    if (partial && !(f in input)) continue;
    out[f] = checkValue(f, def, input[f]);
    if (def.obligatoire && out[f] === null) fail('VALIDATION', `${f} est obligatoire.`, { field: f });
  }
  for (const [f, l] of Object.entries(col.liens)) {
    if (partial && !(f in input)) continue;
    const v = input[f];
    if (v !== undefined && v !== null && typeof v !== 'string') fail('VALIDATION', `Lien ${f} invalide.`, { field: f });
    out[f] = v || null;
    if (l.obligatoire && !out[f]) fail('VALIDATION', `Le lien ${f} est obligatoire.`, { field: f });
  }
  return out;
}

export function createApplicationsModule(declarations = readApplicationData()) {
  const apps = new Map(declarations.map(normalizeApplication).map((a) => [a.application, a]));
  const kinds = {};
  const reads = new Set(['user']);
  for (const a of apps.values()) {
    for (const c of Object.values(a.collections)) {
      const references = Object.fromEntries(Object.entries(c.liens).map(([f, l]) => [f, { kind: l.nature, required: l.obligatoire }]));
      kinds[c.nature] = { collection: c.name, prefix: c.prefixe, label: c.libelle, section: a.section, references };
      for (const l of Object.values(c.liens)) reads.add(l.nature);
    }
  }
  const ownKinds = new Set(Object.keys(kinds));

  const collectionOf = (app, name) => {
    const a = apps.get(app);
    if (!a) fail('NOT_FOUND', `Application autonome inconnue : ${app}.`, { app });
    const c = a.collections[name];
    if (!c) fail('NOT_FOUND', `Collection inconnue pour ${app} : ${name}.`, { app, collection: name });
    return { a, c };
  };
  const writable = (c) => { if (c.catalogue) fail('VALIDATION', `${c.libelle} est un catalogue de référence : il se lit seulement.`, { collection: c.name }); };

  return {
    id: 'applications',
    label: 'Données des applications autonomes',
    level: 2,
    role: 'transverse',
    dependsOn: ['users', 'core'],
    reads: [...reads].filter((k) => !ownKinds.has(k)),
    kinds,
    /** Les déclarations vérifiées (lues par createSocle pour remplir les catalogues). */
    applications: [...apps.values()],

    setup(socle) {
      const { om } = socle;
      const matches = (row, filters) => Object.entries(filters).every(([k, v]) => v === undefined || v === null || v === '' || row[k] === v);
      const sorted = (rows) => rows.sort((x, y) => (x.ordre ?? 0) - (y.ordre ?? 0) || String(x.code ?? x.createdAt).localeCompare(String(y.code ?? y.createdAt)));
      const rowsOf = (state, c, userId, filters = {}) =>
        sorted(om.list(state, c.nature, (r) => (c.catalogue ? !r.userId : r.userId === userId) && matches(r, filters)));
      const checkUnique = (state, c, row, userId) => {
        for (const f of c.unique) {
          if (row[f] === null) continue;
          if (om.list(state, c.nature, (r) => r.userId === userId && r.id !== row.id && r[f] === row[f]).length) {
            fail('CONFLICT', `${c.libelle} : il en existe déjà un pour ${f} = ${row[f]}.`, { field: f });
          }
        }
      };

      return {
        describe: () => [...apps.values()].map((a) => ({
          application: a.application, section: a.section, libelle: a.libelle, catalogue: a.catalogue.version, regles: a.regles,
          collections: Object.values(a.collections).map((c) => ({ nom: c.name, nature: c.nature, libelle: c.libelle, catalogue: c.catalogue, champs: c.champs, liens: c.liens, unique: c.unique })),
        })),

        list(ctx, app, name, filters = {}) {
          const { c } = collectionOf(app, name);
          const state = socle.stateOf(ctx);
          const userId = c.catalogue ? null : om.requireUser(state, ctx);
          return { collection: name, items: rowsOf(state, c, userId, filters) };
        },

        get(ctx, app, name, id) {
          const { c } = collectionOf(app, name);
          const state = socle.stateOf(ctx);
          if (c.catalogue) return om.get(state, c.nature, id) ?? fail('NOT_FOUND', 'Ligne de catalogue introuvable.', { id });
          return om.owned(state, c.nature, id, om.requireUser(state, ctx));
        },

        async create(ctx, app, name, input = {}) {
          const { a, c } = collectionOf(app, name);
          writable(c);
          const r = await om.command(`aa.${app}.${name}.create`, ctx, input, (tx) => {
            const row = { application: a.application, ...fieldsOf(c, input) };
            checkUnique(tx.draft, c, row, tx.userId);
            return { id: om.create(tx, c.nature, row).id };
          }, { creation: true });
          return { replayed: r.replayed, item: this.get(ctx, app, name, r.id) };
        },

        async update(ctx, app, name, id, input = {}) {
          const { c } = collectionOf(app, name);
          writable(c);
          await om.command(`aa.${app}.${name}.update`, ctx, input, (tx) => {
            const row = om.owned(tx.draft, c.nature, id, tx.userId);
            om.checkRevision(row, expectedRevisionOf(input));
            const patch = fieldsOf(c, input, { partial: true });
            checkUnique(tx.draft, c, { ...row, ...patch }, tx.userId);
            om.update(tx, row, patch);
            return {};
          });
          return { item: this.get(ctx, app, name, id) };
        },

        /**
         * Instanciation : applique les règles du catalogue dont le déclencheur est donné, pour un projet (et une étape
         * pour les règles « par étape »). Une ligne déjà créée par la même règle n'est jamais recréée.
         */
        async provision(ctx, app, input = {}) {
          const a = apps.get(app) ?? fail('NOT_FOUND', `Application autonome inconnue : ${app}.`, { app });
          if (!a.regles) fail('VALIDATION', `L'application ${app} n'a pas de règles d'instanciation.`);
          const { declencheur, projectId, etapeId = null } = input;
          if (typeof declencheur !== 'string' || !declencheur) fail('VALIDATION', 'Déclencheur obligatoire.', { field: 'declencheur' });
          const r = await om.command(`aa.${app}.provision`, ctx, input, (tx) => {
            const rules = rowsOf(tx.draft, a.collections[a.regles], null, { declencheur });
            const created = [];
            for (const rule of rules) {
              const target = a.collections[rule.cible];
              if (!target || target.catalogue) fail('VALIDATION', `Règle ${rule.code} : collection cible inconnue (${rule.cible}).`);
              const perStage = rule.multiplicite === 'etape';
              if (perStage && !etapeId) fail('VALIDATION', `La règle ${rule.code} s'applique par étape : etapeId obligatoire.`, { field: 'etapeId' });
              const key = { projectId: projectId ?? null, refCode: rule.refCode ?? rule.code, ...(perStage ? { etapeId } : {}) };
              if (rowsOf(tx.draft, target, tx.userId, key).length) continue;
              const row = { application: a.application, ...fieldsOf(target, { ...(rule.valeurs ?? {}), ...key, catalogue: a.catalogue.version }) };
              created.push({ collection: target.name, id: om.create(tx, target.nature, row).id, regle: rule.code });
            }
            if (!created.length) tx.unchanged = true;
            return { created };
          });
          return { declencheur, created: r.created ?? [] };
        },
      };
    },

    routes(socle) {
      const s = socle.modules.applications;
      const filters = (query) => Object.fromEntries([...(query?.entries?.() ?? [])].filter(([k]) => k !== 'user'));
      return [
        ['GET', '/api/aa', () => ({ applications: s.describe() })],
        ['POST', '/api/aa/:app/instanciation', ({ ctx, params, body }) => s.provision(ctx, params.app, body)],
        ['GET', '/api/aa/:app/:collection', ({ ctx, params, query }) => s.list(ctx, params.app, params.collection, filters(query))],
        ['POST', '/api/aa/:app/:collection', ({ ctx, params, body }) => s.create(ctx, params.app, params.collection, body)],
        ['GET', '/api/aa/:app/:collection/:id', ({ ctx, params }) => s.get(ctx, params.app, params.collection, params.id)],
        ['PUT', '/api/aa/:app/:collection/:id', ({ ctx, params, body }) => s.update(ctx, params.app, params.collection, params.id, body)],
      ];
    },
  };
}

export default createApplicationsModule();
