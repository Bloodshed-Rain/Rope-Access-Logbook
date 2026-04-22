import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { CloudClient } from '../cloud/cloudClient';
import { useAuthSession } from './useAuthSession';
import { navigationRef } from '../navigation/RootNavigator';

function navigateToSignRequest(requestId: string, attempt = 0) {
  if (!requestId) return;
  if (navigationRef.isReady()) {
    navigationRef.navigate('SignRequestDetail', { requestId });
    return;
  }
  if (attempt > 40) return; // ~4s — give up rather than loop forever on a killed-state nav tree.
  setTimeout(() => navigateToSignRequest(requestId, attempt + 1), 100);
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function useNotifications(cloud: CloudClient) {
  const { session } = useAuthSession(cloud);
  const [expoPushToken, setExpoPushToken] = useState('');
  const responseListener = useRef<Notifications.Subscription | null>(null);

  useEffect(() => {
    if (!session?.user_id) return;

    async function registerForPushNotificationsAsync() {
      let token = '';

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF6600',
        });
      }

      if (Device.isDevice) {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted') {
          console.warn('Failed to get push token for push notification!');
          return;
        }
        try {
          const projectId = Constants.expoConfig?.extra?.eas?.projectId || '20f2ef58-1e1a-4401-a37e-85024a42b91a';
          token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
          setExpoPushToken(token);

          // Register the token with Supabase
          await cloud.registerPushToken(token);
        } catch (e) {
          console.warn('Error fetching push token', e);
        }
      } else {
        console.warn('Must use physical device for Push Notifications');
      }
    }

    registerForPushNotificationsAsync();

    // Cold-start: the app was launched by tapping a notification.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      const requestId = (response?.notification.request.content.data as { requestId?: string } | undefined)?.requestId;
      if (requestId) navigateToSignRequest(requestId);
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const requestId = (response.notification.request.content.data as { requestId?: string })?.requestId;
      if (requestId) navigateToSignRequest(requestId);
    });

    return () => {
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, [session?.user_id, cloud]);

  return { expoPushToken };
}
