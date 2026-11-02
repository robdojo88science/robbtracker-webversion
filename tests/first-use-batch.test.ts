import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { formatAmountInput, parseMoney } from '../src/core/money';
import { shouldOfferWelcomeTour } from '../src/core/firstUse';
import { interpretChatBatch, splitChatBatch } from '../src/core/chat';
import { createOfflineAIService } from '../src/core/offlineAI';
import { createRepository } from '../src/data/repository';
import { migrate } from '../src/data/migrations';
import { summaryForDay } from '../src/platform/dailySummary';
import { budgetForMonth, periodSummary, spendingPerformance } from '../src/core/analytics';
import type { Database, SqlConnection, SqlValue } from '../src/core/database';
import type { Snapshot } from '../src/core/types';

const now = new Date(2026, 10, 5, 12);
async function fixture() {
  const sql = new DatabaseSync(':memory:');
  const connection: SqlConnection = {
    exec: async statement => { sql.exec(statement); },
    run: async (statement, parameters: SqlValue[] = []) => ({ changes: Number(sql.prepare(statement).run(...parameters).changes) }),
    all: async <T>(statement: string, parameters: SqlValue[] = []) => sql.prepare(statement).all(...parameters) as T[],
    first: async <T>(statement: string, parameters: SqlValue[] = []) => sql.prepare(statement).get(...parameters) as T ?? null,
  };
  const db: Database = { ...connection, transaction: async <T>(work: (tx: SqlConnection) => Promise<T>) => { sql.exec('BEGIN'); try { const value = await work(connection); sql.exec('COMMIT'); return value; } catch (error) { sql.exec('ROLLBACK'); throw error; } } };
  await migrate(db);
  const repo = createRepository(db, { uuid: randomUUID, deviceId: randomUUID(), now: () => now.toISOString(), digest: async value => createHash('sha256').update(value).digest('hex') });
  await repo.setup({ displayName: 'First Name', openingBalanceMinor: 1_000_000, monthlyBudgetMinor: 100_000 });
  return { repo, close: () => sql.close() };
}

test('editable amounts group thousands without rounding or changing minor units', () => {
  for (const [raw, expected] of [['1', '1'], ['100', '100'], ['1000', '1,000'], ['123456789.90', '123,456,789.90'], ['1,234,567.80', '1,234,567.80'], ['1000.', '1,000.'], ['0.001', '0.001'], ['', '']]) assert.equal(formatAmountInput(raw), expected);
  assert.equal(parseMoney(formatAmountInput('1234567.89')), 123456789);
  assert.throws(() => parseMoney(formatAmountInput('1000.001')), /decimal/);
  assert.equal(formatAmountInput('invalid'), 'invalid');
});

test('automatic tips are eligible only on creation day and before the first offer', () => {
  const profile = { createdAt: now.toISOString(), tutorialCompleted: false };
  assert.equal(shouldOfferWelcomeTour(profile, now), true);
  assert.equal(shouldOfferWelcomeTour({ ...profile, tutorialCompleted: true }, now), false);
  assert.equal(shouldOfferWelcomeTour(profile, new Date(2026, 10, 6, 0)), false);
  assert.equal(shouldOfferWelcomeTour({ ...profile, createdAt: 'bad date' }, now), false);
});

