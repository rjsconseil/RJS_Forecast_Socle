// Object Management : politique d'identité, créations (simples ou composées), références,
// provenance, reçus de création et journal. Commun aux trois niveaux.
// Les règles métier restent dans les modules ; ce gestionnaire garantit identités et liens.
import { createHash, randomUUID } from 'node:crypto';
import { DomainError, fail } from '../errors.mjs';
import { baseOf, touchedIn } from '../data/data-manager.mjs';
import { objectsWith } from '../indexes.mjs';

const JOURNAL_LIMIT = 2000;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export const fingerprintOf = (payload) => createHash('sha256').update(canonical(payload)).digest('hex');

export class ObjectManager {
  constructor({ registry, store, faultInjection = false }) {
    this.registry = registry;
    this.store = store;
    this.faultInjection = faultInjection;
    this.recentErrors = []; // supervision : échecs non persistés (Administration)
  }

  // ---------- P2 · Écriture unique ----------

  /**
   * L'Object Management d'un module : mêmes lectures et commandes, mais `create` et `update`
   * n'acceptent que les natures dont ce module est propriétaire.
   */
  for(moduleId) {
    const owns = (kind, verb) => {
      const owner = this.registry.kind(kind).module;
      if (owner !== moduleId) {
        fail('WRITE_OUTSIDE_DOMAIN', `Écriture unique : ${moduleId} ne peut pas ${verb} un objet « ${kind} », propriété de ${owner}. Passer par une commande ou un constructeur de ${owner}.`, { principle: 'P2', module: moduleId, kind, owner });
      }
    };
    return new Proxy(this, {
      get(target, prop) {
        if (prop === 'module') return moduleId;
        if (prop === 'create') return (tx, kind, ...rest) => (owns(kind, 'créer'), target.create(tx, kind, ...rest));
        if (prop === 'update') return (tx, obj, ...rest) => (owns(obj.kind, 'modifier'), target.update(tx, obj, ...rest));
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  /** Contrôle de sortie : tout objet apparu a été créé par `om.create`, et aucun n'a disparu. */
  #auditDraft(draft, tx) {
    const before = baseOf(draft) ?? this.store.state;
    const created = new Set(tx.created.map((c) => c.id));
    for (const collection of this.registry.collections()) {
      if (!touchedIn(draft, collection)) continue; // jamais lue ni écrite : inchangée par construction
      const was = before[collection] ?? {};
      const now = draft[collection] ?? {};
      for (const id in now) if (!(id in was) && !created.has(id)) fail('UNTRACKED_WRITE', `Écriture unique : l'objet ${id} est apparu dans « ${collection} » sans passer par om.create.`, { principle: 'P2', collection, id, command: tx.command });
      for (const id in was) if (!(id in now)) fail('UNTRACKED_WRITE', `Écriture unique : l'objet ${id} a disparu de « ${collection} ».`, { principle: 'P2', collection, id, command: tx.command });
    }
  }

  // ---------- identité ----------

  newId(kind) {
    return `${this.registry.kind(kind).prefix}_${randomUUID()}`;
  }

  // ---------- lecture ----------

  get(state, kind, id) {
    if (typeof id !== 'string') return null;
    return state[this.registry.kind(kind).collection][id] ?? null;
  }

  /** Recherche par ID seul : la nature est déduite du préfixe de la politique d'identité. */
  find(state, id) {
    const kind = this.registry.kindOfId(id);
    return kind ? this.get(state, kind, id) : null;
  }

  /** Objet du périmètre : absent et appartenant à un autre user donnent la même réponse. */
  owned(state, kind, id, userId) {
    const obj = this.get(state, kind, id);
    if (!obj || obj.userId !== userId) fail('NOT_FOUND', 'Objet introuvable dans ce périmètre.', { id, kind });
    return obj;
  }

  list(state, kind, predicate = () => true) {
    return Object.values(state[this.registry.kind(kind).collection]).filter(predicate);
  }

  /**
   * Objets d'une nature dont `field` vaut `value`, par un index mémorisé sur la vue publiée de la partition (refait
   * seulement quand la partition change) ; sur un brouillon de transaction, simple parcours.
   */
  by(state, kind, field, value) {
    return objectsWith(state[this.registry.kind(kind).collection] ?? {}, field, value);
  }

  requireUser(state, ctx) {
    const userId = ctx?.userId;
    if (!userId) fail('CONTEXT_REQUIRED', 'Contexte absent : choisir un user.');
    if (!this.get(state, 'user', userId)) fail('CONTEXT_REQUIRED', 'User inconnu dans ce contexte.', { userId });
    return userId;
  }

  // ---------- références (J1-OM-06) ----------

  /**
   * Valide une référence : objet existant, d'une nature attendue, du même user.
   * `kinds` peut lister plusieurs natures admises. `null` est accepté si `nullable`.
   */
  reference(state, { field, id, kinds, userId, nullable = true }) {
    if (id === null || id === undefined || id === '') {
      if (nullable) return null;
      fail('VALIDATION', `La référence ${field} est obligatoire.`, { field });
    }
    if (typeof id !== 'string') fail('VALIDATION', `Référence ${field} invalide.`, { field });
    const kind = this.registry.kindOfId(id);
    const target = kind ? this.get(state, kind, id) : null;
    if (!target) fail('REFERENCE_NOT_FOUND', `L'objet référencé par ${field} n'existe pas.`, { field, id });
    const allowed = [].concat(kinds);
    if (!allowed.includes(kind)) fail('INCOMPATIBLE_REFERENCE', `${field} doit désigner : ${allowed.join(' ou ')}.`, { field, id, kind });
    if (userId !== undefined && target.userId !== userId) {
      fail('INCOMPATIBLE_REFERENCE', `Rattachement refusé entre deux users différents (${field}).`, { field, id });
    }
    return id;
  }

  // ---------- écriture dans une transaction ----------

  /**
   * Crée un objet dans la transaction : ID par la politique centrale, méta et provenance,
   * contrôle des références déclarées par le module propriétaire de la nature.
   */
  create(tx, kind, fields, { userId = tx.userId } = {}) {
    const def = this.registry.kind(kind);
    const id = this.newId(kind);
    const at = tx.now;
    const obj = {
      id,
      kind,
      userId: kind === 'user' ? id : userId,
      revision: 1,
      createdAt: at,
      updatedAt: at,
      provenance: { command: tx.command, requestKey: tx.requestKey ?? null, at },
      ...fields,
    };
    this.#checkDeclaredReferences(tx.draft, def, obj);
    tx.draft[def.collection][id] = obj;
    tx.created.push({ kind, id });
    return obj;
  }

  /** Modification : l'ID est conservé, la révision avance, la provenance garde la dernière commande. */
  update(tx, obj, patch) {
    const def = this.registry.kind(obj.kind);
    Object.assign(obj, patch);
    this.#checkDeclaredReferences(tx.draft, def, obj);
    obj.revision += 1;
    obj.updatedAt = tx.now;
    obj.lastChange = { command: tx.command, at: tx.now };
    tx.updated.push({ kind: obj.kind, id: obj.id });
    return obj;
  }

  checkRevision(obj, expected) {
    if (obj.revision !== expected) {
      fail('STALE_VERSION', 'Une version plus récente a été enregistrée entre-temps.', {
        id: obj.id,
        expectedRevision: expected,
        currentRevision: obj.revision,
        current: structuredClone(obj),
      });
    }
  }

  #checkDeclaredReferences(state, def, obj) {
    for (const [field, ref] of Object.entries(def.references ?? {})) {
      const value = obj[field];
      if (value === null || value === undefined) {
        if (ref.required) fail('VALIDATION', `La référence ${field} est obligatoire pour ${def.label}.`, { field });
        continue;
      }
      this.reference(state, { field, id: value, kinds: ref.kind, userId: ref.crossUser ? undefined : obj.userId, nullable: false });
    }
  }

  // ---------- simulation ----------

  /**
   * Exécute `fn(tx)` sur une copie de l'état : mêmes constructeurs et mêmes refus qu'une commande,
   * sans écriture, journal ni clé de demande. Renvoie l'état simulé pour le lire avec les mêmes métriques.
   */
  simulate(action, ctx, input, fn) {
    const draft = structuredClone(this.store.state);
    const tx = { draft, command: action, now: new Date().toISOString(), created: [], updated: [], unchanged: false, input };
    tx.userId = this.requireUser(draft, ctx);
    return { draft, result: fn(tx) };
  }

  // ---------- commandes ----------

  /**
   * Exécute une commande en une seule écriture atomique.
   * - `creation: true` : clé de demande requise ; même clé + mêmes entrées = même résultat (J1-OM-03).
   * - `anonymous: true` : pas de user de contexte (création d'un user).
   * `fn(tx)` renvoie le résultat ; `tx.unchanged = true` évite une écriture inutile.
   */
  async command(action, ctx, input, fn, { creation = false, anonymous = false } = {}) {
    try {
      // Une clé de demande est unique pour tout le site : son reçu se cherche dans la base, quelle que soit la partition.
      const key = creation ? input?.requestKey : undefined;
      const stored = typeof key === 'string' && key.length >= 8 && key.length <= 200 ? await this.store.receipt(key) : null;
      return await this.store.mutate(
        (draft) => {
          const tx = { draft, command: action, now: new Date().toISOString(), created: [], updated: [], unchanged: false, input };
          tx.userId = anonymous ? null : this.requireUser(draft, ctx);
          let fingerprint;
          if (creation) {
            const key = input?.requestKey;
            if (typeof key !== 'string' || key.length < 8 || key.length > 200) {
              fail('VALIDATION', 'Une clé de demande stable (requestKey) est requise pour toute création.', { field: 'requestKey' });
            }
            tx.requestKey = key;
            const { requestKey, _fault, ...payload } = input;
            fingerprint = fingerprintOf({ command: action, userId: tx.userId, payload });
            const existing = draft.creationRequests[key] ?? stored;
            if (existing) {
              if (existing.command === action && existing.fingerprint === fingerprint) {
                return { unchanged: true, value: { ...existing.result, replayed: true } };
              }
              fail('IDEMPOTENCY_CONFLICT', 'Cette clé de demande a déjà servi pour un autre contenu.', { requestKey: key, command: existing.command });
            }
          }
          const result = fn(tx);
          if (tx.unchanged) return { unchanged: true, value: { ...result, written: false } };
          this.#auditDraft(draft, tx);
          if (creation) {
            draft.creationRequests[tx.requestKey] = {
              requestKey: tx.requestKey,
              command: action,
              userId: result?.userId ?? tx.userId,
              fingerprint,
              status: 'completed',
              createdObjects: tx.created,
              result,
              completedAt: tx.now,
            };
          }
          draft.journal.push({
            at: tx.now,
            command: action,
            userId: result?.userId ?? tx.userId,
            requestKey: tx.requestKey ?? null,
            created: tx.created.map((c) => c.id),
            updated: [...new Set(tx.updated.map((u) => u.id))],
            outcome: 'committed',
          });
          if (draft.journal.length > JOURNAL_LIMIT) draft.journal.splice(0, draft.journal.length - JOURNAL_LIMIT);
          return { value: creation ? { ...result, replayed: false } : { ...result, written: true } };
        },
        { partition: anonymous ? null : ctx?.userId ?? null, beforeCommit: this.#faultHook(input) },
      );
    } catch (err) {
      if (err instanceof DomainError) {
        err.action ??= action;
        this.recentErrors.unshift({ at: new Date().toISOString(), command: action, userId: ctx?.userId ?? null, code: err.code, message: err.message });
        this.recentErrors.length = Math.min(this.recentErrors.length, 100);
      }
      throw err;
    }
  }

  #faultHook(input) {
    const fault = input?._fault;
    if (!fault) return undefined;
    if (!this.faultInjection) fail('VALIDATION', "L'injection d'interruption n'est pas activée.");
    return () => {
      throw new DomainError('INJECTED_INTERRUPTION', `Interruption injectée (${fault}) avant l'enregistrement.`, { fault });
    };
  }
}
