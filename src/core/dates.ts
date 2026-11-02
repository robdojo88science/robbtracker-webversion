export type Period = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'thisYear' | 'lastYear' | 'last7' | 'last30' | 'last365' | 'allTime' | 'custom';
export function localDate(value = new Date()): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}
export function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Use a valid date in YYYY-MM-DD format.');
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12);
  if (y < 1900 || y > 2200 || localDate(date) !== value) throw new Error('Choose a valid date between 1900 and 2200.');
}
export function assertTimestamp(value: string): void {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Choose a valid date and time.');
}
export function fromDate(value: string): Date { assertDate(value); const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d, 12); }
export function monthKey(value = new Date()): string { return localDate(value).slice(0, 7); }
export function addDays(value: string, days: number): string { const date = fromDate(value); date.setDate(date.getDate() + days); return localDate(date); }
export function addMonthsClamped(value: string, months: number, preferredDay?: number): string {
  const date = fromDate(value);
  const day = preferredDay ?? date.getDate();
  date.setDate(1); date.setMonth(date.getMonth() + months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay)); return localDate(date);
}
/** Actual record boundaries, including future entries. Empty history means today. */
export function recordedDateRange(dates: readonly string[], now = new Date()): { start: string; end: string } {
  let start: string | undefined, end: string | undefined;
  for (const date of dates) {
    try { assertDate(date); } catch { continue; }
    if (start === undefined || date < start) start = date;
    if (end === undefined || date > end) end = date;
  }
  return { start: start ?? localDate(now), end: end ?? localDate(now) };
}
export function dateRange(period: Period, now = new Date(), customStart?: string, customEnd?: string, recordedDates: readonly string[] = []): { start: string; end: string } {
  let start = localDate(now), end = start;
  if (period === 'yesterday') start = end = addDays(start, -1);
  if (period === 'week') start = addDays(start, -((now.getDay() + 6) % 7));
  if (period === 'month') { start = `${monthKey(now)}-01`; end = localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0, 12)); }
  if (period === 'lastMonth') { const date = new Date(now.getFullYear(), now.getMonth() - 1, 1, 12); start = localDate(date); end = localDate(new Date(now.getFullYear(), now.getMonth(), 0, 12)); }
  if (period === 'lastYear') { start = `${now.getFullYear() - 1}-01-01`; end = `${now.getFullYear() - 1}-12-31`; }
  if (period === 'thisYear') { start = `${now.getFullYear()}-01-01`; end = `${now.getFullYear()}-12-31`; }
  if (period === 'last7' || period === 'last30' || period === 'last365') start = addDays(end, -(Number(period.slice(4)) - 1));
  if (period === 'allTime') ({ start, end } = recordedDateRange(recordedDates, now));
  if (period === 'custom') { if (!customStart || !customEnd) throw new Error('Choose both dates.'); assertDate(customStart); assertDate(customEnd); start = customStart; end = customEnd; }
  if (start > end) throw new Error('Start date must be on or before end date.');
  return { start, end };
}
export function inclusiveDays(start: string, end: string): number {
  assertDate(start); assertDate(end);
  const [sy, sm, sd] = start.split('-').map(Number), [ey, em, ed] = end.split('-').map(Number);
  return Math.floor((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000) + 1;
}
export function previousRange(start: string, end: string): {start: string; end: string} {
  const days = inclusiveDays(start, end); return { start: addDays(start, -days), end: addDays(start, -1) };
}
export function nextRecurrence(dueAt: string, recurrence: 'daily' | 'weekly' | 'monthly', after: string, monthlyDay?: number | null): string {
  let date = new Date(dueAt); const now = new Date(after); const preferredDay = monthlyDay ?? date.getDate();
  // A snoozed monthly occurrence may fall before its regular day in that month.
  if (recurrence === 'monthly') {
    const candidate = new Date(date);
    candidate.setDate(Math.min(preferredDay, new Date(date.getFullYear(),date.getMonth()+1,0).getDate()));
    if(candidate>date&&candidate>now)return candidate.toISOString();
  }
  do {
    if (recurrence === 'monthly') { const target = addMonthsClamped(localDate(date), 1, preferredDay); const [y,m,d] = target.split('-').map(Number); date.setFullYear(y, m - 1, d); }
    else date.setDate(date.getDate() + (recurrence === 'weekly' ? 7 : 1));
  } while (date <= now);
  return date.toISOString();
}
