import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { createActionPinService, normalizeRecoveryAnswer, PIN_ITERATIONS, type RecoveryAnswer } from '../src/core/actionPin';
import { CommittedResetError, protectRepository } from '../src/core/protectedRepository';
import type { FinanceRepository, Snapshot, TransactionInput } from '../src/core/types';

const recovery: RecoveryAnswer[] = [{ questionId: 'first-school', answer: '  SAN   José Academy ' }, { questionId: 'first-pet', answer: ' Ｍｉｌｏ ' }];
function securityFixture() {
  let stored: string | null = null, clock = 10_000, unavailable = false, writeFailure = false;
  const deps = { storageAvailable: async () => !unavailable, read: async () => stored, write: async (value: string) => { if (writeFailure) throw new Error('storage write failed'); stored = value; }, remove: async () => { stored = null; }, randomBytes: async (length: number) => new Uint8Array(randomBytes(length)), now: () => clock };
  return { service: createActionPinService(deps), recreate: () => createActionPinService(deps), read: () => stored, corrupt: (value: string) => { stored = value; }, advance: (milliseconds: number) => { clock += milliseconds; }, unavailable: () => { unavailable = true; }, failWrites: () => { writeFailure = true; } };
}

test('recovery normalization handles compatibility characters, case and whitespace', () => {
  assert.equal(normalizeRecoveryAnswer('  ＳＡＮ\t José\nAcademy  '), 'san josé academy');
  assert.equal(normalizeRecoveryAnswer('Ｍｉｌｏ'), 'milo');
});

test('PIN and both recovery answers use separate salted PBKDF2 hashes and stay absent from stored plaintext', async () => {
  const f = securityFixture(); await f.service.setup('4829', recovery); const raw = f.read()!, record = JSON.parse(raw);
  assert.equal(record.algorithm, 'pbkdf2-sha256'); assert.equal(record.iterations, PIN_ITERATIONS);
  assert.equal(record.pin.hash, pbkdf2Sync('4829', Buffer.from(record.pin.salt, 'hex'), PIN_ITERATIONS, 32, 'sha256').toString('hex'));
  for (let i = 0; i < 2; i++) assert.equal(record.recovery[i].hash, pbkdf2Sync(normalizeRecoveryAnswer(recovery[i].answer), Buffer.from(record.recovery[i].salt, 'hex'), PIN_ITERATIONS, 32, 'sha256').toString('hex'));
  assert.equal(new Set([record.pin.salt, ...record.recovery.map((item: { salt: string }) => item.salt)]).size, 3);
  for (const secret of ['4829', 'san josé academy', 'milo']) assert.ok(!raw.toLowerCase().includes(secret));
  assert.equal((await f.service.getState()).hasPin, true); assert.equal(await f.service.verifyPin('4829'), true);
  await assert.rejects(f.service.setup('9999', recovery), /already exists/);
});

test('wrong PIN attempts and shared recovery lockout persist across service recreation', async () => {
  const f = securityFixture(); await f.service.setup('4829', recovery);
  for (let i = 0; i < 5; i++) assert.equal(await f.recreate().verifyPin('1111'), false);
  const locked = await f.recreate().getState(); assert.equal(locked.lockedUntil, 40_000); assert.equal(JSON.parse(f.read()!).failedAttempts, 5);
  await assert.rejects(f.recreate().verifyPin('4829'), /Too many attempts/);
  await assert.rejects(f.recreate().recoverPin(recovery, '1234'), /Too many attempts/);
  f.advance(30_001); assert.equal(await f.recreate().verifyPin('1111'), false); assert.equal(JSON.parse(f.read()!).failedAttempts, 6); assert.equal((await f.service.getState()).lockedUntil, 100_001);
  f.advance(60_001); assert.equal(await f.service.verifyPin('4829'), true); assert.equal(JSON.parse(f.read()!).failedAttempts, 0); assert.equal((await f.service.getState()).lockedUntil, 0);
});

