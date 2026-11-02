import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundResumeGate, createSnapshotRefresh } from '../src/core/snapshotRefresh';
import { notificationInputKey } from '../src/platform/notificationInputs';
import { planDailySummaries } from '../src/platform/dailySummary';
import type { Snapshot, Transaction } from '../src/core/types';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

test('foreground refresh runs after a real background visit, including the iOS inactive transition', () => {
  const resume = createBackgroundResumeGate('active');
  assert.equal(resume('inactive'), false); assert.equal(resume('active'), false);
  assert.equal(resume('inactive'), false); assert.equal(resume('background'), false);
  assert.equal(resume('inactive'), false); assert.equal(resume('active'), true);
  assert.equal(resume('active'), false);
  assert.equal(createBackgroundResumeGate('background')('active'), true);
});

test('a burst of ordinary refreshes shares one read and publishes once', async () => {
  const read = deferred<string>(), published: string[] = []; let reads = 0;
  const refresh = createSnapshotRefresh(() => { reads++; return read.promise; }, value => published.push(value));
  const requests = Array.from({ length: 20 }, () => refresh.request());
  assert.equal(reads, 1); assert.deepEqual(published, []);
  read.resolve('current'); await Promise.all(requests);
  assert.deepEqual(published, ['current']); assert.equal(reads, 1);
});

test('concurrent commits invalidate an older read and share one fresh read after both writes', async () => {
  const first = deferred<number>(), second = deferred<number>(), reads = [first, second], published: number[] = []; let count = 0;
  const refresh = createSnapshotRefresh(() => reads[count++].promise, value => published.push(value));
  const beforeCommit = refresh.request(), afterFirstCommit = refresh.request(true), afterSecondCommit = refresh.request(true);
  first.resolve(0); await tick();
  assert.deepEqual(published, []); assert.equal(count, 2);
  second.resolve(2); await Promise.all([beforeCommit, afterFirstCommit, afterSecondCommit]);
  assert.deepEqual(published, [2]); assert.equal(count, 2);
});

test('a write committing during the replacement read cannot publish stale state either', async () => {
  const reads = [deferred<number>(), deferred<number>(), deferred<number>()], published: number[] = []; let count = 0;
  const refresh = createSnapshotRefresh(() => reads[count++].promise, value => published.push(value));
  const original = refresh.request(), firstCommit = refresh.request(true);
  reads[0].resolve(0); await tick();
  const secondCommit = refresh.request(true); reads[1].resolve(1); await tick();
  assert.deepEqual(published, []); assert.equal(count, 3);
  reads[2].resolve(2); await Promise.all([original, firstCommit, secondCommit]);
  assert.deepEqual(published, [2]);
});

test('a failed old read does not fail newer committed refreshes, and a current failure is retryable', async () => {
  const reads = [deferred<number>(), deferred<number>(), deferred<number>(), deferred<number>()], published: number[] = []; let count = 0;
  const refresh = createSnapshotRefresh(() => reads[count++].promise, value => published.push(value));
  const ordinary = refresh.request(), committed = refresh.request(true);
  reads[0].reject(new Error('old read failed')); await tick();
  reads[1].resolve(1); await Promise.all([ordinary, committed]);
  const failure = assert.rejects(refresh.request(true), /current read failed/);
  reads[2].reject(new Error('current read failed')); await failure;
  assert.deepEqual(published, [1]);
  const retry = refresh.request(); reads[3].resolve(2); await retry;
  assert.deepEqual(published, [1, 2]);
});

test('closing a refresh controller rejects pending work and never publishes its late result', async () => {
  const read = deferred<number>(), published: number[] = [];
  const refresh = createSnapshotRefresh(() => read.promise, value => published.push(value));
  const cancelled = assert.rejects(refresh.request(true), /closed/);
  refresh.dispose(); await cancelled;
  read.resolve(1); await tick();
  await assert.rejects(refresh.request(), /closed/); assert.deepEqual(published, []);
});

test('effect cleanup followed by a new setup accepts fresh requests without reviving old reads', async () => {
  const oldRead = deferred<number>(), newRead = deferred<number>(), published: number[] = [];
  let active = createSnapshotRefresh(() => oldRead.promise, value => published.push(value));
  const closed = assert.rejects(active.request(), /closed/);
  active.dispose(); await closed;
  active = createSnapshotRefresh(() => newRead.promise, value => published.push(value));
  const current = active.request(true); newRead.resolve(2); await current;
  oldRead.resolve(1); await tick();
  assert.deepEqual(published, [2]);
});

