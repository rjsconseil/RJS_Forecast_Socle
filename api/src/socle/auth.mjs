// Authentification — outils techniques du socle, sans règle métier : mots de passe hachés (scrypt salé, comparaison en
// temps constant), jetons de session signés (HMAC-SHA256, vérifiés sans lire la base : plusieurs serveurs partagent le
// même secret), limitation des essais de connexion. Les comptes eux-mêmes sont des objets du module users.
//
// Modes (SOCLE_AUTH) :
// - `local` (défaut, poste de travail) : le user vient du jeton s'il y en a un, sinon de l'en-tête `x-user-id`
//   (choix du profil sur le poste, comme avant) ;
// - `required` (site en ligne) : seul un jeton valide donne un user ; l'en-tête est ignoré.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fail } from './errors.mjs';

export const AUTH_MODES = ['local', 'required'];
export const SESSION_COOKIE = 'rjs_session';
/** Longueur minimale d'un mot de passe [P]. */
export const PASSWORD_MIN = 10;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const b64 = (buf) => Buffer.from(buf).toString('base64url');

/** Identifiant de connexion : une adresse e-mail, en minuscules. */
export function normalizeLogin(value) {
  const login = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login) || login.length > 200) fail('VALIDATION', 'Adresse e-mail invalide.', { field: 'email' });
  return login;
}

export function checkPassword(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > 200) {
    fail('VALIDATION', `Le mot de passe doit compter au moins ${PASSWORD_MIN} caractères.`, { field: 'password' });
  }
  return password;
}

/** Empreinte d'un mot de passe : scrypt salé ; seul ce résultat est enregistré. */
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(checkPassword(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return { algo: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: b64(salt), hash: b64(hash) };
}

/** Vrai si le mot de passe correspond à l'empreinte (comparaison en temps constant). */
export function verifyPassword(password, record) {
  if (typeof password !== 'string' || !record?.hash) return false;
  const expected = Buffer.from(record.hash, 'base64url');
  const actual = scryptSync(password, Buffer.from(record.salt, 'base64url'), expected.length, { N: record.N, r: record.r, p: record.p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Empreinte factice : un identifiant inconnu coûte le même temps qu'un mot de passe faux. */
const DECOY = hashPassword('leurre-de-comparaison');
export const verifyDecoy = (password) => { verifyPassword(String(password ?? ''), DECOY); return false; };

/**
 * Secret de signature des jetons : `SOCLE_AUTH_SECRET` (obligatoire dès que plusieurs serveurs tournent), sinon un
 * secret tiré au hasard et gardé à côté de la base (`<base>.auth-secret`, lisible du seul propriétaire).
 */
export function authSecret(dataFile) {
  if (process.env.SOCLE_AUTH_SECRET) return process.env.SOCLE_AUTH_SECRET;
  const file = `${dataFile.replace(/\.(json|sqlite)$/, '')}.auth-secret`;
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(dirname(file), { recursive: true });
  const secret = b64(randomBytes(32));
  writeFileSync(file, secret + '\n', { mode: 0o600 });
  return secret;
}

/** Jetons de session : `<charge>.<signature>`, la charge portant le user, l'émission et l'expiration. */
export function createSessions({ secret, ttlHours = Number(process.env.SOCLE_SESSION_HOURS) || 24 * 14 }) {
  const sign = (payload) => b64(createHmac('sha256', secret).update(payload).digest());
  return {
    ttlSeconds: ttlHours * 3600,
    issue(userId, now = Date.now()) {
      const payload = b64(JSON.stringify({ u: userId, iat: now, exp: now + ttlHours * 3600 * 1000 }));
      return `${payload}.${sign(payload)}`;
    },
    /** `{ userId, issuedAt }` pour un jeton intègre et non expiré ; sinon `null`. */
    verify(token, now = Date.now()) {
      if (typeof token !== 'string') return null;
      const [payload, signature] = token.split('.');
      if (!payload || !signature) return null;
      const expected = Buffer.from(sign(payload));
      const given = Buffer.from(signature);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      try {
        const { u, iat, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return typeof u === 'string' && exp > now ? { userId: u, issuedAt: iat } : null;
      } catch {
        return null;
      }
    },
  };
}

/** Limitation des essais de connexion : au plus `max` échecs par clé (identifiant, adresse) sur une fenêtre glissante. */
export function createThrottle({ max = 8, windowMs = 15 * 60 * 1000 } = {}) {
  const failures = new Map();
  const recent = (key, now) => (failures.get(key) ?? []).filter((t) => now - t < windowMs);
  return {
    check(keys, now = Date.now()) {
      for (const key of keys) {
        if (recent(key, now).length >= max) fail('AUTH_THROTTLED', 'Trop d’essais de connexion : réessayez dans quelques minutes.', { retryAfterSeconds: Math.ceil(windowMs / 1000) });
      }
    },
    failed(keys, now = Date.now()) { for (const key of keys) failures.set(key, [...recent(key, now), now]); },
    succeeded(keys) { for (const key of keys) failures.delete(key); },
  };
}

/** Lit un cookie d'un en-tête `Cookie`. */
export function cookieOf(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
