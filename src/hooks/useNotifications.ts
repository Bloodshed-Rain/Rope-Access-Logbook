import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useQueryClient } from '@tanstack/react-query';
import { CloudClient } from '../cloud/cloudClient';
import { useAuthSession } from './useAuthSession';
import { navigationRef } from '../navigation/RootNavigator';
import { getClient } from '../db/initialize';
import {
  createNotificationCenterService,
  NotificationKind,
} from '../services/notificationCenterService';
import { SignRequest } from '../types';

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

// Maps a push payload (which only carries `requestId`) onto an in-app
// notification row. We look the request up in the local cache to recover the
// status, then pick the kind based on which side of the request the current
// user sits on. Returns null when we can't determine a kind — caller skips
// the record() call rather than insert a misleading row.
async function deriveKindForPush(
  requestId: string,
  currentUserId: string,
): Promise<{ kind: NotificationKind; payload: Record<string, unknown> } | null> {
  const db = getClient();
  const row = await db.get<{ payload_json: string }>(
    'SELECT payload_json FROM sign_requests_cache WHERE id = ?',
    [requestId],
  );
  if (!row) return null;
  const req = JSON.parse(row.payload_json) as SignRequest;
  const isTech = req.tech_user_id === currentUserId;
  const isSupervisor = req.supervisor_user_id === currentUserId;
  const entryId = (req.entry_payload as { id?: string } | null)?.id ?? null;

  // Pending request landing on the supervisor's device → "received".
  // Any terminal transition we receive a push for routes per status:
  //   signed → tech sees "signed"
  //   declined → tech sees "declined"
  //   withdrawn → supervisor sees "withdrawn"
  if (isSupervisor && req.status === 'pending') {
    return {
      kind: 'sign_request_received',
      payload: { requestId, entryId, techUserId: req.tech_user_id },
    };
  }
  if (isTech && req.status === 'signed') {
    return {
      kind: 'sign_request_signed',
      payload: {
        requestId, entryId,
        supervisorName: req.supervisor_name_snapshot ?? '',
      },
    };
  }
  if (isTech && req.status === 'declined') {
    return {
      kind: 'sign_request_declined',
      payload: {
        requestId, entryId,
        supervisorName: req.supervisor_name_snapshot ?? '',
        reason: req.decline_reason ?? '',
      },
    };
  }
  if (isSupervisor && req.status === 'withdrawn') {
    return {
      kind: 'sign_request_withdrawn',
      payload: { requestId, entryId },
    };
  }
  return null;
}

export function useNotifications(cloud: CloudClient) {
  const { session } = useAuthSession(cloud);
  const [expoPushToken, setExpoPushToken] = useState('');
  const responseListener = useRef<Notifications.Subscription | null>(null);
  const receivedListener = useRef<Notifications.Subscription | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!session?.user_id) return;
    const userId = session.user_id;

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
      if (!requestId) return;
      navigateToSignRequest(requestId);
      // Tap on a backgrounded push — the receive listener doesn't fire in
      // that path on iOS, so record here too. Same best-effort treatment.
      (async () => {
        try {
          const derived = await deriveKindForPush(requestId, userId);
          if (!derived) return;
          const svc = createNotificationCenterService(getClient(), () => new Date().toISOString());
          await svc.record(derived);
          qc.invalidateQueries({ queryKey: ['notifications'] });
        } catch {
          /* swallow */
        }
      })();
    });

    // Foreground push receipt: hydrate the local notifications table so the
    // bell badge picks up activity even when the user hasn't tapped through
    // to the OS banner. The push payload only carries `requestId`, so we look
    // the cached request up to recover the kind. If the cache hasn't seen the
    // INSERT yet (supervisor receiving brand-new request, very fresh push),
    // we skip — the next foreground sync (App.tsx AppState 'active') runs the
    // catch-up and we'll record then. The plan calls this out as acceptable.
    receivedListener.current = Notifications.addNotificationReceivedListener(async (notification) => {
      const requestId = (notification.request.content.data as { requestId?: string })?.requestId;
      if (!requestId) return;
      try {
        const derived = await deriveKindForPush(requestId, userId);
        if (!derived) return;
        const svc = createNotificationCenterService(getClient(), () => new Date().toISOString());
        await svc.record(derived);
        qc.invalidateQueries({ queryKey: ['notifications'] });
      } catch {
        /* swallow — best-effort */
      }
    });

    return () => {
      if (responseListener.current) {
        responseListener.current.remove();
      }
      if (receivedListener.current) {
        receivedListener.current.remove();
      }
    };
  }, [session?.user_id, cloud, qc]);

  return { expoPushToken };
}
