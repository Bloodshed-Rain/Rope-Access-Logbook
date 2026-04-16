import React from 'react';
import { Pressable, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface ChipProps { label: string; selected: boolean; onPress: () => void; }

export function Chip({ label, selected, onPress }: ChipProps) {
  const { colors, spacing, typography, radii } = useTheme();
  return (
    <Pressable onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: selected ? colors.navy : colors.slateLightest,
        borderRadius: radii.full, paddingHorizontal: spacing.base, paddingVertical: spacing.md,
        minHeight: 40, justifyContent: 'center' as const,
        opacity: pressed ? 0.8 : 1,
      })}>
      <Text style={[typography.bodySmall, { color: selected ? colors.textInverse : colors.textPrimary,
        fontWeight: selected ? '700' : '500' }]}>{label}</Text>
    </Pressable>
  );
}
