import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_INTENT_SCHEMA, DEFAULT_AI_PREFERENCES, aiPreferences, buildAIContext, isQuickMessage, resolveAIIntent, validateAIMessage, type AIIntent } from '../src/core/ai';
import { routeAIInterpretation, type AIRoutingState } from '../src/core/aiRouting';
import type { Snapshot } from '../src/core/types';
import type { ChatResult } from '../src/core/chat';

const snapshot = {
  profile: { baseCurrency: 'PHP', balanceLabel: 'My money', avatarUri: 'private-image', displayName: 'Private Name' },
  accounts: [{ id: 'private-cash-id', name: 'Cash', type: 'asset', currency: 'PHP', exchangeRate: 1, includedInBalance: true, deletedAt: null }, { id: 'bank', name: 'BDO', type: 'asset', currency: 'PHP', exchangeRate: 1, includedInBalance: true, deletedAt: null }, { id: 'usd', name: 'Dollars', type: 'asset', currency: 'USD', exchangeRate: 56, includedInBalance: false, deletedAt: null }, { id: 'secret', name: 'private@example.com', type: 'asset', currency: 'PHP', exchangeRate: 1, includedInBalance: false, deletedAt: null }],
  categories: [{ id: 'food', name: 'Food', deletedAt: null }], tags: [{ id: 'work', name: 'Work', deletedAt: null }],
  transactions: [{ id: 'private-tx', kind: 'income', amountMinor: 500000, baseAmountMinor: 500000, accountId: 'private-cash-id', title: 'Private Salary', date: '2026-11-01', tagIds: [], notes: 'Secret notes', notePhotos: ['private-photo'] }, { id: 'j', kind: 'expense', amountMinor: 10000, baseAmountMinor: 10000, accountId: 'private-cash-id', title: 'Jollibee lunch', categoryId: 'food', date: '2026-11-01', tagIds: ['work'], notes: '' }, { id: 'm', kind: 'expense', amountMinor: 20000, baseAmountMinor: 20000, accountId: 'private-cash-id', title: 'McDonalds', categoryId: 'food', date: '2026-11-01', tagIds: [], notes: '' }],
} as unknown as Snapshot;
const intent: AIIntent = { action: 'transaction', kind: 'expense', amount: '128.56', currency: 'PHP', title: 'Chicken Joy', date: '2026-11-01', wallet: 'Cash', destination: '', category: 'Food', tags: ['wants', 'Work', 'work'], start: '', end: '', search: '' };
const query = (changes: Partial<AIIntent>): AIIntent => ({ ...intent, kind: 'none', amount: '', currency: '', title: '', date: '', wallet: '', destination: '', category: '', tags: [], ...changes });
const answer: ChatResult = { type: 'answer', message: 'Calculated locally' };
const state: AIRoutingState = { preferences: { ...DEFAULT_AI_PREFERENCES }, apple: { available: true, message: 'Apple is not ready.' } };

test('AI resolves a strict reviewed draft with local IDs, exact cents and deduplicated tags, without writes', () => {
  const before = JSON.stringify(snapshot), result = resolveAIIntent(JSON.stringify(intent), snapshot);
  assert.equal(result.type, 'draft'); if (result.type !== 'draft') return;
  assert.equal(result.input.amountMinor, 12856); assert.equal(result.input.accountId, 'private-cash-id'); assert.equal(result.input.categoryId, 'food');
  assert.deepEqual(result.input.tagIds, ['work']); assert.deepEqual(result.newTagNames, ['wants']);
  assert.equal(JSON.stringify(snapshot), before);
});

test('AI spending and balance answers are calculated from local records, including merchant filters', () => {
  const spending = resolveAIIntent(query({ action: 'spending', start: '2026-11-01', end: '2026-11-30', search: 'Jollibee', category: 'Food' }), snapshot);
  assert.equal(spending.type, 'answer'); assert.match(spending.message, /100\.00/); assert.doesNotMatch(spending.message, /300\.00/);
  const balance = resolveAIIntent(query({ action: 'balance' }), snapshot); assert.match(balance.message, /4,700\.00/);
  assert.throws(() => resolveAIIntent({ ...query({ action: 'balance' }), total: 99999999 }, snapshot), /unsupported or missing fields/);
});

