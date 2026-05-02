// src/screens/CloudConflictScreen.tsx
// Light-theme conflict resolution. Renders its own header (the route is
// configured `headerShown: false` in RootNavigator) plus two side-by-side
// surface cards (device vs cloud) and two destructive primary CTAs gated
// behind confirm Alerts. Shows a full-screen scrim + spinner while either
// mutation is in flight.

import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Cloud, Smartphone } from 'lucide-react-native';
import { Screen, Button, Banner, LoadingSpinner } from '../primitives';
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
  const { colors, spacing, typography, radii, borders, shadows } = useTheme();
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

  function confirmKeepCloud() {
    Alert.alert(
      'Keep cloud, replace this device?',
      'This will overwrite the local data on this device permanently.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace device', style: 'destructive', onPress: keepCloud },
      ],
    );
  }

  function confirmReplaceCloud() {
    Alert.alert(
      'Replace cloud with this device?',
      'This will overwrite the cloud data permanently.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace cloud', style: 'destructive', onPress: replaceCloud },
      ],
    );
  }

  const cloudEntries = preview.data?.entries_count ?? 0;
  const cloudSignatures = preview.data?.signatures_count ?? 0;
  const cloudBackedUpAt = preview.data?.cloud_backed_up_at ?? 'unknown';

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{
          padding: spacing.base,
          paddingBottom: spacing.xxl,
          gap: spacing.lg,
        }}
      >
        <View style={{ gap: spacing.sm }}>
          <Text style={[typography.title2, { color: colors.textPrimary }]}>
            Sync conflict — choose your data
          </Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            Your local data and cloud data don&apos;t match. Pick which one to keep —
            the other will be overwritten.
          </Text>
        </View>

        {error && <Banner variant="error" message={error} />}

        {/* Comparison cards — stacked */}
        <View style={{ gap: spacing.md }}>
          <View
            style={[
              {
                backgroundColor: colors.bgSurface,
                borderRadius: radii.md,
                borderWidth: borders.hair,
                borderColor: colors.border,
                padding: spacing.base,
                gap: spacing.sm,
              },
              shadows.sm,
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Smartphone size={20} color={colors.textPrimary} />
              <Text style={[typography.bodyMed, { color: colors.textPrimary }]}>
                On this device
              </Text>
            </View>
            <Text style={[typography.body, { color: colors.textPrimary }]}>
              {localEntriesCount} entries · {localSignaturesCount} signatures
            </Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              Last synced: {localLastBackupAt ?? 'never'}
            </Text>
          </View>

          <View
            style={[
              {
                backgroundColor: colors.bgSurface,
                borderRadius: radii.md,
                borderWidth: borders.hair,
                borderColor: colors.border,
                padding: spacing.base,
                gap: spacing.sm,
              },
              shadows.sm,
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Cloud size={20} color={colors.textPrimary} />
              <Text style={[typography.bodyMed, { color: colors.textPrimary }]}>
                In the cloud
              </Text>
            </View>
            <Text style={[typography.body, { color: colors.textPrimary }]}>
              {cloudEntries} entries · {cloudSignatures} signatures
            </Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              Last backed up: {cloudBackedUpAt}
            </Text>
          </View>
        </View>

        {/* CTAs */}
        <View style={{ gap: spacing.md }}>
          <Button
            title="Keep cloud, replace this device"
            onPress={confirmKeepCloud}
            disabled={busy}
            variant="primary"
            haptic
          />
          <Button
            title="Replace cloud with this device"
            onPress={confirmReplaceCloud}
            disabled={busy}
            variant="primary"
            haptic
          />
        </View>
      </ScrollView>

      {busy && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.overlay,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          pointerEvents="auto"
        >
          <LoadingSpinner label="Working" />
        </View>
      )}
    </Screen>
  );
}
