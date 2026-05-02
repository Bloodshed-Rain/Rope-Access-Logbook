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
import { LoadingSpinner, ToastProvider } from './src/primitives';
import { initializeDatabase, getClient } from './src/db/initialize';
import { colors } from './src/theme/tokens';
import { createSupabaseCloudClient } from './src/cloud/supabaseClient';
import { createExpoFsAbstraction } from './src/cloud/fsAbstraction';
import { createCloudBackupService } from './src/services/cloudBackupService';
import { createSupervisorConnectionsService } from './src/services/supervisorConnectionsService';
import { createSignRequestsService } from './src/services/signRequestsService';
import { createExportService } from './src/services/exportService';
import { createSubscriptionService } from './src/services/subscriptionService';
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
    
    // Initialize RevenueCat
    createSubscriptionService(db).init();

    const cloud = createSupabaseCloudClient();
    const fs = createExpoFsAbstraction();
    const svc = createCloudBackupService({
      db,
      cloud,
      fs,
      hash: sha256,
      exportService: createExportService(db),
      clock: () => new Date().toISOString(),
      appVersion: APP_VERSION,
    });
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
          } catch {
            // best-effort, silent
          }
        })();
      }
    });
    return () => sub.remove();
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
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background, padding: 20 }}>
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
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
