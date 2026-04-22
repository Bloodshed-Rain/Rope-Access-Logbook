import React, { useMemo, useState } from 'react';
import { View, Text, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, Button, Input, ListRow } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useProfile } from '../hooks/useProfile';
import { useAuthSession } from '../hooks/useAuthSession';
import { useSupervisorConnections } from '../hooks/useSupervisorConnections';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createProfileService } from '../services/profileService';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function PendingPill() {
  const { colors, spacing, typography, radii } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.warningLight,
        borderRadius: radii.full,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
      }}
    >
      <Text style={[typography.caption, { color: colors.warning, fontWeight: '600' }]}>Pending</Text>
    </View>
  );
}

export function SupervisorsSection() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const { data: profile } = useProfile();
  const db = useMemo(() => getClient(), []);
  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const { session } = useAuthSession(cloud);
  const profileService = useMemo(() => createProfileService(db), [db]);
  const conns = useSupervisorConnections({ db, cloud });

  const [showToggleForm, setShowToggleForm] = useState(false);
  const [certInput, setCertInput] = useState('');

  if (!profile) return null;
  const capabilityOn = profile.supervisor_capability_enabled;

  // tech_user_id in cloud rows is the Supabase auth user_id, not the local
  // profile.id (see supervisor-accounts design: references auth.users(id)).
  const authUserId = session?.user_id ?? null;
  const connections = conns.query.data ?? [];
  const myRows = authUserId
    ? connections.filter((c) => c.tech_user_id === authUserId)
    : [];
  const accepted = myRows.filter((c) => c.status === 'accepted');
  const pendingOutgoing = myRows.filter((c) => c.status === 'pending');

  const toggleCapability = async (on: boolean) => {
    if (on) {
      setShowToggleForm(true);
    } else {
      try {
        // Count pending requests where THIS user is the supervisor. For Part A we
        // don't yet have sign_requests_cache queries on the UI path, so pass 0.
        // Task 16 will wire the real count.
        await profileService.disableSupervisorCapability(0, cloud);
        conns.query.refetch();
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
    }
  };

  const confirmEnable = async () => {
    if (!certInput.trim()) return;
    try {
      await profileService.enableSupervisorCapability(
        certInput.trim(),
        profile.full_name,
        true,
        cloud,
      );
      setShowToggleForm(false);
      setCertInput('');
      conns.query.refetch();
    } catch (e) {
      Alert.alert('Could not enable', (e as Error).message);
    }
  };

  return (
    <Card>
      <Text style={[typography.h2, { color: colors.textPrimary, marginBottom: spacing.sm }]}>
        Supervisors
      </Text>

      <ListRow
        title="I supervise others"
        subtitle={capabilityOn ? 'Enabled' : 'Off'}
        onPress={() => toggleCapability(!capabilityOn)}
        right={
          <Button
            title={capabilityOn ? 'Turn off' : 'Turn on'}
            variant={capabilityOn ? 'ghost' : 'primary'}
            onPress={() => toggleCapability(!capabilityOn)}
          />
        }
      />

      {showToggleForm && (
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          <Input
            label="SPRAT Level III cert number"
            value={certInput}
            onChangeText={(t) => setCertInput(t.replace(/\D/g, '').slice(0, 5))}
            placeholder="12345"
            keyboardType="number-pad"
            maxLength={5}
          />
          <Button title="Enable supervising" onPress={confirmEnable} disabled={!certInput.trim()} />
          <Button
            title="Cancel"
            variant="ghost"
            onPress={() => {
              setShowToggleForm(false);
              setCertInput('');
            }}
          />
        </View>
      )}

      <View style={{ height: spacing.base }} />
      <Text style={[typography.bodyBold, { color: colors.textPrimary, marginBottom: spacing.xs }]}>
        My supervisors
      </Text>

      {accepted.length === 0 && (
        <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
          No supervisors added yet.
        </Text>
      )}

      {accepted.map((c) => (
        <ListRow
          key={c.id}
          title={c.supervisor_display_name ?? c.invited_email}
          subtitle="Accepted"
          onPress={() => {}}
          right={
            <Button
              title="Remove"
              variant="ghost"
              onPress={async () => {
                await conns.revoke.mutateAsync(c.id);
              }}
            />
          }
        />
      ))}

      {pendingOutgoing.length > 0 && (
        <>
          <View style={{ height: spacing.sm }} />
          <Text
            style={[typography.bodyBold, { color: colors.textPrimary, marginBottom: spacing.xs }]}
          >
            Pending invites
          </Text>
          {pendingOutgoing.map((c) => (
            <ListRow
              key={c.id}
              title={c.invited_email}
              subtitle={c.supervisor_user_id ? 'Waiting for accept' : 'Waiting for signup'}
              onPress={() => {}}
              right={<PendingPill />}
            />
          ))}
        </>
      )}

      <View style={{ height: spacing.sm }} />
      <Button title="Add supervisor" onPress={() => navigation.navigate('SupervisorSearch')} />
    </Card>
  );
}
