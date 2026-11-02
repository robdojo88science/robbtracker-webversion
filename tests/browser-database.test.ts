import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import 'fake-indexeddb/auto';
import { createBrowserDatabase, type BrowserDatabaseStore } from '../src/data/browserDatabase';
import { createRepository } from '../src/data/repository';
import { protectRepository } from '../src/core/protectedRepository';
import { coordinateRepository } from '../src/platform/repositoryLock.web';
import { migrate } from '../src/data/migrations';
import { deleteBrowserValue, getBrowserValue, setBrowserValue, setBrowserValues, withBrowserLock } from '../src/platform/browserStore';

const sql = initSqlJs({ locateFile: file => join(process.cwd(), 'node_modules/sql.js/dist', file) });
const dependencies = { uuid: randomUUID, now: () => '2026-11-02T04:00:00.000Z', deviceId: randomUUID(), digest: async (value: string) => createHash('sha256').update(value).digest('hex') };
function checkpoints() {
  let bytes: Uint8Array | undefined, version: string | undefined, count = 0, fail = false, pending: Promise<unknown> = Promise.resolve();
  const store: BrowserDatabaseStore = {
    revision: async () => version,
    load: async () => bytes?.slice(),
    save: async next => { if (fail) throw new Error('QuotaExceededError'); bytes = next.slice(); version = String(++count); return version; },
    lock: <T>(work: () => Promise<T>): Promise<T> => { const result = pending.then(work, work); pending = result.catch(() => undefined); return result; },
  };
  return { store, saved: () => bytes?.slice(), writes: () => count, fail: (value: boolean) => { fail = value; }, corrupt: () => { bytes = new Uint8Array([1,2,3]); version = 'bad'; }, missing: () => { bytes = undefined; version = 'missing'; } };
}
async function fixture() {
  const persistence = checkpoints(), db = await createBrowserDatabase(await sql, persistence.store);
  await migrate(db); const repo = createRepository(db, dependencies);
  await repo.setup({ displayName: 'Browser fixture', openingBalanceMinor: 100_000, monthlyBudgetMinor: 50_000 });
  return { persistence, db, repo };
}

test('browser SQLite persists exact native-compatible records and does not rewrite for reads or unchanged migrations', async () => {
  const f = await fixture();
  await f.repo.saveTransaction({ kind: 'expense', title: 'Bus fare', date: '2026-11-02', amountMinor: 2500 });
  const before = await f.repo.getSnapshot(), writes = f.persistence.writes();
  await f.repo.getSnapshot(); await f.repo.createBackup(); await migrate(f.db);
  assert.equal(f.persistence.writes(), writes);
  const reopened = await createBrowserDatabase(await sql, f.persistence.store);
  await migrate(reopened);
  assert.deepEqual(await createRepository(reopened, dependencies).getSnapshot(), before);
  assert.equal(f.persistence.writes(), writes);
  assert.equal((await reopened.first<{user_version:number}>('PRAGMA user_version'))?.user_version, 6);
});

test('browser checkpoints preserve foreign keys and immutable audit triggers', async () => {
  const f = await fixture();
  assert.equal((await f.db.first<{foreign_keys:number}>('PRAGMA foreign_keys'))?.foreign_keys, 1);
  await assert.rejects(f.db.run("UPDATE audit_logs SET type = 'changed'"), /immutable/);
  await assert.rejects(f.db.run('UPDATE transactions SET accountId = ?', [randomUUID()]), /FOREIGN KEY/);
  const reopened = await createBrowserDatabase(await sql, f.persistence.store);
  assert.equal((await reopened.first<{foreign_keys:number}>('PRAGMA foreign_keys'))?.foreign_keys, 1);
  await assert.rejects(reopened.run('DELETE FROM audit_logs'), /immutable/);
});

test('failed persistence restores last durable bytes before the next read and retry', async () => {
  const f = await fixture(), before = await f.repo.getSnapshot(), bytes = f.persistence.saved();
  const entry = { id: randomUUID(), kind: 'expense' as const, title: 'Should not be saved', date: '2026-11-02', amountMinor: 500 };
  f.persistence.fail(true);
  await assert.rejects(f.repo.saveTransaction(entry), /did not save this change/);
  assert.deepEqual(await f.repo.getSnapshot(), before);
  assert.deepEqual(f.persistence.saved(), bytes);
  f.persistence.fail(false);
  await f.repo.saveTransaction(entry);
  assert.equal((await f.repo.getSnapshot()).transactions.filter(transaction => transaction.id === entry.id).length, 1);
});

