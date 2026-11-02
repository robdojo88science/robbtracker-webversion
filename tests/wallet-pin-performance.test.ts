import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createActionPinService, PIN_ITERATIONS, type ActionPinDependencies } from '../src/core/actionPin';
import { protectRepository } from '../src/core/protectedRepository';
import { accountBalance } from '../src/core/analytics';
import type { Database, SqlConnection, SqlValue } from '../src/core/database';
import type { FinanceRepository, TransactionInput } from '../src/core/types';
import { createRepository } from '../src/data/repository';
import { migrate } from '../src/data/migrations';

const pin = '482915';
function legacyCredential() {
  const secret = (value: string) => {
    const salt = randomBytes(32).toString('hex');
    return { salt, hash: pbkdf2Sync(value, Buffer.from(salt, 'hex'), PIN_ITERATIONS, 32, 'sha256').toString('hex') };
  };
  return JSON.stringify({ version: 1, algorithm: 'pbkdf2-sha256', iterations: PIN_ITERATIONS, pin: secret(pin), recovery: [{ questionId: 'first-school', ...secret('school') }, { questionId: 'first-pet', ...secret('milo') }], failedAttempts: 0, lockedUntil: 0 });
}

test('native PIN acceleration accepts existing credentials and preserves the JS-compatible hash format', async () => {
  let stored = legacyCredential();
  const calls: number[] = [];
  const deps: ActionPinDependencies = {
    storageAvailable: async () => true, read: async () => stored, write: async value => { stored = value; }, remove: async () => {}, randomBytes: async size => new Uint8Array(randomBytes(size)), now: () => 10_000,
    derive: async (value, salt, iterations) => { calls.push(iterations); return new Uint8Array(pbkdf2Sync(value, Buffer.from(salt, 'hex'), iterations, 32, 'sha256')); },
  };
  const accelerated = createActionPinService(deps);
  assert.equal(await accelerated.verifyPin(pin), true);
  await accelerated.changePin(pin, '9264');
  assert.deepEqual(calls, [PIN_ITERATIONS, PIN_ITERATIONS, PIN_ITERATIONS]);
  assert.equal(JSON.parse(stored).iterations, 210_000);
  assert.equal(stored.includes('9264'), false);
  const fallback = createActionPinService({ ...deps, derive: undefined });
  assert.equal(await fallback.verifyPin('9264'), true);
  assert.equal(await fallback.verifyPin(pin), false);
});

test('failed native derivation keeps the persisted attempt and never grants authorization', async () => {
  let stored = legacyCredential();
  const deps: ActionPinDependencies = { storageAvailable: async () => true, read: async () => stored, write: async value => { stored = value; }, remove: async () => {}, randomBytes: async size => new Uint8Array(size), now: () => 10_000, derive: async () => new Uint8Array(1) };
  await assert.rejects(createActionPinService(deps).verifyPin(pin), /could not be verified/);
  assert.equal(JSON.parse(stored).failedAttempts, 1);
  deps.derive = async () => { throw new Error('native crypto unavailable'); };
  await assert.rejects(createActionPinService(deps).verifyPin(pin), /native crypto unavailable/);
  assert.equal(JSON.parse(stored).failedAttempts, 2);
});

