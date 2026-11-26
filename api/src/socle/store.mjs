// Compatibilité : la persistance est désormais le système de gestion des données (P5 · Données gérées).
// Couche de gestion : `data/data-manager.mjs` ; couche de stockage : `data/engines/*`.
export { DataManager, DATA_ENGINES, DEFAULT_DATA_ENGINE, STORE_SCHEMA, LEGACY_SCHEMAS, emptyState, deepFreeze, readStoredState, snapshotStore, removeStore } from './data/data-manager.mjs';