test('SQLite rollback preserves all records when an audit write fails', async () => {
  const f = await fixture();
  await f.db.exec("CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON audit_logs WHEN NEW.type = 'expense_added' BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END;");
  const before = await f.repo.getSnapshot(), bytes = f.persistence.saved();
  await assert.rejects(f.repo.saveTransaction({ kind: 'expense', title: 'Atomic failure', date: '2026-11-02', amountMinor: 500 }), /fixture audit failure/);
  assert.deepEqual(await f.repo.getSnapshot(), before);
  assert.deepEqual(f.persistence.saved(), bytes);
});

test('two independent browser connections refresh within the shared writer lock and retain both writes', async () => {
  const f = await fixture(), other = createRepository(await createBrowserDatabase(await sql, f.persistence.store), dependencies);
  const first = randomUUID(), second = randomUUID();
  await Promise.all([
    f.repo.saveTransaction({ id: first, kind: 'income', title: 'Window one', date: '2026-11-02', amountMinor: 100 }),
    other.saveTransaction({ id: second, kind: 'income', title: 'Window two', date: '2026-11-02', amountMinor: 200 }),
  ]);
  const a = await f.repo.getSnapshot(), b = await other.getSnapshot();
  assert.deepEqual(a, b); assert.ok(a.transactions.some(transaction => transaction.id === first)); assert.ok(a.transactions.some(transaction => transaction.id === second));
});

test('unreadable or missing existing checkpoints are never replaced by an empty tracker', async () => {
  const corrupt = checkpoints(); corrupt.corrupt();
  await assert.rejects(createBrowserDatabase(await sql, corrupt.store), /could not be read/);
  assert.equal(corrupt.writes(), 0); assert.deepEqual(corrupt.saved(), new Uint8Array([1,2,3]));
  const missing = checkpoints(); missing.missing();
  await assert.rejects(createBrowserDatabase(await sql, missing.store), /checkpoint is missing/);
  assert.equal(missing.writes(), 0);
});

test('failed standalone multi-statement SQL does not leak partial schema changes', async () => {
  const f = await fixture(), bytes = f.persistence.saved();
  await assert.rejects(f.db.exec('CREATE TABLE partial_fixture (value TEXT); INSERT INTO missing_fixture VALUES (1);'));
  assert.equal(await f.db.first("SELECT name FROM sqlite_master WHERE name='partial_fixture'"), null);
  assert.deepEqual(f.persistence.saved(), bytes);
});

test('IndexedDB writes commit atomically and failed cloning leaves previous values intact', async () => {
  const first = 'fixture.' + randomUUID(), second = 'fixture.' + randomUUID();
  await setBrowserValues([[first, new Uint8Array([1,2,3])], [second, 'version-1']]);
  assert.deepEqual(await getBrowserValue(first), new Uint8Array([1,2,3]));
  assert.equal(await getBrowserValue(second), 'version-1');
  await assert.rejects(setBrowserValues([[first, 'must roll back'], [second, () => undefined]]));
  assert.deepEqual(await getBrowserValue(first), new Uint8Array([1,2,3]));
  assert.equal(await getBrowserValue(second), 'version-1');
  await deleteBrowserValue(first); assert.equal(await getBrowserValue(first), undefined);
});

test('browser compound writes serialize with Web Locks and reject unsupported locking', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator'), events: string[] = [];
  let pending: Promise<unknown> = Promise.resolve();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: <T>(_name: string, _options: unknown, work: () => Promise<T>) => { const next = pending.then(work); pending = next.catch(() => undefined); return next; } } } });
  try {
    await Promise.all([withBrowserLock('fixture', async () => { events.push('a'); await setBrowserValue('fixture.lock', 1); events.push('b'); }), withBrowserLock('fixture', async () => { events.push('c'); assert.equal(await getBrowserValue('fixture.lock'), 1); })]);
    assert.deepEqual(events, ['a','b','c']);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    await assert.rejects(withBrowserLock('fixture', async () => undefined), /cannot safely coordinate/);
  } finally { if (original) Object.defineProperty(globalThis, 'navigator', original); else Reflect.deleteProperty(globalThis, 'navigator'); }
});

