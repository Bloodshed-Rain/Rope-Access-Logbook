import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { RopeDivider } from './RopeDivider';

export interface ScreenProps {
  children: React.ReactNode;
  padded?: boolean;
  topDivider?: boolean;
}

export function Screen({ children, padded = true, topDivider = false }: ScreenProps) {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  
  return (
    <View style={[styles.safe, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      {topDivider && <RopeDivider opacity={0.45} />}
      <View style={[styles.container, padded && { paddingHorizontal: spacing.s5 }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ safe: { flex: 1 }, container: { flex: 1 } });
