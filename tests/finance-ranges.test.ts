import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { createRepository } from '../src/data/repository';
import { migrate } from '../src/data/migrations';
import { addDays, dateRange } from '../src/core/dates';
import { accountBalance, balanceSummary, budgetForRange, computeAccountBalances, dailyTrend, periodSummary, spending } from '../src/core/analytics';
import type { Database, SqlConnection, SqlValue } from '../src/core/database';

async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  const connection: SqlConnection = {
    async exec(sql) { sqlite.exec(sql); },
    async run(sql, params: SqlValue[] = []) { return { changes: Number(sqlite.prepare(sql).run(...params).changes) }; },
    async all<T>(sql: string, params: SqlValue[] = []) { return sqlite.prepare(sql).all(...params) as T[]; },
    async first<T>(sql: string, params: SqlValue[] = []) { return sqlite.prepare(sql).get(...params) as T ?? null; },
  };
  const db: Database = { ...connection, async transaction<T>(work: (tx: SqlConnection) => Promise<T>) {
    sqlite.exec('BEGIN');
    try { const value = await work(connection); sqlite.exec('COMMIT'); return value; }
    catch (reason) { sqlite.exec('ROLLBACK'); throw reason; }
  } };
  await migrate(db);
  const repo = createRepository(db, { uuid: randomUUID, deviceId: randomUUID(), now: () => '2026-11-02T04:00:00.000Z', digest: async value => createHash('sha256').update(value).digest('hex') });
  await repo.setup({ displayName: 'Robb', openingBalanceMinor: 1_000_000, monthlyBudgetMinor: 100_000 });
  return { repo, close: () => sqlite.close() };
}

test('monthly performance agrees with custom dates after future expenses change date or are voided', async () => {
  const f = await fixture();
  try {
    const id = randomUUID(), now = new Date(2026, 10, 2, 12);
    const range = dateRange('month', now);
    await f.repo.saveTransaction({ id, kind: 'expense', title: 'End of month groceries', amountMinor: 12_500, date: '2026-11-29' });
    let snapshot = await f.repo.getSnapshot();
    assert.deepEqual(range, dateRange('custom', now, '2026-11-01', '2026-11-30'));
    assert.equal(periodSummary(snapshot, range.start, range.end).spentMinor, 12_500);
    assert.equal((await f.repo.queryTransactions({ ...range, kind: 'expense' })).length, 1);
    assert.equal(budgetForRange(snapshot, range.start, range.end) - periodSummary(snapshot, range.start, range.end).spentMinor, 87_500);
    await f.repo.saveTransaction({ id, kind: 'expense', title: 'December groceries', amountMinor: 15_000, date: '2026-12-01' });
    snapshot = await f.repo.getSnapshot();
    assert.equal(periodSummary(snapshot, range.start, range.end).spentMinor, 0);
    const annual = dateRange('thisYear', now);
    assert.equal(periodSummary(snapshot, annual.start, annual.end).spentMinor, 15_000);
    await f.repo.voidTransaction(id);
    snapshot = await f.repo.getSnapshot();
    assert.equal(periodSummary(snapshot, annual.start, annual.end).spentMinor, 0);
  } finally { f.close(); }
});

