import React from 'react';
import { View, Text, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface StampBadgeProps {
  label: string;
  variant: 'signed' | 'draft' | 'amended';
  rotation?: number;
  style?: ViewStyle;
}

export function StampBadge({ label, variant, rotation = -8, style }: StampBadgeProps) {
  const { colors, borders } = useTheme();

  const color =
    variant === 'signed' ? colors.success :
    variant === 'draft' ? colors.ink50 :
    colors.blood;

  return (
    <View
      style={[
        {
          transform: [{ rotate: `${rotation}deg` }],
          borderWidth: borders.block,
          borderColor: color,
          paddingHorizontal: 8,
          paddingVertical: 4,
          alignSelf: 'flex-start',
        },
        style,
      ]}
    >
      <View
        style={{
          borderWidth: borders.hair,
          borderColor: color,
          paddingHorizontal: 6,
          paddingVertical: 2,
        }}
      >
        <Text style={{ fontFamily: 'JetBrainsMono_800ExtraBold', fontSize: 14, letterSpacing: 1.6, textTransform: 'uppercase', color }}>{label}</Text>
      </View>
    </View>
  );
}
