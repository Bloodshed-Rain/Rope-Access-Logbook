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
        return colors.accentBase;
      case 'red':
        return colors.statusErr;
      case 'navy':
        return colors.edgeBright;
      case 'tan':
        return colors.accentHot;
      default:
        return undefined;
    }
  };

  const accentColor = getAccentColor();

  return (
    <View
      style={[
        {
          backgroundColor: bg === 'paper' ? colors.bgPanel : colors.bgRaised,
          padding: spacing.s4,
          borderTopWidth: borders.hair,
          borderTopColor: colors.edgeHi,
          borderRightWidth: borders.hair,
          borderRightColor: colors.edgeBase,
          borderBottomWidth: borders.hair,
          borderBottomColor: colors.edgeBase,
          borderLeftWidth: borders.hair,
          borderLeftColor: colors.edgeBase,
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
