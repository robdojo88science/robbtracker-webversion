import type { Reminder, Snapshot } from '../core/types';
import { planNotifications } from './notificationSchedule';
import { planDailySummaries } from './dailySummary';
import { previewSound } from './feedback.web';
import { getBrowserValue, setBrowserValue, withBrowserLock } from './browserStore';
import { webPath } from './webPaths';

export const WEB_NOTIFICATION_NOTE = 'Alerts can appear while this app stays open. Browsers cannot reliably schedule offline alerts after you close it; background tabs may delay delivery.';
export interface NotificationSyncResult { scheduled: number; truncated: boolean; permissionGranted: boolean; summaries?: number }
type PendingAlert = { identifier: string; at: number; title: string; body: string; url: string; sound: string; kind: 'reminder' | 'summary' | 'test' };
type ScheduleInput = { reminders: Reminder[]; enabled: boolean; sound: string; snapshot?: Snapshot };
const planned = new Map<string, PendingAlert>();
let latest: ScheduleInput | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let listenersAdded = false, truncated = false;
let pending: Promise<unknown> = Promise.resolve();
const serial = <T,>(work: () => Promise<T>): Promise<T> => {
  const next = pending.then(work, work); pending = next.catch(() => {}); return next;
};
const supported = () => typeof window !== 'undefined' && window.isSecureContext && typeof Notification !== 'undefined';
const granted = () => supported() && Notification.permission === 'granted';

function rebuild(): void {
  for (const [id, alert] of planned) if (alert.kind !== 'test') planned.delete(id);
  truncated = false;
  if (!latest?.enabled || !granted()) return;
  const { reminders, sound, snapshot } = latest;
  const planningNow = new Date(Date.now() - 1100); // Keep alerts due during a save/replan from being dropped.
  const summaries = snapshot ? planDailySummaries(snapshot, planningNow) : [];
  const plan = planNotifications(reminders, planningNow, Math.max(0, 60 - summaries.length));
  truncated = plan.truncated;
  const definitions = new Map(reminders.map(reminder => [reminder.id, reminder]));
  for (const item of plan.notifications) {
    const reminder = definitions.get(item.reminderId);
    const identifier = item.identifier + ':' + sound + ':' + (reminder?.updatedAt ?? '');
    planned.set(identifier, { identifier, at: item.date.getTime(), title: 'Robb Tracker reminder', body: reminder?.title ?? 'You have a reminder.', url: webPath('reminders'), sound, kind: 'reminder' });
  }
  for (const item of summaries) planned.set(item.identifier, { identifier: item.identifier, at: item.date.getTime(), title: item.title, body: item.body, url: webPath('transactions?period=custom&start=' + item.day + '&end=' + item.day), sound, kind: 'summary' });
}

async function display(alert: PendingAlert): Promise<void> {
  const options: NotificationOptions = { body: alert.body, tag: alert.identifier, silent: alert.sound === 'none', data: { url: alert.url } };
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration(webPath());
    if (registration?.showNotification) {
      await registration.showNotification(alert.title, options);
      if (alert.sound !== 'none') void previewSound(alert.sound);
      return;
    }
  }
  const notification = new Notification(alert.title, options);
  notification.onclick = () => { notification.close(); window.focus(); window.location.assign(alert.url); };
  if (alert.sound !== 'none') void previewSound(alert.sound);
}

async function deliverOnce(alert: PendingAlert): Promise<void> {
  await withBrowserLock('notifications.delivery', async () => {
    const stored = await getBrowserValue<unknown>('notifications.delivered.v1');
    const history = Array.isArray(stored) ? stored.filter((item): item is { id: string; at: number } => !!item && typeof item.id === 'string' && typeof item.at === 'number' && item.at > Date.now() - 7 * 86400000) : [];
    if (history.some(item => item.id === alert.identifier)) return;
    await display(alert);
    history.push({ id: alert.identifier, at: Date.now() });
    await setBrowserValue('notifications.delivered.v1', history.slice(-300));
  });
}

function arm(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!planned.size || typeof document === 'undefined') return;
  const next = Math.min(...[...planned.values()].map(alert => alert.at));
  const visible = document.visibilityState === 'visible';
  const wait = visible ? Math.max(250, Math.min(30000, next - Date.now())) : 30000;
  timer = setTimeout(() => { void flush().catch(() => {}).finally(arm); }, wait);
}

function flush(): Promise<void> {
  return serial(async () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    const now = Date.now();
    for (const [id, alert] of planned) {
      if (alert.at > now) continue;
      planned.delete(id);
      if (!granted() || (alert.kind !== 'test' && !latest?.enabled) || now - alert.at > 120000) continue;
      try { await deliverOnce(alert); } catch { /* Reminder records remain available even if the browser blocks a popup. */ }
    }
    rebuild();
  });
}

function ensureListeners(): void {
  if (listenersAdded || typeof window === 'undefined') return;
  listenersAdded = true;
  const resume = () => { void flush().catch(() => {}).finally(arm); };
  window.addEventListener('focus', resume);
  document.addEventListener('visibilitychange', resume);
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!supported()) return false;
  try {
    const allowed = Notification.permission === 'granted' || await Notification.requestPermission() === 'granted';
    if (allowed && latest) { rebuild(); ensureListeners(); arm(); }
    return allowed;
  } catch { return false; }
}

export async function getNotificationStatus(): Promise<{ granted: boolean; canAskAgain: boolean; pendingReminders: number; pendingSummaries: number; supported: boolean; foregroundOnly: true; note: string }> {
  return { granted: granted(), canAskAgain: supported() && Notification.permission === 'default', pendingReminders: [...planned.values()].filter(alert => alert.kind === 'reminder').length, pendingSummaries: [...planned.values()].filter(alert => alert.kind === 'summary').length, supported: supported(), foregroundOnly: true, note: WEB_NOTIFICATION_NOTE };
}

export function reconcileNotifications(reminders: Reminder[], enabled: boolean, sound = 'default', snapshot?: Snapshot): Promise<NotificationSyncResult> {
  return serial(async () => {
    latest = { reminders, enabled, sound, snapshot };
    rebuild(); ensureListeners(); arm();
    const alerts = [...planned.values()].filter(alert => alert.kind !== 'test');
    return { scheduled: alerts.length, summaries: alerts.filter(alert => alert.kind === 'summary').length, truncated, permissionGranted: granted() };
  });
}

export async function sendTestNotification(sound: string): Promise<void> {
  if (!(await requestNotificationPermission())) throw new Error('Enable browser notifications for this site. Some browsers require installing the app first.');
  const identifier = 'ftracker:test:' + Date.now();
  planned.set(identifier, { identifier, at: Date.now() + 5000, title: 'Robb Tracker', body: 'Browser reminders work while this app stays open.', url: webPath('reminders'), sound, kind: 'test' });
  ensureListeners(); arm();
}

export function cancelAll(): Promise<void> {
  return serial(async () => {
    latest = undefined; planned.clear(); truncated = false;
    if (timer) clearTimeout(timer); timer = undefined;
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration(webPath());
      if (registration?.getNotifications) {
        const notifications = await registration.getNotifications();
        for (const notification of notifications) if (notification.tag.startsWith('ftracker:')) notification.close();
      }
    }
  });
}
