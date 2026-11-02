import { AI_INSTRUCTIONS, DEFAULT_AI_PREFERENCES, aiPreferences, buildAIContext, isQuickMessage, resolveAIIntent, validateAIMessage, type AIPreferences } from './ai';
import { interpretChat, splitChatBatch, type ChatResult, type ChatDraft } from './chat';
import { routeAIInterpretation, type AIInterpretOptions, type OfflineResult } from './aiRouting';
import type { Snapshot } from './types';

export interface AppleAvailability { available: boolean; code: string; message: string }
export interface AIStatus { preferences: AIPreferences; apple: AppleAvailability; warning?: string }
export interface OfflineAIDependencies {
  preferences: { read(): Promise<string | null>; write(value: string): Promise<void>; remove(): Promise<void> };
  apple: { availability(): Promise<AppleAvailability>; generate(prompt: string, instructions: string): Promise<string>; cancel(): Promise<void> };
  cleanupLegacy(): Promise<void>;
  now?(): Date;
  modelTimeoutMs?: number;
  statusTimeoutMs?: number;
}
export const APPLE_INTERPRET_TIMEOUT_MS = 8000;
const BASIC_ONLY: AppleAvailability = { available: false, code: 'basicOnly', message: 'Quick entry mode uses the instant local parser.' };
const cancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw new Error('Entry cancelled.'); };

