// Donne (ou retire) le rôle d'administration à un compte, par son adresse e-mail : seul un administrateur ouvre
// l'administration quand la connexion est exigée (SOCLE_AUTH=required). Outil d'exploitation, hors du site.
//   node api/scripts/make-admin.mjs <email> [--retirer]
import { resolve } from 'node:path';
import { createSocle } from '../src/socle/index.mjs';
import { SOCLE_MODULES } from '../src/modules/index.mjs';
import { normalizeLogin } from '../src/socle/auth.mjs';

const [email, flag] = process.argv.slice(2);
const dataFile = resolve(process.env.J1_DATA_FILE ?? new URL('../data/store.sqlite', import.meta.url).pathname);
const socle = await createSocle({ dataFile, modules: SOCLE_MODULES });
try {
  const login = normalizeLogin(email);
  const [c] = await socle.store.findBy('credentials', 'login', login, { unique: true });
  if (!c) throw new Error(`Aucun compte pour ${login}.`);
  const role = flag === '--retirer' ? 'member' : 'admin';
  await socle.store.mutate((draft) => {
    const current = draft.credentials[c.id];
    current.role = role;
    current.revision += 1;
    current.updatedAt = new Date().toISOString();
    current.lastChange = { command: 'make-admin', at: current.updatedAt };
    return { value: null };
  });
  console.log(`${login} : rôle ${role}.`);
} finally {
  await socle.close();
}