test('either correct recovery answer resets to four digits and wrong or malformed attempts cannot bypass recovery', async () => {
  const f=securityFixture();await f.service.setup('4829',recovery);
  await assert.rejects(f.service.recoverPin([{questionId:'first-school',answer:'wrong'},{questionId:'first-pet',answer:'wrong'}],'9264'),/Neither/);
  assert.equal(JSON.parse(f.read()!).failedAttempts,1);
  await assert.rejects(f.service.recoverPin([{questionId:'first-school',answer:''},{questionId:'first-pet',answer:'  '}],'9264'),/at least one/);
  await assert.rejects(f.service.recoverPin([{questionId:'first-pet',answer:'milo'},{questionId:'birth-city',answer:'anything'}],'9264'),/saved/);
  await f.service.recoverPin([{questionId:'first-school',answer:'?'},{questionId:'first-pet',answer:'MILO'}],'9264');
  assert.equal(await f.service.verifyPin('4829'),false);assert.equal(await f.service.verifyPin('9264'),true);
  await f.service.recoverPin([{questionId:'first-pet',answer:'milo'}],'1234');
  assert.equal(await f.service.verifyPin('1234'),true);assert.equal((await f.service.getState()).pinLength,4);
  assert.deepEqual((await f.service.getState()).questionIds,['first-school','first-pet']);
});

test('PIN changes and recovery management require the current PIN; malformed configuration cannot replace it', async () => {
  const f = securityFixture(); await f.service.setup('4829', recovery);
  await assert.rejects(f.service.changePin('1111', '9264'), /current PIN/);
  await assert.rejects(f.service.updateRecovery('1111', recovery), /current PIN/);
  await assert.rejects(f.service.changePin('4829', '12345'), /exactly 4/);
  await assert.rejects(f.service.updateRecovery('4829', [recovery[0], recovery[0]]), /different/);
  const next = [{ questionId: 'first-school', answer: 'New School' }, { questionId: 'birth-city', answer: 'Manila' }];
  await f.service.updateRecovery('4829', next); assert.deepEqual((await f.service.getState()).questionIds, ['first-school', 'birth-city']);
  await f.service.changePin('4829', '9264'); assert.equal(await f.service.verifyPin('9264'), true);
});

test('secure-storage errors and corrupt state deny authorization rather than silently resetting security', async () => {
  const unavailable = securityFixture(); unavailable.unavailable(); await assert.rejects(unavailable.service.setup('4829', recovery), /unavailable/);
  const corrupt = securityFixture(); corrupt.corrupt('{broken'); await assert.rejects(corrupt.service.getState(), /could not be read/); await assert.rejects(corrupt.service.setup('4829', recovery));
  const f = securityFixture(); await f.service.setup('4829', recovery); const before = f.read(); f.failWrites(); await assert.rejects(f.service.verifyPin('4829'), /storage write failed/); assert.equal(f.read(), before);
});

test('legacy six-digit credentials keep working and change safely to a four-digit PIN', async () => {
  const f = securityFixture();
  const secret = (value: string) => { const salt = randomBytes(32).toString('hex'); return { salt, hash: pbkdf2Sync(value, Buffer.from(salt, 'hex'), PIN_ITERATIONS, 32, 'sha256').toString('hex') }; };
  f.corrupt(JSON.stringify({ version: 1, algorithm: 'pbkdf2-sha256', iterations: PIN_ITERATIONS, pin: secret('482915'), recovery: recovery.map(item => ({ questionId: item.questionId, ...secret(normalizeRecoveryAnswer(item.answer)) })), failedAttempts: 0, lockedUntil: 0 }));
  assert.equal((await f.service.getState()).pinLength, 6);
  assert.equal(await f.service.verifyPin('4829'), false);
  assert.equal(await f.service.verifyPin('482915'), true);
  await f.service.changePin('482915', '9264');
  assert.equal(JSON.parse(f.read()!).version, 2);
  assert.equal((await f.service.getState()).pinLength, 4);
  assert.equal(await f.service.verifyPin('9264'), true);
  assert.equal(await f.service.verifyPin('482915'), false);
});

