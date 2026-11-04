// Gestion des utilisateurs (transverse). Un user porte un type (individuel, famille…) qui
// conditionne notamment les centres de coût standards du Budget. Sa création déclenche la
// composition initiale enregistrée par le niveau applicatif (BPM) : tout ou rien.
import { fail } from '../../socle/errors.mjs';
import { expectedRevisionOf, text } from '../../socle/validation.mjs';

const userTypesOf = (socle, state) => socle.parameters.value(state, 'users.types');

export default {
  id: 'users',
  label: 'Gestion des utilisateurs',
  level: 0,
  dependsOn: [],
  kinds: {
    user: { collection: 'users', prefix: 'usr', label: 'User' },
  },
  parameters: [
    {
      key: 'users.types',
      label: "Types d'utilisateur",
      group: 'Utilisateurs',
      type: 'list',
      description: '[P] Types proposés à la création. Le type conditionne les centres de coût standards.',
      default: [
        { key: 'individuel', label: 'Individuel' },
        { key: 'famille', label: 'Famille' },
      ],
      validate(value) {
        const keys = value.map((t) => t?.key);
        if (!value.length || keys.some((k) => typeof k !== 'string' || !/^[a-z][a-zA-Z0-9]*$/.test(k))) {
          fail('VALIDATION', 'Chaque type doit avoir une clé (lettres minuscules, sans espace) et un libellé.');
        }
        if (new Set(keys).size !== keys.length) fail('VALIDATION', 'Clés de type en double.');
      },
    },
  ],

  migrations: [
    {
      from: ['j1-store/0.2'],
      id: 'users-type-par-defaut',
      description: "[P] Les users créés avant les types reçoivent le premier type déclaré (individuel).",
      apply(draft, tx, socle) {
        const fallback = userTypesOf(socle, draft)[0]?.key ?? 'individuel';
        return Object.values(draft.users)
          .filter((u) => !u.userType)
          .map((u) => {
            u.userType = fallback;
            tx.updated.push({ kind: 'user', id: u.id });
            return `${u.id} : userType = ${fallback}`;
          });
      },
    },
  ],

  setup(socle) {
    const { om } = socle;

    function buildUser(tx, input) {
      const types = userTypesOf(socle, tx.draft);
      const userType = input.userType ?? types[0]?.key;
      if (!types.some((t) => t.key === userType)) {
        fail('VALIDATION', "Type d'utilisateur inconnu.", { field: 'userType', allowed: types.map((t) => t.key) });
      }
      return om.create(tx, 'user', {
        label: text('label', input.label, { required: true, max: 120 }),
        userType,
        fictitious: true,
      });
    }

    const summary = (state, u) => {
      const s = { ...structuredClone(u), userTypeLabel: userTypesOf(socle, state).find((t) => t.key === u.userType)?.label ?? u.userType };
      for (const ext of socle.registry.extensions('userSummary')) Object.assign(s, ext(state, u, socle));
      return s;
    };

    return {
      buildUser,

      /** Création d'un user ; la composition initiale (si un module la fournit) s'exécute dans la même écriture. */
      createUser(input) {
        return om.command(
          'createUser',
          null,
          input,
          (tx) => {
            const compose = socle.registry.composition('initialUserBundle');
            if (compose) return compose(tx, input ?? {}, socle);
            const user = buildUser(tx, input ?? {});
            return { userId: user.id };
          },
          { creation: true, anonymous: true },
        );
      },

      updateUser(ctx, id, input) {
        return om.command('updateUser', ctx, input, (tx) => {
          const u = om.owned(tx.draft, 'user', id, tx.userId);
          om.checkRevision(u, expectedRevisionOf(input));
          const patch = {};
          if ('label' in input) patch.label = text('label', input.label, { required: true, max: 120 });
          if ('userType' in input) {
            if (!userTypesOf(socle, tx.draft).some((t) => t.key === input.userType)) fail('VALIDATION', "Type d'utilisateur inconnu.", { field: 'userType' });
            patch.userType = input.userType;
          }
          om.update(tx, u, patch);
          return { userId: u.id };
        });
      },

      listUsers() {
        const state = socle.state;
        return om.list(state, 'user').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((u) => summary(state, u));
      },

      types: () => userTypesOf(socle, socle.state),
    };
  },

  routes(socle) {
    const s = socle.modules.users;
    return [
      ['GET', '/api/users', () => s.listUsers()],
      ['GET', '/api/users/types', () => s.types()],
      ['POST', '/api/users', ({ body }) => s.createUser(body)],
      ['PUT', '/api/users/:id', ({ ctx, params, body }) => s.updateUser(ctx, params.id, body)],
    ];
  },
};
