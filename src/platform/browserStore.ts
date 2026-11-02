const DATABASE = 'robbtracker-pwa-v1';
const STORE = 'values';
let opening: Promise<IDBDatabase> | undefined;

function openStore(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) return Promise.reject(new Error('Browser storage is unavailable. Use a regular browser window with local storage enabled.'));
  if (!opening) opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onerror = () => reject(request.error ?? new Error('Could not open browser storage.'));
    request.onblocked = () => reject(new Error('Close other tracker windows, then try opening browser storage again.'));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => { database.close(); opening = undefined; };
      resolve(database);
    };
  }).catch(error => { opening = undefined; throw error; });
  return opening;
}
function transaction(database: IDBDatabase, mode: IDBTransactionMode): IDBTransaction {
  if (mode === 'readwrite') {
    try { return database.transaction(STORE, mode, { durability: 'strict' }); }
    catch (error) { if (!(error instanceof TypeError)) throw error; }
  }
  return database.transaction(STORE, mode);
}
export async function getBrowserValue<T>(key: string): Promise<T | undefined> {
  const database = await openStore();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = transaction(database, 'readonly');
    let value: T | undefined;
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => { value = request.result as T | undefined; };
    tx.oncomplete = () => resolve(value);
    tx.onerror = tx.onabort = () => reject(tx.error ?? request.error ?? new Error('Could not read browser storage.'));
  });
}
/** All entries become durable together; success means transaction completion. */
export async function setBrowserValues(entries: readonly (readonly [string, unknown])[]): Promise<void> {
  const database = await openStore();
  return new Promise<void>((resolve, reject) => {
    const tx = transaction(database, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Browser storage could not save this change.'));
    try { const store = tx.objectStore(STORE); for (const [key, value] of entries) store.put(value, key); }
    catch (error) { tx.abort(); reject(error); }
  });
}
export function setBrowserValue(key: string, value: unknown): Promise<void> { return setBrowserValues([[key, value]]); }
export async function deleteBrowserValue(key: string): Promise<void> {
  const database = await openStore();
  return new Promise<void>((resolve, reject) => {
    const tx = transaction(database, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Browser storage could not remove this value.'));
  });
}
/** Compound operations are serialized across tabs; no unsafe local-lock fallback. */
export function withBrowserLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  if (!globalThis.navigator?.locks?.request) return Promise.reject(new Error('This browser cannot safely coordinate tracker storage. Use an up-to-date browser over HTTPS or localhost.'));
  return navigator.locks.request('robbtracker-pwa:' + name, { mode: 'exclusive' }, work);
}
