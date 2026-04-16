import React from 'react';
import { View, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface CardProps { children: React.ReactNode; style?: ViewStyle; }

export function Card({ children, style }: CardProps) {
  const { colors, spacing, radii, shadows } = useTheme();
  return (
    <View style={[{ backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.base, ...shadows.sm }, style]}>
      {children}
    </View>
  );
}
