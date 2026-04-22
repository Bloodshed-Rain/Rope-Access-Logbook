import React from 'react';
import { Pressable, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

export function Chip({ label, selected, onPress }: ChipProps) {
  const { colors, borders } = useTheme();
  
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: selected ? colors.ink : 'transparent',
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderWidth: borders.rule,
        borderColor: colors.ink,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontFamily: 'JetBrainsMono_700Bold',
          fontSize: 10,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          color: selected ? colors.bg : colors.ink,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
