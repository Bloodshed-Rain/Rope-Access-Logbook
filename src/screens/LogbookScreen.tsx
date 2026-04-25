// src/screens/LogbookScreen.tsx — registered as the LogbookList stack route
// (sub-screen reachable from Dashboard's "ALL N →" link).
import React, { useMemo } from 'react';
import { View, Text, SectionList } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen, EmptyState, FabButton, PunchCardRow, SectionLabel } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useEntries, useTotalWorkHours } from '../hooks/useEntries';
import { RootStackParamList } from '../navigation/RootNavigator';
import { Entry, WorkType, CertLevel } from '../types';

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

export function LogbookScreen() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const { data: entries = [] } = useEntries();
  const { data: totalHours = 0 } = useTotalWorkHours(new Date().getFullYear());

  const groupedEntries = useMemo(() => {
    const groups: Record<string, Entry[]> = {};
    entries.forEach((e) => {
      const parts = e.date_from.split('-');
      if (parts.length >= 2) {
        const date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1);
        const title = `${date
          .toLocaleString('default', { month: 'short' })
          .toUpperCase()} · ${parts[0]}`;
        if (!groups[title]) groups[title] = [];
        groups[title].push(e);
      }
    });
    return Object.entries(groups).map(([title, data]) => ({ title, data }));
  }, [entries]);

  const renderEntry = ({ item }: { item: Entry }) => (
    <PunchCardRow
      date={item.date_from}
      title={item.site || 'NO SITE'}
      meta={`${item.work_hours}h · ${item.work_types
        .map((t) => WORK_TYPE_LABELS[t] ?? t.toUpperCase())
        .join(' / ')}`}
      levelChip={item.tech_level_snapshot as CertLevel}
      sigStatus={
        item.status === 'signed' || item.status === 'amended'
          ? 'signed'
          : item.pending_sign_request_id
            ? 'awaiting'
            : undefined
      }
      onPress={() => navigation.navigate('EntryDetail', { entryId: item.id })}
    />
  );

  return (
    <Screen padded={false}>
      <View style={{ flex: 1, paddingHorizontal: spacing.s5 }}>
        {entries.length === 0 ? (
          <EmptyState
            title="Your logbook is empty"
            subtitle="Create your first entry to start logging your rope access work hours."
            actionLabel="START LOGGING"
            onAction={() => navigation.navigate('EntryForm')}
          />
        ) : (
          <>
            <View style={{ paddingTop: spacing.s4, paddingBottom: spacing.s2 }}>
              <Text style={[typography.stencilSm, { color: colors.inkTertiary }]}>
                {entries.length} ENTRIES · {totalHours}H YTD
              </Text>
            </View>
            <SectionList
              sections={groupedEntries}
              keyExtractor={(item) => item.id}
              renderItem={renderEntry}
              renderSectionHeader={({ section: { title } }) => (
                <SectionLabel label={title} />
              )}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: spacing.s12 }}
            />
            <View style={{ paddingBottom: spacing.s5 }}>
              <FabButton label="NEW ENTRY" onPress={() => navigation.navigate('EntryForm')} />
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}
