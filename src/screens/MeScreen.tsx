// src/screens/MeScreen.tsx
// Light-theme Me tab. Identity block + cert + progress + readiness + actions
// + subscription strip. Settings opens a bottom sheet.

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import { Settings as SettingsIcon } from 'lucide-react-native';
import { Screen, Button, useToast } from '../primitives';
import {
  AvatarUpload,
  ChecklistRow,
  StatCard,
  SubscriptionStrip,
} from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useProfile, useUpdateProfile, useUpdateLastBackupAt } from '../hooks/useProfile';
import { useEntries } from '../hooks/useEntries';
import { useAuthSession } from '../hooks/useAuthSession';
import { useBackup } from '../hooks/useBackup';
import { useSubscriptionStatus, useReadOnly } from '../hooks/useSubscription';
import { useCertProgress, useRecert, useDashboardStats } from '../hooks/useCertProgress';
import { getClient } from '../db/initialize';
import { createSupabaseCloudClient } from '../cloud/supabaseClient';
import { createExpoFsAbstraction } from '../cloud/fsAbstraction';
import { createExportService } from '../services/exportService';
import { createEntriesService } from '../services/entriesService';
import { createSigningService } from '../services/signingService';
import { computeReadiness, ReadinessItem } from '../services/readinessSelector';
import { formatDate } from '../utils/dateRange';
import { sha256 } from '../utils/hash';
import { APP_VERSION } from '../constants';
import { CertScheme, Profile } from '../types';
import { RootStackParamList } from '../navigation/RootNavigator';
import { SettingsSheet } from '../components/SettingsSheet';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function schemeLabel(s: CertScheme): string {
  return s === 'sprat' ? 'SPRAT' : 'IRATA';
}

function levelFor(profile: Profile, scheme: CertScheme): string | null {
  return scheme === 'sprat' ? profile.level : profile.irata_level;
}

function idFor(profile: Profile, scheme: CertScheme): string | null {
  return scheme === 'sprat' ? profile.sprat_id : profile.irata_id;
}

function expiryFor(profile: Profile, scheme: CertScheme): string | null {
  return scheme === 'sprat' ? profile.cert_expires_on : profile.irata_expires_on;
}

function holdsBoth(profile: Profile): boolean {
  return profile.holds_sprat && profile.holds_irata;
}

function secondaryScheme(profile: Profile): CertScheme | null {
  if (!holdsBoth(profile)) return null;
  return profile.primary_cert === 'sprat' ? 'irata' : 'sprat';
}

function daysUntil(iso: string, now: Date = new Date()): number {
  const ms = new Date(iso).getTime() - now.getTime();
  return Math.floor(ms / 86_400_000);
}

function expiryStatus(days: number): 'ok' | 'warn' | 'err' {
  if (days <= 60) return 'err';
  if (days <= 180) return 'warn';
  return 'ok';
}

function recertCaption(daysToExpiry: number, state: string): string {
  if (state === 'expired') return `Re-cert expired ${Math.abs(daysToExpiry)}d ago`;
  if (state === 'expires-today') return 'Re-cert expires today';
  return `Re-cert in ${daysToExpiry}d`;
}

function initialsFromName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .slice(0, 2)
    .join('');
}

interface CertChipProps {
  scheme: CertScheme;
  level: string | null;
  id: string | null;
  muted?: boolean;
  onPress?: () => void;
}

function CertChip({ scheme, level, id, muted, onPress }: CertChipProps) {
  const { colors, radii, spacing, typography, borders } = useTheme();
  const bg = muted ? colors.bgMuted : colors.accentTint;
  const fg = muted ? colors.textSecondary : colors.accentPrimary;
  const levelTone =
    level === 'I' ? colors.certL1 : level === 'II' ? colors.certL2 : colors.certL3;
  const inner = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: radii.pill,
        backgroundColor: bg,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={[typography.caption, { color: fg, fontWeight: '600' }]}>
        {schemeLabel(scheme)}
        {id ? ` #${id}` : ''}
      </Text>
      {level && (
        <View
          style={{
            paddingHorizontal: spacing.xs,
            paddingVertical: 1,
            borderRadius: radii.pill,
            backgroundColor: muted ? colors.bgSurface : colors.bgSurface,
            borderWidth: borders.hair,
            borderColor: levelTone,
          }}
        >
          <Text style={[typography.caption, { color: levelTone, fontWeight: '600' }]}>
            L{level}
          </Text>
        </View>
      )}
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button">
        {({ pressed }) => <View style={{ opacity: pressed ? 0.7 : 1 }}>{inner}</View>}
      </Pressable>
    );
  }
  return inner;
}

