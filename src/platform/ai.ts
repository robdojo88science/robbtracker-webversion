import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import RobbAI from '../../modules/robb-ai';
import { createOfflineAIService, type AppleAvailability } from '../core/offlineAI';

const PREF_NAME = 'robbtracker.ai.offline.preferences.v1';
const STORE_OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

async function nativeAvailability(): Promise<AppleAvailability> {
  if (Platform.OS !== 'ios') return { available: false, code: 'unsupportedPlatform', message: 'Quick entry works on this device. Apple AI needs a compatible iPhone or iPad.' };
  if (!RobbAI) return { available: false, code: 'missingModule', message: 'Quick entry is ready. Install the latest app build to add Apple on-device AI.' };
  return RobbAI.availability();
}

const service = createOfflineAIService({
  preferences: {
    read: () => SecureStore.getItemAsync(PREF_NAME),
    write: value => SecureStore.setItemAsync(PREF_NAME, value, STORE_OPTIONS),
    remove: () => SecureStore.deleteItemAsync(PREF_NAME),
  },
  apple: {
    availability: nativeAvailability,
    generate: async (prompt, instructions) => {
      if (!RobbAI) throw new Error('Apple on-device AI is unavailable in this build. Use quick entry or the transaction form.');
      return RobbAI.generate(prompt, instructions);
    },
    cancel: async () => { await RobbAI?.cancel(); },
  },
  cleanupLegacy: async () => {
    // Upgrade cleanup only: delete obsolete provider data without reading the old key.
    await Promise.all([
      SecureStore.deleteItemAsync('robbtracker.ai.groq.personal-key.v1'),
      SecureStore.deleteItemAsync('robbtracker.ai.preferences.v1'),
    ]);
  },
});

export type { AIEngine } from '../core/aiRouting';
export type { AIStatus } from '../core/offlineAI';
export const { loadAIPreferences, saveAISettings, clearAISettings, cleanupLegacyOnlineAI, appleAIAvailability, getAIStatus, interpretOffline, interpretOfflineBatch, testAIProvider } = service;
