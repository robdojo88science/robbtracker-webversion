import type { Reminder } from '../core/types';

export interface PlannedNotification { identifier: string; reminderId: string; date: Date }
const PREFIX = 'ftracker:';
export function isTrackerNotification(id: string): boolean { return id.startsWith(PREFIX); }

function occurrence(anchor: Date, recurrence: Reminder['recurrence'], offset: number, monthlyDay?: number | null): Date {
  const result = new Date(anchor);
  // The saved first occurrence may be snoozed; preserve it exactly before
  // returning to the preferred day for subsequent monthly occurrences.
  if (offset === 0) return result;
  if (recurrence === 'monthly') {
    const day = monthlyDay ?? anchor.getDate();
    const anchorMonthLastDay = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
    // A cross-month snooze can precede the regular payment day in its new
    // month. Include that day before advancing into the following month.
    const sameMonthOccurrenceAhead = anchor.getDate() < Math.min(day, anchorMonthLastDay);
    const monthOffset = offset - (sameMonthOccurrenceAhead ? 1 : 0);
    result.setDate(1);
    result.setMonth(anchor.getMonth() + monthOffset);
    const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(day, lastDay));
  } else if (recurrence === 'daily' || recurrence === 'weekly') {
    result.setDate(anchor.getDate() + offset * (recurrence === 'weekly' ? 7 : 1));
  }
  return result;
}

/** Schedule the earliest 60 events, leaving room under iOS's pending-request limit. */
export function planNotifications(reminders: Reminder[], now = new Date(), limit = 60): { notifications: PlannedNotification[]; truncated: boolean } {
  const planned: PlannedNotification[] = [];
  for (const reminder of reminders) {
    if (reminder.status !== 'active' || reminder.deletedAt) continue;
    const anchor = new Date(reminder.dueAt);
    if (!Number.isFinite(anchor.getTime())) continue;
    let start = 0;
    if (anchor < now && reminder.recurrence !== 'none') {
      if (reminder.recurrence === 'monthly') start = Math.max(0, (now.getFullYear() - anchor.getFullYear()) * 12 + now.getMonth() - anchor.getMonth() - 1);
      else start = Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / (86_400_000 * (reminder.recurrence === 'weekly' ? 7 : 1))) - 2);
    }
    let count = 0;
    for (let offset = start; count <= limit && offset <= start + limit + 5; offset += 1) {
      if (reminder.recurrence === 'none' && offset > 0) break;
      const date = occurrence(anchor, reminder.recurrence, offset, reminder.monthlyDay);
      if (date.getTime() <= now.getTime() + 1000) continue;
      planned.push({ identifier: `${PREFIX}${reminder.id}:${date.getTime()}`, reminderId: reminder.id, date });
      count += 1;
      if (reminder.recurrence === 'none') break;
    }
  }
  planned.sort((a, b) => a.date.getTime() - b.date.getTime() || a.identifier.localeCompare(b.identifier));
  return { notifications: planned.slice(0, limit), truncated: planned.length > limit };
}
