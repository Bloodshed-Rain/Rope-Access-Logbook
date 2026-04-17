import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Screen, Button, Card, Banner } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useCloudStatePreview, useRestore, useReplaceCloud } from '../hooks/useRestore';
import { useBackup } from '../hooks/useBackup';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { sha256 } from '../utils/hash';
import { DbClient } from '../db/client';
import { createExportService } from '../services/exportService';
import { APP_VERSION } from '../constants';

interface CloudConflictScreenProps {
  db: DbClient;
  localEntriesCount: number;
  localSignaturesCount: number;
  localLastBackupAt: string | null;
}

export function CloudConflictScreen({
  db,
  localEntriesCount,
  localSignaturesCount,
  localLastBackupAt,
}: CloudConflictScreenProps) {
  const { colors, spacing, typography } = useTheme();
  const nav = useNavigation();
  const cloud = createSupabaseCloudClient();
  const fs = createExpoFsAbstraction();
  const deps = { db, cloud, fs, appVersion: APP_VERSION };
  const backupDeps = {
    ...deps,
    hash: sha256,
    exportService: createExportService(db),
    clock: () => new Date().toISOString(),
  };
  const preview = useCloudStatePreview(deps, true);
  const restoreMut = useRestore(deps);
  const replaceMut = useReplaceCloud(deps);
  const backupMut = useBackup(backupDeps);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function keepCloud() {
    try {
      setBusy(true);
      setError(null);
      await restoreMut.mutateAsync();
      (nav as unknown as { navigate: (name: string) => void }).navigate('Logbook');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function replaceCloud() {
    try {
      setBusy(true);
      setError(null);
      await replaceMut.mutateAsync();
      await backupMut.mutateAsync();
      (nav as unknown as { navigate: (name: string) => void }).navigate('Logbook');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ padding: spacing.base, gap: spacing.base }}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>
          Your logbooks don&apos;t match
        </Text>
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          This device and your cloud backup have different data. Choose which one to keep. This
          can&apos;t be undone.
        </Text>

        {error && <Banner variant="error" message={error} />}

        <Card>
          <Text style={[typography.bodyBold, { color: colors.textPrimary }]}>
            Your cloud logbook
          </Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {preview.data?.entries_count ?? 0} entries, {preview.data?.signatures_count ?? 0}{' '}
            signatures
          </Text>
          <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
            Last backed up: {preview.data?.cloud_backed_up_at ?? 'unknown'}
          </Text>
        </Card>

        <Card>
          <Text style={[typography.bodyBold, { color: colors.textPrimary }]}>This device</Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {localEntriesCount} entries, {localSignaturesCount} signatures
          </Text>
          <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
            Last synced: {localLastBackupAt ?? 'never'}
          </Text>
        </Card>

        <Button
          title={busy ? 'Working…' : 'Keep cloud, replace this device'}
          onPress={keepCloud}
          disabled={busy}
        />
        <Button
          title={busy ? 'Working…' : 'Replace cloud with this device'}
          onPress={replaceCloud}
          disabled={busy}
          variant="secondary"
        />
      </View>
    </Screen>
  );
}
