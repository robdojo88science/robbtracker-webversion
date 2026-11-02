import { createActionPinService, PIN_ITERATIONS, type ActionPinService } from '../core/actionPin';
import { deleteBrowserValue, getBrowserValue, setBrowserValue, withBrowserLock } from './browserStore';

const KEY = 'security.action-pin.v1';
function browserCrypto(): Crypto {
  if (!globalThis.isSecureContext || !globalThis.crypto?.subtle) throw new Error('PIN protection needs HTTPS or localhost in a supported browser.');
  return globalThis.crypto;
}
function requireBrowserPinSupport() {
  browserCrypto();
  if (typeof indexedDB === 'undefined' || typeof navigator === 'undefined' || typeof navigator.locks?.request !== 'function') throw new Error('This browser cannot safely save PIN protection. Use a current browser with local storage enabled.');
}
/** Same UTF-8 PBKDF2-SHA256 bytes as the native credential format, without JavaScript hashing. */
export async function deriveBrowserPin(value: string, saltHex: string, iterations: number): Promise<Uint8Array> {
  const crypto = browserCrypto(), encoded = new TextEncoder().encode(value);
  if (iterations !== PIN_ITERATIONS || encoded.length > 1024 || saltHex.length !== 64 || !/^[0-9a-f]{64}$/.test(saltHex)) throw new Error('Invalid secure PIN parameters.');
  const salt = Uint8Array.from(saltHex.match(/../g)!, value => parseInt(value, 16));
  const key = await crypto.subtle.importKey('raw', encoded, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
export function createBrowserActionPin(): ActionPinService {
const service = createActionPinService({
  storageAvailable: async () => { requireBrowserPinSupport(); return true; },
  read: async () => (await getBrowserValue<string>(KEY)) ?? null,
  write: value => setBrowserValue(KEY, value),
  remove: () => deleteBrowserValue(KEY),
  randomBytes: async length => browserCrypto().getRandomValues(new Uint8Array(length)),
  now: Date.now,
  derive: deriveBrowserPin,
});
function locked<T>(work: () => Promise<T>): Promise<T> {
  try { requireBrowserPinSupport(); return withBrowserLock('action-pin', work); }
  catch (error) { return Promise.reject(error); }
}
// Lock the whole read/attempt-write/hash/final-write operation across tabs.
// Individual IndexedDB writes resolve only after transaction completion.
return {
  getState: () => locked(() => service.getState()),
  setup: (pin, recovery) => locked(() => service.setup(pin, recovery)),
  verifyPin: pin => locked(() => service.verifyPin(pin)),
  changePin: (currentPin, newPin) => locked(() => service.changePin(currentPin, newPin)),
  recoverPin: (answers, newPin) => locked(() => service.recoverPin(answers, newPin)),
  updateRecovery: (pin, answers) => locked(() => service.updateRecovery(pin, answers)),
  clearAfterTrackerReset: () => locked(() => service.clearAfterTrackerReset()),
};

}
export const actionPin = createBrowserActionPin();