function guardFixture() {
  const snapshot = { profile: { id: 'profile' }, transactions: [{ id: 'existing-transaction' }], accounts: [{ id: 'existing-wallet' }], categories: [{ id: 'existing-category' }], tags: [{ id: 'existing-tag' }], goals: [{ id: 'existing-goal' }], reminders: [{ id: 'existing-reminder' }], contributions: [], budgets: [], auditLogs: [] } as unknown as Snapshot;
  const writes: string[] = [], prompts: string[] = []; let denied = false, resetFailure = false, cleared = 0;
  const raw = { getSnapshot: async () => structuredClone(snapshot), queryTransactions: async () => [], createBackup: async () => ({ data: structuredClone(snapshot) }) } as unknown as FinanceRepository;
  for (const name of ['setup','saveAccount','deleteAccount','saveCategory','deleteCategory','saveTag','deleteTag','voidTransaction','setBudget','saveGoal','setGoalStatus','contribute','saveReminder','actReminder','updateProfile','logSystem','restoreBackup','clearAllData'] as const) {
    (raw as unknown as Record<string, unknown>)[name] = async () => { if (name === 'clearAllData' && resetFailure) throw new Error('database reset failed'); writes.push(name); };
  }
  raw.saveTransaction = async input => { writes.push('saveTransaction'); if (input.id && !snapshot.transactions.some(item => item.id === input.id)) snapshot.transactions.push({ id: input.id } as any); };
  raw.importTransactions = async inputs => { writes.push('importTransactions'); for (const input of inputs) if (input.id && !snapshot.transactions.some(item => item.id === input.id)) snapshot.transactions.push({ id: input.id } as any); };
  const repo = protectRepository(raw, async reason => { prompts.push(reason); if (denied) throw new Error('PIN denied'); }, async () => { cleared++; });
  return { repo, snapshot, prompts, writes, cleared: () => cleared, deny: () => { denied = true; }, failReset: () => { resetFailure = true; } };
}
const transaction: TransactionInput = { id: 'new-transaction', kind: 'expense', amountMinor: 100, date: '2026-11-01', title: 'Lunch' };

test('opening, reading, ordinary preferences and all new-record paths remain PIN-free even with preallocated IDs', async () => {
  const f = guardFixture(); assert.deepEqual(f.prompts, []);
  await f.repo.getSnapshot(); await f.repo.queryTransactions({}); await f.repo.createBackup();
  await f.repo.setup({ displayName: 'Robb', openingBalanceMinor: 0, monthlyBudgetMinor: 0 });
  await f.repo.saveTransaction(transaction); await f.repo.importTransactions([{ ...transaction, id: 'imported-new' }]);
  await f.repo.saveAccount({ id: 'new-wallet', name: 'BDO', type: 'asset', currency: 'PHP', exchangeRate: 1, includedInBalance: true });
  await f.repo.saveCategory({ id: 'new-category', name: 'Food' }); await f.repo.saveTag({ id: 'new-tag', name: 'Wants' });
  await f.repo.saveGoal({ id: 'new-goal', name: 'Travel', targetMinor: 100, durationMonths: 1, startDate: '2026-11-01', paymentDay: 1 });
  await f.repo.contribute({ goalId: 'existing-goal', amountMinor: 100, date: '2026-11-01' });
  await f.repo.saveReminder({ id: 'new-reminder', title: 'Bill', dueAt: '2026-11-01T12:00:00Z', recurrence: 'none' });
  await f.repo.actReminder('existing-reminder', 'complete'); await f.repo.actReminder('existing-reminder', 'snooze', '2026-11-02T12:00:00Z');
  await f.repo.updateProfile({ displayName: 'Robert', appearance: 'dark', notificationsEnabled: true, homeShortcuts: ['chat'], avatarUri: null });
  await f.repo.logSystem('backup_exported'); f.snapshot.profile = null; await f.repo.restoreBackup({}, true);
  assert.deepEqual(f.prompts, []);
});