test('all-time ledger includes oldest and newest voided records and future transfers', async () => {
  const f = await fixture();
  try {
    const oldId = randomUUID(), futureId = randomUUID();
    await f.repo.saveTransaction({ id: oldId, kind: 'expense', title: 'Old canceled expense', amountMinor: 100, date: '2024-11-05' });
    await f.repo.voidTransaction(oldId);
    await f.repo.saveTransaction({ id: futureId, kind: 'expense', title: 'Future canceled expense', amountMinor: 100, date: '2028-02-01' });
    await f.repo.voidTransaction(futureId);
    await f.repo.saveAccount({ name: 'Bank', type: 'asset', currency: 'PHP', exchangeRate: 1, includedInBalance: true });
    let snapshot = await f.repo.getSnapshot();
    const source = snapshot.accounts.find(account => account.name === 'Cash')!, destination = snapshot.accounts.find(account => account.name === 'Bank')!;
    await f.repo.saveTransaction({ kind: 'transfer', title: 'Future bank transfer', amountMinor: 2_500, destinationAmountMinor: 2_500, accountId: source.id, destinationAccountId: destination.id, date: '2027-01-20' });
    snapshot = await f.repo.getSnapshot();
    const range = dateRange('allTime', new Date(2026, 10, 2), undefined, undefined, snapshot.transactions.filter(tx => !tx.deletedAt).map(tx => tx.date));
    assert.deepEqual(range, { start: '2024-11-05', end: '2028-02-01' });
    const rows = await f.repo.queryTransactions({ ...range, includeVoided: true });
    assert.ok(rows.some(tx => tx.id === oldId));
    assert.ok(rows.some(tx => tx.id === futureId));
    assert.ok(rows.some(tx => tx.kind === 'transfer' && tx.date === '2027-01-20'));
    assert.equal(periodSummary(snapshot, range.start, range.end).spentMinor, 0);
  } finally { f.close(); }
});

test('budget left deducts wallet conversion while income and transfers preserve spending', async () => {
  const f = await fixture();
  try {
    await f.repo.saveAccount({ name: 'USD wallet', type: 'asset', currency: 'USD', exchangeRate: 50, includedInBalance: true, openingBalanceMinor: 10_000 });
    let snapshot = await f.repo.getSnapshot();
    const usd = snapshot.accounts.find(account => account.currency === 'USD')!, cash = snapshot.accounts.find(account => account.name === 'Cash')!;
    await f.repo.saveTransaction({ kind: 'expense', title: 'Transport', amountMinor: 500, accountId: usd.id, date: '2026-11-05' });
    await f.repo.saveTransaction({ kind: 'income', title: 'Refund', amountMinor: 25_000, accountId: cash.id, date: '2026-11-05' });
    await f.repo.saveTransaction({ kind: 'transfer', title: 'Wallet transfer', amountMinor: 5_000, destinationAmountMinor: 100, accountId: cash.id, destinationAccountId: usd.id, date: '2026-11-05' });
    snapshot = await f.repo.getSnapshot();
    const { start, end } = dateRange('month', new Date(2026, 10, 2));
    const summary = periodSummary(snapshot, start, end);
    assert.equal(summary.count, 1);
    assert.equal(summary.spentMinor, 25_000);
    assert.equal(budgetForRange(snapshot, start, end) - summary.spentMinor, 75_000);
    await f.repo.setBudget(150_000, '2026-11');
    snapshot = await f.repo.getSnapshot();
    assert.equal(budgetForRange(snapshot, start, end) - periodSummary(snapshot, start, end).spentMinor, 125_000);
  } finally { f.close(); }
});

