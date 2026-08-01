import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

const IDB_NAME = 'smart_shelf';
const IDB_STORE = 'sqlite';
const IDB_KEY = 'db';

let db = null;

// ── IndexedDB helpers ──────────────────────────────────────────────────────────
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(IDB_STORE);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadFromIDB() {
  const idb = await openIDB();
  return new Promise((resolve) => {
    const tx = idb.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

async function persistToIDB() {
  const data = db.export();
  const idb = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(data, IDB_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// ── Init ───────────────────────────────────────────────────────────────────────
export async function initDB() {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = await loadFromIDB();
  db = saved ? new SQL.Database(saved) : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS mappings (
      id               TEXT PRIMARY KEY,
      local_code       TEXT NOT NULL DEFAULT '',
      third_party_code TEXT NOT NULL DEFAULT ''
    )
  `);
}

// ── Read ───────────────────────────────────────────────────────────────────────
export function getSettings() {
  const kvRows = db.exec(`SELECT key, value FROM settings`);
  const kv = {};
  if (kvRows[0]) kvRows[0].values.forEach(([k, v]) => { kv[k] = v; });

  const mapRows = db.exec(`SELECT id, local_code, third_party_code FROM mappings ORDER BY rowid`);
  const mappings = mapRows[0]
    ? mapRows[0].values.map(([id, localCode, thirdPartyCode]) => ({ id, localCode, thirdPartyCode }))
    : [];

  return {
    shelfUrl:    kv.shelfUrl    ?? '',
    ledGlowTime: kv.ledGlowTime != null ? Number(kv.ledGlowTime) : 5,
    useMappings: kv.useMappings === 'true',
    mappings,
  };
}

// ── Mapping lookup ─────────────────────────────────────────────────────────────
export function lookupLocalCode(thirdPartyCode) {
  const result = db.exec(
    `SELECT local_code FROM mappings WHERE third_party_code = ? LIMIT 1`,
    [thirdPartyCode]
  );
  return result[0]?.values[0]?.[0] ?? null;
}

// ── Write ──────────────────────────────────────────────────────────────────────
export async function saveSettings({ shelfUrl, ledGlowTime, useMappings, mappings }) {
  db.run(`INSERT OR REPLACE INTO settings VALUES ('shelfUrl',    ?)`, [shelfUrl]);
  db.run(`INSERT OR REPLACE INTO settings VALUES ('ledGlowTime', ?)`, [String(ledGlowTime)]);
  db.run(`INSERT OR REPLACE INTO settings VALUES ('useMappings', ?)`, [String(useMappings)]);

  db.run(`DELETE FROM mappings`);
  const stmt = db.prepare(
    `INSERT INTO mappings (id, local_code, third_party_code) VALUES (?, ?, ?)`
  );
  mappings.forEach(({ id, localCode, thirdPartyCode }) => {
    stmt.run([id, localCode, thirdPartyCode]);
  });
  stmt.free();

  await persistToIDB();
}
