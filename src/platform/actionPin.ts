import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { createActionPinService } from '../core/actionPin';
import RobbAI from '../../modules/robb-ai';
import { hexToBytes } from '@noble/hashes/utils.js';

const KEY = 'ftracker.action-pin.v1';
const OPTIONS: SecureStore.SecureStoreOptions = { keychainService: 'com.ftracker.action-pin', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export const actionPin = createActionPinService({
  storageAvailable: () => SecureStore.isAvailableAsync(),
  read: () => SecureStore.getItemAsync(KEY, OPTIONS),
  write: value => SecureStore.setItemAsync(KEY, value, OPTIONS),
  remove: () => SecureStore.deleteItemAsync(KEY, OPTIONS),
  randomBytes: length => Crypto.getRandomBytesAsync(length),
  now: Date.now,
  ...(typeof RobbAI?.deriveActionPin === 'function' ? { derive: async (value: string, saltHex: string, iterations: number) => {
    const hash = await RobbAI!.deriveActionPin!(value, saltHex, iterations);
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Secure PIN verification could not complete. Please try again.');
    return hexToBytes(hash);
  } } : {}),
});
