import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { Database, SqlConnection, SqlValue } from '../core/database';
import type { FinanceRepository } from '../core/types';
import { migrate } from './migrations';
import { createRepository } from './repository';

let repositoryPromise: Promise<FinanceRepository> | undefined;

/** All access is serialized on one connection, including reads and migrations.
 * A transaction uses the same foreign-key-enabled connection. The raw connection
 * never escapes this adapter, so other async calls cannot join its transaction.
 */
function adapter(db: SQLite.SQLiteDatabase): Database {
  let pending: Promise<unknown> = Promise.resolve();
  const serial = <T,>(work: () => Promise<T>): Promise<T> => {
    const next = pending.then(work, work);
    pending = next.catch(() => undefined);
    return next;
  };
  const raw: SqlConnection = {
    exec: sql => db.execAsync(sql),
    run: async (sql, params: SqlValue[] = []) => {
      const result = await db.runAsync(sql, params);
      return { changes: result.changes };
    },
    all: <T,>(sql: string, params: SqlValue[] = []) => db.getAllAsync<T>(sql, params),
    first: <T,>(sql: string, params: SqlValue[] = []) => db.getFirstAsync<T>(sql, params),
  };
  return {
    exec: sql => serial(() => raw.exec(sql)),
    run: (sql, params) => serial(() => raw.run(sql, params)),
    all: <T,>(sql: string, params?: SqlValue[]) => serial(() => raw.all<T>(sql, params)),
    first: <T,>(sql: string, params?: SqlValue[]) => serial(() => raw.first<T>(sql, params)),
    transaction: <T,>(work: (tx: SqlConnection) => Promise<T>) => serial(async () => {
      await raw.exec('BEGIN IMMEDIATE');
      try {
        const value = await work(raw);
        await raw.exec('COMMIT');
        return value;
      } catch (error) {
        await raw.exec('ROLLBACK');
        throw error;
      }
    }),
  };
}

export function getRepository(): Promise<FinanceRepository> {
  if (!repositoryPromise) {
    repositoryPromise = (async () => {
      let deviceId = await SecureStore.getItemAsync('ftracker.device-id');
      if (!deviceId) {
        deviceId = Crypto.randomUUID();
        await SecureStore.setItemAsync('ftracker.device-id', deviceId, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      }
      const nativeDb = await SQLite.openDatabaseAsync('ftracker.db');
      await nativeDb.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;');
      const db = adapter(nativeDb);
      await migrate(db);
      return createRepository(db, {
        deviceId,
        uuid: Crypto.randomUUID,
        now: () => new Date().toISOString(),
        digest: text => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text),
      });
    })().catch(error => {
      repositoryPromise = undefined;
      throw error;
    });
  }
  return repositoryPromise;
}
