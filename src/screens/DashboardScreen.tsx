// src/screens/DashboardScreen.tsx
import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Banner,
  Gauge,
  Panel,
  PunchCardRow,
  RecertStrip,
  StatStrip,
  SegmentedToggle,
  SyncLED,
  FabButton,
  BreakdownBar,
  SectionLabel,
  Button,
} from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useProfile } from '../hooks/useProfile';
import { useEntries } from '../hooks/useEntries';
import {
  useCertProgress,
  useRecert,
  useDashboardStats,
  useWorkBreakdown,
} from '../hooks/useCertProgress';
import { useBackupStatus } from '../hooks/useBackupStatus';
import { useBackupReminder } from '../hooks/useBackupReminder';
import { useMilestones } from '../hooks/useMilestones';
import { getClient } from '../db/initialize';
import { CertScheme, WorkType, CertLevel } from '../types';
import { RootStackParamList } from '../navigation/RootNavigator';
import { APP_VERSION } from '../constants';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const WORK_TYPE_LABELS: Record<WorkType, string> = {
  inspection: 'INSPECTION',
  ndt: 'NDT',
  welding: 'WELD / FAB',
  painting: 'PAINT / COAT',
  window_cleaning: 'CLEAN / GLAZE',
  rescue: 'ROPE RESCUE',
  training: 'TRAINING',
  rigging: 'RIGGING',
  other: 'OTHER',
};

function projectionLabel(p: ReturnType<typeof useCertProgress>['data']) {
  if (!p) return { text: '—', variant: 'default' as const };
  const proj = p.projection;
  switch (proj.kind) {
    case 'eligible-now':
      return { text: 'ELIGIBLE NOW', variant: 'ok' as const };
    case 'projected': {
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const m = months[proj.date.getUTCMonth()];
      const y = proj.date.getUTCFullYear();
      return { text: `${m} ${y}`, variant: 'warn' as const };
    }
    case 'insufficient-data':
      return { text: 'INSUFFICIENT DATA', variant: 'warn' as const };
    case 'paused':
      return { text: 'PROJECTION PAUSED', variant: 'default' as const };
    case 'max-level':
      return { text: 'MAX LEVEL', variant: 'ok' as const };
  }
}

