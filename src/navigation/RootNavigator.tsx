import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, User } from 'lucide-react-native';
import { useProfile } from '../hooks/useProfile';
import { useEntries } from '../hooks/useEntries';
import { useBackupStatus } from '../hooks/useBackupStatus';
import { useCloudStatePreview } from '../hooks/useRestore';
import { useAuthSession } from '../hooks/useAuthSession';
import { colors } from '../theme/tokens';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { LogbookScreen } from '../screens/LogbookScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { EntryFormScreen } from '../screens/EntryFormScreen';
import { EntryDetailScreen } from '../screens/EntryDetailScreen';
import { SignatureScreen } from '../screens/SignatureScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { MagicLinkWaitScreen } from '../screens/MagicLinkWaitScreen';
import { CloudConflictScreen } from '../screens/CloudConflictScreen';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { createSigningService } from '../services/signingService';
import { getClient } from '../db/initialize';
import { APP_VERSION } from '../constants';

export type RootStackParamList = {
  Onboarding: undefined;
  Main: undefined;
  EntryForm: { entryId?: string; amendEntryId?: string } | undefined;
  EntryDetail: { entryId: string };
  Signature: { entryId: string };
  Auth: undefined;
  MagicLinkWait: { email: string };
  CloudConflict: undefined;
};

export type TabParamList = { Logbook: undefined; Profile: undefined; };

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function TabNavigator() {
  return (
    <Tab.Navigator screenOptions={{
      tabBarActiveTintColor: colors.accent,
      tabBarInactiveTintColor: colors.slateLighter,
      tabBarStyle: {
        backgroundColor: colors.navy,
        borderTopColor: colors.navy,
        paddingTop: 4,
        height: 60,
      },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      headerShown: false,
    }}>
      <Tab.Screen name="Logbook" component={LogbookScreen}
        options={{ tabBarIcon: ({ color, size }) => <BookOpen color={color} size={size} /> }} />
      <Tab.Screen name="Profile" component={ProfileScreen}
        options={{ tabBarIcon: ({ color, size }) => <User color={color} size={size} /> }} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { data: profile, isLoading } = useProfile();
  const cloud = React.useMemo(() => createSupabaseCloudClient(), []);
  const fs = React.useMemo(() => createExpoFsAbstraction(), []);
  const { session, loading: sessionLoading } = useAuthSession(cloud);
  const db = profile ? getClient() : null;
  const preview = useCloudStatePreview(
    { db: db!, cloud, fs, appVersion: APP_VERSION },
    !!profile && session !== null,
  );
  const { data: localEntries } = useEntries();
  const { data: signatures } = useQuery({
    queryKey: ['signaturesAll'],
    queryFn: () => createSigningService(getClient()).getAllSignatures(),
    enabled: !!profile,
  });
  const { data: backupStatus } = useBackupStatus(db ?? getClient());

  const conflict = React.useMemo(() => {
    if (!session || !profile || !preview.data) return false;
    if (!preview.data.has_cloud_data) return false;
    const localHasData = (localEntries?.length ?? 0) > 0;
    if (!localHasData) return false;
    return backupStatus?.last_uploaded_backup_id !== preview.data.backup_id;
  }, [session, profile, localEntries, preview.data, backupStatus]);

  if (isLoading) return null;
  if (profile && session !== null && sessionLoading) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!profile ? (
          <>
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
            <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: true, title: 'Sign in' }} />
            <Stack.Screen name="MagicLinkWait" component={MagicLinkWaitScreen} options={{ headerShown: true, title: 'Check your email' }} />
          </>
        ) : conflict ? (
          <Stack.Screen name="CloudConflict" options={{ gestureEnabled: false }}>
            {() => (
              <CloudConflictScreen
                db={getClient()}
                localEntriesCount={localEntries?.length ?? 0}
                localSignaturesCount={signatures?.length ?? 0}
                localLastBackupAt={backupStatus?.last_cloud_backup_at ?? null}
              />
            )}
          </Stack.Screen>
        ) : (
          <>
            <Stack.Screen name="Main" component={TabNavigator} />
            <Stack.Screen name="EntryForm" component={EntryFormScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="EntryDetail" component={EntryDetailScreen} />
            <Stack.Screen name="Signature" component={SignatureScreen} />
            <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: true, title: 'Sign in' }} />
            <Stack.Screen name="MagicLinkWait" component={MagicLinkWaitScreen} options={{ headerShown: true, title: 'Check your email' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
