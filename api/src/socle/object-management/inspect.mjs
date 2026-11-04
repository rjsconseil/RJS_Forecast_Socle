// Object Management en lecture seule : inventaire, inspection, relations, contrôles et exports.
// Toutes les vues partent d'un même instantané ; aucune lecture ne modifie ni ne répare.
// Les modules contribuent leurs vues (`debug.views`), leurs CSV (`debug.csv`) et leurs contrôles (`checks`).
import { createHash } from 'node:crypto';
import { LEVELS } from '../registry.mjs';

export const DEBUG_SCHEMA = 'socle-debug/0.3';

const inScope = (obj, scope) => !scope || scope === 'all' || obj.userId === scope;

export function snapshotIdOf(state) {
  const digest = createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 12);
  return `snap-r${state.revision}-${digest}`;
}

export class Inspector {
  constructor(socle) {
    this.socle = socle;
    this.registry = socle.registry;
  }

  allObjects(state) {
    return this.registry.collections().flatMap((c) => Object.values(state[c] ?? {}));
  }

  /** Relations réellement enregistrées (références déclarées) et relations dérivées par les modules. */
  relations(state) {
    const byId = new Map(this.allObjects(state).map((o) => [o.id, o]));
    const rels = [];
    for (const o of byId.values()) {
      const def = this.registry.kind(o.kind);
      for (const field of Object.keys(def.references ?? {})) {
        const targetId = o[field];
        if (!targetId) continue;
        rels.push({ sourceId: o.id, sourceKind: o.kind, relation: field, targetId, targetKind: byId.get(targetId)?.kind ?? 'absent', userId: o.userId, derived: false });
      }
    }
    for (const m of this.registry.modules.values()) {
      for (const r of m.debug?.derivedRelations?.(state, this.socle) ?? []) {
        rels.push({ ...r, targetKind: byId.get(r.targetId)?.kind ?? 'absent', derived: true });
      }
    }
    return rels;
  }

  checks(state) {
    const checks = [];
    const objects = this.allObjects(state);
    const seen = new Set();
    const dupes = [];
    for (const o of objects) {
      if (seen.has(o.id)) dupes.push(o.id);
      seen.add(o.id);
    }
    checks.push(check('OM-ID-01', 'integrity', 'object-management', 'IDs uniques sur tous les objets', '0 doublon', `${dupes.length} doublon(s) sur ${objects.length} objets`, dupes.length ? 'failed' : 'passed', dupes));

    // Références déclarées : les IDs affectés (`ids`) restent séparés des messages (`anomalies`).
    const refAnomalies = [];
    const byId = new Map(objects.map((o) => [o.id, o]));
    for (const o of objects) {
      const def = this.registry.kind(o.kind);
      for (const [field, ref] of Object.entries(def.references ?? {})) {
        const targetId = o[field];
        const kinds = [].concat(ref.kind);
        const add = (problem, message) => refAnomalies.push({ id: o.id, kind: o.kind, field, targetId: targetId ?? null, problem, message });
        if (!targetId) {
          if (ref.required) add('missing-required', `${def.label} : référence obligatoire ${field} absente.`);
          continue;
        }
        const t = byId.get(targetId);
        if (!t) add('target-absent', `${field} désigne ${targetId}, introuvable.`);
        else if (!kinds.includes(t.kind)) add('incompatible-kind', `${field} désigne un objet de nature ${t.kind} ; attendu : ${kinds.join(' ou ')}.`);
        else if (!ref.crossUser && t.userId !== o.userId) add('other-user', `${field} désigne un objet d'un autre user (${t.userId}).`);
      }
    }
    checks.push({
      ...check('OM-REF-01', 'integrity', 'object-management', 'Chaque référence déclarée pointe vers un objet existant, compatible et du même user ; les références obligatoires sont présentes', '0 référence invalide', `${refAnomalies.length} référence(s) invalide(s)`, refAnomalies.length ? 'failed' : 'passed', [...new Set(refAnomalies.map((a) => a.id))]),
      anomalies: refAnomalies,
    });

    const reqAnomalies = [];
    for (const r of Object.values(state.creationRequests)) {
      for (const c of r.createdObjects) {
        if (!byId.has(c.id)) reqAnomalies.push({ id: c.id, kind: c.kind, requestKey: r.requestKey, problem: 'created-object-missing', message: `La demande ${r.requestKey} (${r.command}) a créé ${c.id}, introuvable.` });
      }
    }
    const reqIds = [...new Set(reqAnomalies.flatMap((a) => Object.values(state.creationRequests[a.requestKey].createdObjects).map((c) => c.id).filter((id) => byId.has(id))))];
    checks.push({
      ...check('OM-REQ-01', 'integrity', 'object-management', 'Chaque demande de création terminée retrouve ses objets', '0 objet manquant', `${Object.keys(state.creationRequests).length} demande(s), ${reqAnomalies.length} objet(s) manquant(s)`, reqAnomalies.length ? 'failed' : 'passed', reqIds),
      anomalies: reqAnomalies,
    });

    for (const m of this.registry.modules.values()) {
      for (const c of m.checks?.(state, this.socle) ?? []) checks.push({ module: m.id, execution: c.result === 'not-run' ? 'not-run' : 'executed', ids: [], anomalies: [], ...c });
    }
    return checks;
  }

