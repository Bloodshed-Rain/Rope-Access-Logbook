import React from 'react';
import { Pressable, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface ChipProps { label: string; selected: boolean; onPress: () => void; }

export function Chip({ label, selected, onPress }: ChipProps) {
  const { colors, spacing, typography, radii } = useTheme();
  return (
    <Pressable onPress={onPress}
      style={{ backgroundColor: selected ? colors.accent : colors.slateLightest,
        borderRadius: radii.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
      <Text style={[typography.bodySmall, { color: selected ? colors.textInverse : colors.textPrimary,
        fontWeight: selected ? '600' : '400' }]}>{label}</Text>
    </Pressable>
  );
}
