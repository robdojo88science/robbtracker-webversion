import { Asset } from 'expo-asset';
import type { Profile, TransactionKind } from '../core/types';

const sounds = {
  'chime.wav': require('../../assets/sounds/chime.wav'),
  'pop.wav': require('../../assets/sounds/pop.wav'),
};
function vibrate(enabled: boolean): void {
  if (!enabled || typeof navigator === 'undefined') return;
  try { navigator.vibrate?.(20); } catch { /* Optional browser/device feedback. */ }
}
export async function previewSound(sound: string): Promise<void> {
  if (sound === 'none' || typeof Audio === 'undefined') return;
  try {
    const player = new Audio(Asset.fromModule(sounds[sound as keyof typeof sounds] ?? sounds['chime.wav']).uri);
    player.volume = 0.45;
    const release = setTimeout(() => { player.pause(); player.remove(); }, 4000);
    player.onended = () => { clearTimeout(release); player.remove(); };
    player.onerror = () => { clearTimeout(release); player.remove(); };
    await player.play();
  } catch { /* Autoplay restrictions must not make a saved transaction appear to fail. */ }
}
export async function transactionFeedback(kind: TransactionKind, profile: Profile | null): Promise<void> {
  vibrate(profile?.hapticsEnabled !== false);
  if (profile?.transactionSounds !== false) await previewSound(kind === 'income' || kind === 'adjustment_credit' ? 'chime.wav' : 'pop.wav');
}
export async function performanceFeedback(index: number, profile: Profile | null): Promise<void> {
  vibrate(profile?.hapticsEnabled !== false);
  if (profile?.transactionSounds !== false) await previewSound(index <= 2 ? 'chime.wav' : 'pop.wav');
}