/** Bound native work so a model/storage delay cannot leave Quick chat waiting indefinitely. */
async function bounded<T>(work: () => Promise<T>, timeoutMs: number, message: string, signal?: AbortSignal, cancel?: () => void): Promise<T> {
  cancelled(signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stop = () => { try { cancel?.(); } catch { /* Cancellation is best effort; the request still settles. */ } };
  const interruption = new Promise<never>((_, reject) => {
    onAbort = () => { stop(); reject(new Error('Entry cancelled.')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => { stop(); reject(new Error(message)); }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => { cancelled(signal); return work(); }), interruption]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

/** Native adapters are injected so offline routing, cancellation and caching can be verified directly. */
export function createOfflineAIService(dependencies: OfflineAIDependencies) {
  let preferences: AIPreferences | undefined;
  let preferencesRead: Promise<AIPreferences> | undefined;
  let preferenceRevision = 0;
  let availability: { value: AppleAvailability; expires: number } | undefined;
  let availabilityRead: Promise<AppleAvailability> | undefined;
  let cleanup: Promise<void> | undefined;
  let modelActive = false;
  const now = dependencies.now ?? (() => new Date());
  const statusTimeout = dependencies.statusTimeoutMs ?? 1200;

  const cleanupLegacyOnlineAI = (): Promise<void> => {
    if (!cleanup) cleanup = dependencies.cleanupLegacy().catch(reason => { cleanup = undefined; throw reason; });
    return cleanup;
  };
  const loadAIPreferences = async (): Promise<AIPreferences> => {
    if (preferences) return { ...preferences };
    if (!preferencesRead) {
      const revision = preferenceRevision;
      const reading = bounded(() => dependencies.preferences.read(), statusTimeout, 'AI preferences took too long to read.').then(raw => {
        let saved: AIPreferences;
        try { saved = raw ? aiPreferences(JSON.parse(raw)) : { ...DEFAULT_AI_PREFERENCES }; }
        catch { throw new Error('AI preferences could not be read. Quick entry is available.'); }
        if (revision === preferenceRevision) preferences = saved;
        return { ...(preferences ?? saved) };
      });
      preferencesRead = reading;
      void reading.finally(() => { if (preferencesRead === reading) preferencesRead = undefined; }).catch(() => {});
    }
    return { ...await preferencesRead };
  };
  const saveAISettings = async (value: AIPreferences): Promise<void> => {
    const next = aiPreferences(value);
    await dependencies.preferences.write(JSON.stringify(next));
    preferenceRevision++;
    preferences = next;
    preferencesRead = undefined;
  };
  const clearAISettings = async (): Promise<void> => {
    preferenceRevision++;
    preferences = undefined;
    preferencesRead = undefined;
    await Promise.all([dependencies.preferences.remove(), dependencies.cleanupLegacy()]);
  };
  const appleAIAvailability = async (refresh = false): Promise<AppleAvailability> => {
    if (!refresh && availability && availability.expires > Date.now()) return { ...availability.value };
    if (!availabilityRead) {
      const reading = bounded(() => dependencies.apple.availability(), statusTimeout, 'On-device AI status took too long to check.')
        .catch((): AppleAvailability => ({ available: false, code: 'unavailable', message: 'Apple AI is unavailable right now. Use a short message or the transaction form.' }))
        .then(value => { availability = { value, expires: Date.now() + 15000 }; return value; });
      availabilityRead = reading;
      void reading.finally(() => { if (availabilityRead === reading) availabilityRead = undefined; }).catch(() => {});
    }
    return { ...await availabilityRead };
  };
  const getAIStatus = async (refresh = false): Promise<AIStatus> => {
    let saved: AIPreferences;
    try { saved = await loadAIPreferences(); }
    catch { return { preferences: { mode: 'basic' }, apple: { ...BASIC_ONLY }, warning: 'AI preferences could not be read. Quick entry stays available.' }; }
    return { preferences: saved, apple: saved.mode === 'basic' ? { ...BASIC_ONLY } : await appleAIAvailability(refresh) };
  };
  const appleGenerate = async (message: string, snapshot: Snapshot, signal?: AbortSignal): Promise<string> => {
    cancelled(signal);
    if (modelActive) throw new Error('The previous on-device request is still finishing. Try again shortly.');
    modelActive = true;
    try {
      return await bounded(() => dependencies.apple.generate(JSON.stringify({ message, context: buildAIContext(snapshot, message, now()) }), AI_INSTRUCTIONS), dependencies.modelTimeoutMs ?? APPLE_INTERPRET_TIMEOUT_MS, 'On-device interpretation took too long. Try a short message or the transaction form.', signal, () => { void dependencies.apple.cancel().catch(() => {}); });
    } finally { modelActive = false; }
  };
  const interpretOffline = async (message: string, snapshot: Snapshot, options: AIInterpretOptions = {}): Promise<OfflineResult> => {
    cancelled(options.signal);
    const value = validateAIMessage(message);
    let basic: ChatResult | undefined, basicError = '';
    try { basic = interpretChat(value, snapshot, now()); }
    catch (reason) { basicError = reason instanceof Error ? reason.message : 'Use one short transaction.'; }
    const safeBasic = isQuickMessage(value, snapshot);
    // This hot path performs no preference reads, model checks, key lookup or native calls.
    if (basic && safeBasic && !options.preferModel) {
      options.onEngine?.('basic');
      return { result: basic, engine: 'basic', notice: 'Ready to review.' };
    }
    const status = await bounded(() => getAIStatus(), statusTimeout * 2 + 25, 'On-device AI could not be checked. Try quick entry.', options.signal);
    cancelled(options.signal);
    return routeAIInterpretation(value, basic, basicError, status, { apple: async () => resolveAIIntent(await appleGenerate(value, snapshot, options.signal), snapshot) }, { ...options, safeBasic });
  };
  const testAIProvider = async (snapshot: Snapshot): Promise<string> => {
    const status = await getAIStatus(true);
    if (!status.apple.available) throw new Error(status.apple.message);
    const result = resolveAIIntent(await appleGenerate('Add income 1 today', snapshot), snapshot);
    if (result.type !== 'draft' || result.input.kind !== 'income' || result.input.amountMinor !== 100) throw new Error('The on-device test response did not pass local validation.');
    return 'Apple on-device AI is ready. No transaction was saved.';
  };
  const interpretOfflineBatch = async (message: string, snapshot: Snapshot, options: AIInterpretOptions = {}): Promise<OfflineResult> => {
    cancelled(options.signal);
    const entries=splitChatBatch(validateAIMessage(message),snapshot,now());
    if(entries.length===1)return interpretOffline(entries[0],snapshot,options);
    const controller=new AbortController(),abort=()=>controller.abort();
    options.signal?.addEventListener('abort',abort,{once:true});
    let engine: 'basic'|'apple'='basic';
    try{
      return await bounded(async()=>{
        const drafts:ChatDraft[]=[];
        for(let index=0;index<entries.length;index++){
          cancelled(controller.signal);
          try{
            const result=await interpretOffline(entries[index],snapshot,{...options,signal:controller.signal,onEngine:next=>{if(next==='apple')engine=next;options.onEngine?.(next);}});
            if(result.result.type!=='draft')throw new Error('Ask balance or spending questions separately from transaction batches.');
            drafts.push(result.result);
          }catch(reason){throw new Error(`Entry ${index+1}: ${reason instanceof Error?reason.message:'Check this entry.'}`);}
        }
        return {result:{type:'batch',drafts,message:`${drafts.length} transactions ready to review.`},engine,notice:'Review all entries, then confirm to save together.'};
      },dependencies.modelTimeoutMs??APPLE_INTERPRET_TIMEOUT_MS,'Batch interpretation took too long. Try shorter entries.',options.signal,abort);
    }finally{options.signal?.removeEventListener('abort',abort);}
  };
  return { loadAIPreferences, saveAISettings, clearAISettings, cleanupLegacyOnlineAI, appleAIAvailability, getAIStatus, interpretOffline, interpretOfflineBatch, testAIProvider };
}
