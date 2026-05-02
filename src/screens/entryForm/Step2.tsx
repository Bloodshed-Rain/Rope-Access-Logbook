// src/screens/entryForm/Step2.tsx
// "What did you do" step of the Add Work wizard. Spec §7 lines 329-333.

import React from 'react';
import { Text, View } from 'react-native';
import { Button, Input, Textarea } from '../../primitives';
import { MultiSelectListRow } from '../../primitives';
import { useTheme } from '../../theme/ThemeProvider';
import { WORK_TYPE_LABELS } from '../../constants';
import { WorkType } from '../../types';
import { WizardState, WizardStateUpdate } from './types';

const ALL_WORK_TYPES: WorkType[] = [
  'inspection', 'ndt', 'welding', 'painting', 'window_cleaning',
  'rescue', 'training', 'rigging', 'other',
];

export interface Step2Props {
  state: WizardState;
  update: WizardStateUpdate;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  step1Valid: boolean;
  step2Valid: boolean;
  isSaving: boolean;
  onBack: () => void;
  onSave: () => void;
}

export function Step2(props: Step2Props) {
  const { state, update, setState, step1Valid, step2Valid, isSaving, onBack, onSave } = props;
  const { colors, spacing, typography, radii, borders } = useTheme();

  const toggleWorkType = (wt: WorkType) => {
    setState((p) => ({
      ...p,
      workTypes: p.workTypes.includes(wt)
        ? p.workTypes.filter((t) => t !== wt)
        : [...p.workTypes, wt],
    }));
  };

  return (
    <>
      <Text style={[typography.title2, { color: colors.textPrimary }]}>
        What did you do
      </Text>

      <View style={{ gap: spacing.sm }}>
        <Text style={[typography.label, { color: colors.textSecondary }]}>Work types</Text>
        <View
          style={{
            borderWidth: borders.hair,
            borderColor: colors.border,
            borderRadius: radii.md,
            overflow: 'hidden',
            backgroundColor: colors.bgSurface,
          }}
        >
          {ALL_WORK_TYPES.map((wt) => (
            <MultiSelectListRow
              key={wt}
              label={WORK_TYPE_LABELS[wt]}
              selected={state.workTypes.includes(wt)}
              onToggle={() => toggleWorkType(wt)}
            />
          ))}
        </View>
      </View>

      {state.workTypes.includes('other') && (
        <Input
          label="Describe the other work"
          value={state.otherWorkDescription}
          onChangeText={(t) => update('otherWorkDescription', t)}
          placeholder="e.g. paint stripping"
        />
      )}

      <Textarea
        label="Notes (optional)"
        value={state.notes}
        onChangeText={(t) => update('notes', t)}
        placeholder="Anything worth recording about this work"
      />

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button title="Back" variant="ghost" onPress={onBack} />
        </View>
        <View style={{ flex: 2 }}>
          <Button
            title="Save work"
            variant="primary"
            onPress={onSave}
            disabled={!step1Valid || !step2Valid}
            loading={isSaving}
          />
        </View>
      </View>
    </>
  );
}
