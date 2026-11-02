import { isQuickMessage, type AIPreferences } from './ai';
import type { ChatResult } from './chat';

export type AIEngine = 'basic' | 'apple';
export interface OfflineResult { result: ChatResult; engine: AIEngine; notice: string }
export interface AIRoutingState { preferences: AIPreferences; apple: { available: boolean; message: string }; warning?: string }
export interface AIProviders { apple(): Promise<ChatResult> }
export interface AIInterpretOptions { preferModel?: boolean; safeBasic?: boolean; signal?: AbortSignal; onEngine?: (engine: AIEngine) => void }

/** Interpret entirely on this device. Models never write records or calculate ledger totals. */
export async function routeAIInterpretation(message: string, basic: ChatResult | undefined, basicError: string, state: AIRoutingState, providers: AIProviders, options: AIInterpretOptions = {}): Promise<OfflineResult> {
  const checkCancelled = () => { if (options.signal?.aborted) throw new Error('Entry cancelled.'); };
  checkCancelled();
  const safeBasic = options.safeBasic ?? isQuickMessage(message);
  const local = (notice = 'Ready to review.') => {
    options.onEngine?.('basic');
    return { result: basic!, engine: 'basic' as const, notice };
  };
  if (basic && safeBasic && (!options.preferModel || state.preferences.mode === 'basic')) return local();
  const reasons: string[] = state.warning ? [state.warning] : [];
  if (state.preferences.mode === 'basic') reasons.push('Use a short message such as “transpo 25 yesterday”, or record it with the form.');
  else if (!state.apple.available) reasons.push(state.apple.message);
  else {
    try {
      options.onEngine?.('apple');
      const result = await providers.apple();
      checkCancelled();
      return { result, engine: 'apple', notice: 'Interpreted on this device. Review before saving.' };
    } catch (reason) {
      checkCancelled();
      reasons.push(reason instanceof Error ? reason.message : 'On-device interpretation could not finish.');
    }
  }
  // Never turn an unclear date or unresolved spending filter into an invented entry or total.
  if (basic && safeBasic) return local('Using quick entry. Review before saving.');
  throw new Error([...reasons, basicError || 'Use a shorter message or the transaction form.', 'Nothing was saved.'].filter(Boolean).join('\n'));
}
