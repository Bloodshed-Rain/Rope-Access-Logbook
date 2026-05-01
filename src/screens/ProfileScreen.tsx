import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useQueryClient } from '@tanstack/react-query';
import { Screen, Card, Button, Banner, ProgressBar, SectionLabel, Panel } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useProfile, useUpdateLastBackupAt } from '../hooks/useProfile';
import { useBackupReminder } from '../hooks/useBackupReminder';
import { useMilestones } from '../hooks/useMilestones';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/RootNavigator';
import { useSubscriptionStatus } from '../hooks/useSubscription';
import { createExportService } from '../services/exportService';
import { createEntriesService } from '../services/entriesService';
import { createSigningService } from '../services/signingService';
import { getClient } from '../db/initialize';
import { ProfileCloudSection } from '../components/ProfileCloudSection';
import { SupervisorsSection } from '../components/SupervisorsSection';
import { DeleteAccountModal } from '../components/DeleteAccountModal';
import Constants from 'expo-constants';

export function ProfileScreen() {
  const { colors, spacing, typography } = useTheme();
  const { data: profile } = useProfile();
  const { certExpiryStatus, daysSinceBackup } = useBackupReminder();
  const { progress } = useMilestones();
  const updateLastBackup = useUpdateLastBackupAt();
  const queryClient = useQueryClient();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { isPaid } = useSubscriptionStatus();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [milestoneDismissed, setMilestoneDismissed] = useState(false);

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
    if (!isPaid) {
      navigation.navigate('Paywall');
      return;
    }

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

  const handleExportCsv = async () => {
    if (!isPaid) {
      navigation.navigate('Paywall');
      return;
    }

    const exportService = createExportService(getClient());
    const entriesService = createEntriesService(getClient());
    const signingService = createSigningService(getClient());

    const entries = await entriesService.listEntries();
    const signatures = await signingService.getAllSignatures();

    const uri = await exportService.exportAsCsv(entries, signatures);
    await Sharing.shareAsync(uri, { mimeType: 'text/csv' });
    updateLastBackup.mutate(new Date().toISOString());
  };

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{
          gap: spacing.s3,
          paddingTop: spacing.s4,
          paddingHorizontal: spacing.s5,
          paddingBottom: spacing.s12,
        }}
      >
        {/* Account header */}
        <Panel header={{ label: 'TECHNICIAN' }}>
          <View style={{ paddingHorizontal: spacing.s4, paddingVertical: spacing.s3, gap: 4 }}>
            <Text
              style={{
                fontFamily: 'JetBrainsMono_800ExtraBold',
                fontSize: 22,
                color: colors.inkPrimary,
                letterSpacing: -0.4,
              }}
            >
              {profile.full_name}
            </Text>
            {profile.holds_sprat && profile.sprat_id && profile.level && (
              <Text style={[typography.caption, { color: colors.inkTertiary, letterSpacing: 1.0 }]}>
                SPRAT · LEVEL {profile.level} · #{profile.sprat_id}
              </Text>
            )}
            {profile.holds_irata && profile.irata_id && profile.irata_level && (
              <Text style={[typography.caption, { color: colors.inkTertiary, letterSpacing: 1.0 }]}>
                IRATA · LEVEL {profile.irata_level} · #{profile.irata_id}
              </Text>
            )}
          </View>
        </Panel>

        {certExpiryStatus === 'expired' && (
          <Banner variant="error" message="Your SPRAT certification has expired." />
        )}
        {certExpiryStatus === 'warning' && (
          <Banner variant="warning" message="Your SPRAT certification expires within 60 days." />
        )}

        {progress?.isEligible && !progress.isMaxLevel && !milestoneDismissed && (
          <Banner
            variant="success"
            message={`You have reached ${progress.hoursNeeded} hours! Eligible to upgrade to Level ${
              progress.currentLevel === 'I' ? 'II' : 'III'
            }.`}
            onDismiss={() => setMilestoneDismissed(true)}
          />
        )}

        <SectionLabel index="01" label="ACCOUNT" />
        <Card>
          <View style={{ gap: spacing.s2 }}>
            {profile.cert_expires_on && (
              <Text style={[typography.body, { color: colors.inkSecondary }]}>
                SPRAT cert expires: {profile.cert_expires_on}
              </Text>
            )}
            {profile.irata_expires_on && (
              <Text style={[typography.body, { color: colors.inkSecondary }]}>
                IRATA cert expires: {profile.irata_expires_on}
              </Text>
            )}
            <Text style={[typography.body, { color: colors.inkSecondary }]}>
              Employer: {profile.default_employer || '—'}
            </Text>
          </View>
        </Card>

        {progress && !progress.isMaxLevel && (
          <Card>
            <View style={{ gap: spacing.s2 }}>
              <Text style={[typography.bodyBold, { color: colors.inkPrimary }]}>
                Level {progress.currentLevel === 'I' ? 'II' : 'III'} progress
              </Text>
              <Text style={[typography.bodySmall, { color: colors.inkSecondary }]}>
                {progress.hoursAtCurrentLevel} / {progress.hoursNeeded} hours
              </Text>
              <ProgressBar progress={progress.progress} />
            </View>
          </Card>
        )}

        <SectionLabel index="02" label="REPORTS & EXPORTS" />
        <Card>
          <View style={{ gap: spacing.s3 }}>
            {daysSinceBackup !== null ? (
              <Text style={[typography.bodySmall, { color: colors.inkTertiary }]}>
                Last backed up: {daysSinceBackup} days ago
              </Text>
            ) : (
              <Text style={[typography.bodySmall, { color: colors.inkTertiary }]}>
                Never backed up
              </Text>
            )}
            <Button title="Export full logbook (JSON)" onPress={handleExportJson} variant="secondary" />
            <Button title="Export full logbook (PDF)" onPress={handleExportPdf} />
            <Button title="Export full logbook (CSV)" onPress={handleExportCsv} />
          </View>
        </Card>

        <SupervisorsSection />
        <ProfileCloudSection
          db={getClient()}
          profileId={profile.id}
          photosInBackup={!!profile.photos_in_backup}
          onChangePhotosInBackup={changePhotosInBackup}
          onDeleteAccount={() => setDeleteModalOpen(true)}
        />
      </ScrollView>
      <DeleteAccountModal
        visible={deleteModalOpen}
        onDone={() => setDeleteModalOpen(false)}
        db={getClient()}
      />
    </Screen>
  );
}
