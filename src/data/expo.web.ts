import type { SqlJsStatic } from 'sql.js';
import type { FinanceRepository } from '../core/types';
import { getBrowserValue, setBrowserValues, withBrowserLock } from '../platform/browserStore';
import { createBrowserDatabase } from './browserDatabase';
import { createRepository } from './repository';
import { migrate } from './migrations';
import { webPath } from '../platform/webPaths';

const DATA = 'finance.sqlite.v1', REVISION = 'finance.revision.v1', DEVICE = 'finance.device-id.v1';
let sqlPromise: Promise<SqlJsStatic> | undefined;
let repositoryPromise: Promise<FinanceRepository> | undefined;
function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlPromise) sqlPromise = new Promise<SqlJsStatic>((resolve, reject) => {
    const global = window as unknown as { initSqlJs?: (options: { locateFile: (file: string) => string }) => Promise<SqlJsStatic> };
    const initialize = () => {
      if (!global.initSqlJs) { reject(new Error('The offline database engine could not start.')); return; }
      global.initSqlJs({ locateFile: file => webPath(file) }).then(resolve, reject);
    };
    if (global.initSqlJs) { initialize(); return; }
    const script = document.createElement('script'); script.src = webPath('sql-wasm-browser.js'); script.async = true;
    script.onload = initialize;
    script.onerror = () => { script.remove(); reject(new Error('The offline database engine is not cached yet. Open the tracker online once, then try again.')); };
    document.head.appendChild(script);
  }).catch(error => { sqlPromise = undefined; throw error; });
  return sqlPromise;
}
export function getRepository(): Promise<FinanceRepository> {
  if (!repositoryPromise) repositoryPromise = (async () => {
    if (!globalThis.crypto?.subtle || !globalThis.crypto.randomUUID) throw new Error('Open this tracker over HTTPS or localhost to use secure offline storage.');
    const SQL = await loadSqlJs();
    const db = await createBrowserDatabase(SQL, {
      revision: () => getBrowserValue<string>(REVISION),
      load: async () => {
        const stored = await getBrowserValue<unknown>(DATA);
        if (stored === undefined) return undefined;
        if (stored instanceof Uint8Array) return stored;
        if (stored instanceof ArrayBuffer) return new Uint8Array(stored);
        throw new Error('Saved tracker data is unreadable. Existing browser storage has not been replaced.');
      },
      save: async bytes => { const revision = crypto.randomUUID(); await setBrowserValues([[DATA, bytes], [REVISION, revision]]); return revision; },
      lock: work => withBrowserLock('finance', work),
    });
    await migrate(db);
    const deviceId = await withBrowserLock('finance', async () => {
      let saved = await getBrowserValue<string>(DEVICE);
      if (!saved) { saved = crypto.randomUUID(); await setBrowserValues([[DEVICE, saved]]); }
      return saved;
    });
    return createRepository(db, {
      deviceId, uuid: () => crypto.randomUUID(), now: () => new Date().toISOString(),
      digest: async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join(''),
    });
  })().catch(error => { repositoryPromise = undefined; throw error; });
  return repositoryPromise;
}
