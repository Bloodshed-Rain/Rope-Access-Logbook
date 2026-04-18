import React from 'react';
import { Pressable, Text } from 'react-native';
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
import { SupervisorSearchScreen } from '../screens/SupervisorSearchScreen';
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
  SupervisorSearch: undefined;
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
        paddingTop: 10,
        paddingBottom: 10,
        height: 84,
      },
      tabBarLabelStyle: { fontSize: 13, fontWeight: '600', marginTop: 4 },
      tabBarIconStyle: { marginBottom: 2 },
      headerShown: false,
    }}>
      <Tab.Screen name="Logbook" component={LogbookScreen}
        options={{ tabBarIcon: ({ color }) => <BookOpen color={color} size={30} /> }} />
      <Tab.Screen name="Profile" component={ProfileScreen}
        options={{ tabBarIcon: ({ color }) => <User color={color} size={30} /> }} />
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

  // Themed default header: navy chrome, white title/chevrons. Individual
  // screens can opt out via `headerShown: false` (Onboarding, Main, Conflict).
  const defaultScreenOptions = {
    headerShown: true,
    headerStyle: { backgroundColor: colors.navy },
    headerTintColor: colors.textInverse,
    headerTitleStyle: { fontWeight: '700' as const },
    headerBackTitle: 'Back',
  };

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={defaultScreenOptions}>
        {!profile ? (
          <>
            <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Auth" component={AuthScreen} options={{ title: 'Sign in' }} />
            <Stack.Screen name="MagicLinkWait" component={MagicLinkWaitScreen} options={{ title: 'Check your email' }} />
          </>
        ) : conflict ? (
          <Stack.Screen name="CloudConflict" options={{ headerShown: false, gestureEnabled: false }}>
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
            {/* The Main tabs host their own navy header inside LogbookScreen /
                ProfileScreen, so the stack header stays off for that route. */}
            <Stack.Screen name="Main" component={TabNavigator} options={{ headerShown: false }} />
            <Stack.Screen
              name="EntryForm"
              component={EntryFormScreen}
              options={({ navigation }) => ({
                presentation: 'modal',
                title: 'Entry',
                headerLeft: () => (
                  <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
                    <Text style={{ color: colors.textInverse, fontSize: 16, fontWeight: '600' }}>Close</Text>
                  </Pressable>
                ),
              })}
            />
            <Stack.Screen name="EntryDetail" component={EntryDetailScreen} options={{ title: 'Entry detail' }} />
            <Stack.Screen name="Signature" component={SignatureScreen} options={{ title: 'Sign entry' }} />
            <Stack.Screen name="Auth" component={AuthScreen} options={{ title: 'Sign in' }} />
            <Stack.Screen name="MagicLinkWait" component={MagicLinkWaitScreen} options={{ title: 'Check your email' }} />
            <Stack.Screen name="SupervisorSearch" component={SupervisorSearchScreen} options={{ title: 'Add supervisor' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