export function MeScreen() {
  const { colors, spacing, typography, radii, shadows, borders } = useTheme();
  const navigation = useNavigation<Nav>();
  const toast = useToast();

  const db = useMemo(() => getClient(), []);
  const cloud = useMemo(() => createSupabaseCloudClient(), []);
  const fs = useMemo(() => createExpoFsAbstraction(), []);

  const { data: profile } = useProfile();
  const { data: entries = [] } = useEntries();
  const { session } = useAuthSession(cloud);
  const updateProfile = useUpdateProfile();
  const updateLastBackup = useUpdateLastBackupAt();
  const subStatus = useSubscriptionStatus();
  const readOnly = useReadOnly();

  const scheme = profile?.primary_cert ?? 'sprat';
  const { data: certData } = useCertProgress(scheme);
  const { data: recertData } = useRecert(scheme);
  const { data: stats } = useDashboardStats(new Date().getFullYear());

  const backup = useBackup({
    db,
    cloud,
    fs,
    hash: sha256,
    exportService: createExportService(db),
    clock: () => new Date().toISOString(),
    appVersion: APP_VERSION,
  });

  const [settingsOpen, setSettingsOpen] = useState(false);

  const readiness = useMemo(() => {
    return computeReadiness({
      profile: profile ?? null,
      entries,
      now: new Date().toISOString(),
      isSignedIn: !!session,
    });
  }, [profile, entries, session]);

  if (!profile) {
    return (
      <Screen padded={false}>
        <View />
      </Screen>
    );
  }

  const primary = profile.primary_cert;
  const secondary = secondaryScheme(profile);

  // Prefer the user-set avatar; fall back to their SPRAT card photo if
  // available so the identity card has a face on it before they explicitly
  // pick one. EditAvatarScreen writes profile.avatar_path.
  const avatarUri =
    profile.avatar_path
      ?? (profile.holds_sprat ? profile.sprat_card_photo_path : null);

  const handleEditIdentity = () => {
    navigation.navigate('EditName');
  };

  const handleSwapPrimary = () => {
    if (!secondary) return;
    if (updateProfile.isPending) return;
    updateProfile.mutate(
      { primary_cert: secondary },
      {
        onSuccess: () => {
          toast.show({
            message: `${schemeLabel(secondary)} is now your primary certification.`,
            variant: 'ok',
          });
        },
        onError: (e) => {
          toast.show({ message: (e as Error).message, variant: 'err' });
        },
      },
    );
  };

  const handleExportPdf = async () => {
    if (!subStatus.isPaid) {
      navigation.navigate('Paywall');
      return;
    }
    try {
      const exportService = createExportService(db);
      const entriesService = createEntriesService(db);
      const signingService = createSigningService(db);
      const all = await entriesService.listEntries();
      const sigs = await signingService.getAllSignatures();
      const hoursByLevel = await entriesService.getLifetimeHoursByLevel();
      const version = Constants.expoConfig?.version ?? '1.0.0';
      const uri = await exportService.exportAsPdf(profile, all, sigs, hoursByLevel, version);
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
      updateLastBackup.mutate(new Date().toISOString());
    } catch (e) {
      toast.show({ message: `Export failed: ${(e as Error).message}`, variant: 'err' });
    }
  };

  const handleExportJson = async () => {
    try {
      const exportService = createExportService(db);
      const data = await exportService.exportAsJson(Constants.expoConfig?.version ?? '1.0.0');
      const json = JSON.stringify(data, null, 2);
      const path = `${FileSystem.cacheDirectory}logbook-backup.json`;
      await FileSystem.writeAsStringAsync(path, json);
      await Sharing.shareAsync(path, { mimeType: 'application/json' });
      updateLastBackup.mutate(new Date().toISOString());
    } catch (e) {
      toast.show({ message: `Export failed: ${(e as Error).message}`, variant: 'err' });
    }
  };

  const handleBackupNow = () => {
    // Lapsed users bouncing to Paywall instead of triggering a manual
    // backup. The auto-trigger backups (post-sign / AppState background)
    // stay unchanged — they're best-effort + silently noop on offline,
    // so a lapsed-state noop is consistent with that posture.
    if (readOnly) {
      navigation.navigate('Paywall');
      return;
    }
    backup.mutate(undefined, {
      onSuccess: (res) => {
        if (res.kind === 'uploaded') {
          toast.show({ message: 'Backup uploaded', variant: 'ok' });
        } else if (res.kind === 'failed') {
          toast.show({ message: `Backup failed: ${res.message}`, variant: 'err' });
        } else if (res.kind === 'skipped_offline') {
          toast.show({ message: 'Offline — backup skipped', variant: 'warn' });
        } else if (res.kind === 'skipped_no_auth') {
          toast.show({ message: 'Sign in to back up', variant: 'warn' });
        } else if (res.kind === 'throttled') {
          toast.show({ message: 'Backup throttled', variant: 'warn' });
        }
      },
    });
  };

  const handleManageSubscription = () => {
    const url =
      Platform.OS === 'ios'
        ? 'https://apps.apple.com/account/subscriptions'
        : 'https://play.google.com/store/account/subscriptions';
    Linking.openURL(url).catch(() =>
      toast.show({ message: 'Could not open subscription settings', variant: 'err' }),
    );
  };

  // Cert card values
  const certExpiryIso = expiryFor(profile, primary);
  const certDaysLeft = certExpiryIso ? daysUntil(certExpiryIso) : null;
  const certStatus = certDaysLeft != null ? expiryStatus(certDaysLeft) : null;
  const certPillTone =
    certStatus === 'ok'
      ? { bg: colors.statusOkTint, fg: colors.statusOk, label: 'Active' }
      : certStatus === 'warn'
        ? { bg: colors.statusWarnTint, fg: colors.statusWarn, label: 'Expiring soon' }
        : certStatus === 'err'
          ? { bg: colors.statusErrTint, fg: colors.statusErr, label: 'Renew now' }
          : null;

  // Progress card values (mirrors TodayScreen pattern)
  let progressBig = '—';
  let progressCaption: string | undefined;
  let progressValue: number | undefined;
  if (certData) {
    if (certData.isMaxLevel) {
      const lifetime = stats?.lifetimeHours ?? certData.hoursAtLevel;
      progressBig = `Level III · ${lifetime.toFixed(1)}h`;
      progressCaption = 'Lifetime hours';
    } else {
      const target = certData.target ?? 0;
      progressBig = `${certData.hoursAtLevel.toFixed(0)} / ${target}`;
      progressCaption = `${certData.remaining.toFixed(0)} hours to go`;
      progressValue =
        target > 0 ? Math.min(1, certData.hoursAtLevel / target) : undefined;
    }
  }

  const renderCheck = (item: ReadinessItem, key: string, onPress?: () => void) => (
    <View key={key}>
      <ChecklistRow state={item.state} label={item.label} onPress={onPress} />
      <View style={{ height: borders.hair, backgroundColor: colors.divider }} />
    </View>
  );

  return (
    <Screen padded={false}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: spacing.base,
          paddingTop: spacing.md,
          paddingBottom: spacing.sm,
        }}
      >
        <Text style={[typography.title1, { color: colors.textPrimary }]}>Me</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => setSettingsOpen(true)}
          hitSlop={12}
          style={{
            width: 40,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SettingsIcon color={colors.textPrimary} size={22} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.base,
          paddingBottom: spacing.xxl,
          gap: spacing.base,
        }}
      >
        {/* Identity block */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
          onPress={handleEditIdentity}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.base,
              backgroundColor: colors.bgSurface,
              borderRadius: radii.md,
              padding: spacing.base,
              ...shadows.sm,
            }}
          >
            <AvatarUpload
              uri={avatarUri ?? undefined}
              size={80}
              initials={initialsFromName(profile.full_name)}
            />
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Text style={[typography.title2, { color: colors.textPrimary }]}>
                {profile.full_name}
              </Text>
              <CertChip
                scheme={primary}
                level={levelFor(profile, primary)}
                id={idFor(profile, primary)}
              />
              {secondary && (
                <CertChip
                  scheme={secondary}
                  level={levelFor(profile, secondary)}
                  id={idFor(profile, secondary)}
                  muted
                  onPress={handleSwapPrimary}
                />
              )}
            </View>
          </View>
        </Pressable>

        {/* Certification card */}
        {certExpiryIso && certPillTone && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Certification details"
            onPress={() => navigation.navigate('EditCerts')}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          >
            <View
              style={{
                backgroundColor: colors.bgSurface,
                borderRadius: radii.md,
                padding: spacing.base,
                gap: spacing.sm,
                ...shadows.sm,
              }}
            >
              <Text style={[typography.label, { color: colors.textSecondary }]}>
                Certification
              </Text>
              <Text style={[typography.title2, { color: colors.textPrimary }]}>
                Expires {formatDate(certExpiryIso)}
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                }}
              >
                <View
                  style={{
                    paddingHorizontal: spacing.sm,
                    paddingVertical: spacing.xs / 2,
                    borderRadius: radii.pill,
                    backgroundColor: certPillTone.bg,
                  }}
                >
                  <Text style={[typography.caption, { color: certPillTone.fg, fontWeight: '600' }]}>
                    {certPillTone.label}
                  </Text>
                </View>
                <Text
                  style={[
                    typography.caption,
                    { color: certPillTone.fg, fontWeight: '500' },
                  ]}
                >
                  {certDaysLeft != null && certDaysLeft >= 0
                    ? `${certDaysLeft} day${certDaysLeft === 1 ? '' : 's'}`
                    : `Expired ${Math.abs(certDaysLeft ?? 0)}d ago`}
                </Text>
              </View>
            </View>
          </Pressable>
        )}

        {/* Progress card */}
        {certData && (
          <StatCard
            title={certData.isMaxLevel ? 'Level III' : 'Progress to next level'}
            big={progressBig}
            caption={progressCaption}
            progress={progressValue}
          />
        )}

        {/* L3 re-cert reminder strip — duplicated from TodayScreen since tiny */}
        {certData?.isMaxLevel && recertData && recertData.daysToExpiry < 180 && (
          <View
            style={{
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              borderRadius: radii.md,
              backgroundColor:
                recertData.state === 'safe'
                  ? colors.statusOkTint
                  : recertData.state === 'expired'
                    ? colors.statusErrTint
                    : colors.statusWarnTint,
            }}
          >
            <Text
              style={[
                typography.label,
                {
                  color:
                    recertData.state === 'safe'
                      ? colors.statusOk
                      : recertData.state === 'expired'
                        ? colors.statusErr
                        : colors.statusWarn,
                },
              ]}
            >
              {recertCaption(recertData.daysToExpiry, recertData.state)}
            </Text>
          </View>
        )}

        {/* Readiness card */}
        <View
          style={{
            backgroundColor: colors.bgSurface,
            borderRadius: radii.md,
            paddingVertical: spacing.sm,
            ...shadows.sm,
          }}
        >
          <Text
            style={[
              typography.label,
              {
                color: colors.textSecondary,
                paddingHorizontal: spacing.base,
                paddingVertical: spacing.sm,
              },
            ]}
          >
            Ready to export
          </Text>
          {renderCheck(readiness.profileComplete, 'profile')}
          {renderCheck(readiness.signedEntries, 'signed')}
          {renderCheck(
            readiness.entriesNeedingSignature,
            'pending',
            readiness.entriesNeedingSignature.state === 'warn'
              ? () =>
                  navigation.navigate('Main', {
                    screen: 'Records',
                    params: { filter: 'needs_signature' },
                  })
              : undefined,
          )}
          {renderCheck(readiness.backupRecency, 'backup')}
        </View>

        {/* Actions */}
        <View style={{ gap: spacing.sm }}>
          <Button title="Export PDF" variant="primary" onPress={handleExportPdf} />
          <Button title="Export JSON" variant="secondary" onPress={handleExportJson} />
          {session && (
            <Button
              title={backup.isPending ? 'Backing up…' : 'Back up now'}
              variant="secondary"
              onPress={handleBackupNow}
              disabled={backup.isPending}
            />
          )}
          <Button
            title="Manage gear"
            variant="secondary"
            onPress={() => navigation.navigate('GearList')}
          />
        </View>

        {/* Subscription strip — only when status is meaningful */}
        {subStatus.status !== 'unknown' && (
          <SubscriptionStrip
            status={subStatus.status}
            trialDaysRemaining={subStatus.trialDaysRemaining}
            renewalDate={subStatus.renewalDate}
            onManage={handleManageSubscription}
            onRenew={() => navigation.navigate('Paywall')}
          />
        )}
      </ScrollView>

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        profile={profile}
        sessionEmail={session?.email ?? null}
      />
    </Screen>
  );
}
