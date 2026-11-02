import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Reminder, Snapshot } from '../core/types';
import { isTrackerNotification, planNotifications } from './notificationSchedule';
import { planDailySummaries } from './dailySummary';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const CHANNEL = 'ftracker-reminders';
let pending: Promise<unknown> = Promise.resolve();

function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = pending.then(work, work);
  pending = next.catch(() => undefined);
  return next;
}

function permissionGranted(permission: Notifications.NotificationPermissionsStatus): boolean {
  return permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

/** Prompts are offered during setup and from notification settings. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Personal reminders', importance: Notifications.AndroidImportance.DEFAULT });
  }
  const existing = await Notifications.getPermissionsAsync();
  if (permissionGranted(existing)) return true;
  return permissionGranted(await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } }));
}

export interface NotificationSyncResult { scheduled: number; truncated: boolean; permissionGranted: boolean; summaries?:number }

export async function getNotificationStatus():Promise<{granted:boolean;canAskAgain:boolean;pendingReminders:number;pendingSummaries:number}>{
  const permission=await Notifications.getPermissionsAsync(),requests=await Notifications.getAllScheduledNotificationsAsync();
  return {granted:permissionGranted(permission),canAskAgain:permission.canAskAgain,pendingReminders:requests.filter(r=>isTrackerNotification(r.identifier)&&!r.identifier.startsWith('ftracker:summary:')).length,pendingSummaries:requests.filter(r=>r.identifier.startsWith('ftracker:summary:')).length};
}

export async function sendTestNotification(sound: string): Promise<void> {
  if (!(await requestNotificationPermission())) throw new Error('Allow notifications in iPhone settings before testing an alert.');
  const channelId = `${CHANNEL}-${sound.replace(/[^a-z]/g, '')}`;
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(channelId, { name: 'Reminder preview', importance: Notifications.AndroidImportance.HIGH, sound: sound === 'none' ? null : sound });
  await Notifications.scheduleNotificationAsync({
    identifier: `ftracker-test:${Date.now()}`,
    content: { title: 'Robb Tracker', body: 'This is how your reminder will sound.', sound: sound === 'none' ? false : sound },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5, repeats: false, ...(Platform.OS === 'android' ? { channelId } : {}) },
  });
}

/** No internet or push token is involved. Definitions remain in SQLite on any error. */
export function reconcileNotifications(reminders: Reminder[], enabled: boolean, sound = 'default', snapshot?:Snapshot): Promise<NotificationSyncResult> {
  return serial(async () => {
    const permission = await Notifications.getPermissionsAsync();
    const permitted = permissionGranted(permission);
    const reminderById = new Map(reminders.map(reminder => [reminder.id, reminder]));
    const summaries=permitted&&enabled&&snapshot?planDailySummaries(snapshot):[];
    const plan = enabled && permitted ? planNotifications(reminders,new Date(),60-summaries.length) : { notifications: [], truncated: false };
    const channelId = `${CHANNEL}-${sound.replace(/[^a-z]/g, '')}`;
    if (Platform.OS === 'android' && (enabled||summaries.length>0) && permitted) {
      await Notifications.setNotificationChannelAsync(channelId, { name: `Reminders · ${sound === 'none' ? 'Silent' : sound}`, importance: Notifications.AndroidImportance.HIGH, sound: sound === 'none' ? null : sound });
    }
    const scheduled = plan.notifications.map(notification => ({ ...notification,
      identifier: `${notification.identifier}:${sound}:${reminderById.get(notification.reminderId)?.updatedAt ?? ''}` }));
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    const ours = existing.filter(request => isTrackerNotification(request.identifier));
    const desired = new Set([...scheduled,...summaries].map(notification => notification.identifier));
    const present = new Set(ours.map(request => request.identifier));
    for (const request of ours) {
      if (!desired.has(request.identifier)) await Notifications.cancelScheduledNotificationAsync(request.identifier);
    }
    for (const notification of scheduled) {
      if (present.has(notification.identifier)) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: notification.identifier,
        content: {
          title: 'Robb Tracker reminder',
          body: reminderById.get(notification.reminderId)?.title ?? 'You have a reminder.',
          sound: sound === 'none' ? false : sound,
          data: { ftracker: true, reminderId: notification.reminderId },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: notification.date,
          ...(Platform.OS === 'android' ? { channelId } : {}) },
      });
    }
    for(const summary of summaries){
      if(present.has(summary.identifier))continue;
      await Notifications.scheduleNotificationAsync({identifier:summary.identifier,content:{title:summary.title,body:summary.body,sound:sound==='none'?false:sound,data:{ftracker:true,summaryDay:summary.day}},trigger:{type:Notifications.SchedulableTriggerInputTypes.DATE,date:summary.date,...(Platform.OS==='android'?{channelId}:{})}});
    }
    return { scheduled: plan.notifications.length+summaries.length, summaries:summaries.length, truncated: plan.truncated, permissionGranted: permitted };
  });
}

export function cancelAll(): Promise<void> {
  return serial(async () => {
    const requests = await Notifications.getAllScheduledNotificationsAsync();
    for (const request of requests) {
      if (isTrackerNotification(request.identifier)) await Notifications.cancelScheduledNotificationAsync(request.identifier);
    }
  });
}
