// P5 · Données gérées — couche de STOCKAGE, moteur « sgbd » (PostgreSQL) : DÉCLARÉ, PAS ENCORE CODÉ.
// Il prendra le relais de SQLite le jour où le site sera hébergé pour plusieurs personnes à la fois. Le contrat est celui de tout moteur ; le jour venu,
// seules ces méthodes sont à écrire (PostgreSQL) : la couche de gestion, les modules et les
// commandes ne changent pas. Un schéma du catalogue devient un schéma SQL, une collection une table.
import { DomainError } from '../../errors.mjs';

export class SgbdEngine {
  static id = 'sgbd';
  static label = 'PostgreSQL (serveur de base de données) — à coder';
  static coded = false;

  constructor(options) {
    this.options = options;
  }

  #unavailable() {
    throw new DomainError('DATA_ENGINE_UNAVAILABLE', 'Le moteur de stockage « sgbd » est prévu mais pas encore codé. Choisir « sqlite » (SOCLE_DATA_ENGINE).', {
      principle: 'P5', engine: SgbdEngine.id, contract: ['open()', 'read() → état logique | null', 'assertUnchanged()', 'write(état, catalogue)', 'close()', 'describe()'],
    });
  }
  async open() { this.#unavailable(); }
  async read() { this.#unavailable(); }
  async assertUnchanged() { this.#unavailable(); }
  async write() { this.#unavailable(); }
  async close() {}
  describe() { return { id: SgbdEngine.id, label: SgbdEngine.label, coded: false, files: {} }; }
}