test('backup replacement remains atomic when browser checkpoint persistence fails', async () => {
  const target = await fixture(), source = await fixture();
  await source.repo.saveTransaction({ kind: 'expense', title: 'Imported history', date: '2024-11-05', amountMinor: 800 });
  const backup = await source.repo.createBackup(), before = await target.repo.getSnapshot(), bytes = target.persistence.saved();
  target.persistence.fail(true);
  await assert.rejects(target.repo.restoreBackup(backup, true), /did not save this change/);
  assert.deepEqual(await target.repo.getSnapshot(), before);
  assert.deepEqual(target.persistence.saved(), bytes);
  await assert.rejects(target.db.run('DELETE FROM audit_logs'), /immutable/);
  target.persistence.fail(false);
  await target.repo.restoreBackup(backup, true);
  const restored = await target.repo.getSnapshot();
  assert.deepEqual(restored.transactions, backup.data.transactions);
  assert.deepEqual(restored.accounts, backup.data.accounts);
  assert.ok(restored.auditLogs.some(event => event.type === 'backup_restored'));
});

function actionLock() {
  let pending: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => { const next = pending.then(work, work); pending = next.catch(() => undefined); return next; };
}
test('cross-tab mutation facade keeps new-record checks and writes together before PIN decisions', async () => {
  const f = await fixture(), otherRaw = createRepository(await createBrowserDatabase(await sql, f.persistence.store), dependencies);
  const lock = actionLock(), prompts: string[] = [];
  const authorize = async (reason: string) => { prompts.push(reason); throw new Error('PIN denied'); };
  const first = coordinateRepository(protectRepository(f.repo, authorize, async () => {}), lock);
  const second = coordinateRepository(protectRepository(otherRaw, authorize, async () => {}), lock);
  const entry = { id: randomUUID(), kind: 'expense' as const, title: 'New entry', amountMinor: 500, date: '2026-11-02' };
  const outcomes = await Promise.allSettled([first.saveTransaction(entry), second.saveTransaction({ ...entry, amountMinor: 900 })]);
  assert.equal(outcomes[0].status, 'fulfilled'); assert.equal(outcomes[1].status, 'rejected');
  assert.deepEqual(prompts, ['Edit this transaction']);
  assert.equal((await first.getSnapshot()).transactions.find(transaction => transaction.id === entry.id)?.amountMinor, 500);
  await second.saveTransaction({ kind: 'income', title: 'After denied PIN', amountMinor: 100, date: '2026-11-02' });
  assert.ok((await first.getSnapshot()).transactions.some(transaction => transaction.title === 'After denied PIN'));
});
test('reads remain available during PIN review and cancellation releases the mutation lock', { timeout: 2000 }, async () => {
  const f = await fixture(), otherRaw = createRepository(await createBrowserDatabase(await sql, f.persistence.store), dependencies);
  const entry = { id: randomUUID(), kind: 'expense' as const, title: 'Original entry', amountMinor: 500, date: '2026-11-02' };
  await f.repo.saveTransaction(entry);
  let entered!: () => void, cancel!: (reason: Error) => void;
  const reviewing = new Promise<void>(resolve => { entered = resolve; });
  const decision = new Promise<void>((_resolve, reject) => { cancel = reject; });
  const lock = actionLock();
  const first = coordinateRepository(protectRepository(f.repo, async () => { entered(); await decision; }, async () => {}), lock);
  const second = coordinateRepository(protectRepository(otherRaw, async () => {}, async () => {}), lock);
  const editing = first.saveTransaction({ ...entry, amountMinor: 900 });
  await reviewing;
  const visible = await second.getSnapshot();
  assert.equal(visible.transactions.find(transaction => transaction.id === entry.id)?.amountMinor, 500);
  const waiting = second.saveTransaction({ kind: 'income', title: 'Queued after review', amountMinor: 200, date: '2026-11-02' });
  cancel(new Error('Action cancelled'));
  await assert.rejects(editing, /Action cancelled/); await waiting;
  assert.equal((await second.getSnapshot()).transactions.find(transaction => transaction.id === entry.id)?.amountMinor, 500);
});
