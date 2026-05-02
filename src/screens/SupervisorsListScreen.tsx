// src/screens/SupervisorsListScreen.tsx
// Pushable screen reachable from Settings → Supervisors. Hosts the connections
// list (accepted + pending invites) and an "Invite supervisor" entry-point
// to SupervisorSearchScreen. The supervisor capability toggle, cert-number
// input, and directory-visibility toggle live in SettingsSheet per spec §6.

import React, { useMemo } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen, Button } from '../primitives';
import { StatusPill } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useProfile } from '../hooks/useProfile';
import { useAuthSession } from '../hooks/useAuthSession';
import { useSupervisorConnections } from '../hooks/useSupervisorConnections';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SupervisorsListScreen() {
  const { colors, spacing, typography, radii, shadows, borders } = useTheme();
  const navigation = useNavigation<Nav>();

  const db = useMemo(() => getClient(), []);
  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const { data: profile } = useProfile();
  const { session } = useAuthSession(cloud);
  const conns = useSupervisorConnections({ db, cloud });

  if (!profile) {
    return (
      <Screen padded={false}>
        <View />
      </Screen>
    );
  }

  const authUserId = session?.user_id ?? null;
  const connections = conns.query.data ?? [];
  const myRows = authUserId
    ? connections.filter((c) => c.tech_user_id === authUserId)
    : [];
  const accepted = myRows.filter((c) => c.status === 'accepted');
  const pendingOutgoing = myRows.filter((c) => c.status === 'pending');

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{
          padding: spacing.base,
          paddingBottom: spacing.xxl,
          gap: spacing.base,
        }}
      >
        {/* My supervisors */}
        <View
          style={{
            backgroundColor: colors.bgSurface,
            borderRadius: radii.md,
            ...shadows.sm,
          }}
        >
          <Text
            style={[
              typography.label,
              {
                color: colors.textSecondary,
                paddingHorizontal: spacing.base,
                paddingTop: spacing.base,
                paddingBottom: spacing.sm,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              },
            ]}
          >
            My supervisors
          </Text>

          {accepted.length === 0 && pendingOutgoing.length === 0 && (
            <Text
              style={[
                typography.body,
                {
                  color: colors.textSecondary,
                  paddingHorizontal: spacing.base,
                  paddingBottom: spacing.base,
                },
              ]}
            >
              No supervisors added yet.
            </Text>
          )}

          {accepted.map((c) => (
            <View
              key={c.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: spacing.base,
                paddingVertical: spacing.md,
                borderTopWidth: borders.hair,
                borderTopColor: colors.divider,
                gap: spacing.md,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={[typography.body, { color: colors.textPrimary }]}>
                  {c.supervisor_display_name ?? c.invited_email}
                </Text>
                <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>
                  Accepted
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  Alert.alert('Remove supervisor?', 'You can re-invite them later.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: async () => {
                        await conns.revoke.mutateAsync(c.id);
                      },
                    },
                  ]);
                }}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Text style={[typography.label, { color: colors.statusErr }]}>Remove</Text>
              </Pressable>
            </View>
          ))}

          {pendingOutgoing.length > 0 && (
            <>
              <Text
                style={[
                  typography.label,
                  {
                    color: colors.textSecondary,
                    paddingHorizontal: spacing.base,
                    paddingTop: spacing.md,
                    paddingBottom: spacing.sm,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  },
                ]}
              >
                Pending invites
              </Text>
              {pendingOutgoing.map((c) => (
                <View
                  key={c.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: spacing.base,
                    paddingVertical: spacing.md,
                    borderTopWidth: borders.hair,
                    borderTopColor: colors.divider,
                    gap: spacing.md,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.body, { color: colors.textPrimary }]}>
                      {c.invited_email}
                    </Text>
                    <Text
                      style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}
                    >
                      {c.supervisor_user_id ? 'Waiting for accept' : 'Waiting for signup'}
                    </Text>
                  </View>
                  <StatusPill variant="pending" label="Pending" />
                </View>
              ))}
            </>
          )}

          <View style={{ padding: spacing.base }}>
            <Button
              title="+ Invite supervisor"
              onPress={() => navigation.navigate('SupervisorSearch')}
            />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
