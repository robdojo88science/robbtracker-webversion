import * as Haptics from 'expo-haptics';
import type { Profile, TransactionKind } from '../core/types';

const sounds = {
  'chime.wav': require('../../assets/sounds/chime.wav'),
  'pop.wav': require('../../assets/sounds/pop.wav'),
};
export async function previewSound(sound: string): Promise<void> {
  if (sound === 'none') return;
  try {
    const { createAudioPlayer, setAudioModeAsync } = await import('expo-audio');
    await setAudioModeAsync({ playsInSilentMode: false, shouldPlayInBackground: false });
    const player = createAudioPlayer(sounds[sound as keyof typeof sounds] ?? sounds['chime.wav']);
    const release = setTimeout(() => player.remove(), 4000);
    player.addListener('playbackStatusUpdate', status => {
      if (status.didJustFinish) { clearTimeout(release); player.remove(); }
    });
    player.play();
  } catch { /* Feedback must never make a committed transaction appear to fail. */ }
}
export async function transactionFeedback(kind: TransactionKind, profile: Profile | null): Promise<void> {
  if (profile?.hapticsEnabled !== false) {
    try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch { /* Optional hardware feedback. */ }
  }
  if (profile?.transactionSounds !== false) await previewSound(kind === 'income' || kind === 'adjustment_credit' ? 'chime.wav' : 'pop.wav');
}

export async function performanceFeedback(index:number,profile:Profile|null):Promise<void>{
  if(profile?.hapticsEnabled!==false){try{await Haptics.selectionAsync();}catch{}}
  if(profile?.transactionSounds!==false)await previewSound(index<=2?'chime.wav':'pop.wav');
}