const now = new Date(2026, 10, 2, 12);
function snapshot(): Snapshot {
  return {
    profile: { notificationsEnabled: true, dailySummaryEnabled: true, notificationSound: 'default', baseCurrency: 'PHP', performanceThresholds: [.25, .5, .75, 1, 1.25] },
    reminders: [{ id: 'bill', updatedAt: '2026-11-02T01:00:00Z', deletedAt: null, status: 'active', title: 'Phone bill', dueAt: new Date(2026, 10, 3, 9).toISOString(), recurrence: 'monthly', monthlyDay: 3 }],
    budgets: [{ month: '2026-11', amountMinor: 300_000, deletedAt: null }],
    transactions: [
      { kind: 'expense', date: '2026-11-02', amountMinor: 2500, baseAmountMinor: 2500, voidedAt: null, deletedAt: null, notePhotos: [] },
      { kind: 'expense', date: '2026-11-01', amountMinor: 3000, baseAmountMinor: 3000, voidedAt: null, deletedAt: null },
      { kind: 'transfer', date: '2026-11-02', amountMinor: 9000, baseAmountMinor: 9000, voidedAt: null, deletedAt: null },
    ], accounts: [], categories: [], tags: [], goals: [], contributions: [], auditLogs: [],
  } as unknown as Snapshot;
}

test('notification dedupe ignores changes that cannot affect alerts, including photo and history payloads', () => {
  const original = snapshot(), changed = structuredClone(original), key = notificationInputKey(original, now);
  changed.profile!.displayName = 'New name'; changed.profile!.appearance = 'dark'; changed.profile!.avatarUri = 'data:image/jpeg;base64,YWJjZA==';
  changed.transactions[0].title = 'Renamed lunch'; changed.transactions[0].notePhotos = ['data:image/jpeg;base64,YWJjZA=='];
  changed.transactions.push({...changed.transactions[1],date:'2026-10-31',amountMinor:4000,baseAmountMinor:4000});
  changed.transactions[2].amountMinor = 9999;
  assert.equal(notificationInputKey(changed, now), key);
});

test('notification dedupe reacts to financial, reminder, sound, calendar and budget changes', () => {
  const original = snapshot(), key = notificationInputKey(original, now);
  const changes: ((value: Snapshot) => void)[] = [
    value => { value.transactions[0].baseAmountMinor = 3000; },
    value => { value.transactions[1].baseAmountMinor = 4000; },
    value => { value.transactions[0].voidedAt = '2026-11-02T12:00:00Z'; },
    value => { value.transactions[0].date = '2026-11-03'; },
    value => { value.budgets[0].amountMinor = 400_000; },
    value => { value.reminders[0].dueAt = new Date(2026, 10, 5, 9).toISOString(); },
    value => { value.profile!.notificationSound = 'none'; },
    value => { value.profile!.notificationsEnabled = false; },
    value => { value.profile!.dailySummaryEnabled = false; },
    value => { value.profile!.baseCurrency = 'USD'; },
    value => { value.profile!.performanceThresholds = [.2, .4, .6, .8, 1]; },
  ];
  for (const change of changes) { const changed = structuredClone(original); change(changed); assert.notEqual(notificationInputKey(changed, now), key); }
  assert.notEqual(notificationInputKey(original, new Date(now.getTime() + 60_000)), key);
});

test('disabled summaries never inspect ledger or budget payloads to decide whether to schedule', () => {
  const value = snapshot(); value.profile!.dailySummaryEnabled = false;
  Object.defineProperty(value, 'transactions', { get() { throw new Error('Ledger should not be read.'); } });
  Object.defineProperty(value, 'budgets', { get() { throw new Error('Budgets should not be read.'); } });
  assert.doesNotThrow(() => notificationInputKey(value, now));
  value.profile!.notificationsEnabled = false;
  Object.defineProperty(value, 'reminders', { get() { throw new Error('Reminders should not be read.'); } });
  assert.doesNotThrow(() => notificationInputKey(value, now));
});

test('28 daily summaries inspect each ledger entry once while keeping exact totals and counts', () => {
  const value = snapshot(); let inspections = 0;
  value.transactions = Array.from({ length: 560 }, (_, index) => ({
    get kind() { inspections++; return 'expense' as const; },
    date: `2026-11-${String(2 + index % 28).padStart(2, '0')}`, amountMinor: 100, baseAmountMinor: 100, voidedAt: null, deletedAt: null,
  } as Transaction));
  const plan = planDailySummaries(value, now);
  assert.equal(plan.length, 28);
  assert.equal(plan.reduce((sum, item) => sum + item.count, 0), 560);
  assert.equal(plan.reduce((sum, item) => sum + item.totalMinor, 0), 56_000);
  assert.ok(inspections <= value.transactions.length * 2, `Expected linear ledger work; observed ${inspections} inspections.`);
});
