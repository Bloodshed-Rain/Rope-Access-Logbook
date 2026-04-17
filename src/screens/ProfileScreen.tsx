import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useQueryClient } from '@tanstack/react-query';
import { Screen, Card, Button, Banner } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useProfile, useUpdateLastBackupAt } from '../hooks/useProfile';
import { useBackupReminder } from '../hooks/useBackupReminder';
import { createExportService } from '../services/exportService';
import { createEntriesService } from '../services/entriesService';
import { createSigningService } from '../services/signingService';
import { getClient } from '../db/initialize';
import { ProfileCloudSection } from '../components/ProfileCloudSection';
import Constants from 'expo-constants';

export function ProfileScreen() {
  const { colors, spacing, typography } = useTheme();
  const { data: profile } = useProfile();
  const { certExpiryStatus, daysSinceBackup } = useBackupReminder();
  const updateLastBackup = useUpdateLastBackupAt();
  const queryClient = useQueryClient();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  if (!profile) return null;

  async function changePhotosInBackup(v: boolean) {
    const db = getClient();
    await db.run(
      'UPDATE profile SET photos_in_backup = ?, updated_at = ? WHERE id = ?',
      [v ? 1 : 0, new Date().toISOString(), profile!.id],
    );
    queryClient.invalidateQueries({ queryKey: ['profile'] });
  }

  const handleExportJson = async () => {
    const exportService = createExportService(getClient());
    const backup = await exportService.exportAsJson(Constants.expoConfig?.version ?? '1.0.0');
    const json = JSON.stringify(backup, null, 2);
    const path = `${FileSystem.cacheDirectory}logbook-backup.json`;
    await FileSystem.writeAsStringAsync(path, json);
    await Sharing.shareAsync(path, { mimeType: 'application/json' });
    updateLastBackup.mutate(new Date().toISOString());
  };

  const handleExportPdf = async () => {
    const exportService = createExportService(getClient());
    const entriesService = createEntriesService(getClient());
    const signingService = createSigningService(getClient());

    const entries = await entriesService.listEntries();
    const signatures = await signingService.getAllSignatures();
    const hoursByLevel = await entriesService.getLifetimeHoursByLevel();
    const version = Constants.expoConfig?.version ?? '1.0.0';

    const uri = await exportService.exportAsPdf(profile!, entries, signatures, hoursByLevel, version);
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
    updateLastBackup.mutate(new Date().toISOString());
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: spacing.base, paddingVertical: spacing.base }}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Profile</Text>
        {certExpiryStatus === 'expired' && <Banner variant="error" message="Your SPRAT certification has expired." />}
        {certExpiryStatus === 'warning' && <Banner variant="warning" message="Your SPRAT certification expires within 60 days." />}
        <Card>
          <View style={{ gap: spacing.sm }}>
            <Text style={[typography.h2, { color: colors.textPrimary }]}>{profile.full_name}</Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>SPRAT ID: {profile.sprat_id}</Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>Level {profile.level}</Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>Cert expires: {profile.cert_expires_on}</Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>Employer: {profile.default_employer}</Text>
          </View>
        </Card>
        <Card style={{ gap: spacing.md }}>
          <Text style={[typography.h2, { color: colors.textPrimary }]}>Backup</Text>
          {daysSinceBackup !== null ? (
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>Last backed up: {daysSinceBackup} days ago</Text>
          ) : (
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>Never backed up</Text>
          )}
          <Button title="Export full logbook (JSON)" onPress={handleExportJson} variant="secondary" />
          <Button title="Export full logbook (PDF)" onPress={handleExportPdf} />
        </Card>
        <ProfileCloudSection
          db={getClient()}
          profileId={profile.id}
          photosInBackup={!!profile.photos_in_backup}
          onChangePhotosInBackup={changePhotosInBackup}
          onDeleteAccount={() => setDeleteModalOpen(true)}
        />
      </ScrollView>
    </Screen>
  );
}
