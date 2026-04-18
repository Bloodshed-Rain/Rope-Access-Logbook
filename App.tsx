import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, View, Text } from 'react-native';
import * as Linking from 'expo-linking';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from './src/theme/ThemeProvider';
import { RootNavigator } from './src/navigation/RootNavigator';
import { initializeDatabase, getClient } from './src/db/initialize';
import { colors } from './src/theme/tokens';
import { createSupabaseCloudClient } from './src/cloud/supabaseClient';
import { createExpoFsAbstraction } from './src/cloud/fsAbstraction';
import { createCloudBackupService } from './src/services/cloudBackupService';
import { createExportService } from './src/services/exportService';
import { sha256 } from './src/utils/hash';
import { APP_VERSION } from './src/constants';

const queryClient = new QueryClient();

export default function App() {
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
    });
    return () => sub.remove();
  }, [dbReady]);

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (url.startsWith('logbook://auth-callback')) {
        // supabase-js detectSessionInUrl + onAuthStateChange picks up the token.
      }
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
  if (!dbReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider><RootNavigator /></ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
