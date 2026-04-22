import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useQueryClient } from '@tanstack/react-query';
import { HardHat } from 'lucide-react-native';
import { Screen, Card, Button, Banner, ProgressBar, RopeDivider, SectionHeader } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useProfile, useUpdateLastBackupAt } from '../hooks/useProfile';
import { useBackupReminder } from '../hooks/useBackupReminder';
import { useMilestones } from '../hooks/useMilestones';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/RootNavigator';
import { useSubscriptionTier } from '../hooks/useSubscription';
import { ProBadge } from '../primitives/ProBadge';
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
  const { data: tier } = useSubscriptionTier();
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
    if (tier !== 'pro') {
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
    if (tier !== 'pro') {
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
    <Screen padded={false} topDivider>
      <View style={{ backgroundColor: colors.navy }}>
        <View style={{ paddingHorizontal: spacing.base, paddingTop: spacing.xl, paddingBottom: spacing.lg }}>
          <Text style={[typography.stencil, { color: colors.ropeTan, marginBottom: spacing.xs }]}>
            TECHNICIAN
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={[typography.h1, { color: colors.textInverse, fontSize: 32 }]}>{profile.full_name}</Text>
              <Text style={[typography.stencil, { color: colors.slateLighter, marginTop: spacing.xs }]}>
                LEVEL {profile.level} · #{profile.sprat_id}
              </Text>
            </View>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' }}>
              <HardHat color={colors.textInverse} size={24} />
            </View>
          </View>
        </View>
        <RopeDivider color={colors.ropeTan} opacity={0.45} />
      </View>

      <ScrollView contentContainerStyle={{ gap: spacing.base, paddingVertical: spacing.md, paddingHorizontal: spacing.base, paddingBottom: spacing.xxl }}>
        {certExpiryStatus === 'expired' && <Banner variant="error" message="Your SPRAT certification has expired." />}
        {certExpiryStatus === 'warning' && <Banner variant="warning" message="Your SPRAT certification expires within 60 days." />}
        
        {progress?.isEligible && !progress.isMaxLevel && !milestoneDismissed && (
          <Banner variant="success"
            message={`You have reached ${progress.hoursNeeded} hours! You are eligible to upgrade to Level ${progress.currentLevel === 'I' ? 'II' : 'III'}.`}
            onDismiss={() => setMilestoneDismissed(true)} />
        )}

        <SectionHeader label="ACCOUNT INFO" />
        <Card accent="navy" style={{ gap: spacing.sm }}>
          <Text style={[typography.body, { color: colors.textSecondary }]}>Cert expires: {profile.cert_expires_on}</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>Employer: {profile.default_employer}</Text>
        </Card>

        {progress && !progress.isMaxLevel && (
          <Card accent="navy" style={{ gap: spacing.sm, marginTop: spacing.xs }}>
            <Text style={[typography.body, { color: colors.textPrimary, fontWeight: '700' }]}>Level {progress.currentLevel === 'I' ? 'II' : 'III'} Progress</Text>
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>
              {progress.hoursAtCurrentLevel} / {progress.hoursNeeded} hours
            </Text>
            <ProgressBar progress={progress.progress} />
          </Card>
        )}

        <SectionHeader label="REPORTS & EXPORTS" />
        <Card accent="navy" style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Button title="View Pro Analytics" onPress={() => tier === 'pro' ? navigation.navigate('Analytics') : navigation.navigate('Paywall')} style={{ flex: 1 }} variant="secondary" />
            {tier !== 'pro' && <ProBadge />}
          </View>
          
          <View style={{ height: 1, backgroundColor: colors.hairline, marginVertical: spacing.xs }} />

          {daysSinceBackup !== null ? (
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>Last backed up: {daysSinceBackup} days ago</Text>
          ) : (
            <Text style={[typography.bodySmall, { color: colors.textSecondary }]}>Never backed up</Text>
          )}
          <Button title="Export full logbook (JSON)" onPress={handleExportJson} variant="secondary" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Button title="Export full logbook (PDF)" onPress={handleExportPdf} style={{ flex: 1 }} />
            {tier !== 'pro' && <ProBadge />}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Button title="Export full logbook (CSV)" onPress={handleExportCsv} style={{ flex: 1 }} />
            {tier !== 'pro' && <ProBadge />}
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
