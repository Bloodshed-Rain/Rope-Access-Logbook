import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Screen, Button, Card, Banner, SectionHeader } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useCloudStatePreview, useRestore, useReplaceCloud } from '../hooks/useRestore';
import { useBackup } from '../hooks/useBackup';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { sha256 } from '../utils/hash';
import { DbClient } from '../db/client';
import { createExportService } from '../services/exportService';
import { APP_VERSION } from '../constants';
import { CloudOff } from 'lucide-react-native';

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
    <Screen topDivider>
      <View style={{ flex: 1, padding: spacing.base, paddingBottom: spacing.xxl }}>
        <View style={{ alignItems: 'center', marginVertical: spacing.lg }}>
          <CloudOff color={colors.error} size={48} />
          <Text style={[typography.h1, { color: colors.textPrimary, textAlign: 'center', marginTop: spacing.md }]}>
            Conflict Detected
          </Text>
          <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm }]}>
            This device and your cloud backup have different data. Pick the one to keep. This cannot be undone.
          </Text>
        </View>

        {error && <Banner variant="error" message={error} />}

        <SectionHeader label="CLOUD BACKUP" />
        <Card accent="orange" style={{ marginBottom: spacing.md }}>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {preview.data?.entries_count ?? 0} entries, {preview.data?.signatures_count ?? 0}{' '}
            signatures
          </Text>
          <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
            Last backed up: {preview.data?.cloud_backed_up_at ?? 'unknown'}
          </Text>
        </Card>

        <SectionHeader label="LOCAL DEVICE" />
        <Card accent="navy" style={{ marginBottom: spacing.xl }}>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {localEntriesCount} entries, {localSignaturesCount} signatures
          </Text>
          <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
            Last synced: {localLastBackupAt ?? 'never'}
          </Text>
        </Card>

        <View style={{ gap: spacing.md }}>
          <Button
            title={busy ? 'Working…' : 'Keep Cloud Data'}
            onPress={keepCloud}
            disabled={busy}
            variant="danger"
            haptic
          />
          <Button
            title={busy ? 'Working…' : 'Keep Local Device Data'}
            onPress={replaceCloud}
            disabled={busy}
            variant="danger"
            haptic
          />
        </View>
        
      </View>
    </Screen>
  );
}
