import React from 'react';
import { View, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  accent?: 'orange' | 'navy' | 'red' | 'tan';
  bg?: 'surface' | 'paper';
}

export function Card({ children, style, accent, bg = 'surface' }: CardProps) {
  const { colors, spacing, borders } = useTheme();

  const getAccentColor = () => {
    switch (accent) {
      case 'orange': return colors.blood; // map orange to blood
      case 'navy': return colors.ink;     // map navy to ink
      case 'red': return colors.blood;
      case 'tan': return colors.bg2;
      default: return undefined;
    }
  };

  const accentColor = getAccentColor();

  return (
    <View
      style={[
        {
          backgroundColor: bg === 'paper' ? colors.paper : colors.paper, // usually cards are paper
          padding: spacing.s3,
          borderWidth: borders.block,
          borderColor: colors.ink,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {accentColor && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: borders.heavy,
            backgroundColor: accentColor,
          }}
        />
      )}
      {children}
    </View>
  );
}
