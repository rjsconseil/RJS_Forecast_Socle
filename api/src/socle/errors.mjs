// Erreurs contractuelles lisibles (contrat J1 §10). L'erreur identifie l'action
// et l'état réellement enregistré reste inchangé.
export const ERROR_HTTP = {
  VALIDATION: 400,
  // Corps de requête au-delà de la limite (SOCLE_BODY_LIMIT).
  PAYLOAD_TOO_LARGE: 413,
  // Corps d'écriture qui n'est pas du JSON (formulaire, text/plain : signe d'une requête venue d'un autre site).
  UNSUPPORTED_MEDIA_TYPE: 415,
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
  // Un cycle terminé attend sa clôture : le cycle suivant ne démarre (et ne reçoit d'entrée) qu'après elle.
  CYCLE_AWAITING_CLOSURE: 409,
  // Un cycle terminé est en clôture : la liste de ses points est figée (aucune nouvelle prévision n'y entre).
  CYCLE_IN_CLOSING: 409,
  // Parcours de clôture incomplet : chaque point doit être traité avant de clôturer.
  CLOSING_INCOMPLETE: 422,
  // Cohérence du cycle à rétablir (contrôle bloquant en échec) : rien ne se fige avant.
  CLOSING_INCOHERENT: 422,
  STORE_LOCKED: 409,
  PERSISTENCE_CONFLICT: 409,
  ALREADY_SETTLED: 409,
  // Dépassement du budget attribué à un projet : le budget de vie doit l'autoriser avant l'écriture.
  OVERRUN_AUTHORIZATION_REQUIRED: 422,
  // Principes d'architecture (socle/principles.mjs) : un contournement est une erreur de construction, pas d'usage.
  LAYER_VIOLATION: 500,
  WRITE_OUTSIDE_DOMAIN: 500,
  UNTRACKED_WRITE: 500,
  // Lecture d'état sans contexte explicite pendant une requête, ou avec le contexte d'un autre user.
  AMBIENT_STATE: 500,
  DATA_ENGINE_UNAVAILABLE: 503,
  // Authentification (socle/auth.mjs) : connexion requise, identifiants refusés, trop d'essais, droit manquant.
  AUTH_REQUIRED: 401,
  AUTH_INVALID: 401,
  AUTH_THROTTLED: 429,
  FORBIDDEN: 403,
  WRITE_OUTSIDE_PARTITION: 500,
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
