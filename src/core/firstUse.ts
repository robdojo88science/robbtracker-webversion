import { localDate } from './dates';
import type { Profile } from './types';

/** Auto-offer the welcome tour only on the local calendar day the tracker was created. */
export function shouldOfferWelcomeTour(profile: Pick<Profile, 'createdAt' | 'tutorialCompleted'> | null, now = new Date()): boolean {
  if (!profile || profile.tutorialCompleted) return false;
  const created = new Date(profile.createdAt);
  return Number.isFinite(created.getTime()) && localDate(created) === localDate(now);
}
