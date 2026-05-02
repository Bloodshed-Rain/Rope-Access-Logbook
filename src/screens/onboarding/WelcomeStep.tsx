// src/screens/onboarding/WelcomeStep.tsx
// Step 1 — Single-screen value prop. Spec §3 line 115.

import React from 'react';
import { Text, View } from 'react-native';
import { Button, Screen } from '../../primitives';
import { useTheme } from '../../theme/ThemeProvider';

export interface WelcomeStepProps {
  onNext: () => void;
}

export function WelcomeStep({ onNext }: WelcomeStepProps) {
  const { colors, spacing, typography } = useTheme();

  return (
    <Screen>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          gap: spacing.lg,
          paddingHorizontal: spacing.base,
        }}
      >
        <View style={{ gap: spacing.sm, alignItems: 'center' }}>
          <Text
            style={[
              typography.title1,
              { color: colors.textPrimary, textAlign: 'center' },
            ]}
          >
            Rope Access Logbook
          </Text>
          <Text
            style={[
              typography.body,
              {
                color: colors.textSecondary,
                textAlign: 'center',
                paddingHorizontal: spacing.md,
              },
            ]}
          >
            Your digital work-experience logbook. Log hours, capture
            supervisor signatures, and export for re-certification.
          </Text>
        </View>

        <View style={{ alignSelf: 'stretch', marginTop: spacing.lg }}>
          <Button title="Get started" onPress={onNext} />
        </View>
      </View>
    </Screen>
  );
}
