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
      case 'orange':
        return colors.accentPrimary;
      case 'red':
        return colors.statusErr;
      case 'navy':
        return colors.borderStrong;
      case 'tan':
        return colors.statusErr;
      default:
        return undefined;
    }
  };

  const accentColor = getAccentColor();

  return (
    <View
      style={[
        {
          backgroundColor: bg === 'paper' ? colors.bgSurface : colors.bgSurface,
          padding: spacing.s4,
          borderTopWidth: borders.hair,
          borderTopColor: colors.border,
          borderRightWidth: borders.hair,
          borderRightColor: colors.border,
          borderBottomWidth: borders.hair,
          borderBottomColor: colors.border,
          borderLeftWidth: borders.hair,
          borderLeftColor: colors.border,
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
            width: borders.block,
            backgroundColor: accentColor,
          }}
        />
      )}
      {children}
    </View>
  );
}