test('AI rejects extra fields, destructive intents, invalid names, dates, precision, currency and mixed actions', () => {
  for (const invalid of [{ ...intent, action: 'delete' }, { ...intent, title: '' }, { ...intent, wallet: 'Unknown' }, { ...intent, category: 'Imaginary' }, { ...intent, amount: '0' }, { ...intent, amount: '-25' }, { ...intent, amount: '1.001' }, { ...intent, date: '2026-02-30' }, { ...intent, currency: 'USD' }, { ...intent, start: '2026-11-01' }, { ...intent, tags: ['x'.repeat(41)] }, { ...intent, secret: 'payload' }]) assert.throws(() => resolveAIIntent(invalid, snapshot));
  assert.throws(() => resolveAIIntent('```json\n{}\n```', snapshot), /valid transaction format/);
  assert.throws(() => resolveAIIntent(query({ action: 'balance', amount: '5' }), snapshot), /mixed/);
  assert.throws(() => resolveAIIntent(query({ action: 'spending', start: '2026-12-01', end: '2026-11-01' }), snapshot), /start date/);
  for (const message of ['delete lunch 25', 'please edit my expense to 30', 'reset tracker', 'burahin expenses', 'spent -25']) assert.throws(() => validateAIMessage(message));
});

test('AI transfers require two existing different wallets and the same currency', () => {
  const transfer = { ...intent, kind: 'transfer', destination: 'BDO', category: '', tags: [] };
  const result = resolveAIIntent(transfer, snapshot); assert.equal(result.type, 'draft'); if (result.type === 'draft') assert.equal(result.input.destinationAmountMinor, 12856);
  for (const destination of ['Cash', 'Dollars', 'Missing', '']) assert.throws(() => resolveAIIntent({ ...transfer, destination }, snapshot));
});

test('on-device context contains only needed labels without saved history or images', () => {
  const context = JSON.stringify(buildAIContext(snapshot, 'lunch 25 from BDO', new Date(2026, 10, 1, 12)));
  assert.match(context, /Cash|BDO|Food/); assert.doesNotMatch(context, /private-cash-id|private-tx|Private Salary|Secret notes|private-photo|private-image|Private Name|Dollars|private@example|500000/);
  assert.equal(AI_INTENT_SCHEMA.additionalProperties, false);
  assert.deepEqual(Object.keys(intent).sort(), [...AI_INTENT_SCHEMA.required].sort());
});

test('quick routing refuses unknown merchant/wallet/category filters and unsupported relative dates', () => {
  for (const message of ['How much did I spend at Jollibee this month?', 'How much did I spend on Travel this month?', 'What is my balance in Missing?', 'lunch 150 on Monday', 'coffee 70 next week', 'coffee 70 last week', 'coffee 70 last month', 'coffee 70 last year', 'rent 500 two days ago']) assert.equal(isQuickMessage(message, snapshot), false, message);
  for (const message of ['transpo 25 yesterday', 'How much did I spend this month?', 'How much did I spend on Food from Cash this month?', 'What is my balance?', 'How much did I spend #work today?']) assert.equal(isQuickMessage(message, snapshot), true, message);
  assert.equal(isQuickMessage('What is my balance in Cash, BDO?', snapshot), false);
  assert.equal(isQuickMessage('How much did I spend on Food, Bills this month?', { ...snapshot, categories: [...snapshot.categories, { ...snapshot.categories[0], id: 'bills', name: 'Bills' }] }), false);
});

test('auto uses only Apple for complex messages; basic mode never invokes a model', async () => {
  let apple = 0;
  const providers = { apple: async () => { apple++; return answer; } };
  const result = await routeAIInterpretation('expense last Friday', undefined, '', state, providers);
  assert.equal(result.engine, 'apple'); assert.equal(apple, 1);
  await assert.rejects(routeAIInterpretation('expense last Friday', undefined, '', { ...state, preferences: { mode: 'basic' } }, providers), /Nothing was saved/);
  assert.equal(apple, 1);
});

test('Apple failure reuses only a safe local draft and rejects ambiguous dates', async () => {
  const engines: string[] = [];
  const providers = { apple: async (): Promise<ChatResult> => { throw new Error('On-device request timed out.'); } };
  const basic = await routeAIInterpretation('lunch 25', answer, '', state, providers, { preferModel: true, onEngine: engine => engines.push(engine) });
  assert.equal(basic.engine, 'basic'); assert.match(basic.notice, /quick entry/); assert.deepEqual(engines, ['apple', 'basic']);
  await assert.rejects(routeAIInterpretation('lunch on Monday', answer, '', state, providers), /timed out.*\n.*Nothing was saved/s);
});

test('cancellation never starts a model and preferences expose only offline modes', async () => {
  let calls = 0; const providers = { apple: async () => { calls++; return answer; } };
  const controller = new AbortController(); controller.abort();
  await assert.rejects(routeAIInterpretation('lunch 25', answer, '', state, providers, { signal: controller.signal }), /cancelled/); assert.equal(calls, 0);
  assert.deepEqual(aiPreferences({ mode: 'basic', extra: 'obsolete' }), { mode: 'basic' });
  assert.deepEqual(aiPreferences({ mode: 'offline' }), { mode: 'basic' });
  assert.deepEqual(aiPreferences({ mode: 'unknown' }), { mode: 'auto' });
  assert.deepEqual(DEFAULT_AI_PREFERENCES, { mode: 'auto' });
});
