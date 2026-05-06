// src/screens/CloudRestorePromptScreen.tsx
// Scenario B per cloud-backup spec §6.5: this device has no entries but the
// signed-in account has a cloud snapshot. Without this prompt the next backup
// trigger silently overwrites the populated cloud snapshot with the empty
// local state — i.e. data loss for any user who installs on a new device or
// signs into an existing account from a fresh install.
//
// CTAs:
//   1. Restore from cloud — pulls everything down, then RootNavigator re-renders to Main.
//   2. Sign out — spec §6.6 escape hatch (closing aborts sign-in). The user
//      then proceeds in offline-only mode on this device; if they later sign
//      back in after creating local entries, Scenario C kicks in with the
//      explicit conflict screen.

import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Cloud } from 'lucide-react-native';
import { Screen, Button, Banner, LoadingSpinner } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useCloudStatePreview, useRestore } from '../hooks/useRestore';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { createAuthService } from '../services/authService';
import { DbClient } from '../db/client';
import { APP_VERSION } from '../constants';

interface CloudRestorePromptScreenProps {
  db: DbClient;
}

export function CloudRestorePromptScreen({ db }: CloudRestorePromptScreenProps) {
  const { colors, spacing, typography, radii, borders, shadows } = useTheme();
  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const fs = useMemo(() => createExpoFsAbstraction(), []);
  const deps = useMemo(() => ({ db, cloud, fs, appVersion: APP_VERSION }), [db, cloud, fs]);
  const preview = useCloudStatePreview(deps, true);
  const restoreMut = useRestore(deps);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doRestore() {
    try {
      setBusy(true);
      setError(null);
      await restoreMut.mutateAsync();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doSignOut() {
    try {
      setBusy(true);
      setError(null);
      await createAuthService(cloud).signOut();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function confirmSignOut() {
    Alert.alert(
      'Sign out without restoring?',
      'Your cloud logbook stays untouched. Sign back in later to restore it.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: doSignOut },
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
            Restore from cloud?
          </Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            This device is empty, but your account has a cloud backup. Restore now to
            pull it down, or sign out to keep using this device offline.
          </Text>
        </View>

        {error && <Banner variant="error" message={error} />}

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
            {cloudEntries} {cloudEntries === 1 ? 'entry' : 'entries'} ·{' '}
            {cloudSignatures} {cloudSignatures === 1 ? 'signature' : 'signatures'}
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            Last backed up: {cloudBackedUpAt}
          </Text>
        </View>

        <View style={{ gap: spacing.md }}>
          <Button
            title="Restore from cloud"
            onPress={doRestore}
            disabled={busy || !preview.data}
            variant="primary"
            haptic
          />
          <Button
            title="Sign out"
            onPress={confirmSignOut}
            disabled={busy}
            variant="secondary"
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