test('each edit, void, deletion, important setting, destructive status and replacement authorizes its own mutation', async () => {
  const f = guardFixture(); const calls: (() => Promise<unknown>)[] = [
    () => f.repo.saveTransaction({ ...transaction, id: 'existing-transaction' }), () => f.repo.importTransactions([{ ...transaction, id: 'existing-transaction' }]),
    () => f.repo.voidTransaction('existing-transaction'), () => f.repo.saveAccount({ id: 'existing-wallet', name: 'Cash', type: 'asset', currency: 'PHP', exchangeRate: 1, includedInBalance: true }), () => f.repo.deleteAccount('existing-wallet'),
    () => f.repo.saveCategory({ id: 'existing-category', name: 'Renamed' }), () => f.repo.deleteCategory('existing-category'), () => f.repo.saveTag({ id: 'existing-tag', name: 'Renamed' }), () => f.repo.deleteTag('existing-tag'),
    () => f.repo.saveGoal({ id: 'existing-goal', name: 'Edited', targetMinor: 100, durationMonths: 1, startDate: '2026-11-01', paymentDay: 1 }), () => f.repo.setGoalStatus('existing-goal', 'archived'),
    () => f.repo.saveReminder({ id: 'existing-reminder', title: 'Changed', dueAt: '2026-11-01T12:00:00Z', recurrence: 'none' }), () => f.repo.actReminder('existing-reminder', 'dismiss'),
    () => f.repo.setBudget(100, '2026-11'), () => f.repo.updateProfile({ performanceThresholds: [.25,.5,.75,1,1.25] }), () => f.repo.updateProfile({ baseCurrency: 'USD' }), () => f.repo.restoreBackup({}, true), () => f.repo.clearAllData(),
  ];
  for (let i = 0; i < calls.length; i++) { await calls[i](); assert.equal(f.prompts.length, i + 1); assert.equal(f.writes.length, i + 1); }
  assert.equal(f.cleared(), 1);
});

test('denied authorization stops raw mutations and an import cannot bypass an existing-record guard', async () => {
  const f = guardFixture(); f.deny(); await assert.rejects(f.repo.importTransactions([transaction, { ...transaction, id: 'existing-transaction' }]), /PIN denied/); await assert.rejects(f.repo.voidTransaction('existing-transaction'), /PIN denied/); await assert.rejects(f.repo.clearAllData(), /PIN denied/); assert.deepEqual(f.writes, []); assert.equal(f.cleared(), 0);
});

test('concurrent adds reusing an ID cannot turn the second call into a PIN-free edit', async () => {
  const f = guardFixture(); f.deny(); const results = await Promise.allSettled([f.repo.saveTransaction(transaction), f.repo.saveTransaction({ ...transaction, amountMinor: 200 })]); assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected'); assert.deepEqual(f.writes, ['saveTransaction']); assert.equal(f.prompts.length, 1);
});

test('credentials clear only after a successful tracker reset', async () => {
  const failed = guardFixture(); failed.failReset(); await assert.rejects(failed.repo.clearAllData(), /database reset failed/); assert.equal(failed.cleared(), 0);
  const succeeded = guardFixture(); await succeeded.repo.clearAllData(); assert.equal(succeeded.cleared(), 1);
});

test('a secure cleanup failure reports that financial reset already committed', async () => {
  let reset = false;
  const raw = { clearAllData: async () => { reset = true; } } as FinanceRepository;
  const repo = protectRepository(raw, async () => {}, async () => { throw new Error('keychain unavailable'); });
  await assert.rejects(repo.clearAllData(), error => error instanceof CommittedResetError && error.financialResetCommitted && /records were reset/.test(error.message)); assert.equal(reset, true);
});
