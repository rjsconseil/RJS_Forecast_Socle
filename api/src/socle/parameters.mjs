// Paramètres effectifs du socle, administrés par le module Administration.
// Chaque module déclare ses paramètres (défaut, type, portée) ; une valeur administrée garde
// révision et historique. Les invariants (unicité du triplet, références) ne sont jamais des paramètres.
import { fail } from './errors.mjs';
import { parseFormula } from './calc/formula.mjs';

export class Parameters {
  constructor(socle) {
    this.socle = socle;
    this.defs = new Map();
  }

  register(def) {
    if (this.defs.has(def.key)) throw new Error(`Paramètre déjà déclaré : ${def.key}`);
    this.defs.set(def.key, { scope: 'global', group: 'Général', ...def });
  }

  definition(key) {
    const def = this.defs.get(key);
    if (!def) fail('NOT_FOUND', 'Paramètre inconnu.', { key });
    return def;
  }

  effective(state, key) {
    const def = this.definition(key);
    const stored = state.parameters[key];
    return {
      key,
      label: def.label,
      description: def.description ?? null,
      module: def.module,
      group: def.group,
      type: def.type,
      scope: def.scope,
      unit: def.unit ?? null,
      value: stored && !stored.isDefault ? stored.value : def.default,
      defaultValue: def.default,
      origin: stored && !stored.isDefault ? 'administration' : 'défaut du code',
      revision: stored?.revision ?? 0,
      updatedAt: stored?.updatedAt ?? null,
      history: stored?.history ?? [],
    };
  }

  value(state, key) {
    return this.effective(state, key).value;
  }

  effectiveList(state) {
    return [...this.defs.keys()].map((k) => this.effective(state, k));
  }

  /** Valide une valeur selon le type déclaré et, le cas échéant, la règle propre au module. */
  validate(state, key, value) {
    const def = this.definition(key);
    switch (def.type) {
      case 'formula':
        if (typeof value !== 'string') fail('VALIDATION', 'Une formule est attendue.', { key });
        parseFormula(value);
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) fail('VALIDATION', 'Un nombre est attendu.', { key });
        break;
      case 'integer':
        if (!Number.isInteger(value)) fail('VALIDATION', 'Un entier est attendu.', { key });
        break;
      case 'text':
        if (typeof value !== 'string' || !value.trim()) fail('VALIDATION', 'Un texte non vide est attendu.', { key });
        break;
      case 'list':
        if (!Array.isArray(value)) fail('VALIDATION', 'Une liste est attendue.', { key });
        break;
      case 'boolean':
        if (typeof value !== 'boolean') fail('VALIDATION', 'Vrai ou faux est attendu.', { key });
        break;
    }
    if (def.min !== undefined && value < def.min) fail('VALIDATION', `Valeur minimale : ${def.min}.`, { key });
    if (def.max !== undefined && value > def.max) fail('VALIDATION', `Valeur maximale : ${def.max}.`, { key });
    def.validate?.(value, state, this.socle);
  }

  /** Écrit une valeur administrée (dans une transaction Object Management). */
  write(tx, key, value, { expectedRevision, note, isDefault = false }) {
    const current = this.effective(tx.draft, key);
    if (current.revision !== expectedRevision) {
      fail('STALE_VERSION', 'Ce paramètre a été modifié entre-temps.', { key, expectedRevision, currentRevision: current.revision, current });
    }
    this.validate(tx.draft, key, value);
    const revision = current.revision + 1;
    const entry = { revision, value, at: tx.now, note: note ?? null, previous: current.value };
    tx.draft.parameters[key] = {
      key,
      value,
      isDefault,
      revision,
      updatedAt: tx.now,
      history: [...current.history, entry].slice(-50),
    };
    tx.updated.push({ kind: 'parameter', id: key });
    return this.effective(tx.draft, key);
  }

  /** Revient au défaut du code, en conservant l'historique et une révision croissante. */
  reset(tx, key, { expectedRevision }) {
    const current = this.effective(tx.draft, key);
    if (current.revision !== expectedRevision) fail('STALE_VERSION', 'Ce paramètre a été modifié entre-temps.', { key, current });
    if (current.origin !== 'administration') {
      tx.unchanged = true;
      return current;
    }
    return this.write(tx, key, current.defaultValue, { expectedRevision, note: 'Retour au défaut du code', isDefault: true });
  }
}
