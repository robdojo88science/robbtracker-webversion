import assert from 'node:assert/strict';
import test from 'node:test';
import { planNotifications } from '../src/platform/notificationSchedule';
import { csvCell, transactionsCsv } from '../src/platform/csv';
import type { Reminder, Snapshot } from '../src/core/types';


const reminder = (changes: Partial<Reminder> = {}): Reminder => ({
  id: 'test', ownerId: null, deviceId: 'device', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null, syncStatus: 'synced', serverVersion: 0, title: 'Private bill', dueAt: new Date(2026, 0, 31, 9).toISOString(),
  recurrence: 'monthly', monthlyDay: 31, goalId: null, status: 'active', ...changes,
});

test('monthly notifications clamp short months without drifting away from day 31', () => {
  const plan = planNotifications([reminder()], new Date(2026, 0, 30), 3);
  assert.deepEqual(plan.notifications.map(event => [event.date.getMonth(), event.date.getDate(), event.date.getHours()]), [[0, 31, 9], [1, 28, 9], [2, 31, 9]]);
  assert.equal(plan.truncated, true);
});

test('old recurring reminders skip past events and paused/deleted definitions are omitted', () => {
  const plan = planNotifications([reminder(), reminder({ id: 'dismissed', status: 'dismissed' }), reminder({ id: 'deleted', deletedAt: '2026-02-01T00:00:00.000Z' })], new Date(2028, 1, 28, 10), 2);
  assert.deepEqual(plan.notifications.map(event => [event.date.getFullYear(), event.date.getMonth(), event.date.getDate()]), [[2028, 1, 29], [2028, 2, 31]]);
});

test('completed February payment retains the original preferred monthly day', () => {
  const definition = reminder({ dueAt: new Date(2026, 1, 28, 9).toISOString(), monthlyDay: 31 });
  const plan = planNotifications([definition], new Date(2026, 2, 1), 2);
  assert.deepEqual(plan.notifications.map(event => [event.date.getMonth(), event.date.getDate()]), [[2, 31], [3, 30]]);
});

test('a snoozed monthly reminder honors its saved first date before returning to its preferred day', () => {
  const definition = reminder({ dueAt: new Date(2026, 0, 16, 9).toISOString(), monthlyDay: 15 });
  const plan = planNotifications([definition], new Date(2026, 0, 14), 2);
  assert.deepEqual(plan.notifications.map(event => [event.date.getMonth(), event.date.getDate(), event.date.getHours()]), [[0, 16, 9], [1, 15, 9]]);
});

test('cross-month snooze includes the upcoming preferred day in the snoozed month', () => {
  const definition = reminder({ dueAt: new Date(2026, 1, 1, 9).toISOString(), monthlyDay: 31 });
  const plan = planNotifications([definition], new Date(2026, 0, 31), 3);
  assert.deepEqual(plan.notifications.map(event => [event.date.getMonth(), event.date.getDate()]), [[1, 1], [1, 28], [2, 31]]);
  const reopened = planNotifications([definition], new Date(2028, 1, 28, 10), 2);
  assert.deepEqual(reopened.notifications.map(event => [event.date.getFullYear(), event.date.getMonth(), event.date.getDate()]), [[2028, 1, 29], [2028, 2, 31]]);
});

test('a clamped February month-end occurrence advances directly to March', () => {
  const definition = reminder({ dueAt: new Date(2026, 1, 28, 9).toISOString(), monthlyDay: 31 });
  const plan = planNotifications([definition], new Date(2026, 1, 27), 2);
  assert.deepEqual(plan.notifications.map(event => [event.date.getMonth(), event.date.getDate()]), [[1, 28], [2, 31]]);
});

test('one-off overdue reminders are kept in SQLite but never scheduled for the past', () => {
  assert.equal(planNotifications([reminder({ recurrence: 'none' })], new Date(2026, 1, 1)).notifications.length, 0);
});

test('notification reconciliation plan is stable and selects earliest 60 across all reminders', () => {
  const definitions = [reminder({ id: 'daily', recurrence: 'daily' }), reminder({ id: 'other', recurrence: 'daily' })];
  const a = planNotifications(definitions, new Date(2026, 0, 30));
  const b = planNotifications(definitions, new Date(2026, 0, 30));
  assert.deepEqual(a, b);
  assert.equal(a.notifications.length, 60);
  assert.equal(new Set(a.notifications.map(event => event.identifier)).size, 60);
});

test('CSV quotes newlines and quotes, blocks formulas including leading spaces', () => {
  assert.equal(csvCell('rice,"bread"\nfood'), '"rice,""bread""\nfood"');
  assert.equal(csvCell(' \t=1+1'), '"\' \t=1+1"');
  assert.equal(csvCell('@SUM(A1)'), '"\'@SUM(A1)"');
  assert.equal(csvCell('-123.45'), '"-123.45"');
});

test('CSV retains voided history with zero balance effect', () => {
  const snapshot = { transactions: [{ id: 'entry', date: '2026-01-01', kind: 'expense', title: '=evil', amountMinor: 12345,
    categoryId: null, notes: 'memo', voidedAt: '2026-01-02', deletedAt: null, createdAt: '2026-01-01', updatedAt: '2026-01-02' }], categories: [] } as unknown as Snapshot;
  const csv = transactionsCsv(snapshot);
  assert.ok(csv.startsWith('\uFEFF"ID"'));
  assert.ok(csv.includes('"\'=evil"'));
  assert.ok(csv.includes('"123.45","0.00"'));
  assert.ok(csv.includes('"voided"'));
});
