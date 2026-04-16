import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './src/theme/ThemeProvider';
import { RootNavigator } from './src/navigation/RootNavigator';
import { initializeDatabase } from './src/db/initialize';
import { colors } from './src/theme/tokens';

const queryClient = new QueryClient();

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  useEffect(() => { initializeDatabase().then(() => setDbReady(true)); }, []);
  if (!dbReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider><RootNavigator /></ThemeProvider>
    </QueryClientProvider>
  );
}
