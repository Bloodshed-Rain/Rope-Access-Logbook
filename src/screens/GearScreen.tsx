// src/screens/GearScreen.tsx
//
// Personal equipment inventory. Active items at top sorted by next inspection
// due, retired items in a divider section below. Reachable from MeScreen
// "Manage gear" button and from the Dashboard "items due" card.

import React from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen, Button, EmptyState, LoadingSpinner } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import { useGearList } from '../hooks/useGear';
import { useReadOnly } from '../hooks/useSubscription';
import { GearItem } from '../types';
import { RootStackParamList } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type Tone = 'ok' | 'warn' | 'err' | 'neutral';

function dueState(g: GearItem, todayIso: string): { tone: Tone; label: string } {
  if (g.retired_at) return { tone: 'neutral', label: 'Retired' };
  if (!g.next_inspection_due) return { tone: 'neutral', label: 'No date' };
  const dueMs = new Date(g.next_inspection_due + 'T00:00:00Z').getTime();
  const todayMs = new Date(todayIso + 'T00:00:00Z').getTime();
  const days = Math.floor((dueMs - todayMs) / (24 * 60 * 60 * 1000));
  if (days < 0) return { tone: 'err', label: `Overdue ${-days}d` };
  if (days <= 30) return { tone: 'warn', label: `Due in ${days}d` };
  return { tone: 'ok', label: `Due ${g.next_inspection_due}` };
}

function ToneBadge({ tone, label }: { tone: Tone; label: string }) {
  const { colors, spacing, radii, typography } = useTheme();
  const map: Record<Tone, { bg: string; fg: string }> = {
    ok: { bg: colors.statusOkTint, fg: colors.statusOk },
    warn: { bg: colors.statusWarnTint, fg: colors.statusWarn },
    err: { bg: colors.statusErrTint, fg: colors.statusErr },
    neutral: { bg: colors.statusNeutralTint, fg: colors.textSecondary },
  };
  const v = map[tone];
  return (
    <View
      style={{
        backgroundColor: v.bg,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs / 2,
        borderRadius: radii.pill,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={[typography.caption, { color: v.fg }]}>{label}</Text>
    </View>
  );
}

function GearRow({ item, onPress }: { item: GearItem; onPress: () => void }) {
  const { colors, spacing, radii, typography } = useTheme();
  const today = new Date().toISOString().slice(0, 10);
  const status = dueState(item, today);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.bgMuted : colors.bgSurface,
        borderRadius: radii.md,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.base,
        marginBottom: spacing.sm,
        opacity: item.retired_at ? 0.55 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1, paddingRight: spacing.sm }}>
          <Text style={[typography.bodyMed, { color: colors.textPrimary }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]} numberOfLines={1}>
            {[item.category, item.serial_number].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <ToneBadge tone={status.tone} label={status.label} />
      </View>
    </Pressable>
  );
}

export function GearScreen() {
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<Nav>();
  const { data, isLoading } = useGearList();
  const readOnly = useReadOnly();

  if (isLoading) return <LoadingSpinner fullScreen label="Loading gear" />;

  const items = data ?? [];
  const active = items.filter((g) => !g.retired_at);
  const retired = items.filter((g) => g.retired_at);

  return (
    <Screen padded={false}>
      <View style={{ flex: 1, padding: spacing.base }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: spacing.base,
          }}
        >
          <Text style={[typography.title1, { color: colors.textPrimary }]}>Gear</Text>
          <Button
            title="Add gear"
            variant="primary"
            onPress={() => {
              if (readOnly) {
                navigation.navigate('Paywall');
                return;
              }
              navigation.navigate('AddGear');
            }}
          />
        </View>

        {items.length === 0 ? (
          <EmptyState
            title="No gear yet"
            subtitle="Track every harness, helmet, rope, and connector with inspection reminders."
            actionLabel="Add your first item"
            onAction={() => {
              if (readOnly) {
                navigation.navigate('Paywall');
                return;
              }
              navigation.navigate('AddGear');
            }}
          />
        ) : (
          <FlatList
            data={active}
            keyExtractor={(g) => g.id}
            renderItem={({ item }) => (
              <GearRow item={item} onPress={() => navigation.navigate('GearDetail', { gearId: item.id })} />
            )}
            ListFooterComponent={
              retired.length > 0 ? (
                <View style={{ marginTop: spacing.lg }}>
                  <Text
                    style={[
                      typography.label,
                      { color: colors.textSecondary, marginBottom: spacing.sm, textTransform: 'uppercase' },
                    ]}
                  >
                    Retired
                  </Text>
                  {retired.map((g) => (
                    <GearRow
                      key={g.id}
                      item={g}
                      onPress={() => navigation.navigate('GearDetail', { gearId: g.id })}
                    />
                  ))}
                </View>
              ) : null
            }
          />
        )}
      </View>
    </Screen>
  );
}
