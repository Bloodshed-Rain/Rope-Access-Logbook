import React, { useState } from 'react';
import { View, Text, Switch, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Card, Button, Banner, SectionHeader } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useAuthSession } from '../hooks/useAuthSession';
import { useBackupStatus } from '../hooks/useBackupStatus';
import { useBackup } from '../hooks/useBackup';
import { useSubscriptionTier } from '../hooks/useSubscription';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { createAuthService } from '../services/authService';
import { createExportService } from '../services/exportService';
import { ProBadge } from '../primitives/ProBadge';
import { sha256 } from '../utils/hash';
import { DbClient } from '../db/client';
import { APP_VERSION } from '../constants';

interface ProfileCloudSectionProps {
  db: DbClient;
  profileId: string;
  photosInBackup: boolean;
  onChangePhotosInBackup: (v: boolean) => void;
  onDeleteAccount: () => void;
}

export function ProfileCloudSection({
  db,
  photosInBackup,
  onChangePhotosInBackup,
  onDeleteAccount,
}: ProfileCloudSectionProps) {
  const { colors, spacing, typography } = useTheme();
  const nav = useNavigation();
  const cloud = createSupabaseCloudClient();
  const fs = createExpoFsAbstraction();
  const { session, loading } = useAuthSession(cloud);
  const status = useBackupStatus(db);
  const backup = useBackup({
    db,
    cloud,
    fs,
    hash: sha256,
    exportService: createExportService(db),
    clock: () => new Date().toISOString(),
    appVersion: APP_VERSION,
  });
  const { data: tier } = useSubscriptionTier();
  const [signingOut, setSigningOut] = useState(false);

  if (loading) return null;

  if (!session) {
    return (
      <View>
        <SectionHeader label="CLOUD BACKUP" />
        <Card accent="navy" style={{ gap: spacing.sm }}>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            Not signed in. Your logbook lives only on this device.
          </Text>
          <Button
            title="Sign in to back up"
            onPress={() => (nav as unknown as { navigate: (name: string) => void }).navigate('Auth')}
          />
        </Card>
      </View>
    );
  }

  async function signOut() {
    Alert.alert(
      'Sign out?',
      'You will no longer be able to back up your data to the cloud until you sign back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            setSigningOut(true);
            try {
              await createAuthService(cloud).signOut();
            } finally {
              setSigningOut(false);
            }
          },
        },
      ]
    );
  }

  return (
    <View>
      <SectionHeader label="CLOUD BACKUP" />
      <Card accent="orange" style={{ gap: spacing.sm }}>
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          Signed in as {session.email ?? session.user_id}
        </Text>
        <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
          Last backed up: {status.data?.last_cloud_backup_at ?? 'never'}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: spacing.sm }}>
          <Text style={[typography.body, { color: colors.textPrimary, flex: 1 }]}>
            Include photos in backup
          </Text>
          <Switch value={photosInBackup} onValueChange={onChangePhotosInBackup} />
        </View>

        {backup.isError && <Banner variant="error" message={(backup.error as Error).message} />}
        {backup.data?.kind === 'failed' && (
          <Banner variant="error" message={`Backup failed: ${backup.data.message}`} />
        )}

        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {tier === 'pro' ? (
            <Button
              title={backup.isPending ? 'Backing up…' : 'Back up now'}
              onPress={() => backup.mutate()}
              disabled={backup.isPending}
              style={{ flex: 1 }}
            />
          ) : (
            <Button
              title="Upgrade to Pro"
              onPress={() => (nav as any).navigate('Paywall')}
              style={{ flex: 1 }}
            />
          )}

          <Button
            title={signingOut ? 'Wait…' : 'Sign out'}
            onPress={signOut}
            disabled={signingOut}
            variant="secondary"
            style={{ flex: 1 }}
          />
        </View>

        <Button
          title="Delete cloud backup + account"
          onPress={onDeleteAccount}
          variant="danger"
          style={{ marginTop: spacing.md }}
        />
      </Card>
    </View>
  );
}
