// src/screens/PostSaveSheet.tsx
// Spec §7 lines 337-348. Centered modal shown after a new entry is saved.
//
// Flow:  EntryFormScreen.handleSave (new-entry branch only) replaces the
// current route with PostSaveSheet, which renders a confirmation modal with
// three actions:
//   • Sign now      — replaces the route with SignatureOptionsSheet
//   • Send request  — replaces the route with SendSignRequest (built in D3)
//   • Later         — pops back to the tab root
//
// Hardware back / iOS swipe-down dismiss is wired to popToTop() because the
// modal is a one-shot reaction to save, not a persistent target — the user
// should never end up "behind" it staring at the dismissed wizard.

import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CheckCircle2 } from 'lucide-react-native';
import { Button, LoadingSpinner, useToast } from '../primitives';
import { CenterModal } from '../primitives/CenterModal';
import { StatusPill } from '../primitives/StatusPill';
import { useTheme } from '../theme/ThemeProvider';
import { useEntry } from '../hooks/useEntries';
import { formatEntryDateRange } from '../utils/dateRange';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type R = RouteProp<RootStackParamList, 'PostSaveSheet'>;

export function PostSaveSheet() {
  const { colors, spacing, typography, borders } = useTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const toast = useToast();
  const { entryId } = route.params;

  const { data: entry, isLoading } = useEntry(entryId);

  // If the entry vanished between save and modal mount (very unlikely), bail
  // out cleanly rather than rendering "undefined · undefined".
  const entryMissing = !isLoading && !entry;
  useEffect(() => {
    if (!entryMissing) return;
    toast.show({ message: 'Entry not found', variant: 'err' });
    navigation.popToTop();
  }, [entryMissing, navigation, toast]);

  const handleClose = () => navigation.popToTop();

  return (
    <CenterModal open={true} onClose={handleClose}>
      {isLoading || !entry ? (
        <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}>
          <LoadingSpinner />
        </View>
      ) : (
        <View style={{ alignItems: 'center', gap: spacing.sm }}>
          <CheckCircle2 size={48} color={colors.statusOk} />

          <Text style={[typography.title2, { color: colors.textPrimary, textAlign: 'center' }]}>
            Work saved
          </Text>

          <Text style={[typography.caption, { color: colors.textSecondary, textAlign: 'center' }]}>
            {`${entry.site} · ${formatEntryDateRange(entry.date_from, entry.date_to)} · ${entry.work_hours}h`}
          </Text>

          <StatusPill variant="pending" label="Draft" />

          <Text
            style={[
              typography.caption,
              { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
            ]}
          >
            Get this signed by your Level III supervisor.
          </Text>

          <View
            style={{
              alignSelf: 'stretch',
              height: borders.hair,
              backgroundColor: colors.divider,
              marginVertical: spacing.md,
            }}
          />

          <View style={{ alignSelf: 'stretch', gap: spacing.sm }}>
            <Button
              title="Sign now"
              variant="primary"
              onPress={() => navigation.replace('SignatureOptionsSheet', { entryId })}
            />
            <Button
              title="Send request"
              variant="secondary"
              // TODO(D3): SendSignRequest screen will be registered in the
              // next task. Route name + param shape are settled now so this
              // call type-checks and will start working as soon as D3 lands.
              onPress={() => navigation.replace('SendSignRequest', { entryId })}
            />
            <Button
              title="Later"
              variant="ghost"
              onPress={() => navigation.popToTop()}
            />
          </View>
        </View>
      )}
    </CenterModal>
  );
}
