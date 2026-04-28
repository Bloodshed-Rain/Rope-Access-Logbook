import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export interface LoadingSpinnerProps {
  label?: string;
  size?: 'small' | 'large';
  color?: string;
  fullScreen?: boolean;
  style?: ViewStyle;
}

export function LoadingSpinner({
  label,
  size = 'large',
  color,
  fullScreen = false,
  style,
}: LoadingSpinnerProps) {
  const { colors, spacing, typography } = useTheme();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: fullScreen ? colors.bg : 'transparent', gap: spacing.s3 },
        fullScreen && styles.fullScreen,
        style,
      ]}
    >
      <ActivityIndicator size={size} color={color ?? colors.accent} />
      {label ? (
        <Text style={[typography.bodySmall, styles.label, { color: colors.textSecondary }]}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullScreen: {
    flex: 1,
    paddingHorizontal: 24,
  },
  label: {
    letterSpacing: 1.2,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
});