  inventory(state, { q, kind, scope } = {}) {
    const checks = this.checks(state);
    const touched = (c) => [...c.ids, ...(c.anomalies ?? []).map((a) => a.id)];
    const failing = new Set(checks.filter((c) => c.result === 'failed').flatMap(touched));
    const warning = new Set(checks.filter((c) => c.result === 'warning').flatMap(touched));
    const anomaliesOf = new Map();
    for (const c of checks) for (const a of c.anomalies ?? []) anomaliesOf.set(a.id, [...(anomaliesOf.get(a.id) ?? []), `${c.rule} : ${a.message}`]);
    const needle = q?.toLowerCase();
    return this.allObjects(state)
      .filter((o) => inScope(o, scope))
      .filter((o) => !kind || o.kind === kind)
      .filter((o) => !needle || o.id.toLowerCase().includes(needle) || labelOf(o).toLowerCase().includes(needle))
      .map((o) => {
        const def = this.registry.kind(o.kind);
        return {
          id: o.id,
          kind: o.kind,
          kindLabel: def.label,
          label: labelOf(o) || null,
          level: def.level,
          levelLabel: LEVELS[def.level],
          module: def.module,
          domain: def.domain,
          userId: o.userId,
          revision: o.revision,
          source: o.provenance?.command ?? null,
          control: failing.has(o.id) ? 'failed' : warning.has(o.id) ? 'warning' : 'passed',
          anomalies: anomaliesOf.get(o.id) ?? [],
        };
      });
  }

  inspectObject(state, id) {
    const obj = this.socle.om.find(state, id);
    if (!obj) return null;
    const def = this.registry.kind(obj.kind);
    const rels = this.relations(state);
    const request = Object.values(state.creationRequests).find((r) => r.createdObjects.some((c) => c.id === id));
    const extra = {};
    for (const m of this.registry.modules.values()) Object.assign(extra, m.debug?.inspect?.(state, obj, this.socle) ?? {});
    return {
      object: obj,
      nature: { kind: obj.kind, label: def.label, module: def.module, domain: def.domain, level: def.level, levelLabel: LEVELS[def.level] },
      outgoing: rels.filter((r) => r.sourceId === id),
      incoming: rels.filter((r) => r.targetId === id),
      creationRequest: request ? { requestKey: request.requestKey, command: request.command, completedAt: request.completedAt, createdObjects: request.createdObjects } : null,
      journal: state.journal.filter((e) => e.created.includes(id) || e.updated.includes(id)),
      diagnostic: this.diagnosticOf(state, id),
      ...extra,
    };
  }

  /** Diagnostic d'un objet : contrôles qui le concernent et anomalies décrites pour lui. */
  diagnosticOf(state, id, checks = this.checks(state)) {
    const concerned = checks.filter((c) => c.ids.includes(id) || (c.anomalies ?? []).some((a) => a.id === id));
    const results = concerned.map((c) => c.result);
    return {
      control: results.includes('failed') ? 'failed' : results.includes('warning') ? 'warning' : concerned.length ? 'passed' : 'not-checked',
      checks: concerned.map((c) => ({ rule: c.rule, module: c.module, result: c.result, description: c.description, anomalies: (c.anomalies ?? []).filter((a) => a.id === id) })),
    };
  }

