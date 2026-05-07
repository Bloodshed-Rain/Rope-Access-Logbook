// src/screens/GearDetailScreen.tsx
//
// Detail view for a single gear item: header (name, category, dates),
// inspection history list, and Log / Retire / Edit / Delete CTAs. Write
// actions route through useReadOnly() so a lapsed subscription bounces to
// the Paywall instead of mutating.

import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen, Button, LoadingSpinner, useToast, Sheet, Input } from '../primitives';
import { useTheme } from '../theme/ThemeProvider';
import {
  useGearItem,
  useGearInspections,
  useRetireGear,
  useDeleteGear,
} from '../hooks/useGear';
import { useReadOnly } from '../hooks/useSubscription';
import { RootStackParamList } from '../navigation/RootNavigator';
import { GearInspectionResult } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, 'GearDetail'>;

type Tone = 'ok' | 'warn' | 'err' | 'neutral';

function resultBadge(result: GearInspectionResult): { tone: Tone; label: string } {
  if (result === 'pass') return { tone: 'ok', label: 'Pass' };
  if (result === 'pass_with_concerns') return { tone: 'warn', label: 'Concerns' };
  return { tone: 'err', label: 'Fail' };
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

export function GearDetailScreen() {
  const { colors, spacing, typography, radii } = useTheme();
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { gearId } = route.params;
  const { data: item, isLoading } = useGearItem(gearId);
  const { data: inspections } = useGearInspections(gearId);
  const retire = useRetireGear();
  const remove = useDeleteGear();
  const toast = useToast();
  const readOnly = useReadOnly();
  const [retireSheetOpen, setRetireSheetOpen] = useState(false);
  const [retireReason, setRetireReason] = useState('');

  if (isLoading || !item) return <LoadingSpinner fullScreen label="Loading gear" />;

  const blocked = readOnly;
  const isRetired = !!item.retired_at;

  const guard = (fn: () => void) => () => {
    if (blocked) {
      navigation.navigate('Paywall');
      return;
    }
    fn();
  };

  const handleConfirmRetire = () => {
    const reason = retireReason.trim();
    if (!reason) return;
    retire.mutate(
      { id: item.id, reason },
      {
        onSuccess: () => {
          setRetireSheetOpen(false);
          setRetireReason('');
          toast.show({ message: 'Item retired', variant: 'ok' });
        },
        onError: (e) => toast.show({ message: (e as Error).message, variant: 'err' }),
      },
    );
  };

  const handleDelete = () => {
    if (blocked) {
      navigation.navigate('Paywall');
      return;
    }
    Alert.alert(
      'Delete this item?',
      'Items with inspection history can\'t be deleted. Retire it instead so the history is preserved.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            remove.mutate(item.id, {
              onSuccess: () => {
                toast.show({ message: 'Gear deleted', variant: 'ok' });
                navigation.goBack();
              },
              onError: (e) => toast.show({ message: (e as Error).message, variant: 'err' }),
            }),
        },
      ],
    );
  };

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.base, gap: spacing.base, paddingBottom: spacing.xl }}
      >
        {/* Header */}
        <View>
          <Text style={[typography.title1, { color: colors.textPrimary }]}>{item.name}</Text>
          <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
            {[item.category, item.manufacturer, item.model].filter(Boolean).join(' · ')}
          </Text>
        </View>

        {isRetired && (
          <View
            style={{
              backgroundColor: colors.statusNeutralTint,
              padding: spacing.md,
              borderRadius: radii.md,
            }}
          >
            <Text style={[typography.bodyMed, { color: colors.textPrimary }]}>
              Retired on {item.retired_at}
            </Text>
            {item.retirement_reason && (
              <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
                Reason: {item.retirement_reason}
              </Text>
            )}
          </View>
        )}

        {/* Facts */}
        <View
          style={{
            backgroundColor: colors.bgSurface,
            borderRadius: radii.md,
            borderWidth: 1,
            borderColor: colors.border,
            padding: spacing.base,
            gap: spacing.sm,
          }}
        >
          {item.serial_number && (
            <FactRow label="Serial number" value={item.serial_number} />
          )}
          {item.manufacture_date && (
            <FactRow label="Manufactured" value={item.manufacture_date} />
          )}
          {item.first_use_date && (
            <FactRow label="First use" value={item.first_use_date} />
          )}
          <FactRow
            label="Inspection interval"
            value={`${item.inspection_interval_months} months`}
          />
          {item.next_inspection_due && (
            <FactRow label="Next inspection" value={item.next_inspection_due} />
          )}
          {item.notes && <FactRow label="Notes" value={item.notes} />}
        </View>

        {/* Actions */}
        {!isRetired && (
          <View style={{ gap: spacing.sm }}>
            <Button
              title="Log inspection"
              variant="primary"
              onPress={guard(() => navigation.navigate('LogInspection', { gearId: item.id }))}
            />
            <Button
              title="Edit"
              variant="secondary"
              onPress={guard(() => navigation.navigate('EditGear', { gearId: item.id }))}
            />
            <Button
              title="Retire item"
              variant="ghost"
              onPress={guard(() => setRetireSheetOpen(true))}
            />
          </View>
        )}

        {(inspections?.length ?? 0) === 0 ? (
          <Button
            title="Delete gear"
            variant="ghost"
            onPress={handleDelete}
          />
        ) : null}

        {/* Inspection history */}
        <View style={{ marginTop: spacing.md }}>
          <Text
            style={[
              typography.label,
              { color: colors.textSecondary, marginBottom: spacing.sm, textTransform: 'uppercase' },
            ]}
          >
            Inspection history
          </Text>
          {(inspections ?? []).length === 0 ? (
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              No inspections recorded yet.
            </Text>
          ) : (
            (inspections ?? []).map((insp) => {
              const badge = resultBadge(insp.result);
              return (
                <View
                  key={insp.id}
                  style={{
                    backgroundColor: colors.bgSurface,
                    borderRadius: radii.md,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: spacing.md,
                    marginBottom: spacing.sm,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={[typography.bodyMed, { color: colors.textPrimary }]}>
                      {insp.inspected_on}
                    </Text>
                    <ToneBadge tone={badge.tone} label={badge.label} />
                  </View>
                  {insp.inspector_name && (
                    <Text style={[typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>
                      Inspector: {insp.inspector_name}
                    </Text>
                  )}
                  {insp.notes && (
                    <Text style={[typography.body, { color: colors.textSecondary, marginTop: spacing.xs }]}>
                      {insp.notes}
                    </Text>
                  )}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <Sheet open={retireSheetOpen} onClose={() => setRetireSheetOpen(false)} title="Retire this item">
        <View style={{ gap: spacing.base }}>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            Why is this item being retired? The item will become read-only but its inspection
            history is preserved.
          </Text>
          <Input
            label="Reason"
            value={retireReason}
            onChangeText={setRetireReason}
            placeholder="e.g. End of service life, sold, damaged"
            autoFocus
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button title="Cancel" variant="ghost" onPress={() => setRetireSheetOpen(false)} />
            </View>
            <View style={{ flex: 2 }}>
              <Button
                title="Retire"
                variant="primary"
                onPress={handleConfirmRetire}
                disabled={!retireReason.trim() || retire.isPending}
                loading={retire.isPending}
              />
            </View>
          </View>
        </View>
      </Sheet>
    </Screen>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  const { colors, spacing, typography } = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[typography.body, { color: colors.textPrimary, flexShrink: 1, textAlign: 'right' }]}>
        {value}
      </Text>
    </View>
  );
}