export function DashboardScreen() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const { data: profile } = useProfile();
  const { data: entries = [] } = useEntries();
  const year = new Date().getFullYear();

  const [activeCert, setActiveCert] = useState<CertScheme>(() => profile?.primary_cert ?? 'sprat');
  React.useEffect(() => {
    if (profile?.primary_cert) setActiveCert(profile.primary_cert);
  }, [profile?.primary_cert]);

  const showToggle = !!(profile?.holds_sprat && profile?.holds_irata);

  const { data: progress } = useCertProgress(activeCert);
  const { data: recert } = useRecert(activeCert);
  const { data: stats } = useDashboardStats(year);
  const { data: breakdown } = useWorkBreakdown(year);

  const { data: backupStatus } = useBackupStatus(getClient());
  const { showReminder, daysSinceBackup } = useBackupReminder();
  const { progress: milestone } = useMilestones();
  const [reminderDismissed, setReminderDismissed] = useState(false);
  const [milestoneDismissed, setMilestoneDismissed] = useState(false);

  const recentEntries = useMemo(() => entries.slice(0, 5), [entries]);

  const syncStatus =
    backupStatus?.last_cloud_backup_at ? ('ok' as const)
      : ('disabled' as const);
  const syncLabel = backupStatus?.last_cloud_backup_at ? 'SYNCED' : 'OFFLINE';

  const proj = projectionLabel(progress);

  const yoyDelta = stats?.yoyDelta ?? 0;
  const yoySub =
    !stats || stats.lastYearHours === 0
      ? { text: 'first year', variant: 'default' as const }
      : yoyDelta > 0
        ? { text: `+${yoyDelta.toFixed(1)} vs ly`, variant: 'ok' as const }
        : yoyDelta < 0
          ? { text: `${yoyDelta.toFixed(1)} vs ly`, variant: 'err' as const }
          : { text: 'same as ly', variant: 'default' as const };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bgBase }}
      contentContainerStyle={{ paddingBottom: spacing.s12 }}
    >
      {/* Status header */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: spacing.s5,
          paddingTop: spacing.s5,
          paddingBottom: spacing.s3,
          borderBottomWidth: 1,
          borderBottomColor: colors.edgeBase,
          backgroundColor: colors.bgRaised,
        }}
      >
        <View>
          <Text style={[typography.stencilLg, { color: colors.inkPrimary }]}>
            RA<Text style={{ color: colors.accentBase }}>/</Text>LOG
          </Text>
          <Text
            style={{
              fontFamily: 'JetBrainsMono_400Regular',
              fontSize: 9,
              color: colors.inkDisabled,
              marginTop: 2,
              letterSpacing: 0.4,
            }}
          >
            v{APP_VERSION}
          </Text>
        </View>
        <SyncLED status={syncStatus} label={syncLabel} />
      </View>

      <View style={{ paddingHorizontal: spacing.s5 }}>
        {/* Banners */}
        {milestone?.isEligible && !milestone.isMaxLevel && !milestoneDismissed && (
          <View style={{ marginTop: spacing.s3 }}>
            <Banner
              variant="success"
              message={`You have reached ${milestone.hoursNeeded} hours! Eligible to upgrade to Level ${
                milestone.currentLevel === 'I' ? 'II' : 'III'
              }.`}
              onDismiss={() => setMilestoneDismissed(true)}
            />
          </View>
        )}
        {showReminder && !reminderDismissed && (
          <View style={{ marginTop: spacing.s3 }}>
            <Banner
              variant="warning"
              message={
                daysSinceBackup !== null
                  ? `It's been ${daysSinceBackup} days since your last backup. Export your logbook now.`
                  : 'You have never backed up your logbook. Export it now to keep your data safe.'
              }
              actionLabel="Export"
              onAction={() => navigation.navigate('Main')}
              onDismiss={() => setReminderDismissed(true)}
            />
          </View>
        )}

        {/* Section 01 — Cert status + gauge */}
        <SectionLabel index="01" label="CERTIFICATION STATUS" />

        {showToggle && (
          <View style={{ marginBottom: spacing.s3 }}>
            <SegmentedToggle<CertScheme>
              value={activeCert}
              onChange={setActiveCert}
              options={[
                {
                  value: 'irata',
                  label: 'IRATA',
                  sub: profile?.holds_irata
                    ? `LEVEL ${profile.irata_level} · ID ${profile.irata_id}`
                    : 'NOT HELD',
                },
                {
                  value: 'sprat',
                  label: 'SPRAT',
                  sub: profile?.holds_sprat
                    ? `LEVEL ${profile.level} · ID ${profile.sprat_id}`
                    : 'NOT HELD',
                },
              ]}
            />
          </View>
        )}

        <Panel
          header={{
            label:
              progress?.isMaxLevel
                ? 'MAX LEVEL REACHED'
                : `HRS TO LEVEL ${nextLevel(progress?.currentLevel ?? 'I')} ASSESSMENT`,
            tag: activeCert.toUpperCase(),
          }}
        >
          <View style={{ paddingHorizontal: spacing.s4, paddingTop: spacing.s2, paddingBottom: spacing.s3 }}>
            {progress?.isMaxLevel ? (
              <View style={{ alignItems: 'center', paddingVertical: spacing.s5 }}>
                <Text
                  style={{
                    fontFamily: 'Michroma_400Regular',
                    fontSize: 36,
                    color: colors.statusOk,
                    letterSpacing: 4,
                  }}
                >
                  L III
                </Text>
                <Text
                  style={{
                    fontFamily: 'JetBrainsMono_700Bold',
                    fontSize: 16,
                    color: colors.inkPrimary,
                    marginTop: spacing.s2,
                  }}
                >
                  {(stats?.lifetimeHours ?? 0).toFixed(1)} HRS LOGGED
                </Text>
              </View>
            ) : (
              <Gauge
                value={progress?.hoursAtLevel ?? 0}
                target={progress?.target ?? 1000}
                unitLabel="LOGGED HOURS"
              />
            )}
          </View>
          {!progress?.isMaxLevel && (
            <View
              style={{
                flexDirection: 'row',
                borderTopWidth: 1,
                borderTopColor: colors.edgeBase,
              }}
            >
              <View
                style={{
                  flex: 1,
                  padding: spacing.s3,
                  borderRightWidth: 1,
                  borderRightColor: colors.edgeBase,
                }}
              >
                <Text style={[typography.stencilSm, { color: colors.inkTertiary, marginBottom: 4 }]}>
                  REMAINING
                </Text>
                <Text
                  style={{
                    fontFamily: 'JetBrainsMono_700Bold',
                    fontSize: 15,
                    color: colors.inkPrimary,
                  }}
                >
                  {(progress?.remaining ?? 0).toFixed(1)}
                  <Text style={{ color: colors.inkTertiary, fontSize: 11 }}> HRS</Text>
                </Text>
              </View>
              <View style={{ flex: 1, padding: spacing.s3 }}>
                <Text style={[typography.stencilSm, { color: colors.inkTertiary, marginBottom: 4 }]}>
                  PROJECTED ELIGIBLE
                </Text>
                <Text
                  style={{
                    fontFamily: 'JetBrainsMono_700Bold',
                    fontSize: 15,
                    color:
                      proj.variant === 'ok'
                        ? colors.statusOk
                        : proj.variant === 'warn'
                          ? colors.statusWarn
                          : colors.inkTertiary,
                  }}
                >
                  {proj.text}
                </Text>
              </View>
            </View>
          )}
        </Panel>

        {progress?.isEligible && !progress.isMaxLevel && (
          <View style={{ marginTop: spacing.s3 }}>
            <Button
              title="RECORD LEVEL UP"
              onPress={() => navigation.navigate('Main')}
            />
          </View>
        )}

        {recert && (
          <View style={{ marginTop: spacing.s3 }}>
            <RecertStrip
              scheme={recert.scheme}
              state={recert.state}
              expiresOn={recert.expiresOn}
              daysToExpiry={recert.daysToExpiry}
            />
          </View>
        )}

        {/* Section 02 — Stats */}
        <SectionLabel index="02" label="AT A GLANCE" />
        <StatStrip
          stats={[
            {
              label: 'LIFETIME',
              value: (stats?.lifetimeHours ?? 0).toFixed(1),
              sub: 'hours',
            },
            {
              label: 'THIS YEAR',
              value: (stats?.thisYearHours ?? 0).toFixed(1),
              sub: yoySub.text,
              subVariant: yoySub.variant,
            },
            {
              label: 'JOBS',
              value: String(stats?.totalJobs ?? 0),
              sub: `${stats?.totalSites ?? 0} sites`,
            },
          ]}
        />

        {/* Section 03 — Recent entries */}
        <SectionLabel
          index="03"
          label="RECENT ENTRIES"
          right={`ALL ${entries.length}`}
        />
        {recentEntries.length === 0 ? (
          <Text
            style={[
              typography.bodySmall,
              { color: colors.inkTertiary, paddingVertical: spacing.s3 },
            ]}
          >
            No entries yet — tap NEW ENTRY to log your first one.
          </Text>
        ) : (
          recentEntries.map((e) => (
            <PunchCardRow
              key={e.id}
              date={e.date_from}
              title={e.site || 'NO SITE'}
              meta={`${e.work_hours}h · ${e.work_types.map((t) => WORK_TYPE_LABELS[t] ?? t.toUpperCase()).join(' / ')}`}
              levelChip={
                (activeCert === 'sprat'
                  ? e.tech_level_snapshot
                  : e.irata_level_snapshot) as CertLevel | undefined
              }
              sigStatus={
                e.status === 'signed' || e.status === 'amended'
                  ? 'signed'
                  : e.pending_sign_request_id
                    ? 'awaiting'
                    : undefined
              }
              onPress={() => navigation.navigate('EntryDetail', { entryId: e.id })}
            />
          ))
        )}

        {/* Section 04 — Work breakdown */}
        <SectionLabel index="04" label="WORK BREAKDOWN · YTD" />
        {!breakdown || breakdown.items.length === 0 ? (
          <Text
            style={[
              typography.bodySmall,
              { color: colors.inkTertiary, paddingVertical: spacing.s3 },
            ]}
          >
            No work breakdown yet for {year}.
          </Text>
        ) : (
          breakdown.items.map((it, i) => (
            <BreakdownBar
              key={it.workType}
              label={WORK_TYPE_LABELS[it.workType] ?? it.workType.toUpperCase()}
              value={Math.round(it.hours)}
              max={breakdown.maxHours}
              unit="h"
              emphasis={i < 2}
            />
          ))
        )}
      </View>

      {/* FAB sticky-ish (we render it at the bottom of the scroll for now) */}
      <View style={{ marginTop: spacing.s5, paddingHorizontal: spacing.s5 }}>
        <FabButton label="NEW ENTRY" onPress={() => navigation.navigate('EntryForm')} />
      </View>
    </ScrollView>
  );
}

function nextLevel(current: CertLevel): string {
  if (current === 'I') return 'II';
  if (current === 'II') return 'III';
  return 'III';
}
