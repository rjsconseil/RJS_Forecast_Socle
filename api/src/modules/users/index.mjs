// Gestion des utilisateurs (transverse). Un user porte un type (individuel, famille…) qui
// conditionne notamment les centres de coût standards du Budget. Sa création déclenche la
// composition initiale enregistrée par le niveau applicatif (BPM) : tout ou rien.
import { fail } from '../../socle/errors.mjs';
import { expectedRevisionOf, text } from '../../socle/validation.mjs';
import { hashPassword, normalizeLogin, verifyDecoy, verifyPassword } from '../../socle/auth.mjs';

const userTypesOf = (socle, state) => socle.parameters.value(state, 'users.types');

export default {
  id: 'users',
  label: 'Gestion des utilisateurs',
  level: 0,
  dependsOn: [],
  kinds: {
    user: { collection: 'users', prefix: 'usr', label: 'User' },
    // Identifiants de connexion : adresse e-mail (unique sur tout le site) et empreinte du mot de passe, jamais lus par
    // les autres modules ; rangés dans la partition de leur user.
    credential: { collection: 'credentials', prefix: 'crd', label: 'Identifiants de connexion', references: { userId: { kind: 'user', required: true } } },
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

      /**
       * Création d'un user ; la composition initiale (si un module la fournit : le projet de vie BPM) s'exécute
       * dans la même écriture. Le projet de vie naît donc une seule fois, avec son user, et ne disparaît qu'avec lui.
       * Commande anonyme : aujourd'hui seul un visiteur crée son propre user. Point d'extension prévu (non codé) :
       * un user connecté « parent » passera son contexte ici pour devenir le maître du user créé.
       */
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

      // ---------- comptes et connexion ----------

      /** Les identifiants d'un user (dans sa partition), sans leur empreinte. */
      accountOf(userId) {
        const c = om.list(socle.store.viewOf(userId), 'credential', (x) => x.userId === userId)[0];
        return c ? { email: c.login, role: c.role ?? 'member', sessionsFrom: c.sessionsFrom ?? 0 } : null;
      },

      /**
       * Inscription : le user, sa composition initiale et ses identifiants, en une seule écriture. L'adresse e-mail est
       * unique sur tout le site (vérifiée avant l'écriture ; la base la garantit aussi par un index unique).
       */
      async register(input = {}) {
        const login = normalizeLogin(input.email);
        const auth = hashPassword(input.password);
        if ((await socle.store.findBy('credentials', 'login', login, { unique: true })).length) fail('UNIQUENESS_VIOLATION', 'Un compte existe déjà avec cette adresse e-mail.', { field: 'email' });
        const { email, password, ...rest } = input;
        return om.command('register', null, { ...rest, email: login }, (tx) => {
          const compose = socle.registry.composition('initialUserBundle');
          const result = compose ? compose(tx, rest, socle) : { userId: buildUser(tx, rest).id };
          om.create(tx, 'credential', { login, auth, role: 'member', sessionsFrom: 0 }, { userId: result.userId });
          return result;
        }, { creation: true, anonymous: true });
      },

      /** Donne (ou change) l'adresse et le mot de passe d'un user existant ; le mot de passe actuel est exigé s'il y en a un. */
      async setCredentials(ctx, input = {}) {
        const login = normalizeLogin(input.email);
        const auth = hashPassword(input.password);
        const taken = await socle.store.findBy('credentials', 'login', login, { unique: true });
        if (taken.some((c) => c.userId !== ctx?.userId)) fail('UNIQUENESS_VIOLATION', 'Un compte existe déjà avec cette adresse e-mail.', { field: 'email' });
        return om.command('setCredentials', ctx, { email: login }, (tx) => {
          const current = om.list(tx.draft, 'credential', (c) => c.userId === tx.userId)[0];
          if (current) {
            if (!verifyPassword(input.currentPassword, current.auth)) fail('AUTH_INVALID', 'Mot de passe actuel incorrect.', { field: 'currentPassword' });
            om.update(tx, current, { login, auth, sessionsFrom: Date.now() });
          } else om.create(tx, 'credential', { login, auth, role: 'member', sessionsFrom: 0 }, { userId: tx.userId });
          return { userId: tx.userId, email: login };
        });
      },

      /** Vérifie une adresse et un mot de passe ; rend le user, ou un refus identique quelle que soit l'erreur. */
      async authenticate(email, password) {
        let login;
        try { login = normalizeLogin(email); } catch { verifyDecoy(password); fail('AUTH_INVALID', 'Adresse e-mail ou mot de passe incorrect.'); }
        const [c] = await socle.store.findBy('credentials', 'login', login, { unique: true });
        if (!c) { verifyDecoy(password); fail('AUTH_INVALID', 'Adresse e-mail ou mot de passe incorrect.'); }
        if (!verifyPassword(String(password ?? ''), c.auth)) fail('AUTH_INVALID', 'Adresse e-mail ou mot de passe incorrect.');
        return { userId: c.userId, role: c.role ?? 'member' };
      },

      /** Se déconnecter partout : tout jeton émis avant maintenant est refusé. */
      revokeSessions(ctx) {
        return om.command('revokeSessions', ctx, {}, (tx) => {
          const c = om.list(tx.draft, 'credential', (x) => x.userId === tx.userId)[0];
          if (!c) fail('NOT_FOUND', 'Ce profil n’a pas de compte de connexion.');
          om.update(tx, c, { sessionsFrom: Date.now() });
          return { userId: tx.userId };
        });
      },

      /** Le résumé d'un user (type, extensions), lu dans la vue de sa partition. */
      userSummary(userId) {
        const state = socle.store.viewOf(userId);
        const user = state.users[userId];
        return user ? summary(state, user) : null;
      },

      /** L'annuaire : chaque user résumé dans la vue de sa propre partition (aucune vue complète). */
      async listUsers() {
        const users = [...(await socle.store.directory())].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const out = [];
        // Chaque user dans sa propre partition, chargée et revalidée (moteurs asynchrones compris).
        for (const u of users) out.push(await socle.store.within(u.id, () => summary(socle.store.viewOf(u.id), u)));
        return out;
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