test('one-pass wallet index preserves transfer conversion, debt, removed wallets and voids', async () => {
  const f = await fixture();
  try {
    await f.repo.saveAccount({ name: 'Dollars', type: 'asset', currency: 'USD', exchangeRate: 50, includedInBalance: true, openingBalanceMinor: 10_000 });
    await f.repo.saveAccount({ name: 'Credit card', type: 'liability', currency: 'PHP', exchangeRate: 1, includedInBalance: true, openingBalanceMinor: 20_000 });
    await f.repo.saveAccount({ name: 'Old bank', type: 'asset', currency: 'PHP', exchangeRate: 1, includedInBalance: false, openingBalanceMinor: 2_000 });
    let snapshot = await f.repo.getSnapshot();
    const cash = snapshot.accounts.find(account => account.name === 'Cash')!, usd = snapshot.accounts.find(account => account.name === 'Dollars')!, card = snapshot.accounts.find(account => account.name === 'Credit card')!, old = snapshot.accounts.find(account => account.name === 'Old bank')!;
    await f.repo.saveTransaction({ kind: 'transfer', title: 'Exchange', accountId: cash.id, destinationAccountId: usd.id, amountMinor: 5_000, destinationAmountMinor: 100, date: '2026-11-02' });
    await f.repo.saveTransaction({ kind: 'transfer', title: 'Pay card', accountId: cash.id, destinationAccountId: card.id, amountMinor: 3_000, date: '2026-11-02' });
    const expenseId = randomUUID();
    await f.repo.saveTransaction({ id: expenseId, kind: 'expense', title: 'USD purchase', accountId: usd.id, amountMinor: 500, date: '2026-11-02' });
    await f.repo.deleteAccount(old.id, { mode: 'exclude' });
    snapshot = await f.repo.getSnapshot();
    const indexed = computeAccountBalances(snapshot.transactions);
    assert.equal(indexed.get(cash.id), 992_000);
    assert.equal(indexed.get(usd.id), 9_600);
    assert.equal(indexed.get(card.id), -17_000);
    assert.equal(indexed.get(old.id), 2_000);
    for (const account of snapshot.accounts) assert.equal(indexed.get(account.id) ?? 0, accountBalance(snapshot, account.id));
    assert.deepEqual(balanceSummary(snapshot), { assetsMinor: 1_472_000, liabilitiesMinor: 17_000, availableMinor: 1_455_000 });
    assert.deepEqual([...computeAccountBalances(snapshot.transactions, new Set([cash.id]))], [[cash.id, 992_000]]);
    await f.repo.voidTransaction(expenseId);
    snapshot = await f.repo.getSnapshot();
    assert.equal(computeAccountBalances(snapshot.transactions).get(usd.id), 10_100);
    assert.equal(indexed.get(usd.id), 9_600, 'previous derived balances remain unchanged after a new snapshot');
    const discarded = { ...snapshot.transactions.find(transaction => transaction.kind === 'expense')!, voidedAt: null, deletedAt: '2026-11-02T04:00:00.000Z' };
    assert.deepEqual(computeAccountBalances([...snapshot.transactions, discarded]), computeAccountBalances(snapshot.transactions));
  } finally { f.close(); }
});

test('single-pass trend buckets agree with exact spending over leap days and long ranges', async () => {
  const f = await fixture();
  try {
    for (const [index, date] of ['2024-02-01', '2024-02-03', '2024-02-04', '2024-02-29', '2024-03-01', '2024-04-30', '2026-11-30'].entries()) {
      await f.repo.saveTransaction({ kind: 'expense', title: `Expense ${index}`, amountMinor: (index + 1) * 101, date });
    }
    const voidId = randomUUID();
    await f.repo.saveTransaction({ id: voidId, kind: 'expense', title: 'Canceled leap day expense', amountMinor: 999, date: '2024-02-29' });
    await f.repo.voidTransaction(voidId);
    const snapshot = await f.repo.getSnapshot();
    for (const [start, end] of [['2024-02-01', '2024-04-30'], ['2024-02-29', '2024-02-29'], ['1900-01-01', '2200-12-31']]) {
      const buckets = dailyTrend(snapshot.transactions, start, end);
      assert.ok(buckets.length <= 31);
      buckets.forEach((bucket, index) => assert.equal(bucket.amountMinor, spending(snapshot.transactions, bucket.date, index + 1 < buckets.length ? addDays(buckets[index + 1].date, -1) : end)));
      assert.equal(buckets.reduce((total, bucket) => total + bucket.amountMinor, 0), spending(snapshot.transactions, start, end));
    }
  } finally { f.close(); }
});

test('long-range budget lookup carries historical limits forward and honors later zero limits', async () => {
  const f = await fixture();
  try {
    await f.repo.setBudget(2_901, '2024-02');
    await f.repo.setBudget(3_101, '2025-06');
    await f.repo.setBudget(0, '2026-12');
    let snapshot = await f.repo.getSnapshot();
    assert.equal(budgetForRange(snapshot, '2024-01-01', '2026-12-31'), 16 * 2_901 + 17 * 3_101 + 100_000);
    assert.equal(budgetForRange(snapshot, '2026-12-01', '2028-12-31'), 0);
    await f.repo.setBudget(3_201, '2025-06');
    snapshot = await f.repo.getSnapshot();
    assert.equal(budgetForRange(snapshot, '2024-01-01', '2026-12-31'), 16 * 2_901 + 17 * 3_201 + 100_000);
  } finally { f.close(); }
});
