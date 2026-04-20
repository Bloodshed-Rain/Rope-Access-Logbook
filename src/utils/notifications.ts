import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

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