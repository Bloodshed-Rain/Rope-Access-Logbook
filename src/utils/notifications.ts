import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { GearItem } from '../types';

export async function scheduleCertExpiryNotifications(expiryDateIso: string) {
  if (Platform.OS === 'web') return;

  try {
    await Notifications.cancelAllScheduledNotificationsAsync();

    const expiryDate = new Date(`${expiryDateIso}T12:00:00Z`);
    const now = new Date();

    const sixtyDaysBefore = new Date(expiryDate);
    sixtyDaysBefore.setDate(sixtyDaysBefore.getDate() - 60);

    if (sixtyDaysBefore > now) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Certification expiring soon',
          body: 'Your SPRAT certification expires in 60 days. Time to schedule re-certification.',
        },
        trigger: { date: sixtyDaysBefore, type: Notifications.SchedulableTriggerInputTypes.DATE },
      });
    }

    if (expiryDate > now) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Certification expired',
          body: 'Your SPRAT certification expires today. Do not perform rope access work on an expired cert.',
        },
        trigger: { date: expiryDate, type: Notifications.SchedulableTriggerInputTypes.DATE },
      });
    }
  } catch (e) {
    // Ignore permissions/scheduling errors in tests or restricted environments
  }
}

// Per-gear local notifications: 30 days before next_inspection_due and on the
// due date itself. Identifiers are deterministic so re-scheduling cancels the
// previous round before creating new ones.
function gearNotifId(gearId: string, kind: '30d' | '0d'): string {
  return `gear-${gearId}-${kind}`;
}

export async function cancelGearInspectionNotifications(gearId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.cancelScheduledNotificationAsync(gearNotifId(gearId, '30d'));
  } catch { /* ignore */ }
  try {
    await Notifications.cancelScheduledNotificationAsync(gearNotifId(gearId, '0d'));
  } catch { /* ignore */ }
}

export async function scheduleGearInspectionNotifications(gear: GearItem): Promise<void> {
  if (Platform.OS === 'web') return;
  if (!gear.next_inspection_due || gear.retired_at) {
    await cancelGearInspectionNotifications(gear.id);
    return;
  }
  try {
    // Re-schedule = cancel-then-create. Without the cancel a moved due date
    // would leave an old notification queued for the original day.
    await cancelGearInspectionNotifications(gear.id);

    const dueDate = new Date(`${gear.next_inspection_due}T12:00:00Z`);
    const now = new Date();

    const thirtyBefore = new Date(dueDate);
    thirtyBefore.setDate(thirtyBefore.getDate() - 30);

    if (thirtyBefore > now) {
      await Notifications.scheduleNotificationAsync({
        identifier: gearNotifId(gear.id, '30d'),
        content: {
          title: 'Gear inspection due in 30 days',
          body: `${gear.name} is due for inspection on ${gear.next_inspection_due}.`,
          data: { gearId: gear.id, kind: 'gear_inspection_30d' },
        },
        trigger: { date: thirtyBefore, type: Notifications.SchedulableTriggerInputTypes.DATE },
      });
    }

    if (dueDate > now) {
      await Notifications.scheduleNotificationAsync({
        identifier: gearNotifId(gear.id, '0d'),
        content: {
          title: 'Gear inspection due today',
          body: `${gear.name} is due for inspection today. Don't use it on rope until it's been inspected.`,
          data: { gearId: gear.id, kind: 'gear_inspection_0d' },
        },
        trigger: { date: dueDate, type: Notifications.SchedulableTriggerInputTypes.DATE },
      });
    }
  } catch (e) {
    // Ignore permissions/scheduling errors in tests or restricted environments.
  }
}