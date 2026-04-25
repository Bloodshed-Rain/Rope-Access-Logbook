import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { Gauge as GaugeIcon, BookOpen, User, Inbox } from 'lucide-react-native';
import { useProfile } from '../hooks/useProfile';
import { useEntries } from '../hooks/useEntries';
import { useBackupStatus } from '../hooks/useBackupStatus';
import { useCloudStatePreview } from '../hooks/useRestore';
import { useAuthSession } from '../hooks/useAuthSession';
import { useNotifications } from '../hooks/useNotifications';
import { colors } from '../theme/tokens';
import { LoadingSpinner } from '../primitives/LoadingSpinner';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { LogbookScreen } from '../screens/LogbookScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { EntryFormScreen } from '../screens/EntryFormScreen';
import { EntryDetailScreen } from '../screens/EntryDetailScreen';
import { SignatureScreen } from '../screens/SignatureScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { MagicLinkWaitScreen } from '../screens/MagicLinkWaitScreen';
import { CloudConflictScreen } from '../screens/CloudConflictScreen';
import { SupervisorSearchScreen } from '../screens/SupervisorSearchScreen';
import { InboxScreen } from '../screens/InboxScreen';
import { SignRequestDetailScreen } from '../screens/SignRequestDetailScreen';
import { PaywallScreen } from '../screens/PaywallScreen';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { createSigningService } from '../services/signingService';
import { getClient } from '../db/initialize';
import { APP_VERSION } from '../constants';

export type RootStackParamList = {
  Onboarding: undefined;
  Main: undefined;
  LogbookList: undefined;
  EntryForm: { entryId?: string; amendEntryId?: string } | undefined;
  EntryDetail: { entryId: string };
  Signature: { entryId: string };
  Auth: undefined;
  MagicLinkWait: { email: string };
  CloudConflict: undefined;
  SupervisorSearch: undefined;
  SignRequestDetail: { requestId: string };
  Paywall: undefined;
};

export type TabParamList = { Dashboard: undefined; Inbox: undefined; Profile: undefined; };

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function TabNavigator({ showInbox }: { showInbox: boolean }) {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.accentBase,
        tabBarInactiveTintColor: colors.inkTertiary,
        tabBarStyle: {
          backgroundColor: colors.bgRaised,
          borderTopWidth: 1,
          borderTopColor: colors.edgeHi,
          paddingTop: 8,
          paddingBottom: 8,
          height: 64,
        },
        tabBarLabel: ({ focused, color, children }) => (
          <View style={{ alignItems: 'center', marginTop: 2 }}>
            <Text
              style={{
                fontFamily: 'Michroma_400Regular',
                fontSize: 8,
                letterSpacing: 1.4,
                color,
              }}
            >
              {String(children).toUpperCase()}
            </Text>
            {focused && (
              <View
                style={{
                  width: 16,
                  height: 1.5,
                  backgroundColor: colors.accentBase,
                  marginTop: 3,
                }}
              />
            )}
          </View>
        ),
        tabBarIconStyle: { marginBottom: 0 },
        headerShown: false,
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ tabBarIcon: ({ color }) => <GaugeIcon color={color} size={24} /> }}
      />
      {showInbox ? (
        <Tab.Screen
          name="Inbox"
          component={InboxScreen}
          options={{ tabBarIcon: ({ color }) => <Inbox color={color} size={24} /> }}
        />
      ) : null}
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarIcon: ({ color }) => <User color={color} size={24} /> }}
      />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const { data: profile, isLoading } = useProfile();
  const cloud = React.useMemo(() => createSupabaseCloudClient(), []);
  useNotifications(cloud);
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

  if (isLoading) return <LoadingSpinner fullScreen label="Loading profile" />;
  if (profile && session !== null && sessionLoading) {
    return <LoadingSpinner fullScreen label="Checking cloud session" />;
  }

  // Themed default header: dark chrome with bottom hairline divider.
  // Individual screens can opt out via `headerShown: false`.
  const defaultScreenOptions = {
    headerShown: true,
    headerStyle: { backgroundColor: colors.bgRaised },
    headerTintColor: colors.inkPrimary,
    headerTitleStyle: {
      fontFamily: 'Michroma_400Regular',
      fontSize: 11,
      letterSpacing: 1.6,
    },
    headerBackTitle: 'Back',
    headerBackground: () => (
      <View style={{ flex: 1, backgroundColor: colors.bgRaised }}>
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 1,
            backgroundColor: colors.edgeHi,
          }}
        />
      </View>
    ),
  };

  return (
    <NavigationContainer ref={navigationRef}>
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
            <Stack.Screen name="Main" options={{ headerShown: false }}>
              {() => <TabNavigator showInbox={!!profile?.supervisor_capability_enabled} />}
            </Stack.Screen>
            <Stack.Screen
              name="LogbookList"
              component={LogbookScreen}
              options={{ title: 'All entries' }}
            />
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
            <Stack.Screen name="SignRequestDetail" component={SignRequestDetailScreen} options={{ title: 'Sign request' }} />
            <Stack.Screen name="Paywall" component={PaywallScreen} options={{ presentation: 'modal', headerShown: false }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
