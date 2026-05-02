import React from 'react';
import { Text, View } from 'react-native';
import {
  NavigationContainer,
  NavigatorScreenParams,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useQuery } from '@tanstack/react-query';
import { Home, BookOpen, User, Inbox } from 'lucide-react-native';
import { useProfile } from '../hooks/useProfile';
import { useEntries } from '../hooks/useEntries';
import { useBackupStatus } from '../hooks/useBackupStatus';
import { useCloudStatePreview } from '../hooks/useRestore';
import { useAuthSession } from '../hooks/useAuthSession';
import { useNotifications } from '../hooks/useNotifications';
import { colors, typography } from '../theme/tokens';
import { LoadingSpinner } from '../primitives/LoadingSpinner';
import { useToast } from '../primitives/Toast';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { TodayScreen } from '../screens/TodayScreen';
import { RecordsScreen } from '../screens/RecordsScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { MeScreen } from '../screens/MeScreen';
import { SupervisorsListScreen } from '../screens/SupervisorsListScreen';
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
import { PostSaveSheet } from '../screens/PostSaveSheet';
import { SignatureOptionsSheet } from '../screens/SignatureOptionsSheet';
import { SendSignRequestScreen } from '../screens/SendSignRequestScreen';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { createSigningService } from '../services/signingService';
import { getClient } from '../db/initialize';
import { APP_VERSION } from '../constants';

export type ChipKey = 'all' | 'drafts' | 'needs_signature' | 'awaiting' | 'signed';

export type RootStackParamList = {
  Onboarding: undefined;
  Main: NavigatorScreenParams<TabParamList> | undefined;
  EntryForm: { entryId?: string; amendEntryId?: string } | undefined;
  EntryDetail: { entryId: string };
  Signature: { entryId: string };
  Auth: undefined;
  MagicLinkWait: { email: string };
  CloudConflict: undefined;
  SupervisorSearch: undefined;
  SupervisorsList: undefined;
  SignRequestDetail: { requestId: string };
  Paywall: undefined;
  Notifications: undefined;
  PostSaveSheet: { entryId: string };
  SignatureOptionsSheet: { entryId: string };
  SendSignRequest: { entryId: string };
};

