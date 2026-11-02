import { requireOptionalNativeModule } from 'expo';

export interface AppleAIAvailability { available: boolean; code: string; message: string }
export interface RobbAINativeModule {
  /** Added in native builds after 1.4; older installed builds use the local JS fallback. */
  deriveActionPin?(value: string, saltHex: string, iterations: number): Promise<string>;
  availability(): Promise<AppleAIAvailability>;
  generate(prompt: string, instructions: string): Promise<string>;
  cancel(): Promise<void>;
}
export default requireOptionalNativeModule<RobbAINativeModule>('RobbAI');
