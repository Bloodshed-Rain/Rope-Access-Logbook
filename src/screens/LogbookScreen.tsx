// src/screens/LogbookScreen.tsx
import React, { useMemo, useState } from 'react';
import { View, Text, SectionList } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Download, Plus } from 'lucide-react-native';
import { Screen, ListRow, Badge, Banner, EmptyState, IconButton, RopeDivider, SectionHeader } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useEntries, useTotalWorkHours } from '../hooks/useEntries';
import { useBackupReminder } from '../hooks/useBackupReminder';
import { useMilestones } from '../hooks/useMilestones';
import { RootStackParamList } from '../navigation/RootNavigator';
import { Entry } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function LogbookScreen() {
  const { colors, spacing, typography, radii } = useTheme();
  const navigation = useNavigation<Nav>();
  const { data: entries = [] } = useEntries();
  const { data: totalHours = 0 } = useTotalWorkHours(new Date().getFullYear());
  const { showReminder, daysSinceBackup } = useBackupReminder();
  const { progress } = useMilestones();
  const [reminderDismissed, setReminderDismissed] = useState(false);
  const [milestoneDismissed, setMilestoneDismissed] = useState(false);

  const groupedEntries = useMemo(() => {
    const groups: Record<string, Entry[]> = {};
    entries.forEach(e => {
      const parts = e.date_from.split('-'); // YYYY-MM-DD
      if (parts.length >= 2) {
        const date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1);
        const title = `${date.toLocaleString('default', { month: 'short' }).toUpperCase()} · ${parts[0]}`;
        if (!groups[title]) groups[title] = [];
        groups[title].push(e);
      }
    });
    return Object.entries(groups).map(([title, data]) => ({ title, data }));
  }, [entries]);

  const renderEntry = ({ item }: { item: Entry }) => (
    <ListRow
      title={`${item.date_from === item.date_to ? item.date_from : `${item.date_from} → ${item.date_to}`} — ${item.site || 'No site'}`}
      subtitle={`${item.work_hours}h · ${item.employer || 'No employer'}`}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Badge status={item.status} />
          {item.amends_entry_id && (
            <Text style={[typography.caption, { color: colors.error }]}>amends</Text>
          )}
          {item.pending_sign_request_id && (
            <Text style={[typography.caption, { color: colors.accent }]}>awaiting</Text>
          )}
        </View>
      }
      onPress={() => navigation.navigate('EntryDetail', { entryId: item.id })}
    />
  );

  return (
    <Screen padded={false}>
      <View style={{ backgroundColor: colors.navy }}>
        <View style={{ paddingHorizontal: spacing.base, paddingTop: spacing.xl, paddingBottom: spacing.lg }}>
          <Text style={[typography.stencil, { color: colors.ropeTan, marginBottom: spacing.xs }]}>
            RALB · ROPE ACCESS LOGBOOK
          </Text>
          
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={[typography.display, { color: colors.textInverse, fontSize: 44 }]}>{totalHours}h</Text>
              <Text style={[typography.stencil, { color: colors.slateLighter }]}>THIS YEAR</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <IconButton icon={<Download size={24} color={colors.textInverse} />}
                onPress={() => navigation.navigate('Main', { screen: 'Profile' } as any)} 
                style={{ backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.slateLight }} />
              <IconButton icon={<Plus size={24} color={colors.textInverse} />}
                onPress={() => navigation.navigate('EntryForm')}
                style={{ backgroundColor: colors.accent, borderRadius: radii.md }} />
            </View>
          </View>
        </View>
        <RopeDivider color={colors.ropeTan} opacity={0.45} />
      </View>

      <View style={{ flex: 1, paddingHorizontal: spacing.base }}>
        {progress?.isEligible && !progress.isMaxLevel && !milestoneDismissed && (
          <View style={{ marginTop: spacing.sm }}>
            <Banner variant="success"
              message={`You have reached ${progress.hoursNeeded} hours! You are eligible to upgrade to Level ${progress.currentLevel === 'I' ? 'II' : 'III'}.`}
              onDismiss={() => setMilestoneDismissed(true)} />
          </View>
        )}

        {showReminder && !reminderDismissed && (
          <View style={{ marginTop: spacing.sm }}>
            <Banner variant="warning"
              message={daysSinceBackup !== null
                ? `It's been ${daysSinceBackup} days since your last backup. Export your logbook now.`
                : 'You have never backed up your logbook. Export it now to keep your data safe.'}
              actionLabel="Export"
              onAction={() => navigation.navigate('Main', { screen: 'Profile' } as any)}
              onDismiss={() => setReminderDismissed(true)} />
          </View>
        )}

        {entries.length === 0 ? (
          <EmptyState title="Your logbook is empty"
            subtitle="Create your first entry to start logging your rope access work hours."
            actionLabel="START LOGGING"
            onAction={() => navigation.navigate('EntryForm')} />
        ) : (
          <SectionList
            sections={groupedEntries}
            keyExtractor={(item) => item.id}
            renderItem={renderEntry}
            renderSectionHeader={({ section: { title } }) => (
              <SectionHeader label={title} accent="navy" />
            )}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: spacing.xxl }}
          />
        )}
      </View>
    </Screen>
  );
}
