// src/components/illustrations/TechSittingIllustration.tsx
// Stub illustration for the Today-screen hero. Spec §4 calls for a static SVG
// of a rope-tech in a chair; until art is delivered we render a neutral
// placeholder using lucide's User glyph on a muted background.
// TODO: replace with final illustration.

import React from 'react';
import { View } from 'react-native';
import { User } from 'lucide-react-native';
import { useTheme } from '../../theme/ThemeProvider';

export function TechSittingIllustration() {
  const { colors, radii } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: 120,
        height: 120,
        borderRadius: radii.lg,
        backgroundColor: colors.bgMuted,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <User color={colors.accentPrimary} size={56} />
    </View>
  );
}