test('indexed mutation guards avoid snapshot reads while preserving concurrent-add PIN protection', async () => {
  const ids = new Set<string>(), prompts: string[] = [], writes: string[] = [];
  const raw = {
    getSnapshot: async () => { throw new Error('A mutation guard must not read the full ledger.'); },
    hasRecord: async (collection: string, id: string) => { assert.equal(collection, 'transactions'); return ids.has(id); },
    saveTransaction: async (input: TransactionInput) => { ids.add(input.id!); writes.push(input.id!); },
  } as unknown as FinanceRepository;
  const repo = protectRepository(raw, async reason => { prompts.push(reason); throw new Error('PIN denied'); }, async () => {});
  const input: TransactionInput = { id: randomUUID(), kind: 'expense', title: 'Lunch', amountMinor: 2500, date: '2026-11-02' };
  const results = await Promise.allSettled([repo.saveTransaction(input), repo.saveTransaction({ ...input, amountMinor: 2600 })]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.deepEqual(writes, [input.id]); assert.deepEqual(prompts, ['Edit this transaction']);
});

test('transaction, wallet and savings mutations read financial columns without pulling audit history or photos', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const selects: string[] = [];
  const connection: SqlConnection = {
    exec: async sql => { sqlite.exec(sql); },
    run: async (sql, params: SqlValue[] = []) => ({ changes: Number(sqlite.prepare(sql).run(...params).changes) }),
    all: async <T>(sql: string, params: SqlValue[] = []) => { selects.push(sql); return sqlite.prepare(sql).all(...params) as T[]; },
    first: async <T>(sql: string, params: SqlValue[] = []) => sqlite.prepare(sql).get(...params) as T ?? null,
  };
  const db: Database = { ...connection, transaction: async <T>(work: (tx: SqlConnection) => Promise<T>) => { sqlite.exec('BEGIN IMMEDIATE'); try { const value = await work(connection); sqlite.exec('COMMIT'); return value; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
  try {
    await migrate(db);
    const repo = createRepository(db, { uuid: randomUUID, deviceId: randomUUID(), now: () => '2026-11-02T04:00:00Z', digest: async value => createHash('sha256').update(value).digest('hex') });
    await repo.setup({ displayName: 'Robb', openingBalanceMinor: 100_000, monthlyBudgetMinor: 50_000 });
    const cash = (await repo.getSnapshot()).accounts[0], bankId = randomUUID();
    await repo.saveAccount({ id: bankId, name: 'Bank', type: 'asset', currency: 'PHP', exchangeRate: 1, includedInBalance: true });
    selects.length = 0;
    const photo = 'data:image/jpeg;base64,YWJjZA==';
    const input: TransactionInput = { id: randomUUID(), title: 'Lunch', kind: 'expense', amountMinor: 2500, accountId: cash.id, date: '2026-11-02', notePhotos: [photo] };
    await repo.saveTransaction(input);
    await repo.saveTransaction({ ...input, amountMinor: 2600 });
    const movedId = await repo.deleteAccount(cash.id, { mode: 'transfer', destinationAccountId: bankId });
    assert.ok(movedId);
    assert.equal(selects.some(sql => /FROM audit_logs/.test(sql)), false);
    assert.equal(selects.some(sql => /^SELECT \* FROM transactions/.test(sql)), false);
    assert.ok(selects.filter(sql => / FROM transactions$/.test(sql)).length <= 4, 'Save, edit and transfer/remove reuse their checked ledger instead of rereading it after writing.');
    assert.ok(selects.some(sql => sql.includes("'[]' AS \"notePhotos\"")));
    assert.equal(await repo.hasRecord!('accounts', cash.id), true);
    assert.equal(await repo.hasRecord!('transactions', randomUUID()), false);
    await assert.rejects(repo.hasRecord!('transactions; DROP TABLE transactions' as any, input.id!), /Unknown record/);
    const snapshot = await repo.getSnapshot();
    assert.equal(accountBalance(snapshot, bankId), 97_400);
    assert.equal(accountBalance(snapshot, cash.id), 0);
    assert.deepEqual(snapshot.transactions.find(row => row.id === input.id)?.notePhotos, [photo]);
    assert.equal(snapshot.accounts.find(row => row.id === cash.id)?.includedInBalance, false);
    selects.length = 0;
    const goalId = randomUUID();
    await repo.saveGoal({ id: goalId, name: 'Savings', targetMinor: 5000, startDate: '2026-11-02', durationMonths: 2, paymentDay: 3 });
    await repo.contribute({ goalId, accountId: bankId, amountMinor: 2500, date: '2026-11-02' });
    await repo.setGoalStatus(goalId, 'paused');
    assert.equal(selects.some(sql => /FROM audit_logs/.test(sql)), false);
    assert.equal(selects.some(sql => /^SELECT \* FROM transactions/.test(sql)), false);
    const savings = await repo.getSnapshot();
    assert.equal(accountBalance(savings, bankId), 94_900);
    assert.equal(savings.goals.find(row => row.id === goalId)?.status, 'paused');
    assert.deepEqual(savings.transactions.find(row => row.id === input.id)?.notePhotos, [photo]);
  } finally { sqlite.close(); }
});
