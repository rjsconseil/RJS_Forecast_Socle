// Erreurs contractuelles lisibles (contrat J1 §10). L'erreur identifie l'action
// et l'état réellement enregistré reste inchangé.
export const ERROR_HTTP = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  CONTEXT_REQUIRED: 401,
  REFERENCE_NOT_FOUND: 422,
  INCOMPATIBLE_REFERENCE: 422,
  IDEMPOTENCY_CONFLICT: 409,
  UNIQUENESS_VIOLATION: 409,
  STALE_VERSION: 409,
  PERSISTENCE_UNAVAILABLE: 503,
  INJECTED_INTERRUPTION: 503,
  FORBIDDEN_BY_RULE: 422,
  FORMULA_INVALID: 400,
  PERIOD_CLOSED: 409,
  FUTURE_REALIZATION: 422,
  CLOSING_PREVIEW_STALE: 409,
  STORE_LOCKED: 409,
  PERSISTENCE_CONFLICT: 409,
  ALREADY_SETTLED: 409,
};

export class DomainError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.action = null;
  }
  toJSON() {
    return { code: this.code, action: this.action, message: this.message, details: this.details };
  }
}

export const fail = (code, message, details) => {
  throw new DomainError(code, message, details);
};
