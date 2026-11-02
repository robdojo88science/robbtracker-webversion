import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOfflineAIService, type OfflineAIDependencies } from '../src/core/offlineAI';
import type { Snapshot } from '../src/core/types';

const snapshot = {
  profile: { baseCurrency: 'PHP' },
  accounts: [{ id: 'cash', name: 'Cash', type: 'asset', currency: 'PHP', exchangeRate: 1, includedInBalance: true, deletedAt: null }],
  categories: [{ id: 'transport', name: 'Transport', deletedAt: null }, { id: 'food', name: 'Food', deletedAt: null }],
  tags: [], transactions: [],
} as unknown as Snapshot;
const validIntent = { action: 'transaction', kind: 'expense', amount: '150', currency: 'PHP', title: 'Lunch', date: '2026-11-02', wallet: 'Cash', destination: '', category: 'Food', tags: [], start: '', end: '', search: '' };
function fixture(options: { mode?: string; modelTimeoutMs?: number; statusTimeoutMs?: number } = {}) {
  const calls = { read: 0, write: [] as string[], remove: 0, availability: 0, generate: 0, cancel: 0, cleanup: 0, prompt: '' };
  const behavior = {
    read: async (): Promise<string | null> => options.mode ? JSON.stringify({ mode: options.mode }) : null,
    generate: async (): Promise<string> => JSON.stringify(validIntent),
    cleanup: async (): Promise<void> => {},
    available: true,
  };
  const dependencies: OfflineAIDependencies = {
    preferences: {
      read: async () => { calls.read++; return behavior.read(); },
      write: async value => { calls.write.push(value); },
      remove: async () => { calls.remove++; },
    },
    apple: {
      availability: async () => { calls.availability++; return { available: behavior.available, code: 'test', message: 'Apple AI is not available.' }; },
      generate: async prompt => { calls.generate++; calls.prompt = prompt; return behavior.generate(); },
      cancel: async () => { calls.cancel++; },
    },
    cleanupLegacy: async () => { calls.cleanup++; await behavior.cleanup(); },
    now: () => new Date(2026, 10, 5, 12),
    modelTimeoutMs: options.modelTimeoutMs ?? 100,
    statusTimeoutMs: options.statusTimeoutMs ?? 50,
  };
  return { service: createOfflineAIService(dependencies), calls, behavior };
}

test('common offline messages return immediately without storage, model status or native work', async () => {
  const { service, calls } = fixture();
  const before = JSON.stringify(snapshot);
  for (const message of ['transpo 25 today', 'tranpo 25 yesterdy', 'transpo 25 Nov5,2024', 'How much did I spend this month?']) {
    const result = await service.interpretOffline(message, snapshot);
    assert.equal(result.engine, 'basic');
  }
  assert.equal(calls.read, 0); assert.equal(calls.availability, 0); assert.equal(calls.generate, 0); assert.equal(calls.cleanup, 0);
  assert.equal(JSON.stringify(snapshot), before);
});

test('basic mode skips Apple checks and models even when model interpretation is requested', async () => {
  const { service, calls } = fixture({ mode: 'basic' });
  await assert.rejects(service.interpretOffline('lunch 150 on Monday', snapshot), /Nothing was saved/);
  const result = await service.interpretOffline('lunch 25', snapshot, { preferModel: true });
  assert.equal(result.engine, 'basic');
  assert.equal((await service.getAIStatus()).preferences.mode, 'basic');
  assert.equal(calls.read, 1); assert.equal(calls.availability, 0); assert.equal(calls.generate, 0);
});

test('complex messages use only Apple, validate the result locally and still save nothing', async () => {
  const { service, calls, behavior } = fixture();
  const before = JSON.stringify(snapshot), engines: string[] = [];
  const result = await service.interpretOffline('lunch 150 on Monday', snapshot, { onEngine: engine => engines.push(engine) });
  assert.equal(result.engine, 'apple'); assert.deepEqual(engines, ['apple']);
  assert.equal(result.result.type, 'draft'); if (result.result.type === 'draft') assert.equal(result.result.input.date, '2026-11-02');
  assert.equal(calls.generate, 1); assert.equal(calls.read, 1); assert.equal(calls.availability, 1);
  const prompt = JSON.parse(calls.prompt); assert.deepEqual(Object.keys(prompt).sort(), ['context', 'message']);
  assert.equal(prompt.message, 'lunch 150 on Monday'); assert.equal(prompt.context.today, '2026-11-05');
  assert.equal(JSON.stringify(snapshot), before);
  behavior.generate = async () => JSON.stringify({ ...validIntent, amount: '-150' });
  await assert.rejects(service.interpretOffline('lunch 150 on Monday', snapshot), /Check the amount.*Nothing was saved/s);
});