  exportDebug(state, scope = 'all', { generatedAt = new Date().toISOString() } = {}) {
    const objects = {};
    for (const def of this.registry.kinds.values()) objects[def.collection] = Object.values(state[def.collection]).filter((o) => inScope(o, scope));
    const views = {};
    for (const m of this.registry.modules.values()) Object.assign(views, m.debug?.views?.(state, scope, this.socle) ?? {});
    return {
      schemaVersion: DEBUG_SCHEMA,
      mode: 'executed-from-persistence',
      snapshotId: snapshotIdOf(state),
      storeRevision: state.revision,
      storeUpdatedAt: state.updatedAt,
      generatedAt,
      scope,
      modules: this.registry.describe(),
      objects,
      views,
      relations: this.relations(state).filter((r) => inScope(r, scope)),
      parameters: this.socle.parameters.effectiveList(state),
      creationReceipts: Object.values(state.creationRequests).filter((r) => inScope(r, scope)),
      journal: state.journal.filter((e) => inScope(e, scope)).slice(-200),
      checks: this.checks(state),
      review: { decision: 'pending', reviewer: null },
    };
  }

  csvFiles() {
    const files = { 'objets.csv': null, 'relations.csv': null };
    for (const m of this.registry.modules.values()) for (const name of Object.keys(m.debug?.csv ?? {})) files[name] = m.id;
    return Object.keys(files);
  }

  /** Un CSV ; `dbg` permet de partager l'instantané d'un export de preuve. */
  exportCsv(state, file, scope = 'all', dbg = this.exportDebug(state, scope)) {
    const stamp = { snapshotId: dbg.snapshotId, storeRevision: dbg.storeRevision, generatedAt: dbg.generatedAt, schemaVersion: dbg.schemaVersion, scope };
    const stampCols = Object.keys(stamp);
    if (file === 'objets.csv') {
      return toCsv(this.inventory(state, { scope }).map((r) => ({ ...r, ...stamp })), ['id', 'kind', 'label', 'level', 'module', 'domain', 'userId', 'revision', 'source', 'control', 'anomalies', ...stampCols]);
    }
    if (file === 'relations.csv') {
      return toCsv(dbg.relations.map((r) => ({ ...r, ...stamp })), ['sourceId', 'sourceKind', 'relation', 'targetId', 'targetKind', 'userId', 'derived', ...stampCols]);
    }
    for (const m of this.registry.modules.values()) {
      const def = m.debug?.csv?.[file];
      if (def) return toCsv((dbg.views[def.view] ?? []).map((r) => ({ ...r, ...stamp })), [...def.columns, ...stampCols]);
    }
    return null;
  }

  /**
   * Dossier de preuve (C07) : JSON de débogage et tous les CSV calculés depuis UN SEUL état
   * (référence figée : le stockage remplace son état à chaque écriture, il ne le modifie jamais
   * en place). Tous les fichiers portent le même instantané, la révision, la date et le périmètre.
   */
  exportArchive(state, scope = 'all') {
    const generatedAt = new Date().toISOString();
    const dbg = this.exportDebug(state, scope, { generatedAt });
    const files = [['debug.json', JSON.stringify(dbg, null, 2)]];
    for (const f of this.csvFiles()) files.push([`csv/${f}`, this.exportCsv(state, f, scope, dbg)]);
    const manifest = {
      snapshotId: dbg.snapshotId,
      storeRevision: dbg.storeRevision,
      storeUpdatedAt: dbg.storeUpdatedAt,
      generatedAt,
      scope,
      schemaVersion: dbg.schemaVersion,
      files: files.map(([name, body]) => ({ name, bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') })),
    };
    files.unshift(['manifest.json', JSON.stringify(manifest, null, 2)]);
    return { manifest, zip: zipStore(files) };
  }
}

export function check(rule, category, module, description, expected, observed, result, ids = []) {
  return { rule, category, module, description, expected, observed, result, execution: 'executed', ids };
}

function labelOf(o) {
  return o.title ?? o.name ?? o.label ?? '';
}

/** Une cellule texte commençant par = + - @ est neutralisée (injection de formule dans un tableur). */
function toCsv(rows, columns) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    let s = Array.isArray(v) ? v.join('|') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

// ---------- archive ZIP minimale (méthode « stockée », sans dépendance) ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, body] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(body, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // noms UTF-8
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
