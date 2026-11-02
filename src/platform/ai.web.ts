import { createOfflineAIService } from '../core/offlineAI';
import { getBrowserValue, setBrowserValue, deleteBrowserValue } from './browserStore';

const PREF_NAME = 'preferences.offlineAI';
const unavailable = { available: false, code: 'browserUnavailable', message: 'Browser Quick chat runs entirely offline. Apple on-device AI is available only in the native iPhone/iPad app.' };
const service = createOfflineAIService({
  preferences: {
    read: async () => await getBrowserValue<string>(PREF_NAME) ?? '{"mode":"basic"}',
    write: value => setBrowserValue(PREF_NAME, value),
    remove: () => deleteBrowserValue(PREF_NAME),
  },
  apple: {
    availability: async () => ({ ...unavailable }),
    generate: async () => { throw new Error('Use a short message or the transaction form. Apple AI cannot run inside a browser.'); },
    cancel: async () => {},
  },
  cleanupLegacy: async () => {
    await Promise.all([deleteBrowserValue('robbtracker.ai.groq.personal-key.v1'), deleteBrowserValue('robbtracker.ai.preferences.v1')]);
  },
});
export type { AIEngine } from '../core/aiRouting';
export type { AIStatus } from '../core/offlineAI';
export const { loadAIPreferences, saveAISettings, clearAISettings, cleanupLegacyOnlineAI, appleAIAvailability, getAIStatus, interpretOffline, interpretOfflineBatch, testAIProvider } = service;