test('native timeouts cancel generation and cannot replace ambiguous dates with a basic draft', async () => {
  const { service, calls, behavior } = fixture({ modelTimeoutMs: 10 });
  behavior.generate = () => new Promise(() => {});
  await assert.rejects(service.interpretOffline('lunch 150 on Monday', snapshot), /took too long.*Nothing was saved/s);
  assert.equal(calls.cancel, 1);
  const fast = await service.interpretOffline('transpo 25 today', snapshot);
  assert.equal(fast.engine, 'basic'); assert.equal(calls.generate, 1);
  const safe = await service.interpretOffline('lunch 25', snapshot, { preferModel: true });
  assert.equal(safe.engine, 'basic'); assert.equal(calls.cancel, 2);
});

test('cancelling an active on-device request settles immediately and rejects late results', async () => {
  const { service, calls, behavior } = fixture({ modelTimeoutMs: 1000 });
  let started!: () => void;
  const generated = new Promise<void>(resolve => { started = resolve; });
  let resolveModel!: (value: string) => void;
  behavior.generate = () => { started(); return new Promise(resolve => { resolveModel = resolve; }); };
  const controller = new AbortController();
  const pending = service.interpretOffline('lunch 150 on Monday', snapshot, { signal: controller.signal });
  await generated; controller.abort();
  await assert.rejects(pending, /cancelled/); assert.equal(calls.cancel, 1);
  resolveModel(JSON.stringify(validIntent));
  const alreadyCancelled = new AbortController(); alreadyCancelled.abort();
  await assert.rejects(service.interpretOffline('transpo 25 today', snapshot, { signal: alreadyCancelled.signal }), /cancelled/);
  assert.equal(calls.generate, 1);
});

test('preferences and availability are cached, saves cannot be overwritten by stale reads', async () => {
  const { service, calls, behavior } = fixture();
  await Promise.all([service.getAIStatus(), service.getAIStatus(), service.getAIStatus()]);
  assert.equal(calls.read, 1); assert.equal(calls.availability, 1);
  const status = await service.getAIStatus(); status.preferences.mode = 'basic'; status.apple.available = false;
  assert.equal((await service.getAIStatus()).preferences.mode, 'auto'); assert.equal((await service.getAIStatus()).apple.available, true);
  await service.saveAISettings({ mode: 'basic' });
  assert.deepEqual(calls.write, ['{"mode":"basic"}']);
  assert.equal((await service.getAIStatus()).preferences.mode, 'basic'); assert.equal(calls.availability, 1);
  await service.clearAISettings(); assert.equal(calls.remove, 1); assert.equal(calls.cleanup, 1);
  let release!: (raw: string) => void;
  behavior.read = () => new Promise(resolve => { release = resolve; });
  const pending = service.getAIStatus(); await Promise.resolve(); await Promise.resolve();
  await service.saveAISettings({ mode: 'basic' }); release('{"mode":"auto"}');
  assert.equal((await pending).preferences.mode, 'basic');
});

test('unreadable preferences stay in quick entry mode and upgrade cleanup retries independently', async () => {
  const { service, calls, behavior } = fixture();
  behavior.read = async () => { throw new Error('Secure storage unavailable'); };
  const status = await service.getAIStatus();
  assert.equal(status.preferences.mode, 'basic'); assert.match(status.warning!, /could not be read/); assert.equal(calls.availability, 0);
  await assert.rejects(service.interpretOffline('lunch 150 on Monday', snapshot), /Nothing was saved/);
  behavior.cleanup = async () => { throw new Error('Deletion unavailable'); };
  const readsBeforeCleanup = calls.read;
  await assert.rejects(service.cleanupLegacyOnlineAI(), /Deletion unavailable/);
  behavior.cleanup = async () => {};
  await service.cleanupLegacyOnlineAI(); await service.cleanupLegacyOnlineAI();
  assert.equal(calls.cleanup, 2);
  assert.equal(calls.read, readsBeforeCleanup);
  assert.equal((await service.interpretOffline('transpo 25 today', snapshot)).engine, 'basic');
});

test('the shipped offline AI modules contain no networking or provider transport', () => {
  for (const path of ['src/platform/ai.ts', 'src/core/ai.ts', 'src/core/aiRouting.ts', 'src/core/offlineAI.ts']) {
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|netinfo|https?:\/\//i, path);
  }
  const platform = readFileSync('src/platform/ai.ts', 'utf8');
  assert.doesNotMatch(platform, /getItemAsync\(['"]robbtracker\.ai\.(?:groq|preferences\.v1)/);
});
