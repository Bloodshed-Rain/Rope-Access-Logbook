// src/screens/LogbookScreen.tsx
import React, { useState } from 'react';
import { View, Text, FlatList } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Download, Plus } from 'lucide-react-native';
import { Screen, ListRow, Badge, Banner, EmptyState, IconButton } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useEntries, useTotalWorkHours } from '../hooks/useEntries';
import { useBackupReminder } from '../hooks/useBackupReminder';
import { RootStackParamList } from '../navigation/RootNavigator';
import { Entry } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function LogbookScreen() {
  const { colors, spacing, typography, radii } = useTheme();
  const navigation = useNavigation<Nav>();
  const { data: entries = [] } = useEntries();
  const { data: totalHours = 0 } = useTotalWorkHours(new Date().getFullYear());
  const { showReminder, daysSinceBackup } = useBackupReminder();
  const [reminderDismissed, setReminderDismissed] = useState(false);

  const renderEntry = ({ item }: { item: Entry }) => (
    <ListRow
      title={`${item.date} — ${item.site}`}
      subtitle={`${item.work_hours}h · ${item.employer}`}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Badge status={item.status} />
          {item.amends_entry_id && (
            <Text style={[typography.caption, { color: colors.statusAmended }]}>amends</Text>
          )}
        </View>
      }
      onPress={() => navigation.navigate('EntryDetail', { entryId: item.id })}
    />
  );

  return (
    <Screen padded={false}>
      <View style={{ backgroundColor: colors.navy, paddingHorizontal: spacing.base, paddingTop: spacing.lg, paddingBottom: spacing.base }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={[typography.h1, { color: colors.textInverse }]}>Logbook</Text>
            <Text style={[typography.bodySmall, { color: colors.slateLighter }]}>{totalHours}h this year</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <IconButton icon={<Download size={24} color={colors.slateLighter} />}
              onPress={() => navigation.navigate('Main', { screen: 'Profile' } as any)} />
            <IconButton icon={<Plus size={24} color={colors.textInverse} />}
              onPress={() => navigation.navigate('EntryForm')}
              style={{ backgroundColor: colors.accent, borderRadius: radii.md }} />
          </View>
        </View>
      </View>

      {showReminder && !reminderDismissed && (
        <View style={{ paddingHorizontal: spacing.base, paddingBottom: spacing.sm }}>
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
          actionLabel="Create first entry"
          onAction={() => navigation.navigate('EntryForm')} />
      ) : (
        <FlatList data={entries} keyExtractor={(item) => item.id} renderItem={renderEntry} />
      )}
    </Screen>
  );
}
