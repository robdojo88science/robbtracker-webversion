import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync, randomBytes, webcrypto } from 'node:crypto';
import 'fake-indexeddb/auto';
import { createBrowserActionPin, deriveBrowserPin } from '../src/platform/actionPin.web';
import { deleteBrowserValue, getBrowserValue, setBrowserValue } from '../src/platform/browserStore';
import { PIN_ITERATIONS } from '../src/core/actionPin';
import { loadBrowserImage } from '../src/platform/browserImages';

const KEY = 'security.action-pin.v1';
const recovery = [{ questionId: 'first-school', answer: 'School' }, { questionId: 'first-pet', answer: 'Milo' }];
const secureDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const pending = new Map<string, Promise<unknown>>();
Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
  request: (name: string, _options: unknown, work: () => Promise<unknown>) => {
    const result = (pending.get(name) ?? Promise.resolve()).then(work, work);
    pending.set(name, result.catch(() => undefined)); return result;
  },
} } });
Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
test.after(() => {
  for (const [key, descriptor] of [['isSecureContext', secureDescriptor], ['navigator', navigatorDescriptor], ['crypto', cryptoDescriptor]] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});
test.beforeEach(async () => { await deleteBrowserValue(KEY); });

test('browser PBKDF2 uses the exact native credential bytes and retains the full iteration count', async () => {
  const salt = '42'.repeat(32);
  for (const value of ['4829', '482915', 'san josé academy']) {
    const actual = await deriveBrowserPin(value, salt, PIN_ITERATIONS);
    assert.deepEqual(Buffer.from(actual), pbkdf2Sync(value, Buffer.from(salt, 'hex'), PIN_ITERATIONS, 32, 'sha256'));
  }
  await assert.rejects(deriveBrowserPin('4829', salt, 1000), /Invalid/);
  await assert.rejects(deriveBrowserPin('4829', salt + '\n', PIN_ITERATIONS), /Invalid/);
});

test('browser PIN setup, either-answer recovery and changed credentials persist across service instances', async () => {
  const first = createBrowserActionPin(); await first.setup('4829', recovery);
  const stored = JSON.parse((await getBrowserValue<string>(KEY))!);
  assert.equal(stored.version, 2); assert.equal(stored.pinLength, 4); assert.equal(stored.iterations, 210_000);
  assert.equal(stored.pin.hash, pbkdf2Sync('4829', Buffer.from(stored.pin.salt, 'hex'), PIN_ITERATIONS, 32, 'sha256').toString('hex'));
  const second = createBrowserActionPin(); assert.equal((await second.getState()).pinLength, 4);
  assert.equal(await second.verifyPin('4829'), true);
  await second.recoverPin([{ questionId: 'first-pet', answer: '  MILO ' }], '9264');
  assert.equal(await first.verifyPin('9264'), true); assert.equal(await first.verifyPin('4829'), false);
});

test('browser adapter retains legacy six-digit credentials until a validated change migrates them', async () => {
  const secret = (value: string) => { const salt = randomBytes(32).toString('hex'); return { salt, hash: pbkdf2Sync(value, Buffer.from(salt, 'hex'), PIN_ITERATIONS, 32, 'sha256').toString('hex') }; };
  await setBrowserValue(KEY, JSON.stringify({ version: 1, algorithm: 'pbkdf2-sha256', iterations: PIN_ITERATIONS, pin: secret('482915'), recovery: [{ questionId: 'first-school', ...secret('school') }, { questionId: 'first-pet', ...secret('milo') }], failedAttempts: 0, lockedUntil: 0 }));
  const service = createBrowserActionPin(); assert.equal((await service.getState()).pinLength, 6);
  assert.equal(await service.verifyPin('4829'), false); assert.equal(await service.verifyPin('482915'), true);
  await service.changePin('482915', '9264');
  assert.equal((await createBrowserActionPin().getState()).pinLength, 4);
  assert.equal(await service.verifyPin('9264'), true);
});

test('attempts commit before browser hashing and concurrent tab instances cannot lose failed attempts', async () => {
  const first = createBrowserActionPin(), second = createBrowserActionPin(); await first.setup('4829', recovery);
  let observed = 0;
  const hookedCrypto = {
    getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
    subtle: {
      importKey: webcrypto.subtle.importKey.bind(webcrypto.subtle),
      deriveBits: async (...args: Parameters<typeof webcrypto.subtle.deriveBits>) => {
        const stored = JSON.parse((await getBrowserValue<string>(KEY))!);
        observed++; assert.equal(stored.failedAttempts, observed, 'The durable attempt must be visible before crypto starts.');
        return webcrypto.subtle.deriveBits(...args);
      },
    },
  };
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: hookedCrypto });
  try {
    assert.deepEqual(await Promise.all([first.verifyPin('1111'), second.verifyPin('2222'), first.verifyPin('3333'), second.verifyPin('4444'), first.verifyPin('5555')]), [false, false, false, false, false]);
    const stored = JSON.parse((await getBrowserValue<string>(KEY))!);
    assert.equal(observed, 5); assert.equal(stored.failedAttempts, 5); assert.ok(stored.lockedUntil > Date.now());
    await assert.rejects(createBrowserActionPin().verifyPin('4829'), /Too many attempts/);
    await assert.rejects(second.recoverPin([{ questionId: 'first-pet', answer: 'milo' }], '9264'), /Too many attempts/);
  } finally { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto }); }
});

test('insecure contexts and corrupt browser credentials fail closed without creating replacement records', async () => {
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false });
  try {
    await assert.rejects(createBrowserActionPin().setup('4829', recovery), /HTTPS or localhost/);
    await assert.rejects(deriveBrowserPin('4829', '42'.repeat(32), PIN_ITERATIONS), /HTTPS or localhost/);
    assert.equal(await getBrowserValue(KEY), undefined);
  } finally { Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true }); }
  await setBrowserValue(KEY, '{broken');
  await assert.rejects(createBrowserActionPin().getState(), /could not be read/);
  await assert.rejects(createBrowserActionPin().setup('4829', recovery), /could not be read/);
  assert.equal(await getBrowserValue(KEY), '{broken');
});

test('missing cross-tab locking fails closed rather than falling back to unsafe security writes', async () => {
  const current = Object.getOwnPropertyDescriptor(globalThis, 'navigator')!;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  try {
    await assert.rejects(createBrowserActionPin().setup('4829', recovery), /cannot safely save PIN/);
    assert.equal(await getBrowserValue(KEY), undefined);
  } finally { Object.defineProperty(globalThis, 'navigator', current); }
});

test('photo adapters reject oversized and non-raster files before browser image decoding', async () => {
  await assert.rejects(loadBrowserImage(new File(['<svg/>'], 'photo.svg', { type: 'image/svg+xml' })), /JPEG, PNG or WebP/);
  await assert.rejects(loadBrowserImage(new File([new Uint8Array(24_000_001)], 'large.png', { type: 'image/png' })), /smaller than 24 MB/);
});
