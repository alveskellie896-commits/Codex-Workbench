import fs from "node:fs/promises";
import initSqlJs from "sql.js";

let nativeSqlitePromise;
let sqlModulePromise;
const databaseBytesCache = new Map();
const SQLITE_RETRY_DELAYS_MS = [40, 120, 260, 600, 1200];

function getSqlModule() {
  sqlModulePromise ||= initSqlJs();
  return sqlModulePromise;
}

async function getNativeSqlite() {
  if (nativeSqlitePromise) return nativeSqlitePromise;
  nativeSqlitePromise = import("node:sqlite")
    .then((mod) => mod?.DatabaseSync || null)
    .catch(() => null);
  return nativeSqlitePromise;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableSqliteError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("disk i/o error") ||
    message.includes("diskio") ||
    message.includes("sqlitE_ioerr".toLowerCase()) ||
    message.includes("database is locked") ||
    message.includes("sqlite_busy".toLowerCase())
  );
}

async function readCachedDatabaseBytes(dbPath) {
  try {
    const stat = await fs.stat(dbPath);
    const cached = databaseBytesCache.get(dbPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.bytes;
    }
    const bytes = await fs.readFile(dbPath);
    databaseBytesCache.set(dbPath, { mtimeMs: stat.mtimeMs, size: stat.size, bytes });
    return bytes;
  } catch (error) {
    databaseBytesCache.delete(dbPath);
    throw error;
  }
}

async function sqliteJsonWithNativeDriver(dbPath, sql, params = []) {
  const DatabaseSync = await getNativeSqlite();
  if (!DatabaseSync) {
    throw new Error("Native SQLite driver unavailable");
  }
  const db = new DatabaseSync(dbPath, { open: true, readOnly: true });
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

async function sqliteJsonWithSqlJs(dbPath, sql, params = []) {
  const [SQL, databaseBytes] = await Promise.all([getSqlModule(), readCachedDatabaseBytes(dbPath)]);
  const db = new SQL.Database(databaseBytes);
  try {
    const statement = db.prepare(sql, params);
    try {
      const rows = [];
      const columns = statement.getColumnNames();
      while (statement.step()) {
        const values = statement.get();
        rows.push(Object.fromEntries(columns.map((column, index) => [column, values[index]])));
      }
      return rows;
    } finally {
      statement.free();
    }
  } finally {
    db.close();
  }
}

export async function sqliteJson(dbPath, sql, params = []) {
  let lastError = null;

  for (let attempt = 0; attempt <= SQLITE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await sqliteJsonWithNativeDriver(dbPath, sql, params);
    } catch (error) {
      lastError = error;
      if (!isRetriableSqliteError(error) || attempt === SQLITE_RETRY_DELAYS_MS.length) break;
      await sleep(SQLITE_RETRY_DELAYS_MS[attempt]);
    }
  }

  try {
    return await sqliteJsonWithSqlJs(dbPath, sql, params);
  } catch (fallbackError) {
    if (lastError && isRetriableSqliteError(lastError) && !isRetriableSqliteError(fallbackError)) {
      throw lastError;
    }
    throw fallbackError;
  }
}