test('offline batches preserve grouped money and named-date commas and reject a bad clause', async () => {
  const f = await fixture(); try {
    const snapshot = await f.repo.getSnapshot(), unchanged = JSON.stringify(snapshot);
    for (const message of ['transpo 25 today; lunch 80 yesterday', 'transpo 25 today, lunch 80 yesterday']) {
      const result = interpretChatBatch(message, snapshot, now);
      assert.equal(result.type, 'batch'); if (result.type !== 'batch') continue;
      assert.deepEqual(result.drafts.map(draft => [draft.input.amountMinor, draft.input.date]), [[2500, '2026-11-05'], [8000, '2026-11-04']]);
    }
    const result = interpretChatBatch('add salary 1,000 Nov5,2024; coffee 80 today', snapshot, now);
    assert.equal(result.type, 'batch'); if (result.type === 'batch') assert.deepEqual(result.drafts.map(draft => [draft.input.amountMinor, draft.input.date]), [[100000, '2024-11-05'], [8000, '2026-11-05']]);
    assert.throws(() => interpretChatBatch('transpo 25; lunch invalid', snapshot, now), /Entry 2/);
    assert.equal(splitChatBatch('lunch, coffee 80', snapshot, now).length, 1);
    assert.equal(JSON.stringify(await f.repo.getSnapshot()), unchanged);
    let nativeCalls = 0;
    const service = createOfflineAIService({ preferences: { read: async () => { nativeCalls++; return null; }, write: async () => {}, remove: async () => {} }, apple: { availability: async () => { nativeCalls++; return { available: false, code: 'none', message: 'none' }; }, generate: async () => { throw new Error('must stay local'); }, cancel: async () => {} }, cleanupLegacy: async () => {}, now: () => now });
    assert.equal((await service.interpretOfflineBatch('transpo 25; lunch 80', snapshot)).result.type, 'batch');
    assert.equal(nativeCalls, 0);
    snapshot.accounts[0].name='Cash, Daily';
    assert.equal(interpretChatBatch('salary 1,000 to Cash, Daily today; lunch 80 from Cash, Daily today',snapshot,now).type,'batch');
  } finally { f.close(); }
});

test('reviewed batch transactions and new tags commit together or all roll back', async () => {
  const f = await fixture(); try {
    const before = await f.repo.getSnapshot(), tagId = randomUUID();
    const inputs = [{ id: randomUUID(), kind: 'expense' as const, title: 'Bus', date: '2026-11-05', amountMinor: 2500, tagIds: [tagId] }, { id: randomUUID(), kind: 'expense' as const, title: 'Lunch', date: '2026-02-30', amountMinor: 8000, tagIds: [tagId] }];
    await assert.rejects(f.repo.importTransactions(inputs, [{ id: tagId, name: 'Commute' }]), /Row 3/);
    assert.deepEqual(await f.repo.getSnapshot(), before);
    inputs[1].date = '2026-11-05';
    await f.repo.importTransactions(inputs, [{ id: tagId, name: 'Commute' }]);
    const after = await f.repo.getSnapshot();
    assert.equal(after.tags.filter(tag => tag.id === tagId).length, 1);
    assert.equal(after.transactions.filter(transaction => inputs.some(input => input.id === transaction.id)).length, 2);
    assert.equal(after.transactions.find(transaction => transaction.id === inputs[1].id)?.tagIds[0], tagId);
    await f.repo.importTransactions(inputs, [{ id: tagId, name: 'Commute' }]);
    assert.equal((await f.repo.getSnapshot()).transactions.length, after.transactions.length);
  } finally { f.close(); }
});

test('daily notification ratings match the monthly performance ratio after future, converted and reversed expenses', async () => {
  const f = await fixture(); try {
    const foreignId = randomUUID(), futureId = randomUUID();
    await f.repo.saveAccount({ id: foreignId, name: 'Dollars', currency: 'USD', exchangeRate: 50, includedInBalance: true, type: 'asset', openingBalanceMinor: 10000 });
    await f.repo.saveTransaction({ kind: 'expense', title: 'Lunch', amountMinor: 10000, date: '2026-11-05' });
    await f.repo.saveTransaction({ id: futureId, kind: 'expense', title: 'Travel', amountMinor: 500, accountId: foreignId, date: '2026-11-25' });
    const check = (snapshot: Snapshot) => {
      const summary = summaryForDay(snapshot, '2026-11-05'), monthly = periodSummary(snapshot, '2026-11-01', '2026-11-30'), expected = spendingPerformance(monthly.spentMinor, budgetForMonth(snapshot, '2026-11'), snapshot.profile!.performanceThresholds);
      assert.equal(summary.totalMinor, 10000); assert.equal(summary.monthSpentMinor, monthly.spentMinor);
      assert.equal(summary.ratio, expected.ratio); assert.equal(summary.level, expected.index); assert.equal(summary.percent, expected.percent); assert.match(summary.body, /Today:/);
    };
    check(await f.repo.getSnapshot()); await f.repo.voidTransaction(futureId); check(await f.repo.getSnapshot());
  } finally { f.close(); }
});