export type TabParamList = {
  Today: undefined;
  Records: { filter?: ChipKey } | undefined;
  Inbox: undefined;
  Me: undefined;
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function TabNavigator({ showInbox }: { showInbox: boolean }) {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.accentPrimary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.bgSurface,
          borderTopWidth: 1,
          borderTopColor: colors.divider,
          paddingTop: 8,
          paddingBottom: 8,
          height: 64,
        },
        tabBarLabel: ({ color, children }) => (
          <Text
            style={{
              ...typography.caption,
              color,
              marginTop: 2,
            }}
          >
            {children}
          </Text>
        ),
        tabBarIconStyle: { marginBottom: 0 },
        headerShown: false,
      }}
    >
      <Tab.Screen
        name="Today"
        component={TodayScreen}
        options={{ tabBarIcon: ({ color }) => <Home color={color} size={24} strokeWidth={1.5} /> }}
      />
      <Tab.Screen
        name="Records"
        component={RecordsScreen}
        options={{ tabBarIcon: ({ color }) => <BookOpen color={color} size={24} strokeWidth={1.5} /> }}
      />
      {showInbox ? (
        <Tab.Screen
          name="Inbox"
          component={InboxScreen}
          options={{ tabBarIcon: ({ color }) => <Inbox color={color} size={24} strokeWidth={1.5} /> }}
        />
      ) : null}
      <Tab.Screen
        name="Me"
        component={MeScreen}
        options={{ tabBarIcon: ({ color }) => <User color={color} size={24} strokeWidth={1.5} /> }}
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
  const toast = useToast();
  // Track auth transitions to toast on fresh sign-in. Skip the first settled
  // resolution: on cold boot a previously-signed-in user goes null → session
  // as AsyncStorage is read, and we don't want a toast on every launch.
  const sessionSettledOnceRef = React.useRef(false);
  const prevSessionRef = React.useRef<typeof session>(null);
  React.useEffect(() => {
    if (sessionLoading) return;
    if (!sessionSettledOnceRef.current) {
      sessionSettledOnceRef.current = true;
      prevSessionRef.current = session;
      return;
    }
    const prev = prevSessionRef.current;
    if (!prev && session) {
      toast.show({ message: 'Signed in', variant: 'ok' });
    }
    prevSessionRef.current = session;
  }, [session, sessionLoading, toast]);
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

  // Themed default header: white surface, Inter title, no shadow.
  // The 1px bottom hairline is rendered via headerBackground (native-stack
  // doesn't expose it directly; headerShadowVisible: false removes the iOS
  // shadow line). Screens that need stronger separation between header and
  // body should rely on `<Screen topDivider>`. Individual screens opt out
  // via `headerShown: false`.
  const defaultScreenOptions = {
    headerShown: true,
    headerStyle: { backgroundColor: colors.bgSurface },
    headerTintColor: colors.textPrimary,
    headerTitleStyle: {
      fontFamily: typography.title2.fontFamily,
      fontSize: typography.title2.fontSize,
      fontWeight: typography.title2.fontWeight,
      color: colors.textPrimary,
    },
    headerShadowVisible: false,
    headerBackTitle: 'Back',
    headerBackground: () => (
      <View style={{ flex: 1, backgroundColor: colors.bgSurface }}>
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 1,
            backgroundColor: colors.divider,
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
            {/* The Main tabs host their own headers inside each tab screen,
                so the stack header stays off for the Main route. */}
            <Stack.Screen name="Main" options={{ headerShown: false }}>
              {() => <TabNavigator showInbox={!!profile?.supervisor_capability_enabled} />}
            </Stack.Screen>
            <Stack.Screen
              name="EntryForm"
              component={EntryFormScreen}
              options={{ presentation: 'modal', headerShown: false }}
            />
            <Stack.Screen name="EntryDetail" component={EntryDetailScreen} options={{ title: 'Entry detail' }} />
            <Stack.Screen name="Signature" component={SignatureScreen} options={{ title: 'Sign entry' }} />
            <Stack.Screen name="Auth" component={AuthScreen} options={{ title: 'Sign in' }} />
            <Stack.Screen name="MagicLinkWait" component={MagicLinkWaitScreen} options={{ title: 'Check your email' }} />
            <Stack.Screen name="SupervisorSearch" component={SupervisorSearchScreen} options={{ title: 'Add supervisor' }} />
            <Stack.Screen name="SupervisorsList" component={SupervisorsListScreen} options={{ title: 'Supervisors' }} />
            <Stack.Screen name="SignRequestDetail" component={SignRequestDetailScreen} options={{ title: 'Sign request' }} />
            <Stack.Screen name="Paywall" component={PaywallScreen} options={{ presentation: 'modal', headerShown: false }} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
            {/* Both sheets render their visual presentation through the v2
                CenterModal / Sheet primitives, which already wrap content in
                an RN `<Modal>` with their own scrim + animation. The screen
                itself just hosts the route — `animation: 'none'` so the
                native-stack transition doesn't fight the inner Modal's
                animation. F2 cleanup may collapse this double-Modal pattern. */}
            <Stack.Screen
              name="PostSaveSheet"
              component={PostSaveSheet}
              options={{ presentation: 'transparentModal', animation: 'none', headerShown: false }}
            />
            <Stack.Screen
              name="SignatureOptionsSheet"
              component={SignatureOptionsSheet}
              options={{ presentation: 'transparentModal', animation: 'none', headerShown: false }}
            />
            {/* Full-screen modal — the screen renders its own header chrome,
                so we use `presentation: 'modal'` (not transparentModal) and
                turn the stack header off, matching EntryFormScreen. */}
            <Stack.Screen
              name="SendSignRequest"
              component={SendSignRequestScreen}
              options={{ presentation: 'modal', headerShown: false }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
