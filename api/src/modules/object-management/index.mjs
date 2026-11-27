// Object Management (transverse) : exposition en lecture seule des objets de tous les niveaux,
// de leurs relations, des contrôles et des exports. Remise à zéro réservée à la recette.
import { fail } from '../../socle/errors.mjs';
import { today } from '../../socle/clock.mjs';
import { date } from '../../socle/validation.mjs';

export default {
  id: 'object-management',
  label: 'Object Management',
  level: 0,
  dependsOn: [],

  routes(socle) {
    const { inspector } = socle;
    const scopeOf = (query) => query.get('scope') || 'all';
    return [
      [
        'GET',
        '/api/om/objects',
        ({ ctx, query }) => inspector.inventory(socle.stateOf(ctx), { q: query.get('q') || undefined, kind: query.get('kind') || undefined, scope: scopeOf(query) }),
      ],
      [
        'GET',
        '/api/om/objects/:id',
        ({ ctx, params }) => inspector.inspectObject(socle.stateOf(ctx), params.id) ?? fail('NOT_FOUND', 'Objet introuvable.', { id: params.id }),
      ],
      ['GET', '/api/om/kinds', () => [...socle.registry.kinds.values()].map(({ kind, label, prefix, module, level, domain, references }) => ({ kind, label, prefix, module, level, domain, references }))],
      ['GET', '/api/om/checks', ({ ctx }) => inspector.checks(socle.stateOf(ctx))],
      ['GET', '/api/om/debug', ({ ctx, query }) => inspector.exportDebug(socle.stateOf(ctx), scopeOf(query))],
      ['GET', '/api/om/csv', () => inspector.csvFiles()],
      [
        'GET',
        '/api/om/csv/:file',
        ({ ctx, params, query }) => {
          const body = inspector.exportCsv(socle.stateOf(ctx), params.file, scopeOf(query));
          if (body === null) fail('NOT_FOUND', 'Fichier CSV inconnu.', { file: params.file, files: inspector.csvFiles() });
          return { __download: params.file, __type: 'text/csv; charset=utf-8', __body: body };
        },
      ],
      [
        'GET',
        '/api/om/export.zip',
        ({ ctx, query }) => {
          // Un seul état lu, figé pour tout le dossier de preuve : aucune écriture ne s'y mélange.
          const { manifest, zip } = inspector.exportArchive(socle.stateOf(ctx), scopeOf(query));
          return { __download: `preuve-om-${manifest.snapshotId}.zip`, __type: 'application/zip', __body: zip };
        },
      ],
      // Architecture du socle : principes appliqués, modules et leurs frontières, système de gestion des données.
      ['GET', '/api/om/architecture', async () => ({ principles: socle.principles, modules: socle.registry.describe(), data: await socle.store.describe() })],
      [
        'POST',
        '/api/_recette/reset',
        async () => {
          if (!socle.config?.recetteReset) fail('NOT_FOUND', 'Route inconnue.');
          return socle.resetData();
        },
      ],
      [
        'PUT',
        '/api/_recette/today',
        // Horloge de recette (bout en bout) : fixe la date du jour du socle (`SOCLE_TODAY`), ou la rend (`date: null`).
        // Comme la réinitialisation, elle n'existe qu'avec J1_ENABLE_RECETTE_RESET=1.
        ({ body }) => {
          if (!socle.config?.recetteReset) fail('NOT_FOUND', 'Route inconnue.');
          if (body?.date === null) delete process.env.SOCLE_TODAY;
          else process.env.SOCLE_TODAY = date('date', body?.date, { required: true });
          return { today: today() };
        },
      ],
    ];
  },
};
