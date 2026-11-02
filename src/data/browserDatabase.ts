import type { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js';
import type { Database, SqlConnection, SqlValue } from '../core/database';

export interface BrowserDatabaseStore {
  revision(): Promise<string | undefined>;
  load(): Promise<Uint8Array | undefined>;
  save(bytes: Uint8Array): Promise<string>;
  lock<T>(work: () => Promise<T>): Promise<T>;
}
const writes = /(?:^|;)\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE|VACUUM|REINDEX|PRAGMA\s+user_version\s*=)/i;
const dml = /^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i;
const header = 'SQLite format 3\0';

/** One live SQLite connection; only a successful IndexedDB checkpoint commits a UI mutation. */
export async function createBrowserDatabase(SQL: SqlJsStatic, store: BrowserDatabaseStore): Promise<Database> {
  let connection: SqlJsDatabase | undefined, durable: Uint8Array | undefined, revision: string | undefined, loaded = false;
  let dirty = false, pending: Promise<unknown> = Promise.resolve();
  const configure = () => connection!.run('PRAGMA foreign_keys = ON; PRAGMA journal_mode = MEMORY; PRAGMA busy_timeout = 5000;');
  const replace = (bytes: Uint8Array | undefined) => {
    if (bytes && (bytes.length < 100 || [...header].some((letter, index) => bytes[index] !== letter.charCodeAt(0)))) throw new Error('Saved tracker data could not be read. It has been kept unchanged; restore a backup to recover it.');
    const next = bytes ? new SQL.Database(bytes) : new SQL.Database();
    try {
      if (bytes && next.exec('PRAGMA quick_check')[0]?.values[0]?.[0] !== 'ok') throw new Error('Saved tracker data failed its integrity check.');
      connection?.close(); connection = next; configure();
    } catch (error) { next.close(); throw error; }
  };
  const refresh = async () => {
    const savedRevision = await store.revision();
    if (!loaded || savedRevision !== revision) {
      const bytes = await store.load();
      if (savedRevision !== undefined && bytes === undefined) throw new Error('The saved tracker checkpoint is missing. Existing browser storage has not been replaced.');
      replace(bytes); durable = bytes?.slice(); revision = savedRevision; loaded = true;
    }
  };
  const rollbackMemory = () => { replace(durable); dirty = false; };
  const checkpoint = async () => {
    if (!dirty) return;
    try {
      const bytes = connection!.export();
      // Older sql.js releases reopen on export, so restore connection pragmas.
      configure();
      const savedRevision = await store.save(bytes);
      durable = bytes.slice(); revision = savedRevision; dirty = false;
    } catch (error) {
      rollbackMemory();
      const detail = error instanceof Error ? error.message : 'Storage is unavailable.';
      throw new Error('Browser storage did not save this change. Your previous records are intact. ' + detail);
    }
  };
  const raw: SqlConnection = {
    async exec(sql) {
      if (writes.test(sql)) dirty = true;
      connection!.run(sql.replace(/PRAGMA\s+journal_mode\s*=\s*WAL\s*;/gi, 'PRAGMA journal_mode = MEMORY;'));
      if (writes.test(sql)) dirty = true;
    },
    async run(sql, params: SqlValue[] = []) {
      connection!.run(sql, params);
      const changes = connection!.getRowsModified();
      if (writes.test(sql) && (!dml.test(sql) || changes > 0)) dirty = true;
      return { changes };
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      const statement = connection!.prepare(sql, params);
      try { const rows: T[] = []; while (statement.step()) rows.push(statement.getAsObject() as T); return rows; }
      finally { statement.free(); }
    },
    async first<T>(sql: string, params: SqlValue[] = []) {
      const statement = connection!.prepare(sql, params);
      try { return statement.step() ? statement.getAsObject() as T : null; }
      finally { statement.free(); }
    },
  };
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = pending.then(() => store.lock(async () => { await refresh(); return work(); }));
    pending = result.catch(() => undefined); return result;
  };
  const standalone = <T>(work: () => Promise<T>) => serial(async () => {
    try { const result = await work(); await checkpoint(); return result; }
    catch (error) { if (dirty) rollbackMemory(); throw error; }
  });
  await store.lock(refresh);
  return {
    exec: sql => standalone(() => raw.exec(sql)),
    run: (sql, params) => standalone(() => raw.run(sql, params)),
    all: <T>(sql: string, params?: SqlValue[]) => serial(() => raw.all<T>(sql, params)),
    first: <T>(sql: string, params?: SqlValue[]) => serial(() => raw.first<T>(sql, params)),
    transaction: <T>(work: (tx: SqlConnection) => Promise<T>) => serial(async () => {
      connection!.run('BEGIN IMMEDIATE');
      let committed = false;
      try {
        const result = await work(raw);
        connection!.run('COMMIT'); committed = true;
        await checkpoint(); return result;
      } catch (error) {
        if (!committed) { try { connection!.run('ROLLBACK'); } catch { rollbackMemory(); } }
        dirty = false; throw error;
      }
    }),
  };
}
