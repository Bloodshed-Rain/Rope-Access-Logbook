import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

export interface ScreenProps {
  children: React.ReactNode;
  padded?: boolean;
  // Kept for back-compat; the new aesthetic uses panel chrome / stencil
  // section labels instead of rope dividers, so this is now a no-op flag.
  topDivider?: boolean;
}

export function Screen({ children, padded = true }: ScreenProps) {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.safe, { backgroundColor: colors.bgApp, paddingTop: insets.top }]}>
      <View style={[styles.container, padded && { paddingHorizontal: spacing.s5 }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1 }, container: { flex: 1 } });
