import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { AppState, View, Text } from 'react-native';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import * as Linking from 'expo-linking';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from './src/theme/ThemeProvider';
import { RootNavigator } from './src/navigation/RootNavigator';
import { LoadingSpinner, ToastProvider, KeyboardDoneAccessory } from './src/primitives';
import { initializeDatabase, getClient } from './src/db/initialize';
import { colors } from './src/theme/tokens';
import { createSupabaseCloudClient } from './src/cloud/supabaseClient';
import { createExpoFsAbstraction } from './src/cloud/fsAbstraction';
import { getCloudBackupService } from './src/services/cloudBackupService';
import { createSupervisorConnectionsService } from './src/services/supervisorConnectionsService';
import { createSignRequestsService } from './src/services/signRequestsService';
import { createExportService } from './src/services/exportService';
import { createSubscriptionService } from './src/services/subscriptionService';
import { createNotificationCenterService } from './src/services/notificationCenterService';
import { createProfileService } from './src/services/profileService';
import { createGearService } from './src/services/gearService';
import { createGearCatalogService } from './src/services/gearCatalogService';
import { sha256 } from './src/utils/hash';
import { APP_VERSION } from './src/constants';

const queryClient = new QueryClient();

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    initializeDatabase()
      .then(() => setDbReady(true))
      .catch((err) => setDbError(String(err)));
  }, []);

  useEffect(() => {
    if (!dbReady) return;
    const db = getClient();

    // Initialize RevenueCat with an anonymous user. Identity is bridged
    // below once Supabase auth state resolves.
    const subSvc = createSubscriptionService(db);
    subSvc.init();

    const cloud = createSupabaseCloudClient();
    const fs = createExpoFsAbstraction();

    // Identity bridge: any change in Supabase session → matching call into
    // RevenueCat. logIn aliases the current anonymous RC user to the
    // Supabase user_id so purchases follow the user across reinstalls and
    // devices; logOut reverts to anonymous so the next signed-in user
    // starts clean. We invalidate the React Query subscription cache after
    // each transition so any open screen re-reads the resolved status.
    async function bridgeAuthToRC(userId: string | null) {
      try {
        if (userId) await subSvc.identify(userId);
        else await subSvc.signOut();
      } catch {
        /* identify/signOut already swallow internally; this is belt-and-braces */
      }
      queryClient.invalidateQueries({ queryKey: ['subscriptionStatus'] });
    }
    cloud.getSession()
      .then((s) => bridgeAuthToRC(s?.user_id ?? null))
      .catch(() => { /* offline cold-boot — leave RC anonymous */ });
    const unsubAuth = cloud.onAuthStateChange((s) => {
      bridgeAuthToRC(s?.user_id ?? null);
    });
    // Shared backup service — same instance is reused by useBackup so the
    // post-sign trigger, manual button, and this AppState→background trigger
    // all coordinate through the same throttle and in-flight mutex.
    const svc = getCloudBackupService({
      db,
      cloud,
      fs,
      hash: sha256,
      exportService: createExportService(db),
      clock: () => new Date().toISOString(),
      appVersion: APP_VERSION,
    });
    // Foreground reminders → notifications table. Mirrors expo-notifications
    // local nags (cert expiry, backup stale) into the in-app bell so the same
    // signal is visible whether the OS surfaces it or not. Both kinds dedupe
    // on (kind, day) so re-foregrounding the app doesn't accumulate rows.
    async function recordForegroundReminders() {
      try {
        const notif = createNotificationCenterService(db, () => new Date().toISOString());
        const profile = await createProfileService(db).getProfile();
        if (!profile) return;
        const today = new Date();
        const todayStr = today.toISOString().slice(0, 10);

        // Cert-expiry: pick whichever cert(s) the profile holds. For each held
        // cert, if the expiry is today → record cert_expiry_0d; else if within
        // 60 days → record cert_expiry_60d. dedupeOnDay keeps the badge from
        // double-incrementing on tab-back.
        const certWindows: Array<{ scheme: 'sprat' | 'irata'; expiresOn: string | null }> = [
          { scheme: 'sprat', expiresOn: profile.holds_sprat ? profile.cert_expires_on : null },
          { scheme: 'irata', expiresOn: profile.holds_irata ? profile.irata_expires_on : null },
        ];
        for (const c of certWindows) {
          if (!c.expiresOn) continue;
          if (c.expiresOn === todayStr) {
            await notif.record({
              kind: 'cert_expiry_0d',
              payload: { scheme: c.scheme, expiresOn: c.expiresOn },
              dedupeOnDay: true,
            });
            continue;
          }
          // Compute days-until in UTC to match the convention used by
          // backupService.certExpiryStatus.
          const expiryMs = new Date(c.expiresOn + 'T00:00:00Z').getTime();
          const daysUntil = Math.floor((expiryMs - today.getTime()) / (24 * 60 * 60 * 1000));
          if (daysUntil > 0 && daysUntil <= 60) {
            await notif.record({
              kind: 'cert_expiry_60d',
              payload: { scheme: c.scheme, expiresOn: c.expiresOn, daysUntil },
              dedupeOnDay: true,
            });
          }
        }

        // Backup stale: only meaningful when the user has at least one cloud
        // backup on record. A never-backed-up user is nudged by the existing
        // local-export reminder (backupService.shouldShowReminder), not this.
        if (profile.last_cloud_backup_at) {
          const lastMs = new Date(profile.last_cloud_backup_at).getTime();
          const daysSince = Math.floor((today.getTime() - lastMs) / (24 * 60 * 60 * 1000));
          if (daysSince > 30) {
            await notif.record({
              kind: 'backup_stale',
              payload: { daysSince, lastBackupAt: profile.last_cloud_backup_at },
              dedupeOnDay: true,
            });
          }
        }

        // Gear inspections: surface anything due within 30 days, plus due
        // today / overdue, into the bell. dedupeKey: gearId so multiple
        // items due on the same day each get their own row.
        try {
          const gearSvc = createGearService(db);
          const dueSoon = await gearSvc.listDue(30);
          for (const item of dueSoon) {
            if (!item.next_inspection_due) continue;
            const dueMs = new Date(item.next_inspection_due + 'T00:00:00Z').getTime();
            const daysUntil = Math.floor((dueMs - today.getTime()) / (24 * 60 * 60 * 1000));
            const kind = daysUntil <= 0 ? 'gear_inspection_0d' : 'gear_inspection_30d';
            await notif.record({
              kind,
              payload: { gearId: item.id, name: item.name, dueOn: item.next_inspection_due, daysUntil },
              dedupeOnDay: true,
              dedupeKey: item.id,
            });
          }
        } catch {
          /* best-effort, silent */
        }
      } catch {
        /* best-effort, silent */
      }
    }

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        svc.backup().catch(() => { /* swallow; errors surface via UI hooks */ });
      }
      if (state === 'active') {
        (async () => {
          try {
            const conns = createSupervisorConnectionsService(db, cloud);
            await conns.sync();
            const signReqs = createSignRequestsService(db, cloud, fs, sha256);
            await signReqs.sync();
            // Gear catalog: 12h consideration throttle + 7d staleness gate
            // inside the service, so this is at most one network call per week.
            const catalogSvc = createGearCatalogService(cloud);
            await catalogSvc.refreshIfStale();
          } catch {
            // best-effort, silent
          }
          await recordForegroundReminders();
        })();
      }
    });
    // Also fire once on mount — AppState 'active' doesn't re-fire on cold
    // boot, so without this the foreground reminders only land on a true
    // background→foreground transition.
    recordForegroundReminders();
    return () => {
      sub.remove();
      unsubAuth();
    };
  }, [dbReady]);

  useEffect(() => {
    async function handleAuthCallback(url: string) {
      try {
        const code = new URL(url).searchParams.get('code');
        if (!code) return;
        const cloud = createSupabaseCloudClient();
        await cloud.exchangeAuthCode(code);
      } catch {
        /* swallow — UI surfaces auth errors via the in-app session listener */
      }
    }
    // Handle case where the app is launched cold via the magic-link tap.
    Linking.getInitialURL().then((url) => {
      if (url && url.startsWith('logbook://auth-callback')) handleAuthCallback(url);
    });
    // Handle the warm case (app already running).
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (url.startsWith('logbook://auth-callback')) handleAuthCallback(url);
    });
    return () => sub.remove();
  }, []);

  if (dbError) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bgApp, padding: 20 }}>
        <Text style={{ color: 'red', fontSize: 16, textAlign: 'center' }}>Database init failed: {dbError}</Text>
      </View>
    );
  }
  if (!dbReady || !fontsLoaded) {
    return <LoadingSpinner fullScreen label="Preparing logbook" />;
  }
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ToastProvider>
            <RootNavigator />
            {/* iOS-only Done bar above the keyboard. No-op on Android.
                Mounted once at root so Input/Textarea anywhere can opt in
                via inputAccessoryViewID (defaulted by the primitives). */}
            <KeyboardDoneAccessory />
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
