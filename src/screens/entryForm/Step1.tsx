// src/screens/entryForm/Step1.tsx
// "Where & when" step of the Add Work wizard. Spec §7 lines 321-327.

import React, { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Plus } from 'lucide-react-native';
import { Button, Input } from '../../primitives';
import { SegmentedControl, MultiSelectListRow } from '../../primitives/v2';
import { useTheme } from '../../theme/ThemeProvider';
import { fromISODate, toISODate } from '../../utils/dateRange';
import { WhenChoice, WizardState, WizardStateUpdate } from './types';

export interface Step1Props {
  state: WizardState;
  update: WizardStateUpdate;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  distinctEmployers: string[];
  step1Valid: boolean;
  onNext: () => void;
}

function todayISO(): string {
  return toISODate(new Date());
}

function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toISODate(d);
}

export function Step1(props: Step1Props) {
  const { state, update, setState, distinctEmployers, step1Valid, onNext } = props;
  const { colors, spacing, typography, radii, borders } = useTheme();
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  // Spec §7: "dropdown of distinct prior employers from useEntries(), plus
  // 'Add new' → reveals an inline text input." Default to picking from priors;
  // 'Add new' flips into a free-text Input.
  const [employerMode, setEmployerMode] = useState<'pick' | 'new'>(() => {
    // If we already have a value not in the priors list (typical edit/amend
    // flow with a one-off employer), start in 'new' so the user sees what
    // they have. Otherwise default to 'pick'.
    if (state.employer.trim() && !distinctEmployers.includes(state.employer.trim())) {
      return 'new';
    }
    if (distinctEmployers.length === 0) return 'new';
    return 'pick';
  });

  const onWhenChange = (value: string) => {
    const choice = value as WhenChoice;
    if (choice === 'today') {
      const t = todayISO();
      setState((p) => ({ ...p, when: 'today', dateFrom: t, dateTo: t }));
    } else if (choice === 'yesterday') {
      const y = yesterdayISO();
      setState((p) => ({ ...p, when: 'yesterday', dateFrom: y, dateTo: y }));
    } else {
      setState((p) => ({ ...p, when: 'custom' }));
    }
  };

  const onChangeFrom = (_e: DateTimePickerEvent, d?: Date) => {
    if (Platform.OS !== 'ios') setShowFromPicker(false);
    if (d) {
      const iso = toISODate(d);
      setState((p) => ({
        ...p,
        dateFrom: iso,
        dateTo: iso > p.dateTo ? iso : p.dateTo,
      }));
    }
  };

  const onChangeTo = (_e: DateTimePickerEvent, d?: Date) => {
    if (Platform.OS !== 'ios') setShowToPicker(false);
    if (d) update('dateTo', toISODate(d));
  };

  return (
    <>
      <Text style={[typography.title2, { color: colors.textPrimary }]}>Where & when</Text>

      <Input
        label="Site"
        value={state.site}
        onChangeText={(t) => update('site', t)}
        placeholder="Job site or location"
      />

      {/* Employer — list-first per spec, with an "Add new" row that reveals
          a free-text input. */}
      <View style={{ gap: spacing.sm }}>
        <Text style={[typography.label, { color: colors.textSecondary }]}>Employer</Text>
        {employerMode === 'pick' && distinctEmployers.length > 0 ? (
          <View
            style={{
              borderWidth: borders.hair,
              borderColor: colors.border,
              borderRadius: radii.md,
              overflow: 'hidden',
              backgroundColor: colors.bgSurface,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a new employer"
              onPress={() => {
                setEmployerMode('new');
                update('employer', '');
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                paddingHorizontal: spacing.base,
                paddingVertical: spacing.md,
                minHeight: 56,
                borderBottomWidth: borders.hair,
                borderBottomColor: colors.divider,
                backgroundColor: pressed ? colors.bgMuted : colors.bgSurface,
              })}
            >
              <Plus size={18} color={colors.accentPrimary} />
              <Text style={[typography.bodyMed, { color: colors.accentPrimary }]}>
                Add new
              </Text>
            </Pressable>
            {distinctEmployers.map((emp) => (
              <MultiSelectListRow
                key={emp}
                label={emp}
                selected={state.employer.trim() === emp}
                onToggle={() => update('employer', emp)}
              />
            ))}
          </View>
        ) : (
          <View style={{ gap: spacing.xs }}>
            <Input
              label="New employer"
              value={state.employer}
              onChangeText={(t) => update('employer', t)}
              placeholder="Who you worked for"
            />
            {distinctEmployers.length > 0 && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setEmployerMode('pick')}
                hitSlop={6}
              >
                <Text style={[typography.caption, { color: colors.accentPrimary }]}>
                  Pick from prior employers
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={[typography.label, { color: colors.textSecondary }]}>When</Text>
        <SegmentedControl
          options={[
            { value: 'today',     label: 'Today' },
            { value: 'yesterday', label: 'Yesterday' },
            { value: 'custom',    label: 'Custom' },
          ]}
          value={state.when}
          onChange={onWhenChange}
        />
        {state.when === 'custom' && (
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Pressable
              onPress={() => setShowFromPicker(true)}
              accessibilityRole="button"
              accessibilityLabel={`From ${state.dateFrom}`}
              style={{
                flex: 1,
                borderWidth: borders.hair,
                borderColor: colors.border,
                borderRadius: radii.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.md,
                backgroundColor: colors.bgSurface,
                minHeight: 44,
                justifyContent: 'center',
              }}
            >
              <Text style={[typography.caption, { color: colors.textSecondary }]}>From</Text>
              <Text style={[typography.body, { color: colors.textPrimary }]}>
                {state.dateFrom}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setShowToPicker(true)}
              accessibilityRole="button"
              accessibilityLabel={`To ${state.dateTo}`}
              style={{
                flex: 1,
                borderWidth: borders.hair,
                borderColor: colors.border,
                borderRadius: radii.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.md,
                backgroundColor: colors.bgSurface,
                minHeight: 44,
                justifyContent: 'center',
              }}
            >
              <Text style={[typography.caption, { color: colors.textSecondary }]}>To</Text>
              <Text style={[typography.body, { color: colors.textPrimary }]}>
                {state.dateTo}
              </Text>
            </Pressable>
          </View>
        )}
        {showFromPicker && (
          <DateTimePicker
            value={fromISODate(state.dateFrom)}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={onChangeFrom}
          />
        )}
        {showToPicker && (
          <DateTimePicker
            value={fromISODate(state.dateTo)}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            minimumDate={fromISODate(state.dateFrom)}
            onChange={onChangeTo}
          />
        )}
      </View>

      <Input
        label="Hours"
        value={state.workHours}
        onChangeText={(t) => update('workHours', t)}
        keyboardType="decimal-pad"
        placeholder="8"
      />

      <Button
        title="Next"
        variant="primary"
        onPress={onNext}
        disabled={!step1Valid}
      />
    </>
  );
}
