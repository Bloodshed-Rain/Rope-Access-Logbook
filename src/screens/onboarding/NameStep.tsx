// src/screens/onboarding/NameStep.tsx
// Step 2 — first + last name. Spec §3 line 116.

import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Button, Input, Screen } from '../../primitives';
import { useTheme } from '../../theme/ThemeProvider';
import { OnboardingState } from './types';

export interface NameStepProps {
  state: OnboardingState;
  onChange: (name: { first: string; last: string }) => void;
  onBack: () => void;
  onNext: () => void;
}

export function NameStep({ state, onChange, onBack, onNext }: NameStepProps) {
  const { colors, spacing, typography } = useTheme();

  const valid =
    state.name.first.trim().length > 0 && state.name.last.trim().length > 0;

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            padding: spacing.base,
            paddingBottom: spacing.xxl,
            gap: spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: spacing.sm }}>
            <Text style={[typography.title1, { color: colors.textPrimary }]}>
              What&apos;s your name?
            </Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              This appears on every signed entry and on your exported logbook PDF.
            </Text>
          </View>

          <View style={{ gap: spacing.md }}>
            <Input
              label="First name"
              value={state.name.first}
              onChangeText={(t) => onChange({ ...state.name, first: t })}
              placeholder="Jane"
              autoCapitalize="words"
              autoCorrect={false}
            />
            <Input
              label="Last name"
              value={state.name.last}
              onChangeText={(t) => onChange({ ...state.name, last: t })}
              placeholder="Doe"
              autoCapitalize="words"
              autoCorrect={false}
            />
          </View>

          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <Button title="Continue" onPress={onNext} disabled={!valid} />
            <Button title="Back" onPress={onBack} variant="ghost" />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
