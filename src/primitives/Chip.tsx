import React from 'react';
import { Pressable, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

export function Chip({ label, selected, onPress }: ChipProps) {
  const { colors, borders, typography } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: selected ? colors.accentPrimary : 'transparent',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderWidth: borders.hair,
        borderColor: selected ? colors.accentPressed : colors.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontFamily: typography.label.fontFamily,
          fontSize: 9,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          color: selected ? colors.bgApp : colors.textSecondary,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
