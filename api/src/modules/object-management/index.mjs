// Object Management (transverse) : exposition en lecture seule des objets de tous les niveaux,
// de leurs relations, des contrôles et des exports. Remise à zéro réservée à la recette.
import { fail } from '../../socle/errors.mjs';
import { emptyState } from '../../socle/store.mjs';

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
        ({ query }) => inspector.inventory(socle.state, { q: query.get('q') || undefined, kind: query.get('kind') || undefined, scope: scopeOf(query) }),
      ],
      [
        'GET',
        '/api/om/objects/:id',
        ({ params }) => inspector.inspectObject(socle.state, params.id) ?? fail('NOT_FOUND', 'Objet introuvable.', { id: params.id }),
      ],
      ['GET', '/api/om/kinds', () => [...socle.registry.kinds.values()].map(({ kind, label, prefix, module, level, domain, references }) => ({ kind, label, prefix, module, level, domain, references }))],
      ['GET', '/api/om/checks', () => inspector.checks(socle.state)],
      ['GET', '/api/om/debug', ({ query }) => inspector.exportDebug(socle.state, scopeOf(query))],
      ['GET', '/api/om/csv', () => inspector.csvFiles()],
      [
        'GET',
        '/api/om/csv/:file',
        ({ params, query }) => {
          const body = inspector.exportCsv(socle.state, params.file, scopeOf(query));
          if (body === null) fail('NOT_FOUND', 'Fichier CSV inconnu.', { file: params.file, files: inspector.csvFiles() });
          return { __download: params.file, __type: 'text/csv; charset=utf-8', __body: body };
        },
      ],
      [
        'GET',
        '/api/om/export.zip',
        ({ query }) => {
          // Un seul état lu, figé pour tout le dossier de preuve : aucune écriture ne s'y mélange.
          const { manifest, zip } = inspector.exportArchive(socle.state, scopeOf(query));
          return { __download: `preuve-om-${manifest.snapshotId}.zip`, __type: 'application/zip', __body: zip };
        },
      ],
      [
        'POST',
        '/api/_recette/reset',
        async () => {
          if (!socle.config?.recetteReset) fail('NOT_FOUND', 'Route inconnue.');
          return socle.store.mutate((draft) => {
            for (const k of Object.keys(draft)) delete draft[k];
            Object.assign(draft, emptyState(socle.registry.collections()));
            return { value: { reset: true } };
          });
        },
      ],
    ];
  },
};
