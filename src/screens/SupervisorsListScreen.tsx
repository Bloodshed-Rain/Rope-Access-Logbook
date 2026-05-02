// src/screens/SupervisorsListScreen.tsx
// Pushable screen reachable from Settings → Supervisors. Houses the supervisor
// capability toggle (with cert-number + directory-visibility sub-fields), the
// connections list (accepted + pending invites), and an "Add supervisor"
// entry-point to SupervisorSearchScreen. Lifted from the legacy
// SupervisorsSection card with v2 polish.

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen, Button, Input, useToast } from '../primitives';
import { StatusPill } from '../primitives/v2';
import { useTheme } from '../theme/ThemeProvider';
import { useProfile } from '../hooks/useProfile';
import { useAuthSession } from '../hooks/useAuthSession';
import { useSupervisorConnections } from '../hooks/useSupervisorConnections';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createProfileService } from '../services/profileService';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SupervisorsListScreen() {
  const { colors, spacing, typography, radii, shadows, borders } = useTheme();
  const navigation = useNavigation<Nav>();
  const toast = useToast();

  const db = useMemo(() => getClient(), []);
  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const { data: profile } = useProfile();
  const { session } = useAuthSession(cloud);
  const profileService = useMemo(() => createProfileService(db), [db]);
  const conns = useSupervisorConnections({ db, cloud });

  const [showEnableForm, setShowEnableForm] = useState(false);
  const [certInput, setCertInput] = useState('');
  const [directoryVisible, setDirectoryVisible] = useState(true);

  if (!profile) {
    return (
      <Screen padded={false}>
        <View />
      </Screen>
    );
  }

  const capabilityOn = profile.supervisor_capability_enabled;
  const authUserId = session?.user_id ?? null;
  const connections = conns.query.data ?? [];
  const myRows = authUserId
    ? connections.filter((c) => c.tech_user_id === authUserId)
    : [];
  const accepted = myRows.filter((c) => c.status === 'accepted');
  const pendingOutgoing = myRows.filter((c) => c.status === 'pending');

  const requestEnable = () => {
    setCertInput(profile.supervisor_cert_number ?? '');
    setDirectoryVisible(true);
    setShowEnableForm(true);
  };

  const confirmEnable = async () => {
    if (!certInput.trim()) return;
    try {
      await profileService.enableSupervisorCapability(
        certInput.trim(),
        profile.full_name,
        directoryVisible,
        cloud,
      );
      setShowEnableForm(false);
      setCertInput('');
      conns.query.refetch();
      toast.show({ message: 'Supervising turned on', variant: 'ok' });
    } catch (e) {
      Alert.alert('Could not enable', (e as Error).message);
    }
  };

  const requestDisable = () => {
    Alert.alert(
      'Turn off supervising?',
      'You will be removed from the supervisor directory. In-flight requests must be resolved first.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: async () => {
            try {
              // TODO: count real pending requests (Task 16). Pass 0 for now.
              await profileService.disableSupervisorCapability(0, cloud);
              conns.query.refetch();
              toast.show({ message: 'Supervising turned off', variant: 'ok' });
            } catch (e) {
              const msg = (e as Error).message;
              if (msg === 'pending_requests_exist') {
                Alert.alert(
                  'Resolve pending requests',
                  'Decline or sign any pending sign requests before turning off supervising.',
                );
              } else {
                Alert.alert('Could not disable', msg);
              }
            }
          },
        },
      ],
    );
  };

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{
          padding: spacing.base,
          paddingBottom: spacing.xxl,
          gap: spacing.base,
        }}
      >
        {/* Capability toggle card */}
        <View
          style={{
            backgroundColor: colors.bgSurface,
            borderRadius: radii.md,
            padding: spacing.base,
            gap: spacing.sm,
            ...shadows.sm,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[typography.bodyMed, { color: colors.textPrimary }]}>
                I supervise others
              </Text>
              <Text style={[typography.caption, { color: colors.textSecondary }]}>
                {capabilityOn
                  ? 'Visible in the supervisor directory'
                  : 'Turn on to receive sign requests'}
              </Text>
            </View>
            <Switch
              value={capabilityOn}
              onValueChange={(v) => {
                if (v) requestEnable();
                else requestDisable();
              }}
            />
          </View>

          {capabilityOn && profile.supervisor_cert_number && (
            <View
              style={{
                paddingTop: spacing.sm,
                borderTopWidth: borders.hair,
                borderTopColor: colors.divider,
              }}
            >
              <Text style={[typography.caption, { color: colors.textSecondary }]}>
                SPRAT Level III cert
              </Text>
              <Text style={[typography.body, { color: colors.textPrimary }]}>
                #{profile.supervisor_cert_number}
              </Text>
            </View>
          )}

          {showEnableForm && (
            <View
              style={{
                gap: spacing.sm,
                paddingTop: spacing.sm,
                borderTopWidth: borders.hair,
                borderTopColor: colors.divider,
              }}
            >
              <Input
                label="SPRAT Level III cert number"
                value={certInput}
                onChangeText={(t) => setCertInput(t.replace(/\D/g, '').slice(0, 5))}
                placeholder="12345"
                keyboardType="number-pad"
                maxLength={5}
              />
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: spacing.md,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[typography.body, { color: colors.textPrimary }]}>
                    List me in the supervisor directory
                  </Text>
                  <Text style={[typography.caption, { color: colors.textSecondary }]}>
                    Allows techs to find you by name or cert number
                  </Text>
                </View>
                <Switch value={directoryVisible} onValueChange={setDirectoryVisible} />
              </View>
              <Button
                title="Enable supervising"
                onPress={confirmEnable}
                disabled={!certInput.trim()}
              />
              <Button
                title="Cancel"
                variant="secondary"
                onPress={() => {
                  setShowEnableForm(false);
                  setCertInput('');
                }}
              />
            </View>
          )}
        </View>

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
