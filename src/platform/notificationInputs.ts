import { addDays, dateRange, fromDate, localDate } from '../core/dates';
import type { Snapshot } from '../core/types';
import { SUMMARY_DAYS } from './dailySummary';

/** Only values that can change scheduled content; never stringify photos or the full snapshot. */
export function notificationInputKey(snapshot: Snapshot, now = new Date()): string {
  const profile = snapshot.profile;
  const clock = [Math.floor(now.getTime() / 60_000), now.getTimezoneOffset()];
  if (!profile?.notificationsEnabled) return JSON.stringify([...clock, false]);
  const reminders = snapshot.reminders.map(item => [item.id, item.updatedAt, item.deletedAt, item.status, item.title, item.dueAt, item.recurrence, item.monthlyDay]);
  if (!profile.dailySummaryEnabled) return JSON.stringify([...clock, true, profile.notificationSound, reminders, false]);
  // Each alert includes a full-month performance ratio, so earlier entries and
  // future entries in those months can change it even outside the 28 alert days.
  const today = localDate(now), start = `${today.slice(0,7)}-01`, end = dateRange('month',fromDate(addDays(today,SUMMARY_DAYS))).end;
  const expenses = snapshot.transactions.filter(item => item.kind === 'expense' && !item.deletedAt && !item.voidedAt && item.date >= start && item.date <= end).map(item => [item.date, item.baseAmountMinor ?? item.amountMinor]);
  return JSON.stringify([...clock, true, profile.notificationSound, reminders, true, profile.baseCurrency, profile.performanceThresholds, snapshot.budgets.map(item => [item.month, item.amountMinor, item.deletedAt]), expenses]);
}
