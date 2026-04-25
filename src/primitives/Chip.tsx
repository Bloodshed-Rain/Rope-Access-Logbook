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
        backgroundColor: selected ? colors.accentBase : 'transparent',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderWidth: borders.hair,
        borderColor: selected ? colors.accentDeep : colors.edgeHi,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontFamily: 'Michroma_400Regular',
          fontSize: 9,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          color: selected ? colors.bgBase : colors.inkSecondary,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
